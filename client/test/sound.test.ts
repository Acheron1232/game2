import { describe, expect, it } from 'vitest';
import { distanceGain, panFor } from '../src/audio/sound';

describe('sound distance', () => {
  it('is full near the camera, fades out, and is silent far away', () => {
    expect(distanceGain(0)).toBe(1);
    expect(distanceGain(10)).toBe(1);
    const mid = distanceGain(30);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(distanceGain(48)).toBe(0);
    expect(distanceGain(100)).toBe(0);
    expect(distanceGain(20)).toBeGreaterThan(distanceGain(40));
  });

  it('pans left and right and stays in -1..1', () => {
    expect(panFor(0)).toBe(0);
    expect(panFor(-10)).toBeLessThan(0);
    expect(panFor(500)).toBe(1);
    expect(panFor(-500)).toBe(-1);
  });
});
