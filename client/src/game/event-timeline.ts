import type { NetEvent } from '@game/shared';

interface TimedEvent extends NetEvent {
  tick: number;
}

/** Events and remote poses must use the same render tick, or walking cancels a new swing. */
export class EventTimeline {
  private readonly items: TimedEvent[] = [];
  private count = 0;

  add(tick: number, event: NetEvent): void {
    const item = (this.items[this.count++] ??= { tick, ...event });
    Object.assign(item, event);
    item.tick = tick;
  }

  drain(tick: number, visit: (event: NetEvent) => void): void {
    let keep = 0;
    const count = this.count;
    for (let i = 0; i < count; i++) {
      const event = this.items[i]!;
      if (event.tick <= tick) visit(event);
      else {
        // Swap reusable slots rather than allocating a queue on every frame.
        const spare = this.items[keep]!;
        this.items[keep++] = event;
        this.items[i] = spare;
      }
    }
    this.count = keep;
  }
}
