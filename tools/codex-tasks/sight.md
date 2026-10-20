# Task: line-of-sight team vision (fog of war data)

Write `shared/src/sim/sight.ts` and `shared/test/sight.test.ts`. Do not edit other files.

## Background
Today `shared/src/sim/vision.ts` (`TeamVision`) marks a plain circle (radius = unit sight) on a 4-unit grid per team. Phase 9 needs real fog of war (rules.json `sight`): **trees and higher ground block sight; units on high ground see low ground; flying units see over everything.** The server uses it to decide what each player is sent; the client runs the **same code** for its own team (it knows its own team's units) to draw the fog. Read `vision.ts`, `shared/src/map/terrain.ts` (`TerrainGrid`, `terrainCellAt`, `terrainLevel`, `TerrainFlag.Forest`), `shared/src/nav/trees.ts` (`TreeIndex`: `alive`, `cellTree` per terrain cell = which tree stands on a cell, -1 none; a cut tree has `alive[i] = 0`), `shared/src/sim/buffs.ts` (`hiddenFrom`, `revealedTo`).

## API (exact)
```ts
export const SIGHT_CELL = 2; // game units per sight cell (256 / 2 = 128 x 128)
/** One thing that sees: a unit, hero or building (buildings see too). */
export interface SightSource { x: number; y: number; team: number; sight: number; air: boolean }
export class TeamSight {
  readonly cols: number; // = rows
  readonly cell: number; // SIGHT_CELL
  constructor(terrain: TerrainGrid, trees: TreeIndex | null);
  /** Recompute every team's visible grid (explored only grows). Sources with sight 0 are skipped. */
  update(sources: Iterable<SightSource>): void;
  /** Same meaning as TeamVision.sees / seesPoint (so the server can swap it in). */
  sees(team: number, e: SimEntity): boolean;
  seesPoint(team: number, x: number, y: number): boolean;
  /** 1 = seen now, per cell (row-major, row 0 = y 0). A shared array, do not keep it. */
  visible(team: number): Uint8Array;
  /** 1 = seen at some time (for the dark "never seen" fog). */
  explored(team: number): Uint8Array;
}
/** SimEntity -> SightSource adapter that reuses one object (for MatchSim.entities). */
export function entitySources(entities: readonly SimEntity[]): Iterable<SightSource>;
```
`sees(team, e)`: own team always; `revealedTo` → true; `hiddenFrom` → false; then the cell of the entity. For a **building**, seeing any cell of its footprint counts (a big building half in sight is seen).

## Rules
- A cell blocks sight for a ground viewer when a **living tree** stands on it (look up the tree per terrain cell; a sight cell is 2×2 terrain cells if terrain cellSize is 0.5 — check `terrain.cellSize`; a sight cell is "forest" when at least 2 of its terrain cells have a living tree) or when its ground level is **higher than the viewer's level by 0.5 or more**. The viewer always sees the blocking cell itself (you see the tree line and the cliff edge), not what is behind.
- High ground: a viewer sees lower cells normally.
- Air viewers (`air: true`): no blockers.
- Use a simple ray march (or shadowcasting) from the viewer's cell to each cell in its sight circle. Keep it fast: precompute ray offsets per radius once (module-level tables), no allocations in `update`. Recompute the forest-blocker grid lazily only when trees change (compare a count of alive trees, or give `update` an internal dirty check cheap enough to run every call).
- Optional speed-up: skip a source whose cell, team and sight did not change since the last update, by caching its visible cells? Only if simple. The target: `update` with **200 sources** (150 ground units, 30 buildings, 20 air) on the real map in **under 2 ms** on average (print the timing in the test).

## Tests (`shared/test/sight.test.ts`)
Load the real map (`map-terrain.bin`, `map-trees.json` → `buildTreeIndex`), like `shared/test/faction.test.ts`. Check:
- a ground unit next to a thick forest does not see cells 4+ units behind the forest edge, but a flying unit at the same spot does;
- after cutting those trees (`removeTree` on the index for every tree in between), the ground unit sees behind;
- a unit on low ground near a cliff does not see the high plateau 4+ units in, while a unit on the plateau sees down (find a high cell and a low cell from `terrainLevel` near a plateau in map-layout `plateaus`, or search the grid in the test);
- explored stays 1 after the unit leaves; visible goes back to 0;
- `sees` for an enemy building whose edge is in sight but whose center is not → true;
- the 200-source timing.
