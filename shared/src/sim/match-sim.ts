// The match simulation: entities, orders, combat, abilities and one fixed tick.
// Runs on the server (in the match worker). Plain logic: no network, no timers, no DOM.
// Phase 7a: attacks, projectiles, death and respawn, neutral camps, bounty, XP and levels.
// Phase 7b: abilities, buffs and debuffs, auras, zones, summons, monster skills.
// Phase 7c: items, shops, items on the ground, camp drops, fountains, uphill misses.

import { gameData, type HeroDef } from '../data/index';
import { findPath, groundLevel, isWalkable, nearestWalkable, type NavGrid } from '../nav/nav-grid';
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
import { applyBuffs, buffFlags, hasBuff, hiddenFrom, maxBuff, sumBuffs, type Buff } from './buffs';
import { createCamps, onCampMemberAttacked, onCampMemberDied, updateCamps, type CampState } from './camps';
import { applyMove, CommandType, isPredicted, type GameCommand } from './commands';
import { entityTypeIndex, ENTITY_TYPES, isHeroType, statsOf } from './entity-types';
import { applyUpgrades, gatherFactor, trainTimeFactor } from './faction/upgrades';
import { Factions, type BuildingState, type Difficulty, type FactionState, type WorkerJob } from './faction/faction';
import type { TerrainGrid } from '../map/terrain';
import type { TreeList } from '../nav/trees';
import { DamageKind, EventList, EventType } from './events';
import {
  emptyInventory,
  endItemOrder,
  GROUND_ITEM_TICKS,
  isInstantItemCommand,
  isItemCommand,
  itemBonus,
  itemCommandProblem,
  itemsOnHit,
  nextGroundId,
  orderItem,
  runInstantItemCommand,
  takeRevive,
  updateItemOrder,
  type GroundItem,
  type ItemOrder,
  type ItemStack,
} from './items';
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
import { HIRE, hire, hireProblem } from './faction/hire';
import { CATAPULT_TYPE, fightsBack, pickTarget } from './faction/targeting';
import { buyUpgrade, upgradeProblem } from './faction/hall-shop';

/** Focus fire per AI difficulty (ai.json). */
const FOCUS_FIRE = Object.fromEntries(
  Object.entries(gameData.ai.faction.difficulties).map(([d, r]) => [d, (r as unknown as { focusFire: boolean }).focusFire]),
) as Record<Difficulty, boolean>;

export const TICK_RATE = gameData.rules.simulation.tickRate;
export const TICK_DT = 1 / TICK_RATE;
/** Owner id for neutral entities (camps). */
export const NEUTRAL = 255;
/** Team of neutral monsters: everyone's enemy. */
export const NEUTRAL_TEAM = 0;
/** Command slots from here on belong to the factions' own heroes (FACTION_HERO_SLOT + player slot). */
export const FACTION_HERO_SLOT = 4;

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
  /** Watch mode (dev): bots in every slot, spectators see all, this many steps per network tick. */
  watch?: number;
}

export type OrderKind = 'idle' | 'move' | 'attack' | 'attackMove' | 'follow' | 'hold' | 'cast' | 'item';

export interface HeroState {
  def: HeroDef;
  /** command slot: the player's slot, or FACTION_HERO_SLOT + slot for a faction's own hero */
  slot: number;
  start: number;
  /** where the hero comes back to life (start spot, or the faction's Hero Shrine) */
  home: [number, number];
  xp: number;
  level: number;
  skillPoints: number;
  gold: number;
  /** tick to come back to life, 0 while alive */
  respawnAt: number;
  abilityLevels: number[];
  /** 6 slots; null = empty */
  inventory: (ItemStack | null)[];
  /** item cooldown group (or item id) -> tick it is ready again */
  itemCooldowns: Map<string, number>;
  /** Phoenix Feather: come back here with this share of health, instead of at the base */
  revive: { x: number; y: number; hpPct: number } | null;
  /** for the end screen */
  stats: HeroStats;
}

export interface HeroStats {
  /** enemy heroes this hero killed */
  kills: number;
  deaths: number;
  /** all gold the hero got (kills, camps, selling) */
  goldEarned: number;
  /** neutral camps this player's side cleared (last hit) */
  camps: number;
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
  /** an item order that walks first, or a Scroll of Return channel */
  itemOrder: ItemOrder | null;
  /** does nothing by itself and is not pushed (wards) */
  inert: boolean;
  /** an AI army on its way to an enemy: attack-move leaves neutral camps alone (unless they hit us) */
  skipNeutrals: boolean;
  /** an AI army walks at the pace of its slowest unit: move speed limit, 0 = none */
  speedCap: number;
  /** a soldier hired by a hero (leaderId): follows it, picks its own fights */
  hired: boolean;
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
  /** an attack up a hill that will miss */
  miss: boolean;
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
  /** items lying on the ground (camp drops, dropped by heroes) */
  readonly groundItems: GroundItem[] = [];
  /** Can this team see the entity? Set by the server from its vision; used to check commands. */
  canSee: (team: number, e: SimEntity) => boolean = () => true;
  /** Can this team see this point? (items on the ground) */
  canSeePoint: (team: number, x: number, y: number) => boolean = () => true;
  private lastGroundId = 0;
  private readonly byId = new Map<number, SimEntity>();
  private readonly queue: QueuedCommand[] = [];
  private readonly projectiles: Projectile[] = [];
  private readonly lineShots: LineShot[] = [];
  private nextId = 1;
  private nextProjectile = 1;
  readonly size = gameData.map.size.width;

  /** AI factions (Town Halls, workers, buildings), when the match has map data for them */
  readonly factions: Factions | null;
  /** the faction AI and hero bots (server only; set by the match runner) */
  ai: { update(): void } | null = null;

  constructor(
    readonly setup: MatchSetup,
    readonly nav: NavGrid,
    world?: MatchWorld,
  ) {
    this.rng = new Rng(setup.seed);
    this.grid = new SpatialGrid(this.size, 4);
    for (const s of setup.slots) {
      const [x, y] = gameData.map.starts[s.start]!.heroSpawn;
      this.spawnHero(s.index, s.heroType, s.index, s.team, s.color, s.start, x, y);
    }
    this.camps = setup.noCamps ? [] : createCamps(this);
    this.factions = world ? new Factions(this, world.terrain, world.trees) : null;
    if (setup.testUnits) this.spawnTestUnits(setup.testUnits, setup.testArea ?? 'bases');
  }

  get(id: number): SimEntity | undefined {
    return this.byId.get(id);
  }

  /**
   * A hero with its own command slot: a player's hero (slot = player slot) or a faction's own
   * hero (slot = FACTION_HERO_SLOT + player slot, played by a hero bot).
   */
  spawnHero(slot: number, type: number, owner: number, team: number, color: number, start: number, x: number, y: number): SimEntity {
    const hero = this.spawn(type, owner, team, color, x, y);
    const def = gameData.heroes.find((h) => h.id === ENTITY_TYPES[type])!;
    hero.heroState = {
      def,
      slot,
      start,
      home: [x, y],
      xp: 0,
      level: 1,
      skillPoints: 1,
      gold: R.gold.startGold,
      respawnAt: 0,
      abilityLevels: [0, 0, 0, 0],
      inventory: emptyInventory(),
      itemCooldowns: new Map(),
      revive: null,
      stats: { kills: 0, deaths: 0, goldEarned: 0, camps: 0 },
    };
    this.heroes[slot] = hero;
    this.lastSeq[slot] = 0;
    this.lastSeqTick[slot] = 0;
    this.predictionSeq[slot] = 0;
    this.predictionTick[slot] = 0;
    return hero;
  }

  /** The hero that gets the gold and the kill: the killer itself, a summon's hero, else its player's hero. */
  creditHero(killer: DamageSource): SimEntity | null {
    const k = this.byId.get(killer.id);
    if (k?.heroState) return k;
    const leader = k?.leaderId ? this.byId.get(k.leaderId) : undefined;
    if (leader?.heroState) return leader;
    return killer.owner < FACTION_HERO_SLOT ? (this.heroes[killer.owner] ?? null) : null;
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
      itemOrder: null,
      inert: false,
      skipNeutrals: false,
      speedCap: 0,
      hired: false,
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

  /** Invisible to this team (Smoke Bomb, wards), and not revealed? */
  isHiddenFrom(e: SimEntity, team: number): boolean {
    return hiddenFrom(e, team);
  }

  /** Attacking, casting or using an item ends Smoke Bomb. */
  breakInvisible(e: SimEntity): void {
    if (e.buffs.some((b) => b.breaksOnAct)) {
      e.buffs = e.buffs.filter((b) => !b.breaksOnAct);
      this.refreshStats(e);
    }
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
    if (isItemCommand(cmd)) return itemCommandProblem(this, hero, cmd) === null;
    if (cmd.type === CommandType.BuyUpgrade) return upgradeProblem(this, hero, cmd.upgrade) === null;
    if (cmd.type === CommandType.Hire) return hireProblem(this, hero, cmd.unit) === null;
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
      case CommandType.Follow: {
        const t = this.byId.get(cmd.target);
        return !!t && t !== hero && t.alive && !t.hidden && !t.building && t.team === hero.team && this.canSee(hero.team, t);
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

  /** Why an item command would be refused right now (for tests). */
  itemCheck(slot: number, cmd: GameCommand): string | null {
    const hero = this.heroes[slot];
    return hero ? itemCommandProblem(this, hero, cmd) : 'no hero';
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
    // Buying, selling, potions... do not stop what the hero is doing. Checked again here:
    // the hero may have died, moved away or spent the gold since the command came in.
    if (isInstantItemCommand(e, cmd)) {
      if (!itemCommandProblem(this, e, cmd)) runInstantItemCommand(this, e, cmd);
      return;
    }
    // Town Hall upgrades are instant too (checked again: gold or range may have changed).
    if (cmd.type === CommandType.BuyUpgrade) {
      if (!upgradeProblem(this, e, cmd.upgrade)) buyUpgrade(this, e, cmd.upgrade);
      return;
    }
    if (cmd.type === CommandType.Hire) {
      if (!hireProblem(this, e, cmd.unit)) hire(this, e, cmd.unit);
      return;
    }
    // A new order stops a cast, a channel or an item order that has not happened yet.
    if (e.cast) endCast(this, e);
    if (e.itemOrder) endItemOrder(this, e);
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
      case CommandType.Follow:
        e.order = 'follow';
        e.orderTarget = cmd.target;
        e.targetId = 0;
        e.repathAt = 0;
        e.mover.path = [];
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
      case CommandType.UseItem:
      case CommandType.PickUp:
      case CommandType.GiveItem:
      case CommandType.DropItem:
        if (itemCommandProblem(this, e, cmd)) break;
        orderItem(this, e, cmd);
        e.repathAt = 0;
        break;
    }
  }

  /** Makes a hero walk back to its start spot (the player left). Not a player command. */
  sendHome(slot: number): void {
    const hero = this.heroes[slot];
    if (!hero?.heroState || !hero.alive) return;
    const [x, y] = hero.heroState.home;
    this.runCommand(hero, { type: CommandType.Move, x, y, queue: false });
  }

  // ---------- the tick ----------

  step(): void {
    this.tick++;
    this.events.clear();
    for (const q of this.queue) {
      const hero = this.heroes[q.slot];
      const deadOk = q.cmd?.type === CommandType.Learn || q.cmd?.type === CommandType.SwapItems;
      if (hero && q.cmd && (hero.alive || deadOk)) this.runCommand(hero, q.cmd);
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
        if (e.itemOrder) endItemOrder(this, e);
        continue;
      }
      if (e.inert) continue;
      if (e.passive) {
        if (e.thinkAt <= this.tick) this.wander(e);
        continue;
      }
      const taunt = this.tauntOf(e);
      if (taunt) {
        if (e.cast) endCast(this, e);
        if (e.itemOrder) endItemOrder(this, e);
        e.targetId = taunt;
      } else if (e.order === 'cast') {
        updateCast(this, e);
        continue;
      } else if (e.order === 'item') {
        updateItemOrder(this, e);
        continue;
      } else if (e.camp < 0) {
        // A worker with a job only fights when it was ordered to (the brain decides).
        if (e.job && e.job.kind !== 'idle' && e.order === 'idle') continue;
        this.think(e);
        // Army units and hired soldiers use their skills too (the Cleric's Mend).
        if (!e.hero) monsterCast(this, e);
      } else monsterCast(this, e);
      if (e.targetId) this.engage(e);
    }
    this.factions?.update();
    this.ai?.update();
    for (const e of this.entities) {
      const px = e.mover.x,
        py = e.mover.y;
      const frozen =
        !e.alive ||
        e.hidden ||
        e.building ||
        e.forced ||
        (e.swing === 1 && e.targetId !== 0) ||
        this.isStunned(e) ||
        this.isRooted(e) ||
        (e.cast && e.cast.castEnd > 0) ||
        (e.itemOrder && e.itemOrder.channelEnd > 0);
      if (!frozen) {
        e.mover.speed = e.speedCap > 0 && e.speedCap < e.stats.moveSpeed ? e.speedCap : e.stats.moveSpeed;
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
    if (e.targetId && (!target || !target.alive)) {
      e.targetId = 0;
      // A wind-up on a dead target is over; a unit in a swing does not walk.
      e.swing = 0;
    }
    const due = (this.tick + e.id) % THINK_EVERY === 0;
    if (e.hired) return this.followHired(e, due);
    if (e.leaderId) return this.followLeader(e, due);
    switch (e.order) {
      case 'follow': {
        const ally = this.byId.get(e.orderTarget);
        e.targetId = 0;
        if (!ally?.alive || ally.hidden || ally.team !== e.team || !this.canSee(e.team, ally)) {
          e.order = 'idle';
          e.mover.path = [];
          break;
        }
        const gap = e.stats.radius + ally.stats.radius + 1;
        if (Math.hypot(ally.mover.x - e.mover.x, ally.mover.y - e.mover.y) <= gap) e.mover.path = [];
        else if (this.tick >= e.repathAt) {
          applyMove(e.mover, this.nav, ally.mover.x, ally.mover.y, false, this.isFlying(e));
          e.repathAt = this.tick + 10;
        }
        break;
      }
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
        if (!e.targetId && due) e.targetId = this.acquire(e, ACQUIRE_RANGE, !e.skipNeutrals);
        else if (e.targetId && due) this.betterTarget(e, !e.skipNeutrals);
        if (!e.targetId && !e.mover.path.length) {
          if (Math.hypot(e.orderX - e.mover.x, e.orderY - e.mover.y) > 1) {
            applyMove(e.mover, this.nav, e.orderX, e.orderY, false, this.isFlying(e));
            // No way there (a full search costs several ms): stop, do not search again every tick.
            if (!e.mover.path.length) e.order = 'idle';
          } else e.order = 'idle';
        }
        break;
      case 'hold':
        if (!e.targetId && due) e.targetId = this.acquire(e, e.stats.attackRange + e.stats.radius + 0.6, false);
        break;
      case 'idle':
      case 'cast':
        if (!e.targetId && due) e.targetId = this.acquire(e, ACQUIRE_RANGE, false);
        else if (e.targetId && due) this.betterTarget(e, false);
        break;
    }
  }

  /**
   * A faction unit that hits a building or a worker turns to an enemy that fights back when one
   * comes close (catapults stay on buildings). Before, an army kept hitting a tower while enemy
   * units killed it.
   */
  private betterTarget(e: SimEntity, takeNeutrals: boolean): void {
    if (e.hero || e.type === CATAPULT_TYPE || !this.factions?.factionOf(e)) return;
    const t = this.byId.get(e.targetId);
    if (!t || fightsBack(t)) return;
    const next = this.acquire(e, ACQUIRE_RANGE, takeNeutrals);
    const n = next ? this.byId.get(next) : undefined;
    if (n && fightsBack(n)) {
      e.targetId = next;
      e.swing = 0;
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

  /**
   * Hired soldiers: they pick their own targets and stay in their fight when the hero takes a
   * step; they leave a fight only when it is more than hire.leash from the hero, and walk back
   * to a spot near it. Without a hero (dead) they wait at its respawn point.
   */
  private followHired(e: SimEntity, due: boolean): void {
    const leader = this.byId.get(e.leaderId);
    if (!leader?.heroState) {
      // The hero is gone (its faction lost): an ordinary unit now.
      e.hired = false;
      e.leaderId = 0;
      return;
    }
    const alive = leader.alive;
    const lx = alive ? leader.mover.x : leader.heroState.home[0],
      ly = alive ? leader.mover.y : leader.heroState.home[1];
    if (e.targetId) {
      const t = this.byId.get(e.targetId)!;
      if (Math.hypot(t.mover.x - lx, t.mover.y - ly) <= HIRE.leash) return;
      e.targetId = 0;
      e.swing = 0;
      e.mover.path = [];
    }
    if (due) {
      // Neutral monsters only when the hero fights (it chose the camp).
      const fighting = alive && leader.targetId !== 0;
      const t = this.acquire(e, ACQUIRE_RANGE, fighting);
      const o = t ? this.byId.get(t) : undefined;
      if (o && Math.hypot(o.mover.x - lx, o.mover.y - ly) <= HIRE.leash) e.targetId = t;
      else if (fighting) {
        // Nothing near us: help the hero with its target.
        const lt = this.byId.get(leader.targetId);
        if (lt?.alive && canAttackLayer(e.stats.canHitAir, lt.stats.layer)) e.targetId = lt.id;
      }
      if (e.targetId) return;
    }
    // Each soldier has its own spot around the hero, so they do not stand in one heap.
    const a = e.id * 2.39996;
    const r = 2 + (e.id % 3);
    const px = lx + Math.cos(a) * r,
      py = ly + Math.sin(a) * r;
    const far = Math.hypot(lx - e.mover.x, ly - e.mover.y) > HIRE.followDistance;
    if ((far || !alive) && this.tick >= e.repathAt && Math.hypot(px - e.chaseX, py - e.chaseY) > 1.5) {
      e.chaseX = px;
      e.chaseY = py;
      e.repathAt = this.tick + 20;
      if (Math.hypot(px - e.mover.x, py - e.mover.y) > 1) this.moveTo(e, px, py);
    }
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
    // Faction units and towers: smarter choice (units that hit us, catapults on buildings, focus fire).
    const f = !e.hero && this.factions ? this.factions.factionOf(e) : null;
    if (f) return pickTarget(this, e, range, { focusFire: FOCUS_FIRE[f.difficulty], takeNeutrals });
    let best = 0,
      bestD = Infinity;
    this.grid.query(e.mover.x, e.mover.y, range, (o, d2) => {
      if (o === e || o.invulnerable || !this.isEnemy(e, o) || !canAttackLayer(e.stats.canHitAir, o.stats.layer) || hiddenFrom(o, e.team))
        return;
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
    // An enemy that turned invisible can not be attacked any more.
    if (!t || !t.alive || t.invulnerable || t.hidden || !canAttackLayer(e.stats.canHitAir, t.stats.layer) || hiddenFrom(t, e.team)) {
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
        this.breakInvisible(e);
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
    const miss = this.uphillMiss(e, t);
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
        miss,
      };
      this.projectiles.push(p);
      this.events.push(EventType.Projectile, e.id, t.id, p.speed, 0);
    } else if (miss) {
      this.missed(t, e);
    } else {
      this.applyAttack(e, t, raw, e.stats.attackType);
      // Flurry: sometimes a second hit right away.
      const extra = extraHitChance(e);
      if (extra && t.alive && this.rng.next() < extra) this.applyAttack(e, t, roll(), e.stats.attackType);
    }
  }

  /** Attacks from low ground up to high ground miss sometimes (ground units only). */
  private uphillMiss(e: SimEntity, t: SimEntity): boolean {
    if (this.isFlying(e) || this.isFlying(t)) return false;
    if (groundLevel(this.nav, t.mover.x, t.mover.y) - groundLevel(this.nav, e.mover.x, e.mover.y) < 0.5) return false;
    return this.rng.next() < R.combat.missChanceUphill;
  }

  /** A missed attack: no damage, but the target still notices who shot at it. */
  private missed(t: SimEntity, source: DamageSource): void {
    this.events.push(EventType.Damage, t.id, source.id, 0, DamageKind.Miss);
    if (t.camp >= 0) onCampMemberAttacked(this, t, source);
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
      miss: false,
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
        else if (p.miss) this.missed(t, p.source);
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
    const s = this.byId.get(source.id);
    if (!s) return;
    // Life steal: Crimson Pact aura and Vampire Fang.
    if (s.alive && dealt > 0) {
      const ls = sumBuffs(s.buffs, 'lifeStealPct') + (s.heroState ? (itemBonus(s.heroState.inventory).lifeStealPct ?? 0) : 0);
      if (ls > 0) this.heal(s, (dealt * ls) / 100, source);
    }
    // Frost Orb slow, Storm Hammer lightning.
    if (s.heroState) itemsOnHit(this, s, t);
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

  /** Base stats (level + items) + buffs. Health and mana grow when the max grows. */
  refreshStats(e: SimEntity): void {
    if (e.heroState) e.base = heroStats(e.heroState.def, e.heroState.level, itemBonus(e.heroState.inventory));
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
    if (e.itemOrder) endItemOrder(this, e);
    e.buffs = [];
    this.events.push(EventType.Death, e.id, killer.id);
    if (!e.summonUntil || killer.id !== e.id) this.reward(e, killer);
    if (e.heroState) {
      const hs = e.heroState;
      hs.stats.deaths++;
      const killerHero = this.creditHero(killer);
      if (killerHero?.heroState && killer.team !== e.team) killerHero.heroState.stats.kills++;
      // Phoenix Feather: back soon, where the hero fell. The death still counts (bounty, gold loss).
      const feather = takeRevive(hs);
      hs.revive = feather ? { x: e.mover.x, y: e.mover.y, hpPct: feather.reviveHpPct } : null;
      hs.respawnAt = this.tick + secs(feather ? feather.reviveDelaySec : respawnSeconds(hs.level));
      hs.gold = Math.max(0, hs.gold - deathGoldLoss(hs.level));
      if (feather) this.refreshStats(e);
    } else {
      e.removeAt = this.tick + CORPSE_TICKS;
    }
    if (e.camp >= 0) onCampMemberDied(this, e, killer);
    if (this.factions) this.factions.onDeath(e);
  }

  /** Gold for the last hit (and allies near), XP for enemy heroes near the death. */
  private reward(victim: SimEntity, killer: DamageSource): void {
    const victimLevel = victim.heroState?.level ?? victim.stats.level;
    const killerHero = this.creditHero(killer);
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
    hero.heroState.stats.goldEarned += amount;
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
    for (let i = this.groundItems.length - 1; i >= 0; i--) if (this.tick >= this.groundItems[i]!.until) this.groundItems.splice(i, 1);
    // Passive income: 1 gold per second for every hero, alive or not.
    if (this.tick % TICK_RATE === 0) for (const h of this.heroes) if (h?.heroState) h.heroState.gold += R.gold.passiveIncomePerSec;
  }

  private respawn(e: SimEntity): void {
    const hs = e.heroState!;
    const rv = hs.revive;
    const [x, y] = rv ? [rv.x, rv.y] : hs.home;
    hs.respawnAt = 0;
    hs.revive = null;
    e.alive = true;
    e.buffs = [];
    this.refreshStats(e);
    // Passives (Dragon Scales) come back with the hero.
    refreshPassives(this, e);
    // A revive keeps the mana the hero had; a normal respawn is fresh.
    e.hp = rv ? Math.max(1, (e.stats.maxHp * rv.hpPct) / 100) : e.stats.maxHp;
    if (!rv) e.mana = e.stats.maxMana;
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
    // Fountains of Life heal everyone near them, but not neutral monsters.
    const F = R.fountain;
    for (const f of gameData.map.fountains) {
      this.grid.query(f.pos[0], f.pos[1], f.radius + 1, (o) => {
        if (!o.alive || o.team === NEUTRAL_TEAM || o.inert) return;
        if (Math.hypot(o.mover.x - f.pos[0], o.mover.y - f.pos[1]) > f.radius + o.stats.radius) return;
        o.hp = Math.min(o.stats.maxHp, o.hp + o.stats.maxHp * (F.hpPctPerSec / 100) * TICK_DT);
        o.mana = Math.min(o.stats.maxMana, o.mana + o.stats.maxMana * (F.manaPctPerSec / 100) * TICK_DT);
      });
    }
  }

  // ---------- items on the ground ----------

  groundItem(id: number): GroundItem | undefined {
    return this.groundItems.find((g) => g.id === id);
  }

  removeGroundItem(id: number): void {
    const i = this.groundItems.findIndex((g) => g.id === id);
    if (i >= 0) this.groundItems.splice(i, 1);
  }

  /** Puts an item on the ground (on open ground near the point). It vanishes after 3 minutes. */
  dropOnGround(item: number, charges: number, x: number, y: number): GroundItem {
    const [px, py] = nearestWalkable(this.nav, x, y, 6) ?? [x, y];
    do this.lastGroundId = nextGroundId(this.lastGroundId);
    while (this.groundItem(this.lastGroundId));
    const g: GroundItem = { id: this.lastGroundId, item, charges, x: px, y: py, until: this.tick + GROUND_ITEM_TICKS };
    this.groundItems.push(g);
    return g;
  }

  /** Units do not stand inside each other: push overlapping ground units apart. Heroes are not pushed. */
  private separate(): void {
    for (const e of this.entities) {
      if (!e.alive || e.hero || e.inert || e.forced || e.building || e.stats.layer !== 'ground') continue;
      const r = e.stats.radius;
      this.grid.query(e.mover.x, e.mover.y, r + 0.8, (o, d2) => {
        if (o === e || !o.alive || o.inert || o.building || o.stats.layer !== 'ground') return;
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
