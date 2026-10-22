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

  // The two taverns sit between two bases each, mirrored through the center: the map is the same
  // after a half turn everywhere, and after a quarter turn everywhere but around the taverns.
  const taverns = gameData.map.shops.filter((s) => s.type.startsWith('tavern')).map((s) => s.pos);
  const nearTavern = (r: number, c: number) => {
    const size = gameData.map.size.width / terrain.cols;
    const x = (c + 0.5) * size,
      y = (r + 0.5) * size;
    return taverns.some(([tx, ty]) => Math.hypot(tx - x, ty - y) < 8);
  };
  const differentAfterTurn = (turn: (r: number, c: number, n: number) => number, skipTaverns: boolean) => {
    const n = terrain.cols;
    let different = 0;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const i = r * n + c;
        const j = turn(r, c, n);
        if (skipTaverns && (nearTavern(r, c) || nearTavern(Math.floor(j / n), j % n))) continue;
        if (terrain.ground[i] !== terrain.ground[j] || terrain.flags[i] !== terrain.flags[j] || terrain.height[i] !== terrain.height[j])
          different++;
      }
    }
    return different;
  };

  it('is exactly the same after turning by 90 degrees, but for the taverns (fair for all 4 spots)', () => {
    expect(taverns).toHaveLength(2);
    expect(differentAfterTurn((r, c, n) => (n - 1 - c) * n + r, true)).toBe(0);
  });

  it('is exactly the same after turning by 180 degrees, taverns too', () => {
    expect(differentAfterTurn((r, c, n) => (n - 1 - r) * n + (n - 1 - c), false)).toBe(0);
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
