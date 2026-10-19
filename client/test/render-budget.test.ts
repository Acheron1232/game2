import { describe, expect, it } from 'vitest';
import { renderScale } from '../src/render/render-budget';

describe('native rendering resolution', () => {
  it.each([
    [1280, 720, 2],
    [1512, 982, 2],
    [5120, 1440, 2],
    [390, 844, 3],
    [1280, 720, 1],
  ])('preserves native pixels for a %i × %i window at DPR %i', (width, height, ratio) => {
    const scale = renderScale(ratio);
    expect(Math.round(width / scale)).toBe(width * ratio);
    expect(Math.round(height / scale)).toBe(height * ratio);
  });
});
