// Fixed 20 Hz loop with drift correction, and simple tick timing stats.

import { TICK_RATE, type MatchStats } from '@game/shared';
import type { MatchPacket, MatchRunner } from './match-runner';

const TICK_MS = 1000 / TICK_RATE;

export function runTickLoop(
  runner: MatchRunner,
  onPackets: (tick: number, packets: MatchPacket[]) => void,
  onStats: (stats: MatchStats) => void,
): () => void {
  const startedAt = performance.now();
  let ticks = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let sum = 0,
    max = 0,
    count = 0;
  let statsAt = startedAt;

  const loop = () => {
    if (stopped) return;
    // Catch up if the timer was late, but never run more than 5 ticks at once.
    const due = Math.floor((performance.now() - startedAt) / TICK_MS);
    for (let n = 0; ticks < due && n < 5; n++) {
      const t0 = performance.now();
      const packets = runner.tick();
      const ms = performance.now() - t0;
      ticks++;
      sum += ms;
      max = Math.max(max, ms);
      count++;
      onPackets(runner.sim.tick, packets);
    }
    if (ticks < due - 5) ticks = due; // far behind (debugger, sleep): skip, do not spiral
    const now = performance.now();
    if (now - statsAt >= 1000) {
      const secs = (now - statsAt) / 1000;
      onStats({
        ticks: runner.sim.tick,
        tickMsAvg: count ? sum / count : 0,
        tickMsMax: max,
        entities: runner.sim.entities.length,
        bytesPerSec: [0, 1, 2, 3].map((s) => Math.round((runner.bytes.get(s) ?? 0) / secs)),
      });
      for (const k of runner.bytes.keys()) runner.bytes.set(k, 0);
      sum = max = count = 0;
      statsAt = now;
    }
    timer = setTimeout(loop, Math.max(0, startedAt + (ticks + 1) * TICK_MS - performance.now()));
  };
  timer = setTimeout(loop, TICK_MS);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
