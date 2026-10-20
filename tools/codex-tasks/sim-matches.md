# Task: headless bot-only match runner

Write `server/src/match/headless.ts`, `server/scripts/sim-matches.ts` and `server/test/headless.test.ts`.

## Background
Phase 8 must prove that four AI factions play a whole match on their own: someone wins in 20–45 game minutes, no base gets stuck. The simulation runs without clients and much faster than real time. Read `docs/design/AI_ARCHITECTURE.md`, `shared/src/sim/match-sim.ts` (`MatchSim`, `MatchSetup`, `MatchSlot` with `ai` and `bot`, `MatchWorld`), `shared/src/sim/faction/faction.ts` (`Factions`, `FactionState`: gold, wood, supplyUsed, supplyCap, tier, buildings, units, defeated, status; `factions.winnerTeam`, `factions.endedAt`; `BuildingState`: done, progress, queue, upgradeTo; `WorkerJob`). Map data: `server/src/data-files.ts` (`readSharedDataFile('map-terrain.bin')`, and read `map-trees.json` the same way and `JSON.parse` it: `{ trees: [...] }`), `parseTerrain`, `buildMatchNav`, `gameData` from `@game/shared`. The faction brain (Phase 8b) will plug into the sim later; for now factions only run their economy, so most matches will end with "no winner" — the runner must still work and report clearly. Optionally the sim may have hero bots (`shared/src/sim/hero-bot.ts`, may not exist yet): do not import it.

## API (exact)
```ts
export interface HeadlessOptions {
  seed: number;
  /** 2–4 slots, all bots, each its own team unless `teams` says otherwise */
  slots?: number;
  teams?: number[];
  difficulty?: ('easy' | 'normal' | 'hard')[];
  heroes?: string[];            // hero ids per slot, default: pick distinct ones by seed
  maxMinutes?: number;          // stop after this many game minutes (default 60)
  /** called every simulated game minute with the snapshot */
  onMinute?: (m: MinuteLog) => void;
  /** extra setup after the sim is built (8b uses it to attach brains / hero bots) */
  attach?: (sim: MatchSim) => { update(): void } | void;
}
export interface FactionMinute { slot: number; team: number; gold: number; wood: number; workers: number; armySupply: number; supplyUsed: number; supplyCap: number; buildings: number; tier: number; heroLevel: number; status: string; defeated: boolean }
export interface MinuteLog { minute: number; factions: FactionMinute[] }
export interface StuckReport { slot: number; minute: number; seconds: number; gold: number; wood: number; reason: string }
export interface HeadlessResult {
  seed: number; winnerTeam: number; minutes: number; ticks: number;
  tickMsAvg: number; tickMsP99: number; tickMsMax: number; wallSeconds: number;
  stuck: StuckReport[]; log: MinuteLog[];
}
export function runHeadlessMatch(o: HeadlessOptions): HeadlessResult;
```

## Stuck rule
Every game second, per faction (not defeated): it is **busy** when any of its buildings is under construction, training or upgrading. It **could act** when its gold/wood are enough for the cheapest building it may build now (needs met) or a worker / unit it may train now (supply free). Idle (not busy) while it could act for more than 60 game seconds in a row → one `StuckReport` (then reset the counter). Count "no worker has a job" as a separate reason.

## Script
`pnpm --filter @game/server exec tsx scripts/sim-matches.ts -- --matches 10 --minutes 60 --seed 1 [--slots 4] [--difficulty normal]`: runs N matches (seeds seed..seed+N-1), prints one line per minute per match when `--verbose`, and a summary table: seed, winner, minutes, max army supply per faction, stuck count, tick ms avg / p99 / max, wall time. Writes a JSON report to `server/logs/sim-matches-<date>.json` (create the folder; add `server/logs/` to nothing — just write there). Exit code 1 when any match has stuck reports or fewer than half the matches have a winner (print why). Add a `"sim-matches"` script to nothing — do not edit package.json; the command above is enough.

## Tests (`server/test/headless.test.ts`)
- A 2-slot match for 3 game minutes finishes quickly (real time < 20 s), returns 3 minute logs, workers gather (gold rises), tick stats are numbers > 0.
- `attach` is called and its `update` runs every tick.
- The stuck rule: a faction with lots of money and no busy buildings for 61 s gives a StuckReport (set it up by giving gold and killing its workers at the start, or by a fake attach that empties queues).
