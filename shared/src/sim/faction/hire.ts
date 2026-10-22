// The hero hires soldiers with hero gold at its own production buildings, and mercenaries at the
// map's taverns (rules.json hire, shops.json mercenaries).
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
/** mercenaries step out this far from the tavern's center */
const TAVERN_EXIT = 3;

/**
 * Hero gold for one soldier of this unit type (index in units.json), null = can not be hired.
 * Army units cost priceFactor x their kingdom cost; tavern mercenaries have their own price.
 */
export function hirePrice(unit: number): number | null {
  const def = gameData.units[unit];
  if (!def?.cost || def.id === 'worker') return null;
  if (def.group === 'mercenary') return def.cost.gold;
  if (def.group !== 'faction') return null;
  return Math.round((def.cost.gold + def.cost.wood) * HIRE.priceFactor);
}

/** A map tavern that hires this mercenary, with the hero in its use range, or null. */
export function tavernInRange(hero: SimEntity, unitId: string): { x: number; y: number } | null {
  for (const s of gameData.map.shops) {
    const shop = gameData.shops.find((d) => d.id === s.type) as { useRange: number; mercenaries?: string[] } | undefined;
    if (!shop?.mercenaries?.includes(unitId)) continue;
    if (Math.hypot(s.pos[0] - hero.mover.x, s.pos[1] - hero.mover.y) <= shop.useRange) return { x: s.pos[0], y: s.pos[1] };
  }
  return null;
}

/**
 * The kingdom a hero hires for and buys upgrades for: a player's hero's own one (in a team match
 * both players of a team share it). A faction's own Hero Shrine hero has none (it has the army).
 */
export function heroKingdom(sim: MatchSim, hero: SimEntity): FactionState | null {
  const hs = hero.heroState;
  // A Shrine hero's command slot is not its owner's (FACTION_HERO_SLOT + owner). No value import
  // of match-sim here: it would make a module cycle.
  if (!hs || (hs.slot !== hero.owner && !sim.setup.teams)) return null;
  return sim.factions?.get(hero.owner) ?? null;
}

/** Supply of the soldiers this hero has now. */
export function hiredSupply(sim: MatchSim, hero: SimEntity): number {
  const f = heroKingdom(sim, hero);
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
  const f = heroKingdom(sim, hero);
  if (price === null || !f || f.defeated) return 'unit';
  if (!hero.alive) return 'dead';
  const def = gameData.units[unit]!;
  if (def.group === 'mercenary') {
    if (!tavernInRange(hero, def.id)) return 'range';
  } else {
    if (!hireBuildingInRange(sim, hero, f, def.id)) return 'range';
    if (sim.factions!.missing(f, def.requires).length) return 'needs';
  }
  if (hiredSupply(sim, hero) + (def.supply ?? 0) > HIRE.maxSupply) return 'limit';
  if (hero.heroState!.gold < price) return 'gold';
  return null;
}

/** Pays and spawns the soldier next to the building (already checked with hireProblem). */
export function hire(sim: MatchSim, hero: SimEntity, unit: number): SimEntity {
  const def = gameData.units[unit]!;
  const f = heroKingdom(sim, hero)!;
  // One of the faction's buildings, or a tavern (mercenaries).
  const b = def.group === 'mercenary' ? null : hireBuildingInRange(sim, hero, f, def.id);
  const at = b ? { x: b.mover.x, y: b.mover.y } : tavernInRange(hero, def.id)!;
  const half = b ? b.building!.w / 2 + 1 : TAVERN_EXIT;
  hero.heroState!.gold -= hirePrice(unit)!;
  // Out on the hero's side of the building.
  const dx = hero.mover.x - at.x,
    dy = hero.mover.y - at.y;
  const d = Math.hypot(dx, dy) || 1;
  const p = nearestWalkable(sim.nav, at.x + (dx / d) * half, at.y + (dy / d) * half, 10) ?? [hero.mover.x, hero.mover.y];
  const u = sim.spawn(entityTypeIndex(def.id), f.slot, f.team, f.color, p[0], p[1]);
  u.leaderId = hero.id;
  u.hired = true;
  f.hired.add(u.id);
  sim.applyFactionStats(u);
  if (b) sim.events.push(EventType.Trained, u.id, b.id);
  return u;
}
