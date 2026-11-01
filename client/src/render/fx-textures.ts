// Effect textures drawn in code at start-up (white shapes on transparent): no files to download,
// sharp at any size, and the material tints them. One texture per scene and shape.

import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Scene } from '@babylonjs/core/scene';

export type FxShape = 'glow' | 'ring' | 'rune' | 'stars' | 'eye' | 'alert' | 'spark' | 'thorns' | 'aoe' | 'dashring' | 'arrows' | 'leaf';

const SIZE = 256;
const cache = new WeakMap<Scene, Map<FxShape, Texture>>();

type Ctx = CanvasRenderingContext2D;

function star(c: Ctx, x: number, y: number, r: number, inner = 0.28): void {
  c.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 - Math.PI / 2;
    const d = i % 2 ? r * inner : r;
    c.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
  }
  c.closePath();
  c.fill();
}

const DRAW: Record<FxShape, (c: Ctx, s: number) => void> = {
  // Soft round light, bright in the middle.
  glow(c, s) {
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.65)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.15)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
  },
  // A soft glowing ring near the edge (ground circles).
  ring(c, s) {
    const g = c.createRadialGradient(s / 2, s / 2, s * 0.3, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.08)');
    g.addColorStop(0.86, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.93, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
  },
  // Aura circle: two rings, ticks and small runes between them, a faint fill.
  rune(c, s) {
    const m = s / 2;
    const fill = c.createRadialGradient(m, m, 0, m, m, m);
    fill.addColorStop(0, 'rgba(255,255,255,0)');
    fill.addColorStop(0.7, 'rgba(255,255,255,0.05)');
    fill.addColorStop(0.95, 'rgba(255,255,255,0.18)');
    fill.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = fill;
    c.fillRect(0, 0, s, s);
    c.strokeStyle = '#fff';
    c.fillStyle = '#fff';
    c.shadowColor = '#fff';
    c.shadowBlur = s * 0.02;
    c.lineWidth = s * 0.012;
    for (const r of [0.47, 0.4]) {
      c.beginPath();
      c.arc(m, m, s * r, 0, Math.PI * 2);
      c.stroke();
    }
    c.lineWidth = s * 0.006;
    c.beginPath();
    c.arc(m, m, s * 0.3, 0, Math.PI * 2);
    c.stroke();
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const r0 = i % 2 ? 0.405 : 0.395,
        r1 = i % 2 ? 0.43 : 0.465;
      c.beginPath();
      c.moveTo(m + Math.cos(a) * s * r0, m + Math.sin(a) * s * r0);
      c.lineTo(m + Math.cos(a) * s * r1, m + Math.sin(a) * s * r1);
      c.stroke();
    }
    // Runes: a small diamond or star every 45 degrees between the rings.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const x = m + Math.cos(a) * s * 0.352,
        y = m + Math.sin(a) * s * 0.352;
      if (i % 2) star(c, x, y, s * 0.028, 0.35);
      else {
        c.beginPath();
        c.moveTo(x, y - s * 0.026);
        c.lineTo(x + s * 0.016, y);
        c.lineTo(x, y + s * 0.026);
        c.lineTo(x - s * 0.016, y);
        c.closePath();
        c.fill();
      }
    }
  },
  // Three stars on a circle: seen from above they orbit the head of a stunned unit.
  stars(c, s) {
    c.fillStyle = '#fff';
    c.shadowColor = '#fff';
    c.shadowBlur = s * 0.05;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      star(c, s / 2 + Math.cos(a) * s * 0.32, s / 2 + Math.sin(a) * s * 0.32, s * 0.13);
    }
  },
  // An open eye (marked, revealed).
  eye(c, s) {
    const m = s / 2;
    c.strokeStyle = '#fff';
    c.fillStyle = '#fff';
    c.shadowColor = '#fff';
    c.shadowBlur = s * 0.05;
    c.lineWidth = s * 0.05;
    c.beginPath();
    c.moveTo(s * 0.12, m);
    c.quadraticCurveTo(m, s * 0.18, s * 0.88, m);
    c.quadraticCurveTo(m, s * 0.82, s * 0.12, m);
    c.closePath();
    c.stroke();
    c.beginPath();
    c.arc(m, m, s * 0.12, 0, Math.PI * 2);
    c.fill();
  },
  // "!" in a diamond (taunted: must attack).
  alert(c, s) {
    const m = s / 2;
    c.strokeStyle = '#fff';
    c.fillStyle = '#fff';
    c.shadowColor = '#fff';
    c.shadowBlur = s * 0.04;
    c.lineWidth = s * 0.05;
    c.beginPath();
    c.moveTo(m, s * 0.08);
    c.lineTo(s * 0.92, m);
    c.lineTo(m, s * 0.92);
    c.lineTo(s * 0.08, m);
    c.closePath();
    c.stroke();
    c.fillRect(m - s * 0.045, s * 0.26, s * 0.09, s * 0.32);
    c.beginPath();
    c.arc(m, s * 0.7, s * 0.055, 0, Math.PI * 2);
    c.fill();
  },
  // A four-point sparkle for particles.
  spark(c, s) {
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s * 0.22);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
    c.fillStyle = '#fff';
    star(c, s / 2, s / 2, s * 0.46, 0.12);
  },
  // A ring of thorns (rooted).
  thorns(c, s) {
    const m = s / 2;
    c.fillStyle = '#fff';
    c.strokeStyle = '#fff';
    c.lineWidth = s * 0.025;
    c.beginPath();
    c.arc(m, m, s * 0.4, 0, Math.PI * 2);
    c.stroke();
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const out = i % 2 ? 0.48 : 0.3;
      c.beginPath();
      c.moveTo(m + Math.cos(a - 0.09) * s * 0.4, m + Math.sin(a - 0.09) * s * 0.4);
      c.lineTo(m + Math.cos(a) * s * out, m + Math.sin(a) * s * out);
      c.lineTo(m + Math.cos(a + 0.09) * s * 0.4, m + Math.sin(a + 0.09) * s * 0.4);
      c.closePath();
      c.fill();
    }
  },
  // A small leaf with a middle vein (falling leaves).
  leaf(c, s) {
    const m = s / 2;
    c.fillStyle = '#fff';
    c.beginPath();
    c.moveTo(m, s * 0.08);
    c.quadraticCurveTo(s * 0.86, s * 0.42, m, s * 0.92);
    c.quadraticCurveTo(s * 0.14, s * 0.42, m, s * 0.08);
    c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.35)';
    c.lineWidth = s * 0.03;
    c.beginPath();
    c.moveTo(m, s * 0.14);
    c.lineTo(m, s * 0.86);
    c.stroke();
  },
  // Aiming an area: a light fill that gets stronger toward a bright rim, with ticks.
  aoe(c, s) {
    const m = s / 2;
    const g = c.createRadialGradient(m, m, 0, m, m, m);
    g.addColorStop(0, 'rgba(255,255,255,0.08)');
    g.addColorStop(0.75, 'rgba(255,255,255,0.22)');
    g.addColorStop(0.9, 'rgba(255,255,255,0.4)');
    g.addColorStop(0.955, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
    c.strokeStyle = 'rgba(255,255,255,0.9)';
    c.lineWidth = s * 0.012;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      c.beginPath();
      c.moveTo(m + Math.cos(a) * s * 0.4, m + Math.sin(a) * s * 0.4);
      c.lineTo(m + Math.cos(a) * s * 0.45, m + Math.sin(a) * s * 0.45);
      c.stroke();
    }
    c.beginPath();
    c.arc(m, m, s * 0.035, 0, Math.PI * 2);
    c.fillStyle = 'rgba(255,255,255,0.8)';
    c.fill();
  },
  // Cast range: a thin dashed ring.
  dashring(c, s) {
    const m = s / 2;
    c.strokeStyle = '#fff';
    c.shadowColor = '#fff';
    c.shadowBlur = s * 0.01;
    c.lineWidth = s * 0.008;
    const n = 48;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      c.beginPath();
      c.arc(m, m, s * 0.49, a, a + (Math.PI * 2) / n / 1.8);
      c.stroke();
    }
  },
  // A line skill: bright side edges and chevrons pointing along +v (the cast direction).
  arrows(c, s) {
    const g = c.createLinearGradient(0, 0, s, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.06, 'rgba(255,255,255,0.3)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.14)');
    g.addColorStop(0.94, 'rgba(255,255,255,0.3)');
    g.addColorStop(1, 'rgba(255,255,255,0.95)');
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
    c.strokeStyle = 'rgba(255,255,255,0.85)';
    c.lineWidth = s * 0.05;
    c.lineJoin = 'round';
    for (let k = 0; k < 2; k++) {
      const y = s * (0.3 + k * 0.5);
      c.beginPath();
      c.moveTo(s * 0.22, y + s * 0.14);
      c.lineTo(s * 0.5, y - s * 0.06);
      c.lineTo(s * 0.78, y + s * 0.14);
      c.stroke();
    }
  },
};

const coneCache = new WeakMap<Scene, Map<number, Texture>>();

/**
 * A cone skill seen from above: a sector of `angleDeg` pointing to +u from the middle of the
 * texture, with bright edges, a soft fill and chevrons. One texture per angle.
 */
export function coneTexture(scene: Scene, angleDeg: number): Texture {
  let byAngle = coneCache.get(scene);
  if (!byAngle) coneCache.set(scene, (byAngle = new Map()));
  const key = Math.round(angleDeg);
  let t = byAngle.get(key);
  if (t) return t;
  const dt = new DynamicTexture(`fx-cone-${key}`, { width: SIZE * 2, height: SIZE * 2 }, scene, true);
  const c = dt.getContext() as unknown as Ctx;
  const s = SIZE * 2,
    m = s / 2,
    r = m * 0.97;
  const half = ((angleDeg / 2) * Math.PI) / 180;
  c.clearRect(0, 0, s, s);
  const fill = c.createRadialGradient(m, m, 0, m, m, r);
  fill.addColorStop(0, 'rgba(255,255,255,0.05)');
  fill.addColorStop(0.85, 'rgba(255,255,255,0.28)');
  fill.addColorStop(1, 'rgba(255,255,255,0.45)');
  c.fillStyle = fill;
  c.beginPath();
  c.moveTo(m, m);
  c.arc(m, m, r, -half, half);
  c.closePath();
  c.fill();
  c.strokeStyle = '#fff';
  c.shadowColor = '#fff';
  c.shadowBlur = s * 0.012;
  c.lineWidth = s * 0.012;
  c.lineJoin = 'round';
  c.stroke();
  // Chevrons along the middle, pointing out.
  c.lineWidth = s * 0.01;
  c.strokeStyle = 'rgba(255,255,255,0.7)';
  for (const d of [0.35, 0.55, 0.75]) {
    const x = m + r * d,
      w = r * d * Math.sin(Math.min(half, 0.5)) * 0.35;
    c.beginPath();
    c.moveTo(x - w * 0.6, m - w);
    c.lineTo(x, m);
    c.lineTo(x - w * 0.6, m + w);
    c.stroke();
  }
  dt.hasAlpha = true;
  dt.update(false);
  dt.wrapU = dt.wrapV = Texture.CLAMP_ADDRESSMODE;
  byAngle.set(key, (t = dt));
  return t;
}

export function fxTexture(scene: Scene, shape: FxShape): Texture {
  let byShape = cache.get(scene);
  if (!byShape) cache.set(scene, (byShape = new Map()));
  let t = byShape.get(shape);
  if (!t) {
    const dt = new DynamicTexture(`fx-${shape}`, { width: SIZE, height: SIZE }, scene, true);
    const c = dt.getContext() as unknown as Ctx;
    c.clearRect(0, 0, SIZE, SIZE);
    DRAW[shape](c, SIZE);
    dt.hasAlpha = true;
    dt.update(false);
    dt.wrapU = dt.wrapV = Texture.CLAMP_ADDRESSMODE;
    byShape.set(shape, (t = dt));
  }
  return t;
}
