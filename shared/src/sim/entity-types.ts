// Network type ids for entities: heroes first, then units, in data file order.
// Both sides build the same list from the same data, so a u16 index is enough on the wire.

import { gameData } from '../data/index';
import { heroStats, unitStats, type CombatStats } from './stats';

export const ENTITY_TYPES: readonly string[] = [...gameData.heroes.map((h) => h.id), ...gameData.units.map((u) => u.id)];

const INDEX = new Map(ENTITY_TYPES.map((id, i) => [id, i]));

export function entityTypeIndex(id: string): number {
  const i = INDEX.get(id);
  if (i === undefined) throw new Error(`Unknown entity type ${id}`);
  return i;
}

export function isHeroType(index: number): boolean {
  return index < gameData.heroes.length;
}

/** Move speed in game units per second, from the data files. */
export function moveSpeedOf(index: number): number {
  const id = ENTITY_TYPES[index];
  const hero = gameData.heroes.find((h) => h.id === id);
  if (hero) return hero.moveSpeed;
  return gameData.units.find((u) => u.id === id)?.moveSpeed ?? 3;
}

/** Start health of a hero (level 1) or a unit. */
export function maxHpOf(index: number): number {
  return statsOf(index).maxHp;
}

export function sightOf(index: number): number {
  return statsOf(index).sight;
}

function statsOf(index: number): CombatStats {
  const id = ENTITY_TYPES[index];
  const hero = gameData.heroes.find((h) => h.id === id);
  if (hero) return heroStats(hero, 1);
  return unitStats(gameData.units.find((u) => u.id === id)!);
}

/** Flying entities (Sky Dragon, harpies, hawk riders) ignore the walk grid. */
export function isFlyingType(index: number): boolean {
  return statsOf(index).layer !== 'ground';
}
