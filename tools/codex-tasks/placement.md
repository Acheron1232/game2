# Task: building placement for the faction AI

Write `shared/src/sim/faction/placement.ts` and `shared/test/placement.test.ts`.

## Background
Each of the 4 bases has a build area circle in `gameData.map.starts[i].buildArea` (`{ center: [x, y], radius }`, radius 20), a Town Hall at `starts[i].townHall` (footprint 5 × 5), and a main gold mine (`gameData.map.goldMines` with `kind: 'main'`, nearest to the town hall, footprint 3.4 × 3.4). Building footprints are in `shared/data/buildings.json` (`footprint: [w, d]` in game units: House 2×2, Barracks 4×4, Archery Range 4×3, Forge 3×3, Chapel 3×4, Workshop 4×4, Hawk Roost 4×4, Watchtower 2×2). The AI places buildings one by one with this module. Read the "Building placement rules" in `docs/design/AI_ARCHITECTURE.md`.

## API (exact)
```ts
export interface Rect { x: number; y: number; w: number; h: number } // center + size, game units
export interface Corridor { ax: number; ay: number; bx: number; by: number; width: number }
export interface PlacementQuery {
  footprint: [number, number];
  center: [number, number];   // build area center
  radius: number;             // build area radius
  townHall: [number, number]; // keep at least minFromTownHall from it (edge to edge)
  existing: Rect[];           // all buildings now (incl. the Town Hall and mines)
  corridors: Corridor[];      // bands that must stay free
  spacing?: number;           // free gap to other buildings, default 1
  minFromTownHall?: number;   // default 1.5
  preferToward?: [number, number]; // towers: prefer spots on this side (e.g. map center)
}
export function findBuildSpot(terrain: TerrainGrid, nav: NavGrid, q: PlacementQuery): { x: number; y: number } | null;
/** The two corridors of a base: Town Hall <-> main mine (width 3.5) and Town Hall -> base exit toward the map center (width 4). */
export function baseCorridors(townHall: [number, number], mine: [number, number], mapCenter: [number, number], buildRadius: number): Corridor[];
/** Same rules as findBuildSpot, for one given spot (also used to check a player's own placement later). */
export function canPlace(terrain: TerrainGrid, nav: NavGrid, q: PlacementQuery, x: number, y: number): boolean;
```
(`TerrainGrid`, `TerrainFlag` from `shared/src/map/terrain.ts`; `NavGrid`, `isWalkable`, `findPath` from `shared/src/nav/nav-grid.ts`.)

## Rules
- Spot centers on the 1-unit build grid: integer coordinates when the size is even, `n + 0.5` when odd (per axis).
- Every 0.5-unit walk cell under the footprint: `nav.walk === 1` and terrain flag `Buildable`.
- Fully inside the build area circle.
- Rect distance to every `existing` rect ≥ `spacing` (and ≥ `minFromTownHall` to the town hall rect).
- Must not touch any corridor (rectangle vs. thick segment).
- Score (lower is better, deterministic): distance from the town hall (compact base); with `preferToward`, prefer spots in the half of the circle that faces it and farther out (towers guard the entrance). Ties: lower y, then lower x.
- Search all candidates in the circle (radius 20 → about 1,300 spots), cheap checks first. Under 5 ms per call.

## Tests (real map: `buildMatchNav(parseTerrain(map-terrain.bin), gameData.map)`)
- For every start: place, in order, House, Barracks, House, Archery Range, Forge, House, Watchtower (preferToward = map center 128,128), Chapel, Workshop, House, House, Hawk Roost, Barracks — add each to `existing` and block its cells on a copy of the nav (`blockRect` from nav-grid). All of them find a spot.
- No two placed rects overlap or are closer than `spacing`; all inside the circle; none touches a corridor.
- After all placements, `findPath` from the mine edge to the town hall edge and from the town hall to the base exit point (16 units from the town hall toward the map center) is not empty.
- Watchtower spot is on the map-center side of the town hall.
- `canPlace` is false on top of the town hall, in the forest, in water, and on a corridor.
