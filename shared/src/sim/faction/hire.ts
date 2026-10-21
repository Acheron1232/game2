// The hero hires soldiers with hero gold at its own production buildings (rules.json hire).
// They belong to the hero's faction (team color, Town Hall upgrades) but not to its army: no
// supply, the faction brain never moves them. MatchSim.followHired makes them follow the hero.

import { gameData } from '../../data/index';
import { entityTypeIndex, ENTITY_TYPES } from '../entity-types';
import { EventType } from '../events';
import { nearestWalkable } from '../../nav/nav-grid';
import { rectDistance } from '../stats';
import type { MatchSim, SimEntity } from '../match-sim';
import type { FactionState } from './faction';

export const HIRE = gameData.rules.hire;

/** Hero gold for one soldier of this unit type (index in units.json), null = can not be hired. */
export function hirePrice(unit: number): number | null {
  const def = gameData.units[unit];
  if (!def || def.group !== 'faction' || def.id === 'worker' || !def.cost) return null;
  return Math.round((def.cost.gold + def.cost.wood) * HIRE.priceFactor);
}

/** Supply of the soldiers this hero has now. */
export function hiredSupply(sim: MatchSim, hero: SimEntity): number {
  const f = hero.heroState ? sim.factions?.get(hero.heroState.slot) : null;
  let s = 0;
  if (f)
    for (const id of f.hired) {
      const u = sim.get(id);
      if (u?.alive && u.leaderId === hero.id) s += gameData.units.find((d) => d.id === ENTITY_TYPES[u.type])?.supply ?? 0;
    }
  return s;
}

/** A finished building of the faction that trains this unit, in use range of the hero, or null. */
export function hireBuildingInRange(sim: MatchSim, hero: SimEntity, f: FactionState, unitId: string): SimEntity | null {
  for (const id of f.buildings) {
    const b = sim.get(id);
    if (!b?.alive || !b.building?.done || !b.building.def?.trains.includes(unitId)) continue;
    const d = rectDistance(hero.mover.x, hero.mover.y, b.mover.x, b.mover.y, b.building.w, b.building.h) - hero.stats.radius;
    if (d <= HIRE.useRange) return b;
  }
  return null;
}

/**
 * Why the server refuses to hire this unit now (null = fine): 'unit' (not for hire, or not a
 * player's hero), 'dead', 'range', 'needs' (faction tech), 'limit' (too many soldiers), 'gold'.
 */
export function hireProblem(sim: MatchSim, hero: SimEntity, unit: number): string | null {
  const price = hirePrice(unit);
  // Only player heroes hire (the faction's own hero has its own army).
  const f = hero.heroState ? sim.factions?.get(hero.heroState.slot) : null;
  if (price === null || !f || f.defeated) return 'unit';
  if (!hero.alive) return 'dead';
  const def = gameData.units[unit]!;
  if (!hireBuildingInRange(sim, hero, f, def.id)) return 'range';
  if (sim.factions!.missing(f, def.requires).length) return 'needs';
  if (hiredSupply(sim, hero) + (def.supply ?? 0) > HIRE.maxSupply) return 'limit';
  if (hero.heroState!.gold < price) return 'gold';
  return null;
}

/** Pays and spawns the soldier next to the building (already checked with hireProblem). */
export function hire(sim: MatchSim, hero: SimEntity, unit: number): SimEntity {
  const def = gameData.units[unit]!;
  const f = sim.factions!.get(hero.heroState!.slot)!;
  const b = hireBuildingInRange(sim, hero, f, def.id)!;
  hero.heroState!.gold -= hirePrice(unit)!;
  // Out on the hero's side of the building.
  const dx = hero.mover.x - b.mover.x,
    dy = hero.mover.y - b.mover.y;
  const d = Math.hypot(dx, dy) || 1;
  const p = nearestWalkable(
    sim.nav,
    b.mover.x + (dx / d) * (b.building!.w / 2 + 1),
    b.mover.y + (dy / d) * (b.building!.h / 2 + 1),
    10,
  ) ?? [hero.mover.x, hero.mover.y];
  const u = sim.spawn(entityTypeIndex(def.id), f.slot, f.team, f.color, p[0], p[1]);
  u.leaderId = hero.id;
  u.hired = true;
  f.hired.add(u.id);
  sim.applyFactionStats(u);
  sim.events.push(EventType.Trained, u.id, b.id);
  return u;
}
