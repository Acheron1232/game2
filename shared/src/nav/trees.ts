// Trees for chopping wood: which walk cells each tree blocks, wood left, and the nearest tree a
// worker can stand next to. Server and clients open the same cells when a tree falls.
// Written by Codex for Phase 8 (task: tools/codex-tasks/trees.md).

import { TerrainFlag, type TerrainGrid } from '../map/terrain';
import type { NavGrid } from './nav-grid';

export type TreeList = [number, number, number, number][];

export interface TreeIndex {
  readonly count: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly type: Uint8Array;
  /** wood left per tree (starts at TREE_WOOD) */
  readonly wood: Uint16Array;
  /** 1 = still standing */
  readonly alive: Uint8Array;
  /** walk cell -> index of the tree that blocks it, -1 for none */
  readonly cellTree: Int32Array;
}

export const TREE_WOOD = 50;

const BUCKET_SIZE = 2;
const TREE_RADIUS = 2;
const STAND_RADIUS = 1.2;

interface TreePrivate {
  bucketCols: number;
  bucketRows: number;
  bucketHead: Int32Array;
  bucketNext: Int32Array;
  cellStart: Int32Array;
  cells: Int32Array;
}

const treePrivate = new WeakMap<TreeIndex, TreePrivate>();

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/** Assigns every forest walk cell to the nearest tree within 2 units (cells farther from all trees stay with -1). */
export function buildTreeIndex(trees: TreeList, terrain: TerrainGrid): TreeIndex {
  const count = trees.length;
  const x = new Float32Array(count);
  const y = new Float32Array(count);
  const type = new Uint8Array(count);
  const wood = new Uint16Array(count);
  const alive = new Uint8Array(count);
  wood.fill(TREE_WOOD);
  alive.fill(1);

  const worldWidth = terrain.cols * terrain.cellSize;
  const worldHeight = terrain.rows * terrain.cellSize;
  const bucketCols = Math.max(1, Math.ceil(worldWidth / BUCKET_SIZE));
  const bucketRows = Math.max(1, Math.ceil(worldHeight / BUCKET_SIZE));
  const bucketHead = new Int32Array(bucketCols * bucketRows);
  const bucketNext = new Int32Array(count);
  bucketHead.fill(-1);
  bucketNext.fill(-1);

  // Insert backwards so each bucket is visited in tree index order.
  for (let i = count - 1; i >= 0; i--) {
    const tree = trees[i]!;
    x[i] = tree[0];
    y[i] = tree[1];
    type[i] = tree[2];
    const col = clamp(Math.floor(x[i]! / BUCKET_SIZE), 0, bucketCols - 1);
    const row = clamp(Math.floor(y[i]! / BUCKET_SIZE), 0, bucketRows - 1);
    const bucket = row * bucketCols + col;
    bucketNext[i] = bucketHead[bucket]!;
    bucketHead[bucket] = i;
  }

  const cellTree = new Int32Array(terrain.cols * terrain.rows);
  cellTree.fill(-1);
  const radiusSq = TREE_RADIUS * TREE_RADIUS;
  const bucketReach = Math.ceil(TREE_RADIUS / BUCKET_SIZE);
  for (let cell = 0; cell < cellTree.length; cell++) {
    if (!((terrain.flags[cell] ?? 0) & TerrainFlag.Forest)) continue;
    const cellCol = cell % terrain.cols;
    const cellRow = (cell - cellCol) / terrain.cols;
    const cellX = (cellCol + 0.5) * terrain.cellSize;
    const cellY = (cellRow + 0.5) * terrain.cellSize;
    const bucketCol = clamp(Math.floor(cellX / BUCKET_SIZE), 0, bucketCols - 1);
    const bucketRow = clamp(Math.floor(cellY / BUCKET_SIZE), 0, bucketRows - 1);
    let bestTree = -1;
    let bestDistance = radiusSq;
    const fromCol = Math.max(0, bucketCol - bucketReach);
    const toCol = Math.min(bucketCols - 1, bucketCol + bucketReach);
    const fromRow = Math.max(0, bucketRow - bucketReach);
    const toRow = Math.min(bucketRows - 1, bucketRow + bucketReach);
    for (let row = fromRow; row <= toRow; row++) {
      for (let col = fromCol; col <= toCol; col++) {
        for (let tree = bucketHead[row * bucketCols + col]!; tree !== -1; tree = bucketNext[tree]!) {
          const dx = x[tree]! - cellX;
          const dy = y[tree]! - cellY;
          const distance = dx * dx + dy * dy;
          if (distance < bestDistance || (distance === bestDistance && (bestTree === -1 || tree < bestTree))) {
            bestDistance = distance;
            bestTree = tree;
          }
        }
      }
    }
    cellTree[cell] = bestTree;
  }

  const blocked = TerrainFlag.Water | TerrainFlag.Cliff | TerrainFlag.Border;
  const cellStart = new Int32Array(count + 1);
  for (let cell = 0; cell < cellTree.length; cell++) {
    const tree = cellTree[cell]!;
    const flags = terrain.flags[cell] ?? 0;
    if (tree !== -1 && flags & TerrainFlag.Passable && !(flags & blocked)) cellStart[tree + 1] = cellStart[tree + 1]! + 1;
  }
  for (let i = 1; i < cellStart.length; i++) cellStart[i] = cellStart[i]! + cellStart[i - 1]!;
  const cells = new Int32Array(cellStart[count]!);
  const write = cellStart.slice(0, count);
  for (let cell = 0; cell < cellTree.length; cell++) {
    const tree = cellTree[cell]!;
    const flags = terrain.flags[cell] ?? 0;
    if (tree !== -1 && flags & TerrainFlag.Passable && !(flags & blocked)) {
      const at = write[tree]!;
      cells[at] = cell;
      write[tree] = at + 1;
    }
  }

  const index: TreeIndex = { count, x, y, type, wood, alive, cellTree };
  treePrivate.set(index, { bucketCols, bucketRows, bucketHead, bucketNext, cellStart, cells });
  return index;
}

/** Walk cells that open when tree i is removed: its cells that are Passable and not Water / Cliff / Border. */
export function treeCells(index: TreeIndex, i: number): number[] {
  const data = treePrivate.get(index);
  if (!data || i < 0 || i >= index.count) return [];
  const start = data.cellStart[i]!;
  const end = data.cellStart[i + 1]!;
  const result = new Array<number>(end - start);
  for (let at = start; at < end; at++) result[at - start] = data.cells[at]!;
  return result;
}

/** Removes the tree (alive = 0) and returns the cells that open (see treeCells). Idempotent. */
export function removeTree(index: TreeIndex, i: number): number[] {
  if (i < 0 || i >= index.count || !index.alive[i]) return [];
  index.alive[i] = 0;
  index.wood[i] = 0;
  return treeCells(index, i);
}

function standCell(nav: NavGrid, treeX: number, treeY: number, workerX: number, workerY: number): number {
  const cellSize = nav.cellSize;
  const fromCol = Math.max(0, Math.ceil((treeX - STAND_RADIUS) / cellSize - 0.5));
  const toCol = Math.min(nav.cols - 1, Math.floor((treeX + STAND_RADIUS) / cellSize - 0.5));
  const fromRow = Math.max(0, Math.ceil((treeY - STAND_RADIUS) / cellSize - 0.5));
  const toRow = Math.min(nav.rows - 1, Math.floor((treeY + STAND_RADIUS) / cellSize - 0.5));
  const standRadiusSq = STAND_RADIUS * STAND_RADIUS;
  let bestCell = -1;
  let bestDistance = Infinity;
  for (let row = fromRow; row <= toRow; row++) {
    const centerY = (row + 0.5) * cellSize;
    const treeDy = centerY - treeY;
    for (let col = fromCol; col <= toCol; col++) {
      const cell = row * nav.cols + col;
      if (!nav.walk[cell]) continue;
      const centerX = (col + 0.5) * cellSize;
      const treeDx = centerX - treeX;
      if (treeDx * treeDx + treeDy * treeDy > standRadiusSq) continue;
      const workerDx = centerX - workerX;
      const workerDy = centerY - workerY;
      const distance = workerDx * workerDx + workerDy * workerDy;
      if (distance < bestDistance || (distance === bestDistance && cell < bestCell)) {
        bestCell = cell;
        bestDistance = distance;
      }
    }
  }
  return bestCell;
}

/** Nearest standing tree in range that has a walkable cell next to it. */
export function nearestChoppableTree(
  index: TreeIndex,
  nav: NavGrid,
  x: number,
  y: number,
  maxR: number,
  taken?: (i: number) => boolean,
): { tree: number; standX: number; standY: number } | null {
  const data = treePrivate.get(index);
  if (!data || maxR < 0) return null;
  const { bucketCols, bucketRows, bucketHead, bucketNext } = data;
  const queryCol = clamp(Math.floor(x / BUCKET_SIZE), 0, bucketCols - 1);
  const queryRow = clamp(Math.floor(y / BUCKET_SIZE), 0, bucketRows - 1);
  const maxDistance = maxR * maxR;
  const maxRing = Math.max(queryCol, bucketCols - 1 - queryCol, queryRow, bucketRows - 1 - queryRow, Math.ceil(maxR / BUCKET_SIZE) + 1);
  let bestTree = -1;
  let bestCell = -1;
  let bestDistance = maxDistance;

  const testBucket = (col: number, row: number) => {
    if (col < 0 || row < 0 || col >= bucketCols || row >= bucketRows) return;
    for (let tree = bucketHead[row * bucketCols + col]!; tree !== -1; tree = bucketNext[tree]!) {
      if (!index.alive[tree] || (taken && taken(tree))) continue;
      const dx = index.x[tree]! - x;
      const dy = index.y[tree]! - y;
      const distance = dx * dx + dy * dy;
      if (distance > bestDistance || (distance === bestDistance && bestTree !== -1 && tree > bestTree)) continue;
      const cell = standCell(nav, index.x[tree]!, index.y[tree]!, x, y);
      if (cell === -1) continue;
      if (distance < bestDistance || bestTree === -1 || tree < bestTree) {
        bestTree = tree;
        bestCell = cell;
        bestDistance = distance;
      }
    }
  };

  for (let ring = 0; ring <= maxRing; ring++) {
    if (ring === 0) {
      testBucket(queryCol, queryRow);
    } else {
      const left = queryCol - ring;
      const right = queryCol + ring;
      const bottom = queryRow - ring;
      const top = queryRow + ring;
      for (let col = left; col <= right; col++) {
        testBucket(col, bottom);
        testBucket(col, top);
      }
      for (let row = bottom + 1; row < top; row++) {
        testBucket(left, row);
        testBucket(right, row);
      }
    }

    const left = Math.max(0, queryCol - ring);
    const right = Math.min(bucketCols - 1, queryCol + ring);
    const bottom = Math.max(0, queryRow - ring);
    const top = Math.min(bucketRows - 1, queryRow + ring);
    if (left === 0 && right === bucketCols - 1 && bottom === 0 && top === bucketRows - 1) break;
    let unsearchedDistance = Infinity;
    if (left > 0) unsearchedDistance = Math.min(unsearchedDistance, Math.max(0, x - left * BUCKET_SIZE));
    if (right < bucketCols - 1) unsearchedDistance = Math.min(unsearchedDistance, Math.max(0, (right + 1) * BUCKET_SIZE - x));
    if (bottom > 0) unsearchedDistance = Math.min(unsearchedDistance, Math.max(0, y - bottom * BUCKET_SIZE));
    if (top < bucketRows - 1) unsearchedDistance = Math.min(unsearchedDistance, Math.max(0, (top + 1) * BUCKET_SIZE - y));
    if (bestTree !== -1 && bestDistance < unsearchedDistance * unsearchedDistance) break;
    if (unsearchedDistance > maxR) break;
  }

  if (bestTree === -1) return null;
  const col = bestCell % nav.cols;
  const row = (bestCell - col) / nav.cols;
  return { tree: bestTree, standX: (col + 0.5) * nav.cellSize, standY: (row + 0.5) * nav.cellSize };
}
