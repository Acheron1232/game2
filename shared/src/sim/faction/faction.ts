// The AI factions: one per slot. Money (gold, wood), supply, tier, buildings and units; the
// building life (construction, training queue, tier upgrade, destruction) and the worker jobs
// (gold, wood, build, repair). The decisions (what to build, where to send the army) are in the
// faction brain; this file only runs what was decided, with the game rules.

import { gameData, type BuildingDef, type UnitDef } from '../../data/index';
import type { TerrainGrid } from '../../map/terrain';
import { NavBlockers } from '../../nav/blockers';
import { isWalkable, nearestWalkable } from '../../nav/nav-grid';
import { buildTreeIndex, nearestChoppableTree, removeTree, type TreeIndex, type TreeList } from '../../nav/trees';
import { buildingDefOf, entityTypeIndex, ENTITY_TYPES, footprintOf, GOLD_MINE } from '../entity-types';
import { EventType } from '../events';
import { NEUTRAL, NEUTRAL_TEAM, TICK_RATE, type MatchSim, type SimEntity } from '../match-sim';
import { buildingStats, rectDistance } from '../stats';

const E = gameData.rules.economy;
const secs = (s: number) => Math.round(s * TICK_RATE);
/** How close (edge distance) a worker must be to use a mine, a drop-off or a building site. */
const REACH = 0.9;
/** A building site starts with this share of its health. */
const SITE_HP = 0.1;
const MAX_QUEUE = 5;
/** Workers look for trees this far from their Town Hall. */
const WOOD_RANGE = 26;

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface FactionState {
  slot: number;
  team: number;
  color: number;
  start: number;
  difficulty: Difficulty;
  gold: number;
  wood: number;
  supplyUsed: number;
  supplyCap: number;
  tier: 1 | 2 | 3;
  /** Town Hall upgrade levels bought by the hero (8c) */
  upgrades: Record<string, number>;
  earmarkedGold: number;
  /** War Banner (bought by the hero) works until this tick */
  warBannerUntil: number;
  buildings: Set<number>;
  units: Set<number>;
  defeated: boolean;
  /** one short line for the AI panel */
  status: string;
  /** the Town Hall at the start spot (may be gone) */
  homeHallId: number;
}

export interface BuildingState {
  def: BuildingDef | null;
  w: number;
  h: number;
  done: boolean;
  /** construction 0..1 */
  progress: number;
  builderId: number;
  /** entity type indices waiting to be trained */
  queue: number[];
  trainLeft: number;
  trainTotal: number;
  rallyX: number;
  rallyY: number;
  /** tier upgrade: target type index (-1 = none) */
  upgradeTo: number;
  upgradeLeft: number;
  upgradeTotal: number;
  /** gold mines: gold left and workers inside */
  gold: number;
  inside: number;
}

export type JobKind = 'idle' | 'gold' | 'wood' | 'build' | 'repair';

export interface WorkerJob {
  kind: JobKind;
  /** mine / building id, or tree index for wood */
  target: number;
  phase: 'go' | 'work' | 'return' | 'wait';
  timer: number;
  carry: 'gold' | 'wood' | null;
  amount: number;
  standX: number;
  standY: number;
  /** a new walk plan is due at this tick */
  repathAt: number;
}

const TOWN_HALLS = new Set(['town_hall', 'stronghold', 'citadel']);
const TIER_OF: Record<string, 1 | 2 | 3> = { town_hall: 1, stronghold: 2, citadel: 3 };

export function isTownHall(e: SimEntity): boolean {
  return !!e.building?.def && TOWN_HALLS.has(e.building.def.id);
}

export function unitDef(id: string): UnitDef | undefined {
  return gameData.units.find((u) => u.id === id);
}

export class Factions {
  readonly list: (FactionState | null)[] = [];
  readonly trees: TreeIndex;
  readonly blockers: NavBlockers;
  /** tree index -> worker id that chops it */
  private readonly treeTaken = new Map<number, number>();
  /** trees cut down so far (for full snapshots) */
  readonly cutTrees: number[] = [];
  /** winner team when the match is over, 0 while it runs */
  winnerTeam = 0;
  endedAt = 0;
  private readonly teamsAtStart: Set<number>;

  constructor(
    readonly sim: MatchSim,
    readonly terrain: TerrainGrid,
    treeList: TreeList,
  ) {
    this.trees = buildTreeIndex(treeList, terrain);
    this.blockers = new NavBlockers(sim.nav);
    for (const m of gameData.map.goldMines) this.spawnMine(m.pos[0], m.pos[1], m.gold);
    for (const s of sim.setup.slots) this.setupStart(s.index, s.team, s.color, s.start, s.ai ?? 'normal');
    this.teamsAtStart = new Set(sim.setup.slots.map((s) => s.team));
  }

  get(slot: number): FactionState | null {
    return this.list[slot] ?? null;
  }

  factionOf(e: SimEntity): FactionState | null {
    return e.owner < 4 ? (this.list[e.owner] ?? null) : null;
  }

  // ---------- start of the match ----------

  private spawnMine(x: number, y: number, gold: number): void {
    const [w, h] = footprintOf(entityTypeIndex(GOLD_MINE));
    const m = this.sim.spawn(entityTypeIndex(GOLD_MINE), NEUTRAL, NEUTRAL_TEAM, 255, x, y, 0);
    m.invulnerable = true;
    m.building = blankBuilding(null, w, h);
    m.building.done = true;
    m.building.gold = gold;
  }

  private setupStart(slot: number, team: number, color: number, start: number, difficulty: Difficulty): void {
    const f: FactionState = {
      slot,
      team,
      color,
      start,
      difficulty,
      gold: E.factionStartGold,
      wood: E.factionStartWood,
      supplyUsed: 0,
      supplyCap: 0,
      tier: 1,
      upgrades: {},
      earmarkedGold: 0,
      warBannerUntil: 0,
      buildings: new Set(),
      units: new Set(),
      defeated: false,
      status: 'Starting',
      homeHallId: 0,
    };
    this.list[slot] = f;
    const [tx, ty] = gameData.map.starts[start]!.townHall;
    const hall = this.placeSite(f, entityTypeIndex('town_hall'), tx, ty);
    if (!hall) return;
    this.finishBuilding(hall);
    f.homeHallId = hall.id;
    // 5 workers between the hall and its mine.
    const mine = this.nearestMine(tx, ty);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const p = nearestWalkable(this.sim.nav, tx + Math.cos(a) * 4, ty + Math.sin(a) * 4, 12) ?? [tx, ty - 4];
      const w = this.spawnUnit(f, entityTypeIndex('worker'), p[0], p[1]);
      if (mine) this.setJob(w, 'gold', mine.id);
    }
    this.updateSupply(f);
  }

  // ---------- building and training (rules; the brain decides) ----------

  /** Does the faction have this building ("stronghold" = tier 2+, "citadel" = tier 3)? */
  has(f: FactionState, id: string): boolean {
    if (id === 'stronghold') return f.tier >= 2;
    if (id === 'citadel') return f.tier >= 3;
    if (id === 'town_hall') return this.halls(f).length > 0;
    for (const bid of f.buildings) {
      const b = this.sim.get(bid);
      if (b?.alive && b.building?.done && b.building.def?.id === id) return true;
    }
    return false;
  }

  missing(f: FactionState, requires: readonly string[] | undefined): string[] {
    return (requires ?? []).filter((r) => !this.has(f, r));
  }

  canPay(f: FactionState, cost: { gold: number; wood: number } | undefined, useEarmark = false): boolean {
    if (!cost) return true;
    const gold = f.gold - (useEarmark ? 0 : f.earmarkedGold);
    return gold >= cost.gold && f.wood >= cost.wood;
  }

  private pay(f: FactionState, cost: { gold: number; wood: number } | undefined, useEarmark = false): void {
    if (!cost) return;
    if (useEarmark) {
      const fromFund = Math.min(f.earmarkedGold, cost.gold);
      f.earmarkedGold -= fromFund;
    }
    f.gold -= cost.gold;
    f.wood -= cost.wood;
  }

  /**
   * Places a building site (pays, blocks the walk grid) and sends `worker` to build it.
   * Returns null when the spot is not free, money is short or something it needs is missing.
   */
  startBuilding(f: FactionState, defId: string, x: number, y: number, worker: SimEntity | null): SimEntity | null {
    const def = gameData.buildings.buildings.find((b) => b.id === defId);
    if (!def || f.defeated) return null;
    if (TOWN_HALLS.has(def.id) && def.id !== 'town_hall') return null; // tiers come from upgrades
    if (this.missing(f, def.requires).length || !this.canPay(f, def.cost)) return null;
    if (!this.spotFree(x, y, def.footprint[0], def.footprint[1])) return null;
    this.pay(f, def.cost);
    const site = this.placeSite(f, entityTypeIndex(def.id), x, y);
    if (!site) return null;
    if (worker) this.setJob(worker, 'build', site.id);
    return site;
  }

  /** All walk cells walkable now, Buildable ground, inside the map. */
  spotFree(x: number, y: number, w: number, h: number): boolean {
    const t = this.terrain;
    const cs = t.cellSize;
    if (x - w / 2 < 1 || y - h / 2 < 1 || x + w / 2 > this.sim.size - 1 || y + h / 2 > this.sim.size - 1) return false;
    for (let r = Math.floor((y - h / 2) / cs + 1e-6); r < Math.ceil((y + h / 2) / cs - 1e-6); r++)
      for (let c = Math.floor((x - w / 2) / cs + 1e-6); c < Math.ceil((x + w / 2) / cs - 1e-6); c++) {
        const i = r * t.cols + c;
        if (!this.sim.nav.walk[i] || !((t.flags[i] ?? 0) & 2)) return false;
      }
    return true;
  }

  private placeSite(f: FactionState, type: number, x: number, y: number): SimEntity | null {
    const def = buildingDefOf(type);
    if (!def) return null;
    const [w, h] = footprintOf(type);
    const e = this.sim.spawn(type, f.slot, f.team, f.color, x, y, Math.atan2(-(this.sim.size / 2 - x), this.sim.size / 2 - y));
    e.building = blankBuilding(def, w, h);
    e.building.rallyX = x + (this.sim.size / 2 - x > 0 ? 1 : -1) * (w / 2 + 2);
    e.building.rallyY = y + (this.sim.size / 2 - y > 0 ? 1 : -1) * (h / 2 + 2);
    this.sim.applyFactionStats(e);
    e.hp = Math.max(1, e.stats.maxHp * SITE_HP);
    f.buildings.add(e.id);
    this.blockers.addRect(x, y, w, h);
    // Anyone standing on the new footprint steps out of it.
    // (A plain loop: placing is rare, and the neighbor grid may be from the last tick.)
    for (const o of this.sim.entities) {
      if (o === e || !o.alive || o.building || o.stats.layer !== 'ground') continue;
      if (rectDistance(o.mover.x, o.mover.y, x, y, w, h) > 0.01) continue;
      const p = nearestWalkable(this.sim.nav, o.mover.x, o.mover.y, 16);
      if (p) this.sim.teleport(o, p[0], p[1]);
    }
    return e;
  }

  private finishBuilding(e: SimEntity): void {
    const b = e.building!;
    b.done = true;
    b.progress = 1;
    e.hp = e.stats.maxHp;
    const f = this.factionOf(e);
    if (f) {
      if (b.def && TIER_OF[b.def.id]) f.tier = Math.max(f.tier, TIER_OF[b.def.id]!) as 1 | 2 | 3;
      this.updateSupply(f);
    }
  }

  /** Queues a unit (pays now, takes supply now). */
  train(f: FactionState, building: SimEntity, unitId: string): boolean {
    const b = building.building;
    const def = unitDef(unitId);
    if (!b?.def || !b.done || !def || f.defeated || !building.alive) return false;
    if (!b.def.trains.includes(unitId) || b.queue.length >= MAX_QUEUE) return false;
    if (this.missing(f, def.requires).length || !this.canPay(f, def.cost)) return false;
    if (f.supplyUsed + (def.supply ?? 0) > f.supplyCap) return false;
    this.pay(f, def.cost);
    b.queue.push(entityTypeIndex(unitId));
    f.supplyUsed += def.supply ?? 0;
    return true;
  }

  /** Town Hall -> Stronghold -> Citadel. The Tier Up Fund gold can be used here. */
  upgradeTier(f: FactionState, hall: SimEntity): boolean {
    const b = hall.building;
    if (!b?.def?.upgradesTo || !b.done || b.upgradeTo >= 0 || f.defeated) return false;
    const next = gameData.buildings.buildings.find((x) => x.id === b.def!.upgradesTo);
    if (!next || this.missing(f, next.requires).length || !this.canPay(f, next.cost, true)) return false;
    this.pay(f, next.cost, true);
    b.upgradeTo = entityTypeIndex(next.id);
    b.upgradeTotal = b.upgradeLeft = secs(next.buildTime);
    return true;
  }

  spawnUnit(f: FactionState, type: number, x: number, y: number): SimEntity {
    const u = this.sim.spawn(type, f.slot, f.team, f.color, x, y);
    f.units.add(u.id);
    this.sim.applyFactionStats(u);
    return u;
  }

  halls(f: FactionState): SimEntity[] {
    const out: SimEntity[] = [];
    for (const id of f.buildings) {
      const b = this.sim.get(id);
      if (b?.alive && isTownHall(b)) out.push(b);
    }
    return out;
  }

  updateSupply(f: FactionState): void {
    let cap = 0,
      used = 0;
    for (const id of f.buildings) {
      const b = this.sim.get(id);
      if (!b?.alive || !b.building) continue;
      if (b.building.done) cap += b.building.def?.supplyGiven ?? 0;
      for (const t of b.building.queue) used += unitDef(ENTITY_TYPES[t]!)?.supply ?? 0;
    }
    for (const id of f.units) {
      const u = this.sim.get(id);
      if (u?.alive) used += unitDef(ENTITY_TYPES[u.type]!)?.supply ?? 0;
    }
    f.supplyCap = Math.min(E.supplyCap, cap);
    f.supplyUsed = used;
  }

  // ---------- workers ----------

  setJob(w: SimEntity, kind: JobKind, target = 0): void {
    this.releaseJob(w);
    w.job ??= { kind: 'idle', target: 0, phase: 'go', timer: 0, carry: null, amount: 0, standX: 0, standY: 0, repathAt: 0 };
    const j = w.job;
    j.kind = kind;
    j.target = target;
    j.phase = j.carry && (kind === 'gold' || kind === 'wood') ? 'return' : 'go';
    j.timer = 0;
    j.repathAt = 0;
    w.order = 'idle';
    w.targetId = 0;
    if (kind === 'wood' && target >= 0) this.treeTaken.set(target, w.id);
  }

  private releaseJob(w: SimEntity): void {
    const j = w.job;
    if (!j) return;
    if (j.kind === 'wood' && this.treeTaken.get(j.target) === w.id) this.treeTaken.delete(j.target);
    if (j.kind === 'gold' && j.phase === 'work') {
      const mine = this.sim.get(j.target);
      if (mine?.building) mine.building.inside = Math.max(0, mine.building.inside - 1);
      w.hidden = false;
    }
  }

  /** Nearest choppable tree near (x, y) that nobody chops. */
  findTree(x: number, y: number, maxR = WOOD_RANGE): { tree: number; standX: number; standY: number } | null {
    return nearestChoppableTree(this.trees, this.sim.nav, x, y, maxR, (i) => this.treeTaken.has(i));
  }

  nearestMine(x: number, y: number): SimEntity | null {
    let best: SimEntity | null = null,
      bestD = Infinity;
    for (const e of this.sim.entities) {
      if (!e.alive || !e.building || e.building.def || e.building.gold <= 0) continue;
      const d = Math.hypot(e.mover.x - x, e.mover.y - y);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  /** Nearest finished Town Hall of the worker's faction. */
  private dropOff(w: SimEntity, f: FactionState): SimEntity | null {
    let best: SimEntity | null = null,
      bestD = Infinity;
    for (const id of f.buildings) {
      const b = this.sim.get(id);
      if (!b?.alive || !b.building?.done || !b.building.def?.dropOff) continue;
      const d = Math.hypot(b.mover.x - w.mover.x, b.mover.y - w.mover.y);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  private walkTo(w: SimEntity, x: number, y: number): void {
    const j = w.job!;
    if (this.sim.tick < j.repathAt && w.mover.path.length) return;
    j.repathAt = this.sim.tick + 20;
    this.sim.moveTo(w, x, y);
  }

  private near(w: SimEntity, b: SimEntity): boolean {
    const bs = b.building!;
    return rectDistance(w.mover.x, w.mover.y, b.mover.x, b.mover.y, bs.w, bs.h) <= REACH + w.stats.radius;
  }

  private updateWorker(w: SimEntity, f: FactionState): void {
    const j = w.job;
    if (!j || j.kind === 'idle' || w.targetId) return;
    const sim = this.sim;
    if (j.phase === 'return') {
      const drop = this.dropOff(w, f);
      if (!drop) return;
      if (!this.near(w, drop)) return this.walkTo(w, drop.mover.x, drop.mover.y);
      if (j.carry === 'gold') f.gold += j.amount;
      else if (j.carry === 'wood') f.wood += j.amount;
      j.carry = null;
      j.amount = 0;
      j.phase = 'go';
      j.repathAt = 0;
      w.mover.path = [];
      if (j.kind === 'wood' && !this.trees.alive[j.target]) this.nextTree(w, j, drop.mover.x, drop.mover.y);
      return;
    }
    switch (j.kind) {
      case 'gold': {
        const mine = sim.get(j.target);
        if (!mine?.alive || !mine.building || mine.building.gold <= 0) {
          const next = this.nearestMine(w.mover.x, w.mover.y);
          if (next && Math.hypot(next.mover.x - w.mover.x, next.mover.y - w.mover.y) < 30) j.target = next.id;
          else j.kind = 'idle';
          return;
        }
        const mb = mine.building;
        if (j.phase === 'work') {
          if (--j.timer > 0) return;
          mb.inside = Math.max(0, mb.inside - 1);
          w.hidden = false;
          sim.teleport(w, j.standX, j.standY);
          j.amount = Math.min(mb.gold, Math.round(E.goldPerTrip * sim.gatherFactor(f)));
          mb.gold -= j.amount;
          j.carry = 'gold';
          j.phase = 'return';
          j.repathAt = 0;
          if (mb.gold <= 0) sim.kill(mine, { id: mine.id, owner: NEUTRAL, team: NEUTRAL_TEAM });
          return;
        }
        if (!this.near(w, mine)) return this.walkTo(w, mine.mover.x, mine.mover.y);
        if (mb.inside >= E.maxWorkersPerMine) {
          j.phase = 'wait';
          w.mover.path = [];
          return;
        }
        mb.inside++;
        j.standX = w.mover.x;
        j.standY = w.mover.y;
        j.phase = 'work';
        j.timer = secs(E.mineTimeSec);
        w.mover.path = [];
        w.hidden = true;
        return;
      }
      case 'wood': {
        if (!this.trees.alive[j.target]) return this.nextTree(w, j, w.mover.x, w.mover.y);
        const tx = this.trees.x[j.target]!,
          ty = this.trees.y[j.target]!;
        if (j.phase === 'work') {
          if (--j.timer > 0) return;
          j.amount = Math.min(this.trees.wood[j.target]!, Math.round(E.woodPerTrip * sim.gatherFactor(f)));
          this.trees.wood[j.target]! -= j.amount;
          j.carry = 'wood';
          j.phase = 'return';
          j.repathAt = 0;
          if (this.trees.wood[j.target]! <= 0) this.cutTree(j.target);
          return;
        }
        if (j.standX === 0 && j.standY === 0) return this.nextTree(w, j, w.mover.x, w.mover.y);
        if (Math.hypot(w.mover.x - j.standX, w.mover.y - j.standY) > 0.35) {
          if (!w.mover.path.length && sim.tick >= j.repathAt && Math.hypot(w.mover.x - tx, w.mover.y - ty) < 1.6) {
            // Close enough even if the stand cell moved (a neighbor tree fell).
          } else return this.walkTo(w, j.standX, j.standY);
        }
        w.mover.path = [];
        w.mover.facing = Math.atan2(-(tx - w.mover.x), ty - w.mover.y);
        j.phase = 'work';
        j.timer = secs(E.chopTimeSec);
        sim.events.push(EventType.Chop, w.id, j.target);
        return;
      }
      case 'build':
      case 'repair': {
        const site = sim.get(j.target);
        const b = site?.building;
        if (!site?.alive || !b || (j.kind === 'build' && b.done) || (j.kind === 'repair' && site.hp >= site.stats.maxHp)) {
          j.kind = 'idle';
          return;
        }
        if (!this.near(w, site)) return this.walkTo(w, site.mover.x, site.mover.y);
        w.mover.path = [];
        w.mover.facing = Math.atan2(-(site.mover.x - w.mover.x), site.mover.y - w.mover.y);
        j.phase = 'work';
        b.builderId = w.id;
        const step = 1 / Math.max(1, secs(b.def?.buildTime ?? 30));
        if (j.kind === 'build') {
          b.progress = Math.min(1, b.progress + step);
          site.hp = Math.min(site.stats.maxHp, site.hp + site.stats.maxHp * (1 - SITE_HP) * step);
          if (b.progress >= 1) {
            this.finishBuilding(site);
            j.kind = 'idle';
          }
        } else site.hp = Math.min(site.stats.maxHp, site.hp + site.stats.maxHp * step);
        return;
      }
    }
  }

  private nextTree(w: SimEntity, j: WorkerJob, x: number, y: number): void {
    if (this.treeTaken.get(j.target) === w.id) this.treeTaken.delete(j.target);
    const f = this.factionOf(w);
    const hall = f ? this.sim.get(f.homeHallId) : undefined;
    // Stay near home: search from the last tree, but never far from the Town Hall.
    let t = this.findTree(x, y, 14);
    if (t && hall && Math.hypot(this.trees.x[t.tree]! - hall.mover.x, this.trees.y[t.tree]! - hall.mover.y) > WOOD_RANGE + 6) t = null;
    t ??= hall ? this.findTree(hall.mover.x, hall.mover.y) : null;
    if (!t) {
      j.kind = 'idle';
      return;
    }
    j.target = t.tree;
    j.standX = t.standX;
    j.standY = t.standY;
    j.phase = j.carry ? 'return' : 'go';
    j.repathAt = 0;
    this.treeTaken.set(t.tree, w.id);
  }

  /** The tree falls: its walk cells open (the same on every client). */
  private cutTree(i: number): void {
    const cells = removeTree(this.trees, i);
    this.blockers.openCells(cells);
    this.cutTrees.push(i);
    this.treeTaken.delete(i);
    this.sim.events.push(EventType.TreeGone, i);
  }

  // ---------- every tick ----------

  update(): void {
    const sim = this.sim;
    for (const f of this.list) {
      if (!f || f.defeated) continue;
      for (const id of f.buildings) {
        const e = sim.get(id);
        if (e?.alive) this.updateBuilding(e, f);
      }
      for (const id of f.units) {
        const u = sim.get(id);
        if (u?.alive && u.job) this.updateWorker(u, f);
      }
      if (sim.tick % 10 === f.slot) this.updateSupply(f);
    }
    if (sim.tick % TICK_RATE === 0) this.checkDefeat();
  }

  private updateBuilding(e: SimEntity, f: FactionState): void {
    const b = e.building!;
    if (!b.done) return;
    if (b.upgradeTo >= 0 && --b.upgradeLeft <= 0) this.finishTier(e, f);
    if (!b.queue.length) return;
    if (b.trainTotal === 0) b.trainTotal = b.trainLeft = Math.max(1, Math.round(secs(unitDef(ENTITY_TYPES[b.queue[0]!]!)?.buildTime ?? 20) * this.sim.trainTimeFactor(f)));
    if (--b.trainLeft > 0) return;
    const type = b.queue.shift()!;
    b.trainTotal = 0;
    // Out on the rally side of the building, then walk to the rally point.
    const dx = b.rallyX - e.mover.x,
      dy = b.rallyY - e.mover.y;
    const d = Math.hypot(dx, dy) || 1;
    const p = nearestWalkable(this.sim.nav, e.mover.x + (dx / d) * (b.w / 2 + 0.8), e.mover.y + (dy / d) * (b.h / 2 + 0.8), 12) ?? [e.mover.x, e.mover.y];
    const u = this.spawnUnit(f, type, p[0], p[1]);
    this.sim.events.push(EventType.Trained, u.id, e.id);
    if (ENTITY_TYPES[type] === 'worker') {
      const mine = this.nearestMine(e.mover.x, e.mover.y);
      if (mine) this.setJob(u, 'gold', mine.id);
    } else if (isWalkable(this.sim.nav, b.rallyX, b.rallyY)) this.sim.moveTo(u, b.rallyX, b.rallyY);
  }

  private finishTier(e: SimEntity, f: FactionState): void {
    const b = e.building!;
    const next = buildingDefOf(b.upgradeTo)!;
    const share = e.hp / e.stats.maxHp;
    e.type = b.upgradeTo;
    b.def = next;
    b.upgradeTo = -1;
    e.base = buildingStats(next);
    this.sim.applyFactionStats(e);
    e.hp = e.stats.maxHp * share;
    f.tier = Math.max(f.tier, TIER_OF[next.id] ?? 1) as 1 | 2 | 3;
    this.updateSupply(f);
    this.sim.events.push(EventType.Upgraded, e.id);
  }

  /** An entity of a faction died: clean up (a building frees its walk cells at once). */
  onDeath(e: SimEntity): void {
    if (e.job) this.releaseJob(e);
    if (e.building) {
      const b = e.building;
      if (b.def || e.type === entityTypeIndex(GOLD_MINE)) {
        if (b.def) this.blockers.removeRect(e.mover.x, e.mover.y, b.w, b.h);
      }
      b.queue.length = 0;
    }
    const f = this.factionOf(e);
    if (!f) return;
    f.buildings.delete(e.id);
    f.units.delete(e.id);
    this.updateSupply(f);
  }

  /** A team with no Town Hall (any tier, built or not) loses; the last team standing wins. */
  private checkDefeat(): void {
    if (this.winnerTeam) return;
    const alive = new Set<number>();
    for (const f of this.list) if (f && !f.defeated && this.halls(f).length) alive.add(f.team);
    for (const f of this.list) {
      if (!f || f.defeated || alive.has(f.team)) continue;
      f.defeated = true;
      f.status = 'Defeated';
      this.sim.events.push(EventType.Defeated, f.slot);
      for (const id of [...f.units, ...f.buildings]) {
        const u = this.sim.get(id);
        if (u?.alive) this.sim.kill(u, { id: u.id, owner: u.owner, team: u.team });
      }
      const hero = this.sim.heroes[f.slot];
      if (hero) {
        if (hero.alive) this.sim.kill(hero, { id: hero.id, owner: hero.owner, team: hero.team });
        if (hero.heroState) hero.heroState.respawnAt = 0;
        hero.removeAt = this.sim.tick + 60;
      }
    }
    if (this.teamsAtStart.size >= 2 && alive.size === 1) {
      this.winnerTeam = [...alive][0]!;
      this.endedAt = this.sim.tick;
      this.sim.events.push(EventType.MatchOver, this.winnerTeam);
    }
  }
}

export function blankBuilding(def: BuildingDef | null, w: number, h: number): BuildingState {
  return {
    def,
    w,
    h,
    done: false,
    progress: 0,
    builderId: 0,
    queue: [],
    trainLeft: 0,
    trainTotal: 0,
    rallyX: 0,
    rallyY: 0,
    upgradeTo: -1,
    upgradeLeft: 0,
    upgradeTotal: 0,
    gold: 0,
    inside: 0,
  };
}
