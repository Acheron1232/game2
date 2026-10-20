// Guesses the server's tick right now from when snapshots arrive. Other units are drawn a
// little in the past (INTERP_TICKS), between snapshots we already have, which hides jitter.

import { TICK_RATE } from '@game/shared';

/** Draw other units this many ticks in the past (2 ticks = 100 ms). */
export const INTERP_TICKS = 2;

export class TickClock {
  /** server tick time minus local time, in ms */
  private offset: number | null = null;
  private readonly tickMs: number;
  private readonly interp: number;

  /** speed: watch mode runs the server this many times faster (snapshots come every `speed` ticks). */
  constructor(speed = 1) {
    this.tickMs = 1000 / (TICK_RATE * speed);
    this.interp = INTERP_TICKS * speed;
  }

  onSnapshot(tick: number, now = performance.now()): void {
    const o = tick * this.tickMs - now;
    if (this.offset === null || Math.abs(o - this.offset) > 1000) this.offset = o;
    // An early snapshot means our guess is behind: move fast. A late one is often just jitter
    // (or a resent packet): move slowly, so one slow message does not shake everything.
    else this.offset += (o - this.offset) * (o > this.offset ? 0.25 : 0.02);
  }

  get ready(): boolean {
    return this.offset !== null;
  }

  /** Server tick now (with a fraction). */
  serverTick(now = performance.now()): number {
    return ((this.offset ?? 0) + now) / this.tickMs;
  }

  /** The tick to draw other units at. */
  renderTick(now = performance.now()): number {
    return this.serverTick(now) - this.interp;
  }
}
