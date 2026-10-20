import { describe, expect, it } from 'vitest';
import {
  buildFogOverlayPixels,
  fadeFogValues,
  FOG_EXPLORED_BRIGHTNESS,
  FOG_HIDDEN_BRIGHTNESS,
  FOG_VISIBLE_BRIGHTNESS,
  fogBrightness,
  type FogGrid,
} from '../src/render/fog';

describe('fog of war', () => {
  it('fades both ways, snaps to targets and reports when work stops', () => {
    const current = new Float32Array([0.15, 1, 0.45]);
    const target = new Float32Array([1, 0.45, 0.45]);

    expect(fadeFogValues(current, target, 0.25)).toBe(true);
    expect([...current]).toEqual([0.4000000059604645, 0.75, 0.44999998807907104]);
    expect(fadeFogValues(current, target, 1)).toBe(true);
    expect([...current]).toEqual([...target]);
    expect(fadeFogValues(current, target, 1)).toBe(false);
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
