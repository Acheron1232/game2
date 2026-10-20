// The match simulation: entities, orders, combat, abilities and one fixed tick.
// Runs on the server (in the match worker). Plain logic: no network, no timers, no DOM.
// Phase 7a: attacks, projectiles, death and respawn, neutral camps, bounty, XP and levels.
// Phase 7b: abilities, buffs and debuffs, auras, zones, summons, monster skills.
// Items and shops come in 7c.

import { gameData, type HeroDef } from '../data/index';
import { findPath, isWalkable, nearestWalkable, type NavGrid } from '../nav/nav-grid';
import {
  castProblem,
  endCast,
  extraHitChance,
  learn,
  monsterCast,
  monsterPassives,
  orderCast,
  refreshPassives,
  updateAuras,
  updateCast,
  type CastTarget,
} from './abilities';
import { applyBuffs, buffFlags, hasBuff, maxBuff, sumBuffs, type Buff } from './buffs';
import { createCamps, onCampMemberAttacked, onCampMemberDied, updateCamps, type CampState } from './camps';
import { applyMove, CommandType, isPredicted, type GameCommand } from './commands';
import { entityTypeIndex, ENTITY_TYPES, isHeroType, statsOf } from './entity-types';
import { applyUpgrades, gatherFactor, trainTimeFactor } from './faction/upgrades';
import { Factions, type BuildingState, type Difficulty, type FactionState, type WorkerJob } from './faction/faction';
import type { TerrainGrid } from '../map/terrain';
import type { TreeList } from '../nav/trees';
import { DamageKind, EventList, EventType } from './events';
import { createMover, stepMover, type Mover } from './movement';
import { Rng } from './rng';
import { SpatialGrid } from './spatial-grid';
import {
  attackDamage,
  buildingStats,
  canAttackLayer,
  deathGoldLoss,
  heroKillBounty,
  heroStats,
  levelForXp,
  neutralXpFactor,
  rectDistance,
  respawnSeconds,
  spellDamage,
  unitStats,
  xpForKillingHero,
  xpForKillingUnit,
  type CombatStats,
} from './stats';
import { qPos } from '../protocol/game';

export const TICK_RATE = gameData.rules.simulation.tickRate;
export const TICK_DT = 1 / TICK_RATE;
/** Owner id for neutral entities (camps). */
export const NEUTRAL = 255;
/** Team of neutral monsters: everyone's enemy. */
export const NEUTRAL_TEAM = 0;

const R = gameData.rules;
const secs = (s: number) => Math.round(s * TICK_RATE);
/** Dead units stay this long for the death animation, then they are removed. */
const CORPSE_TICKS = secs(3);
/** How far idle units look for enemies to attack. */
const ACQUIRE_RANGE = 7;
/** Look for targets only every few ticks (spread over entities by id). */
const THINK_EVERY = 5;
/** Damage and heal over time land every half second. */
const DOT_TICKS = 10;

export interface MatchSlot {
  index: number;
  /** entity type index of the hero, see entity-types.ts */
  heroType: number;
  team: number;
  color: number;
  /** start spot index in the map layout */
  start: number;
  /** faction AI difficulty (and the hero bot's, for bot slots) */
  ai?: Difficulty;
  /** no human plays this slot: a hero bot controls the hero */
  bot?: boolean;
}

/** Map data the factions need: the terrain grid (buildable ground) and the tree list. */
export interface MatchWorld {
  terrain: TerrainGrid;
  trees: TreeList;
}

export interface MatchSetup {
  seed: number;
  slots: MatchSlot[];
  /** Load test: this many walking units, spread over the slots. They do not fight. */
  testUnits?: number;
  /** Where test units walk: around each base, or all in the temple center (worst case for vision). */
  testArea?: 'bases' | 'center';
  /** Tests: no neutral camps. */
  noCamps?: boolean;
}

export type OrderKind = 'idle' | 'move' | 'attack' | 'attackMove' | 'hold' | 'cast';

export interface HeroState {
  def: HeroDef;
  slot: number;
  start: number;
  xp: number;
  level: number;
  skillPoints: number;
  gold: number;
  /** tick to come back to life, 0 while alive */
  respawnAt: number;
  abilityLevels: number[];
}

export interface CastState {
  slot: number;
  target: CastTarget;
  /** tick the effect happens (after the cast time); 0 = still walking into range */
  castEnd: number;
  /** channel spells: tick the channel ends, 0 = no channel */
  channelEnd: number;
  nextWave: number;
  wave: number;
}

/** A move the unit did not choose: knockback, a jump, a dive, a charge. */
export interface ForcedMove {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  start: number;
  end: number;
  kind: 'knock' | 'leap' | 'dive' | 'charge';
  onEnd?: () => void;
  onTick?: () => void;
}

export interface SimEntity {
  id: number;
  type: number;
  hero: boolean;
  heroState: HeroState | null;
  owner: number;
  team: number;
  color: number;
  mover: Mover;
  /** velocity of the last tick, game units per second */
  vx: number;
  vy: number;
  /** stats without buffs (hero: from level; unit: from data or a summon) */
  base: CombatStats;
  /** stats with buffs */
  stats: CombatStats;
  buffs: Buff[];
  hp: number;
  mana: number;
  alive: boolean;
  /** tick to remove a dead non-hero, 0 = keep */
  removeAt: number;
  order: OrderKind;
  orderTarget: number;
  orderX: number;
  orderY: number;
  /** current attack target id, 0 = none */
  targetId: number;
  /** 0 = not swinging, 1 = wind-up (hit comes at swingEnd), 2 = back-swing */
  swing: 0 | 1 | 2;
  swingEnd: number;
  nextAttackAt: number;
  repathAt: number;
  chaseX: number;
  chaseY: number;
  lastHitBy: number;
  /** neutral camp index, -1 for others */
  camp: number;
  returning: boolean;
  homeX: number;
  homeY: number;
  homeFacing: number;
  /** load-test units: they only walk */
  passive: boolean;
  thinkAt: number;
  /** tick each ability (Q W E R) is ready again */
  cooldowns: number[];
  cast: CastState | null;
  forced: ForcedMove | null;
  /** summons: the hero they follow, and when they go away */
  leaderId: number;
  summonUntil: number;
  /** monster skills: tick each one is ready */
  skillReady: Record<string, number>;
  /** a teleport this tick: do not send it as a fast move */
  jumped: boolean;
  /** buildings and gold mines (Phase 8) */
  building: BuildingState | null;
  /** worker jobs (Phase 8) */
  job: WorkerJob | null;
  /** can not be hurt or targeted (gold mines) */
  invulnerable: boolean;
  /** inside a gold mine: not drawn, can not be hurt or targeted */
  hidden: boolean;
}

/** Who dealt damage. Kept on projectiles, because the shooter may be gone when it lands. */
export interface DamageSource {
  id: number;
  owner: number;
  team: number;
}

interface Projectile {
  id: number;
  source: DamageSource;
  target: number;
  x: number;
  y: number;
  speed: number;
  raw: number;
  attackType: CombatStats['attackType'];
  /** spells: what happens on hit instead of attack damage */
  onHit?: (t: SimEntity) => void;
}

interface LineShot {
  source: DamageSource;
  x: number;
  y: number;
  dx: number;
  dy: number;
  left: number;
  speed: number;
  width: number;
  firstOnly: boolean;
  hit: Set<number>;
  onHit: (t: SimEntity) => void;
}

export interface Zone {
  x: number;
  y: number;
  radius: number;
  until: number;
  source: DamageSource;
  ability: number;
  tickFn: (z: Zone) => void;
}

interface QueuedCommand {
  predicted: boolean;
  slot: number;
  seq: number;
  /** null = not valid, only the sequence number counts */
  cmd: GameCommand | null;
}

const TEST_UNIT_TYPES = ['worker', 'swordsman', 'archer', 'cleric', 'lancer'];
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class MatchSim {
  tick = 0;
  readonly entities: SimEntity[] = [];
  readonly heroes: (SimEntity | null)[] = [];
  /** last processed command per slot and the tick it ran */
  readonly lastSeq: number[] = [];
  readonly lastSeqTick: number[] = [];
  /** Learning and server-driven orders must not reset the movement reconciliation clock. */
  readonly predictionSeq: number[] = [];
  readonly predictionTick: number[] = [];
  readonly events = new EventList();
  readonly camps: CampState[];
  readonly grid: SpatialGrid<SimEntity>;
  readonly rng: Rng;
  readonly zones: Zone[] = [];
  /** Can this team see the entity? Set by the server from its vision; used to check commands. */
  canSee: (team: number, e: SimEntity) => boolean = () => true;
  private readonly byId = new Map<number, SimEntity>();
  private readonly queue: QueuedCommand[] = [];
  private readonly projectiles: Projectile[] = [];
  private readonly lineShots: LineShot[] = [];
  private nextId = 1;
  private nextProjectile = 1;
  readonly size = gameData.map.size.width;

  /** AI factions (Town Halls, workers, buildings), when the match has map data for them */
  readonly factions: Factions | null;

  constructor(
    readonly setup: MatchSetup,
    readonly nav: NavGrid,
    world?: MatchWorld,
  ) {
    this.rng = new Rng(setup.seed);
    this.grid = new SpatialGrid(this.size, 4);
    for (const s of setup.slots) {
      const [x, y] = gameData.map.starts[s.start]!.heroSpawn;
      const hero = this.spawn(s.heroType, s.index, s.team, s.color, x, y);
      const def = gameData.heroes.find((h) => h.id === ENTITY_TYPES[s.heroType])!;
      hero.heroState = {
        def,
        slot: s.index,
        start: s.start,
        xp: 0,
        level: 1,
        skillPoints: 1,
        gold: R.gold.startGold,
        respawnAt: 0,
        abilityLevels: [0, 0, 0, 0],
      };
      this.heroes[s.index] = hero;
      this.lastSeq[s.index] = 0;
      this.lastSeqTick[s.index] = 0;
      this.predictionSeq[s.index] = 0;
      this.predictionTick[s.index] = 0;
    }
    this.camps = setup.noCamps ? [] : createCamps(this);
    this.factions = world ? new Factions(this, world.terrain, world.trees) : null;
    if (setup.testUnits) this.spawnTestUnits(setup.testUnits, setup.testArea ?? 'bases');
  }

  get(id: number): SimEntity | undefined {
    return this.byId.get(id);
  }

  spawn(type: number, owner: number, team: number, color: number, x: number, y: number, facing?: number): SimEntity {
    const stats = statsOf(type);
    const mover = createMover(x, y, stats.moveSpeed);
    // Face the map center at the start, like the buildings.
    mover.facing = facing ?? Math.atan2(-(this.size / 2 - x), this.size / 2 - y);
    const e: SimEntity = {
      id: this.nextId++,
      type,
      hero: isHeroType(type),
      heroState: null,
      owner,
      team,
      color,
      mover,
      vx: 0,
      vy: 0,
      base: stats,
      stats,
      buffs: [],
      hp: stats.maxHp,
      mana: stats.maxMana,
      alive: true,
      removeAt: 0,
      order: 'idle',
      orderTarget: 0,
      orderX: 0,
      orderY: 0,
      targetId: 0,
      swing: 0,
      swingEnd: 0,
      nextAttackAt: 0,
      repathAt: 0,
      chaseX: 0,
      chaseY: 0,
      lastHitBy: 0,
      camp: -1,
      returning: false,
      homeX: x,
      homeY: y,
      homeFacing: mover.facing,
      passive: false,
      thinkAt: 0,
      cooldowns: [0, 0, 0, 0],
      cast: null,
      forced: null,
      leaderId: 0,
      summonUntil: 0,
      skillReady: {},
      jumped: false,
      building: null,
      job: null,
      invulnerable: false,
      hidden: false,
    };
    this.entities.push(e);
    this.byId.set(e.id, e);
    if (!e.hero) monsterPassives(this, e);
    return e;
  }

  isFlying(e: SimEntity): boolean {
    return e.stats.layer !== 'ground';
  }

  isEnemy(a: { team: number }, b: { team: number }): boolean {
    return a.team !== b.team;
  }

  isStunned(e: SimEntity): boolean {
    return hasBuff(e.buffs, 'stun');
  }

  isRooted(e: SimEntity): boolean {
    return hasBuff(e.buffs, 'root');
  }

  isSilenced(e: SimEntity): boolean {
    return hasBuff(e.buffs, 'silence');
  }

  /** Plans a walk (or a flight) to a point. */
  moveTo(e: SimEntity, x: number, y: number): void {
    applyMove(e.mover, this.nav, x, y, false, this.isFlying(e));
  }

  // ---------- commands ----------

  /**
   * Queues a command. It runs at the start of the next tick. Returns false (and drops it) when
   * it is not valid; the sequence number still counts as processed.
   */
  queueCommand(slot: number, seq: number, cmd: GameCommand): boolean {
    const ok = this.isValid(slot, cmd);
    this.queue.push({ slot, seq, cmd: ok ? cmd : null, predicted: isPredicted(cmd) });
    return ok;
  }

  private isValid(slot: number, cmd: GameCommand): boolean {
    const hero = this.heroes[slot];
    if (!hero) return false;
    if (cmd.type === CommandType.Learn) return cmd.slot >= 0 && cmd.slot < 4 && (hero.heroState?.skillPoints ?? 0) > 0;
    if (!hero.alive) return false;
    switch (cmd.type) {
      case CommandType.Move:
      case CommandType.AttackMove:
        return Number.isFinite(cmd.x) && Number.isFinite(cmd.y) && cmd.x >= 0 && cmd.y >= 0 && cmd.x <= this.size && cmd.y <= this.size;
      case CommandType.Attack: {
        const t = this.byId.get(cmd.target);
        return (
          !!t &&
          t.alive &&
          t !== hero &&
          this.isEnemy(hero, t) &&
          canAttackLayer(hero.stats.canHitAir, t.stats.layer) &&
          this.canSee(hero.team, t)
        );
      }
      case CommandType.Cast:
        return (
          cmd.slot >= 0 && cmd.slot < 4 && castProblem(this, hero, cmd.slot, { kind: cmd.target, id: cmd.id, x: cmd.x, y: cmd.y }) === null
        );
      case CommandType.Stop:
      case CommandType.Hold:
        return true;
    }
    return false;
  }

  /** Why a cast would be refused right now (for tests and the client's alerts). */
  castCheck(slot: number, abilitySlot: number, target: CastTarget): string | null {
    const hero = this.heroes[slot];
    return hero ? castProblem(this, hero, abilitySlot, target) : 'no hero';
  }

  private runCommand(e: SimEntity, cmd: GameCommand): void {
    if (cmd.type === CommandType.Learn) {
      learn(this, e, cmd.slot);
      return;
    }
    // A new order stops a cast or a channel that has not happened yet.
    if (e.cast) endCast(this, e);
    e.swing = e.swing === 1 && cmd.type !== CommandType.Attack ? 0 : e.swing;
    switch (cmd.type) {
      case CommandType.Move:
        e.order = 'move';
        e.targetId = 0;
        applyMove(e.mover, this.nav, cmd.x, cmd.y, cmd.queue, this.isFlying(e));
        break;
      case CommandType.Stop:
        e.order = 'idle';
        e.targetId = 0;
        e.mover.path = [];
        break;
      case CommandType.Hold:
        e.order = 'hold';
        e.targetId = 0;
        e.mover.path = [];
        break;
      case CommandType.Attack:
        e.order = 'attack';
        e.orderTarget = cmd.target;
        e.targetId = cmd.target;
        e.repathAt = 0;
        break;
      case CommandType.AttackMove:
        e.order = 'attackMove';
        e.orderX = cmd.x;
        e.orderY = cmd.y;
        e.targetId = 0;
        applyMove(e.mover, this.nav, cmd.x, cmd.y, false, this.isFlying(e));
        break;
      case CommandType.Cast:
        orderCast(this, e, cmd.slot, { kind: cmd.target, id: cmd.id, x: cmd.x, y: cmd.y });
        e.repathAt = 0;
        break;
    }
  }

  /** Makes a hero walk back to its start spot (the player left). Not a player command. */
  sendHome(slot: number): void {
    const hero = this.heroes[slot];
    if (!hero?.heroState || !hero.alive) return;
    const [x, y] = gameData.map.starts[hero.heroState.start]!.heroSpawn;
    this.runCommand(hero, { type: CommandType.Move, x, y, queue: false });
  }

  // ---------- the tick ----------

  step(): void {
    this.tick++;
    this.events.clear();
    for (const q of this.queue) {
      const hero = this.heroes[q.slot];
      if (hero && q.cmd && (hero.alive || q.cmd.type === CommandType.Learn)) this.runCommand(hero, q.cmd);
      this.lastSeq[q.slot] = q.seq;
      this.lastSeqTick[q.slot] = this.tick;
      if (q.predicted) {
        this.predictionSeq[q.slot] = q.seq;
        this.predictionTick[q.slot] = this.tick;
      }
    }
    this.queue.length = 0;

    this.factions?.blockers.refresh();
    this.grid.rebuild(this.entities, (e) => e.alive && !e.hidden);
    this.updateBuffs();
    updateAuras(this);
    updateCamps(this);
    for (const e of this.entities) {
      if (!e.alive || e.hidden) continue;
      // Buildings only shoot (Watchtowers); they never think or move.
      if (e.building) {
        if (e.stats.attackRange > 0 && e.building.done) this.towerThink(e);
        continue;
      }
      if (e.forced) {
        this.stepForced(e);
        continue;
      }
      if (this.isStunned(e)) {
        e.swing = 0;
        if (e.cast) endCast(this, e);
        continue;
      }
      if (e.passive) {
        if (e.thinkAt <= this.tick) this.wander(e);
        continue;
      }
      const taunt = this.tauntOf(e);
      if (taunt) {
        if (e.cast) endCast(this, e);
        e.targetId = taunt;
      } else if (e.order === 'cast') {
        updateCast(this, e);
        continue;
      } else if (e.camp < 0) {
        // A worker with a job only fights when it was ordered to (the brain decides).
        if (e.job && e.job.kind !== 'idle' && e.order === 'idle') continue;
        this.think(e);
      } else monsterCast(this, e);
      if (e.targetId) this.engage(e);
    }
    this.factions?.update();
    for (const e of this.entities) {
      const px = e.mover.x,
        py = e.mover.y;
      const frozen =
        !e.alive ||
        e.hidden ||
        e.building ||
        e.forced ||
        e.swing === 1 ||
        this.isStunned(e) ||
        this.isRooted(e) ||
        (e.cast && e.cast.castEnd > 0);
      if (!frozen) {
        e.mover.speed = e.stats.moveSpeed;
        stepMover(e.mover, TICK_DT);
      }
      if (e.jumped) {
        e.jumped = false;
        e.vx = e.vy = 0;
      } else {
        e.vx = (e.mover.x - px) / TICK_DT;
        e.vy = (e.mover.y - py) / TICK_DT;
      }
    }
    this.separate();
    this.stepProjectiles();
    this.stepLineShots();
    this.stepZones();
    this.regen();
    this.lifeAndDeath();
  }

  // ---------- orders and targets ----------

  /** Player-owned units: follow the order and pick targets. */
  private think(e: SimEntity): void {
    const target = e.targetId ? this.byId.get(e.targetId) : undefined;
    if (e.targetId && (!target || !target.alive)) e.targetId = 0;
    const due = (this.tick + e.id) % THINK_EVERY === 0;
    if (e.leaderId) return this.followLeader(e, due);
    switch (e.order) {
      case 'move':
        if (!e.mover.path.length) e.order = 'idle';
        break;
      case 'attack':
        if (!e.targetId) {
          e.order = 'idle';
          e.mover.path = [];
        }
        break;
      case 'attackMove':
        if (!e.targetId && due) e.targetId = this.acquire(e, ACQUIRE_RANGE, true);
        if (!e.targetId && !e.mover.path.length) {
          if (Math.hypot(e.orderX - e.mover.x, e.orderY - e.mover.y) > 1)
            applyMove(e.mover, this.nav, e.orderX, e.orderY, false, this.isFlying(e));
          else e.order = 'idle';
        }
        break;
      case 'hold':
        if (!e.targetId && due) e.targetId = this.acquire(e, e.stats.attackRange + e.stats.radius + 0.6, false);
        break;
      case 'idle':
      case 'cast':
        if (!e.targetId && due) e.targetId = this.acquire(e, ACQUIRE_RANGE, false);
        break;
    }
  }

  /** Summons fight what their hero fights and otherwise stay close to it. */
  private followLeader(e: SimEntity, due: boolean): void {
    const leader = this.byId.get(e.leaderId);
    if (!leader || !leader.alive) {
      if (!e.targetId && due) e.targetId = this.acquire(e, ACQUIRE_RANGE, false);
      return;
    }
    const lt = leader.targetId ? this.byId.get(leader.targetId) : undefined;
    if (lt && lt.alive && canAttackLayer(e.stats.canHitAir, lt.stats.layer)) e.targetId = lt.id;
    else if (!e.targetId && due) e.targetId = this.acquire(e, ACQUIRE_RANGE, false);
    if (!e.targetId && due && Math.hypot(leader.mover.x - e.mover.x, leader.mover.y - e.mover.y) > 4)
      this.moveTo(e, leader.mover.x, leader.mover.y);
  }

  private tauntOf(e: SimEntity): number {
    for (const b of e.buffs) {
      if (!b.tauntId) continue;
      const t = this.byId.get(b.tauntId);
      if (t && t.alive) return t.id;
    }
    return 0;
  }

  /**
   * Nearest enemy in range. Like classic RTS games, idle units do not start fights with neutral
   * monsters, only with monsters that already fight their team (attack-move takes anything).
   */
  acquire(e: SimEntity, range: number, takeNeutrals: boolean): number {
    let best = 0,
      bestD = Infinity;
    this.grid.query(e.mover.x, e.mover.y, range, (o, d2) => {
      if (o === e || o.invulnerable || !this.isEnemy(e, o) || !canAttackLayer(e.stats.canHitAir, o.stats.layer)) return;
      if (o.team === NEUTRAL_TEAM && !takeNeutrals) {
        const ot = o.targetId ? this.byId.get(o.targetId) : undefined;
        if (!ot || ot.team !== e.team) return;
      }
      if (d2 < bestD) {
        bestD = d2;
        best = o.id;
      }
    });
    return best;
  }

  /** Watchtowers: shoot the nearest enemy in range. */
  private towerThink(e: SimEntity): void {
    if (!e.targetId && (this.tick + e.id) % THINK_EVERY === 0) e.targetId = this.acquire(e, e.stats.attackRange + e.stats.radius + 1, true);
    if (e.targetId) this.engage(e);
  }

  /** Faction units and buildings: data stats + the faction's Town Hall upgrades, then buffs. */
  applyFactionStats(e: SimEntity): void {
    const f = this.factions?.factionOf(e);
    if (!f || e.hero || e.summonUntil) return this.refreshStats(e);
    const id = ENTITY_TYPES[e.type]!;
    const def = e.building?.def;
    const raw = def ? buildingStats(def) : unitStats(gameData.units.find((u) => u.id === id)!);
    e.base = applyUpgrades(raw, id, f.upgrades, this.tick < f.warBannerUntil);
    this.refreshStats(e);
  }

  /** Rich Veins. */
  gatherFactor(f: FactionState): number {
    return gatherFactor(f.upgrades);
  }

  /** Training Drills. */
  trainTimeFactor(f: FactionState): number {
    return trainTimeFactor(f.upgrades);
  }

  /** Attack the current target: chase it, turn to it, swing, hit. */
  engage(e: SimEntity): void {
    const t = this.byId.get(e.targetId);
    if (!t || !t.alive || t.invulnerable || t.hidden || !canAttackLayer(e.stats.canHitAir, t.stats.layer)) {
      e.targetId = 0;
      e.swing = 0;
      return;
    }
    const dx = t.mover.x - e.mover.x,
      dy = t.mover.y - e.mover.y;
    // Gap between the two edges: buildings are rectangles, units are circles.
    const gap = t.building
      ? rectDistance(e.mover.x, e.mover.y, t.mover.x, t.mover.y, t.building.w, t.building.h) - e.stats.radius
      : Math.hypot(dx, dy) - e.stats.radius - t.stats.radius;
    const range = e.stats.attackRange;
    if (e.swing === 1) {
      if (gap > range + 2)
        e.swing = 0; // it got away during the wind-up
      else if (this.tick >= e.swingEnd) this.hit(e, t);
      return;
    }
    if (gap <= range) {
      e.mover.path = [];
      const want = Math.atan2(-dx, dy);
      const diff = wrap(want - e.mover.facing);
      const maxTurn = e.mover.turnSpeed * TICK_DT;
      e.mover.facing = wrap(e.mover.facing + Math.max(-maxTurn, Math.min(maxTurn, diff)));
      if (Math.abs(diff) < 0.4 && this.tick >= e.nextAttackAt) {
        const cd = secs(e.stats.attackCooldown);
        e.swing = 1;
        e.swingEnd = this.tick + Math.max(1, Math.round(cd * R.combat.attackPointFraction));
        e.nextAttackAt = this.tick + Math.max(1, cd);
        this.events.push(EventType.Attack, e.id, t.id);
      }
      return;
    }
    if (e.order === 'hold' || this.isRooted(e) || e.building) {
      if (e.order === 'hold' || e.building) e.targetId = 0;
      return;
    }
    e.swing = 0;
    if (this.tick >= e.repathAt || Math.hypot(t.mover.x - e.chaseX, t.mover.y - e.chaseY) > 1.5) {
      e.chaseX = t.mover.x;
      e.chaseY = t.mover.y;
      e.repathAt = this.tick + 10;
      if (this.isFlying(e)) applyMove(e.mover, this.nav, t.mover.x, t.mover.y, false, true);
      else e.mover.path = findPath(this.nav, e.mover.x, e.mover.y, t.mover.x, t.mover.y, 8000);
    }
  }

  private hit(e: SimEntity, t: SimEntity): void {
    e.swing = 2;
    const roll = () => this.rng.int(Math.round(e.stats.damageMin), Math.round(e.stats.damageMax));
    const raw = roll();
    if (e.stats.projectileSpeed > 0) {
      const p: Projectile = {
        id: this.nextProjectile++ & 0xff,
        source: { id: e.id, owner: e.owner, team: e.team },
        target: t.id,
        x: e.mover.x,
        y: e.mover.y,
        speed: e.stats.projectileSpeed,
        raw,
        attackType: e.stats.attackType,
      };
      this.projectiles.push(p);
      this.events.push(EventType.Projectile, e.id, t.id, p.speed, 0);
    } else {
      this.applyAttack(e, t, raw, e.stats.attackType);
      // Flurry: sometimes a second hit right away.
      const extra = extraHitChance(e);
      if (extra && t.alive && this.rng.next() < extra) this.applyAttack(e, t, roll(), e.stats.attackType);
    }
  }

  /** A homing spell projectile (Blood Bolt, Boulder Toss). */
  spellProjectile(e: SimEntity, t: SimEntity, speed: number, ability: number, onHit: (t: SimEntity) => void): void {
    this.projectiles.push({
      id: this.nextProjectile++ & 0xff,
      source: { id: e.id, owner: e.owner, team: e.team },
      target: t.id,
      x: e.mover.x,
      y: e.mover.y,
      speed,
      raw: 0,
      attackType: 'magic',
      onHit,
    });
    this.events.push(EventType.Projectile, e.id, t.id, speed, ability + 1);
  }

  private stepProjectiles(): void {
    let w = 0;
    for (const p of this.projectiles) {
      const t = this.byId.get(p.target);
      if (!t || !t.alive) continue;
      const dx = t.mover.x - p.x,
        dy = t.mover.y - p.y;
      const d = Math.hypot(dx, dy);
      const stepLen = p.speed * TICK_DT;
      if (d <= stepLen + t.stats.radius * 0.5) {
        if (p.onHit) p.onHit(t);
        else this.applyAttack(p.source, t, p.raw, p.attackType);
        continue;
      }
      p.x += (dx / d) * stepLen;
      p.y += (dy / d) * stepLen;
      this.projectiles[w++] = p;
    }
    this.projectiles.length = w;
  }

  /** A shot that flies in a straight line and hits enemies on the way (Arcane Arrow, Spear Throw). */
  lineShot(
    e: SimEntity,
    tx: number,
    ty: number,
    length: number,
    width: number,
    speed: number,
    firstOnly: boolean,
    ability: number,
    onHit: (t: SimEntity) => void,
  ): void {
    let dx = tx - e.mover.x,
      dy = ty - e.mover.y;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d;
    dy /= d;
    e.mover.facing = Math.atan2(-dx, dy);
    this.lineShots.push({
      source: { id: e.id, owner: e.owner, team: e.team },
      x: e.mover.x,
      y: e.mover.y,
      dx,
      dy,
      left: length,
      speed,
      width,
      firstOnly,
      hit: new Set(),
      onHit,
    });
    this.events.push(EventType.LineShot, e.id, qPos(e.mover.x + dx * length), qPos(e.mover.y + dy * length), ability);
  }

  private stepLineShots(): void {
    let w = 0;
    for (const s of this.lineShots) {
      const step = Math.min(s.left, s.speed * TICK_DT);
      const nx = s.x + s.dx * step,
        ny = s.y + s.dy * step;
      let done = false;
      // Units near the segment walked this tick.
      this.grid.query((s.x + nx) / 2, (s.y + ny) / 2, step / 2 + s.width + 1, (t) => {
        if (done || !t.alive || t.team === s.source.team || s.hit.has(t.id)) return;
        const px = t.mover.x - s.x,
          py = t.mover.y - s.y;
        const along = Math.max(0, Math.min(step, px * s.dx + py * s.dy));
        const off = Math.hypot(px - s.dx * along, py - s.dy * along);
        if (off > s.width / 2 + t.stats.radius) return;
        s.hit.add(t.id);
        s.onHit(t);
        if (s.firstOnly) done = true;
      });
      s.x = nx;
      s.y = ny;
      s.left -= step;
      if (!done && s.left > 1e-3) this.lineShots[w++] = s;
    }
    this.lineShots.length = w;
  }

  /** An area on the ground that works every half second for a while. */
  addZone(e: SimEntity, x: number, y: number, radius: number, seconds: number, ability: number, tickFn: (z: Zone) => void): void {
    this.zones.push({
      x,
      y,
      radius,
      until: this.tick + secs(seconds),
      source: { id: e.id, owner: e.owner, team: e.team },
      ability,
      tickFn,
    });
  }

  private stepZones(): void {
    let w = 0;
    for (const z of this.zones) {
      if (this.tick % DOT_TICKS === 0) z.tickFn(z);
      if (this.tick < z.until) this.zones[w++] = z;
    }
    this.zones.length = w;
  }

  /** Moves a unit to a point over some time, whatever it wants (jumps, dives, charges, knockback). */
  forceMove(e: SimEntity, x: number, y: number, seconds: number, kind: ForcedMove['kind'], onEnd?: () => void, onTick?: () => void): void {
    if (e.building) return; // buildings do not move
    if (e.forced?.kind !== 'knock' && e.forced) return; // a jump is not stopped by a push
    e.swing = 0;
    e.mover.path = [];
    e.forced = {
      fromX: e.mover.x,
      fromY: e.mover.y,
      toX: x,
      toY: y,
      start: this.tick,
      end: this.tick + Math.max(1, secs(seconds)),
      kind,
      onEnd,
      onTick,
    };
  }

  private stepForced(e: SimEntity): void {
    const f = e.forced!;
    const t = Math.min(1, (this.tick - f.start) / (f.end - f.start));
    const x = f.fromX + (f.toX - f.fromX) * t,
      y = f.fromY + (f.toY - f.fromY) * t;
    // A push stops at trees, cliffs and buildings.
    if (f.kind === 'knock' && !this.isFlying(e) && !isWalkable(this.nav, x, y)) {
      e.forced = null;
      return;
    }
    e.mover.x = x;
    e.mover.y = y;
    f.onTick?.();
    if (t >= 1) {
      e.forced = null;
      f.onEnd?.();
    }
  }

  teleport(e: SimEntity, x: number, y: number): void {
    e.mover.x = x;
    e.mover.y = y;
    e.mover.path = [];
    e.swing = 0;
    e.jumped = true;
  }

  // ---------- damage ----------

  /** Attack damage: damage type and armor count. */
  applyAttack(source: DamageSource, t: SimEntity, raw: number, type: CombatStats['attackType']): void {
    const dealt = this.damage(t, attackDamage(raw, type, t.stats.armorType, t.stats.armor), source, DamageKind.Attack);
    // Life steal (Crimson Pact aura, later items).
    const s = this.byId.get(source.id);
    if (s && s.alive && dealt > 0) {
      const ls = sumBuffs(s.buffs, 'lifeStealPct');
      if (ls > 0) this.heal(s, (dealt * ls) / 100, source);
    }
  }

  /** Spell damage: no armor, 75% to heroes, less with spell reduction, more with Mana Mark. */
  spellHit(t: SimEntity, raw: number, source: DamageSource): number {
    // Spells do not hurt buildings (rules.json combat.spellDamage).
    if (t.building) return 0;
    return this.damage(t, spellDamage(raw, t.hero), source, DamageKind.Spell);
  }

  /** Applies damage after shields. Returns what was really taken. */
  damage(t: SimEntity, amount: number, source: DamageSource, kind: number): number {
    if (!t.alive || amount <= 0 || t.invulnerable || t.hidden) return 0;
    if (kind === DamageKind.Spell) {
      amount *= 1 - Math.min(90, sumBuffs(t.buffs, 'spellReductionPct')) / 100;
      amount *= 1 + sumBuffs(t.buffs, 'spellDamageTakenPct') / 100;
    }
    amount *= 1 - Math.min(95, maxBuff(t.buffs, 'damageBlockPct')) / 100;
    amount *= 1 - Math.min(90, sumBuffs(t.buffs, 'damageReductionPct')) / 100;
    const before = t.hp;
    t.hp -= amount;
    const minHp = maxBuff(t.buffs, 'minHp');
    if (minHp > 0 && t.hp < minHp) t.hp = minHp;
    const dealt = before - t.hp;
    t.lastHitBy = source.id;
    this.events.push(EventType.Damage, t.id, source.id, Math.round(amount), kind);
    if (t.camp >= 0) onCampMemberAttacked(this, t, source);
    else if (!t.targetId && t.order === 'idle' && !t.passive) {
      // Hit while standing around: hit back.
      const s = this.byId.get(source.id);
      if (s && s.alive && canAttackLayer(t.stats.canHitAir, s.stats.layer)) t.targetId = s.id;
    }
    if (t.hp <= 0) this.kill(t, source);
    return dealt;
  }

  heal(t: SimEntity, amount: number, source: DamageSource): void {
    if (!t.alive || amount <= 0) return;
    const before = t.hp;
    t.hp = Math.min(t.stats.maxHp, t.hp + amount);
    if (t.hp - before >= 0.5) this.events.push(EventType.Damage, t.id, source.id, Math.round(t.hp - before), DamageKind.Heal);
  }

  // ---------- buffs ----------

  /** Adds a buff; the same id from the same source refreshes it. */
  addBuff(e: SimEntity, b: Buff): void {
    if (!e.alive || e.building) return;
    const old = e.buffs.findIndex((x) => x.id === b.id && x.sourceId === b.sourceId);
    if (old >= 0) {
      const changed = JSON.stringify(e.buffs[old]) !== JSON.stringify({ ...b, until: e.buffs[old]!.until });
      e.buffs[old] = b;
      if (changed) this.refreshStats(e);
      return;
    }
    e.buffs.push(b);
    this.refreshStats(e);
  }

  removeBuff(e: SimEntity, id: string, sourceId?: number): void {
    const n = e.buffs.length;
    e.buffs = e.buffs.filter((b) => !(b.id === id && (sourceId === undefined || b.sourceId === sourceId)));
    if (e.buffs.length !== n) this.refreshStats(e);
  }

  private updateBuffs(): void {
    const dot = this.tick % DOT_TICKS === 0;
    for (const e of this.entities) {
      if (!e.alive || !e.buffs.length) continue;
      let changed = false;
      for (const b of e.buffs) {
        if (dot && b.dps) this.spellHit(e, b.dps * (DOT_TICKS / TICK_RATE), { id: b.sourceId, owner: b.sourceOwner, team: b.sourceTeam });
        if (!e.alive) break;
        if (this.tick >= b.until) {
          changed = true;
          if (b.healAtEnd) this.heal(e, b.healAtEnd, { id: b.sourceId, owner: b.sourceOwner, team: b.sourceTeam });
        }
      }
      if (changed && e.alive) {
        e.buffs = e.buffs.filter((b) => this.tick < b.until);
        this.refreshStats(e);
      }
    }
  }

  /** Base stats (level, later items) + buffs. Health and mana keep their share of the max. */
  refreshStats(e: SimEntity): void {
    if (e.heroState) e.base = heroStats(e.heroState.def, e.heroState.level);
    const old = e.stats;
    const next = applyBuffs(e.base, e.buffs);
    if (next.maxHp > old.maxHp) e.hp += next.maxHp - old.maxHp;
    if (next.maxMana > old.maxMana) e.mana += next.maxMana - old.maxMana;
    e.stats = next;
    if (e.alive) e.hp = Math.max(1, Math.min(e.hp, next.maxHp));
    e.mana = Math.min(e.mana, next.maxMana);
  }

  buffFlagsOf(e: SimEntity): number {
    return buffFlags(e.buffs);
  }

  // ---------- death, rewards, levels ----------

  /** Kills an entity now (damage, a timed summon, a defeated faction, an empty mine). */
  kill(e: SimEntity, killer: DamageSource): void {
    if (!e.alive) return;
    e.alive = false;
    e.hp = 0;
    e.mover.path = [];
    e.swing = 0;
    e.targetId = 0;
    e.order = 'idle';
    e.forced = null;
    if (e.cast) endCast(this, e);
    e.buffs = [];
    this.events.push(EventType.Death, e.id, killer.id);
    if (!e.summonUntil || killer.id !== e.id) this.reward(e, killer);
    if (e.heroState) {
      const hs = e.heroState;
      hs.respawnAt = this.tick + secs(respawnSeconds(hs.level));
      hs.gold = Math.max(0, hs.gold - deathGoldLoss(hs.level));
    } else {
      e.removeAt = this.tick + CORPSE_TICKS;
    }
    if (e.camp >= 0) onCampMemberDied(this, e);
    if (this.factions) this.factions.onDeath(e);
  }

  /** Gold for the last hit (and allies near), XP for enemy heroes near the death. */
  private reward(victim: SimEntity, killer: DamageSource): void {
    const victimLevel = victim.heroState?.level ?? victim.stats.level;
    const killerHero = killer.owner < 4 ? this.heroes[killer.owner] : null;
    if (killerHero?.heroState && killer.team !== victim.team) {
      const gold = victim.heroState ? heroKillBounty(victimLevel) : this.bountyOf(victim);
      this.addGold(killerHero, gold, victim);
      const helpers: SimEntity[] = [];
      this.grid.query(victim.mover.x, victim.mover.y, R.gold.assistRange, (o) => {
        if (o.heroState && o !== killerHero && o.team === killer.team) helpers.push(o);
      });
      const share = Math.floor((gold * R.gold.assistShare) / Math.max(1, helpers.length));
      if (share > 0) for (const h of helpers) this.addGold(h, share, victim);
    }
    // Buildings give gold, never XP.
    if (victim.building) return;
    const xp = victim.heroState ? xpForKillingHero(victimLevel) : xpForKillingUnit(victimLevel);
    const takers: SimEntity[] = [];
    this.grid.query(victim.mover.x, victim.mover.y, R.experience.shareRange, (o) => {
      if (o.heroState && o.alive && o.team !== victim.team) takers.push(o);
    });
    for (const h of takers) {
      const factor = victim.team === NEUTRAL_TEAM ? neutralXpFactor(h.heroState!.level) : 1;
      this.addXp(h, (xp / takers.length) * factor);
    }
  }

  private bountyOf(e: SimEntity): number {
    if (e.building) return e.building.def?.bounty ?? 0;
    if (e.summonUntil) return gameData.units.find((u) => u.id === ENTITY_TYPES[e.type])?.bounty[0] ?? 0;
    const def = gameData.units.find((u) => u.id === ENTITY_TYPES[e.type]);
    return def ? this.rng.int(def.bounty[0], def.bounty[1]) : 0;
  }

  addGold(hero: SimEntity, amount: number, where?: SimEntity): void {
    if (!hero.heroState || amount <= 0) return;
    hero.heroState.gold += amount;
    if (where) this.events.push(EventType.Gold, where.id, 0, amount, hero.heroState.slot);
  }

  addXp(hero: SimEntity, amount: number): void {
    const hs = hero.heroState;
    if (!hs || amount <= 0) return;
    hs.xp += amount;
    const level = levelForXp(hs.xp);
    while (hs.level < level) {
      hs.level++;
      hs.skillPoints++;
      this.refreshStats(hero);
      this.events.push(EventType.LevelUp, hero.id, 0, hs.level);
    }
  }

  private lifeAndDeath(): void {
    let w = 0;
    for (const e of this.entities) {
      const hs = e.heroState;
      if (!e.alive && hs && hs.respawnAt && this.tick >= hs.respawnAt) this.respawn(e);
      // Summons go away when their time is up (no reward for anyone).
      if (e.alive && e.summonUntil && this.tick >= e.summonUntil) this.kill(e, { id: e.id, owner: e.owner, team: e.team });
      if (!e.alive && e.removeAt && this.tick >= e.removeAt) {
        this.byId.delete(e.id);
        continue;
      }
      this.entities[w++] = e;
    }
    this.entities.length = w;
    // Passive income: 1 gold per second for every hero, alive or not.
    if (this.tick % TICK_RATE === 0) for (const h of this.heroes) if (h?.heroState) h.heroState.gold += R.gold.passiveIncomePerSec;
  }

  private respawn(e: SimEntity): void {
    const hs = e.heroState!;
    const [x, y] = gameData.map.starts[hs.start]!.heroSpawn;
    hs.respawnAt = 0;
    e.alive = true;
    e.buffs = [];
    this.refreshStats(e);
    // Passives (Dragon Scales) come back with the hero.
    refreshPassives(this, e);
    e.hp = e.stats.maxHp;
    e.mana = e.stats.maxMana;
    e.mover.x = x;
    e.mover.y = y;
    e.mover.path = [];
    e.order = 'idle';
    e.lastHitBy = 0;
    e.jumped = true;
    this.events.push(EventType.Respawn, e.id);
  }

  private regen(): void {
    for (const e of this.entities) {
      if (!e.alive) continue;
      if (e.hp < e.stats.maxHp) e.hp = Math.min(e.stats.maxHp, e.hp + e.stats.hpRegen * TICK_DT);
      if (e.mana < e.stats.maxMana) e.mana = Math.min(e.stats.maxMana, e.mana + e.stats.manaRegen * TICK_DT);
    }
  }

  /** Units do not stand inside each other: push overlapping ground units apart. Heroes are not pushed. */
  private separate(): void {
    for (const e of this.entities) {
      if (!e.alive || e.hero || e.forced || e.building || e.stats.layer !== 'ground') continue;
      const r = e.stats.radius;
      this.grid.query(e.mover.x, e.mover.y, r + 0.8, (o, d2) => {
        if (o === e || !o.alive || o.building || o.stats.layer !== 'ground') return;
        const min = r + o.stats.radius;
        if (d2 >= min * min) return;
        const d = Math.sqrt(d2) || 0.01;
        const push = (min - d) * (o.hero ? 1 : 0.5);
        const nx = e.mover.x + ((e.mover.x - o.mover.x) / d) * push,
          ny = e.mover.y + ((e.mover.y - o.mover.y) / d) * push;
        if (isWalkable(this.nav, nx, ny)) {
          e.mover.x = nx;
          e.mover.y = ny;
        }
      });
    }
  }

  // ---------- load-test units ----------

  private spawnTestUnits(count: number, area: 'bases' | 'center'): void {
    const slots = this.setup.slots;
    if (!slots.length) return;
    for (let i = 0; i < count; i++) {
      const s = slots[i % slots.length]!;
      const [cx, cy] = area === 'center' ? [this.size / 2, this.size / 2] : gameData.map.starts[s.start]!.heroSpawn;
      const p = this.randomPointNear(cx, cy, area === 'center' ? 30 : 24);
      if (!p) continue;
      const type = entityTypeIndex(TEST_UNIT_TYPES[i % TEST_UNIT_TYPES.length]!);
      const e = this.spawn(type, s.index, s.team, s.color, p[0], p[1]);
      e.homeX = cx;
      e.homeY = cy;
      e.passive = true;
      e.thinkAt = 1 + this.rng.int(0, 60);
    }
  }

  private wander(e: SimEntity): void {
    e.thinkAt = this.tick + this.rng.int(40, 140);
    if (e.mover.path.length) return;
    const p = this.randomPointNear(e.homeX, e.homeY, 24);
    if (p) e.mover.path = findPath(this.nav, e.mover.x, e.mover.y, p[0], p[1], 6000);
  }

  randomPointNear(x: number, y: number, r: number): [number, number] | null {
    const a = this.rng.next() * Math.PI * 2,
      d = Math.sqrt(this.rng.next()) * r;
    return nearestWalkable(this.nav, x + Math.cos(a) * d, y + Math.sin(a) * d, 12);
  }
}
