# Task: tree index for chopping wood

Write `shared/src/nav/trees.ts` and `shared/test/trees.test.ts`.

## Background
`shared/data/map-trees.json` has `{ trees: [x, y, type, scale][] }` (7,451 trees; type 0 pine, 1 oak, 2 dead, 3 bush). In the terrain grid (`shared/src/map/terrain.ts`, flags per 0.5-unit cell) forest cells have `TerrainFlag.Forest`; the walk grid (`buildNavGrid` / `buildMatchNav`) blocks them. Workers will chop trees: when a tree is gone, the walk cells that belonged to it must open, so the forest slowly thins like in classic RTS games. Server and client must agree exactly on which cells open (the client mirrors it for prediction).

## API (exact)
```ts
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
/** Assigns every forest walk cell to the nearest tree within 2 units (cells farther from all trees stay with -1). */
export function buildTreeIndex(trees: TreeList, terrain: TerrainGrid): TreeIndex;
/** Walk cells that open when tree i is removed: its cells that are Passable and not Water / Cliff / Border. */
export function treeCells(index: TreeIndex, i: number): number[];
/** Removes the tree (alive = 0) and returns the cells that open (see treeCells). Idempotent. */
export function removeTree(index: TreeIndex, i: number): number[];
/**
 * Nearest standing tree within maxR of (x, y) that a worker can stand next to: it has a walkable
 * walk cell (nav.walk) within 1.2 units of the tree center. `taken(i)` skips trees other workers use.
 * Returns the tree and the stand point (center of that walkable cell), or null.
 * Searches outward and stops early; must be fast enough to call a few times per second.
 */
export function nearestChoppableTree(index: TreeIndex, nav: NavGrid, x: number, y: number, maxR: number, taken?: (i: number) => boolean): { tree: number; standX: number; standY: number } | null;
```
(`NavGrid` from `shared/src/nav/nav-grid.ts`, `TerrainGrid` / `TerrainFlag` from `shared/src/map/terrain.ts`.)

## Rules
- Determinism: the same input gives the same `cellTree`; ties go to the lower tree index.
- Build it with a spatial bucket grid over trees (no O(cells × trees) loop). Build time for the real map under ~50 ms (measure; assert under 300 ms).
- `nearestChoppableTree` uses a bucket grid too (build it inside `buildTreeIndex` and keep it on the index, e.g. a private field or a WeakMap).

## Tests (real map: `map-terrain.bin`, `map-trees.json`, `buildMatchNav`)
- Every forest cell near a tree (within 1 unit) has a tree; no non-forest cell has a tree.
- Removing a tree near a base edge returns cells; after setting `nav.walk[c] = 1` for them, `isWalkable` is true there; removing again returns [].
- From each start's hero spawn, `nearestChoppableTree(…, 25)` finds a tree; the stand point is walkable and within 1.3 units of the tree; with `taken` = that tree it finds a different one.
- Chop out a straight line of trees into a forest and check a path (findPath) can now go deeper than before.
