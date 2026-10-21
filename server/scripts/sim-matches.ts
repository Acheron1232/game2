import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { runHeadlessMatch, type HeadlessResult, type MinuteLog } from '../src/match/headless';

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: {
    matches: { type: 'string', default: '10' },
    minutes: { type: 'string', default: '60' },
    seed: { type: 'string', default: '1' },
    slots: { type: 'string', default: '4' },
    difficulty: { type: 'string', default: 'normal' },
    verbose: { type: 'boolean', default: false },
  },
});

function wholeNumber(name: string, value: string | undefined, low: number, high = Infinity): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < low || number > high)
    throw new Error(`--${name} must be a whole number from ${low} to ${high}`);
  return number;
}

function positiveNumber(name: string, value: string | undefined): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`--${name} must be greater than 0`);
  return number;
}

const matches = wholeNumber('matches', values.matches, 1);
const minutes = positiveNumber('minutes', values.minutes);
const firstSeed = wholeNumber('seed', values.seed, 0);
const slots = wholeNumber('slots', values.slots, 2, 4);
const difficulty = values.difficulty;
if (difficulty !== 'easy' && difficulty !== 'normal' && difficulty !== 'hard') throw new Error('--difficulty must be easy, normal or hard');

function printMinute(seed: number, minute: MinuteLog): void {
  const factions = minute.factions
    .map(
      (faction) =>
        `S${faction.slot + 1} ${faction.gold}g/${faction.wood}w ${faction.armySupply} army${faction.factionHero ? ` [${faction.factionHero}]` : ''} ${faction.status}`,
    )
    .join(' | ');
  console.log(`seed ${seed} minute ${minute.minute}: ${factions}`);
}

interface MatchReport extends HeadlessResult {
  maxArmySupply: number[];
}

const results: MatchReport[] = [];
for (let index = 0; index < matches; index++) {
  const seed = firstSeed + index;
  const result = runHeadlessMatch({
    seed,
    slots,
    maxMinutes: minutes,
    difficulty: Array.from({ length: slots }, () => difficulty),
    onMinute: values.verbose ? (minute) => printMinute(seed, minute) : undefined,
  });
  const maxArmySupply = Array.from({ length: slots }, (_, slot) =>
    result.log.reduce((highest, minute) => Math.max(highest, minute.factions[slot]?.armySupply ?? 0), 0),
  );
  results.push({ ...result, maxArmySupply });
}

console.table(
  results.map((result) => ({
    seed: result.seed,
    winner: result.winnerTeam || 'none',
    minutes: result.minutes.toFixed(2),
    maxArmySupply: result.maxArmySupply.join('/'),
    factionHeroes: result.factions.map((f) => f.factionHero || '-').join(' / '),
    camps: result.factions.map((f) => f.campsCleared).join('/'),
    fieldFights: result.factions.map((f) => f.fieldFights).join('/'),
    stuck: result.stuck.length,
    tickMsAvg: result.tickMsAvg.toFixed(3),
    tickMsP99: result.tickMsP99.toFixed(3),
    tickMsMax: result.tickMsMax.toFixed(3),
    wallSeconds: result.wallSeconds.toFixed(2),
  })),
);

const logs = join(import.meta.dirname, '..', 'logs');
mkdirSync(logs, { recursive: true });
const date = new Date().toISOString().replaceAll(':', '-');
const reportPath = join(logs, `sim-matches-${date}.json`);
writeFileSync(reportPath, `${JSON.stringify({ matches, minutes, firstSeed, slots, difficulty, results }, null, 2)}\n`);
console.log(`Report: ${reportPath}`);

const stuckCount = results.reduce((total, result) => total + result.stuck.length, 0);
const winnerCount = results.filter((result) => result.winnerTeam !== 0).length;
const failures: string[] = [];
if (stuckCount > 0) failures.push(`${stuckCount} stuck report${stuckCount === 1 ? '' : 's'}`);
if (winnerCount < matches / 2) failures.push(`only ${winnerCount} of ${matches} matches had a winner`);
if (failures.length) {
  console.error(`Failed: ${failures.join('; ')}.`);
  process.exitCode = 1;
}
