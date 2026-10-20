// The match simulation: entities, orders, combat and one fixed tick.
// Runs on the server (in the match worker). Plain logic: no network, no timers, no DOM.
// Phase 7a: attacks, projectiles, death and respawn, neutral camps, bounty, XP and levels.
// Abilities and buffs come in 7b, items and shops in 7c.

import { gameData, type HeroDef } from '../data/index';
import { findPath, nearestWalkable, type NavGrid } from '../nav/nav-grid';
import { createCamps, updateCamps, onCampMemberAttacked, onCampMemberDied, type CampState } from './camps';
import { applyMove, CommandType, type GameCommand } from './commands';
import { entityTypeIndex, ENTITY_TYPES, isHeroType } from './entity-types';
import { DamageKind, EventList, EventType } from './events';
import { createMover, stepMover, type Mover } from './movement';
import { Rng } from './rng';
import { SpatialGrid } from './spatial-grid';
import {
  attackDamage,
  canAttackLayer,
  deathGoldLoss,
  heroKillBounty,
  heroStats,
  levelForXp,
  neutralXpFactor,
  respawnSeconds,
  unitStats,
  xpForKillingHero,
  xpForKillingUnit,
  type CombatStats,
} from './stats';

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

export interface MatchSlot {
  index: number;
  /** entity type index of the hero, see entity-types.ts */
  heroType: number;
  team: number;
  color: number;
  /** start spot index in the map layout */
  start: number;
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

export type OrderKind = 'idle' | 'move' | 'attack' | 'attackMove' | 'hold';

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
  stats: CombatStats;
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
}

interface QueuedCommand {
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
  readonly events = new EventList();
  readonly camps: CampState[];
  readonly grid: SpatialGrid<SimEntity>;
  readonly rng: Rng;
  /** Can this team see the entity? Set by the server from its vision; used to check commands. */
  canSee: (team: number, e: SimEntity) => boolean = () => true;
  private readonly byId = new Map<number, SimEntity>();
  private readonly queue: QueuedCommand[] = [];
  private readonly projectiles: Projectile[] = [];
  private nextId = 1;
  private nextProjectile = 1;
  readonly size = gameData.map.size.width;

  constructor(
    readonly setup: MatchSetup,
    readonly nav: NavGrid,
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
    }
    this.camps = setup.noCamps ? [] : createCamps(this);
    if (setup.testUnits) this.spawnTestUnits(setup.testUnits, setup.testArea ?? 'bases');
  }

  get(id: number): SimEntity | undefined {
    return this.byId.get(id);
  }

  spawn(type: number, owner: number, team: number, color: number, x: number, y: number, facing?: number): SimEntity {
    const stats = isHeroType(type)
      ? heroStats(
          gameData.heroes.find((h) => h.id === ENTITY_TYPES[type])!,
          1,
        )
      : unitStats(gameData.units.find((u) => u.id === ENTITY_TYPES[type])!);
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
      stats,
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
    };
    this.entities.push(e);
    this.byId.set(e.id, e);
    return e;
  }

  isFlying(e: SimEntity): boolean {
    return e.stats.layer !== 'ground';
  }

  isEnemy(a: { team: number }, b: { team: number }): boolean {
    return a.team !== b.team;
  }

  // ---------- commands ----------

  /**
   * Queues a command. It runs at the start of the next tick. Returns false (and drops it) when
   * it is not valid; the sequence number still counts as processed.
   */
  queueCommand(slot: number, seq: number, cmd: GameCommand): boolean {
    const ok = this.isValid(slot, cmd);
    this.queue.push({ slot, seq, cmd: ok ? cmd : null });
    return ok;
  }

  private isValid(slot: number, cmd: GameCommand): boolean {
    const hero = this.heroes[slot];
    if (!hero || !hero.alive) return false;
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
      case CommandType.Stop:
      case CommandType.Hold:
        return true;
    }
    return false;
  }

  private runCommand(e: SimEntity, cmd: GameCommand): void {
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
      if (hero && q.cmd && hero.alive) this.runCommand(hero, q.cmd);
      this.lastSeq[q.slot] = q.seq;
      this.lastSeqTick[q.slot] = this.tick;
    }
    this.queue.length = 0;

    this.grid.rebuild(this.entities, (e) => e.alive);
    updateCamps(this);
    for (const e of this.entities) {
      if (!e.alive) continue;
      if (e.passive) {
        if (e.thinkAt <= this.tick) this.wander(e);
      } else {
        if (e.camp < 0) this.think(e);
        if (e.targetId) this.engage(e);
      }
    }
    for (const e of this.entities) {
      const px = e.mover.x,
        py = e.mover.y;
      if (e.alive && e.swing !== 1) {
        e.mover.speed = e.stats.moveSpeed;
        stepMover(e.mover, TICK_DT);
      }
      e.vx = (e.mover.x - px) / TICK_DT;
      e.vy = (e.mover.y - py) / TICK_DT;
    }
    this.separate();
    this.stepProjectiles();
    this.regen();
    this.lifeAndDeath();
  }

  // ---------- orders and targets ----------

  /** Player-owned units: follow the order and pick targets. */
  private think(e: SimEntity): void {
    const target = e.targetId ? this.byId.get(e.targetId) : undefined;
    if (e.targetId && (!target || !target.alive)) e.targetId = 0;
    const due = (this.tick + e.id) % THINK_EVERY === 0;
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
        if (!e.targetId && due) e.targetId = this.acquire(e, ACQUIRE_RANGE, false);
        break;
    }
  }

  /**
   * Nearest enemy in range. Like classic RTS games, idle units do not start fights with neutral
   * monsters, only with monsters that already fight their team (attack-move takes anything).
   */
  acquire(e: SimEntity, range: number, takeNeutrals: boolean): number {
    let best = 0,
      bestD = Infinity;
    this.grid.query(e.mover.x, e.mover.y, range, (o, d2) => {
      if (o === e || !this.isEnemy(e, o) || !canAttackLayer(e.stats.canHitAir, o.stats.layer)) return;
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

  /** Attack the current target: chase it, turn to it, swing, hit. */
  engage(e: SimEntity): void {
    const t = this.byId.get(e.targetId);
    if (!t || !t.alive || !canAttackLayer(e.stats.canHitAir, t.stats.layer)) {
      e.targetId = 0;
      e.swing = 0;
      return;
    }
    const dx = t.mover.x - e.mover.x,
      dy = t.mover.y - e.mover.y;
    const d = Math.hypot(dx, dy);
    const range = e.stats.attackRange + e.stats.radius + t.stats.radius;
    if (e.swing === 1) {
      if (d > range + 2)
        e.swing = 0; // it got away during the wind-up
      else if (this.tick >= e.swingEnd) this.hit(e, t);
      return;
    }
    if (d <= range) {
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
    if (e.order === 'hold') {
      e.targetId = 0;
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
    const raw = this.rng.int(Math.round(e.stats.damageMin), Math.round(e.stats.damageMax));
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
      this.events.push(EventType.Projectile, e.id, t.id, p.speed, p.id);
    } else {
      this.applyAttack(e, t, raw, e.stats.attackType);
    }
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
        this.applyAttack(p.source, t, p.raw, p.attackType);
        continue;
      }
      p.x += (dx / d) * stepLen;
      p.y += (dy / d) * stepLen;
      this.projectiles[w++] = p;
    }
    this.projectiles.length = w;
  }

  /** Attack damage: damage type and armor count. */
  applyAttack(source: DamageSource, t: SimEntity, raw: number, type: CombatStats['attackType']): void {
    this.damage(t, attackDamage(raw, type, t.stats.armorType, t.stats.armor), source, DamageKind.Attack);
  }

  damage(t: SimEntity, amount: number, source: DamageSource, kind: number): void {
    if (!t.alive || amount <= 0) return;
    t.hp -= amount;
    t.lastHitBy = source.id;
    this.events.push(EventType.Damage, t.id, source.id, Math.round(amount), kind);
    if (t.camp >= 0) onCampMemberAttacked(this, t, source);
    else if (!t.targetId && t.order === 'idle' && !t.passive) {
      // Hit while standing around: hit back.
      const s = this.byId.get(source.id);
      if (s && s.alive && canAttackLayer(t.stats.canHitAir, s.stats.layer)) t.targetId = s.id;
    }
    if (t.hp <= 0) this.kill(t, source);
  }

  heal(t: SimEntity, amount: number, source: DamageSource): void {
    if (!t.alive || amount <= 0) return;
    const before = t.hp;
    t.hp = Math.min(t.stats.maxHp, t.hp + amount);
    if (t.hp > before) this.events.push(EventType.Damage, t.id, source.id, Math.round(t.hp - before), DamageKind.Heal);
  }

  // ---------- death, rewards, levels ----------

  private kill(e: SimEntity, killer: DamageSource): void {
    e.alive = false;
    e.hp = 0;
    e.mover.path = [];
    e.swing = 0;
    e.targetId = 0;
    e.order = 'idle';
    this.events.push(EventType.Death, e.id, killer.id);
    this.reward(e, killer);
    if (e.heroState) {
      const hs = e.heroState;
      hs.respawnAt = this.tick + secs(respawnSeconds(hs.level));
      hs.gold = Math.max(0, hs.gold - deathGoldLoss(hs.level));
    } else {
      e.removeAt = this.tick + CORPSE_TICKS;
    }
    if (e.camp >= 0) onCampMemberDied(this, e);
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

  /** New level or items: recompute stats, keep the same share of health and mana. */
  refreshStats(e: SimEntity): void {
    if (!e.heroState) return;
    const old = e.stats;
    const next = heroStats(e.heroState.def, e.heroState.level);
    e.hp += next.maxHp - old.maxHp;
    e.mana += next.maxMana - old.maxMana;
    e.stats = next;
  }

  private lifeAndDeath(): void {
    let w = 0;
    for (const e of this.entities) {
      const hs = e.heroState;
      if (!e.alive && hs && hs.respawnAt && this.tick >= hs.respawnAt) this.respawn(e);
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
    e.hp = e.stats.maxHp;
    e.mana = e.stats.maxMana;
    e.mover.x = x;
    e.mover.y = y;
    e.mover.path = [];
    e.order = 'idle';
    e.lastHitBy = 0;
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
      if (!e.alive || e.hero || e.stats.layer !== 'ground') continue;
      const r = e.stats.radius;
      this.grid.query(e.mover.x, e.mover.y, r + 0.8, (o, d2) => {
        if (o === e || !o.alive || o.stats.layer !== 'ground') return;
        const min = r + o.stats.radius;
        if (d2 >= min * min) return;
        const d = Math.sqrt(d2) || 0.01;
        const push = (min - d) * (o.hero ? 1 : 0.5);
        const nx = e.mover.x + ((e.mover.x - o.mover.x) / d) * push,
          ny = e.mover.y + ((e.mover.y - o.mover.y) / d) * push;
        const c = Math.floor(nx / this.nav.cellSize),
          rr = Math.floor(ny / this.nav.cellSize);
        if (this.nav.walk[rr * this.nav.cols + c]) {
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
