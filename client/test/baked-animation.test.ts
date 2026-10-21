import { Vector4 } from '@babylonjs/core/Maths/math.vector';
import { describe, expect, it } from 'vitest';
import { bakedPose, holdRow, runClip, shaderRow, type BakedClip } from '../src/render/baked-animation';

// 61 rows = 60 steps over one second: row k of the clip is its pose at k / 60 s.
const clip: BakedClip = { start: 10, rows: 61, seconds: 1 };
const mid = (step: number) => (step + 0.5) / 60;

describe('baked clip settings', () => {
  it('shows the asked phase now and keeps the clip speed on the GPU clock', () => {
    const s = runClip(clip, 1234.567, mid(15), 1, new Vector4());
    expect(shaderRow(s, 1234.567)).toBe(10 + 16);
    expect(shaderRow(s, 1234.567 + 0.5)).toBe(10 + 46);
    // Wraps like a loop: half a clip later again.
    expect(shaderRow(s, 1234.567 + 1)).toBe(10 + 16);
  });

  it('plays faster at a higher speed and freezes at speed 0', () => {
    const fast = runClip(clip, 2000.25, mid(0), 2, new Vector4());
    expect(shaderRow(fast, 2000.25 + 0.25)).toBe(10 + 31);
    const frozen = runClip(clip, 2000.25, 0.5, 0, new Vector4());
    expect(shaderRow(frozen, 2000.25)).toBe(10 + 30);
    expect(shaderRow(frozen, 2100)).toBe(10 + 30);
  });

  it('continues from the same pose when the speed changes', () => {
    const s = runClip(clip, 1500, mid(40), 1, new Vector4());
    const before = shaderRow(s, 1500);
    runClip(clip, 1500, mid(40), 0.4, s);
    expect(shaderRow(s, 1500)).toBe(before);
  });

  it('holds the last row of a finished one-shot clip, and not before', () => {
    const s = new Vector4();
    expect(bakedPose(clip, false, 0.5, 1, 1800, s)).toBe(false);
    expect(shaderRow(s, 1800)).toBe(10 + 31);
    expect(bakedPose(clip, false, 1.2, 1, 1800, s)).toBe(true);
    expect(shaderRow(s, 1800)).toBe(10 + 60);
    expect(shaderRow(s, 1900)).toBe(10 + 60);
    // A loop never holds.
    expect(bakedPose(clip, true, 3.25, 1, 1800, s)).toBe(false);
    expect(shaderRow(s, 1800)).toBe(10 + 16);
  });

  it('can hold the very first row of the texture', () => {
    expect(shaderRow(holdRow(0, new Vector4()), 1234)).toBe(0);
  });
});
