import { describe, expect, it } from 'vitest';
import { findCells, keyOutBackground, keyOutGreen, makeSeamless, seamScore, splitTeamColor, type Rgba } from '../art/lib/pixels';

function image(w: number, h: number, paint: (x: number, y: number) => [number, number, number, number]): Rgba {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(paint(x, y), (y * w + x) * 4);
  return { data, width: w, height: h };
}

describe('art pixels', () => {
  it('finds grid lines that are a bit off the even split', () => {
    // 2 x 2 grid on 200 x 200 with dark lines at x = 104 and y = 97 (not exactly 100).
    const img = image(200, 200, (x, y) => (Math.abs(x - 104) < 2 || Math.abs(y - 97) < 2 ? [32, 32, 32, 255] : [200, 150, 90, 255]));
    const cells = findCells(img, 2, 2);
    expect(cells).toHaveLength(4);
    expect(cells[0]!.x + cells[0]!.w).toBeLessThanOrEqual(103);
    expect(cells[1]!.x).toBeGreaterThanOrEqual(105);
    expect(cells[2]!.y).toBeGreaterThanOrEqual(98);
  });

  it('ignores transparent background when looking for lines', () => {
    const img = image(200, 200, (x) => (x < 100 ? [0, 0, 0, 0] : [200, 150, 90, 255]));
    const cells = findCells(img, 2, 1);
    expect(cells[0]!.w).toBeGreaterThan(90);
  });

  it('removes the pure green background', () => {
    const img = image(4, 1, (x) => (x < 2 ? [0, 255, 0, 255] : [180, 40, 40, 255]));
    const out = keyOutGreen(img);
    expect(out.data[3]).toBe(0);
    expect(out.data[15]).toBe(255);
  });

  it('turns magenta into grey shading and an alpha mask', () => {
    const img = image(10, 10, (x) => (x < 5 ? [255, 0, 255, 255] : [90, 60, 30, 255]));
    const { color, mask } = splitTeamColor(img);
    expect(mask).not.toBeNull();
    expect(color.data[0]).toBe(color.data[1]); // grey
    expect(mask!.data[3]).toBe(255); // team pixel
    expect(mask!.data[(0 * 10 + 7) * 4 + 3]).toBe(0); // not team
  });

  it('makes a gradient tile seamless', () => {
    const img = image(64, 64, (x, y) => [x * 4, y * 4, 100, 255]);
    expect(seamScore(img)).toBeGreaterThan(60);
    expect(seamScore(makeSeamless(img))).toBeLessThan(8);
  });

  it('does not take a dark or black picture for grid lines', () => {
    // Black cells (like glow effects) with grey lines at x = 100 and y = 100.
    const img = image(200, 200, (x, y) => (Math.abs(x - 100) < 2 || Math.abs(y - 100) < 2 ? [34, 34, 34, 255] : [0, 0, 0, 255]));
    const cells = findCells(img, 2, 2);
    expect(Math.abs(cells[1]!.x - 103)).toBeLessThanOrEqual(3);
    expect(cells[0]!.w).toBeGreaterThan(90);
  });

  it('keeps green leaves when the backdrop is green', () => {
    // Backdrop (40, 240, 20) around a dark green leaf block in the middle.
    const img = image(60, 60, (x, y) => (x > 20 && x < 40 && y > 20 && y < 40 ? [60, 120, 40, 255] : [40, 240, 20, 255]));
    const out = keyOutBackground(img);
    expect(out.data[3]).toBe(0); // corner backdrop is gone
    expect(out.data[(30 * 60 + 30) * 4 + 3]).toBe(255); // leaf stays
  });
});
