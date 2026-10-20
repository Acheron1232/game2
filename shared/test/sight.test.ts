import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseTerrain, terrainCellAt, terrainLevel } from '../src/map/terrain';
import { buildTreeIndex, removeTree, type TreeIndex, type TreeList } from '../src/nav/trees';
import { SIGHT_CELL, TeamSight, type SightSource } from '../src/sim/sight';
import type { SimEntity } from '../src/sim/match-sim';

const DATA = join(__dirname, '..', 'data');
const terrain = parseTerrain(readFileSync(join(DATA, 'map-terrain.bin')));
const treeList = (JSON.parse(readFileSync(join(DATA, 'map-trees.json'), 'utf8')) as { trees: TreeList }).trees;
const cols = Math.ceil((terrain.cols * terrain.cellSize) / SIGHT_CELL);

function point(col: number, row: number): [number, number] {
  return [(col + 0.5) * SIGHT_CELL, (row + 0.5) * SIGHT_CELL];
}

function forestGrid(trees: TreeIndex): Uint8Array {
  const counts = new Uint8Array(cols * cols);
  for (let cell = 0; cell < trees.cellTree.length; cell++) {
    const tree = trees.cellTree[cell]!;
    if (tree === -1 || !trees.alive[tree]) continue;
    const terrainCol = cell % terrain.cols;
    const terrainRow = (cell - terrainCol) / terrain.cols;
    const col = Math.floor((terrainCol * terrain.cellSize) / SIGHT_CELL);
    const row = Math.floor((terrainRow * terrain.cellSize) / SIGHT_CELL);
    const sightCell = row * cols + col;
    if (counts[sightCell]! < 2) counts[sightCell] = counts[sightCell]! + 1;
  }
  return counts.map((count) => (count >= 2 ? 1 : 0));
}

function forestLine(trees: TreeIndex): { source: [number, number]; target: [number, number]; treeIds: number[] } {
  const forest = forestGrid(trees);
  const directions = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;
  for (let row = 8; row < cols - 8; row++) {
    for (let col = 8; col < cols - 8; col++) {
      if (forest[row * cols + col]) continue;
      for (const [dx, dy] of directions) {
        let edge = 0;
        for (let distance = 1; distance <= 3; distance++) {
          if (forest[(row + dy * distance) * cols + col + dx * distance]) {
            edge = distance;
            break;
          }
        }
        if (!edge) continue;
        let end = edge;
        while (end < 6 && forest[(row + dy * (end + 1)) * cols + col + dx * (end + 1)]) end++;
        const targetDistance = end + 2;
        if (targetDistance > 8) continue;
        const targetCol = col + dx * targetDistance;
        const targetRow = row + dy * targetDistance;
        if (forest[targetRow * cols + targetCol]) continue;

        const treeIds = new Set<number>();
        for (let distance = 1; distance < targetDistance; distance++) {
          const sightCol = col + dx * distance;
          const sightRow = row + dy * distance;
          const minX = sightCol * SIGHT_CELL;
          const minY = sightRow * SIGHT_CELL;
          const fromCol = Math.floor(minX / terrain.cellSize);
          const fromRow = Math.floor(minY / terrain.cellSize);
          const cellsPerSight = Math.ceil(SIGHT_CELL / terrain.cellSize);
          for (let y = fromRow; y < fromRow + cellsPerSight; y++) {
            for (let x = fromCol; x < fromCol + cellsPerSight; x++) {
              const tree = trees.cellTree[y * terrain.cols + x]!;
              if (tree !== -1 && trees.alive[tree]) treeIds.add(tree);
            }
          }
        }
        if (treeIds.size) return { source: point(col, row), target: point(targetCol, targetRow), treeIds: [...treeIds] };
      }
    }
  }
  throw new Error('No forest sight line found');
}

function levelAt(col: number, row: number): number {
  const [x, y] = point(col, row);
  return terrainLevel(terrain, terrainCellAt(terrain, x, y));
}

function cliffLine(): { low: [number, number]; high: [number, number] } {
  const directions = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;
  for (let row = 8; row < cols - 8; row++) {
    for (let col = 8; col < cols - 8; col++) {
      const lowLevel = levelAt(col, row);
      for (const [dx, dy] of directions) {
        let edge = 0;
        for (let distance = 1; distance <= 3; distance++) {
          if (levelAt(col + dx * distance, row + dy * distance) >= lowLevel + 0.5) {
            edge = distance;
            break;
          }
        }
        if (!edge) continue;
        const highDistance = edge + 2;
        const highCol = col + dx * highDistance;
        const highRow = row + dy * highDistance;
        const highLevel = levelAt(highCol, highRow);
        if (highLevel < lowLevel + 0.5) continue;
        let clearDown = true;
        for (let distance = 1; distance < highDistance; distance++) {
          if (levelAt(col + dx * distance, row + dy * distance) >= highLevel + 0.5) clearDown = false;
        }
        if (clearDown) return { low: point(col, row), high: point(highCol, highRow) };
      }
    }
  }
  throw new Error('No cliff sight line found');
}

describe('team sight', () => {
  it('trees block ground sight, air sees over them, and cut trees stop blocking', () => {
    const trees = buildTreeIndex(treeList, terrain);
    const line = forestLine(trees);
    const sight = new TeamSight(terrain, trees);
    sight.update([{ x: line.source[0], y: line.source[1], team: 1, sight: 16, air: false }]);
    expect(sight.seesPoint(1, line.target[0], line.target[1])).toBe(false);

    sight.update([{ x: line.source[0], y: line.source[1], team: 1, sight: 16, air: true }]);
    expect(sight.seesPoint(1, line.target[0], line.target[1])).toBe(true);

    for (const tree of line.treeIds) removeTree(trees, tree);
    sight.update([{ x: line.source[0], y: line.source[1], team: 1, sight: 16, air: false }]);
    expect(sight.seesPoint(1, line.target[0], line.target[1])).toBe(true);
  });

  it('a cliff blocks sight up, but a unit on the plateau sees down', () => {
    const line = cliffLine();
    const sight = new TeamSight(terrain, null);
    sight.update([{ x: line.low[0], y: line.low[1], team: 1, sight: 16, air: false }]);
    expect(sight.seesPoint(1, line.high[0], line.high[1])).toBe(false);

    sight.update([{ x: line.high[0], y: line.high[1], team: 1, sight: 16, air: false }]);
    expect(sight.seesPoint(1, line.low[0], line.low[1])).toBe(true);
  });

  it('keeps explored cells after current sight moves away', () => {
    const sight = new TeamSight(terrain, null);
    const old = point(50, 50);
    sight.update([{ x: old[0], y: old[1], team: 1, sight: 8, air: true }]);
    const cell = 50 * cols + 50;
    expect(sight.visible(1)[cell]).toBe(1);
    expect(sight.explored(1)[cell]).toBe(1);

    const next = point(80, 80);
    sight.update([{ x: next[0], y: next[1], team: 1, sight: 8, air: true }]);
    expect(sight.visible(1)[cell]).toBe(0);
    expect(sight.explored(1)[cell]).toBe(1);
  });

  it('sees an enemy building when only its edge is visible', () => {
    const sight = new TeamSight(terrain, null);
    const source = point(64, 64);
    sight.update([{ x: source[0], y: source[1], team: 1, sight: 4, air: true }]);
    const building = {
      team: 2,
      buffs: [],
      mover: { x: source[0] + 6, y: source[1] },
      building: { w: 4, h: 4 },
    } as unknown as SimEntity;
    expect(sight.seesPoint(1, building.mover.x, building.mover.y)).toBe(false);
    expect(sight.sees(1, building)).toBe(true);
  });

  it('updates 200 sources in under 2 ms on average', () => {
    const trees = buildTreeIndex(treeList, terrain);
    const sight = new TeamSight(terrain, trees);
    const sources: SightSource[] = [];
    for (let i = 0; i < 150; i++)
      sources.push({ x: 20 + ((i * 37) % 216), y: 20 + ((i * 61) % 216), team: (i % 4) + 1, sight: 12, air: false });
    for (let i = 0; i < 30; i++)
      sources.push({ x: 24 + ((i * 47) % 208), y: 24 + ((i * 71) % 208), team: (i % 4) + 1, sight: 10, air: false });
    for (let i = 0; i < 20; i++)
      sources.push({ x: 24 + ((i * 43) % 208), y: 24 + ((i * 67) % 208), team: (i % 4) + 1, sight: 16, air: true });

    for (let i = 0; i < 10; i++) sight.update(sources);
    const runs = 100;
    const start = performance.now();
    for (let i = 0; i < runs; i++) sight.update(sources);
    const average = (performance.now() - start) / runs;
    console.log(`TeamSight 200 sources: ${average.toFixed(3)} ms average`);
    expect(average).toBeLessThan(2);
  });
});
