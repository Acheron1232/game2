# Phase 8 — Faction AI architecture

What Phase 8 adds to the simulation and how the parts fit. Game rules and numbers: [FACTION.md](FACTION.md) and `shared/data/{ai,buildings,units,upgrades}.json`. Code rules: `CLAUDE.md` (plain logic in `shared/`, no DOM / Babylon / network there, no new objects per tick in hot loops, simple English).

Phase 8 is split into three parts:

- **8a — economy and buildings:** buildings and gold mines become simulation entities; workers gather gold and wood; trees are chopped for real (the walk grid opens); construction, training queues, supply, tier upgrades; start of the match (Town Hall + 5 workers + 500 gold + 150 wood); defeat and victory.
- **8b — the faction brain:** build order, placement, production, armies (defense group, attack army), gather / attack / retreat / defend / expand, flow fields for army movement, target priority, towers and catapults, AI status line, headless bot-only match runner.
- **8c — hero and faction together:** Town Hall upgrades bought by the hero, hero bots, spectators and the end screen, performance budgets.

## Coordinates and grids

- Game units, x east, y north, origin south-west. Map 256 × 256.
- **Walk grid** (`NavGrid`): 0.5-unit cells, 512 × 512, `walk[i] = 1` walkable. `region` = connected area ids (`labelRegions`).
- **Build grid:** 1-unit cells. A footprint `[w, d]` covers whole cells; its center sits on an integer (even size) or half-integer (odd size) coordinate.
- **Flow fields:** 1-unit cells (256 × 256), built from the walk grid.
- Terrain flags (`TerrainFlag`): Passable 1, Buildable 2, Forest 4, Border 8, Cliff 16, Water 32, Ramp 64, High 128.

## Module map

| Module | Part | What it does |
| --- | --- | --- |
| `shared/src/nav/flow-field.ts` | 8b | Flow field toward a target on a 1-unit grid; small cache. |
| `shared/src/nav/trees.ts` | 8a | Tree index from `map-trees.json`: which walk cells each tree blocks, wood left, nearest choppable tree. |
| `shared/src/nav/blockers.ts` | 8a | Dynamic walk-grid changes: building footprints on / off, chopped trees; keeps the base grid to restore cells; region labels rebuilt when dirty. |
| `shared/src/sim/faction/placement.ts` | 8b | Finds a free building spot in a base area (rules below). |
| `shared/src/sim/faction/upgrades.ts` | 8c (written early) | Town Hall upgrade rules and stat effects. |
| `shared/src/sim/faction/faction.ts` | 8a | Per-slot faction state: gold, wood, supply, tier, buildings, units, upgrade levels. |
| `shared/src/sim/faction/buildings.ts` | 8a | Building entities: construction, training queue, tier upgrade, destruction, drop-off. |
| `shared/src/sim/faction/workers.ts` | 8a | Worker jobs: gold, wood, build, repair. |
| `shared/src/sim/faction/brain.ts` + managers | 8b | The faction AI (economy, build, production, army, target, defense, expansion, retreat). |
| `shared/src/sim/faction/army.ts` | 8b | Groups, gather point, attack-move with flow fields, retreat. |
| `shared/src/sim/hero-bot.ts` | 8c | Hero bots for `Bot` slots. |
| `server/scripts/sim-matches.ts` | 8b | Headless bot-only matches, faster than real time, logs and stuck checks. |

## Entities

`SimEntity` (in `match-sim.ts`) stays the one entity type. Phase 8 adds:

- **Entity type ids** (`ENTITY_TYPES`): heroes, units, then **buildings** (`buildings.json` order), then `gold_mine`. `isBuildingType(i)`.
- `building: BuildingState | null` — footprint, construction progress 0..1, builder id, training queue, rally point, tier upgrade in progress, gold left (mines).
- `job: WorkerJob | null` — for workers: what they do and where (mine, tree, building site), what they carry.
- Buildings never move (`moveSpeed` 0), block the walk grid with their footprint, have `armorType: fortified`, can attack only when the data has `attack` (Watchtower).
- Gold mines are neutral, can not be attacked, hold their gold, take at most 5 workers inside at once (`economy.maxWorkersPerMine`). A worker inside a mine is hidden.
- Shops and fountains stay static map objects (not entities).

## Faction state (one per slot)

```
FactionState {
  slot, team, color, start          // the start spot index
  difficulty: 'easy' | 'normal' | 'hard'
  gold, wood                        // faction money, separate from hero gold
  supplyUsed, supplyCap             // cap = 12 per finished Town Hall tier + 8 per House, max 100
  tier: 1 | 2 | 3
  upgrades: Record<id, level>       // bought by the hero (8c)
  earmarkedGold                     // Tier Up Fund
  buildings: Set<entity id>, units: Set<entity id>
  defeated: boolean
  status: string                    // one short line for the AI panel ("Attacking Blue")
}
```

## Economy rules (8a)

- Start: Town Hall at `starts[i].townHall`, 5 workers next to it, 500 gold, 150 wood.
- **Gold:** worker walks to the mine edge, goes in (hidden) for `mineTimeSec`, comes out with `goldPerTrip`, walks to the nearest finished drop-off (Town Hall / Stronghold / Citadel), adds the gold, repeats. When the mine is full, it waits next to it. An empty mine stops working.
- **Wood:** worker picks the nearest choppable tree near its base that is not taken by another worker, stands next to it, chops for `chopTimeSec`, carries `woodPerTrip` back. A tree holds 50 wood; at 0 it is gone and its walk cells open (`trees.ts` says which).
- **Build:** cost is paid when the site is placed. The site blocks the walk grid at once, starts at 10% health and grows to full with progress. Progress runs only while a worker builds it. A House takes 30 s, etc. (`buildTime`).
- **Train:** cost and supply are taken when a unit is queued (max 5 in a queue). A unit can only start when supply is free. It appears at the building edge on the side of the rally point and walks there.
- **Tier upgrade:** Town Hall → Stronghold → Citadel; the building keeps working while it upgrades; at the end it becomes the next type (health keeps its share).
- **Repair:** a worker next to a damaged finished building restores health at the build speed; free in the MVP.
- **Defeat:** a team loses when none of its players has a Town Hall (any tier, finished or not) left. The last team with a Town Hall wins.

## Building placement rules (8b, `placement.ts`)

- Inside the slot's `buildArea` circle (map layout), on the 1-unit build grid.
- Every walk cell under the footprint must be walkable now and have the Buildable terrain flag.
- At least 1 unit of free space to every other building (map buildings too: gold mines, the Town Hall).
- Never on a **corridor**: a band between the Town Hall and its gold mine (so workers walk freely) and a band from the Town Hall out to the base exit (toward the ring road).
- After placing, the Town Hall must still be reachable from the mine and from the base exit (checked on a copy of the region labels or with A*).
- Towers prefer the side that faces the map center; other buildings prefer spots close to the Town Hall (compact base) but not closer than 4 units to it.
- Deterministic: same inputs, same answer.

## Army movement (8b)

- Armies move with flow fields: each unit samples the field at its position and walks one short step along it (`mover.path = [[x + dx * 1.5, y + dy * 1.5]]`), re-sampled every few ticks. Near the target or when an enemy is close, units switch to attack-move behavior (acquire and fight).
- Units do not stack: the existing push-apart (`separate`) works for all ground units except heroes.
- Flow fields are cached per target cell and rebuilt when the walk grid changes (a building is placed or falls, trees are cut).

## Target priority (8b)

For faction units picking a target (not heroes): units that are attacking us first, then (when `focusFire`) the enemy with the least health in range, then the closest. Catapults: buildings first, towers before other buildings, and they keep their min range. Workers only fight when their Town Hall is below 30% health.

## Network (8a)

- Buildings and mines are normal entities in snapshots. New entity fields: `progress` (u8, construction / training / upgrade), state bits for "under construction", "hidden" (worker in a mine), "carrying gold", "carrying wood". The update mask grows to u16.
- Chopped trees: a `TreeGone` event with the tree index; a full snapshot sends all chopped trees again. Clients apply the same walk-grid change (prediction keeps the same paths) and hide the tree.
- The owner of a faction gets its faction state (gold, wood, supply, tier, status line) in the player state block.

## Tests and checks

- Every module has Vitest tests in its package. Map-based tests use the real `shared/data/map-terrain.bin` and `map-trees.json`.
- 8b ends with `server/scripts/sim-matches.ts`: 10 bot-only 4-team matches, sped up, with a winner in 20–45 game minutes in most runs and no idle base for more than 60 s while it has money.
