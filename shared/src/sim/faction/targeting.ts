// How faction units pick a target: units that attack us first, catapults go for buildings
// (towers first), focus fire on the weakest when the difficulty allows it.
// Written by Codex for Phase 8b (task: tools/codex-tasks/targeting.md).

import { gameData } from '../../data/index';
import { hiddenFrom } from '../buffs';
import { ENTITY_TYPES, footprintOf, isBuildingType, statsOf } from '../entity-types';
import { NEUTRAL_TEAM, type MatchSim, type SimEntity } from '../match-sim';
import { canAttackLayer, rectDistance } from '../stats';

export interface TargetRules {
  /** normal / hard: prefer the enemy with the least health in range */
  focusFire: boolean;
  /** neutral monsters are allowed (attack-move), else only monsters that already fight our team */
  takeNeutrals: boolean;
}

const CATAPULT_TYPE = ENTITY_TYPES.indexOf('catapult');
const WATCHTOWER_TYPE = ENTITY_TYPES.indexOf('watchtower');
const catapultDef = gameData.units.find((unit) => unit.id === 'catapult') as
  ((typeof gameData.units)[number] & { minRange?: number }) | undefined;
const CATAPULT_MIN_RANGE = catapultDef?.minRange ?? 0;

let maxTargetExtent = 0;
for (let type = 0; type < ENTITY_TYPES.length; type++) {
  let extent = statsOf(type).radius;
  if (isBuildingType(type)) {
    const [w, h] = footprintOf(type);
    extent = Math.hypot(w, h) * 0.5;
  }
  if (extent > maxTargetExtent) maxTargetExtent = extent;
}

let querySim: MatchSim;
let queryEntity: SimEntity;
let queryRange = 0;
let queryRules: TargetRules;
let bestId = 0;
let bestScore = -Infinity;
let bestDistance = Infinity;

function edgeDistance(e: SimEntity, o: SimEntity, d2: number): number {
  const distance = o.building
    ? rectDistance(e.mover.x, e.mover.y, o.mover.x, o.mover.y, o.building.w, o.building.h) - e.stats.radius
    : Math.sqrt(d2) - e.stats.radius - o.stats.radius;
  return distance > 0 ? distance : 0;
}

function attacksOurTeam(sim: MatchSim, e: SimEntity, o: SimEntity): boolean {
  if (!o.targetId) return false;
  const target = sim.get(o.targetId);
  return !!target && target.team === e.team;
}

function priorityClass(sim: MatchSim, e: SimEntity, o: SimEntity): number {
  const building = !!o.building;
  const tower = building && o.type === WATCHTOWER_TYPE;
  if (e.type === CATAPULT_TYPE) {
    if (!building) return 0;
    return tower ? 2 : 1;
  }
  const targetKind = building ? (tower ? 1 : 0) : 2;
  return targetKind + (attacksOurTeam(sim, e, o) ? 3 : 0);
}

/** Score used by pickTarget (exported for tests): higher is better, -Infinity = not allowed. */
export function targetScore(sim: MatchSim, e: SimEntity, o: SimEntity, d2: number, rules: TargetRules): number {
  if (
    o === e ||
    !o.alive ||
    o.team === e.team ||
    o.invulnerable ||
    o.hidden ||
    (o.building && !o.building.def) ||
    !canAttackLayer(e.stats.canHitAir, o.stats.layer) ||
    hiddenFrom(o, e.team) ||
    !sim.canSee(e.team, o)
  )
    return -Infinity;

  if (o.team === NEUTRAL_TEAM && !rules.takeNeutrals && !attacksOurTeam(sim, e, o)) return -Infinity;

  const distance = edgeDistance(e, o, d2);
  if (e.type === CATAPULT_TYPE && distance < CATAPULT_MIN_RANGE) return -Infinity;

  const priority = priorityClass(sim, e, o);
  return rules.focusFire ? priority + 1 / (2 + Math.max(0, o.hp)) : priority + 1 / (2 + distance);
}

function considerTarget(o: SimEntity, d2: number): void {
  const score = targetScore(querySim, queryEntity, o, d2, queryRules);
  if (score === -Infinity) return;
  const distance = edgeDistance(queryEntity, o, d2);
  if (distance > queryRange) return;
  if (score < bestScore) return;
  if (score === bestScore && (distance > bestDistance || (distance === bestDistance && o.id >= bestId))) return;
  bestId = o.id;
  bestScore = score;
  bestDistance = distance;
}

/** Best target id for a faction unit within `range` (edge distance), or 0. Same inputs, same answer. */
export function pickTarget(sim: MatchSim, e: SimEntity, range: number, rules: TargetRules): number {
  querySim = sim;
  queryEntity = e;
  queryRange = range;
  queryRules = rules;
  bestId = 0;
  bestScore = -Infinity;
  bestDistance = Infinity;
  sim.grid.query(e.mover.x, e.mover.y, range + e.stats.radius + maxTargetExtent, considerTarget);
  return bestId;
}
