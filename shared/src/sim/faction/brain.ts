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
import { NEUTRAL_TEAM, TICK_RATE, type MatchSim, type SimEntity } from '../match-sim';
import { ArmyMover, type ArmyGroup } from './army';
import { unitDef, type Difficulty, type Factions, type FactionState } from './faction';
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
  do: 'build' | 'train' | 'upgrade' | 'expand';
  what: string;
  count?: number;
}

const AI = gameData.ai.faction as unknown as {
  difficulties: Record<Difficulty, DifficultyRules>;
  buildOrder: Step[];
  unitMix: Record<'tier1' | 'tier2' | 'tier3', Record<string, number>>;
  attack: { gatherPointDistance: number; waitForStragglersSec: number; retargetEverySec: number; creepCampsWhenIdle: boolean };
};

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

function supplyOf(e: SimEntity): number {
  return unitDef(ENTITY_TYPES[e.type]!)?.supply ?? 0;
}

function buildingDef(id: string): BuildingDef | undefined {
  return gameData.buildings.buildings.find((b) => b.id === id);
}

/** Snaps a center to the 1-unit build grid of a footprint (odd sizes sit on .5). */
function snap(v: number, size: number): number {
  const off = Math.round(size) % 2 === 0 ? 0 : 0.5;
  return Math.round(v - off) + off;
}

type ArmyState = 'gather' | 'creep' | 'attack' | 'retreat';

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
  private armyState: ArmyState = 'gather';
  private attacks = 0;
  private attackStartSupply = 0;
  private attackSlot = -1;
  private attackTargetId = 0;
  private retargetAt = 0;
  private readyAt = 0;
  private creepCamp = -1;
  /** where enemies are in our base, or null */
  threat: { x: number; y: number } | null = null;
  private readonly threatPoint = { x: 0, y: 0 };
  private readonly militia = new Set<number>();
  private expanded = false;
  private savingFor = '';
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

    // Militia: the Town Hall is almost down, every worker near it fights.
    const home = this.home!;
    if (this.threat && home.hp < home.stats.maxHp * MILITIA_HALL_PCT) {
      for (const id of f.units) {
        const u = sim.get(id);
        if (!u?.alive || !u.job || this.militia.has(u.id)) continue;
        if (Math.hypot(u.mover.x - home.mover.x, u.mover.y - home.mover.y) > BASE_RADIUS) continue;
        this.fs.setJob(u, 'idle');
        u.order = 'attackMove';
        u.orderX = this.threat.x;
        u.orderY = this.threat.y;
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
        // Expansion runs on its own clock (expandAtMinute) and does not hold the order back.
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
        if (low && this.attack && (this.armyState === 'attack' || this.armyState === 'retreat')) {
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

  // ---------- army ----------

  private groupSupply(g: ArmyGroup): number {
    let s = 0;
    for (const id of g.members) {
      const u = this.sim.get(id);
      if (u?.alive) s += supplyOf(u);
    }
    return s;
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
      if (gather.members.includes(id) || this.attack?.members.includes(id)) continue;
      this.army.add(gather, id);
    }

    // Defense first: the home group fights in the base; the attack army comes home if it is
    // closer to home than to its target.
    if (this.threat) {
      gather.neutrals = false;
      this.army.setGoal(gather, 'attack', this.threat.x, this.threat.y);
      if (this.armyState === 'creep') this.armyState = 'gather';
      const a = this.attack;
      if (a && this.armyState === 'attack' && this.army.center(a, this.center)) {
        const toHome = Math.hypot(this.center.x - this.threat.x, this.center.y - this.threat.y);
        const toGoal = Math.hypot(this.center.x - a.targetX, this.center.y - a.targetY);
        if (toHome < toGoal) this.army.setGoal(a, 'attack', this.threat.x, this.threat.y);
      }
      this.doing = 'Defending the base!';
      if (this.armyState === 'attack') this.attackThink();
      else if (this.armyState === 'retreat') this.retreatThink();
      this.doing = 'Defending the base!';
      return;
    }

    // While the army is out, the home group waits at the rally point (and sends reinforcements).
    if (this.armyState === 'attack' || this.armyState === 'retreat') {
      if (gather.mode !== 'gather' || gather.targetX !== this.rally.x || gather.targetY !== this.rally.y)
        this.army.setGoal(gather, 'gather', this.rally.x, this.rally.y);
      if (this.armyState === 'attack' && this.attack) this.reinforce(gather, this.attack);
    }

    switch (this.armyState) {
      case 'creep':
        return this.creepThink(gather);
      case 'gather':
        return this.gatherThink(gather);
      case 'attack':
        return this.attackThink();
      case 'retreat':
        return this.retreatThink();
    }
  }

  private gatherThink(gather: ArmyGroup): void {
    const sim = this.sim;
    if (gather.mode !== 'gather' || gather.targetX !== this.rally.x || gather.targetY !== this.rally.y)
      this.army.setGoal(gather, 'gather', this.rally.x, this.rally.y);
    const supply = this.groupSupply(gather);
    const need = this.attacks === 0 ? this.rules.firstAttackArmySupply : this.rules.attackArmySupply;
    if (supply < need) {
      this.readyAt = 0;
      if (AI.attack.creepCampsWhenIdle && supply >= 10 && this.startCreep(gather, supply)) return;
      if (supply > 0) this.doing ||= `Army gathering (${supply} / ${need} supply)`;
      return;
    }
    // Enough army: wait for stragglers, then go.
    if (!this.readyAt) this.readyAt = sim.tick + AI.attack.waitForStragglersSec * TICK_RATE;
    if (this.army.arrived(gather, 8) < 0.8 && sim.tick < this.readyAt) {
      this.doing ||= `Army gathering (${supply} / ${need} supply)`;
      return;
    }
    const target = this.pickEnemy();
    if (!target) return;
    // After the first attack a small group stays home.
    const keep: number[] = [];
    const go: number[] = [];
    let kept = 0;
    for (const id of gather.members) {
      const u = sim.get(id);
      if (!u?.alive) continue;
      if (this.attacks > 0 && kept < DEFENSE_SUPPLY && !this.sim.isFlying(u)) {
        keep.push(id);
        kept += supplyOf(u);
      } else go.push(id);
    }
    this.attack = this.army.create(go, 'attack', target.mover.x, target.mover.y);
    this.attackSlot = target.owner;
    this.attackTargetId = target.id;
    this.attackStartSupply = this.groupSupply(this.attack);
    this.retargetAt = sim.tick + AI.attack.retargetEverySec * TICK_RATE;
    this.armyState = 'attack';
    this.attacks++;
    this.readyAt = 0;
  }

  /** Units at home above the defense group join the attack (in waves of at least 6 supply). */
  private reinforce(gather: ArmyGroup, a: ArmyGroup): void {
    if (this.groupSupply(gather) < DEFENSE_SUPPLY + REINFORCE_SUPPLY) return;
    let kept = 0;
    for (const id of [...gather.members]) {
      const u = this.sim.get(id);
      if (!u?.alive) continue;
      if (kept < DEFENSE_SUPPLY) {
        kept += supplyOf(u);
        continue;
      }
      this.army.add(a, id);
    }
  }

  /** Neutral camps near home that the army can beat: free gold, and XP for the hero. */
  private startCreep(gather: ArmyGroup, supply: number): boolean {
    const home = this.home!;
    let best = -1,
      bestD = 60;
    for (const c of this.sim.camps) {
      if (c.respawnAt !== 0) continue;
      let level = 0;
      for (const m of c.members) if (m.alive) level += m.stats.level;
      if (!level || level > supply * 0.6) continue;
      const d = Math.hypot(c.x - home.mover.x, c.y - home.mover.y);
      if (d < bestD) {
        bestD = d;
        best = c.index;
      }
    }
    if (best < 0) return false;
    const c = this.sim.camps[best]!;
    this.creepCamp = best;
    gather.neutrals = true;
    this.army.setGoal(gather, 'attack', c.x, c.y);
    this.armyState = 'creep';
    return true;
  }

  private creepThink(gather: ArmyGroup): void {
    const camp = this.creepCamp >= 0 ? this.sim.camps[this.creepCamp] : undefined;
    const done = camp ? camp.respawnAt !== 0 : !this.hostilesNear(gather.targetX, gather.targetY, 10);
    if (done || this.groupSupply(gather) === 0) {
      this.creepCamp = -1;
      this.armyState = 'gather';
      gather.neutrals = false;
      this.army.setGoal(gather, 'gather', this.rally.x, this.rally.y);
      return;
    }
    this.doing ||= camp ? 'Clearing a camp' : 'Clearing the expansion';
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
    if (this.rules.retreatAtArmyPct > 0 && supply < (this.attackStartSupply * this.rules.retreatAtArmyPct) / 100) {
      this.army.setGoal(a, 'retreat', this.rally.x, this.rally.y);
      this.armyState = 'retreat';
      return;
    }
    const target = sim.get(this.attackTargetId);
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
      if (next.mover.x !== a.targetX || next.mover.y !== a.targetY) this.army.setGoal(a, 'attack', next.mover.x, next.mover.y);
    }
    this.doing = `Attacking ${COLOR_NAMES[this.sim.factions?.get(this.attackSlot)?.color ?? 0] ?? 'the enemy'}`;
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
        const d = Math.hypot(b.mover.x - this.center.x, b.mover.y - this.center.y);
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
    const saving = this.savingFor
      ? `Saving for ${this.savingFor} (${Math.floor(Math.min(f.gold, this.reserveGold || f.gold))} / ${this.reserveGold} gold)`
      : '';
    if (this.doing === 'Defending the base!' || this.doing === 'Retreating' || this.doing.startsWith('Attacking'))
      return saving ? `${this.doing} · ${saving}` : this.doing;
    const need = this.attacks === 0 ? this.rules.firstAttackArmySupply : this.rules.attackArmySupply;
    const supply = this.gather ? this.groupSupply(this.gather) : 0;
    const army =
      this.armyState === 'gather'
        ? supply < need
          ? `Next attack: ${supply}/${need} army supply`
          : 'Next attack: waiting for the army to gather'
        : this.armyState === 'creep'
          ? 'Army clearing a camp before the next attack'
          : '';
    return [saving || this.doing || 'Gathering gold and wood', army].filter(Boolean).join(' · ');
  }
}

/** All faction brains of a match, the army mover and the hero bots. Server only. */
export class FactionAI {
  readonly brains: FactionBrain[] = [];
  readonly army: ArmyMover;
  readonly bots: HeroBot[] = [];
  /** slot of each hero bot in `bots` */
  private readonly botSlots: number[] = [];

  constructor(private readonly sim: MatchSim) {
    this.army = new ArmyMover(sim);
    const fs = sim.factions;
    if (fs) for (const f of fs.list) if (f) this.brains.push(new FactionBrain(sim, fs, f, this.army));
    for (const s of sim.setup.slots) if (s.bot) this.setHeroBot(s.index, true);
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
  }
}
