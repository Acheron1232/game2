import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { gameData } from '../src/data/index';
import { parseTerrain, TerrainFlag, type TerrainGrid } from '../src/map/terrain';
import { buildMatchNav } from '../src/nav/match-nav';
import { findPath, isWalkable, labelRegions, lineWalkable, type NavGrid } from '../src/nav/nav-grid';
import { buildTreeIndex, nearestChoppableTree, removeTree, TREE_WOOD, treeCells, type TreeIndex, type TreeList } from '../src/nav/trees';

const terrain = parseTerrain(readFileSync(new URL('../data/map-terrain.bin', import.meta.url)));
const trees = (JSON.parse(readFileSync(new URL('../data/map-trees.json', import.meta.url), 'utf8')) as { trees: TreeList }).trees;

function makeMap(): { index: TreeIndex; nav: NavGrid } {
  return { index: buildTreeIndex(trees, terrain), nav: buildMatchNav(terrain, gameData.map) };
}

function lastPoint(path: [number, number][], fallback: [number, number]): [number, number] {
  return path[path.length - 1] ?? fallback;
}

describe('tree index', () => {
  it('builds the real map quickly and assigns only forest cells', () => {
    const started = performance.now();
    const index = buildTreeIndex(trees, terrain);
    const buildMs = performance.now() - started;
    expect(buildMs).toBeLessThan(300);
    expect(index.count).toBe(trees.length);
    expect(index.wood.every((wood) => wood === TREE_WOOD)).toBe(true);
    expect(index.alive.every((alive) => alive === 1)).toBe(true);

    for (let cell = 0; cell < index.cellTree.length; cell++) {
      if (index.cellTree[cell] !== -1) expect((terrain.flags[cell] ?? 0) & TerrainFlag.Forest).not.toBe(0);
    }

    for (let tree = 0; tree < index.count; tree++) {
      const treeX = index.x[tree]!;
      const treeY = index.y[tree]!;
      const fromCol = Math.max(0, Math.ceil((treeX - 1) / terrain.cellSize - 0.5));
      const toCol = Math.min(terrain.cols - 1, Math.floor((treeX + 1) / terrain.cellSize - 0.5));
      const fromRow = Math.max(0, Math.ceil((treeY - 1) / terrain.cellSize - 0.5));
      const toRow = Math.min(terrain.rows - 1, Math.floor((treeY + 1) / terrain.cellSize - 0.5));
      for (let row = fromRow; row <= toRow; row++) {
        const cellY = (row + 0.5) * terrain.cellSize;
        for (let col = fromCol; col <= toCol; col++) {
          const cellX = (col + 0.5) * terrain.cellSize;
          const cell = row * terrain.cols + col;
          const dx = cellX - treeX;
          const dy = cellY - treeY;
          if (dx * dx + dy * dy <= 1 && (terrain.flags[cell] ?? 0) & TerrainFlag.Forest) expect(index.cellTree[cell]).not.toBe(-1);
        }
      }
    }
  });

  it('uses the lower tree index when distances tie', () => {
    const smallTerrain: TerrainGrid = {
      version: 1,
      cols: 1,
      rows: 1,
      cellSize: 1,
      ground: new Uint8Array(1),
      flags: new Uint8Array([TerrainFlag.Passable | TerrainFlag.Forest]),
      height: new Uint8Array(1),
    };
    const index = buildTreeIndex(
      [
        [0.25, 0.5, 0, 1],
        [0.75, 0.5, 1, 1],
      ],
      smallTerrain,
    );
    expect(index.cellTree[0]).toBe(0);
  });

  it('opens a base-edge tree once', () => {
    const { index, nav } = makeMap();
    const [x, y] = gameData.map.starts[0]!.heroSpawn;
    const target = nearestChoppableTree(index, nav, x, y, 25);
    expect(target).not.toBeNull();
    const cellsBefore = treeCells(index, target!.tree);
    expect(cellsBefore.length).toBeGreaterThan(0);
    const cells = removeTree(index, target!.tree);
    expect(cells).toEqual(cellsBefore);
    for (const cell of cells) {
      nav.walk[cell] = 1;
      const col = cell % nav.cols;
      const row = (cell - col) / nav.cols;
      expect(isWalkable(nav, (col + 0.5) * nav.cellSize, (row + 0.5) * nav.cellSize)).toBe(true);
    }
    expect(index.alive[target!.tree]).toBe(0);
    expect(index.wood[target!.tree]).toBe(0);
    expect(removeTree(index, target!.tree)).toEqual([]);
  });

  it('finds two available trees from every hero spawn', () => {
    const { index, nav } = makeMap();
    for (const start of gameData.map.starts) {
      const [x, y] = start.heroSpawn;
      const first = nearestChoppableTree(index, nav, x, y, 25);
      expect(first).not.toBeNull();
      expect(isWalkable(nav, first!.standX, first!.standY)).toBe(true);
      expect(Math.hypot(first!.standX - index.x[first!.tree]!, first!.standY - index.y[first!.tree]!)).toBeLessThanOrEqual(1.3);
      const second = nearestChoppableTree(index, nav, x, y, 25, (tree) => tree === first!.tree);
      expect(second).not.toBeNull();
      expect(second!.tree).not.toBe(first!.tree);
      expect(isWalkable(nav, second!.standX, second!.standY)).toBe(true);
      expect(Math.hypot(second!.standX - index.x[second!.tree]!, second!.standY - index.y[second!.tree]!)).toBeLessThanOrEqual(1.3);
    }
  });

  it('opens a straight route deeper into the forest', () => {
    const { index, nav } = makeMap();
    const start = gameData.map.starts[0]!.heroSpawn as [number, number];
    const angle = Math.PI / 36;
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    const depth = 35;
    const goalX = start[0] + dirX * depth;
    const goalY = start[1] + dirY * depth;
    const goalCell = Math.floor(goalY / terrain.cellSize) * terrain.cols + Math.floor(goalX / terrain.cellSize);
    expect((terrain.flags[goalCell] ?? 0) & TerrainFlag.Forest).not.toBe(0);
    expect(lineWalkable(nav, start[0], start[1], goalX, goalY)).toBe(false);
    const before = lastPoint(findPath(nav, start[0], start[1], goalX, goalY), start);
    expect(Math.hypot(before[0] - goalX, before[1] - goalY)).toBeGreaterThan(1);

    let removed = 0;
    for (let tree = 0; tree < index.count; tree++) {
      const relX = index.x[tree]! - start[0];
      const relY = index.y[tree]! - start[1];
      const along = relX * dirX + relY * dirY;
      const across = Math.abs(relX * dirY - relY * dirX);
      if (along < 0 || along > depth + 2 || across > 3) continue;
      for (const cell of removeTree(index, tree)) nav.walk[cell] = 1;
      removed++;
    }
    expect(removed).toBeGreaterThan(2);
    labelRegions(nav);
    expect(lineWalkable(nav, start[0], start[1], goalX, goalY)).toBe(true);
    const after = lastPoint(findPath(nav, start[0], start[1], goalX, goalY), start);
    expect(after[0]).toBeCloseTo(goalX, 6);
    expect(after[1]).toBeCloseTo(goalY, 6);
  });
});
