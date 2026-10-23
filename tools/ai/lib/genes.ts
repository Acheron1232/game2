// The numbers the self-play tuner changes ("genes"), how a candidate is mutated and mixed, and
// how a match result is scored. No processes and no matches here, so it can be tested.

import { factionRules, type FactionTuning, type MixTier, type Rng, type UnitMix } from '@game/shared';

type DifficultyGene = 'firstAttackArmySupply' | 'attackArmySupply' | 'retreatAtArmyPct' | 'expandAtMinute';
type ArmyGene =
  | 'roamAtSupply'
  | 'huntStrengthRatio'
  | 'reinforceSupply'
  | 'attackAtSupplyUsed'
  | 'trainUpToSupply'
  | 'pushAfterWinPct'
  | 'campLevelPerSupply';

interface Range {
  low: number;
  high: number;
  /** whole numbers only */
  whole: boolean;
}

/** The tuned difficulty: only `normal` (the default of bot slots and the headless runner). */
export const TUNED_DIFFICULTY = 'normal';

export const DIFFICULTY_GENES: Record<DifficultyGene, Range> = {
  firstAttackArmySupply: { low: 14, high: 60, whole: true },
  attackArmySupply: { low: 20, high: 80, whole: true },
  retreatAtArmyPct: { low: 0, high: 50, whole: true },
  expandAtMinute: { low: 5, high: 18, whole: true },
};

export const ARMY_GENES: Record<ArmyGene, Range> = {
  roamAtSupply: { low: 2, high: 20, whole: true },
  huntStrengthRatio: { low: 0.5, high: 1.6, whole: false },
  reinforceSupply: { low: 4, high: 30, whole: true },
  attackAtSupplyUsed: { low: 60, high: 140, whole: true },
  trainUpToSupply: { low: 80, high: 170, whole: true },
  pushAfterWinPct: { low: 20, high: 100, whole: true },
  campLevelPerSupply: { low: 0.3, high: 1.2, whole: false },
};

/** a unit's share of its tier's mix never drops under this (the AI keeps every unit type) */
const MIN_SHARE = 0.03;
const TIERS: MixTier[] = ['tier1', 'tier2', 'tier3'];

export interface Candidate {
  difficulty: Record<DifficultyGene, number>;
  army: Record<ArmyGene, number>;
  unitMix: UnitMix;
}

/** The current ai.json numbers as a candidate. */
export function baselineCandidate(): Candidate {
  const { rules, army, unitMix } = factionRules(TUNED_DIFFICULTY);
  const difficulty = {} as Candidate['difficulty'];
  for (const gene of Object.keys(DIFFICULTY_GENES) as DifficultyGene[]) {
    const value = rules[gene];
    if (typeof value !== 'number') throw new Error(`ai.json normal.${gene} must be a number to tune it`);
    difficulty[gene] = value;
  }
  const armyGenes = {} as Candidate['army'];
  for (const gene of Object.keys(ARMY_GENES) as ArmyGene[]) armyGenes[gene] = army[gene];
  const mix = {} as UnitMix;
  for (const tier of TIERS) mix[tier] = { ...unitMix[tier] };
  return { difficulty, army: armyGenes, unitMix: mix };
}

export function toTuning(c: Candidate): FactionTuning {
  return { difficulty: { ...c.difficulty }, army: { ...c.army }, unitMix: c.unitMix };
}

function clampGene(value: number, range: Range): number {
  const v = Math.min(range.high, Math.max(range.low, value));
  return range.whole ? Math.round(v) : Math.round(v * 100) / 100;
}

/** Normal-ish noise from the sum of three uniforms (mean 0, about -1.7..1.7). */
function noise(rng: Rng): number {
  return rng.next() + rng.next() + rng.next() - 1.5;
}

function normalizeMix(mix: Record<string, number>): Record<string, number> {
  const ids = Object.keys(mix);
  // Lift small shares to MIN_SHARE, then scale the rest so all add up to 1.
  let sum = 0;
  for (const id of ids) sum += Math.max(MIN_SHARE, mix[id]!);
  const out: Record<string, number> = {};
  let total = 0;
  for (const id of ids) {
    out[id] = Math.round((Math.max(MIN_SHARE, mix[id]!) / sum) * 1000) / 1000;
    total += out[id]!;
  }
  // Rounding: the biggest share takes the difference, so ai.json's "add up to 1" check passes.
  const biggest = ids.reduce((a, b) => (out[b]! > out[a]! ? b : a));
  out[biggest] = Math.round((out[biggest]! + 1 - total) * 1000) / 1000;
  return out;
}

/** Keeps the numbers that depend on each other in order. */
function fix(c: Candidate): Candidate {
  if (c.army.trainUpToSupply < c.army.attackAtSupplyUsed + 10) c.army.trainUpToSupply = c.army.attackAtSupplyUsed + 10;
  return c;
}

/**
 * A copy of `c` with random changes. `strength` is the share of each gene's range one step moves
 * (about); `rate` is the chance that a gene changes at all.
 */
export function mutate(c: Candidate, rng: Rng, strength = 0.15, rate = 0.4): Candidate {
  const out: Candidate = {
    difficulty: { ...c.difficulty },
    army: { ...c.army },
    unitMix: { tier1: { ...c.unitMix.tier1 }, tier2: { ...c.unitMix.tier2 }, tier3: { ...c.unitMix.tier3 } },
  };
  for (const [gene, range] of Object.entries(DIFFICULTY_GENES) as [DifficultyGene, Range][])
    if (rng.next() < rate) out.difficulty[gene] = clampGene(out.difficulty[gene] + noise(rng) * strength * (range.high - range.low), range);
  for (const [gene, range] of Object.entries(ARMY_GENES) as [ArmyGene, Range][])
    if (rng.next() < rate) out.army[gene] = clampGene(out.army[gene] + noise(rng) * strength * (range.high - range.low), range);
  for (const tier of TIERS) {
    if (rng.next() >= rate) continue;
    const mix = out.unitMix[tier];
    // Shares change by a factor (x0.6..x1.6 at the default strength), then add up to 1 again.
    for (const id in mix) mix[id] = mix[id]! * Math.exp(noise(rng) * strength * 2.5);
    out.unitMix[tier] = normalizeMix(mix);
  }
  return fix(out);
}

/** Each gene (and each tier's whole mix) from one of the two parents. */
export function crossover(a: Candidate, b: Candidate, rng: Rng): Candidate {
  const pick = <T>(x: T, y: T): T => (rng.next() < 0.5 ? x : y);
  const out: Candidate = { difficulty: { ...a.difficulty }, army: { ...a.army }, unitMix: { ...a.unitMix } };
  for (const gene of Object.keys(DIFFICULTY_GENES) as DifficultyGene[]) out.difficulty[gene] = pick(a.difficulty[gene], b.difficulty[gene]);
  for (const gene of Object.keys(ARMY_GENES) as ArmyGene[]) out.army[gene] = pick(a.army[gene], b.army[gene]);
  for (const tier of TIERS) out.unitMix[tier] = { ...pick(a.unitMix[tier], b.unitMix[tier]) };
  return fix(out);
}

/** Which slots play the candidate in match k (the other two play the current numbers). Every
 * pair of the 4 corners in turn, so no side keeps the better start spots. */
export const SLOT_LAYOUTS: [number, number][] = [
  [0, 2],
  [1, 3],
  [0, 1],
  [2, 3],
  [0, 3],
  [1, 2],
];

export interface MatchOutcome {
  /** 0 = no winner in time */
  winnerTeam: number;
  /** defeated flag per slot at the end */
  defeated: boolean[];
}

/**
 * The candidate's score for one match: 1 = a candidate slot won, 0 = a current slot won. No
 * winner in time: the candidates' share of the kingdoms still alive (0.5 if all are alive).
 * Teams are slot + 1 (headless runner default).
 */
export function scoreMatch(outcome: MatchOutcome, candidateSlots: readonly number[]): number {
  if (outcome.winnerTeam) return candidateSlots.includes(outcome.winnerTeam - 1) ? 1 : 0;
  let alive = 0;
  let ours = 0;
  outcome.defeated.forEach((dead, slot) => {
    if (dead) return;
    alive++;
    if (candidateSlots.includes(slot)) ours++;
  });
  return alive ? ours / alive : 0.5;
}

/** Plain-English lines "name: old -> new" for the genes that differ. */
export function describeChanges(from: Candidate, to: Candidate): string[] {
  const lines: string[] = [];
  for (const gene of Object.keys(DIFFICULTY_GENES) as DifficultyGene[])
    if (from.difficulty[gene] !== to.difficulty[gene])
      lines.push(`difficulties.normal.${gene}: ${from.difficulty[gene]} -> ${to.difficulty[gene]}`);
  for (const gene of Object.keys(ARMY_GENES) as ArmyGene[])
    if (from.army[gene] !== to.army[gene]) lines.push(`army.${gene}: ${from.army[gene]} -> ${to.army[gene]}`);
  for (const tier of TIERS)
    for (const id of Object.keys(from.unitMix[tier]))
      if (from.unitMix[tier][id] !== to.unitMix[tier][id])
        lines.push(`unitMix.${tier}.${id}: ${from.unitMix[tier][id]} -> ${to.unitMix[tier][id]}`);
  return lines;
}
