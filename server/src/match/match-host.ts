// Runs a match in a worker thread (normal) or in this thread (tests, MATCH_INLINE=1).
// The lobby only talks to this small interface.

import { Worker } from 'node:worker_threads';
import type { MatchSetup, MatchStats } from '@game/shared';
import { MatchRunner, type MatchPacket } from './match-runner';
import { runTickLoop } from './tick-loop';

export type ToWorker =
  | { t: 'cmd'; slot: number; data: Uint8Array }
  | { t: 'online'; slot: number; on: boolean }
  | { t: 'reset'; slot: number }
  | { t: 'go' }
  | { t: 'stop' };

export type FromWorker = { t: 'ready' } | { t: 'out'; tick: number; packets: MatchPacket[] } | { t: 'stats'; stats: MatchStats };

export interface MatchHost {
  command(slot: number, data: Uint8Array): void;
  setOnline(slot: number, online: boolean): void;
  resetView(slot: number): void;
  go(): void;
  stop(): void;
  onPackets: (tick: number, packets: MatchPacket[]) => void;
  onStats: (stats: MatchStats) => void;
  /** last stats, for the load test and /health */
  stats: MatchStats | null;
}

export function createMatchHost(setup: MatchSetup, terrain: Uint8Array, mode: 'worker' | 'inline'): MatchHost {
  return mode === 'worker' ? new WorkerMatchHost(setup, terrain) : new InlineMatchHost(setup, terrain);
}

class InlineMatchHost implements MatchHost {
  private readonly runner: MatchRunner;
  private stopLoop: (() => void) | null = null;
  onPackets: MatchHost['onPackets'] = () => {};
  onStats: MatchHost['onStats'] = () => {};
  stats: MatchStats | null = null;

  constructor(setup: MatchSetup, terrain: Uint8Array) {
    this.runner = new MatchRunner(setup, terrain);
  }

  command(slot: number, data: Uint8Array): void {
    this.runner.command(slot, data);
  }
  setOnline(slot: number, online: boolean): void {
    this.runner.setOnline(slot, online);
  }
  resetView(slot: number): void {
    this.runner.resetView(slot);
  }
  go(): void {
    this.stopLoop ??= runTickLoop(
      this.runner,
      (tick, p) => this.onPackets(tick, p),
      (s) => {
        this.stats = s;
        this.onStats(s);
      },
    );
  }
  stop(): void {
    this.stopLoop?.();
  }
}

class WorkerMatchHost implements MatchHost {
  private readonly worker: Worker;
  onPackets: MatchHost['onPackets'] = () => {};
  onStats: MatchHost['onStats'] = () => {};
  stats: MatchStats | null = null;

  constructor(setup: MatchSetup, terrain: Uint8Array) {
    // Dev runs the TypeScript file (tsx passes its loader on to workers); the build has a .js next to main.js.
    const url = new URL(import.meta.url.endsWith('.ts') ? './match-worker.ts' : './match-worker.js', import.meta.url);
    this.worker = new Worker(url, { workerData: { setup, terrain } });
    this.worker.on('message', (msg: FromWorker) => {
      if (msg.t === 'out') this.onPackets(msg.tick, msg.packets);
      else if (msg.t === 'stats') {
        this.stats = msg.stats;
        this.onStats(msg.stats);
      }
    });
    this.worker.on('error', (err) => console.error('Match worker failed:', err));
  }

  private post(msg: ToWorker): void {
    this.worker.postMessage(msg);
  }
  command(slot: number, data: Uint8Array): void {
    this.post({ t: 'cmd', slot, data });
  }
  setOnline(slot: number, online: boolean): void {
    this.post({ t: 'online', slot, on: online });
  }
  resetView(slot: number): void {
    this.post({ t: 'reset', slot });
  }
  go(): void {
    this.post({ t: 'go' });
  }
  stop(): void {
    this.post({ t: 'stop' });
    setTimeout(() => void this.worker.terminate(), 1000).unref();
  }
}
