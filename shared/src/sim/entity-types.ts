// Network type ids for entities: heroes, units, faction buildings, then the gold mine, in data
// file order. Both sides build the same list from the same data, so a u16 index is enough.

import { gameData, type BuildingDef } from '../data/index';
import { buildingStats, heroStats, mineStats, unitStats, type CombatStats, type Layer } from './stats';

export const GOLD_MINE = 'gold_mine';

export const ENTITY_TYPES: readonly string[] = [
  ...gameData.heroes.map((h) => h.id),
  ...gameData.units.map((u) => u.id),
  ...gameData.buildings.buildings.map((b) => b.id),
  GOLD_MINE,
];

const INDEX = new Map(ENTITY_TYPES.map((id, i) => [id, i]));
const FIRST_BUILDING = gameData.heroes.length + gameData.units.length;
const LAYERS: readonly Layer[] = [...gameData.heroes, ...gameData.units].map((e) => e.movementLayer as Layer);

/** Faction buildings and the gold mine. */
export function isBuildingType(index: number): boolean {
  return index >= FIRST_BUILDING;
}

export function isMineType(index: number): boolean {
  return ENTITY_TYPES[index] === GOLD_MINE;
}

/** Data of a faction building, undefined for other types (and the mine). */
export function buildingDefOf(index: number): BuildingDef | undefined {
  return index >= FIRST_BUILDING ? gameData.buildings.buildings[index - FIRST_BUILDING] : undefined;
}

/** Footprint [width, depth] of a building or the mine, in game units. */
export function footprintOf(index: number): [number, number] {
  const def = buildingDefOf(index);
  if (def) return [def.footprint[0], def.footprint[1]];
  const mine = gameData.buildings.neutralBuildings.find((b) => b.id === GOLD_MINE);
  return mine ? [mine.footprint[0], mine.footprint[1]] : [3, 3];
}

export function layerOf(index: number): Layer {
  return LAYERS[index] ?? 'ground';
}

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
  if (isBuildingType(index)) return 0;
  return gameData.units.find((u) => u.id === id)?.moveSpeed ?? 3;
}

/** Start health of a hero (level 1) or a unit. */
export function maxHpOf(index: number): number {
  return statsOf(index).maxHp;
}

export function sightOf(index: number): number {
  return statsOf(index).sight;
}

export function statsOf(index: number): CombatStats {
  const id = ENTITY_TYPES[index];
  const hero = gameData.heroes.find((h) => h.id === id);
  if (hero) return heroStats(hero, 1);
  const def = buildingDefOf(index);
  if (def) return buildingStats(def);
  if (id === GOLD_MINE) return mineStats(footprintOf(index));
  return unitStats(gameData.units.find((u) => u.id === id)!);
}

/** Flying entities (Sky Dragon, harpies, hawk riders) ignore the walk grid. */
export function isFlyingType(index: number): boolean {
  return layerOf(index) !== 'ground';
}
