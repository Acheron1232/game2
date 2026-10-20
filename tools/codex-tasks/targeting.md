# Task: target choice for faction units

Write `shared/src/sim/faction/targeting.ts` and `shared/test/targeting.test.ts`.

## Background
Faction units (swordsman, archer, lancer, cleric, catapult, hawk_rider; not heroes, not workers) pick their own targets when they have none. Today `MatchSim.acquire(e, range, takeNeutrals)` in `shared/src/sim/match-sim.ts` simply takes the nearest enemy. Phase 8b wants smarter choices for faction units. Read `docs/design/AI_ARCHITECTURE.md` ("Target priority"), `docs/design/FACTION.md`, and `shared/data/ai.json` (`faction.difficulties.*.focusFire`, `targetChoice`, `faction.attack.catapultsTarget`).

Useful sim API (read `match-sim.ts`): `sim.grid.query(x, y, r, (o, d2) => ...)`, `sim.get(id)`, `sim.canSee(team, e)`, `sim.isEnemy(a, b)` (check it is public; if it is private, write your own: different team, both alive, not invulnerable), `NEUTRAL_TEAM`, `SimEntity` fields `team`, `alive`, `hp`, `stats` (`maxHp`, `layer`, `canHitAir`, `attackRange`, `radius`, `minRange` if present), `targetId`, `building` (a `BuildingState`, `building.def` null for gold mines), `invulnerable`, `hidden`, `hero`, `type`. `ENTITY_TYPES[e.type]` gives the id string (e.g. `'watchtower'`, `'catapult'`). `canAttackLayer` is in `stats.ts`. Gold mines (`building` set, `building.def === null`) and invulnerable or hidden entities are never targets.

## API (exact)
```ts
export interface TargetRules {
  /** normal / hard: prefer the enemy with the least health in range */
  focusFire: boolean;
  /** neutral monsters are allowed (attack-move), else only monsters that already fight our team */
  takeNeutrals: boolean;
}
/** Best target id for a faction unit within `range` (edge distance), or 0. Same inputs, same answer. */
export function pickTarget(sim: MatchSim, e: SimEntity, range: number, rules: TargetRules): number;
/** Score used by pickTarget (exported for tests): higher is better, -Infinity = not allowed. */
export function targetScore(sim: MatchSim, e: SimEntity, o: SimEntity, d2: number, rules: TargetRules): number;
```

## Rules, in order of weight
1. Not allowed: self, own team, dead, invulnerable, hidden, gold mines, a layer this unit can not hit (`canAttackLayer`), and neutrals unless `takeNeutrals` or the neutral already targets our team.
2. **Catapults** (`'catapult'`): buildings first, watchtowers before other buildings; units only when no building is in range. Never pick a target closer than their minimum range if the stats have one (check `unitStats` / units.json for a `minRange` field; if there is none, skip this part).
3. Everybody else: an enemy that is attacking us (its `targetId` is this unit or a unit of our team) beats one that is not. Units beat buildings (except catapults, see 2). Watchtowers beat other buildings.
4. With `focusFire`: among the same class, lower health (absolute hp) wins. Without it: nearest wins.
5. Ties: nearest, then lower entity id.
Keep it simple and fast: one `grid.query`, no arrays created per call (reuse module-level scratch values if needed).

## Tests (`shared/test/targeting.test.ts`)
Build a small `MatchSim` like `shared/test/faction.test.ts` does (real map, `{ terrain, trees }` world, `noCamps: true`), then spawn units with `sim.spawn(type, owner, team, color, x, y)` near each other (open ground near a start spot). Check:
- a catapult picks a watchtower over a swordsman next to it, and a watchtower over a house;
- a swordsman picks the enemy archer that hits it over a closer idle enemy;
- with focusFire the weaker of two enemies is chosen, without it the nearest;
- neutrals are skipped unless `takeNeutrals`, mines and invulnerable entities are never picked;
- an archer (can hit air) may pick a hawk_rider, a swordsman may not.
- timing: 2,000 calls with 60 units around take under 20 ms (print the time).
