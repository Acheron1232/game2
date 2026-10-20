// Worker thread entry: one match per thread, so a busy match never slows down the lobby or
// another match.

import { parentPort, workerData } from 'node:worker_threads';
import type { MatchSetup } from '@game/shared';
import { MatchRunner } from './match-runner';
import { runTickLoop } from './tick-loop';
import type { ToWorker, FromWorker } from './match-host';

const { setup, terrain } = workerData as { setup: MatchSetup; terrain: Uint8Array };
const runner = new MatchRunner(setup, terrain);
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
        (tick, packets) =>
          post(
            { t: 'out', tick, packets },
            packets.map((p) => p.data.buffer),
          ),
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
