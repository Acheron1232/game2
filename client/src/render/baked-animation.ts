// Baked vertex animation (VAT) for army units. Every frame of a unit type's clips is stored once
// as bone matrices in a texture (one row per frame). Babylon's BakedVertexAnimationManager picks
// the row on the GPU from one shared clock and four numbers per unit, so all units of a type and
// team are one instanced draw, each in its own clip and phase, with no CPU skeleton work.
//
// The shader (Babylon's bakedVertexAnimation include), for settings (start, end, offset, speed):
//   rows = end - start + 1
//   row  = start + 1 + floor(mod(fract(clock * speed / rows) * (rows - 1) + offset, rows - 1))
// once clock * speed / rows >= 1. Row 0 of a clip is skipped: a looping clip ends on its first
// pose. With speed 0 the clock term is 0 and the row is start + floor(mod(offset, rows)).

import type { Vector4 } from '@babylonjs/core/Maths/math.vector';

export interface BakedClip {
  /** first texture row of the clip */
  start: number;
  /** rows (frames) in the clip, first and last pose included */
  rows: number;
  /** clip length at speed 1 */
  seconds: number;
}

/** Shader clock base in seconds: keeps clock * speed / rows >= 1, so one formula always holds. */
const CLOCK_BASE = 1000;
const EPOCH = performance.now();

/** The shared shader clock (seconds) for a performance.now() time. Small numbers keep f32 exact. */
export function bakedClock(nowMs: number): number {
  return (nowMs - EPOCH) / 1000 + CLOCK_BASE;
}

/** Holds one row (a finished one-shot clip). */
export function holdRow(row: number, out: Vector4): Vector4 {
  return out.set(row, row + 1, 0, 0);
}

/**
 * Settings that show `phase` (0..1 of the clip) at shader clock `clock`, then play on at `speed`
 * (1 = the clip's own length). The offset is chosen for this clock, so the GPU continues from
 * exactly here.
 */
export function runClip(clip: BakedClip, clock: number, phase: number, speed: number, out: Vector4): Vector4 {
  const steps = clip.rows - 1;
  if (steps < 1 || !(speed > 0) || !(clip.seconds > 0))
    return holdRow(clip.start + Math.round(Math.min(1, Math.max(0, phase)) * Math.max(0, steps)), out);
  const rate = (clip.rows * speed) / clip.seconds;
  const loop = (clock * rate) / clip.rows;
  const offset = phase - (loop - Math.floor(loop));
  return out.set(clip.start, clip.start + steps, (offset - Math.floor(offset)) * steps, rate);
}

/**
 * Settings for a clip that started `elapsed` clip lengths ago (wall clock x speed / length).
 * Loops wrap; a one-shot clip holds its last row once it is (almost) over. Returns true when held.
 */
export function bakedPose(clip: BakedClip, loop: boolean, elapsed: number, speed: number, clock: number, out: Vector4): boolean {
  if (loop) {
    runClip(clip, clock, elapsed - Math.floor(elapsed), speed, out);
    return false;
  }
  // Hold half a row early: the last row already shows then, and the GPU (f32) can never wrap
  // around to the first pose for a frame before the CPU switches.
  if (elapsed >= 1 - 0.5 / Math.max(1, clip.rows - 1)) {
    holdRow(clip.start + clip.rows - 1, out);
    return true;
  }
  runClip(clip, clock, Math.max(0, elapsed), speed, out);
  return false;
}

/** The row the shader shows for these settings at this clock (same math as the GPU, for tests). */
export function shaderRow(settings: Vector4, clock: number): number {
  const { x: start, y: end, z: offset, w: speed } = settings;
  const rows = end - start + 1;
  const t = (clock * speed) / rows;
  const correction = t < 1 ? 0 : 1;
  const count = rows - correction;
  return Math.floor(((t - Math.floor(t)) * count + offset) % count) + start + correction;
}
