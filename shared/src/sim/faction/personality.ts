// A faction AI's "character" for one match: where its base grows, how many towers it builds, how
// early it attacks and expands, and small changes to its build order and unit mix. Made from the
// match seed and the slot, so every game plays a little differently but the same seed gives the
// same game. Rules: docs/design/FACTION.md ("AI personality").

import { gameData } from '../../data/index';
import { Rng } from '../rng';

export type AiStyle = 'balanced' | 'turtle' | 'rusher' | 'boomer';

export interface BuildStep {
  do: 'build' | 'train' | 'upgrade' | 'expand' | 'summon';
  what: string;
  count?: number;
}

export interface Personality {
  style: AiStyle;
  /** direction (radians, from the Town Hall) the base grows toward */
  growAngle: number;
  /** how strongly buildings pull toward growAngle (0 = round base, under 1) */
  growPull: number;
  /** direction houses pull toward (often behind the hall: a wall of houses) */
  houseAngle: number;
  /** free space kept around each building (1 = tight rows) */
  spacing: number;
  /** random spread of building spots (in units of distance) */
  noise: number;
  noiseSeed: number;
  /** towers turn this much (radians) from the line hall → map center */
  towerTurn: number;
  /** towers keep at least this far apart */
  towerGap: number;
  /** watchtowers at the main base on top of the difficulty's towersAtBase */
  extraTowers: number;
  /** one more tower every this many minutes (from minute 8) */
  towerEveryMin: number;
  /** the AI pays for a tower up to this many times its first price (prices rise, rules.json) */
  towerPriceLimit: number;
  /** watchtowers at every expansion */
  towersPerExpansion: number;
  /** production buildings on top of the difficulty's maxProductionBuildings */
  extraProduction: number;
  /** a new house when free supply drops below this */
  houseAhead: number;
  /** multiplies the army supply needed for an attack */
  attackScale: number;
  /** minutes added to expandAtMinute (negative = earlier) */
  expandShift: number;
  /** a second expansion from this minute (null = only when the gold runs low) */
  secondExpandMinute: number | null;
  /** multiplies the unit mix shares, by unit id */
  mixScale: Record<string, number>;
  /** the order this AI builds defense structures in (ai.json defenses.list, shuffled) */
  defenseOrder: string[];
  /** defense structures on top of the timed ones */
  extraDefenses: number;
  buildOrder: BuildStep[];
}

const STYLES: readonly AiStyle[] = ['balanced', 'turtle', 'rusher', 'boomer'];

/** Same match seed + slot = same personality. */
export function makePersonality(seed: number, slot: number, buildOrder: readonly BuildStep[]): Personality {
  const rng = new Rng((Math.imul(seed | 0, 0x85ebca6b) ^ Math.imul(slot + 1, 0xc2b2ae35)) >>> 0);
  const style = rng.pick(STYLES);
  const range = (a: number, b: number) => a + rng.next() * (b - a);
  const growAngle = rng.next() * Math.PI * 2;
  const p: Personality = {
    style,
    growAngle,
    growPull: range(0.2, 0.9),
    houseAngle: rng.next() < 0.5 ? growAngle + Math.PI : rng.next() * Math.PI * 2,
    spacing: rng.pick([1, 1, 1.5, 2, 2.5]),
    noise: range(2, 9),
    noiseSeed: rng.int(1, 1 << 30),
    towerTurn: range(-1, 1),
    towerGap: range(6, 11),
    extraTowers: rng.int(1, 2),
    towerEveryMin: range(5, 8),
    towerPriceLimit: range(1.75, 2.5),
    towersPerExpansion: rng.int(1, 2),
    extraProduction: rng.int(0, 1),
    houseAhead: rng.int(5, 9),
    attackScale: range(0.9, 1.15),
    expandShift: rng.int(-1, 2),
    secondExpandMinute: rng.next() < 0.3 ? rng.int(18, 24) : null,
    mixScale: {},
    defenseOrder: [],
    extraDefenses: 0,
    buildOrder: buildOrder.map((s) => ({ ...s })),
  };
  for (const u of gameData.units) p.mixScale[u.id] = range(0.75, 1.3);

  switch (style) {
    case 'turtle':
      // Towers early and many; attacks a bit later with a bigger army.
      p.extraTowers = rng.int(3, 5);
      p.towerEveryMin = range(3, 5);
      p.towerPriceLimit = range(3, 4);
      p.towersPerExpansion = rng.int(2, 3);
      p.attackScale = range(1.1, 1.3);
      after(p.buildOrder, 'hero_shrine', { do: 'build', what: 'watchtower' });
      after(p.buildOrder, 'forge', { do: 'build', what: 'watchtower' });
      break;
    case 'rusher':
      // More soldiers early, the first tower later, attacks with a smaller army.
      p.extraTowers = rng.int(0, 1);
      p.towerPriceLimit = range(1.25, 1.75);
      p.attackScale = range(0.75, 0.9);
      p.expandShift = rng.int(1, 3);
      for (const s of p.buildOrder) if (s.do === 'train') s.count = (s.count ?? 1) + rng.int(1, 2);
      moveLater(p.buildOrder, 'watchtower', 'stronghold');
      break;
    case 'boomer':
      // Economy first: an early expansion, more production, a second expansion later.
      p.expandShift = rng.int(-4, -2);
      p.extraProduction = rng.int(1, 2);
      p.secondExpandMinute = rng.int(15, 20);
      p.towersPerExpansion = rng.int(2, 3);
      break;
    case 'balanced':
      break;
  }
  // Small changes for everyone: forge or tower first, an early second house.
  if (rng.next() < 0.5) swap(p.buildOrder, 'watchtower', 'forge');
  if (rng.next() < 0.3) after(p.buildOrder, 'barracks', { do: 'build', what: 'house' });
  // Defense structures (drawn last, so the numbers above stay the same for a seed).
  p.defenseOrder = rng.shuffle([...(gameData.ai.faction as unknown as { defenses: { list: string[] } }).defenses.list]);
  p.extraDefenses = style === 'turtle' ? rng.int(2, 3) : style === 'rusher' ? 0 : rng.int(0, 1);
  return p;
}

/** A number 0..1 that is the same for the same point and seed (spreads building spots). */
export function spotNoise(x: number, y: number, seed: number): number {
  let h = Math.imul(Math.round(x * 2) | 0, 0x27d4eb2d) ^ Math.imul(Math.round(y * 2) | 0, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function indexOf(steps: BuildStep[], what: string): number {
  return steps.findIndex((s) => s.what === what);
}

/** Puts a step right after the first step for `what` (nothing when there is none). */
function after(steps: BuildStep[], what: string, step: BuildStep): void {
  const i = indexOf(steps, what);
  if (i >= 0) steps.splice(i + 1, 0, step);
}

/** Moves the first `what` step to right after the first `anchor` step. */
function moveLater(steps: BuildStep[], what: string, anchor: string): void {
  const i = indexOf(steps, what);
  if (i < 0) return;
  const [s] = steps.splice(i, 1);
  const j = indexOf(steps, anchor);
  steps.splice(j < 0 ? steps.length : j + 1, 0, s!);
}

/** Swaps the first steps of two buildings (both need only the barracks or nothing). */
function swap(steps: BuildStep[], a: string, b: string): void {
  const i = indexOf(steps, a),
    j = indexOf(steps, b);
  if (i < 0 || j < 0) return;
  [steps[i], steps[j]] = [steps[j]!, steps[i]!];
}
