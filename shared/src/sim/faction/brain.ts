// The faction AI ("brain"): one per faction, on the server only. It thinks a few times per second
// and plays the faction like a player would: workers on gold and wood, houses before supply runs
// out, the build order from ai.json, production with the unit mix of its tier, one army that
// gathers, attacks, retreats and defends, and the natural expansion. Rules: docs/design/FACTION.md.
//
// FactionAI holds all brains, the shared ArmyMover and the hero bots of Bot slots. MatchSim calls
// its update() once per tick (sim.ai), before units move.

import { gameData, type BuildingDef } from '../../data/index';
import { nearestWalkable } from '../../nav/nav-grid';
import { ENTITY_TYPES, entityTypeIndex, footprintOf } from '../entity-types';
import { HeroBot, type BotDifficulty } from '../hero-bot';
import { FACTION_HERO_SLOT, NEUTRAL_TEAM, TICK_RATE, type MatchSim, type SimEntity } from '../match-sim';
import { ArmyMover, roleOf, type ArmyGroup } from './army';
import { isTownHall, unitDef, type Difficulty, type Factions, type FactionState } from './faction';
import { baseCorridors, findBuildSpot, type Rect } from './placement';

interface DifficultyRules {
  thinkDelaySec: number;
  workerTarget: number;
  maxProductionBuildings: number;
  firstAttackArmySupply: number;
  attackArmySupply: number;
  retreatAtArmyPct: number;
  expandAtMinute: number | null;
  towersAtBase: number;
  targetChoice: 'closest' | 'closest_or_weakest' | 'weakest_or_where_our_hero_fights';
  focusFire: boolean;
  pullWoundedUnits: boolean;
  buildOrderDelaySec: number;
}

interface Step {
  do: 'build' | 'train' | 'upgrade' | 'expand' | 'summon';
  what: string;
  count?: number;
}

const AI = gameData.ai.faction as unknown as {
  difficulties: Record<Difficulty, DifficultyRules>;
  buildOrder: Step[];
  unitMix: Record<'tier1' | 'tier2' | 'tier3', Record<string, number>>;
  attack: { gatherPointDistance: number; waitForStragglersSec: number; retargetEverySec: number; creepCampsWhenIdle: boolean };
};
const ARMY = gameData.ai.faction.army;
const HERO_RULES = gameData.ai.faction.factionHero;

export function difficultyRules(d: Difficulty): DifficultyRules {
  return AI.difficulties[d];
}

const COLOR_NAMES = ['Red', 'Blue', 'Teal', 'Purple'];
const PRODUCTION = new Set(['barracks', 'archery_range', 'chapel', 'workshop', 'hawk_roost']);
const WOOD_SHARE = 0.3;
/** wood is plenty above this (and more than gold): fewer woodcutters */
const WOOD_PLENTY = 400;
/** a mine takes about this many workers before they wait at the door */
const MAX_GOLD_WORKERS_PER_MINE = 12;
/** a mine belongs to a Town Hall this close */
const MINE_TO_HALL = 16;
/** enemies this close to a Town Hall mean the base is under attack */
const BASE_RADIUS = 24;
/** free supply under this: build a House */
const HOUSE_AT_FREE_SUPPLY = 6;
/** keep this much army supply at home after the first attack */
const DEFENSE_SUPPLY = 4;
const BUILD_RADIUS_EXPANSION = 12;
const WOUNDED_PCT = 0.25;
const MILITIA_HALL_PCT = 0.3;
const REINFORCE_SUPPLY = 6;
/** always rebuild at least this many workers, even while saving */
const MIN_WORKERS = 5;
/** gold left in our mines under this: time for a new Town Hall */
const LOW_GOLD = 5000;
/** gold left under this: the Town Hall money is kept even under attack */
const URGENT_GOLD = 3000;
/** army supply that can clear the camp on an expansion spot */
const CLEAR_SUPPLY = 12;
/** roaming armies leave camps this close to an enemy Town Hall alone */
const ENEMY_BASE_KEEP_OUT = 35;
/** a hunt for an enemy army ends after this long */
const HUNT_MAX_SEC = 40;
const FIELD_FIGHT_GAP_SEC = 20;
/** enemy units of at least this much supply count as an army (heroes alone do not) */
const ARMY_MIN_SUPPLY = 4;
/** gold that counts as rich (a maxed army keeps attacking instead of retreating) */
const RICH_GOLD = 400;
/** the army's middle this close to its goal: the faction hero goes to the goal itself */
const HERO_TO_GOAL = 16;
/** at an enemy base the army walks to a Town Hall this much farther than the nearest building */
const HALL_BONUS = 15;
/** a reinforcement wave this close to the attack army joins it */
const WAVE_JOIN = 15;

function supplyOf(e: SimEntity): number {
  return unitDef(ENTITY_TYPES[e.type]!)?.supply ?? 0;
}

/** A hero counts like this much army supply. */
function heroStrength(hero: SimEntity): number {
  return 2 + hero.heroState!.level;
}

function buildingDef(id: string): BuildingDef | undefined {
  return gameData.buildings.buildings.find((b) => b.id === id);
}

/** Snaps a center to the 1-unit build grid of a footprint (odd sizes sit on .5). */
function snap(v: number, size: number): number {
  const off = Math.round(size) % 2 === 0 ? 0 : 0.5;
  return Math.round(v - off) + off;
}

type ArmyState = 'gather' | 'creep' | 'hunt' | 'attack' | 'retreat';

export class FactionBrain {
  /** for the status line */
  status = 'Starting';
  private readonly rules: DifficultyRules;
  private readonly thinkTicks: number;
  private readonly trained = new Map<string, number>();
  private lastStepAt = -Infinity;
  private home: SimEntity | null = null;
  private mineOfHall = new Map<number, number>();
  private readonly rally = { x: 0, y: 0 };
  private readonly center = { x: 0, y: 0 };
  private gather: ArmyGroup | null = null;
  private attack: ArmyGroup | null = null;
  /** reinforcements on their way to the attack army (they join it when they reach it) */
  private wave: ArmyGroup | null = null;
  private armyState: ArmyState = 'gather';
  private attacks = 0;
  private attackStartSupply = 0;
  private attackSlot = -1;
  private attackTargetId = 0;
  private retargetAt = 0;
  private readyAt = 0;
  private creepCamp = -1;
  /** no enemy faction left (a solo match): the army only roams */
  private noEnemy = false;
  private huntSlot = -1;
  private huntUntil = 0;
  private lastFieldFightAt = -Infinity;
  private homeShrineId = 0;
  private readonly heroPoint = { x: 0, y: 0 };
  private readonly waveCenter = { x: 0, y: 0 };
  private readonly enemy = { x: 0, y: 0, strength: 0, slot: -1 };
  /** where enemies are in our base, or null */
  threat: { x: number; y: number } | null = null;
  private readonly threatPoint = { x: 0, y: 0 };
  private readonly militia = new Set<number>();
  private expanded = false;
  private savingFor = '';
  /** the price of what we save for (the reserve is dropped while defending; the status keeps it) */
  private savingGold = 0;
  private reserveGold = 0;
  private reserveWood = 0;
  private doing = '';
  /** our mines are nearly empty: the next Town Hall comes before everything */
  private urgent = false;

  constructor(
    private readonly sim: MatchSim,
    private readonly fs: Factions,
    readonly f: FactionState,
    private readonly army: ArmyMover,
  ) {
    this.rules = difficultyRules(f.difficulty);
    this.thinkTicks = Math.max(1, Math.round(this.rules.thinkDelaySec * TICK_RATE));
  }

  /** Where the army attacks now (for the hero bot), or null. */
  armyTarget(): { x: number; y: number } | null {
    const g = this.attack;
    return g && this.armyState === 'attack' ? { x: g.targetX, y: g.targetY } : null;
  }

  update(): void {
    const f = this.f;
    if (f.defeated) {
      this.status = 'Defeated';
      f.status = this.status;
      return;
    }
    if ((this.sim.tick + f.slot) % this.thinkTicks !== 0) return;
    this.think();
  }

  private think(): void {
    const f = this.f;
    this.findHome();
    if (!this.home) return;
    this.doing = '';
    this.savingFor = '';
    this.reserveGold = this.reserveWood = 0;
    this.findThreat();
    this.expansion();
    this.workers();
    this.houses();
    this.heroThink();
    this.buildOrder();
    // Under attack the army comes first: savings may be spent on units.
    if (this.threat && !this.urgent) this.reserveGold = this.reserveWood = 0;
    this.production();
    this.armyThink();
    f.status = this.status = this.statusLine();
  }

  // ---------- base ----------

  private findHome(): void {
    const halls = this.fs.halls(this.f);
    const home = this.sim.get(this.f.homeHallId);
    this.home = home?.alive ? home : (halls.find((h) => h.building!.done) ?? halls[0] ?? null);
    if (!this.home) return;
    const h = this.home;
    const c = this.sim.size / 2;
    const dx = c - h.mover.x,
      dy = c - h.mover.y;
    const d = Math.hypot(dx, dy) || 1;
    const p = nearestWalkable(
      this.sim.nav,
      h.mover.x + (dx / d) * AI.attack.gatherPointDistance,
      h.mover.y + (dy / d) * AI.attack.gatherPointDistance,
      10,
    );
    this.rally.x = p?.[0] ?? h.mover.x;
    this.rally.y = p?.[1] ?? h.mover.y;
    // A mine for every finished hall (the nearest one with gold).
    this.mineOfHall.clear();
    for (const hall of halls) {
      if (!hall.building!.done) continue;
      const mine = this.fs.nearestMine(hall.mover.x, hall.mover.y);
      if (mine && Math.hypot(mine.mover.x - hall.mover.x, mine.mover.y - hall.mover.y) < MINE_TO_HALL)
        this.mineOfHall.set(hall.id, mine.id);
    }
  }

  private count(id: string, sitesToo = true): number {
    let n = 0;
    for (const bid of this.f.buildings) {
      const b = this.sim.get(bid);
      if (b?.alive && b.building?.def?.id === id && (sitesToo || b.building.done)) n++;
    }
    return n;
  }

  private siteOf(id: string): SimEntity | null {
    for (const bid of this.f.buildings) {
      const b = this.sim.get(bid);
      if (b?.alive && b.building?.def?.id === id && !b.building.done) return b;
    }
    return null;
  }

  private findThreat(): void {
    this.threat = null;
    const halls = this.fs.halls(this.f);
    let best = Infinity;
    for (const e of this.sim.entities) {
      if (!e.alive || e.team === this.f.team || e.team === NEUTRAL_TEAM || e.building || e.hidden || !this.sim.canSee(this.f.team, e))
        continue;
      // A worker passing by (chopping, building) is no attack; one that fights is.
      if (e.job && !e.targetId) continue;
      for (const h of halls) {
        const d = Math.hypot(e.mover.x - h.mover.x, e.mover.y - h.mover.y);
        if (d < BASE_RADIUS && d < best) {
          best = d;
          // On a 4-unit grid, so the defense goal (and its flow field) does not change every think.
          this.threatPoint.x = Math.round(e.mover.x / 4) * 4;
          this.threatPoint.y = Math.round(e.mover.y / 4) * 4;
          this.threat = this.threatPoint;
        }
      }
    }
  }

  // ---------- economy ----------

  private workers(): void {
    const f = this.f;
    const sim = this.sim;
    let workers = 0,
      onWood = 0;
    const goldOn = new Map<number, number>();
    const idle: SimEntity[] = [];
    for (const id of f.units) {
      const u = sim.get(id);
      if (!u?.alive || !u.job) continue;
      workers++;
      if (this.militia.has(u.id)) continue;
      const j = u.job;
      if (j.kind === 'wood') onWood++;
      else if (j.kind === 'gold') {
        const mine = sim.get(j.target);
        if (!mine?.alive) idle.push(u);
        else goldOn.set(j.target, (goldOn.get(j.target) ?? 0) + 1);
      } else if (j.kind === 'idle' && !u.targetId) idle.push(u);
    }
    let queued = 0;
    for (const h of this.fs.halls(f)) for (const t of h.building!.queue) if (ENTITY_TYPES[t] === 'worker') queued++;

    // Train workers at every finished hall with an empty queue (not while saving for a new hall).
    if (workers + queued < this.rules.workerTarget && (this.savingFor !== 'Town Hall' || workers + queued < MIN_WORKERS))
      for (const h of this.fs.halls(f)) {
        if (!h.building!.done || h.building!.queue.length || h.building!.upgradeTo >= 0) continue;
        if (workers + queued >= this.rules.workerTarget) break;
        if (this.fs.train(f, h, 'worker')) queued++;
      }

    // Militia: the Town Hall is almost down, the half of the workers nearest the fight joins it
    // (the other half keeps the money coming, to rebuild).
    const home = this.home!;
    if (this.threat && home.hp < home.stats.maxHp * MILITIA_HALL_PCT && this.militia.size < Math.ceil(workers / 2)) {
      const threat = this.threat;
      const near: SimEntity[] = [];
      for (const id of f.units) {
        const u = sim.get(id);
        if (!u?.alive || !u.job || u.hidden || this.militia.has(u.id)) continue;
        if (Math.hypot(u.mover.x - home.mover.x, u.mover.y - home.mover.y) > BASE_RADIUS) continue;
        near.push(u);
      }
      near.sort((a, b) => Math.hypot(a.mover.x - threat.x, a.mover.y - threat.y) - Math.hypot(b.mover.x - threat.x, b.mover.y - threat.y));
      for (const u of near) {
        if (this.militia.size >= Math.ceil(workers / 2)) break;
        this.fs.setJob(u, 'idle');
        u.order = 'attackMove';
        u.orderX = threat.x;
        u.orderY = threat.y;
        this.militia.add(u.id);
      }
    } else if (!this.threat && this.militia.size) {
      for (const id of this.militia) {
        const u = sim.get(id);
        if (u?.alive) idle.push(u);
      }
      this.militia.clear();
    }

    // Idle workers: wood up to its share, else the mine with the fewest workers.
    const woodShare =
      f.wood > WOOD_PLENTY && f.wood > f.gold * 2
        ? WOOD_SHARE / 3
        : f.gold > WOOD_PLENTY && f.gold > f.wood * 3
          ? WOOD_SHARE * 1.7
          : WOOD_SHARE;
    // Off balance (wood piled up, or woodcutters died): one worker changes job each think.
    const woodWant = Math.round(workers * woodShare);
    const from = onWood > woodWant + 1 && this.mineOfHall.size ? 'wood' : onWood < woodWant - 1 ? 'gold' : '';
    if (from)
      for (const id of f.units) {
        const u = sim.get(id);
        if (u?.alive && u.job?.kind === from && !u.job.carry && !u.hidden && !this.militia.has(id)) {
          if (from === 'gold') {
            this.fs.setJob(u, 'wood', -1);
            onWood++;
          } else {
            idle.push(u);
            onWood--;
          }
          break;
        }
      }
    for (const u of idle) {
      if (this.militia.has(u.id)) continue;
      let mineId = 0,
        fewest = MAX_GOLD_WORKERS_PER_MINE;
      for (const m of this.mineOfHall.values()) {
        const n = goldOn.get(m) ?? 0;
        if (n < fewest) {
          fewest = n;
          mineId = m;
        }
      }
      if (onWood < Math.round(workers * woodShare) || !mineId) {
        this.fs.setJob(u, 'wood', -1);
        onWood++;
      } else {
        this.fs.setJob(u, 'gold', mineId);
        goldOn.set(mineId, fewest + 1);
      }
    }
  }

  private houses(): void {
    const f = this.f;
    if (f.supplyCap >= gameData.rules.economy.supplyCap) return;
    if (f.supplyCap - f.supplyUsed >= HOUSE_AT_FREE_SUPPLY || this.siteOf('house')) return;
    if (this.savingFor === 'Town Hall' && f.supplyCap - f.supplyUsed > 1) return;
    this.tryBuild('house');
  }

  /** Starts a building at a free spot of the home base. False when it can not (yet). */
  private tryBuild(id: string, near?: { x: number; y: number; radius: number }): boolean {
    const f = this.f;
    const def = buildingDef(id);
    if (!def || this.fs.missing(f, def.requires).length) return false;
    if (!this.fs.canPay(f, def.cost)) {
      this.save(def.name, def.cost.gold, def.cost.wood);
      return false;
    }
    const spot = near ? this.spotNear(def, near.x, near.y, near.radius) : this.spotInBase(def);
    if (!spot) return false;
    const worker = this.builder(spot.x, spot.y);
    if (!worker) return false;
    const site = this.fs.startBuilding(f, id, spot.x, spot.y, worker);
    if (site) this.doing = `Building ${def.name}`;
    return !!site;
  }

  private save(name: string, gold: number, wood: number): void {
    if (this.savingFor) return;
    this.savingFor = name;
    this.savingGold = gold;
    this.reserveGold = gold;
    this.reserveWood = wood;
  }

  private spotInBase(def: BuildingDef): { x: number; y: number } | null {
    const start = gameData.map.starts[this.f.start]!;
    const hall = this.sim.get(this.f.homeHallId);
    const hx = hall?.alive ? hall.mover.x : start.townHall[0],
      hy = hall?.alive ? hall.mover.y : start.townHall[1];
    const mine = this.fs.nearestMine(hx, hy);
    const c = this.sim.size / 2;
    return findBuildSpot(this.fs.terrain, this.sim.nav, {
      footprint: [def.footprint[0], def.footprint[1]],
      center: [start.buildArea.center[0], start.buildArea.center[1]],
      radius: start.buildArea.radius,
      townHall: [hx, hy],
      existing: this.rects(hx, hy, start.buildArea.radius + 8),
      corridors: mine ? baseCorridors([hx, hy], [mine.mover.x, mine.mover.y], [c, c], start.buildArea.radius) : [],
      minFromTownHall: def.id === 'watchtower' ? 3 : 1.5,
      ...(def.id === 'watchtower' ? { preferToward: [c, c] as [number, number] } : {}),
    });
  }

  private spotNear(def: BuildingDef, x: number, y: number, radius: number): { x: number; y: number } | null {
    const [w, h] = def.footprint;
    // The map's Town Hall spot first, then the build-spot search around it.
    const sx = snap(x, w),
      sy = snap(y, h);
    if (this.fs.spotFree(sx, sy, w, h)) return { x: sx, y: sy };
    return findBuildSpot(this.fs.terrain, this.sim.nav, {
      footprint: [w, h],
      center: [x, y],
      radius,
      townHall: [x, y],
      existing: this.rects(x, y, radius + 8),
      corridors: [],
    });
  }

  /** Buildings, mines and the hero spawn near a point, for the placement spacing rules. */
  private rects(x: number, y: number, r: number): Rect[] {
    const out: Rect[] = [];
    for (const e of this.sim.entities) {
      if (!e.alive || !e.building) continue;
      if (Math.abs(e.mover.x - x) > r || Math.abs(e.mover.y - y) > r) continue;
      const [w, h] = footprintOf(e.type);
      out.push({ x: e.mover.x, y: e.mover.y, w, h });
    }
    // Keep the hero's spawn point free.
    const spawn = gameData.map.starts[this.f.start]!.heroSpawn;
    out.push({ x: spawn[0], y: spawn[1], w: 2, h: 2 });
    return out;
  }

  /** The nearest gathering worker that carries nothing (or any gatherer). */
  private builder(x: number, y: number): SimEntity | null {
    let best: SimEntity | null = null,
      bestD = Infinity;
    for (const id of this.f.units) {
      const u = this.sim.get(id);
      if (!u?.alive || !u.job || u.hidden || this.militia.has(u.id)) continue;
      if (u.job.kind !== 'gold' && u.job.kind !== 'wood' && u.job.kind !== 'idle') continue;
      const d = Math.hypot(u.mover.x - x, u.mover.y - y) + (u.job.carry ? 6 : 0);
      if (d < bestD) {
        bestD = d;
        best = u;
      }
    }
    return best;
  }

  // ---------- build order and free play ----------

  private stepDone(steps: readonly Step[], i: number): boolean {
    const s = steps[i]!;
    const f = this.f;
    switch (s.do) {
      case 'build': {
        let need = 0;
        for (let k = 0; k <= i; k++) if (steps[k]!.do === 'build' && steps[k]!.what === s.what) need++;
        // "Second Barracks (if allowed)": skipped when production buildings are at the limit.
        if (need > 1 && PRODUCTION.has(s.what) && this.productionCount() >= this.rules.maxProductionBuildings) return true;
        return this.count(s.what) >= need;
      }
      case 'train': {
        let need = 0;
        for (let k = 0; k <= i; k++) if (steps[k]!.do === 'train' && steps[k]!.what === s.what) need += steps[k]!.count ?? 1;
        return (this.trained.get(s.what) ?? 0) >= need;
      }
      case 'upgrade': {
        const tier = s.what === 'stronghold' ? 2 : 3;
        if (f.tier >= tier) return true;
        return this.fs.halls(f).some((h) => h.building!.upgradeTo === entityTypeIndex(s.what));
      }
      case 'expand':
      case 'summon':
        // Expansion runs on its own clock (expandAtMinute) and the hero is summoned as soon as
        // the shrine is ready (heroThink): neither holds the order back.
        return true;
    }
  }

  private buildOrder(): void {
    // The expansion money comes first when the mines run low.
    if (this.savingFor === 'Town Hall') return;
    const steps = AI.buildOrder;
    let i = 0;
    while (i < steps.length && this.stepDone(steps, i)) i++;
    if (i >= steps.length) return this.freePlay();
    if (this.sim.tick - this.lastStepAt < this.rules.buildOrderDelaySec * TICK_RATE) return;
    const s = steps[i]!;
    let started = false;
    if (s.do === 'build') started = this.tryBuild(s.what);
    else if (s.do === 'train') started = this.trainOne(s.what);
    else if (s.do === 'upgrade') started = this.tierUp();
    if (started) this.lastStepAt = this.sim.tick;
  }

  private productionCount(): number {
    let n = 0;
    for (const id of PRODUCTION) n += this.count(id);
    return n;
  }

  private freePlay(): void {
    const f = this.f;
    if (this.siteCount() >= 2) return;
    if (f.tier < 3) {
      if (this.tierUp()) return;
    }
    if (this.count('watchtower') < this.rules.towersAtBase && this.tryBuild('watchtower')) return;
    // More production when money piles up.
    if (this.productionCount() < this.rules.maxProductionBuildings && f.gold > 500) {
      const next = this.count('archery_range') < this.count('barracks') ? 'archery_range' : 'barracks';
      this.tryBuild(next);
    }
  }

  private siteCount(): number {
    let n = 0;
    for (const id of this.f.buildings) {
      const b = this.sim.get(id);
      if (b?.alive && b.building && !b.building.done) n++;
    }
    return n;
  }

  private tierUp(): boolean {
    const f = this.f;
    const hall = this.sim.get(f.homeHallId);
    const h = hall?.alive && hall.building?.done ? hall : this.fs.halls(f).find((x) => x.building!.done);
    const nextId = h?.building?.def?.upgradesTo;
    if (!h || !nextId || h.building!.upgradeTo >= 0) return false;
    const next = buildingDef(nextId)!;
    if (this.fs.missing(f, next.requires).length) return false;
    if (!this.fs.canPay(f, next.cost, true)) {
      this.save(next.name, next.cost.gold, next.cost.wood);
      return false;
    }
    if (!this.fs.upgradeTier(f, h)) return false;
    this.doing = `Upgrading to ${next.name}`;
    return true;
  }

  /** One unit of a type from the first building that can train it now. */
  private trainOne(id: string): boolean {
    const f = this.f;
    const def = unitDef(id);
    if (!def) return false;
    for (const bid of f.buildings) {
      const b = this.sim.get(bid);
      if (!b?.alive || !b.building?.done || !b.building.def?.trains.includes(id) || b.building.queue.length >= 2) continue;
      if (!this.fs.canPay(f, def.cost)) {
        this.save(def.name, def.cost?.gold ?? 0, def.cost?.wood ?? 0);
        return false;
      }
      if (this.fs.train(f, b, id)) {
        this.trained.set(id, (this.trained.get(id) ?? 0) + 1);
        return true;
      }
    }
    return false;
  }

  // ---------- production ----------

  private mix(): Record<string, number> {
    const f = this.f;
    const base = AI.unitMix[`tier${f.tier}` as 'tier1' | 'tier2' | 'tier3'];
    const m: Record<string, number> = { ...base };
    const shift = (to: string[], from: string, amount: number) => {
      const take = Math.min(m[from] ?? 0, amount);
      if (!take) return;
      m[from] = (m[from] ?? 0) - take;
      for (const t of to) m[t] = (m[t] ?? 0) + take / to.length;
    };
    if (f.upgrades['sharper_blades']) shift(['swordsman', 'lancer'], 'archer', 0.1);
    if (f.upgrades['better_arrows']) shift(['archer'], 'swordsman', 0.1);
    if (f.upgrades['siege_works']) m['catapult'] = (m['catapult'] ?? 0) + 0.05;
    return m;
  }

  private production(): void {
    const f = this.f;
    const mix = this.mix();
    // What the army is made of now (with the queues).
    const have = new Map<string, number>();
    let total = 0;
    for (const id of f.units) {
      const u = this.sim.get(id);
      if (!u?.alive || u.job) continue;
      const t = ENTITY_TYPES[u.type]!;
      const s = supplyOf(u);
      have.set(t, (have.get(t) ?? 0) + s);
      total += s;
    }
    for (const bid of f.buildings) {
      const b = this.sim.get(bid);
      if (!b?.alive || !b.building) continue;
      for (const q of b.building.queue) {
        const t = ENTITY_TYPES[q]!;
        if (t === 'worker') continue;
        const s = unitDef(t)?.supply ?? 0;
        have.set(t, (have.get(t) ?? 0) + s);
        total += s;
      }
    }
    for (const bid of f.buildings) {
      const b = this.sim.get(bid);
      const bs = b?.building;
      if (!b?.alive || !bs?.done || !bs.def || bs.queue.length >= 2 || !PRODUCTION.has(bs.def.id)) continue;
      // The unit the mix misses most that we can pay now (do not spend what a waiting build step needs).
      let pick = '',
        bestGap = -Infinity;
      for (const id of bs.def.trains) {
        const def = unitDef(id);
        if (!def || !(mix[id] ?? 0) || this.fs.missing(f, def.requires).length) continue;
        const g = def.cost?.gold ?? 0,
          w = def.cost?.wood ?? 0;
        if ((g > 0 && f.gold - f.earmarkedGold - g < this.reserveGold) || (w > 0 && f.wood - w < this.reserveWood)) continue;
        const gap = (mix[id] ?? 0) - (total ? (have.get(id) ?? 0) / total : 0);
        if (gap > bestGap) {
          bestGap = gap;
          pick = id;
        }
      }
      if (!pick) continue;
      const def = unitDef(pick)!;
      if (this.fs.train(f, b, pick)) {
        this.trained.set(pick, (this.trained.get(pick) ?? 0) + 1);
        const s = def.supply ?? 0;
        have.set(pick, (have.get(pick) ?? 0) + s);
        total += s;
      }
    }
  }

  // ---------- expansion ----------

  /**
   * A new Town Hall at a free mine: the first one at expandAtMinute, and another one whenever
   * the gold we mine runs low (main mines run dry after about 20 minutes).
   */
  private expansion(): void {
    const at = this.rules.expandAtMinute;
    let left = 0;
    for (const m of this.mineOfHall.values()) left += this.sim.get(m)?.building?.gold ?? 0;
    const low = left < LOW_GOLD;
    this.urgent = left < URGENT_GOLD;
    const timeUp = at !== null && this.sim.tick >= at * 60 * TICK_RATE && !this.expanded;
    if (!low && !timeUp) return;
    for (const h of this.fs.halls(this.f)) if (!h.building!.done) return; // one at a time
    const spot = this.freeExpansion();
    if (!spot) return;
    const [tx, ty] = spot;
    // Keep the Town Hall money from now on, even while the army still clears the spot.
    const hall = buildingDef('town_hall')!;
    if (!this.fs.canPay(this.f, hall.cost)) this.save(hall.name, hall.cost.gold, hall.cost.wood);
    // Monsters or enemies there: the army clears it first. When the gold runs low this comes
    // before any attack: the attack army is called back for it.
    if (this.hostilesNear(tx, ty, 10)) {
      const gather = this.gather;
      if (gather && this.armyState !== 'creep') {
        // ...but never out of a siege: the enemy base is worth more than the camp.
        if (low && this.attack && (this.armyState === 'attack' || this.armyState === 'retreat') && !this.sieging(this.attack)) {
          for (const id of [...this.attack.members]) this.army.add(gather, id);
          this.army.disband(this.attack);
          this.attack = null;
          this.armyState = 'gather';
        }
        if (this.armyState === 'gather' && this.groupSupply(gather) >= CLEAR_SUPPLY) {
          gather.neutrals = true;
          this.army.setGoal(gather, 'attack', tx, ty);
          this.armyState = 'creep';
          this.creepCamp = -2;
        }
      }
      this.doing ||= 'Clearing the expansion';
      return;
    }
    if (this.tryBuild('town_hall', { x: tx, y: ty, radius: BUILD_RADIUS_EXPANSION })) {
      this.doing = 'Taking the expansion';
      this.expanded = true;
    }
  }

  /**
   * The nearest mine with gold and a Town Hall spot where nobody has a Town Hall yet. Main mines
   * use their start spot: a defeated player's base is free to take.
   */
  private freeExpansion(): [number, number] | null {
    const home = this.home!;
    let best: [number, number] | null = null,
      bestD = Infinity;
    for (const m of gameData.map.goldMines) {
      const spot = m.townHallSpot ?? (m.kind === 'main' ? gameData.map.starts.find((st) => st.id === m.sector)?.townHall : undefined);
      if (!spot) continue;
      let gold = 0;
      this.sim.grid.query(m.pos[0], m.pos[1], 2, (o) => {
        if (o.building && !o.building.def) gold = o.building.gold;
      });
      if (gold <= 0) continue;
      let taken = false;
      for (const o of this.fs.list)
        if (o) for (const h of this.fs.halls(o)) if (Math.hypot(h.mover.x - spot[0], h.mover.y - spot[1]) < 10) taken = true;
      if (taken) continue;
      const d = Math.hypot(spot[0] - home.mover.x, spot[1] - home.mover.y);
      if (d < bestD) {
        bestD = d;
        best = [spot[0], spot[1]];
      }
    }
    return best;
  }

  private hostilesNear(x: number, y: number, r: number): boolean {
    let found = false;
    this.sim.grid.query(x, y, r, (o) => {
      if (!found && o.alive && o.team !== this.f.team && !o.building && !o.invulnerable) found = true;
    });
    return found;
  }

  // ---------- faction hero ----------

  /** A finished Hero Shrine of ours, or null. */
  private shrine(): SimEntity | null {
    for (const id of this.f.buildings) {
      const b = this.sim.get(id);
      if (b?.alive && b.building?.done && b.building.def?.heroSummon) return b;
    }
    return null;
  }

  /** Summons the faction's own hero when the shrine is ready, and keeps its respawn point there. */
  private heroThink(): void {
    const f = this.f;
    const shrine = this.shrine();
    const hero = f.heroId ? this.sim.get(f.heroId) : undefined;
    if (hero?.heroState) {
      const shrineId = shrine?.id ?? 0;
      if (shrineId !== this.homeShrineId) {
        this.homeShrineId = shrineId;
        hero.heroState.home = shrine ? this.shrineExit(shrine) : [...gameData.map.starts[f.start]!.heroSpawn];
      }
      return;
    }
    if (!shrine) return;
    if (this.fs.heroOnTheWay(f)) {
      this.doing ||= 'Summoning a hero';
      return;
    }
    const summon = shrine.building!.def!.heroSummon!;
    if (!this.fs.canPay(f, summon.cost)) {
      this.save('a hero', summon.cost.gold, summon.cost.wood);
      return;
    }
    const type = this.pickHero();
    if (type >= 0 && this.fs.summonHero(f, shrine, type)) this.doing = `Summoning the ${ENTITY_TYPES[type]!.replaceAll('_', ' ')}`;
  }

  /** The walkable spot in front of the shrine (toward the map center), where the hero comes back. */
  private shrineExit(shrine: SimEntity): [number, number] {
    const c = this.sim.size / 2;
    const dx = c - shrine.mover.x,
      dy = c - shrine.mover.y;
    const d = Math.hypot(dx, dy) || 1;
    const out = (shrine.building!.w / 2 + 1.5) / d;
    const p = nearestWalkable(this.sim.nav, shrine.mover.x + dx * out, shrine.mover.y + dy * out, 10);
    return p ? [p[0], p[1]] : [shrine.mover.x, shrine.mover.y];
  }

  /**
   * The hero type to summon (ai.json factionHero): a front-line hero when the army lacks melee,
   * a ranged one when it lacks ranged units, a healer or caster for a big army, plus some luck.
   * Never the hero our player plays.
   */
  private pickHero(): number {
    const H = HERO_RULES;
    let front = 0,
      total = 0;
    for (const id of this.f.units) {
      const u = this.sim.get(id);
      if (!u?.alive || u.job) continue;
      const s = supplyOf(u);
      total += s;
      if (roleOf(u) === 'melee') front += s;
    }
    const frontShare = total ? front / total : 0;
    const playerHero = this.sim.heroes[this.f.slot];
    let best = -1,
      bestScore = -Infinity;
    for (const def of gameData.heroes) {
      const type = entityTypeIndex(def.id);
      if (playerHero && playerHero.type === type) continue;
      const role = H.roles[def.id];
      let score = H.score.base + H.score.random * this.sim.rng.next();
      if (role === 'front' && frontShare < H.frontShareWanted) score += H.score.frontNeeded;
      if (role === 'ranged' && total && 1 - frontShare < H.frontShareWanted) score += H.score.rangedNeeded;
      if (role === 'support' && total >= H.bigArmySupply) score += H.score.supportBigArmy;
      if (role === 'caster' && total >= H.bigArmySupply) score += H.score.casterBigArmy;
      if (score > bestScore) {
        bestScore = score;
        best = type;
      }
    }
    return best;
  }

  /** Our hero as army strength (alive and near the point), else 0. */
  private heroStrengthNear(x: number, y: number, r: number): number {
    const hero = this.f.heroId ? this.sim.get(this.f.heroId) : undefined;
    if (!hero?.alive || Math.hypot(hero.mover.x - x, hero.mover.y - y) > r) return 0;
    return heroStrength(hero);
  }

  // ---------- army ----------

  private groupSupply(g: ArmyGroup): number {
    let s = 0;
    for (const id of g.members) {
      const u = this.sim.get(id);
      if (u?.alive) s += supplyOf(u);
    }
    return s;
  }

  /** Health of the group as a share of its full health (0..1). */
  private groupHealth(g: ArmyGroup): number {
    let hp = 0,
      max = 0;
    for (const id of g.members) {
      const u = this.sim.get(id);
      if (!u?.alive) continue;
      hp += u.hp;
      max += u.stats.maxHp;
    }
    return max ? hp / max : 0;
  }

  /** A new goal only when it changed: setGoal restarts every member's walk. */
  private goal(g: ArmyGroup, mode: ArmyGroup['mode'], x: number, y: number): void {
    if (g.mode !== mode || g.targetX !== x || g.targetY !== y) this.army.setGoal(g, mode, x, y);
  }

  /** The group that is out of the base now (roaming, hunting or attacking), or null. */
  private outGroup(): ArmyGroup | null {
    if (this.armyState === 'creep' || this.armyState === 'hunt') return this.gather;
    if (this.armyState === 'attack') return this.attack;
    return null;
  }

  /**
   * Where our army is while it is out (for the faction hero), or null: its middle, or the goal
   * itself once the army is close to it, so the hero is at the fight (XP is shared only within
   * a few units of each kill).
   */
  armyOut(): { x: number; y: number } | null {
    const g = this.outGroup();
    const p = this.heroPoint;
    if (!g || !this.army.center(g, p)) return null;
    if (Math.hypot(p.x - g.targetX, p.y - g.targetY) < HERO_TO_GOAL) {
      p.x = g.targetX;
      p.y = g.targetY;
    }
    return p;
  }

  private armyThink(): void {
    const f = this.f;
    const sim = this.sim;
    this.gather ??= this.army.create([], 'gather', this.rally.x, this.rally.y);
    const gather = this.gather;
    // New units join the home group.
    for (const id of f.units) {
      const u = sim.get(id);
      if (!u?.alive || u.job || this.militia.has(id)) continue;
      if (gather.members.includes(id) || this.attack?.members.includes(id) || this.wave?.members.includes(id)) continue;
      this.army.add(gather, id);
    }
    this.countFieldFight();

    // Defense first. The home group (or the roaming army) fights in the base. The attack army
    // comes home too when it is closer to home than to its goal, but not when it is already
    // fighting at the building it attacks: going back then would waste the whole attack.
    if (this.threat) {
      this.waveHome();
      gather.neutrals = false;
      this.creepCamp = -1;
      if (this.armyState === 'creep' || this.armyState === 'hunt') this.armyState = 'gather';
      this.goal(gather, 'attack', this.threat.x, this.threat.y);
      const a = this.attack;
      if (a && this.armyState === 'attack') {
        if (this.sieging(a) || !this.closerToHome(a)) this.attackThink();
        else {
          for (const id of [...a.members]) this.army.add(gather, id);
          this.army.disband(a);
          this.attack = null;
          this.armyState = 'gather';
        }
      } else if (this.armyState === 'retreat') this.retreatThink();
      this.doing = 'Defending the base!';
      return;
    }

    // While the army is out, the home group waits at the rally point (and sends reinforcements).
    if (this.armyState === 'attack' || this.armyState === 'retreat') this.goal(gather, 'gather', this.rally.x, this.rally.y);
    if (this.armyState === 'attack' && this.attack) this.reinforce(gather, this.attack);
    else this.waveHome();

    switch (this.armyState) {
      case 'creep':
        return this.creepThink(gather);
      case 'hunt':
        return this.huntThink(gather);
      case 'gather':
        return this.gatherThink(gather);
      case 'attack':
        return this.attackThink();
      case 'retreat':
        return this.retreatThink();
    }
  }

  private attackNeed(): number {
    return this.attacks === 0 ? this.rules.firstAttackArmySupply : this.rules.attackArmySupply;
  }

  /**
   * Late game (ai.json army.lateGameMinute): no more camps, no home group, no retreat — the
   * whole army attacks. Long games between equal armies end instead of trading forever.
   */
  private lateGame(): boolean {
    return this.sim.tick >= ARMY.lateGameMinute * 60 * TICK_RATE;
  }

  /** Army supply that stays home after the first attack (none in the late game). */
  private defenseSupply(): number {
    return this.lateGame() ? 0 : DEFENSE_SUPPLY;
  }

  private gatherThink(gather: ArmyGroup): void {
    const sim = this.sim;
    this.goal(gather, 'gather', this.rally.x, this.rally.y);
    gather.neutrals = false;
    const supply = this.groupSupply(gather);
    const need = this.attackNeed();
    const target = this.pickEnemy();
    this.noEnemy = !target;
    if (supply >= ARMY.roamAtSupply && this.startHunt(gather)) return;
    if (supply < need || !target) {
      this.readyAt = 0;
      if (AI.attack.creepCampsWhenIdle && supply >= ARMY.roamAtSupply && (!target || !this.lateGame()) && this.startCreep(gather, supply))
        return;
      if (supply > 0 && target) this.doing ||= `Army gathering (${supply} / ${need} supply)`;
      return;
    }
    // Enough army: wait for stragglers, then go.
    if (!this.readyAt) this.readyAt = sim.tick + AI.attack.waitForStragglersSec * TICK_RATE;
    if (this.army.arrived(gather, 8) < 0.8 && sim.tick < this.readyAt) {
      this.doing ||= 'Army getting ready to attack';
      return;
    }
    this.launchAttack(gather, target);
  }

  /** The army (from home or from a cleared camp) goes for an enemy base. */
  private launchAttack(gather: ArmyGroup, target: SimEntity): void {
    const sim = this.sim;
    // After the first attack a small group stays home.
    const go: number[] = [];
    let kept = 0;
    for (const id of gather.members) {
      const u = sim.get(id);
      if (!u?.alive) continue;
      if (this.attacks > 0 && kept < this.defenseSupply() && !this.sim.isFlying(u)) kept += supplyOf(u);
      else go.push(id);
    }
    this.creepCamp = -1;
    gather.neutrals = false;
    this.army.setGoal(gather, 'gather', this.rally.x, this.rally.y);
    this.attack = this.army.create(go, 'attack', target.mover.x, target.mover.y);
    this.attackSlot = target.owner;
    this.attackTargetId = target.id;
    this.attackStartSupply = this.groupSupply(this.attack);
    this.retargetAt = sim.tick + AI.attack.retargetEverySec * TICK_RATE;
    this.armyState = 'attack';
    this.attacks++;
    this.readyAt = 0;
  }

  /**
   * Units at home above the defense group walk to the attack army as one wave (at least 6
   * supply) and join it when they reach it. Joining at once would make the army wait for them.
   */
  private reinforce(gather: ArmyGroup, a: ArmyGroup): void {
    if (!this.army.center(a, this.center)) return;
    const ax = Math.round(this.center.x / 4) * 4,
      ay = Math.round(this.center.y / 4) * 4;
    const w = this.wave;
    if (w && w.members.length) {
      if (
        this.army.center(w, this.waveCenter) &&
        Math.hypot(this.waveCenter.x - this.center.x, this.waveCenter.y - this.center.y) < WAVE_JOIN
      ) {
        for (const id of [...w.members]) this.army.add(a, id);
        return;
      }
      if (Math.hypot(w.targetX - ax, w.targetY - ay) > 8) this.army.setGoal(w, 'attack', ax, ay);
      return;
    }
    if (this.groupSupply(gather) < this.defenseSupply() + REINFORCE_SUPPLY) return;
    const go: number[] = [];
    let kept = 0;
    for (const id of gather.members) {
      const u = this.sim.get(id);
      if (!u?.alive) continue;
      if (kept < this.defenseSupply()) kept += supplyOf(u);
      else go.push(id);
    }
    if (w) {
      for (const id of go) this.army.add(w, id);
      this.army.setGoal(w, 'attack', ax, ay);
    } else this.wave = this.army.create(go, 'attack', ax, ay);
  }

  /** A wave on its way goes back to the home group (attack over, or the base needs it). */
  private waveHome(): void {
    const w = this.wave;
    if (!w || !w.members.length || !this.gather) return;
    for (const id of [...w.members]) this.army.add(this.gather, id);
  }

  /**
   * The next neutral camp the army can beat (ai.json army): within the roam radius of home, the
   * nearest to the army first, not next to an enemy base. Gold for the faction's hero, XP, and a
   * chance to meet other armies in the forest.
   */
  private startCreep(gather: ArmyGroup, supply: number): boolean {
    const home = this.home!;
    const from = this.army.center(gather, this.center) ? this.center : this.rally;
    const strength = supply + this.heroStrengthNear(from.x, from.y, 25);
    // Flying monsters (harpies) only when the army has enough units that hit air.
    let antiAir = 0;
    for (const id of gather.members) {
      const u = this.sim.get(id);
      if (u?.alive && u.stats.canHitAir) antiAir += supplyOf(u);
    }
    const radius = ARMY.roamRadius[this.f.tier - 1] ?? ARMY.roamRadius[ARMY.roamRadius.length - 1]!;
    let best = -1,
      bestScore = Infinity;
    for (const c of this.sim.camps) {
      if (c.respawnAt !== 0) continue;
      let level = 0,
        flyers = 0;
      for (const m of c.members)
        if (m.alive) {
          level += m.stats.level;
          if (m.stats.layer !== 'ground') flyers += m.stats.level;
        }
      if (!level || level > strength * ARMY.campLevelPerSupply) continue;
      if (flyers && flyers > antiAir * ARMY.campLevelPerSupply) continue;
      const fromHome = Math.hypot(c.x - home.mover.x, c.y - home.mover.y);
      if (fromHome > radius || this.nearEnemyHall(c.x, c.y, ENEMY_BASE_KEEP_OUT)) continue;
      const score = Math.hypot(c.x - from.x, c.y - from.y) + fromHome * 0.5;
      if (score < bestScore) {
        bestScore = score;
        best = c.index;
      }
    }
    if (best < 0) return false;
    const c = this.sim.camps[best]!;
    this.creepCamp = best;
    gather.neutrals = true;
    this.goal(gather, 'attack', c.x, c.y);
    this.armyState = 'creep';
    return true;
  }

  private creepThink(gather: ArmyGroup): void {
    const camp = this.creepCamp >= 0 ? this.sim.camps[this.creepCamp] : undefined;
    const done = camp ? camp.respawnAt !== 0 : !this.hostilesNear(gather.targetX, gather.targetY, 10);
    const supply = this.groupSupply(gather);
    if (supply === 0) return this.backToRally(gather);
    if (this.startHunt(gather)) return;
    if (!done) {
      this.doing ||= camp ? 'Army clearing a camp' : 'Clearing the expansion';
      return;
    }
    this.creepCamp = -1;
    // Strong enough now: attack straight from here (the army is together already).
    const target = this.pickEnemy();
    this.noEnemy = !target;
    if (target && supply >= this.attackNeed()) return this.launchAttack(gather, target);
    // Healthy: on to the next camp, else home to heal and gather.
    if (!this.lateGame() && this.groupHealth(gather) * 100 >= ARMY.roamMinHpPct && this.startCreep(gather, supply)) return;
    this.backToRally(gather);
  }

  private backToRally(gather: ArmyGroup): void {
    this.creepCamp = -1;
    this.armyState = 'gather';
    gather.neutrals = false;
    this.goal(gather, 'gather', this.rally.x, this.rally.y);
  }

  /**
   * Enemy army units (and heroes) near our group, away from their own base: where they are and
   * how strong. Writes into this.enemy; false when there are none.
   */
  private enemyArmyNear(g: ArmyGroup, range: number): boolean {
    if (!this.army.center(g, this.center)) return false;
    const e = this.enemy;
    e.x = e.y = e.strength = 0;
    e.slot = -1;
    let n = 0,
      units = 0;
    this.sim.grid.query(this.center.x, this.center.y, range, (o) => {
      if (!o.alive || o.team === this.f.team || o.team === NEUTRAL_TEAM || o.building || o.job || o.inert || o.hidden) return;
      if (o.summonUntil || !this.sim.canSee(this.f.team, o)) return;
      if (this.nearOwnHall(o, BASE_RADIUS)) return;
      e.x += o.mover.x;
      e.y += o.mover.y;
      if (o.heroState) e.strength += heroStrength(o);
      else {
        const s = supplyOf(o);
        e.strength += s;
        units += s;
      }
      e.slot = o.owner;
      n++;
    });
    // Heroes alone are no army: the army does not chase them around the map.
    if (units < ARMY_MIN_SUPPLY) return false;
    // On a 4-unit grid, so the goal (and its flow field) does not change every think.
    e.x = Math.round(e.x / n / 4) * 4;
    e.y = Math.round(e.y / n / 4) * 4;
    return true;
  }

  /** Our strength: group supply plus our hero when it is with the group. */
  private groupStrength(g: ArmyGroup): number {
    const s = this.groupSupply(g);
    return this.army.center(g, this.center) ? s + this.heroStrengthNear(this.center.x, this.center.y, 20) : s;
  }

  /**
   * An enemy army near our roaming (or gathering) army: fight it when we are strong enough, go
   * home when it is much stronger and close. True when the army got a new plan.
   */
  private startHunt(g: ArmyGroup): boolean {
    if (!this.enemyArmyNear(g, ARMY.huntRange)) return false;
    const ours = this.groupStrength(g);
    const theirs = this.enemy.strength;
    if (ours >= theirs * ARMY.huntStrengthRatio) {
      g.neutrals = false;
      this.creepCamp = -1;
      this.goal(g, 'attack', this.enemy.x, this.enemy.y);
      this.huntSlot = this.enemy.slot;
      this.huntUntil = this.sim.tick + HUNT_MAX_SEC * TICK_RATE;
      this.armyState = 'hunt';
      return true;
    }
    // Much stronger and close: no fight we can win out here.
    const d = Math.hypot(this.enemy.x - this.center.x, this.enemy.y - this.center.y);
    if (theirs > ours * 1.5 && d < ARMY.huntRange * 0.6 && this.armyState !== 'gather') {
      this.backToRally(g);
      return true;
    }
    return false;
  }

  private huntThink(g: ArmyGroup): void {
    const supply = this.groupSupply(g);
    if (supply === 0 || this.sim.tick >= this.huntUntil || !this.enemyArmyNear(g, ARMY.huntRange)) {
      // They are gone (dead, fled, out of sight): attack from here when strong enough, else on
      // to a camp, else home.
      const target = this.pickEnemy();
      if (target && supply >= this.attackNeed()) return this.launchAttack(g, target);
      if (supply && this.groupHealth(g) * 100 >= ARMY.roamMinHpPct && this.startCreep(g, supply)) return;
      return this.backToRally(g);
    }
    if (this.enemy.strength > this.groupStrength(g) * 1.5) return this.backToRally(g);
    this.goal(g, 'attack', this.enemy.x, this.enemy.y);
    this.huntSlot = this.enemy.slot;
    this.doing = `Fighting ${this.colorName(this.huntSlot)}'s army`;
  }

  private closerToHome(a: ArmyGroup): boolean {
    if (!this.threat || !this.army.center(a, this.center)) return false;
    const toHome = Math.hypot(this.center.x - this.threat.x, this.center.y - this.threat.y);
    return toHome < Math.hypot(this.center.x - a.targetX, this.center.y - a.targetY);
  }

  /** The attack army is at the building it attacks and fighting there. */
  private sieging(a: ArmyGroup): boolean {
    if (!this.army.center(a, this.center)) return false;
    if (Math.hypot(this.center.x - a.targetX, this.center.y - a.targetY) > ARMY.siegeRange) return false;
    for (const id of a.members) if (this.sim.get(id)?.targetId) return true;
    return false;
  }

  private attackThink(): void {
    const a = this.attack;
    const sim = this.sim;
    if (!a) {
      this.armyState = 'gather';
      return;
    }
    const supply = this.groupSupply(a);
    if (supply === 0) {
      this.army.disband(a);
      this.attack = null;
      this.armyState = 'gather';
      return;
    }
    // Hard: hurt units walk home and join the home group.
    if (this.rules.pullWoundedUnits && this.gather)
      for (const id of [...a.members]) {
        const u = sim.get(id);
        if (u?.alive && u.hp < u.stats.maxHp * WOUNDED_PCT) this.army.add(this.gather, id);
      }
    // A maxed-out, rich faction does not retreat: its losses come back at once as new waves.
    const f = this.f;
    const refills = f.supplyCap >= gameData.rules.economy.supplyCap && f.supplyCap - f.supplyUsed < 8 && f.gold > RICH_GOLD;
    if (
      !refills &&
      !this.lateGame() &&
      this.rules.retreatAtArmyPct > 0 &&
      supply < (this.attackStartSupply * this.rules.retreatAtArmyPct) / 100
    ) {
      this.army.setGoal(a, 'retreat', this.rally.x, this.rally.y);
      this.armyState = 'retreat';
      return;
    }
    let target = sim.get(this.attackTargetId);
    if (!target?.alive || sim.tick >= this.retargetAt) {
      this.retargetAt = sim.tick + AI.attack.retargetEverySec * TICK_RATE;
      const next = target?.alive ? target : this.nextBuilding(a);
      if (!next) {
        // Nothing left there: back home.
        this.army.setGoal(a, 'retreat', this.rally.x, this.rally.y);
        this.armyState = 'retreat';
        return;
      }
      this.attackTargetId = next.id;
      this.attackSlot = next.owner;
      target = next;
    }
    // On the way: an enemy army near us is fought first (when we can win), then on to the base.
    const far =
      this.army.center(a, this.center) && Math.hypot(this.center.x - target.mover.x, this.center.y - target.mover.y) > ARMY.siegeRange;
    if (far && this.enemyArmyNear(a, ARMY.huntRange * 0.7) && this.groupStrength(a) >= this.enemy.strength * ARMY.huntStrengthRatio) {
      this.goal(a, 'attack', this.enemy.x, this.enemy.y);
      this.doing = `Fighting ${this.colorName(this.enemy.slot)}'s army`;
      return;
    }
    this.goal(a, 'attack', target.mover.x, target.mover.y);
    this.doing = `Attacking ${this.colorName(this.attackSlot)}`;
  }

  private colorName(slot: number): string {
    return COLOR_NAMES[this.sim.factions?.get(slot)?.color ?? -1] ?? 'the enemy';
  }

  private retreatThink(): void {
    const a = this.attack;
    if (!a || this.groupSupply(a) === 0 || this.army.arrived(a, 8) >= 0.7) {
      if (a) {
        for (const id of [...a.members]) if (this.gather) this.army.add(this.gather, id);
        this.army.disband(a);
      }
      this.attack = null;
      this.armyState = 'gather';
      return;
    }
    this.doing = 'Retreating';
  }

  /** An enemy unit (or hero) close to one of its own Town Halls. */
  private nearOwnHall(o: SimEntity, r: number): boolean {
    const of = this.fs.get(o.owner);
    if (!of) return false;
    for (const h of this.fs.halls(of)) if (Math.hypot(h.mover.x - o.mover.x, h.mover.y - o.mover.y) < r) return true;
    return false;
  }

  /** A point close to an enemy Town Hall. */
  private nearEnemyHall(x: number, y: number, r: number): boolean {
    for (const o of this.fs.list) {
      if (!o || o.defeated || o.team === this.f.team) continue;
      for (const h of this.fs.halls(o)) if (Math.hypot(h.mover.x - x, h.mover.y - y) < r) return true;
    }
    return false;
  }

  /**
   * Our army out in the field fights an enemy army, far from every Town Hall: a "field fight"
   * for the match report (at most one per FIELD_FIGHT_GAP_SEC).
   */
  private countFieldFight(): void {
    const g = this.outGroup();
    if (!g || this.sim.tick - this.lastFieldFightAt < FIELD_FIGHT_GAP_SEC * TICK_RATE) return;
    let fighting = false;
    for (const id of g.members) {
      const u = this.sim.get(id);
      const t = u?.targetId ? this.sim.get(u.targetId) : undefined;
      if (t?.alive && t.team !== NEUTRAL_TEAM && !t.building && !t.job) {
        fighting = true;
        break;
      }
    }
    if (!fighting || !this.army.center(g, this.center)) return;
    for (const o of this.fs.list) {
      if (!o) continue;
      for (const h of this.fs.halls(o))
        if (Math.hypot(h.mover.x - this.center.x, h.mover.y - this.center.y) < ARMY.fieldFightMinFromBase) return;
    }
    this.lastFieldFightAt = this.sim.tick;
    this.f.fieldFights++;
  }

  /** The enemy faction to attack, by difficulty, and the building to walk to. */
  private pickEnemy(): SimEntity | null {
    const fs = this.fs;
    const home = this.home!;
    let best: SimEntity | null = null,
      bestScore = Infinity;
    const hero = this.sim.heroes[this.f.slot];
    for (const o of fs.list) {
      if (!o || o.defeated || o.team === this.f.team) continue;
      const halls = fs.halls(o);
      const hall = halls[0];
      if (!hall) continue;
      const d = Math.hypot(hall.mover.x - home.mover.x, hall.mover.y - home.mover.y);
      let score = d;
      if (this.rules.targetChoice !== 'closest') {
        // Weaker factions (fewer buildings and army) are better targets.
        score = d * 0.5 + (o.buildings.size * 4 + o.supplyUsed) * 2;
      }
      if (this.rules.targetChoice === 'weakest_or_where_our_hero_fights' && hero?.alive) {
        const near = Math.hypot(hero.mover.x - hall.mover.x, hero.mover.y - hall.mover.y);
        if (near < 30) score -= 1000;
      }
      if (score < bestScore) {
        bestScore = score;
        best = hall;
      }
    }
    return best;
  }

  /** The nearest building of the faction we attack, or of any enemy, from the army. */
  private nextBuilding(a: ArmyGroup): SimEntity | null {
    if (!this.army.center(a, this.center)) return null;
    const pick = (slot: number): SimEntity | null => {
      const o = this.fs.get(slot);
      if (!o || o.defeated) return null;
      let best: SimEntity | null = null,
        bestD = Infinity;
      for (const id of o.buildings) {
        const b = this.sim.get(id);
        if (!b?.alive) continue;
        // Town Halls first: a faction without one is out of the game.
        const d = Math.hypot(b.mover.x - this.center.x, b.mover.y - this.center.y) - (isTownHall(b) ? HALL_BONUS : 0);
        if (d < bestD) {
          bestD = d;
          best = b;
        }
      }
      return best;
    };
    const same = pick(this.attackSlot);
    if (same) return same;
    const other = this.pickEnemy();
    return other;
  }

  // ---------- status ----------

  private statusLine(): string {
    const f = this.f;
    const saving =
      this.savingFor && this.savingGold > 0
        ? `Saving for ${this.savingFor} (${Math.floor(Math.min(f.gold, this.savingGold))} / ${this.savingGold} gold)`
        : '';
    const d = this.doing;
    if (d === 'Defending the base!' || d === 'Retreating' || d.startsWith('Attacking') || d.startsWith('Fighting'))
      return saving ? `${d} · ${saving}` : d;
    const need = this.attackNeed();
    const supply = this.gather ? this.groupSupply(this.gather) : 0;
    let army = '';
    if (this.armyState === 'creep') army = 'Army clearing camps';
    else if (this.armyState === 'gather')
      army = this.noEnemy
        ? 'No enemy left to attack'
        : supply < need
          ? `Next attack: ${supply}/${need} army supply`
          : 'Next attack: army on the way to the rally point';
    return [saving || (d.startsWith('Army clearing') ? '' : d) || 'Gathering gold and wood', army].filter(Boolean).join(' · ');
  }
}

/** All faction brains of a match, the army mover and the hero bots. Server only. */
export class FactionAI {
  readonly brains: FactionBrain[] = [];
  readonly army: ArmyMover;
  readonly bots: HeroBot[] = [];
  /** the factions' own heroes (one bot per faction, idle until the hero is summoned) */
  readonly factionBots: HeroBot[] = [];
  /** slot of each hero bot in `bots` */
  private readonly botSlots: number[] = [];

  constructor(private readonly sim: MatchSim) {
    this.army = new ArmyMover(sim);
    const fs = sim.factions;
    if (fs) for (const f of fs.list) if (f) this.brains.push(new FactionBrain(sim, fs, f, this.army));
    for (const s of sim.setup.slots) if (s.bot) this.setHeroBot(s.index, true);
    for (const b of this.brains)
      this.factionBots.push(
        new HeroBot(FACTION_HERO_SLOT + b.f.slot, b.f.difficulty, {
          armyTarget: () => b.armyTarget(),
          baseUnderAttack: () => b.threat,
          withArmy: () => b.armyOut(),
          withArmyFromLevel: HERO_RULES.followArmyFromLevel,
        }),
      );
  }

  /** A bot plays this slot's hero (a Bot slot, or a player who is away), or stops. */
  setHeroBot(slot: number, on: boolean): void {
    const at = this.botSlots.indexOf(slot);
    if (!on) {
      if (at >= 0) {
        this.bots.splice(at, 1);
        this.botSlots.splice(at, 1);
      }
      return;
    }
    if (at >= 0) return;
    const s = this.sim.setup.slots.find((x) => x.index === slot);
    if (!s) return;
    const brain = this.brain(slot);
    this.bots.push(
      new HeroBot(slot, (s.ai ?? 'normal') as BotDifficulty, {
        armyTarget: () => brain?.armyTarget() ?? null,
        baseUnderAttack: () => brain?.threat ?? null,
        hires: true,
      }),
    );
    this.botSlots.push(slot);
  }

  brain(slot: number): FactionBrain | undefined {
    return this.brains.find((b) => b.f.slot === slot);
  }

  /** Once per tick, inside MatchSim.step (before units move). */
  update(): void {
    for (const b of this.brains) b.update();
    this.army.update();
    for (const bot of this.bots) bot.update(this.sim);
    for (const bot of this.factionBots) bot.update(this.sim);
  }
}
