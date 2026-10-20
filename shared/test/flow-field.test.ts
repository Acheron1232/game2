import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { gameData } from '../src/data/index';
import { parseTerrain, TerrainFlag } from '../src/map/terrain';
import { buildFlowField, FlowFieldCache, flowDirection, flowDistance } from '../src/nav/flow-field';
import { buildMatchNav } from '../src/nav/match-nav';
import { isWalkable, type NavGrid } from '../src/nav/nav-grid';

const terrain = parseTerrain(readFileSync(join(import.meta.dirname, '..', 'data', 'map-terrain.bin')));
const nav = buildMatchNav(terrain, gameData.map);

describe('flow fields', () => {
  it('gives each hero spawn a reasonable route to the temple', () => {
    const field = buildFlowField(nav, 128, 128);
    for (const start of gameData.map.starts) {
      const [x, y] = start.heroSpawn;
      const straight = Math.hypot(128 - x, 128 - y);
      const distance = flowDistance(field, x, y);
      expect(distance).toBeGreaterThanOrEqual(straight);
      expect(distance).toBeLessThan(straight * 2.2);
    }
  });

  it('can be followed from a hero spawn without leaving walkable ground', () => {
    const [targetX, targetY] = gameData.map.starts[2]!.heroSpawn;
    const field = buildFlowField(nav, targetX, targetY);
    let [x, y] = gameData.map.starts[0]!.heroSpawn;
    const direction = { x: 0, y: 0 };
    let steps = 0;
    while (Math.hypot(targetX - x, targetY - y) > 2 && steps < 2000) {
      expect(flowDirection(field, x, y, direction), `stopped at ${x}, ${y} after ${steps} steps`).toBe(true);
      x += direction.x * 0.5;
      y += direction.y * 0.5;
      expect(isWalkable(nav, x, y)).toBe(true);
      steps++;
    }
    expect(Math.hypot(targetX - x, targetY - y)).toBeLessThanOrEqual(2);
    expect(steps).toBeLessThan(2000);
  });

  it('moves a lake or forest target to nearby open ground', () => {
    const [x, y] = gameData.map.starts[1]!.heroSpawn;
    for (const flag of [TerrainFlag.Water, TerrainFlag.Forest]) {
      let cell = -1;
      let best = Infinity;
      for (let i = 0; i < terrain.flags.length; i++) {
        if (!(terrain.flags[i]! & flag)) continue;
        const c = i % terrain.cols;
        const r = (i - c) / terrain.cols;
        const distance = (c - terrain.cols / 2) ** 2 + (r - terrain.rows / 2) ** 2;
        if (distance >= best) continue;
        cell = i;
        best = distance;
      }
      const tx = ((cell % terrain.cols) + 0.5) * terrain.cellSize;
      const ty = (Math.floor(cell / terrain.cols) + 0.5) * terrain.cellSize;
      expect(isWalkable(nav, tx, ty)).toBe(false);
      expect(Number.isFinite(flowDistance(buildFlowField(nav, tx, ty), x, y))).toBe(true);
    }
  });

  it('caches by target cell, rebuilds by version, and evicts the least recent field', () => {
    const cache = new FlowFieldCache(nav, 2);
    const first = cache.get(128.1, 128.1);
    expect(cache.get(128.9, 128.9)).toBe(first);
    const second = cache.get(100, 100);
    expect(cache.get(128.2, 128.2)).toBe(first);
    cache.get(150, 150);
    expect(cache.get(100, 100)).not.toBe(second);
    const beforeVersionChange = cache.get(128.1, 128.1);
    cache.version++;
    expect(cache.get(128.1, 128.1)).not.toBe(beforeVersionChange);
    cache.clear();
    const afterClear = cache.get(128.1, 128.1);
    cache.clear();
    expect(cache.get(128.1, 128.1)).not.toBe(afterClear);
  });

  it('does not squeeze through a blocked diagonal corner', () => {
    const tiny: NavGrid = {
      cols: 6,
      rows: 6,
      cellSize: 0.5,
      walk: new Uint8Array([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]),
    };
    const field = buildFlowField(tiny, 2.5, 2.5);
    expect(flowDistance(field, 0.5, 0.5)).toBeCloseTo(4, 5);
    const direction = { x: 0, y: 0 };
    expect(flowDirection(field, 0.5, 0.5, direction)).toBe(true);
    expect(direction.x === 0 || direction.y === 0).toBe(true);
  });

  it('builds a full real-map field within the CI budget', () => {
    buildFlowField(nav, 128, 128);
    const started = performance.now();
    buildFlowField(nav, 128, 128);
    const elapsed = performance.now() - started;
    console.log(`flow field build: ${elapsed.toFixed(2)} ms`);
    expect(elapsed).toBeLessThan(80);
  });
});
