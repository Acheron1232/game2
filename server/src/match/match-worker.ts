// Worker thread entry: one match per thread, so a busy match never slows down the lobby or
// another match.

import { parentPort, workerData } from 'node:worker_threads';
import type { MatchSetup } from '@game/shared';
import { MatchRunner } from './match-runner';
import { runTickLoop } from './tick-loop';
import type { ToWorker, FromWorker, MatchMap } from './match-host';

const { setup, map } = workerData as { setup: MatchSetup; map: MatchMap };
const runner = new MatchRunner(setup, map.terrain, map.trees ?? undefined);
let ended = false;
const port = parentPort!;
let stop: (() => void) | null = null;

const post = (msg: FromWorker, transfer: ArrayBuffer[] = []) => port.postMessage(msg, transfer);

port.on('message', (msg: ToWorker) => {
  switch (msg.t) {
    case 'cmd':
      runner.command(msg.slot, msg.data);
      break;
    case 'online':
      runner.setOnline(msg.slot, msg.on);
      break;
    case 'reset':
      runner.resetView(msg.slot);
      break;
    case 'go':
      stop ??= runTickLoop(
        runner,
        (tick, packets) => {
          post(
            { t: 'out', tick, packets },
            packets.map((p) => p.data.buffer),
          );
          if (!ended && runner.winnerTeam) {
            ended = true;
            post({ t: 'end', winnerTeam: runner.winnerTeam });
          }
        },
        (stats) => post({ t: 'stats', stats }),
      );
      break;
    case 'cheat':
      runner.cheat(msg.slot, msg.xp, msg.gold);
      break;
    case 'stop':
      stop?.();
      port.close();
      break;
  }
});
post({ t: 'ready' });
