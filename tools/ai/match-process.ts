// One child process of the self-play tuner: plays the headless matches it is sent, one at a time,
// and sends back a small result. tune.ts starts several of these (3 by default).

import { getPriority, setPriority } from 'node:os';
import type { FactionTuning } from '@game/shared';
import { runHeadlessMatch } from '../../server/src/match/headless';

export interface MatchJob {
  id: number;
  seed: number;
  minutes: number;
  tuning: Record<number, FactionTuning>;
}

export interface MatchDone {
  id: number;
  winnerTeam: number;
  minutes: number;
  defeated: boolean[];
  stuck: number;
  wallSeconds: number;
}

// Low CPU priority (nice 15), like tune.ts: the user works on this Mac while the tuner runs.
if (getPriority() < 15) setPriority(15);

process.on('message', (job: MatchJob) => {
  const result = runHeadlessMatch({ seed: job.seed, slots: 4, maxMinutes: job.minutes, aiTuning: job.tuning });
  const last = result.log[result.log.length - 1];
  const defeated = [0, 1, 2, 3].map((slot) => last?.factions.find((f) => f.slot === slot)?.defeated ?? false);
  // A match that ends between two minute logs: the losers are everyone but the winner team.
  if (result.winnerTeam) for (let slot = 0; slot < 4; slot++) defeated[slot] = slot + 1 !== result.winnerTeam;
  const done: MatchDone = {
    id: job.id,
    winnerTeam: result.winnerTeam,
    minutes: result.minutes,
    defeated,
    stuck: result.stuck.length,
    wallSeconds: result.wallSeconds,
  };
  process.send!(done);
});
