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
import { isTownHall, unitDef, type Factions, type FactionState } from './faction';
import { clearKingdomOrder, orderLabel, type KingdomOrder } from './orders';
import { makePersonality, spotNoise, type BuildStep, type Personality } from './personality';
import { baseCorridors, findBuildSpot, type Rect } from './placement';
import { tryFortify, WALL_RULES } from './fortifications';
import { factionRules, type ArmyRules, type DifficultyRules, type MixTier, type UnitMix } from './tuning';

type Step = BuildStep;

const AI = gameData.ai.faction as unknown as {
  buildOrder: Step[];
  attack: { gatherPointDistance: number; waitForStragglersSec: number; retargetEverySec: number; creepCampsWhenIdle: boolean };
};
const HERO_RULES = gameData.ai.faction.factionHero;
const ORDERS = gameData.ai.faction.orders;

const COLOR_NAMES = ['Red', 'Blue', 'Teal', 'Purple'];
const PRODUCTION = new Set(gameData.buildings.buildings.filter((b) => b.trains.some((id) => id !== 'worker')).map((b) => b.id));
const WOOD_SHARE = 0.3;
/** wood is plenty above this (and more than gold): fewer woodcutters */
const WOOD_PLENTY = 400;
/** a mine takes about this many workers before they wait at the door */
const MAX_GOLD_WORKERS_PER_MINE = 12;
/** a mine belongs to a Town Hall this close */
const MINE_TO_HALL = 16;
/** enemies this close to a Town Hall mean the base is under attack */
const BASE_RADIUS = 24;
/** keep this much army supply at home after the first attack */
const DEFENSE_SUPPLY = 4;
const BUILD_RADIUS_EXPANSION = 12;
const WOUNDED_PCT = 0.25;
const MILITIA_HALL_PCT = 0.3;
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
/** ...and this much in the late game, past the towers and houses of a big base */
const HALL_BONUS_LATE = 40;
/** an enemy with this many towers gets more catapults from us */
const MANY_TOWERS = 6;
const CATAPULTS_VS_TOWERS = 0.15;
/** a tower whose price has risen is built only with this much more gold than it costs (army money) */
const RISEN_PRICE_SPARE = 1.5;
/** with this much gold a faction does not need a new mine badly: its army is not called back */
const RICH_NO_RECALL = 1500;
/** a reinforcement wave this close to the attack army joins it */
const WAVE_JOIN = 15;
/** the base may grow this far past its build area, in steps of BASE_GROW_STEP */
const BASE_GROW_MAX = 18;
const BASE_GROW_STEP = 6;
/** no free spot for a building: try again after this long */
const NO_SPOT_RETRY_SEC = 20;
/** expansion towers are placed within this distance of their Town Hall */
const EXPANSION_TOWER_RADIUS = 13;
/** workers repair buildings below this share of health (towers: a bit higher) */
const REPAIR_BELOW = 0.7;
const REPAIR_TOWER_BELOW = 0.85;
/** a building takes one repairer, a tower under attack two */
const MAX_REPAIRERS = 3;
/** an enemy tower counts like this much army supply when we decide to attack */
const TOWER_STRENGTH = 3;
/** our army must be this much stronger than the defense it attacks into... */
const ATTACK_EDGE = 1.15;
/** ...but after waiting this long with a ready army it goes anyway */
const ATTACK_WAIT_MAX_SEC = 75;
/** enemy units this close to their Town Hall defend it */
const DEFENDERS_RADIUS = 30;

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
  /** ai.json army numbers (with this faction's MatchSetup.aiTuning, tools only) */
  readonly armyRules: ArmyRules;
  private readonly unitMix: UnitMix;
  private readonly thinkTicks: number;
  private readonly trained = new Map<string, number>();
  private lastStepAt = -Infinity;
  private fortifyAt = 0;
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
  /** this match's character: base layout, towers, timings (personality.ts) */
  readonly personality: Personality;
  /** how far the base has grown past its build area */
  private baseGrow = 0;
  /** building id → tick until which we do not look for a spot again */
  private readonly noSpotUntil = new Map<string, number>();
  private expansions = 0;
  /** tick since when the army is big enough but waits for more against strong defense */
  private waitingSince = 0;

  constructor(
    private readonly sim: MatchSim,
    private readonly fs: Factions,
    readonly f: FactionState,
    private readonly army: ArmyMover,
  ) {
    const tuned = factionRules(f.difficulty, sim.setup.aiTuning?.[f.slot]);
    this.rules = tuned.rules;
    this.armyRules = tuned.army;
    this.unitMix = tuned.unitMix;
    this.personality = makePersonality(sim.setup.seed, f.slot, AI.buildOrder);
    // Team match: a second player plays the kingdom's own hero, so no Hero Shrine.
    if (sim.setup.teams && sim.heroes[FACTION_HERO_SLOT + f.slot])
      this.personality.buildOrder = this.personality.buildOrder.filter((s) => s.what !== 'hero_shrine' && s.do !== 'summon');
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
    this.checkOrder();
    this.findThreat();
    this.expansion();
    this.workers();
    this.houses();
    this.heroThink();
    this.buildOrder();
    // Under attack the army comes first: savings may be spent on units.
    if (this.threat && !this.urgent) this.reserveGold = this.reserveWood = 0;
    this.production();
    if (!this.threat && !this.savingFor && this.home && this.sim.tick >= this.fortifyAt) {
      this.fortifyAt = this.sim.tick + WALL_RULES.everySec * TICK_RATE;
      const action = tryFortify(this.sim, this.f, this.home, (x, y) => this.builder(x, y));
      if (action) this.doing = action;
    }
    this.repair();
    this.armyThink();
    f.attacking = this.armyState === 'attack' ? this.attackSlot : -1;
    f.status = this.status = this.statusWithOrder();
  }

  // ---------- orders ----------

  /** The players' order (orders.ts). An attack on a kingdom that is gone ends: back to auto. */
  private checkOrder(): void {
    const f = this.f;
    if (f.order !== 'attack') return;
    const t = this.fs.get(f.orderTarget);
    if (!t || t.defeated || t.team === f.team) clearKingdomOrder(f);
  }

  private get order(): KingdomOrder {
    return this.f.order;
  }

  private readonly campArea = { x: 0, y: 0, range: 0 };

  /** Bot heroes of the kingdom farm only near home while the order keeps the army there. */
  heroCampArea(): { x: number; y: number; range: number } | null {
    const home = this.home;
    if (!home || !this.stayHome()) return null;
    this.campArea.x = home.mover.x;
    this.campArea.y = home.mover.y;
    this.campArea.range = ORDERS.heroCampRange[this.order === 'defend' ? 'defend' : 'build_up'];
    return this.campArea;
  }

  /** Orders that keep the army at home (it fights only near the base). */
  private stayHome(): boolean {
    return this.order === 'defend' || this.order === 'build_up';
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
    if (f.supplyCap >= Math.min(gameData.rules.economy.supplyCap, this.armyRules.trainUpToSupply + this.personality.houseAhead)) return;
    if (f.supplyCap - f.supplyUsed >= this.personality.houseAhead || this.siteOf('house')) return;
    if (this.savingFor === 'Town Hall' && f.supplyCap - f.supplyUsed > 1) return;
    this.tryBuild('house');
  }

  /** Starts a building at a free spot of the home base. False when it can not (yet). */
  /** `save`: keep the money for it when it can not be paid yet (off for "nice to have" buildings). */
  private tryBuild(id: string, near?: { x: number; y: number; radius: number }, save = true): boolean {
    const f = this.f;
    const def = buildingDef(id);
    if (!def || this.fs.missing(f, def.requires).length) return false;
    const cost = this.fs.buildCost(f, def);
    if (!this.fs.canPay(f, cost)) {
      if (save) this.save(def.name, cost.gold, cost.wood);
      return false;
    }
    const key = near ? `${id}@${Math.round(near.x)},${Math.round(near.y)}` : id;
    if (this.sim.tick < (this.noSpotUntil.get(key) ?? 0)) return false;
    const spot = near ? this.spotNear(def, near.x, near.y, near.radius) : this.spotInBase(def);
    if (!spot) {
      this.noSpotUntil.set(key, this.sim.tick + NO_SPOT_RETRY_SEC * TICK_RATE);
      return false;
    }
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

  /**
   * A spot in the home base, picked by the personality: buildings lean toward its grow side,
   * houses toward theirs, towers stand at the edge facing the map center and keep apart. When
   * the build area is full the base grows (up to BASE_GROW_MAX), so it never stops at one shape.
   */
  private spotInBase(def: BuildingDef): { x: number; y: number } | null {
    const start = gameData.map.starts[this.f.start]!;
    const hall = this.sim.get(this.f.homeHallId);
    const hx = hall?.alive ? hall.mover.x : start.townHall[0],
      hy = hall?.alive ? hall.mover.y : start.townHall[1];
    // Towers search from the build area each time: they stand at its edge, not far out.
    const tower = def.id === 'watchtower';
    for (let grow = tower ? 0 : this.baseGrow; grow <= BASE_GROW_MAX; grow += BASE_GROW_STEP) {
      const [cx, cy] = start.buildArea.center;
      const spot = this.spotAround(def, hx, hy, cx, cy, start.buildArea.radius + grow, grow > 0);
      if (spot) {
        if (!tower) this.baseGrow = grow;
        return spot;
      }
    }
    if (!tower) this.baseGrow = BASE_GROW_MAX;
    return null;
  }

  /** A spot within `radius` of (cx, cy) for a base whose Town Hall stands at (hx, hy). */
  private spotAround(
    def: BuildingDef,
    hx: number,
    hy: number,
    cx: number,
    cy: number,
    radius: number,
    open = false,
  ): { x: number; y: number } | null {
    const p = this.personality;
    const mine = this.fs.nearestMine(hx, hy);
    const c = this.sim.size / 2;
    const tower = def.id === 'watchtower';
    let score: (x: number, y: number) => number;
    if (tower) {
      // Toward the map center (turned a little by the personality), at the edge, apart.
      const a = Math.atan2(c - hy, c - hx) + p.towerTurn;
      const ax = Math.cos(a),
        ay = Math.sin(a);
      const towers = this.towersNear(hx, hy, radius * 2);
      score = (x, y) => {
        const dx = x - hx,
          dy = y - hy;
        let s = -(dx * ax + dy * ay) - Math.hypot(dx, dy) * 0.4 + spotNoise(x, y, p.noiseSeed) * p.noise;
        for (const t of towers) {
          const d = Math.hypot(t.mover.x - x, t.mover.y - y);
          if (d < p.towerGap) s += (p.towerGap - d) * 6;
        }
        return s;
      };
    } else {
      const a = def.id === 'house' ? p.houseAngle : p.growAngle;
      const ax = Math.cos(a),
        ay = Math.sin(a);
      score = (x, y) => {
        const dx = x - hx,
          dy = y - hy;
        return Math.hypot(dx, dy) - (dx * ax + dy * ay) * p.growPull + spotNoise(x, y, p.noiseSeed) * p.noise;
      };
    }
    return findBuildSpot(this.fs.terrain, this.sim.nav, {
      footprint: [def.footprint[0], def.footprint[1]],
      center: [cx, cy],
      radius,
      townHall: [hx, hy],
      existing: this.rects(hx, hy, radius + 8),
      corridors: mine ? baseCorridors([hx, hy], [mine.mover.x, mine.mover.y], [c, c], radius) : [],
      spacing: tower ? 1 : p.spacing,
      minFromTownHall: tower ? 3 : 1.5,
      // Outside the build area only on open ground, so a building never closes a narrow path.
      ...(open ? { clearance: 2 } : {}),
      score,
    });
  }

  /** Our watchtowers (sites too) whose nearest own Town Hall is this one. */
  private towersOf(hall: SimEntity): number {
    const halls = this.fs.halls(this.f);
    let n = 0;
    for (const t of this.towersNear(hall.mover.x, hall.mover.y, Infinity)) {
      const d = Math.hypot(t.mover.x - hall.mover.x, t.mover.y - hall.mover.y);
      if (halls.every((h) => h === hall || Math.hypot(t.mover.x - h.mover.x, t.mover.y - h.mover.y) >= d)) n++;
    }
    return n;
  }

  /** Our watchtowers (sites too) within r of a point. */
  private towersNear(x: number, y: number, r: number): SimEntity[] {
    const out: SimEntity[] = [];
    for (const id of this.f.buildings) {
      const b = this.sim.get(id);
      if (b?.alive && b.building?.def?.id === 'watchtower' && Math.hypot(b.mover.x - x, b.mover.y - y) <= r) out.push(b);
    }
    return out;
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

  /**
   * Workers repair hurt buildings (free, like building). Towers first and a little earlier; while
   * the base is under attack only towers, so the rest of the workers keep mining.
   */
  private repair(): void {
    let repairers = 0;
    const busy = new Set<number>();
    for (const id of this.f.units) {
      const u = this.sim.get(id);
      if (u?.alive && u.job?.kind === 'repair') {
        repairers++;
        busy.add(u.job.target);
      }
    }
    if (repairers >= MAX_REPAIRERS) return;
    let pick: SimEntity | null = null,
      worst = Infinity;
    for (const id of this.f.buildings) {
      const b = this.sim.get(id);
      if (!b?.alive || !b.building?.done || busy.has(b.id)) continue;
      const tower = b.building.def?.id === 'watchtower';
      if (this.threat && !tower) continue;
      const share = b.hp / b.stats.maxHp;
      if (share >= (tower ? REPAIR_TOWER_BELOW : REPAIR_BELOW)) continue;
      const score = share - (tower ? 0.3 : 0);
      if (score < worst) {
        worst = score;
        pick = b;
      }
    }
    if (!pick) return;
    const worker = this.builder(pick.mover.x, pick.mover.y);
    if (worker) this.fs.setJob(worker, 'repair', pick.id);
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
    const steps = this.personality.buildOrder;
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

  /**
   * After the build order the base keeps growing: tier ups, more watchtowers over time (main
   * base first, then every expansion), and more production buildings for the unit mix.
   */
  private freePlay(): void {
    const f = this.f;
    const p = this.personality;
    if (this.siteCount() >= (f.gold > 1000 ? 3 : 2)) return;
    if (f.tier < 3) {
      if (this.tierUp()) return;
    }
    const home = this.home!;
    const minute = this.sim.tick / (60 * TICK_RATE);
    // No fixed limit: every tower above the free count costs more (rules.json buildingPriceRise),
    // and each personality pays only up to its own price limit.
    const towers =
      this.rules.towersAtBase +
      p.extraTowers +
      Math.floor(Math.max(0, minute - 8) / p.towerEveryMin) +
      (this.order === 'defend' ? ORDERS.defendExtraTowers : 0);
    const towerOk = this.towerPriceOk();
    if (towerOk && this.towersOf(home) < towers && this.tryBuild('watchtower', undefined, !this.towerPriceRisen())) return;
    for (const h of this.fs.halls(f)) {
      if (!towerOk) break;
      if (h === home || !h.building!.done) continue;
      if (this.towersOf(h) >= p.towersPerExpansion) continue;
      if (this.buildTowerAt(h)) return;
    }
    // More production when money piles up.
    if (this.productionCount() < this.rules.maxProductionBuildings + p.extraProduction && f.gold > 500) {
      const next = this.nextProduction();
      if (next) this.tryBuild(next);
    }
  }

  /** The next tower's price is within this personality's limit (and affordable when it has risen). */
  private towerPriceOk(): boolean {
    const def = buildingDef('watchtower')!;
    const cost = this.fs.buildCost(this.f, def);
    if (cost.gold > def.cost.gold * this.personality.towerPriceLimit) return false;
    return !this.towerPriceRisen() || (this.f.gold - this.f.earmarkedGold >= cost.gold * RISEN_PRICE_SPARE && this.f.wood >= cost.wood);
  }

  private towerPriceRisen(): boolean {
    const def = buildingDef('watchtower')!;
    return this.fs.buildCost(this.f, def).gold > def.cost.gold;
  }

  /** Finished towers of the enemy we attack (or the next one we would attack). */
  private enemyTowers(): number {
    const slot = this.attackSlot >= 0 ? this.attackSlot : (this.pickEnemy()?.owner ?? -1);
    const o = slot >= 0 ? this.fs.get(slot) : null;
    if (!o || o.defeated) return 0;
    let n = 0;
    for (const id of o.buildings) {
      const b = this.sim.get(id);
      if (b?.alive && b.building?.done && b.building.def?.id === 'watchtower') n++;
    }
    return n;
  }

  /** A watchtower at an expansion Town Hall. */
  private buildTowerAt(hall: SimEntity): boolean {
    const f = this.f;
    const def = buildingDef('watchtower')!;
    if (this.fs.missing(f, def.requires).length) return false;
    const cost = this.fs.buildCost(f, def);
    if (!this.fs.canPay(f, cost)) {
      if (!this.towerPriceRisen()) this.save(def.name, cost.gold, cost.wood);
      return false;
    }
    const key = `watchtower@${hall.id}`;
    if (this.sim.tick < (this.noSpotUntil.get(key) ?? 0)) return false;
    const spot = this.spotAround(def, hall.mover.x, hall.mover.y, hall.mover.x, hall.mover.y, EXPANSION_TOWER_RADIUS, true);
    if (!spot) {
      this.noSpotUntil.set(key, this.sim.tick + NO_SPOT_RETRY_SEC * TICK_RATE);
      return false;
    }
    const worker = this.builder(spot.x, spot.y);
    if (!worker || !this.fs.startBuilding(f, 'watchtower', spot.x, spot.y, worker)) return false;
    this.doing = 'Building a tower at the expansion';
    return true;
  }

  /** The production building whose units the mix wants most, per building we already have. */
  private nextProduction(): string | null {
    const mix = this.mix();
    let best: string | null = null,
      bestScore = Infinity;
    for (const id of PRODUCTION) {
      const def = buildingDef(id);
      if (!def || this.fs.missing(this.f, def.requires).length) continue;
      let want = 0;
      for (const u of def.trains) want += mix[u] ?? 0;
      if (want <= 0) continue;
      const score = (this.count(id) + 1) / want;
      if (score < bestScore) {
        bestScore = score;
        best = id;
      }
    }
    return best;
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
    const base = this.unitMix[`tier${f.tier}` as MixTier];
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
    // Against a base full of towers catapults pay (they outrange towers).
    if (f.tier >= 2 && this.enemyTowers() >= MANY_TOWERS) {
      shift(['catapult'], 'swordsman', CATAPULTS_VS_TOWERS * 0.5);
      shift(['catapult'], 'archer', CATAPULTS_VS_TOWERS * 0.5);
    }
    for (const id in m) m[id] = (m[id] ?? 0) * (this.personality.mixScale[id] ?? 1);
    return m;
  }

  private production(): void {
    const f = this.f;
    // Upkeep: above this, more soldiers cost more gold income than they are worth (unless the
    // base is attacked).
    if (f.supplyUsed >= this.armyRules.trainUpToSupply && !this.threat) return;
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
    const base = this.rules.expandAtMinute;
    const at = base === null ? null : Math.max(4, base + this.personality.expandShift);
    let left = 0;
    for (const m of this.mineOfHall.values()) left += this.sim.get(m)?.building?.gold ?? 0;
    const low = left < LOW_GOLD;
    this.urgent = left < URGENT_GOLD;
    const minute = this.sim.tick / (60 * TICK_RATE);
    const second = this.personality.secondExpandMinute;
    const ordered = this.order === 'expand';
    const timeUp =
      ordered ||
      (at !== null && minute >= at && !this.expanded) ||
      (at !== null && second !== null && minute >= second && this.expansions < 2 && this.fs.halls(this.f).length < 3);
    if (!low && !timeUp) return;
    for (const h of this.fs.halls(this.f)) if (!h.building!.done) return; // one at a time
    const spot = this.freeExpansion();
    if (!spot) {
      if (ordered) clearKingdomOrder(this.f);
      return;
    }
    const [tx, ty] = spot;
    // Monsters or enemies there: the army clears it first. When the gold runs low (or the
    // players ordered it) this comes before any attack: the attack army is called back for it.
    // The Town Hall money is kept only once the spot is free: keeping it while the army is busy
    // elsewhere froze a kingdom's gold (and its army) for many minutes.
    if (this.hostilesNear(tx, ty, 10)) {
      const gather = this.gather;
      // Rich and late: the gold can wait, the army ends the game first.
      const rich = this.f.gold >= RICH_NO_RECALL;
      if (gather && this.armyState !== 'creep' && !this.stayHome() && !(rich && this.lateGame())) {
        // ...but never out of a siege: the enemy base is worth more than the camp.
        if (
          (low || ordered) &&
          !rich &&
          this.attack &&
          (this.armyState === 'attack' || this.armyState === 'retreat') &&
          !this.sieging(this.attack)
        ) {
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
      this.expansions++;
      if (ordered) clearKingdomOrder(this.f);
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

  /** Our heroes (the faction's and the player's) as army strength, when alive and near the point. */
  private heroStrengthNear(x: number, y: number, r: number): number {
    let s = 0;
    for (const hero of [this.f.heroId ? this.sim.get(this.f.heroId) : undefined, this.sim.heroes[this.f.slot]])
      if (hero?.alive && hero.heroState && Math.hypot(hero.mover.x - x, hero.mover.y - y) <= r) s += heroStrength(hero);
    return s;
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
    if (this.order === 'attack') return ORDERS.attackMinSupply;
    const need = Math.round(
      (this.attacks === 0 ? this.rules.firstAttackArmySupply : this.rules.attackArmySupply) * this.personality.attackScale,
    );
    // Upkeep eats the income of a big army: one that waits only costs, so it goes with what it
    // has (at least half the usual size).
    if (this.f.supplyUsed >= this.armyRules.attackAtSupplyUsed && this.gather)
      return Math.max(Math.ceil(need / 2), Math.min(need, this.groupSupply(this.gather)));
    return need;
  }

  /**
   * How strong the defense of an enemy base looks: its towers and the army units near its Town
   * Hall (in army supply). The AI knows this like a player who scouted.
   */
  private defenseOf(hall: SimEntity): number {
    let d = 0;
    this.sim.grid.query(hall.mover.x, hall.mover.y, DEFENDERS_RADIUS, (o) => {
      if (!o.alive || o.owner !== hall.owner || o.job) return;
      if (o.building) {
        if (o.building.done && o.building.def?.id === 'watchtower') d += TOWER_STRENGTH;
      } else if (o.heroState) d += heroStrength(o);
      else d += supplyOf(o);
    });
    return d;
  }

  /**
   * Late game (ai.json army.lateGameMinute): no more camps, no home group, no retreat — the
   * whole army attacks. Long games between equal armies end instead of trading forever.
   */
  private lateGame(): boolean {
    return this.sim.tick >= this.armyRules.lateGameMinute * 60 * TICK_RATE;
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
    if (supply >= this.armyRules.roamAtSupply && this.startHunt(gather)) return;
    // Orders that keep the army out of attacks: home (defend, build up), camps (farm), or the
    // expansion (expansion() moves the army there).
    if (this.stayHome()) {
      this.doing ||= this.order === 'defend' ? 'Army guards the base' : `Building up the army (${supply} supply)`;
      return;
    }
    if (this.order === 'farm') {
      if (supply > 0 && this.startCreep(gather, supply)) return;
      this.doing ||= 'No camp to farm right now';
      return;
    }
    if (this.order === 'expand') return;
    if (supply < need || !target) {
      this.readyAt = 0;
      this.waitingSince = 0;
      if (
        AI.attack.creepCampsWhenIdle &&
        this.order !== 'attack' &&
        supply >= this.armyRules.roamAtSupply &&
        (!target || !this.lateGame()) &&
        this.startCreep(gather, supply)
      )
        return;
      if (supply > 0 && target) this.doing ||= `Army gathering (${supply} / ${need} supply)`;
      return;
    }
    // Strong defense there: grow the army a bit more first (camps meanwhile). An attack order
    // goes anyway.
    if (this.order !== 'attack' && !this.strongEnough(gather, target)) {
      if (AI.attack.creepCampsWhenIdle && this.startCreep(gather, supply)) return;
      this.doing ||= 'Army waiting: their defense is strong';
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

  /**
   * Our group can take on the defense of the target base (towers and army at home there). A
   * ready army that waited ATTACK_WAIT_MAX_SEC goes anyway, so equal games do not stall.
   */
  private strongEnough(g: ArmyGroup, target: SimEntity): boolean {
    if (this.lateGame() || this.rules.targetChoice === 'closest' || this.groupStrength(g) >= this.defenseOf(target) * ATTACK_EDGE) {
      this.waitingSince = 0;
      return true;
    }
    if (!this.waitingSince) this.waitingSince = this.sim.tick;
    return this.sim.tick - this.waitingSince >= ATTACK_WAIT_MAX_SEC * TICK_RATE;
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
    if (this.groupSupply(gather) < this.defenseSupply() + this.armyRules.reinforceSupply) return;
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
    const tierRadius = this.armyRules.roamRadius[this.f.tier - 1] ?? this.armyRules.roamRadius[this.armyRules.roamRadius.length - 1]!;
    const radius = this.order === 'farm' ? Math.max(tierRadius, ORDERS.farmRoamRadius) : tierRadius;
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
      if (!level || level > strength * this.armyRules.campLevelPerSupply) continue;
      if (flyers && flyers > antiAir * this.armyRules.campLevelPerSupply) continue;
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
    // An attack order does not wait for a slow camp fight: a big enough army leaves it now.
    if (!done && !(this.order === 'attack' && supply >= this.attackNeed())) {
      this.doing ||= camp ? 'Army clearing a camp' : 'Clearing the expansion';
      return;
    }
    this.creepCamp = -1;
    if (this.stayHome() || this.order === 'expand') return this.backToRally(gather);
    // Strong enough now (or ordered): attack straight from here (the army is together already).
    const target = this.pickEnemy();
    this.noEnemy = !target;
    if (target && this.order !== 'farm' && supply >= this.attackNeed() && (this.order === 'attack' || this.strongEnough(gather, target)))
      return this.launchAttack(gather, target);
    // Healthy: on to the next camp, else home to heal and gather.
    const farming = this.order === 'farm' || !this.lateGame();
    if (farming && this.groupHealth(gather) * 100 >= this.armyRules.roamMinHpPct && this.startCreep(gather, supply)) return;
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
    if (!this.enemyArmyNear(g, this.armyRules.huntRange)) return false;
    const home = this.home!;
    if (this.stayHome() && Math.hypot(this.enemy.x - home.mover.x, this.enemy.y - home.mover.y) > ORDERS.stayHomeRange) return false;
    const ours = this.groupStrength(g);
    const theirs = this.enemy.strength;
    if (ours >= theirs * this.armyRules.huntStrengthRatio) {
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
    if (theirs > ours * 1.5 && d < this.armyRules.huntRange * 0.6 && this.armyState !== 'gather') {
      this.backToRally(g);
      return true;
    }
    return false;
  }

  private huntThink(g: ArmyGroup): void {
    const supply = this.groupSupply(g);
    if (supply === 0 || this.sim.tick >= this.huntUntil || !this.enemyArmyNear(g, this.armyRules.huntRange)) {
      // They are gone (dead, fled, out of sight). Won with enough army left: push on to their
      // base while they rebuild. Else attack from here when strong enough, else on to a camp,
      // else home.
      if (this.stayHome() || this.order === 'expand') return this.backToRally(g);
      const health = this.groupHealth(g);
      const beaten = this.order === 'auto' && this.huntSlot >= 0 ? this.fs.get(this.huntSlot) : null;
      const theirHall = beaten && !beaten.defeated ? this.fs.halls(beaten)[0] : undefined;
      if (theirHall && health >= 0.5 && supply * 100 >= this.attackNeed() * this.armyRules.pushAfterWinPct) {
        this.launchAttack(g, theirHall);
        this.doing = `Pushing on to ${this.colorName(theirHall.owner)} after a won fight`;
        return;
      }
      const target = this.pickEnemy();
      if (target && this.order !== 'farm' && supply >= this.attackNeed() && (this.order === 'attack' || this.strongEnough(g, target)))
        return this.launchAttack(g, target);
      if (supply && health * 100 >= this.armyRules.roamMinHpPct && this.startCreep(g, supply)) return;
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
    if (Math.hypot(this.center.x - a.targetX, this.center.y - a.targetY) > this.armyRules.siegeRange) return false;
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
    // The players called the attack off (defend, build up, farm, expand): the army comes home.
    if (this.order !== 'auto' && this.order !== 'attack') {
      this.army.setGoal(a, 'retreat', this.rally.x, this.rally.y);
      this.armyState = 'retreat';
      return;
    }
    // Ordered to attack another kingdom: turn to it now.
    if (this.order === 'attack' && this.attackSlot !== this.f.orderTarget) {
      const t = this.pickEnemy();
      if (t) {
        this.attackTargetId = t.id;
        this.attackSlot = t.owner;
        this.retargetAt = sim.tick + AI.attack.retargetEverySec * TICK_RATE;
      }
    }
    // Hard: hurt units walk home and join the home group.
    if (this.rules.pullWoundedUnits && this.gather)
      for (const id of [...a.members]) {
        const u = sim.get(id);
        if (u?.alive && u.hp < u.stats.maxHp * WOUNDED_PCT) this.army.add(this.gather, id);
      }
    // A maxed-out, rich faction does not retreat: its losses come back at once as new waves.
    const f = this.f;
    const refills = f.supplyUsed >= this.armyRules.trainUpToSupply - 8 && f.gold > RICH_GOLD;
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
      this.army.center(a, this.center) &&
      Math.hypot(this.center.x - target.mover.x, this.center.y - target.mover.y) > this.armyRules.siegeRange;
    if (
      far &&
      this.enemyArmyNear(a, this.armyRules.huntRange * 0.7) &&
      this.groupStrength(a) >= this.enemy.strength * this.armyRules.huntStrengthRatio
    ) {
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
        if (Math.hypot(h.mover.x - this.center.x, h.mover.y - this.center.y) < this.armyRules.fieldFightMinFromBase) return;
    }
    this.lastFieldFightAt = this.sim.tick;
    this.f.fieldFights++;
  }

  /**
   * The enemy faction to attack, by difficulty (or the players' attack order), and the building
   * to walk to.
   */
  private pickEnemy(): SimEntity | null {
    const fs = this.fs;
    const home = this.home!;
    if (this.order === 'attack') {
      const o = fs.get(this.f.orderTarget);
      const hall = o && !o.defeated ? this.nearestHall(o) : null;
      if (hall) return hall;
    }
    let best: SimEntity | null = null,
      bestScore = Infinity;
    const hero = this.sim.heroes[this.f.slot];
    for (const o of fs.list) {
      if (!o || o.defeated || o.team === this.f.team) continue;
      const hall = this.nearestHall(o);
      if (!hall) continue;
      const d = Math.hypot(hall.mover.x - home.mover.x, hall.mover.y - home.mover.y);
      let score = d;
      if (this.rules.targetChoice !== 'closest') {
        // Weaker factions (fewer buildings and army) are better targets; a base whose army is
        // away has a low defense. A kingdom another AI attacks now is a good target too (it
        // fights on two sides), and we stick to our last target unless another is much better.
        score = d * 0.5 + (o.buildings.size * 4 + o.supplyUsed) * 2 + this.defenseOf(hall) * 3;
        for (const other of fs.list) if (other && other !== this.f && !other.defeated && other.attacking === o.slot) score -= 40;
        if (o.slot === this.attackSlot) score -= 25;
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

  /** The Town Hall of that faction nearest to our home. */
  private nearestHall(o: FactionState): SimEntity | null {
    const home = this.home!;
    let best: SimEntity | null = null,
      bestD = Infinity;
    for (const h of this.fs.halls(o)) {
      const d = Math.hypot(h.mover.x - home.mover.x, h.mover.y - home.mover.y);
      if (d < bestD) {
        bestD = d;
        best = h;
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
        const bonus = isTownHall(b) ? (this.lateGame() ? HALL_BONUS_LATE : HALL_BONUS) : 0;
        const d = Math.hypot(b.mover.x - this.center.x, b.mover.y - this.center.y) - bonus;
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
    else if (this.armyState === 'gather' && (this.order === 'auto' || this.order === 'attack'))
      army = this.noEnemy
        ? 'No enemy left to attack'
        : supply < need
          ? `Next attack: ${supply}/${need} army supply`
          : 'Next attack: army on the way to the rally point';
    return [saving || (d.startsWith('Army clearing') ? '' : d) || 'Gathering gold and wood', army].filter(Boolean).join(' · ');
  }

  /** The status line, with the players' order in front when there is one. */
  private statusWithOrder(): string {
    const line = this.statusLine();
    return this.f.order === 'auto' ? line : `Order: ${orderLabel(this.sim, this.f)} · ${line}`;
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
    for (const b of this.brains) {
      // Team match: the second player's hero is played like a player's (setHeroBot), not here.
      if (sim.setup.teams && sim.setup.slots.some((s) => s.index === FACTION_HERO_SLOT + b.f.slot)) continue;
      this.factionBots.push(
        new HeroBot(FACTION_HERO_SLOT + b.f.slot, b.f.difficulty, {
          armyTarget: () => b.armyTarget(),
          baseUnderAttack: () => b.threat,
          withArmy: () => b.armyOut(),
          withArmyFromLevel: HERO_RULES.followArmyFromLevel,
          campArea: () => b.heroCampArea(),
        }),
      );
    }
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
    // The second player of a team match plays for the kingdom of slot - FACTION_HERO_SLOT.
    const kingdom = slot >= FACTION_HERO_SLOT ? slot - FACTION_HERO_SLOT : slot;
    const brain = this.brain(kingdom);
    this.bots.push(
      new HeroBot(slot, (s.ai ?? 'normal') as BotDifficulty, {
        kingdom,
        armyTarget: () => brain?.armyTarget() ?? null,
        baseUnderAttack: () => brain?.threat ?? null,
        // The player's hero levels with the army too: camps and fights with it, not alone.
        withArmy: () => brain?.armyOut() ?? null,
        withArmyFromLevel: HERO_RULES.followArmyFromLevel,
        campArea: () => brain?.heroCampArea() ?? null,
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
