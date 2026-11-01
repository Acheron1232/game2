// Fills the dark backdrop around the painting in each cell of a model skin with the painted
// material's own color. Codex paints a skin cell like a picture: a pauldron or a leg on a dark
// grey background. Round parts and back faces take texture from the whole cell, so that
// backdrop showed on the models as black patches (Tidebreaker's shoulders, Obsidian Heart's orbs).
//
//   pnpm --filter @game/tools exec tsx art/skin-bleed.ts <skin> [skin...]   (or --all)
//
// Changes client/public/assets/models/<skin>.webp and art/source/models/<skin>_preview.png
// (the Blender preview texture). Run it once per new skin: a second run blurs the filled
// backdrop again (a little softer each time).
// Run it after art:process or a new skin, then rebuild the models only for the previews.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const ROOT = join(import.meta.dirname, '..', '..');
const MODELS = join(ROOT, 'client', 'public', 'assets', 'models');
const WEBP = { quality: 88, alphaQuality: 100, effort: 5 } as const;
/** Skins are 4 cells across. */
const GRID = 4;
/** A backdrop pixel: dark and grey (painted dark metal or cloth usually has some color). */
const DARK = 42;
const GREY = 22;
/** Cells that are mostly dark on purpose (black hair, a night cloak) are left alone. */
const MAX_BACKDROP = 0.45;

interface Image {
  data: Buffer;
  width: number;
  height: number;
  channels: number;
}

/** Returns how many pixels were filled. */
export function bleedCells(img: Image): number {
  const { data, width, height, channels } = img;
  // Square cells, 4 across; the 20-cell hero skins are 4 x 5 (1024 x 1280).
  const cw = Math.floor(width / GRID),
    ch = cw,
    rows = Math.floor(height / ch);
  let filled = 0;
  for (let gy = 0; gy < rows; gy++)
    for (let gx = 0; gx < GRID; gx++) filled += bleedCell(data, width, channels, gx * cw, gy * ch, cw, ch);
  return filled;
}

function bleedCell(data: Buffer, width: number, channels: number, x0: number, y0: number, w: number, h: number): number {
  const at = (x: number, y: number) => ((y0 + y) * width + x0 + x) * channels;
  const backdrop = (x: number, y: number) => {
    const o = at(x, y);
    const r = data[o]!,
      g = data[o + 1]!,
      b = data[o + 2]!;
    const hi = Math.max(r, g, b),
      lo = Math.min(r, g, b);
    return 0.3 * r + 0.59 * g + 0.11 * b < DARK && hi - lo < GREY;
  };
  // Backdrop = dark grey pixels connected to the cell's edge.
  const bg = new Uint8Array(w * h);
  const queue: number[] = [];
  const seed = (x: number, y: number) => {
    const i = y * w + x;
    if (!bg[i] && backdrop(x, y)) {
      bg[i] = 1;
      queue.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x, 0);
    seed(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    seed(0, y);
    seed(w - 1, y);
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]!,
      x = i % w,
      y = (i - x) / w;
    if (x > 0) seed(x - 1, y);
    if (x < w - 1) seed(x + 1, y);
    if (y > 0) seed(x, y - 1);
    if (y < h - 1) seed(x, y + 1);
  }
  const count = queue.length;
  if (!count || count > MAX_BACKDROP * w * h || count === w * h) return 0;
  // Fill from the painting outward, one ring at a time: each pixel takes the mean of its known
  // neighbors, a little darker the farther it is, so the edge of a part reads but is not black.
  const dist = new Int32Array(w * h).fill(-1);
  for (let i = 0; i < w * h; i++) if (!bg[i]) dist[i] = 0;
  let ring: number[] = [];
  const near = (i: number, fn: (j: number) => void) => {
    const x = i % w,
      y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx,
          ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h) fn(ny * w + nx);
      }
  };
  for (const i of queue) {
    let edge = false;
    near(i, (j) => (edge ||= dist[j] === 0));
    if (edge) ring.push(i);
  }
  const color = new Float32Array(3);
  const queued = new Uint8Array(w * h);
  for (const i of ring) queued[i] = 1;
  for (let d = 1; ring.length; d++) {
    const next: number[] = [];
    const values: number[] = [];
    for (const i of ring) {
      color.fill(0);
      let n = 0;
      near(i, (j) => {
        if (dist[j] < 0 || dist[j] >= d) return;
        const o = at(j % w, (j - (j % w)) / w);
        color[0] += data[o]!;
        color[1] += data[o + 1]!;
        color[2] += data[o + 2]!;
        n++;
      });
      const k = n ? (1 / n) * (d === 1 ? 0.97 : 0.995) : 0;
      values.push(color[0] * k, color[1] * k, color[2] * k);
    }
    ring.forEach((i, r) => {
      const o = at(i % w, (i - (i % w)) / w);
      data[o] = Math.round(values[r * 3]!);
      data[o + 1] = Math.round(values[r * 3 + 1]!);
      data[o + 2] = Math.round(values[r * 3 + 2]!);
      dist[i] = d;
    });
    for (const i of ring)
      near(i, (j) => {
        if (dist[j] < 0 && bg[j] && !queued[j]) {
          queued[j] = 1;
          next.push(j);
        }
      });
    ring = next;
  }
  // The ring fill leaves streaks; a soft blur over the filled pixels turns them into a calm
  // backdrop of the same material color. The painting itself is not touched.
  for (let pass = 0; pass < 3; pass++) blurFilled(data, width, channels, x0, y0, w, h, bg, 6);
  return count;
}

function blurFilled(data: Buffer, width: number, channels: number, x0: number, y0: number, w: number, h: number, mask: Uint8Array, r: number): void {
  const src = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = ((y0 + y) * width + x0 + x) * channels;
      const i = (y * w + x) * 3;
      src[i] = data[o]!;
      src[i + 1] = data[o + 1]!;
      src[i + 2] = data[o + 2]!;
    }
  // Box blur with a summed-area table: cheap for any radius.
  const sat = new Float64Array((w + 1) * (h + 1) * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 3; c++) {
        const k = ((y + 1) * (w + 1) + x + 1) * 3 + c;
        sat[k] = src[(y * w + x) * 3 + c]! + sat[k - 3]! + sat[k - (w + 1) * 3]! - sat[k - (w + 2) * 3]!;
      }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      const xa = Math.max(0, x - r),
        xb = Math.min(w, x + r + 1),
        ya = Math.max(0, y - r),
        yb = Math.min(h, y + r + 1);
      const n = (xb - xa) * (yb - ya);
      const o = ((y0 + y) * width + x0 + x) * channels;
      for (let c = 0; c < 3; c++) {
        const s = sat[(yb * (w + 1) + xb) * 3 + c]! - sat[(ya * (w + 1) + xb) * 3 + c]! - sat[(yb * (w + 1) + xa) * 3 + c]! + sat[(ya * (w + 1) + xa) * 3 + c]!;
        data[o + c] = Math.round(s / n);
      }
    }
}

async function fixFile(path: string): Promise<number> {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const img = { data, width: info.width, height: info.height, channels: info.channels };
  const filled = bleedCells(img);
  if (!filled) return 0;
  const out = sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });
  if (path.endsWith('.webp')) await out.webp(WEBP).toFile(`${path}.tmp`);
  else await out.png().toFile(`${path}.tmp`);
  const { renameSync } = await import('node:fs');
  renameSync(`${path}.tmp`, path);
  return filled;
}

const args = process.argv.slice(2);
const skins = args.includes('--all')
  ? readdirSync(MODELS)
      .filter((f) => f.endsWith('_skin.webp'))
      .map((f) => f.replace('.webp', ''))
  : args;
for (const skin of skins) {
  const files = [join(MODELS, `${skin}.webp`), join(ROOT, 'art', 'source', 'models', `${skin}_preview.png`)].filter(existsSync);
  const counts = [];
  for (const f of files) counts.push(await fixFile(f));
  console.log(`${skin}: ${counts.join(' / ')} px filled`);
}
