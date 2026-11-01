import { describe, expect, it } from 'vitest';
import {
  blurFogValues,
  buildFogOverlayPixels,
  easeFogValues,
  FOG_EXPLORED_BRIGHTNESS,
  FOG_HIDDEN_BRIGHTNESS,
  FOG_VISIBLE_BRIGHTNESS,
  fogBrightness,
  type FogGrid,
} from '../src/render/fog';

describe('fog of war', () => {
  it('eases both ways, snaps near the target and reports when work stops', () => {
    const current = new Float32Array([0.25, 1, 0.45]);
    const target = new Float32Array([1, 0.45, 0.45]);

    expect(easeFogValues(current, target, 0.5)).toBe(true);
    expect(current[0]).toBeCloseTo(0.625);
    expect(current[1]).toBeCloseTo(0.725);
    expect(current[2]).toBeCloseTo(0.45);
    for (let i = 0; i < 20; i++) easeFogValues(current, target, 0.5);
    expect([...current]).toEqual([...target]);
    expect(easeFogValues(current, target, 0.5)).toBe(false);
  });

  it('blurs the border between seen and unseen cells but keeps flat areas as they are', () => {
    const cols = 8;
    const src = new Float32Array(cols * cols).fill(FOG_HIDDEN_BRIGHTNESS);
    for (let y = 0; y < cols; y++) for (let x = 0; x < 4; x++) src[y * cols + x] = FOG_VISIBLE_BRIGHTNESS;
    const out = new Float32Array(cols * cols);
    blurFogValues(src, cols, new Float32Array(cols * cols), out);
    // Far from the border: unchanged. At the border: in between, falling off step by step.
    expect(out[3 * cols]).toBeCloseTo(FOG_VISIBLE_BRIGHTNESS);
    expect(out[3 * cols + 7]).toBeCloseTo(FOG_HIDDEN_BRIGHTNESS);
    const row = [...out.slice(3 * cols, 4 * cols)];
    for (let x = 1; x < cols; x++) expect(row[x]!).toBeLessThanOrEqual(row[x - 1]! + 1e-6);
    expect(row[3]!).toBeLessThan(FOG_VISIBLE_BRIGHTNESS);
    expect(row[4]!).toBeGreaterThan(FOG_HIDDEN_BRIGHTNESS);
  });

  it('maps visible, explored and hidden cells to their light levels', () => {
    expect(fogBrightness(1, 0)).toBe(FOG_VISIBLE_BRIGHTNESS);
    expect(fogBrightness(0, 1)).toBe(FOG_EXPLORED_BRIGHTNESS);
    expect(fogBrightness(0, 0)).toBe(FOG_HIDDEN_BRIGHTNESS);
    expect(fogBrightness(1, 1)).toBe(FOG_VISIBLE_BRIGHTNESS);
  });

  it('builds a 4 by 4 top-down minimap mask', () => {
    const grid: FogGrid = {
      cols: 4,
      cell: 2,
      visible: new Uint8Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
      explored: new Uint8Array([0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0]),
    };

    const alpha = [...buildFogOverlayPixels(grid)].filter((_, i) => i % 4 === 3);
    // Never seen = 1 - FOG_HIDDEN_BRIGHTNESS, explored = 1 - 0.45, seen = 0 (alpha 0..255).
    const h = Math.round((1 - FOG_HIDDEN_BRIGHTNESS) * 255);
    expect(alpha).toEqual([140, h, h, 0, h, h, 0, 140, h, 0, 140, h, 0, 140, h, h]);
  });
});
