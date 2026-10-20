import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gameData } from '../src/data';
import { parseTerrain, TerrainFlag } from '../src/map/terrain';
import { buildMatchNav } from '../src/nav/match-nav';
import { blockRect, findPath, type NavGrid } from '../src/nav/nav-grid';
import { baseCorridors, canPlace, findBuildSpot, type Corridor, type PlacementQuery, type Rect } from '../src/sim/faction/placement';

const terrain = parseTerrain(readFileSync(join(import.meta.dirname, '..', 'data', 'map-terrain.bin')));
const baseNav = buildMatchNav(terrain, gameData.map);
const mapCenter: [number, number] = [128, 128];
const order = [
  'house',
  'barracks',
  'house',
  'archery_range',
  'forge',
  'house',
  'watchtower',
  'chapel',
  'workshop',
  'house',
  'house',
  'hawk_roost',
  'barracks',
] as const;

function copyNav(): NavGrid {
  return { cols: baseNav.cols, rows: baseNav.rows, cellSize: baseNav.cellSize, walk: baseNav.walk.slice() };
}

function rectDistance(a: Rect, b: Rect): number {
  return Math.hypot(Math.max(0, Math.abs(a.x - b.x) - (a.w + b.w) * 0.5), Math.max(0, Math.abs(a.y - b.y) - (a.h + b.h) * 0.5));
}

function pointSegmentDistance(px: number, py: number, corridor: Corridor): number {
  const dx = corridor.bx - corridor.ax;
  const dy = corridor.by - corridor.ay;
  const t = Math.max(0, Math.min(1, ((px - corridor.ax) * dx + (py - corridor.ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - corridor.ax - t * dx, py - corridor.ay - t * dy);
}

function rectTouchesCorridor(rect: Rect, corridor: Corridor): boolean {
  const steps = 200;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = corridor.ax + (corridor.bx - corridor.ax) * t;
    const y = corridor.ay + (corridor.by - corridor.ay) * t;
    const dx = Math.max(0, Math.abs(x - rect.x) - rect.w * 0.5);
    const dy = Math.max(0, Math.abs(y - rect.y) - rect.h * 0.5);
    if (Math.hypot(dx, dy) <= corridor.width * 0.5) return true;
  }
  return false;
}

function edgePoint(from: [number, number], to: [number, number], w: number, h: number): [number, number] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  const ux = dx / length;
  const uy = dy / length;
  const edgeDistance = Math.min(Math.abs((w * 0.5) / ux), Math.abs((h * 0.5) / uy));
  return [from[0] + ux * (edgeDistance + 0.4), from[1] + uy * (edgeDistance + 0.4)];
}

function flaggedPoint(flag: number): [number, number] {
  for (let row = 2; row < terrain.rows - 2; row++) {
    for (let col = 2; col < terrain.cols - 2; col++) {
      if (((terrain.flags[row * terrain.cols + col] ?? 0) & flag) !== 0) {
        return [Math.floor((col + 0.5) * terrain.cellSize), Math.floor((row + 0.5) * terrain.cellSize)];
      }
    }
  }
  throw new Error(`No terrain cell with flag ${flag}`);
}

describe('faction building placement', () => {
  it('places the full build order at every start and keeps both routes open', () => {
    for (const start of gameData.map.starts) {
      const mine = gameData.map.goldMines
        .filter((candidate) => candidate.kind === 'main')
        .reduce((best, candidate) =>
          Math.hypot(candidate.pos[0] - start.townHall[0], candidate.pos[1] - start.townHall[1]) <
          Math.hypot(best.pos[0] - start.townHall[0], best.pos[1] - start.townHall[1])
            ? candidate
            : best,
        );
      const nav = copyNav();
      const corridors = baseCorridors(start.townHall, mine.pos, mapCenter, start.buildArea.radius);
      const existing: Rect[] = [
        { x: start.townHall[0], y: start.townHall[1], w: 5, h: 5 },
        { x: mine.pos[0], y: mine.pos[1], w: 3.4, h: 3.4 },
      ];
      let tower: Rect | undefined;

      for (const id of order) {
        const building = gameData.buildings.buildings.find((candidate) => candidate.id === id)!;
        const query: PlacementQuery = {
          footprint: building.footprint,
          center: start.buildArea.center,
          radius: start.buildArea.radius,
          townHall: start.townHall,
          existing,
          corridors,
          preferToward: id === 'watchtower' ? mapCenter : undefined,
        };
        const spot = findBuildSpot(terrain, nav, query);
        expect(spot, `${start.id} ${id}`).not.toBeNull();
        const placed: Rect = { x: spot!.x, y: spot!.y, w: building.footprint[0], h: building.footprint[1] };

        expect(placed.x % 1).toBe(placed.w % 2 === 0 ? 0 : 0.5);
        expect(placed.y % 1).toBe(placed.h % 2 === 0 ? 0 : 0.5);
        const farX = Math.abs(placed.x - start.buildArea.center[0]) + placed.w * 0.5;
        const farY = Math.abs(placed.y - start.buildArea.center[1]) + placed.h * 0.5;
        expect(Math.hypot(farX, farY)).toBeLessThanOrEqual(start.buildArea.radius);
        for (const other of existing) {
          const isTownHall = other.x === start.townHall[0] && other.y === start.townHall[1];
          expect(rectDistance(placed, other)).toBeGreaterThanOrEqual((isTownHall ? 1.5 : 1) - 1e-9);
        }
        for (const corridor of corridors) expect(rectTouchesCorridor(placed, corridor)).toBe(false);

        existing.push(placed);
        blockRect(nav, placed.x, placed.y, placed.w, placed.h);
        if (id === 'watchtower') tower = placed;
      }

      const centerDx = mapCenter[0] - start.townHall[0];
      const centerDy = mapCenter[1] - start.townHall[1];
      expect((tower!.x - start.townHall[0]) * centerDx + (tower!.y - start.townHall[1]) * centerDy).toBeGreaterThan(0);

      const mineEdge = edgePoint(mine.pos, start.townHall, 3.4, 3.4);
      const hallMineEdge = edgePoint(start.townHall, mine.pos, 5, 5);
      expect(findPath(nav, mineEdge[0], mineEdge[1], hallMineEdge[0], hallMineEdge[1])).not.toHaveLength(0);
      const centerLength = Math.hypot(centerDx, centerDy);
      const exit: [number, number] = [
        start.townHall[0] + (centerDx / centerLength) * 16,
        start.townHall[1] + (centerDy / centerLength) * 16,
      ];
      const hallExitEdge = edgePoint(start.townHall, exit, 5, 5);
      expect(findPath(nav, hallExitEdge[0], hallExitEdge[1], exit[0], exit[1])).not.toHaveLength(0);
    }
  });

  it('rejects the town hall, forest, water, and corridors', () => {
    const start = gameData.map.starts[0]!;
    const mine = gameData.map.goldMines.find((candidate) => candidate.id === 'north_main')!;
    const corridors = baseCorridors(start.townHall, mine.pos, mapCenter, start.buildArea.radius);
    const hallQuery: PlacementQuery = {
      footprint: [2, 2],
      center: start.buildArea.center,
      radius: start.buildArea.radius,
      townHall: start.townHall,
      existing: [{ x: start.townHall[0], y: start.townHall[1], w: 5, h: 5 }],
      corridors,
    };
    expect(canPlace(terrain, baseNav, hallQuery, Math.round(start.townHall[0]), Math.round(start.townHall[1]))).toBe(false);

    for (const flag of [TerrainFlag.Forest, TerrainFlag.Water]) {
      const point = flaggedPoint(flag);
      const query: PlacementQuery = { ...hallQuery, center: point, radius: 4, existing: [], corridors: [] };
      expect(canPlace(terrain, baseNav, query, point[0], point[1])).toBe(false);
    }

    const exitCorridor = corridors[1]!;
    const corridorX = Math.round((exitCorridor.ax + exitCorridor.bx) * 0.5);
    const corridorY = Math.round((exitCorridor.ay + exitCorridor.by) * 0.5);
    expect(canPlace(terrain, baseNav, hallQuery, corridorX, corridorY)).toBe(false);
    expect(pointSegmentDistance(corridorX, corridorY, exitCorridor)).toBeLessThan(exitCorridor.width * 0.5);
  });

  it('searches a full base in under five milliseconds per call', () => {
    const start = gameData.map.starts[0]!;
    const mine = gameData.map.goldMines.find((candidate) => candidate.id === 'north_main')!;
    const query: PlacementQuery = {
      footprint: [4, 4],
      center: start.buildArea.center,
      radius: start.buildArea.radius,
      townHall: start.townHall,
      existing: [
        { x: start.townHall[0], y: start.townHall[1], w: 5, h: 5 },
        { x: mine.pos[0], y: mine.pos[1], w: 3.4, h: 3.4 },
      ],
      corridors: baseCorridors(start.townHall, mine.pos, mapCenter, start.buildArea.radius),
    };
    findBuildSpot(terrain, baseNav, query);
    const calls = 20;
    const before = performance.now();
    for (let i = 0; i < calls; i++) findBuildSpot(terrain, baseNav, query);
    expect((performance.now() - before) / calls).toBeLessThan(5);
  });
});
