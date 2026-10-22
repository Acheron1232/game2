import {
  buildMatchNav,
  entityTypeIndex,
  FactionAI,
  difficultyRules,
  ENTITY_TYPES,
  FACTION_HERO_SLOT,
  gameData,
  MatchSim,
  parseTerrain,
  TICK_RATE,
  type Difficulty,
  type FactionState,
  type TreeList,
} from '@game/shared';
import { readSharedDataFile } from '../data-files';

export interface HeadlessOptions {
  seed: number;
  /** 2–4 slots, all bots, each its own team unless `teams` says otherwise */
  slots?: number;
  teams?: number[];
  difficulty?: ('easy' | 'normal' | 'hard')[];
  heroes?: string[];
  maxMinutes?: number;
  /** called every simulated game minute with the snapshot */
  onMinute?: (m: MinuteLog) => void;
  /** tests of the stuck check: no faction brains and hero bots */
  noAi?: boolean;
  /** extra setup after the sim is built (8b uses it to attach brains / hero bots) */
  attach?: (sim: MatchSim) => { update(): void } | void;
}

export interface FactionMinute {
  slot: number;
  team: number;
  gold: number;
  wood: number;
  workers: number;
  armySupply: number;
  supplyUsed: number;
  supplyCap: number;
  buildings: number;
  tier: number;
  heroLevel: number;
  /** the faction's own hero ("stone_golem 5"), '' before it is summoned */
  factionHero: string;
  /** neutral camps the faction's units and heroes cleared so far */
  campsCleared: number;
  /** army-vs-army fights far from every Town Hall so far */
  fieldFights: number;
  status: string;
  defeated: boolean;
}

export interface MinuteLog {
  minute: number;
  factions: FactionMinute[];
}

export interface StuckReport {
  slot: number;
  minute: number;
  seconds: number;
  gold: number;
  wood: number;
  reason: string;
}

export interface HeadlessResult {
  seed: number;
  winnerTeam: number;
  minutes: number;
  ticks: number;
  tickMsAvg: number;
  tickMsP99: number;
  tickMsMax: number;
  wallSeconds: number;
  stuck: StuckReport[];
  log: MinuteLog[];
  factions: FactionTotals[];
}

interface MapTreesFile {
  trees: TreeList;
}

const MAX_QUEUE = 5;
const STUCK_SECONDS = 60;
const TICKS_PER_MINUTE = TICK_RATE * 60;
const DIFFICULTIES = new Set<Difficulty>(['easy', 'normal', 'hard']);
const TIER_BUILDINGS = new Set(['stronghold', 'citadel']);

let cachedTerrain: ReturnType<typeof parseTerrain> | undefined;
let cachedTrees: TreeList | undefined;

function loadMap(): { terrain: ReturnType<typeof parseTerrain>; trees: TreeList } {
  cachedTerrain ??= parseTerrain(readSharedDataFile('map-terrain.bin'));
  cachedTrees ??= (JSON.parse(Buffer.from(readSharedDataFile('map-trees.json')).toString('utf8')) as MapTreesFile).trees;
  return { terrain: cachedTerrain, trees: cachedTrees };
}

function validateOptions(o: HeadlessOptions): { slots: number; maxMinutes: number } {
  const slots = o.slots ?? 4;
  const maxMinutes = o.maxMinutes ?? 60;
  if (!Number.isFinite(o.seed)) throw new Error('seed must be a number');
  if (!Number.isInteger(slots) || slots < 2 || slots > 4) throw new Error('slots must be from 2 to 4');
  if (!Number.isFinite(maxMinutes) || maxMinutes <= 0) throw new Error('maxMinutes must be greater than 0');
  for (const [name, values] of [
    ['teams', o.teams],
    ['difficulty', o.difficulty],
    ['heroes', o.heroes],
  ] as const) {
    if (values && values.length !== slots) throw new Error(`${name} must have one value per slot`);
  }
  if (o.teams?.some((team) => !Number.isInteger(team) || team <= 0)) throw new Error('teams must be positive whole numbers');
  if (o.difficulty?.some((difficulty) => !DIFFICULTIES.has(difficulty))) throw new Error('difficulty must be easy, normal or hard');
  if (o.heroes?.some((hero) => !gameData.heroes.some((def) => def.id === hero))) throw new Error('heroes contains an unknown hero id');
  return { slots, maxMinutes };
}

function heroIds(seed: number, count: number): string[] {
  const heroes = gameData.heroes.map((hero) => hero.id);
  const first = ((Math.trunc(seed) % heroes.length) + heroes.length) % heroes.length;
  return Array.from({ length: count }, (_, index) => heroes[(first + index) % heroes.length]!);
}

function buildingBusy(sim: MatchSim, f: FactionState): boolean {
  for (const id of f.buildings) {
    const building = sim.get(id);
    const state = building?.alive ? building.building : null;
    if (state && (!state.done || state.queue.length > 0 || state.upgradeTo >= 0)) return true;
  }
  return false;
}

function canBuildOrTrain(sim: MatchSim, f: FactionState): boolean {
  const factions = sim.factions!;
  let workers = 0;
  for (const id of f.units) if (sim.get(id)?.alive && sim.get(id)?.job) workers++;
  const enoughWorkers = workers >= difficultyRules(f.difficulty).workerTarget;
  // Only buildings the faction does not have yet (more Houses only while supply can grow).
  for (const def of gameData.buildings.buildings) {
    if (TIER_BUILDINGS.has(def.id) || factions.missing(f, def.requires).length > 0) continue;
    if (
      def.id === 'house'
        ? f.supplyCap >= gameData.rules.economy.supplyCap || f.supplyCap - f.supplyUsed >= 6
        : factions.has(f, def.id) || hasSite(sim, f, def.id)
    )
      continue;
    if (factions.canPay(f, def.cost)) return true;
  }
  for (const id of f.buildings) {
    const building = sim.get(id);
    const state = building?.alive ? building.building : null;
    if (!state?.done || !state.def || state.queue.length >= MAX_QUEUE) continue;
    for (const unitId of state.def.trains) {
      // Spare supply for one worker is not an opportunity when the economy has its workers.
      // Combat units need more supply: this used to flag a winning 99/100 army as stuck.
      if (unitId === 'worker' && enoughWorkers) continue;
      const unit = gameData.units.find((candidate) => candidate.id === unitId);
      if (!unit || factions.missing(f, unit.requires).length > 0 || !factions.canPay(f, unit.cost)) continue;
      if (f.supplyUsed + (unit.supply ?? 0) <= f.supplyCap) return true;
    }
  }
  return false;
}

function hasAnyWorker(sim: MatchSim, f: FactionState): boolean {
  for (const id of f.units) if (sim.get(id)?.alive && sim.get(id)?.job) return true;
  return false;
}

function hasSite(sim: MatchSim, f: FactionState, id: string): boolean {
  for (const bid of f.buildings) {
    const b = sim.get(bid);
    if (b?.alive && b.building?.def?.id === id) return true;
  }
  return false;
}

function hasWorkingWorker(sim: MatchSim, f: FactionState): boolean {
  for (const id of f.units) {
    const unit = sim.get(id);
    if (unit?.alive && ENTITY_TYPES[unit.type] === 'worker' && unit.job && unit.job.kind !== 'idle') return true;
  }
  return false;
}

function factionMinute(sim: MatchSim, f: FactionState): FactionMinute {
  let workers = 0;
  let armySupply = 0;
  let buildings = 0;
  for (const id of f.units) {
    const unit = sim.get(id);
    if (!unit?.alive) continue;
    const def = gameData.units.find((candidate) => candidate.id === ENTITY_TYPES[unit.type]);
    if (def?.id === 'worker') workers++;
    else armySupply += def?.supply ?? 0;
  }
  for (const id of f.buildings) {
    const building = sim.get(id);
    if (!building?.alive) continue;
    buildings++;
    const queue = building.building?.queue;
    if (!queue) continue;
    for (const type of queue) {
      const def = gameData.units.find((candidate) => candidate.id === ENTITY_TYPES[type]);
      if (def?.id !== 'worker') armySupply += def?.supply ?? 0;
    }
  }
  return {
    slot: f.slot,
    team: f.team,
    gold: f.gold,
    wood: f.wood,
    workers,
    armySupply,
    supplyUsed: f.supplyUsed,
    supplyCap: f.supplyCap,
    buildings,
    tier: f.tier,
    heroLevel: sim.heroes[f.slot]?.heroState?.level ?? 0,
    factionHero: factionHero(sim, f),
    campsCleared: f.campsCleared,
    fieldFights: f.fieldFights,
    status: f.status,
    defeated: f.defeated,
  };
}

function factionHero(sim: MatchSim, f: FactionState): string {
  const hs = sim.heroes[FACTION_HERO_SLOT + f.slot]?.heroState;
  return hs ? `${hs.def.id} ${hs.level}` : '';
}

/** Per faction at the end: its own hero, camps cleared, field fights. */
export interface FactionTotals {
  slot: number;
  /** the AI's character this match (personality.ts) */
  style: string;
  /** the player's hero level at the end */
  heroLevel: number;
  /** watchtowers standing at the end */
  towers: number;
  factionHero: string;
  campsCleared: number;
  fieldFights: number;
}

function minuteLog(sim: MatchSim, minute: number): MinuteLog {
  const factions: FactionMinute[] = [];
  for (const faction of sim.factions!.list) if (faction) factions.push(factionMinute(sim, faction));
  return { minute, factions };
}

function addStuck(stuck: StuckReport[], f: FactionState, ticks: number, seconds: number, reason: string): void {
  stuck.push({ slot: f.slot, minute: ticks / TICKS_PER_MINUTE, seconds, gold: f.gold, wood: f.wood, reason: `${reason} (${f.status})` });
}

export function runHeadlessMatch(o: HeadlessOptions): HeadlessResult {
  const { slots, maxMinutes } = validateOptions(o);
  const map = loadMap();
  const heroes = o.heroes ?? heroIds(o.seed, slots);
  const sim = new MatchSim(
    {
      seed: o.seed,
      slots: Array.from({ length: slots }, (_, index) => ({
        index,
        heroType: entityTypeIndex(heroes[index]!),
        team: o.teams?.[index] ?? index + 1,
        color: index,
        start: index,
        ai: o.difficulty?.[index] ?? 'normal',
        bot: true,
      })),
    },
    buildMatchNav(map.terrain, gameData.map),
    map,
  );
  // The full AI: faction brains and hero bots (o.attach can add more).
  const ai = o.noAi ? null : new FactionAI(sim);
  sim.ai = ai;
  const attached = o.attach?.(sim);
  const controller = attached || undefined;
  const maxTicks = Math.ceil(maxMinutes * TICKS_PER_MINUTE);
  const tickTimes = new Float64Array(maxTicks);
  const idleSeconds = new Uint16Array(slots);
  const noWorkerJobSeconds = new Uint16Array(slots);
  const stuck: StuckReport[] = [];
  const log: MinuteLog[] = [];
  let tickMsTotal = 0;
  let tickMsMax = 0;
  const wallStarted = performance.now();

  while (sim.tick < maxTicks && !sim.factions!.winnerTeam) {
    const tickStarted = performance.now();
    controller?.update();
    sim.step();
    const tickMs = performance.now() - tickStarted;
    tickTimes[sim.tick - 1] = tickMs;
    tickMsTotal += tickMs;
    tickMsMax = Math.max(tickMsMax, tickMs);

    if (sim.tick % TICK_RATE === 0) {
      for (const f of sim.factions!.list) {
        if (!f || f.defeated) continue;
        // Saving for something it can not pay yet is a plan, not being stuck.
        const saving = f.status.includes('Saving for');
        if (!buildingBusy(sim, f) && !saving && canBuildOrTrain(sim, f)) {
          const seconds = ++idleSeconds[f.slot]!;
          if (seconds > STUCK_SECONDS) {
            addStuck(stuck, f, sim.tick, seconds, 'idle with resources');
            idleSeconds[f.slot] = 0;
          }
        } else idleSeconds[f.slot] = 0;

        // No worker and no money for one: the economy is lost, the AI is not stuck.
        const workerCost = gameData.units.find((u) => u.id === 'worker')?.cost?.gold ?? 75;
        if (!hasWorkingWorker(sim, f) && (f.gold >= workerCost || hasAnyWorker(sim, f))) {
          const seconds = ++noWorkerJobSeconds[f.slot]!;
          if (seconds > STUCK_SECONDS) {
            addStuck(stuck, f, sim.tick, seconds, 'no worker has a job');
            noWorkerJobSeconds[f.slot] = 0;
          }
        } else noWorkerJobSeconds[f.slot] = 0;
      }
    }

    if (sim.tick % TICKS_PER_MINUTE === 0) {
      const snapshot = minuteLog(sim, sim.tick / TICKS_PER_MINUTE);
      log.push(snapshot);
      o.onMinute?.(snapshot);
    }
  }

  const wallSeconds = (performance.now() - wallStarted) / 1000;
  const measuredTimes = tickTimes.subarray(0, sim.tick);
  measuredTimes.sort();
  const p99Index = Math.max(0, Math.ceil(measuredTimes.length * 0.99) - 1);
  return {
    seed: o.seed,
    winnerTeam: sim.factions!.winnerTeam,
    minutes: sim.tick / TICKS_PER_MINUTE,
    ticks: sim.tick,
    tickMsAvg: tickMsTotal / sim.tick,
    tickMsP99: measuredTimes[p99Index] ?? 0,
    tickMsMax,
    wallSeconds,
    stuck,
    log,
    factions: sim
      .factions!.list.filter((f) => !!f)
      .map((f) => ({
        slot: f.slot,
        style: ai?.brain(f.slot)?.personality.style ?? '',
        heroLevel: sim.heroes[f.slot]?.heroState?.level ?? 0,
        towers: sim.entities.filter((e) => e.alive && e.owner === f.slot && e.building?.done && e.building.def?.id === 'watchtower').length,
        factionHero: factionHero(sim, f),
        campsCleared: f.campsCleared,
        fieldFights: f.fieldFights,
      })),
  };
}
