// Guesses the server's tick right now from when snapshots arrive. Other units are drawn a
// little in the past (INTERP_TICKS), between snapshots we already have, which hides jitter.

import { TICK_RATE } from '@game/shared';

const TICK_MS = 1000 / TICK_RATE;
/** Draw other units this many ticks in the past (2 ticks = 100 ms). */
export const INTERP_TICKS = 2;

export class TickClock {
  /** server tick time minus local time, in ms */
  private offset: number | null = null;

  onSnapshot(tick: number, now = performance.now()): void {
    const o = tick * TICK_MS - now;
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
    return ((this.offset ?? 0) + now) / TICK_MS;
  }

  /** The tick to draw other units at. */
  renderTick(now = performance.now()): number {
    return this.serverTick(now) - INTERP_TICKS;
  }
}
