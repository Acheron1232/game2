import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getHeapStatistics, writeHeapSnapshot } from 'node:v8';
import { runHeadlessMatch } from '../src/match/headless';

// Seed 9 lasts over 50 game minutes. Stop at 45 to compare a living match at 5 and 40.
const dir = join(import.meta.dirname, '..', 'logs', 'soak');
mkdirSync(dir, { recursive: true });
const memory: { minute: number; heapBytes: number; totalHeapBytes: number }[] = [];
const result = runHeadlessMatch({
  seed: 9,
  slots: 4,
  maxMinutes: 45,
  onMinute: ({ minute }) => {
    if (minute !== 5 && minute !== 40 && minute !== 45) return;
    globalThis.gc?.();
    const heap = getHeapStatistics();
    memory.push({ minute, heapBytes: heap.used_heap_size, totalHeapBytes: heap.total_heap_size });
    if (minute !== 45) writeHeapSnapshot(join(dir, `minute-${minute}.heapsnapshot`));
  },
});
const report = { result, memory, note: 'Accelerated server simulation; not a 45-minute browser/GPU soak.' };
writeFileSync(join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ minutes: result.minutes, winner: result.winnerTeam, stuck: result.stuck, memory }, null, 2));
if (result.minutes < 45) throw new Error('Soak ended before 45 game minutes');
