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
const SIZE = 256;
const C = SIZE / 2;
// The sector below was first drawn for a 192 map; everything is scaled up by S (roads a bit less),
// so the map is bigger without changing its shape.
const S = SIZE / 192;
const ROAD_S = 1.15;

// North sector layout (relative to center).
const SECTOR = {
  start: { townHall: [-20, 81], heroSpawn: [-16, 72], buildArea: { center: [-18, 75], radius: 15 } },
  mines: [
    { kind: 'main', pos: [-28, 87], gold: 20000 },
    { kind: 'natural', pos: [40, 86], gold: 14000, townHallSpot: [37, 78] },
    // The rich third mine sits off the natural-to-corner road, guarded by ogres as before; the
    // corner itself belongs to the mega camp (its own prize, not a gate to the economy).
    { kind: 'corner', pos: [62, 88], gold: 16000, townHallSpot: [63, 82] },
  ],
  openAreas: [
    { tag: 'base', center: [-18, 76], radius: 15, ground: 'grass' },
    { tag: 'natural', center: [38, 79], radius: 11, ground: 'grass' },
    { tag: 'corner', center: [63, 84], radius: 10, ground: 'grass' },
    { tag: 'shop', center: [-40, 62], radius: 6, ground: 'dirt' },
    // Camp clearings are not listed here: each camp gets its own shaped pocket (campLobes below).
    // Battle field: the open meadow between the base and the temple ring, where armies meet.
    { tag: 'field', center: [3, 58], radius: 9, ground: 'grass' },
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
    // Short forest paths to the camps in the forest pockets.
    {
      tag: 'trail',
      width: 4,
      points: [
        [-38, 43],
        [-45, 42],
        [-50, 41],
      ],
    },
    // Shop road → Green Wolves → Spider Nest. The old lake shore used to link the wolves to the shop.
    {
      tag: 'trail',
      width: 4,
      points: [
        [-35, 67],
        [-41, 73],
        [-47, 79],
        [-54, 81],
        [-59, 82],
      ],
    },
  ],
  // No lakes (the old ones became the glades); only the temple pools hold water.
  water: [],
  // Soft hills (walkable). level is in terrain levels (1 = temple top). Roads and open areas cut
  // through them; forests on top of hills look like real wooded hills.
  hills: [
    { tag: 'base_rise', center: [-18, 78], radius: 17, level: 0.35 },
    { tag: 'watch_hill', center: [-27, 52], radius: 8, level: 0.55 },
    { tag: 'forest_hill', center: [-60, 88], radius: 14, level: 0.85 },
    { tag: 'forest_hill', center: [20, 92], radius: 10, level: 0.7 },
    { tag: 'ridge', center: [62, 95], radius: 11, level: 0.75 },
    { tag: 'ridge', center: [64, 62], radius: 13, level: 0.8 },
    { tag: 'forest_hill', center: [-6, 110], radius: 12, level: 0.9 },
    { tag: 'hollow', center: [-59, 62], radius: 20, level: -0.25 },
  ],
  ramps: [{ tag: 'temple_ramp', from: [0, 45], to: [0, 34], width: 10 }],
  camps: [
    { type: 'green_wolves', pos: [-46, 78] },
    // Off the field's north edge, in a roadside pocket (it stood in the middle of the meadow).
    { type: 'green_bandits', pos: [13, 69] },
    { type: 'orange_harpies', pos: [-26, 52] },
    { type: 'orange_trolls', pos: [38, 78], guards: 'natural' },
    { type: 'red_ogres', pos: [63, 82], guards: 'corner' },
    // Mega camps in the corners, two kinds on the two diagonals (NE + SW: the horde, a crowd of
    // strong and weak monsters; SE + NW: the boss, an Elder Colossus with two drakes). Each corner
    // lies between two neighbor bases, so every base has one of each kind next door.
    {
      type: 'mega',
      pos: [85, 85],
      bySector: { north: 'horde_warband', south: 'horde_warband', east: 'boss_colossus', west: 'boss_colossus' },
    },
    { type: 'red_sentinels', pos: [11, 25] },
    { type: 'green_spiders', pos: [23, 67] },
    { type: 'orange_wolf_pack', pos: [-51, 41] },
    { type: 'orange_spider_nest', pos: [-62, 82] },
    { type: 'red_spider_brood', pos: [-60, 64] },
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
  // Two taverns (mercenaries for any hero), each next to a road junction halfway between two
  // neighbor bases, mirrored through the center: every base has one at about the same distance.
  taverns: [
    { type: 'tavern_mossy', pos: [29, 49.5] },
    { type: 'tavern_ember', pos: [-29, -49.5] },
  ],
  // Two Relic Halls (advanced items) at the other two junctions: every base has a tavern and a
  // Relic Hall at about the same distance.
  relicHalls: [
    { type: 'relic_hall', pos: [49.5, -29] },
    { type: 'relic_hall', pos: [-49.5, 29] },
  ],
  pools: [
    [22, 22],
    [22, -22],
    [-22, -22],
    [-22, 22],
  ].map((p) => ({ tag: 'temple_pool', center: p, radii: [4, 4], rotationDeg: 0 })),
};

const SECTORS = ['north', 'east', 'south', 'west'];

/**
 * Camp clearings shaped to the encounter instead of round lawns (2026-11-01, user: "the camps
 * are too big and all round"). Main radius by tier (sector units, x S in the game): about 12
 * units across for a green camp, 15 orange, 18 red, 26 for a corner mega camp, a bit longer
 * toward the road it opens on. Lobes: the fighting floor, an entrance toward the nearest road, a
 * back pocket for the den props and a side bulge, so no two camps have the same outline.
 */
const CAMP_R = { green: 3.6, orange: 4.4, red: 5.6, mega: 8.5 };

function nearestRoadPoint([x, y]) {
  let best = null,
    bestD = Infinity;
  for (const rd of SECTOR.roads)
    for (let i = 0; i + 1 < rd.points.length; i++) {
      const [ax, ay] = rd.points[i],
        [bx, by] = rd.points[i + 1];
      const vx = bx - ax,
        vy = by - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1)));
      const px = ax + vx * t,
        py = ay + vy * t;
      const d = Math.hypot(px - x, py - y);
      if (d < bestD) [best, bestD] = [[px, py], d];
    }
  return bestD < 30 ? best : null;
}

function campLobes(pos, tier, seed) {
  const r = CAMP_R[tier];
  // Opens toward the nearest road; with none near, toward the map center.
  let road = nearestRoadPoint(pos) ?? [0, 0];
  // A road right through the camp gives no direction: open toward the map center then.
  if (Math.hypot(road[0] - pos[0], road[1] - pos[1]) < 1) road = [0, 0];
  let dx = road[0] - pos[0],
    dy = road[1] - pos[1];
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  const side = seed % 2 ? 1 : -1;
  const sx = -dy * side,
    sy = dx * side;
  const at = (f, g) => [pos[0] + dx * r * f + sx * r * g, pos[1] + dy * r * f + sy * r * g];
  return {
    entrance: at(1.3, 0),
    lobes: [
      [...pos, r],
      [...at(0.8, 0.15), r * 0.68],
      [...at(-0.55, 0.38), r * 0.6],
      [...at(-0.05, -0.62), r * 0.48],
    ],
  };
}

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
  x *= S;
  y *= S;
  for (let i = 0; i < k; i++) [x, y] = [y, -x];
  return [round(x + C), round(y + C)];
}
const rel = ([x, y]) => [round(x * S + C), round(y * S + C)];
const r = (v) => round(v * S);
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
  symmetry: `4-fold rotation around the center (${C}, ${C}); the corner mega camps alternate (2-fold)`,
  border: { width: 8, fill: 'mountains' },
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
  ringRoad: {
    ...CENTER.ringRoad,
    center: rel(CENTER.ringRoad.center),
    radius: r(CENTER.ringRoad.radius),
    width: round(CENTER.ringRoad.width * ROAD_S),
  },
  hills: [],
  ramps: [],
  camps: [],
  shops: [
    ...CENTER.shops.map((s, i) => ({ id: `${s.type}_${i + 1}`, type: s.type, pos: rel(s.pos) })),
    ...CENTER.taverns.map((s) => ({ id: s.type, type: s.type, pos: rel(s.pos) })),
    ...CENTER.relicHalls.map((s, i) => ({ id: `${s.type}_${i + 1}`, type: s.type, pos: rel(s.pos) })),
  ],
  fountains: [],
};

SECTORS.forEach((sector, k) => {
  const p = (pt) => place(pt, k);
  layout.starts.push({
    id: sector,
    townHall: p(SECTOR.start.townHall),
    heroSpawn: p(SECTOR.start.heroSpawn),
    buildArea: { center: p(SECTOR.start.buildArea.center), radius: r(SECTOR.start.buildArea.radius) },
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
  for (const a of SECTOR.openAreas) layout.openAreas.push({ ...a, sector, center: p(a.center), radius: r(a.radius) });
  // Shaped camp pockets. Temple camps stand on the paved temple, which is open anyway.
  SECTOR.camps.forEach((c, i) => {
    if (Math.max(Math.abs(c.pos[0]), Math.abs(c.pos[1])) < 36) return;
    const tier = c.type === 'mega' ? 'mega' : c.type.split('_')[0];
    const { lobes, entrance } = campLobes(c.pos, tier, i);
    // A pocket far from any road gets a short forest trail out to it, so it is never cut off.
    const road = nearestRoadPoint(c.pos);
    if (road && Math.hypot(road[0] - c.pos[0], road[1] - c.pos[1]) > CAMP_R[tier] * 1.3)
      layout.roads.push({ tag: 'trail', sector, width: round(4 * ROAD_S), ground: 'rough_dirt', points: [p(c.pos), p(entrance), p(road)] });
    layout.openAreas.push({
      tag: 'camp',
      sector,
      center: p(c.pos),
      radius: r(CAMP_R[tier]),
      ground: tier === 'green' ? 'grass' : 'rough_dirt',
      rough: 1.2,
      lobes: lobes.map(([x, y, rr]) => [...p([x, y]), r(rr)]),
    });
  });
  for (const h of SECTOR.hills) layout.hills.push({ ...h, sector, center: p(h.center), radius: r(h.radius) });
  for (const rd of SECTOR.roads)
    layout.roads.push({
      ...rd,
      sector,
      width: round(rd.width * ROAD_S),
      ground: rd.tag === 'trail' ? 'rough_dirt' : 'dirt',
      points: rd.points.map(p),
    });
  for (const w of SECTOR.water)
    layout.water.push({ ...w, sector, center: p(w.center), radii: w.radii.map(r), rotationDeg: (w.rotationDeg - 90 * k + 360) % 360 });
  for (const rp of SECTOR.ramps)
    layout.ramps.push({ ...rp, sector, from: p(rp.from), to: p(rp.to), width: r(rp.width), toLevel: 1, fromLevel: 0 });
  SECTOR.camps.forEach((c) => {
    const type = c.bySector?.[sector] ?? c.type;
    const tier = c.type === 'mega' ? 'mega' : c.type.split('_')[0];
    layout.camps.push({
      id: `${sector}_${type}`,
      type,
      sector,
      pos: p(c.pos),
      // Where the camp opens toward the road (the den props go on the other side).
      entrance: p(campLobes(c.pos, tier, SECTOR.camps.indexOf(c)).entrance),
      ...(c.guards && { guardsMine: `${sector}_${c.guards}` }),
    });
  });
  for (const s of SECTOR.shops) layout.shops.push({ id: `${sector}_${s.type}`, type: s.type, sector, pos: p(s.pos) });
  for (const f of SECTOR.fountains)
    layout.fountains.push({ id: `${sector}_${f.type}`, type: f.type, sector, pos: p(f.pos), radius: f.radius });
});
for (const pool of CENTER.pools) layout.water.push({ ...pool, center: rel(pool.center), radii: pool.radii.map(r) });

mkdirSync(join(ROOT, 'shared', 'data'), { recursive: true });
writeFileSync(join(ROOT, 'shared', 'data', 'map-layout.json'), pretty(layout));

console.log(
  `map-layout.json: ${layout.starts.length} starts, ${layout.goldMines.length} mines, ${layout.camps.length} camps, ${layout.shops.length} shops, ${layout.fountains.length} fountains`,
);
