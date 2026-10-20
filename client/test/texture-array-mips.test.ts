import { describe, expect, it } from 'vitest';
import { downsampleArrayMip } from '../src/render/texture-array-mips';

describe('terrain array mipmaps', () => {
  it('keeps every layer and its brightness down to the last mip', () => {
    const colors = [
      [40, 160, 70, 255],
      [130, 90, 30, 255],
      [70, 40, 20, 255],
    ];
    let mip = new Uint8Array(8 * 8 * 4 * colors.length);
    colors.forEach((color, layer) => {
      for (let p = 0; p < 64; p++) mip.set(color, layer * 64 * 4 + p * 4);
    });
    for (let size = 8; size > 1; size /= 2) {
      mip = downsampleArrayMip(mip, size, colors.length);
      const pixels = (size / 2) ** 2;
      colors.forEach((color, layer) => {
        for (let p = 0; p < pixels; p++) expect([...mip.slice((layer * pixels + p) * 4, (layer * pixels + p + 1) * 4)]).toEqual(color);
      });
    }
    expect(mip.length).toBe(colors.length * 4);
  });

  it('averages each 2 × 2 block without mixing neighboring layers', () => {
    const source = new Uint8Array(2 * 2 * 4 * 2);
    for (let i = 0; i < 4; i++) {
      source.set([i * 40, 100, 200, 255], i * 4);
      source.set([200, i * 20, 50, 255], (4 + i) * 4);
    }
    expect([...downsampleArrayMip(source, 2, 2)]).toEqual([60, 100, 200, 255, 200, 30, 50, 255]);
  });
});
