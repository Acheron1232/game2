// Builds shared/data/map-layout.json (the points and shapes of the map).
// tools/map/bake-terrain.mjs then turns this into the real terrain grid, trees and a preview picture.
//
// We describe only the NORTH sector. The other three sectors are the same
// layout turned by 90, 180 and 270 degrees around the center, so every team
// gets exactly the same map. Positions here are relative to the map center,
// in game units (1 unit ~ 1 meter), x = east, y = north.
//
// Run: node tools/map/make-map-layout.mjs && node tools/map/bake-terrain.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SIZE = 192;
const C = SIZE / 2;

// North sector layout (relative to center).
const SECTOR = {
  start: { townHall: [-20, 81], heroSpawn: [-16, 72], buildArea: { center: [-18, 75], radius: 15 } },
  mines: [
    { kind: 'main', pos: [-28, 87], gold: 15000 },
    { kind: 'natural', pos: [40, 86], gold: 10000, townHallSpot: [37, 78] },
    { kind: 'corner', pos: [89, 89], gold: 12000, townHallSpot: [82, 82] },
  ],
  openAreas: [
    { tag: 'base', center: [-18, 76], radius: 15, ground: 'grass' },
    { tag: 'natural', center: [38, 79], radius: 11, ground: 'grass' },
    { tag: 'corner', center: [81, 81], radius: 10, ground: 'grass' },
    { tag: 'shop', center: [-40, 62], radius: 6, ground: 'dirt' },
    { tag: 'camp', center: [-46, 78], radius: 5, ground: 'grass' },
    { tag: 'camp', center: [10, 64], radius: 5, ground: 'grass' },
    { tag: 'camp', center: [-26, 52], radius: 6, ground: 'rough_dirt' },
    // Wide dirt spots where roads meet the ring, like the open junctions on classic maps.
    { tag: 'junction', center: [-5, 49], radius: 7, ground: 'dirt' },
    { tag: 'junction', center: [27, 46], radius: 6, ground: 'dirt' },
    { tag: 'junction', center: [-37, 43], radius: 6, ground: 'dirt' },
    { tag: 'junction', center: [24, 79], radius: 5, ground: 'dirt' },
  ],
  roads: [
    {
      tag: 'base_to_ring',
      width: 7,
      points: [
        [-18, 68],
        [-12, 56],
        [-4, 47],
      ],
    },
    {
      tag: 'base_to_natural',
      width: 7,
      points: [
        [-8, 78],
        [10, 81],
        [30, 80],
      ],
    },
    {
      tag: 'natural_to_corner',
      width: 6,
      points: [
        [46, 80],
        [62, 80],
        [76, 81],
      ],
    },
    {
      tag: 'natural_to_ring',
      width: 6,
      points: [
        [38, 70],
        [30, 55],
        [26, 44],
      ],
    },
    {
      tag: 'base_to_shop',
      width: 6,
      points: [
        [-28, 72],
        [-38, 64],
      ],
    },
    {
      tag: 'shop_to_ring',
      width: 6,
      points: [
        [-40, 56],
        [-36, 42],
      ],
    },
    {
      tag: 'trail',
      width: 4,
      points: [
        [-46, 58],
        [-62, 46],
        [-78, 40],
      ],
    },
  ],
  water: [{ tag: 'lake', center: [-59, 62], radii: [13, 11], rotationDeg: 43 }],
  ramps: [{ tag: 'temple_ramp', from: [0, 45], to: [0, 34], width: 10 }],
  camps: [
    { type: 'green_wolves', pos: [-46, 78] },
    { type: 'green_bandits', pos: [10, 64] },
    { type: 'orange_harpies', pos: [-26, 52] },
    { type: 'orange_trolls', pos: [38, 78], guards: 'natural' },
    { type: 'red_ogres', pos: [82, 82], guards: 'corner' },
    { type: 'red_sentinels', pos: [11, 25] },
  ],
  shops: [{ type: 'side_shop', pos: [-40, 62] }],
  fountains: [{ type: 'fountain_of_life', pos: [37, 37], radius: 4 }],
};

// Things that exist only once, in the center.
const CENTER = {
  temple: {
    // Octagon: a square of half size 36 with 14 cut off each corner.
    level: 1,
    polygon: octagon(36, 14),
    paving: [
      { tag: 'cross_ns', rect: [-10, -36, 10, 36] },
      { tag: 'cross_ew', rect: [-36, -10, 36, 10] },
      { tag: 'center', rect: [-17, -17, 17, 17] },
    ],
  },
  ringRoad: { center: [0, 0], radius: 48, width: 7, ground: 'dirt' },
  shops: [{ type: 'temple_market', pos: [0, 0] }],
  pools: [
    [22, 22],
    [22, -22],
    [-22, -22],
    [-22, 22],
  ].map((p) => ({ tag: 'temple_pool', center: p, radii: [4, 4], rotationDeg: 0 })),
};

const SECTORS = ['north', 'east', 'south', 'west'];

function octagon(h, cut) {
  return [
    [-h + cut, h],
    [h - cut, h],
    [h, h - cut],
    [h, -h + cut],
    [h - cut, -h],
    [-h + cut, -h],
    [-h, -h + cut],
    [-h, h - cut],
  ];
}

// Turn a relative point clockwise by k * 90 degrees, then move it to map space.
function place([x, y], k) {
  for (let i = 0; i < k; i++) [x, y] = [y, -x];
  return [round(x + C), round(y + C)];
}
const rel = ([x, y]) => [round(x + C), round(y + C)];
// JSON with short number lists kept on one line, easier to read.
const pretty = (obj) =>
  JSON.stringify(obj, null, 2).replace(/\[\s+([-\d.,\s]+?)\s+\]/g, (_, inner) => `[${inner.split(/,\s*/).join(', ')}]`) + '\n';
const round = (v) => Math.round(v * 10) / 10;

const layout = {
  id: 'elder_temple',
  name: 'Elder Temple',
  version: 1,
  note: 'Generated by tools/map/make-map-layout.mjs. Edit the script, not this file.',
  size: { width: SIZE, height: SIZE },
  coordinates: 'Game units (1 unit ~ 1 meter). Origin is the south-west corner. x goes east, y goes north.',
  symmetry: '4-fold rotation around the center (96, 96)',
  border: { width: 4, fill: 'dense_forest' },
  defaultTerrain: { ground: 'grass', fill: 'forest' },
  heightLevels: { water: -1, ground: 0, high: 1 },
  starts: [],
  goldMines: [],
  openAreas: [],
  roads: [],
  water: [],
  plateaus: [{ id: 'temple', level: CENTER.temple.level, polygon: CENTER.temple.polygon.map(rel) }],
  paving: CENTER.temple.paving.map((p) => ({
    tag: p.tag,
    ground: 'temple_stone',
    rect: [...rel([p.rect[0], p.rect[1]]), ...rel([p.rect[2], p.rect[3]])],
  })),
  ringRoad: { ...CENTER.ringRoad, center: rel(CENTER.ringRoad.center) },
  ramps: [],
  camps: [],
  shops: CENTER.shops.map((s, i) => ({ id: `${s.type}_${i + 1}`, type: s.type, pos: rel(s.pos) })),
  fountains: [],
};

SECTORS.forEach((sector, k) => {
  const p = (pt) => place(pt, k);
  layout.starts.push({
    id: sector,
    townHall: p(SECTOR.start.townHall),
    heroSpawn: p(SECTOR.start.heroSpawn),
    buildArea: { center: p(SECTOR.start.buildArea.center), radius: SECTOR.start.buildArea.radius },
  });
  for (const m of SECTOR.mines) {
    layout.goldMines.push({
      id: `${sector}_${m.kind}`,
      kind: m.kind,
      sector,
      pos: p(m.pos),
      gold: m.gold,
      ...(m.townHallSpot && { townHallSpot: p(m.townHallSpot) }),
    });
  }
  for (const a of SECTOR.openAreas) layout.openAreas.push({ ...a, sector, center: p(a.center) });
  for (const r of SECTOR.roads)
    layout.roads.push({ ...r, sector, ground: r.tag === 'trail' ? 'rough_dirt' : 'dirt', points: r.points.map(p) });
  for (const w of SECTOR.water) layout.water.push({ ...w, sector, center: p(w.center), rotationDeg: (w.rotationDeg - 90 * k + 360) % 360 });
  for (const r of SECTOR.ramps) layout.ramps.push({ ...r, sector, from: p(r.from), to: p(r.to), toLevel: 1, fromLevel: 0 });
  SECTOR.camps.forEach((c) =>
    layout.camps.push({
      id: `${sector}_${c.type}`,
      type: c.type,
      sector,
      pos: p(c.pos),
      ...(c.guards && { guardsMine: `${sector}_${c.guards}` }),
    }),
  );
  for (const s of SECTOR.shops) layout.shops.push({ id: `${sector}_${s.type}`, type: s.type, sector, pos: p(s.pos) });
  for (const f of SECTOR.fountains)
    layout.fountains.push({ id: `${sector}_${f.type}`, type: f.type, sector, pos: p(f.pos), radius: f.radius });
});
for (const pool of CENTER.pools) layout.water.push({ ...pool, center: rel(pool.center) });

mkdirSync(join(ROOT, 'shared', 'data'), { recursive: true });
writeFileSync(join(ROOT, 'shared', 'data', 'map-layout.json'), pretty(layout));

console.log(
  `map-layout.json: ${layout.starts.length} starts, ${layout.goldMines.length} mines, ${layout.camps.length} camps, ${layout.shops.length} shops, ${layout.fountains.length} fountains`,
);
