// Bakes shared/data/map-layout.json into the real map:
//   shared/data/map-terrain.bin   terrain grid (ground type, flags, height) — format below
//   shared/data/map-trees.json    every tree: [x, y, type, scale]
//   docs/design/map-preview.png   top-down picture of the baked map
//
// The layout uses simple shapes (circles, lines). Here we bend their edges with noise
// so lakes, roads and forest edges look natural. The noise is the average of the same
// noise turned 4 times around the map center, so the map stays exactly 4-way symmetric.
//
// Run: node tools/map/bake-terrain.mjs
//
// map-terrain.bin (little endian):
//   char[4] "ETRN", u16 version, u16 cols, u16 rows, f32 cellSize,
//   u8 ground[cols*rows], u8 flags[cols*rows], u8 height[cols*rows]
//   Row 0 is the south edge (y = 0), column 0 is the west edge (x = 0).
//   height byte: level = byte / 100 - 1   (so 0 = -1 water bed, 100 = ground, 200 = temple top)

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const layout = JSON.parse(readFileSync(join(ROOT, 'shared', 'data', 'map-layout.json'), 'utf8'));

const SIZE = layout.size.width;
const C = SIZE / 2;
const CELL = 0.5;
const N = SIZE / CELL;

export const GROUND = [
  'grass',
  'grass_lush',
  'grass_dry',
  'dirt',
  'rough_dirt',
  'temple_stone',
  'sand',
  'cliff',
  'water_bed',
  'forest_floor',
];
const G = Object.fromEntries(GROUND.map((g, i) => [g, i]));
export const FLAG = { passable: 1, buildable: 2, forest: 4, border: 8, cliff: 16, water: 32, ramp: 64, high: 128 };
export const TREE_TYPES = ['pine', 'oak', 'dead', 'bush'];

// ---------- symmetric noise ----------
function hash(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function valueNoise(x, y, seed) {
  const ix = Math.floor(x),
    iy = Math.floor(y);
  const fx = x - ix,
    fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx),
    sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed),
    b = hash(ix + 1, iy, seed),
    c = hash(ix, iy + 1, seed),
    d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function fbm(x, y, seed) {
  return valueNoise(x, y, seed) * 0.57 + valueNoise(x * 2.03, y * 2.03, seed + 1) * 0.29 + valueNoise(x * 4.1, y * 4.1, seed + 2) * 0.14;
}
// Noise in [-1, 1] that is the same after turning the map by 90 degrees.
function symNoise(px, py, scale, seed) {
  let x = px - C,
    y = py - C,
    sum = 0;
  for (let k = 0; k < 4; k++) {
    sum += fbm(x / scale + 100, y / scale + 100, seed);
    [x, y] = [y, -x];
  }
  return Math.max(-1, Math.min(1, (sum / 4 - 0.5) * 4));
}

// A bend vector that turns with the map: for the point turned by 90 degrees we get
// the same vector turned by 90 degrees. Plain x/y noise would break the symmetry.
function symWarp(px, py, scale, seed) {
  let x = px - C,
    y = py - C,
    wx = 0,
    wy = 0;
  for (let k = 0; k < 4; k++) {
    let vx = fbm(x / scale + 100, y / scale + 100, seed) - 0.5;
    let vy = fbm(x / scale + 100, y / scale + 100, seed + 7) - 0.5;
    // Turn the vector back by k * 90 degrees (counter clockwise).
    for (let j = 0; j < k; j++) [vx, vy] = [-vy, vx];
    wx += vx;
    wy += vy;
    [x, y] = [y, -x];
  }
  return [Math.max(-1, Math.min(1, wx)), Math.max(-1, Math.min(1, wy))];
}

// ---------- shapes ----------
function catmullRom(points, step = 0.75) {
  const out = [];
  const pts = [points[0], ...points, points[points.length - 1]];
  for (let i = 1; i < pts.length - 2; i++) {
    const [p0, p1, p2, p3] = [pts[i - 1], pts[i], pts[i + 1], pts[i + 2]];
    const steps = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let s = 0; s < steps; s++) {
      const t = s / steps,
        t2 = t * t,
        t3 = t2 * t;
      out.push(
        [0, 1].map(
          (j) =>
            0.5 *
            (2 * p1[j] +
              (-p0[j] + p2[j]) * t +
              (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 +
              (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3),
        ),
      );
    }
  }
  out.push(points[points.length - 1]);
  return out;
}
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax,
    dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}
function ellipseSdf(px, py, w) {
  const a = (w.rotationDeg * Math.PI) / 180;
  const dx = px - w.center[0],
    dy = py - w.center[1];
  const lx = dx * Math.cos(a) + dy * Math.sin(a),
    ly = -dx * Math.sin(a) + dy * Math.cos(a);
  const v = Math.hypot(lx / w.radii[0], ly / w.radii[1]);
  return (v - 1) * Math.min(w.radii[0], w.radii[1]);
}
// Convex polygon: largest distance outside any edge (negative inside).
function convexSdf(px, py, poly) {
  let d = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i],
      [bx, by] = poly[(i + 1) % poly.length];
    const ex = bx - ax,
      ey = by - ay,
      len = Math.hypot(ex, ey);
    // Polygon is clockwise in map space (y up), so the outward normal is (-ey, ex).
    d = Math.max(d, ((py - ay) * ex - (px - ax) * ey) / len);
  }
  return d;
}
function rectSdf(px, py, [x1, y1, x2, y2]) {
  return Math.max(x1 - px, px - x2, y1 - py, py - y2);
}

const roads = layout.roads.map((r) => {
  const pts = catmullRom(r.points);
  const xs = pts.map((p) => p[0]),
    ys = pts.map((p) => p[1]);
  const pad = r.width + 4;
  return { ...r, pts, box: [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad] };
});
const clearings = [
  ...layout.goldMines.map((m) => ({ center: m.pos, radius: 4.5 })),
  ...layout.shops.map((s) => ({ center: s.pos, radius: 5 })),
  ...layout.fountains.map((f) => ({ center: f.pos, radius: f.radius + 2 })),
  ...layout.starts.map((s) => ({ center: s.townHall, radius: 6 })),
];
const lakes = layout.water.filter((w) => w.tag !== 'temple_pool');
const pools = layout.water.filter((w) => w.tag === 'temple_pool');
const temple = layout.plateaus[0];

// ---------- bake the grid ----------
const ground = new Uint8Array(N * N);
const flags = new Uint8Array(N * N);
const height = new Uint8Array(N * N);
const level = new Float32Array(N * N); // for shading only

for (let row = 0; row < N; row++) {
  for (let col = 0; col < N; col++) {
    const i = row * N + col;
    const px = (col + 0.5) * CELL,
      py = (row + 0.5) * CELL;
    // Bent position: shapes are tested here so their edges wobble.
    const [wx, wy] = symWarp(px, py, 15, 11);
    const qx = px + 3.2 * wx,
      qy = py + 3.2 * wy;
    const edgeN = symNoise(px, py, 7, 21);
    const detail = symNoise(px, py, 4, 31);
    const patch = symNoise(px, py, 22, 41);

    let g,
      f = FLAG.passable | FLAG.buildable,
      h = 0;

    // Map border
    const edge = Math.min(px, py, SIZE - px, SIZE - py);
    if (edge < layout.border.width + 1.5 + 1.5 * edgeN) {
      ground[i] = G.forest_floor;
      flags[i] = FLAG.passable | FLAG.forest | FLAG.border;
      height[i] = 100;
      level[i] = 0;
      continue;
    }

    // Temple plateau (cliff edge only lightly bent)
    const [sx, sy] = symWarp(px, py, 5, 13);
    const tSdf = convexSdf(px + 0.9 * sx, py + 0.9 * sy, temple.polygon);
    let onRamp = -1;
    for (const r of layout.ramps) {
      const dx = r.to[0] - r.from[0],
        dy = r.to[1] - r.from[1],
        len = Math.hypot(dx, dy);
      const t = ((px - r.from[0]) * dx + (py - r.from[1]) * dy) / (len * len);
      const side = Math.abs(((px - r.from[0]) * dy - (py - r.from[1]) * dx) / len);
      if (t > -0.15 && t < 1.15 && side < r.width / 2 + 0.6 * edgeN) onRamp = Math.max(0, Math.min(1, t));
    }

    if (onRamp >= 0) {
      g = onRamp > 0.55 ? G.temple_stone : G.dirt;
      f = FLAG.passable | FLAG.ramp;
      h = onRamp;
    } else if (tSdf < 0) {
      h = 1;
      f = FLAG.passable | FLAG.high;
      let paved = Infinity;
      for (const pv of layout.paving) paved = Math.min(paved, rectSdf(px, py, pv.rect));
      let poolD = Infinity;
      for (const w of pools) poolD = Math.min(poolD, ellipseSdf(px, py, w));
      if (tSdf > -1.8) {
        g = G.cliff;
        f = FLAG.cliff | FLAG.high;
      } else if (poolD < 0) {
        g = G.water_bed;
        f = FLAG.water | FLAG.high;
        h = 0.7;
      } else if (poolD < 1) {
        g = G.temple_stone;
      } else if (paved + 1.2 * detail < 0) g = G.temple_stone;
      else g = patch > 0.3 ? G.grass_dry : G.grass;
    } else {
      // Lakes
      let wSdf = Infinity;
      for (const w of lakes) wSdf = Math.min(wSdf, ellipseSdf(qx, qy, w));
      if (wSdf < 0) {
        g = G.water_bed;
        f = FLAG.water;
        h = Math.max(-1, wSdf / 4);
      } else if (wSdf < 1.6 + 0.6 * edgeN) {
        g = G.sand;
        f = FLAG.passable;
      } else {
        // Open ground: roads, ring, open areas, clearings, around the temple
        let roadD = Infinity,
          trail = false;
        for (const r of roads) {
          if (qx < r.box[0] || qy < r.box[1] || qx > r.box[2] || qy > r.box[3]) continue;
          let d = Infinity;
          for (let s = 0; s < r.pts.length - 1; s++)
            d = Math.min(d, segDist(qx, qy, r.pts[s][0], r.pts[s][1], r.pts[s + 1][0], r.pts[s + 1][1]));
          d -= (r.width / 2) * (1 + 0.3 * edgeN);
          if (d < roadD) {
            roadD = d;
            trail = r.tag === 'trail';
          }
        }
        const rr = layout.ringRoad;
        const ringD = Math.abs(Math.hypot(qx - rr.center[0], qy - rr.center[1]) - rr.radius) - (rr.width / 2) * (1 + 0.35 * edgeN);
        let areaD = Infinity,
          area = null;
        for (const a of layout.openAreas) {
          const d = Math.hypot(qx - a.center[0], qy - a.center[1]) - a.radius;
          if (d < areaD) {
            areaD = d;
            area = a;
          }
        }
        let clearD = Infinity;
        for (const c of clearings) clearD = Math.min(clearD, Math.hypot(px - c.center[0], py - c.center[1]) - c.radius);
        const nearTemple = tSdf - 4 - 1.5 * edgeN;
        const pathD = Math.min(roadD, ringD);
        const openD = Math.min(pathD, areaD, clearD, nearTemple);
        const margin = 0.5 + 1.0 * (edgeN + 1);

        if (openD > margin) {
          g = G.forest_floor;
          f = FLAG.passable | FLAG.forest;
        } else if (pathD < 0) {
          g = trail || detail > 0.55 ? G.rough_dirt : G.dirt;
        } else if (areaD < 0 && area.ground !== 'grass') {
          g = areaD > -1.5 && detail > 0 ? G.rough_dirt : G[area.ground];
        } else {
          g = patch > 0.35 ? G.grass_dry : patch < -0.45 || wSdf < 6 ? G.grass_lush : G.grass;
          if (pathD < 1.2 && detail > 0.2) g = G.rough_dirt; // soft road edge
        }
      }
    }
    ground[i] = g;
    flags[i] = f;
    height[i] = Math.round((h + 1) * 100);
    level[i] = h;
  }
}

// Nothing can be built on ramps, cliffs, water, sand, forest, the temple or right next to mines.
for (let i = 0; i < N * N; i++) {
  const g = ground[i],
    f = flags[i];
  if (!(f & FLAG.passable) || f & (FLAG.forest | FLAG.ramp | FLAG.high) || g === G.sand) flags[i] &= ~FLAG.buildable;
}

// ---------- trees ----------
// Jittered grid in the north-east quarter, then turned 4 times (keeps symmetry).
const trees = [];
const SPACING = 2.1;
const cellAt = (x, y) => {
  const c = Math.floor(x / CELL),
    r = Math.floor(y / CELL);
  return c < 0 || r < 0 || c >= N || r >= N ? -1 : r * N + c;
};
for (let gy = 0; gy * SPACING < C; gy++) {
  for (let gx = 0; gx * SPACING < C; gx++) {
    const jx = (hash(gx, gy, 71) - 0.5) * SPACING * 0.8,
      jy = (hash(gx, gy, 72) - 0.5) * SPACING * 0.8;
    const rx = (gx + 0.5) * SPACING + jx,
      ry = (gy + 0.5) * SPACING + jy;
    if (rx >= C || ry >= C) continue;
    const roll = hash(gx, gy, 73);
    let [x, y] = [rx, ry];
    for (let k = 0; k < 4; k++) {
      // Round first, so the saved position is the one we test.
      const mx = Math.round((x + C) * 10) / 10,
        my = Math.round((y + C) * 10) / 10;
      const i = cellAt(mx, my);
      if (i >= 0 && flags[i] & FLAG.forest) {
        const fromCenter = Math.hypot(x, y);
        // Bushes at forest edges, dead trees near the temple, pines and oaks in big patches.
        const edgeCell = [
          [2, 0],
          [-2, 0],
          [0, 2],
          [0, -2],
        ].some(([dx, dy]) => {
          const j = cellAt(mx + dx, my + dy);
          return j >= 0 && !(flags[j] & FLAG.forest);
        });
        let type = symNoise(rx + C, ry + C, 26, 81) > 0 ? 0 : 1;
        if (fromCenter < 62 && roll < 0.35) type = 2;
        if (edgeCell && roll > 0.7) type = 3;
        trees.push([mx, my, type, Math.round((0.85 + 0.3 * hash(gx, gy, 74)) * 100) / 100]);
      }
      [x, y] = [y, -x];
    }
  }
}

// ---------- write data ----------
const header = Buffer.alloc(14);
header.write('ETRN', 0, 'ascii');
header.writeUInt16LE(1, 4);
header.writeUInt16LE(N, 6);
header.writeUInt16LE(N, 8);
header.writeFloatLE(CELL, 10);
writeFileSync(join(ROOT, 'shared', 'data', 'map-terrain.bin'), Buffer.concat([header, ground, flags, height]));
writeFileSync(
  join(ROOT, 'shared', 'data', 'map-trees.json'),
  `{\n  "version": 1,\n  "note": "Generated by tools/map/bake-terrain.mjs. Each tree is [x, y, type index, scale].",\n  "types": ${JSON.stringify(TREE_TYPES)},\n  "trees": [\n${trees.map((t) => '    ' + JSON.stringify(t)).join(',\n')}\n  ]\n}\n`,
);

// ---------- preview picture ----------
const PX = 4; // pixels per game unit
const W = SIZE * PX;
const img = new Float32Array(W * W * 3);
const COLORS = {
  grass: [88, 140, 52],
  grass_lush: [66, 124, 46],
  grass_dry: [128, 146, 62],
  dirt: [150, 106, 62],
  rough_dirt: [128, 96, 62],
  temple_stone: [150, 146, 128],
  sand: [196, 176, 120],
  cliff: [104, 100, 92],
  water_bed: [34, 78, 128],
  forest_floor: [30, 66, 32],
};
const heightAt = (x, y) => {
  const i = cellAt(x, y);
  return i < 0 ? 0 : level[i];
};
for (let py = 0; py < W; py++) {
  for (let px = 0; px < W; px++) {
    const x = (px + 0.5) / PX,
      y = SIZE - (py + 0.5) / PX;
    const i = cellAt(x, y);
    const g = GROUND[ground[i]];
    let [r, gg, b] = COLORS[g];
    // Small color noise so flat areas do not look plastic.
    const n = 1 + 0.07 * symNoise(x, y, 1.6, 91) + 0.05 * symNoise(x, y, 6, 92);
    // Light from the north-west, from the height slope.
    const slope = (heightAt(x - 0.6, y + 0.6) - heightAt(x + 0.6, y - 0.6)) * 2.2;
    let shade = n * (1 + Math.max(-0.45, Math.min(0.45, slope)));
    if (g === 'water_bed') {
      const depth = Math.min(1, -level[i]);
      [r, gg, b] = [58 - 26 * depth, 120 - 44 * depth, 168 - 36 * depth];
      shade = 1 + 0.04 * symNoise(x, y, 2.5, 93);
    }
    if (g === 'cliff') shade *= 0.9 + 0.2 * symNoise(x, y, 0.9, 94);
    const o = (py * W + px) * 3;
    img[o] = r * shade;
    img[o + 1] = gg * shade;
    img[o + 2] = b * shade;
  }
}
function blendCircle(cx, cy, rad, col, alpha) {
  for (let y = Math.floor(cy - rad - 1); y <= cy + rad + 1; y++) {
    for (let x = Math.floor(cx - rad - 1); x <= cx + rad + 1; x++) {
      if (x < 0 || y < 0 || x >= W || y >= W) continue;
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const a = alpha * Math.max(0, Math.min(1, rad - d + 0.5));
      if (a <= 0) continue;
      const o = (y * W + x) * 3;
      for (let k = 0; k < 3; k++) img[o + k] = img[o + k] * (1 - a) + col[k] * a;
    }
  }
}
function blendRect(x1, y1, x2, y2, col, alpha = 1) {
  for (let y = Math.round(y1); y < Math.round(y2); y++)
    for (let x = Math.round(x1); x < Math.round(x2); x++) {
      if (x < 0 || y < 0 || x >= W || y >= W) continue;
      const o = (y * W + x) * 3;
      for (let k = 0; k < 3; k++) img[o + k] = img[o + k] * (1 - alpha) + col[k] * alpha;
    }
}
const toPx = ([x, y]) => [x * PX, (SIZE - y) * PX];
const TREE_COL = [
  [24, 70, 40],
  [44, 98, 34],
  [92, 80, 58],
  [62, 112, 44],
];
for (const [x, y, t, s] of trees) {
  const [cx, cy] = toPx([x, y]);
  const rad = (t === 3 ? 0.8 : 1.15) * s * PX;
  blendCircle(cx + 1.6, cy + 1.6, rad, [10, 24, 12], 0.45); // shadow
}
for (const [x, y, t, s] of trees) {
  const [cx, cy] = toPx([x, y]);
  const rad = (t === 3 ? 0.8 : 1.15) * s * PX;
  const col = TREE_COL[t];
  blendCircle(
    cx,
    cy,
    rad,
    col.map((v) => v * 0.7),
    1,
  );
  blendCircle(cx - rad * 0.25, cy - rad * 0.25, rad * 0.62, col, 1);
  blendCircle(
    cx - rad * 0.4,
    cy - rad * 0.4,
    rad * 0.25,
    col.map((v) => Math.min(255, v * 1.35)),
    0.8,
  );
}
// Markers
const TEAM = { north: [31, 181, 168], east: [123, 47, 191], south: [212, 42, 42], west: [42, 91, 212] };
for (const m of layout.goldMines) {
  const [cx, cy] = toPx(m.pos);
  blendCircle(cx, cy, 11, [20, 16, 6], 1);
  blendCircle(cx, cy, 8.5, [242, 198, 21], 1);
  blendCircle(cx - 2.5, cy - 2.5, 3, [255, 240, 150], 0.9);
}
for (const s of layout.starts) {
  const [cx, cy] = toPx(s.townHall);
  blendRect(cx - 13, cy - 13, cx + 13, cy + 13, [15, 12, 8]);
  blendRect(cx - 10, cy - 10, cx + 10, cy + 10, TEAM[s.id]);
  blendRect(cx - 4, cy - 4, cx + 4, cy + 4, [255, 255, 255], 0.5);
}
for (const s of layout.shops) {
  const [cx, cy] = toPx(s.pos);
  blendRect(cx - 9, cy - 4, cx + 9, cy + 10, [15, 12, 8]);
  blendRect(cx - 7, cy - 2, cx + 7, cy + 8, [255, 214, 40]);
  for (let k = 0; k < 9; k++) blendRect(cx - k - 2, cy - 12 + k, cx + k + 2, cy - 11 + k, k > 6 ? [15, 12, 8] : [255, 214, 40]);
}
for (const f of layout.fountains) {
  const [cx, cy] = toPx(f.pos);
  blendCircle(cx, cy, 9, [230, 240, 245], 1);
  blendCircle(cx, cy, 6.5, [90, 210, 230], 1);
}
const CAMP = { green: [110, 230, 90], orange: [255, 150, 40], red: [235, 50, 45] };
for (const c of layout.camps) {
  const [cx, cy] = toPx(c.pos);
  blendCircle(cx, cy, 7, [15, 12, 8], 0.9);
  blendCircle(cx, cy, 5, CAMP[c.type.split('_')[0]], 1);
}

// Write PNG
const raw = Buffer.alloc((W * 3 + 1) * W);
for (let y = 0; y < W; y++) {
  raw[y * (W * 3 + 1)] = 0;
  for (let x = 0; x < W * 3; x++) raw[y * (W * 3 + 1) + 1 + x] = Math.max(0, Math.min(255, Math.round(img[y * W * 3 + x])));
}
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(W, 4);
ihdr[8] = 8;
ihdr[9] = 2;
writeFileSync(
  join(ROOT, 'docs', 'design', 'map-preview.png'),
  Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]),
);

const count = (pred) => {
  let n = 0;
  for (let i = 0; i < N * N; i++) if (pred(i)) n++;
  return n;
};
const pct = (n) => `${Math.round((n / (N * N)) * 100)}%`;
console.log(
  `map-terrain.bin: ${N}x${N} cells. forest ${pct(count((i) => flags[i] & FLAG.forest))}, open ground ${pct(count((i) => flags[i] & FLAG.passable && !(flags[i] & FLAG.forest)))}, water ${pct(count((i) => flags[i] & FLAG.water))}`,
);
console.log(`map-trees.json: ${trees.length} trees. map-preview.png: ${W}x${W}`);
