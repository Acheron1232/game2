// Shadows of the things that never move: trees, rocks, ruins, pillars, lanterns. They are painted
// once, at load, into one texture over the whole map (and the mountain apron), and the terrain
// shader darkens the ground with it. Real shadow maps would draw thousands of trees again every
// time the view moves; this costs one texture read per ground pixel.
// Each shadow is a soft blob thrown away from the sun: the higher a part of the object, the
// farther its shadow falls (the sun is low, so shadows are long). A cut tree takes its shadow
// with it: its stamp is taken off again.

import { Constants } from '@babylonjs/core/Engines/constants';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Scene } from '@babylonjs/core/scene';

/** Texels per side. 1024 over about 320 units = a texel every 0.31 units (soft shadows need no more). */
export const STATIC_SHADOW_SIZE = 1024;
/** How dark a full shadow makes the ground (0 = no shadow, 1 = black). */
export const STATIC_SHADOW_STRENGTH = 0.48;
/** Stamp values are stored x this, so taking a stamp off gives back the same numbers. */
const UNIT = 256;

/** The shape of one object's shadow. Sizes in game units. */
export interface ShadowShape {
  /** height of the object's top */
  height: number;
  /** radius of the top part (a tree crown, a rock) */
  crown: number;
  /** where the crown's middle is, as a part of the height (0.5 = halfway up) */
  crownAt: number;
  /** radius of the trunk / pillar (0 = none) */
  trunk: number;
  /** darkness at the middle of the shadow, 0..1 */
  dark: number;
}

export class StaticShadows {
  readonly texture: RawTexture;
  private readonly sum: Uint32Array;
  private readonly pixels: Uint8Array;
  private readonly cell: number;
  /** sun direction on the ground (game x, y) and shadow length per unit of height */
  private readonly dirX: number;
  private readonly dirY: number;
  private readonly reach: number;
  private dirty = false;

  /**
   * @param origin game position of texel (0, 0) (the apron starts below 0)
   * @param span game units covered by the texture
   * @param sun the sun's world direction (where its light goes; world z = -game y)
   */
  constructor(
    scene: Scene,
    private readonly origin: number,
    span: number,
    sun: { x: number; y: number; z: number },
  ) {
    const n = STATIC_SHADOW_SIZE;
    this.cell = span / n;
    this.sum = new Uint32Array(n * n);
    this.pixels = new Uint8Array(n * n);
    const flat = Math.hypot(sun.x, sun.z) || 1;
    this.dirX = sun.x / flat;
    this.dirY = -sun.z / flat;
    this.reach = flat / Math.max(0.2, -sun.y);
    this.texture = new RawTexture(
      this.pixels,
      n,
      n,
      Constants.TEXTUREFORMAT_R,
      scene,
      false,
      false,
      Texture.BILINEAR_SAMPLINGMODE,
      Constants.TEXTURETYPE_UNSIGNED_BYTE,
    );
    this.texture.wrapU = this.texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  }

  /** Adds (sign 1) or takes off (sign -1) the shadow of an object standing at game (x, y). */
  stamp(x: number, y: number, shape: ShadowShape, sign: 1 | -1 = 1): void {
    const k = this.reach;
    // The trunk: a narrow strip from the foot toward the crown's shadow.
    if (shape.trunk > 0) {
      const len = shape.height * shape.crownAt * k;
      this.capsule(x, y, x + this.dirX * len, y + this.dirY * len, shape.trunk, shape.dark * 0.8, sign);
    }
    // The crown: a soft blob, longer along the sun (the low sun stretches it).
    const off = shape.height * shape.crownAt * k;
    const stretch = 1 + Math.min(1.2, k * 0.45);
    this.ellipse(x + this.dirX * off, y + this.dirY * off, shape.crown * stretch, shape.crown, shape.dark, sign);
    // Shade right under it, where the object meets the ground. The sun is behind the camera, so
    // the long shadow mostly falls behind the object; this pool is what grounds it on screen.
    const foot = Math.max(shape.trunk * 2.5, shape.crown * 0.8);
    this.ellipse(x, y, foot, foot, shape.dark * 0.55, sign);
    this.dirty = true;
  }

  /** Sends changed shadows to the GPU (once per frame at most). */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.texture.update(this.pixels);
  }

  /** Soft ellipse: radius `along` in the sun's direction, `across` sideways. */
  private ellipse(cx: number, cy: number, along: number, across: number, dark: number, sign: number): void {
    const r = Math.max(along, across);
    this.each(cx - r, cy - r, cx + r, cy + r, sign, (gx, gy) => {
      const dx = gx - cx,
        dy = gy - cy;
      const a = (dx * this.dirX + dy * this.dirY) / along;
      const b = (-dx * this.dirY + dy * this.dirX) / across;
      return dark * soft(Math.sqrt(a * a + b * b));
    });
  }

  /** Soft line of radius r from (ax, ay) to (bx, by). */
  private capsule(ax: number, ay: number, bx: number, by: number, r: number, dark: number, sign: number): void {
    const vx = bx - ax,
      vy = by - ay;
    const len2 = vx * vx + vy * vy || 1;
    this.each(Math.min(ax, bx) - r, Math.min(ay, by) - r, Math.max(ax, bx) + r, Math.max(ay, by) + r, sign, (gx, gy) => {
      const t = Math.max(0, Math.min(1, ((gx - ax) * vx + (gy - ay) * vy) / len2));
      const d = Math.hypot(gx - ax - vx * t, gy - ay - vy * t) / r;
      // Fades a little toward the far end.
      return dark * soft(d) * (1 - t * 0.35);
    });
  }

  /** Runs `value` on every texel inside a game rectangle and adds it (x sign) to the sum. */
  private each(x0: number, y0: number, x1: number, y1: number, sign: number, value: (gx: number, gy: number) => number): void {
    const n = STATIC_SHADOW_SIZE;
    const c0 = Math.max(0, Math.floor((x0 - this.origin) / this.cell));
    const c1 = Math.min(n - 1, Math.ceil((x1 - this.origin) / this.cell));
    const r0 = Math.max(0, Math.floor((y0 - this.origin) / this.cell));
    const r1 = Math.min(n - 1, Math.ceil((y1 - this.origin) / this.cell));
    for (let row = r0; row <= r1; row++) {
      const gy = this.origin + (row + 0.5) * this.cell;
      for (let col = c0; col <= c1; col++) {
        const v = Math.round(value(this.origin + (col + 0.5) * this.cell, gy) * UNIT);
        if (v <= 0) continue;
        const i = row * n + col;
        this.sum[i] = Math.max(0, this.sum[i]! + sign * v);
        // Shadows that overlap do not get darker than one shadow (one sun, one shade).
        this.pixels[i] = Math.min(255, Math.round((this.sum[i]! * 255) / UNIT));
      }
    }
  }
}

/** 1 in the middle, soft edge from 55% of the radius out to the rim. */
function soft(d: number): number {
  if (d >= 1) return 0;
  if (d <= 0.55) return 1;
  const t = (1 - d) / 0.45;
  return t * t * (3 - 2 * t);
}

/** Shadow shapes of the map's trees and decor models (by model id). Small props cast none. */
export const SHADOW_SHAPES: Record<string, ShadowShape> = {
  tree_pine: { height: 4.1, crown: 1.15, crownAt: 0.45, trunk: 0.14, dark: 0.85 },
  tree_oak: { height: 3.2, crown: 1.55, crownAt: 0.62, trunk: 0.16, dark: 0.85 },
  tree_dead: { height: 2.4, crown: 0.7, crownAt: 0.65, trunk: 0.12, dark: 0.45 },
  bush: { height: 0.7, crown: 0.7, crownAt: 0.45, trunk: 0, dark: 0.6 },
  rock_big: { height: 1.7, crown: 1.1, crownAt: 0.35, trunk: 0, dark: 0.75 },
  rock_small: { height: 0.4, crown: 0.35, crownAt: 0.3, trunk: 0, dark: 0.5 },
  stump: { height: 0.43, crown: 0.32, crownAt: 0.4, trunk: 0, dark: 0.5 },
  log: { height: 0.56, crown: 0.55, crownAt: 0.4, trunk: 0, dark: 0.5 },
  ruin_block: { height: 0.6, crown: 0.65, crownAt: 0.4, trunk: 0, dark: 0.6 },
  ruin_pillar: { height: 2.45, crown: 0.4, crownAt: 0.85, trunk: 0.32, dark: 0.7 },
  statue: { height: 2.4, crown: 0.55, crownAt: 0.75, trunk: 0.35, dark: 0.7 },
  crate: { height: 1.25, crown: 0.6, crownAt: 0.45, trunk: 0, dark: 0.6 },
  barrel: { height: 0.85, crown: 0.4, crownAt: 0.45, trunk: 0, dark: 0.55 },
  fence: { height: 1, crown: 0.6, crownAt: 0.5, trunk: 0, dark: 0.4 },
  crystal: { height: 1.75, crown: 0.55, crownAt: 0.45, trunk: 0, dark: 0.45 },
  lantern: { height: 2.2, crown: 0.25, crownAt: 0.85, trunk: 0.08, dark: 0.5 },
  rune_stone: { height: 2.0, crown: 0.4, crownAt: 0.6, trunk: 0.3, dark: 0.65 },
};
