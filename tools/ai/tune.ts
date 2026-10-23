// Self-play tuning of the faction AI: an evolutionary search over the AI's decision numbers in
// ai.json (faction.difficulties.normal, faction.army, faction.unitMix). Each candidate plays
// headless 4-player bot matches in two slots against the opponent's numbers in the other two.
// The candidates that score best are kept, mixed and changed a bit for the next generation.
// Every seed is played twice with the sides swapped (the mirror), so the map spots, heroes and
// personalities that come from the seed help both sides the same.
//
// The opponent is the current ai.json numbers. With --ladder, a candidate that clearly beats the
// opponent in a separate check becomes the new opponent (the champion), so the AI gets better
// step by step. At the end the best numbers play fresh seeds against the ai.json numbers.
//
// The report (server/logs/ai-tune-<date>.json) is saved after every generation and holds the
// whole search state: --resume <report> goes on from there after a stop or a crash.
// It never writes ai.json: the report shows the old and new numbers, a person decides.
//
// Usage: pnpm --filter @game/tools ai:tune -- --generations 4 --population 8 --matches 8
//        pnpm --filter @game/tools ai:tune -- --generations 200 --hours 9.5 --ladder --jobs 4
//        pnpm --filter @game/tools ai:tune -- --resume ../server/logs/ai-tune-<date>.json
//        pnpm --filter @game/tools ai:tune -- --check-only ../server/logs/ai-tune-<date>.json --seed 2
//        (only the final check, for the best numbers of an earlier report)

import { fork, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { availableParallelism, getPriority, setPriority } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Rng, type FactionTuning } from '@game/shared';
import { baselineCandidate, crossover, describeChanges, mutate, scoreMatch, SLOT_LAYOUTS, toTuning, type Candidate } from './lib/genes';
import type { MatchDone, MatchJob } from './match-process';

// No parseArgs defaults: on --resume, options not given again come from the report.
const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: {
    generations: { type: 'string' },
    population: { type: 'string' },
    matches: { type: 'string' },
    validate: { type: 'string' },
    minutes: { type: 'string' },
    seed: { type: 'string' },
    jobs: { type: 'string' },
    hours: { type: 'string' },
    until: { type: 'string' },
    out: { type: 'string' },
    ladder: { type: 'boolean' },
    'promote-matches': { type: 'string' },
    'promote-from': { type: 'string' },
    'promote-margin': { type: 'string' },
    'check-only': { type: 'string' },
    resume: { type: 'string' },
  },
});

interface Options {
  generations: number;
  population: number;
  matches: number;
  validate: number;
  minutes: number;
  seed: number;
  jobs: number;
  /** stop starting generations so the final check ends within this many hours of the start */
  hours: number | null;
  /** the same as an end time (ISO, e.g. 2026-10-23T11:00:00+02:00); kept on --resume */
  until: string | null;
  ladder: boolean;
  promoteMatches: number;
  /** a leader gets a promotion check from this score, after two generations of matches */
  promoteFrom: number;
  /** promoted when its check score minus this many standard errors is above 0.5 */
  promoteMargin: number;
}

const DEFAULTS: Options = {
  generations: 4,
  population: 8,
  matches: 6,
  validate: 48,
  minutes: 60,
  seed: 1,
  // Few processes by default: the user works on this Mac while the tuner runs.
  jobs: Math.min(3, availableParallelism()),
  hours: null,
  until: null,
  ladder: false,
  promoteMatches: 32,
  promoteFrom: 0.6,
  promoteMargin: 2,
};

function wholeNumber(name: string, value: number, low: number): number {
  if (!Number.isInteger(value) || value < low) throw new Error(`--${name} must be a whole number of at least ${low}`);
  return value;
}

function evenNumber(name: string, value: number, low: number): number {
  wholeNumber(name, value, low);
  if (value % 2) throw new Error(`--${name} must be even (every seed is played twice, sides swapped)`);
  return value;
}

// ---------- report and saved state ----------

interface MatchRecord {
  seed: number;
  /** the candidate's slots */
  slots: [number, number];
  winnerTeam: number;
  minutes: number;
  score: number;
  /** stuck reports of the headless runner in this match */
  stuck: number;
}

interface Scored {
  name: string;
  candidate: Candidate;
  /** sum of match scores against the current opponent, over every generation it played */
  score: number;
  played: number;
  wins: number;
  losses: number;
  draws: number;
  /** it had its promotion check against the current opponent */
  promotionTried?: boolean;
  /** every match (only kept for checks, the search would make the report too big) */
  matches?: MatchRecord[];
}

interface Champion {
  name: string;
  candidate: Candidate;
  /** generation after which it became the opponent */
  generation: number;
  checkScore: number;
}

interface Report {
  options: Options;
  baseline: Candidate;
  startedAt: string;
  generations: unknown[];
  promotionChecks: unknown[];
  /** the opponents in order (ladder); empty = the ai.json numbers */
  champions: Champion[];
  state: { generation: number; names: number; stuckTotal: number; wallMinutes: number; population: Scored[] } | null;
  best?: { name: string; candidate: Candidate; searchScore: number; changes: string[] };
  check?: unknown;
  stuckReports?: number;
  wallMinutes?: number;
}

const resumed = values.resume ? (JSON.parse(readFileSync(values.resume, 'utf8')) as Report) : null;
const saved: Options = resumed?.options ?? DEFAULTS;
const num = (v: string | undefined, fallback: number) => (v === undefined ? fallback : Number(v));
const O: Options = {
  generations: wholeNumber('generations', num(values.generations, saved.generations), 1),
  population: wholeNumber('population', num(values.population, saved.population), 2),
  matches: evenNumber('matches', num(values.matches, saved.matches), 2),
  validate: evenNumber('validate', num(values.validate, saved.validate), 0),
  minutes: num(values.minutes, saved.minutes),
  seed: wholeNumber('seed', num(values.seed, saved.seed), 0),
  jobs: wholeNumber('jobs', num(values.jobs, saved.jobs), 1),
  hours: values.hours === undefined ? saved.hours : Number(values.hours),
  until: values.until ?? saved.until ?? null,
  ladder: values.ladder ?? saved.ladder,
  promoteMatches: evenNumber('promote-matches', num(values['promote-matches'], saved.promoteMatches), 2),
  promoteFrom: num(values['promote-from'], saved.promoteFrom),
  promoteMargin: num(values['promote-margin'], saved.promoteMargin),
};
if (!Number.isFinite(O.minutes) || O.minutes <= 0) throw new Error('--minutes must be greater than 0');
if (O.hours !== null && !(O.hours > 0)) throw new Error('--hours must be greater than 0');
if (O.until !== null && !Number.isFinite(Date.parse(O.until)))
  throw new Error('--until must be a date and time, e.g. 2026-10-23T11:00:00+02:00');
if (resumed && (O.population !== saved.population || O.matches !== saved.matches || O.seed !== saved.seed))
  throw new Error('--resume: --population, --matches and --seed must stay as in the report');

/** low CPU priority (nice 15) for this process and its match processes, so other apps come first */
const LOW_PRIORITY = 15;
// Only lower it: an already lower priority (started with nice) can not be raised back.
if (getPriority() < LOW_PRIORITY) setPriority(LOW_PRIORITY);
/** the best half of a generation lives on */
const KEEP = Math.max(1, Math.floor(O.population / 2));
// Seeds: search, promotion checks and the final check never share a seed (generation < 1000).
const SEED_BASE = O.seed * 10_000_000;
const PROMOTION_SEEDS = 2_000_000;
const FINAL_SEEDS = 5_000_000;

// ---------- match pool ----------

class MatchPool {
  private readonly idle: ChildProcess[] = [];
  private readonly waiting: { job: MatchJob; done: (r: MatchDone) => void }[] = [];
  private readonly running = new Map<number, (r: MatchDone) => void>();
  private readonly children: ChildProcess[] = [];

  constructor(size: number) {
    const script = join(import.meta.dirname, 'match-process.ts');
    for (let i = 0; i < size; i++) {
      // execArgv is inherited, so the child runs under tsx like this process.
      const child = fork(script, [], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
      child.on('message', (r: MatchDone) => {
        const done = this.running.get(r.id);
        this.running.delete(r.id);
        this.idle.push(child);
        done?.(r);
        this.next();
      });
      child.on('exit', (code) => {
        // The report of the last finished generation is on disk: --resume goes on from there.
        console.error(`A match process ended with code ${code}. Go on with --resume ${reportPath}`);
        process.exit(1);
      });
      this.children.push(child);
      this.idle.push(child);
    }
  }

  run(job: MatchJob): Promise<MatchDone> {
    return new Promise((done) => {
      this.waiting.push({ job, done });
      this.next();
    });
  }

  private next(): void {
    while (this.idle.length && this.waiting.length) {
      const child = this.idle.pop()!;
      const { job, done } = this.waiting.shift()!;
      this.running.set(job.id, done);
      child.send(job);
    }
  }

  close(): void {
    for (const child of this.children) {
      child.removeAllListeners('exit');
      child.kill();
    }
  }
}

// ---------- scoring ----------

const mean = (s: Scored) => (s.played ? s.score / s.played : 0);
/** Standard error of a mean of scores in 0..1 is at most 0.5/sqrt(n). */
const stdError = (s: Scored) => (s.played ? 0.5 / Math.sqrt(s.played) : 0);
/** clearly better than its opponent: score minus `margin` standard errors above 0.5 */
const clearlyBetter = (s: Scored, margin = 2) => s.played > 0 && mean(s) - margin * stdError(s) > 0.5;

let jobId = 0;
let stuckTotal = resumed?.state?.stuckTotal ?? 0;
/** average wall seconds of one match (for --hours) */
let matchSecondsTotal = 0;
let matchCount = 0;

/**
 * k-th match of a set: seed firstSeed + k/2, and the candidate's two slots. SLOT_LAYOUTS lists
 * each pair next to its opposite pair, so matches 2j and 2j+1 are the same seed, sides swapped.
 * The other two slots play `opponent` (null = the ai.json numbers).
 */
function matchJob(candidate: Candidate, opponent: Candidate | null, firstSeed: number, k: number) {
  const seed = firstSeed + Math.floor(k / 2);
  const slots = SLOT_LAYOUTS[k % SLOT_LAYOUTS.length]!;
  const tuning: Record<number, FactionTuning> = {};
  for (let slot = 0; slot < 4; slot++) {
    const numbers = slots.includes(slot) ? candidate : opponent;
    if (numbers) tuning[slot] = toTuning(numbers);
  }
  const job: MatchJob = { id: jobId++, seed, minutes: O.minutes, tuning };
  return { job, slots };
}

async function play(pool: MatchPool, s: Scored, opponent: Candidate | null, firstSeed: number, count: number): Promise<void> {
  await Promise.all(
    Array.from({ length: count }, async (_, k) => {
      const { job, slots } = matchJob(s.candidate, opponent, firstSeed, k);
      const r = await pool.run(job);
      stuckTotal += r.stuck;
      matchSecondsTotal += r.wallSeconds;
      matchCount++;
      const score = scoreMatch(r, slots);
      s.matches?.push({ seed: job.seed, slots, winnerTeam: r.winnerTeam, minutes: Math.round(r.minutes * 10) / 10, score, stuck: r.stuck });
      s.score += score;
      s.played++;
      if (score === 1) s.wins++;
      else if (score === 0) s.losses++;
      else s.draws++;
    }),
  );
}

const line = (s: Scored) =>
  `${s.name.padEnd(6)} score ${mean(s).toFixed(3)}  (${s.wins} won / ${s.losses} lost / ${s.draws} no winner, ${s.played} matches)`;
const summary = (s: Scored) => ({ name: s.name, mean: mean(s), played: s.played, wins: s.wins, losses: s.losses, draws: s.draws });

// ---------- main ----------

const baseline = baselineCandidate();
const logs = join(import.meta.dirname, '..', '..', 'server', 'logs');
mkdirSync(logs, { recursive: true });
const reportPath = resolve(values.resume ?? values.out ?? join(logs, `ai-tune-${new Date().toISOString().replaceAll(':', '-')}.json`));
mkdirSync(dirname(reportPath), { recursive: true });
const report: Report = resumed ?? {
  options: O,
  baseline,
  startedAt: new Date().toISOString(),
  generations: [],
  promotionChecks: [],
  champions: [],
  state: null,
};
report.options = O;
const save = () => {
  // Write a new file, then rename: a stop while writing never leaves a broken report.
  writeFileSync(`${reportPath}.tmp`, `${JSON.stringify(report, null, 2)}\n`);
  renameSync(`${reportPath}.tmp`, reportPath);
};

const pool = new MatchPool(O.jobs);
const started = performance.now();
const minutesBefore = resumed?.state?.wallMinutes ?? 0;
const wallMinutes = () => minutesBefore + (performance.now() - started) / 60000;
let names = resumed?.state?.names ?? 0;
const fresh = (candidate: Candidate): Scored => ({ name: `c${++names}`, candidate, score: 0, played: 0, wins: 0, losses: 0, draws: 0 });
const champion = () => report.champions[report.champions.length - 1] ?? null;
/** a new random stream per generation and use: the same on --resume */
const generationRng = (gen: number, use = 0) => new Rng((O.seed * 7919 + gen * 104_729 + use * 15_485_863 + 13) >>> 0);

/** The next generation: the best half lives on (its score keeps adding up), children of two of them fill the rest. */
function breed(scored: Scored[], rng: Rng): Scored[] {
  const kept = scored.slice(0, KEEP);
  const children: Scored[] = [];
  while (kept.length + children.length < O.population) {
    const a = kept[Math.floor(rng.next() * kept.length)]!;
    const b = kept[Math.floor(rng.next() * kept.length)]!;
    children.push(fresh(mutate(a === b ? a.candidate : crossover(a.candidate, b.candidate, rng), rng)));
  }
  return [...kept, ...children];
}

/** --until, else --hours from this start (after --resume: from the resume) */
const deadline = O.until !== null ? Date.parse(O.until) : O.hours !== null ? Date.now() + O.hours * 3_600_000 : null;

/** Is there time for one more generation and the final check (--hours, --until)? */
function timeLeftForGeneration(): boolean {
  if (deadline === null) return true;
  if (!matchCount) return Date.now() < deadline;
  const perMatchMinutes = matchSecondsTotal / matchCount / 60 / O.jobs;
  const next = O.population * O.matches * perMatchMinutes + O.promoteMatches * perMatchMinutes;
  const check = O.validate * perMatchMinutes;
  return Date.now() + (next + check) * 60_000 < deadline;
}

interface EarlierReport {
  best: { name: string; candidate: Candidate; searchScore: number };
}
const earlier = values['check-only'] ? (JSON.parse(readFileSync(values['check-only'], 'utf8')) as EarlierReport).best : null;

let population: Scored[];
if (earlier) population = [{ ...fresh(earlier.candidate), name: earlier.name }];
else if (resumed?.state) population = resumed.state.population;
else {
  // Generation 1: the current numbers with random changes (one stronger, so the search looks wider).
  const rng = generationRng(0);
  population = Array.from({ length: O.population }, (_, i) => fresh(mutate(baseline, rng, i % 2 ? 0.25 : 0.12, 0.5)));
}

let gen = (resumed?.state?.generation ?? 0) + 1;
if (!earlier)
  console.log(
    `AI tuning: ${O.generations} generations x ${O.population} candidates x ${O.matches} matches, ${O.jobs} processes` +
      `${O.ladder ? ', ladder' : ''}${deadline ? `, until ${new Date(deadline).toISOString()}` : ''}${resumed ? `, resumed after generation ${gen - 1}` : ''}.`,
  );
for (; gen <= O.generations && !earlier; gen++) {
  if (!timeLeftForGeneration()) {
    console.log(`\nStopping before generation ${gen}: the time limit leaves time only for the final check.`);
    break;
  }
  // The saved population of a generation is the played one (sorted): breed it first.
  if (gen > 1) population = breed(population, generationRng(gen, 1));
  const rng = generationRng(gen);
  const opponent = champion();
  // Same seeds for every candidate of a generation (fairer to compare), new seeds each generation.
  const firstSeed = SEED_BASE + gen * 1000;
  await Promise.all(population.map((s) => play(pool, s, opponent?.candidate ?? null, firstSeed, O.matches)));
  population.sort((a, b) => mean(b) - mean(a));
  console.log(`\nGeneration ${gen} (${wallMinutes().toFixed(1)} min so far), opponent: ${opponent?.name ?? 'ai.json'}:`);
  for (const s of population) console.log(`  ${line(s)}`);
  report.generations.push({ generation: gen, firstSeed, opponent: opponent?.name ?? 'ai.json', candidates: population.map(summary) });

  // Ladder: the leader, once it has two generations of matches and a good score, gets its own
  // check on new seeds. Clearly better there: it becomes the opponent of everybody.
  const top = population[0]!;
  if (O.ladder && !top.promotionTried && top.played >= 2 * O.matches && mean(top) >= O.promoteFrom) {
    top.promotionTried = true;
    const trial: Scored = { ...fresh(top.candidate), name: top.name };
    await play(pool, trial, opponent?.candidate ?? null, SEED_BASE + PROMOTION_SEEDS + gen * 1000, O.promoteMatches);
    const promoted = clearlyBetter(trial, O.promoteMargin);
    console.log(`  promotion check of ${top.name}: ${line(trial)} -> ${promoted ? 'NEW OPPONENT' : 'not clearly better'}`);
    report.promotionChecks.push({ generation: gen, opponent: opponent?.name ?? 'ai.json', ...summary(trial), promoted });
    if (promoted) {
      report.champions.push({ name: top.name, candidate: top.candidate, generation: gen, checkScore: mean(trial) });
      // A new opponent: the old scores mean nothing now. The champion's place goes to a child of it
      // (playing against itself would only give 0.5).
      for (const s of population) Object.assign(s, { score: 0, played: 0, wins: 0, losses: 0, draws: 0, promotionTried: false });
      population[0] = fresh(mutate(top.candidate, rng));
    }
  }

  report.state = { generation: gen, names, stuckTotal, wallMinutes: wallMinutes(), population };
  save();
}

// The final check, always against the ai.json numbers: the last champion (it beat the ones before
// it), else the best candidate, on seeds it never saw.
const last = champion();
const best =
  earlier ?? (last ? { name: last.name, candidate: last.candidate } : { name: population[0]!.name, candidate: population[0]!.candidate });
const searchScore = earlier ? earlier.searchScore : last ? last.checkScore : mean(population[0]!);
const check: Scored = { ...fresh(best.candidate), name: `${best.name} (check)`, matches: [] };
if (O.validate) {
  console.log(`\nFinal check: ${best.name} against ai.json, ${O.validate} matches, ${O.jobs} processes.`);
  await play(pool, check, null, SEED_BASE + FINAL_SEEDS, O.validate);
}
pool.close();

const changes = describeChanges(baseline, best.candidate);
const winRate = mean(check);
const verdict = !check.played
  ? 'no check matches'
  : clearlyBetter(check)
    ? 'the candidate is better than the current numbers'
    : winRate + 2 * stdError(check) < 0.5
      ? 'the candidate is worse than the current numbers'
      : 'no clear difference (more check matches needed)';
report.best = { name: best.name, candidate: best.candidate, searchScore, changes };
report.check = {
  matches: check.played,
  score: winRate,
  wins: check.wins,
  losses: check.losses,
  draws: check.draws,
  stdError: stdError(check),
  verdict,
  results: check.matches,
};
report.stuckReports = stuckTotal;
report.wallMinutes = wallMinutes();
save();

if (report.champions.length)
  console.log(`\nLadder: ai.json -> ${report.champions.map((c) => `${c.name} (gen ${c.generation})`).join(' -> ')}`);
console.log(`\nBest numbers ${best.name} (score ${searchScore.toFixed(3)} before the final check). Changes:`);
for (const change of changes) console.log(`  ${change}`);
if (check.played) {
  console.log(
    `\nFinal check on ${check.played} matches (${check.played / 2} new seeds, both sides): score ${winRate.toFixed(3)} (0.5 = equal), ` +
      `${check.wins} won / ${check.losses} lost / ${check.draws} no winner, +-${(2 * stdError(check)).toFixed(3)}.`,
  );
  console.log(`Verdict: ${verdict}.`);
}
console.log(`Stuck reports: ${stuckTotal}. Time: ${report.wallMinutes.toFixed(1)} min.`);
console.log(`Report: ${reportPath}`);
console.log('ai.json was not changed.');
