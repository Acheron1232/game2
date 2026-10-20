# Task: flow fields for army movement

Write `shared/src/nav/flow-field.ts` and `shared/test/flow-field.test.ts`.

## Background
Armies (20–40 units) walk across a 256 × 256 map. Instead of one A* per unit, all units going to the same place share one flow field: for every cell, the direction to walk to get closer to the target. Walk grid: `NavGrid` from `shared/src/nav/nav-grid.ts` (0.5-unit cells, 512 × 512, `walk[i] === 1` walkable, `cellSize` 0.5). Build it in tests with `buildMatchNav(parseTerrain(readFileSync('shared/data/map-terrain.bin')), gameData.map)` (`shared/src/nav/match-nav.ts`, `shared/src/map/terrain.ts`, `shared/src/data/index.ts`).

## API (exact)
```ts
export interface FlowField {
  /** 1-unit cells */
  readonly cols: number;
  readonly rows: number;
  readonly cell: number; // 1
  readonly targetX: number;
  readonly targetY: number;
  /** cost to reach the target per coarse cell (Infinity = can not reach) */
  readonly dist: Float32Array;
  /** walk-grid version this field was built for */
  readonly version: number;
}
/** Builds a field toward (tx, ty). Coarse cell = 2 × 2 walk cells; it is open when at least 3 of its 4 walk cells are walkable. */
export function buildFlowField(nav: NavGrid, tx: number, ty: number, version?: number): FlowField;
/** Unit vector (out.x, out.y) to walk from (x, y). Returns false when (x, y) can not reach the target or is already in the target cell. */
export function flowDirection(f: FlowField, x: number, y: number, out: { x: number; y: number }): boolean;
/** Distance left to the target along the field (game units), Infinity if unreachable. */
export function flowDistance(f: FlowField, x: number, y: number): number;
/** Small LRU cache: get(tx, ty) returns a field for that target cell, building it when missing or when `version` changed. */
export class FlowFieldCache {
  constructor(nav: NavGrid, maxFields?: number /* default 8 */);
  version: number; // bump when the walk grid changes
  get(tx: number, ty: number): FlowField;
  clear(): void;
}
```

## Rules
- Dijkstra (or a two-queue / bucket variant) from the target over coarse cells, 8 directions, diagonal cost √2, **no corner cutting** (a diagonal step needs both side cells open).
- If the target cell itself is closed, start from the nearest open coarse cell to the target.
- `flowDirection`: look at the 8 neighbors of the unit's cell (same corner rule) and pick the lowest `dist`; return the normalized direction from the unit position to that neighbor's center. If the unit's own cell is closed (it stands at a forest edge), point toward the nearest open neighbor with a finite `dist`.
- Reuse internal buffers (heap, queues) between builds; one `Float32Array` per field is fine.
- Speed target: one full field for the whole map under 20 ms on a modern laptop (measure it in a test with `performance.now()`, assert under 80 ms so slow CI does not fail).

## Tests (real map)
- From each hero spawn (`gameData.map.starts[i].heroSpawn`) to the temple center (128, 128): `flowDistance` is finite and between the straight-line distance and 2.2 × it.
- Following the field from a start (steps of 0.5 units, up to 2000 steps) reaches within 2 units of the target, and every step stays on walkable walk cells (`isWalkable`).
- A target inside a lake or forest still gives finite distances for open ground (nearest open cell rule).
- Cache: same target cell returns the same object; after `version++` it is rebuilt; more than `maxFields` targets evicts the oldest.
- Corner rule: build a tiny hand-made NavGrid where a diagonal squeeze is closed and check the path goes around.
