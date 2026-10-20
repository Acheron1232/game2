# Task: army movement with flow fields

Write `shared/src/sim/faction/army.ts` and `shared/test/army.test.ts`.

## Background
Phase 8b: the faction AI moves groups of 10–40 units across the 256 × 256 map. One A* per unit is too slow and looks bad, so armies use shared **flow fields** (`shared/src/nav/flow-field.ts`: `FlowFieldCache`, `flowDirection`, `flowDistance`). Read `docs/design/AI_ARCHITECTURE.md` ("Army movement"), `shared/src/nav/flow-field.ts`, `shared/src/nav/blockers.ts` (walk-grid `version`), and in `shared/src/sim/match-sim.ts` how orders work: `e.order` (`'idle' | 'move' | 'attack' | 'attackMove' | 'hold' | 'cast'`), `e.orderX/orderY`, `e.mover.path` (list of `[x, y]` points the mover walks), `e.targetId`, `think()` (attack-move acquires targets on its own and walks with `applyMove` when its path is empty), `separate` (push-apart), `sim.factions.blockers.version`.

The army code is **plain sim logic** called once per tick by the faction brain (8b). It changes units the same way `think()` does (set `order`, `orderX/orderY`, short `mover.path`). It must not send commands.

## API (exact)
```ts
export type ArmyMode = 'gather' | 'attack' | 'retreat';
export interface ArmyGroup {
  readonly id: number;
  /** unit ids; dead or missing ids are removed by update() */
  readonly members: number[];
  mode: ArmyMode;
  targetX: number;
  targetY: number;
}
export class ArmyMover {
  constructor(sim: MatchSim, maxFields?: number);
  /** New group (members are taken out of any other group). */
  create(ids: readonly number[], mode: ArmyMode, x: number, y: number): ArmyGroup;
  setGoal(g: ArmyGroup, mode: ArmyMode, x: number, y: number): void;
  add(g: ArmyGroup, id: number): void;
  disband(g: ArmyGroup): void;
  /** Call once per tick. Moves every group a step. */
  update(): void;
  /** Mean position of the living members (writes into out), false when empty. */
  center(g: ArmyGroup, out: { x: number; y: number }): boolean;
  /** Share of living members within `radius` of the goal (0..1). */
  arrived(g: ArmyGroup, radius: number): number;
  readonly groups: readonly ArmyGroup[];
}
```

## Behaviour
- Each member samples the flow field of its group goal every 5 ticks (spread over ticks by id, not all on the same tick) and gets a short path one step ahead (`[[x + dx * 1.5, y + dy * 1.5]]`) with `order = 'move'` (`gather`, `retreat`) or `order = 'attackMove'` with `orderX/orderY` = goal (`attack`).
- `attack`: a unit that has a `targetId` fights (do not touch it). When it has none, it walks on along the field; attack-move in `think()` lets it pick targets on the way.
- `retreat`: clear `targetId`, keep walking even when hit.
- Within 3 units of the goal (or when `flowDistance` is under 3), stop giving steps: `gather`/`retreat` → `idle`; `attack` → `attackMove` toward the exact goal so `think()` finishes it.
- Flying units (`sim.isFlying(e)` or `e.stats.layer === 'air'`) ignore the field and walk straight to the goal.
- Fields: one `FlowFieldCache` shared by all groups. When `sim.factions.blockers.version` changes, bump the cache `version` so old fields are rebuilt on the next `get`.
- Not stuck: if a member did not move more than 0.5 units in 3 seconds while it should walk, give it one normal path (`applyMove` from `nav/path.ts` or what `MatchSim.moveTo` uses) to the goal and go back to field steps after it arrived or after 5 s.
- No new arrays per tick per unit in the hot loop (reuse one `{x, y}` scratch and path arrays where possible; assigning a new short path array per step every 5 ticks is acceptable).

## Tests (`shared/test/army.test.ts`)
Use a real `MatchSim` like `shared/test/faction.test.ts` (map terrain + trees, `noCamps: true`, 2 slots). Spawn 30 swordsmen and 10 archers for slot 0 near its base (`sim.spawn(entityTypeIndex('swordsman'), 0, team, color, x, y)` on walkable ground around `gameData.map.starts[0].heroSpawn`; use `nearestWalkable` from `nav/nav-grid.ts`). Check:
- `gather` to the map center (128, 128): at least 90% of the group is within 8 units of the center within 60 game seconds; no unit stands still for more than 6 s on the way.
- `attack` toward the slot-1 Town Hall: units start fighting (some `targetId` set) when they meet slot-1 units placed on the way.
- `retreat` back home: members with a target drop it and walk.
- a building placed on the path (call `sim.factions.startBuilding(...)` with enough money, or `blockers.addRect`) makes the fields rebuild (cache version changes) and the group still arrives.
- timing: average `update()` cost with 40 units walking stays under 0.2 ms per tick (print it), and the whole 60 s test runs in a few seconds.
