import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gameData, parseTerrain, TerrainFlag, terrainCellAt, treesSchema } from '../src/index';

const DATA = join(import.meta.dirname, '..', 'data');
const terrain = parseTerrain(readFileSync(join(DATA, 'map-terrain.bin')));
const trees = treesSchema.parse(JSON.parse(readFileSync(join(DATA, 'map-trees.json'), 'utf8')));

describe('baked terrain', () => {
  it('covers the whole map', () => {
    expect(terrain.cols * terrain.cellSize).toBe(gameData.map.size.width);
    expect(terrain.rows * terrain.cellSize).toBe(gameData.map.size.height);
  });

  it('is exactly the same after turning by 90 degrees (fair for all 4 spots)', () => {
    const n = terrain.cols;
    let different = 0;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const i = r * n + c;
        const j = (n - 1 - c) * n + r;
        if (terrain.ground[i] !== terrain.ground[j] || terrain.flags[i] !== terrain.flags[j] || terrain.height[i] !== terrain.height[j])
          different++;
      }
    }
    expect(different).toBe(0);
  });

  it('puts every start, mine, camp, shop and fountain on open ground', () => {
    const m = gameData.map;
    const points: [string, [number, number]][] = [
      ...m.starts.flatMap(
        (s) =>
          [
            [`town hall ${s.id}`, s.townHall],
            [`hero spawn ${s.id}`, s.heroSpawn],
          ] as [string, [number, number]][],
      ),
      ...m.goldMines.map((g) => [g.id, g.pos] as [string, [number, number]]),
      ...m.camps.map((c) => [c.id, c.pos] as [string, [number, number]]),
      ...m.shops.map((s) => [s.id, s.pos] as [string, [number, number]]),
      ...m.fountains.map((f) => [f.id, f.pos] as [string, [number, number]]),
    ];
    const blocked = points.filter(([, [x, y]]) => {
      const f = terrain.flags[terrainCellAt(terrain, x, y)] ?? 0;
      return !(f & TerrainFlag.Passable) || (f & (TerrainFlag.Forest | TerrainFlag.Water | TerrainFlag.Cliff)) !== 0;
    });
    expect(blocked.map(([name]) => name)).toEqual([]);
  });

  it('has trees only on forest cells', () => {
    expect(trees.trees.length).toBeGreaterThan(1000);
    const bad = trees.trees.filter(([x, y]) => !((terrain.flags[terrainCellAt(terrain, x, y)] ?? 0) & TerrainFlag.Forest));
    expect(bad).toHaveLength(0);
  });
});
