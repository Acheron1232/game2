import { describe, expect, it } from 'vitest';
import { EventTimeline } from '../src/game/event-timeline';

describe('combat event timeline', () => {
  it('waits for the pose tick, copies reused snapshot events and emits each event once', () => {
    const timeline = new EventTimeline();
    const event = { type: 1, a: 10, b: 20, value: 0, kind: 0 };
    timeline.add(10, event);
    event.a = 11;
    timeline.add(11, event);
    const seen: number[] = [];
    const visit = (e: typeof event) => seen.push(e.a);
    timeline.drain(9.9, visit);
    expect(seen).toEqual([]);
    timeline.drain(10, visit);
    expect(seen).toEqual([10]);
    timeline.drain(10.5, visit);
    expect(seen).toEqual([10]);
    event.a = 12;
    timeline.add(12, event);
    timeline.drain(12, visit);
    expect(seen).toEqual([10, 11, 12]);
    timeline.drain(100, visit);
    expect(seen).toEqual([10, 11, 12]);
  });
});
