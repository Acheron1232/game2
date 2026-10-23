// Small wall wings with an open army lane. Never enclose a base or occupy resource corridors.
import { gameData } from '../../data';
import type { MatchSim, SimEntity } from '../match-sim';
import type { FactionState } from './faction';
import { baseCorridors, findBuildSpot, type Rect } from './placement';

export interface WallRules {
  startMinute: number;
  everySec: number;
  maxSegments: number;
  gap: number;
  frontDistance: number;
  rowStep: number;
  rows: number;
  minGold: number;
  minWood: number;
  upgradeReserveGold: number;
  upgradeReserveWood: number;
}
export const WALL_RULES = gameData.ai.faction['fortifications'] as WallRules;

export function wallCandidates(hx: number, hy: number, center: number, r: WallRules): { x: number; y: number }[] {
  const dx = center - hx,
    dy = center - hy,
    length = Math.hypot(dx, dy) || 1;
  const result: { x: number; y: number }[] = [];
  for (let row = 0; row < r.rows; row++) {
    const d = r.frontDistance + row * r.rowStep;
    const cx = Math.round(hx + (dx / length) * d),
      cy = Math.floor(hy + (dy / length) * d) + 0.5;
    for (const shift of [0, -4, 4, -8, 8])
      for (const side of [-1, 1])
        for (let i = 0; i < Math.ceil(r.maxSegments / 2); i++) result.push({ x: cx + shift + side * (r.gap / 2 + 1 + i * 2), y: cy });
  }
  return result;
}

/** Returns the action for the AI status, or null. Uses normal workers, prices and upgrade timers. */
export function tryFortify(
  sim: MatchSim,
  f: FactionState,
  home: SimEntity,
  builder: (x: number, y: number) => SimEntity | null,
): string | null {
  const fs = sim.factions,
    r = WALL_RULES;
  if (!fs || f.defeated || f.tier < 2 || sim.tick < r.startMinute * 60 * 20) return null;
  const walls = [...f.buildings]
    .map((id) => sim.get(id))
    .filter((e): e is SimEntity => !!e?.alive && !!e.building?.def?.id.endsWith('_wall'));
  const desired = f.tier >= 3 ? 'reinforced_wall' : 'stone_wall';
  for (const wall of walls) {
    const def = wall.building!.def!,
      next = gameData.buildings.buildings.find((d) => d.id === def.upgradesTo);
    if (def.id === desired || !next || f.gold - next.cost.gold < r.upgradeReserveGold || f.wood - next.cost.wood < r.upgradeReserveWood)
      continue;
    if (fs.upgradeTier(f, wall)) return 'Upgrading walls';
  }
  if (walls.length >= r.maxSegments || f.gold < r.minGold || f.wood < r.minWood) return null;
  if (
    [...f.buildings].some((id) => {
      const e = sim.get(id);
      return e?.alive && e.building && !e.building.done;
    })
  )
    return null;
  const def = gameData.buildings.buildings.find((d) => d.id === 'timber_wall')!;
  const hx = home.mover.x,
    hy = home.mover.y,
    center = sim.size / 2;
  const mine = fs.nearestMine(hx, hy);
  const corridors = baseCorridors([hx, hy], mine ? [mine.mover.x, mine.mover.y] : [hx, hy], [center, center], sim.size);
  const existing: Rect[] = sim.entities
    .filter((e) => e.alive && e.building)
    .map((e) => ({ x: e.mover.x, y: e.mover.y, w: e.building!.w, h: e.building!.h }));
  const spawn = gameData.map.starts[f.start]!.heroSpawn;
  existing.push({ x: spawn[0], y: spawn[1], w: 2, h: 2 });
  for (const at of wallCandidates(hx, hy, center, r)) {
    const adjacent = walls.some((w) => Math.abs(w.mover.y - at.y) < 0.1 && Math.abs(Math.abs(w.mover.x - at.x) - 2) < 0.1);
    const spot = findBuildSpot(fs.terrain, sim.nav, {
      footprint: [2, 1],
      center: [at.x, at.y],
      radius: Math.hypot(def.footprint[0] / 2, def.footprint[1] / 2) + 0.01,
      townHall: [hx, hy],
      existing,
      corridors,
      spacing: 0,
      minFromTownHall: 4,
      clearance: adjacent ? 0 : 1.5,
    });
    if (!spot || !fs.spotFree(spot.x, spot.y, ...def.footprint)) continue;
    const worker = builder(spot.x, spot.y);
    if (!worker) return null;
    if (fs.startBuilding(f, 'timber_wall', spot.x, spot.y, worker)) return 'Building wall wings';
  }
  return null;
}
