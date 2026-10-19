import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildNavGrid, createMover, findPath, gameData, isWalkable, lineWalkable, parseTerrain, stepMover } from '../src/index';

const terrain = parseTerrain(readFileSync(join(import.meta.dirname, '..', 'data', 'map-terrain.bin')));
const nav = buildNavGrid(terrain);

describe('nav grid and paths', () => {
  it('does not cross blocked corners or skip a briefly crossed obstacle', () => {
    const corner = { cols: 2, rows: 2, cellSize: 1, walk: new Uint8Array([1, 0, 0, 1]) };
    expect(lineWalkable(corner, 0.5, 0.5, 1.5, 1.5)).toBe(false);
    expect(findPath(corner, 0.5, 0.5, 1.5, 1.5)).toEqual([]);
    const edge = { cols: 3, rows: 2, cellSize: 1, walk: new Uint8Array([1, 0, 1, 1, 1, 1]) };
    expect(lineWalkable(edge, 0.9, 0.9, 2.5, 1.1)).toBe(false);
    expect(lineWalkable(edge, 2.5, 1.1, 0.9, 0.9)).toBe(false);
    expect(findPath(edge, 0.5, 0.5, 2.5, 0.5).length).toBeGreaterThan(1);
  });

  it('every hero spawn can walk to the temple market and to every other spawn', () => {
    const spawns = gameData.map.starts.map((s) => s.heroSpawn);
    const market = gameData.map.shops.find((s) => s.type === 'temple_market')!.pos;
    for (const [x, y] of spawns) {
      expect(isWalkable(nav, x, y)).toBe(true);
      const p = findPath(nav, x, y, market[0], market[1]);
      expect(p.length).toBeGreaterThan(0);
      for (const [ox, oy] of spawns) {
        if (ox === x && oy === y) continue;
        expect(findPath(nav, x, y, ox, oy).length).toBeGreaterThan(0);
      }
    }
  });

  it('paths are straight walkable segments', () => {
    const [sx, sy] = gameData.map.starts[0]!.heroSpawn;
    const [gx, gy] = gameData.map.starts[2]!.heroSpawn;
    const path = findPath(nav, sx, sy, gx, gy);
    let [ax, ay] = [sx, sy];
    for (const [x, y] of path) {
      expect(lineWalkable(nav, ax, ay, x, y)).toBe(true);
      [ax, ay] = [x, y];
    }
    expect(path.length).toBeLessThan(40);
  });

  it('moves a unit along its path at its speed', () => {
    const m = createMover(10, 10, 3);
    m.facing = Math.PI / 2; // looking west
    m.path = [[10, 13]];
    let t = 0;
    while (m.path.length && t < 5) {
      stepMover(m, 0.05);
      t += 0.05;
    }
    expect(m.path.length).toBe(0);
    expect(m.y).toBeCloseTo(13, 3);
    expect(t).toBeGreaterThan(0.95);
    expect(t).toBeLessThan(1.6);
  });
});
