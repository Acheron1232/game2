// Dev tool: fake network lag. `?lag=100&loss=2` adds 100 ms to the round trip (50 ms each way)
// and "loses" 2% of messages. WebSocket runs on TCP, so a lost packet is not gone: it comes
// again later and everything behind it waits. That is what we copy: a lost message is late by
// a resend time, and the order stays the same.

export interface LagSettings {
  /** extra round-trip time in ms */
  lagMs: number;
  /** percent of messages that are late by a resend */
  lossPct: number;
}

export function lagFromUrl(): LagSettings {
  const p = new URLSearchParams(location.search);
  return { lagMs: Math.max(0, Number(p.get('lag') ?? 0) || 0), lossPct: Math.max(0, Math.min(50, Number(p.get('loss') ?? 0) || 0)) };
}

export class LagLine<T> {
  private lastDue = 0;

  constructor(
    private readonly settings: LagSettings,
    private readonly deliver: (msg: T) => void,
  ) {}

  get active(): boolean {
    return this.settings.lagMs > 0 || this.settings.lossPct > 0;
  }

  push(msg: T): void {
    if (!this.active) return this.deliver(msg);
    const now = performance.now();
    let due = now + this.settings.lagMs / 2;
    // A resend takes at least 200 ms (TCP's shortest retry time) or two round trips.
    if (Math.random() * 100 < this.settings.lossPct) due += Math.max(200, this.settings.lagMs * 2);
    due = Math.max(due, this.lastDue);
    this.lastDue = due;
    setTimeout(() => this.deliver(msg), due - now);
  }
}
