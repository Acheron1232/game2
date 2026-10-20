// Runs a match in a worker thread (normal) or in this thread (tests, MATCH_INLINE=1).
// The lobby only talks to this small interface.

import { Worker } from 'node:worker_threads';
import type { MatchSetup, MatchStats, TreeList } from '@game/shared';
import { MatchRunner, type Cheat, type MatchPacket } from './match-runner';
import { runTickLoop } from './tick-loop';

export type ToWorker =
  | { t: 'cmd'; slot: number; data: Uint8Array }
  | { t: 'online'; slot: number; on: boolean }
  | { t: 'reset'; slot: number }
  | { t: 'bot'; slot: number; on: boolean }
  | { t: 'go' }
  | { t: 'stop' }
  | { t: 'cheat'; slot: number; cheat: Cheat };

export type FromWorker =
  | { t: 'ready' }
  | { t: 'out'; tick: number; packets: MatchPacket[] }
  | { t: 'stats'; stats: MatchStats }
  | { t: 'end'; winnerTeam: number };

/** What a match is played on. trees = null: heroes only (old tests). */
export interface MatchMap {
  terrain: Uint8Array;
  trees: TreeList | null;
}

export interface MatchHost {
  command(slot: number, data: Uint8Array): void;
  setOnline(slot: number, online: boolean): void;
  resetView(slot: number): void;
  /** a hero bot plays this slot (the player is away), or gives the hero back */
  setBot(slot: number, on: boolean): void;
  go(): void;
  stop(): void;
  /** dev only: XP and gold for a slot's hero */
  cheat(slot: number, cheat: Cheat): void;
  onPackets: (tick: number, packets: MatchPacket[]) => void;
  onStats: (stats: MatchStats) => void;
  /** once, when one team is left */
  onEnd: (winnerTeam: number) => void;
  /** last stats, for the load test and /health */
  stats: MatchStats | null;
}

export function createMatchHost(setup: MatchSetup, map: MatchMap, mode: 'worker' | 'inline'): MatchHost {
  return mode === 'worker' ? new WorkerMatchHost(setup, map) : new InlineMatchHost(setup, map);
}

class InlineMatchHost implements MatchHost {
  private readonly runner: MatchRunner;
  private stopLoop: (() => void) | null = null;
  onPackets: MatchHost['onPackets'] = () => {};
  onStats: MatchHost['onStats'] = () => {};
  onEnd: MatchHost['onEnd'] = () => {};
  stats: MatchStats | null = null;
  private ended = false;

  constructor(setup: MatchSetup, map: MatchMap) {
    this.runner = new MatchRunner(setup, map.terrain, map.trees ?? undefined);
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
  setBot(slot: number, on: boolean): void {
    this.runner.setBot(slot, on);
  }
  go(): void {
    this.stopLoop ??= runTickLoop(
      this.runner,
      (tick, p) => {
        this.onPackets(tick, p);
        if (!this.ended && this.runner.winnerTeam) {
          this.ended = true;
          this.onEnd(this.runner.winnerTeam);
        }
      },
      (s) => {
        this.stats = s;
        this.onStats(s);
      },
    );
  }
  stop(): void {
    this.stopLoop?.();
  }
  cheat(slot: number, cheat: Cheat): void {
    this.runner.cheat(slot, cheat);
  }
}

class WorkerMatchHost implements MatchHost {
  private readonly worker: Worker;
  onPackets: MatchHost['onPackets'] = () => {};
  onStats: MatchHost['onStats'] = () => {};
  onEnd: MatchHost['onEnd'] = () => {};
  stats: MatchStats | null = null;

  constructor(setup: MatchSetup, map: MatchMap) {
    // Dev runs the TypeScript file (tsx passes its loader on to workers); the build has a .js next to main.js.
    const url = new URL(import.meta.url.endsWith('.ts') ? './match-worker.ts' : './match-worker.js', import.meta.url);
    this.worker = new Worker(url, { workerData: { setup, map } });
    this.worker.on('message', (msg: FromWorker) => {
      if (msg.t === 'out') this.onPackets(msg.tick, msg.packets);
      else if (msg.t === 'stats') {
        this.stats = msg.stats;
        this.onStats(msg.stats);
      } else if (msg.t === 'end') this.onEnd(msg.winnerTeam);
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
  setBot(slot: number, on: boolean): void {
    this.post({ t: 'bot', slot, on });
  }
  go(): void {
    this.post({ t: 'go' });
  }
  cheat(slot: number, cheat: Cheat): void {
    this.post({ t: 'cheat', slot, cheat });
  }
  stop(): void {
    this.post({ t: 'stop' });
    setTimeout(() => void this.worker.terminate(), 1000).unref();
  }
}
