// Loads and checks all game data. Import `gameData` anywhere (client, server, tests).
// The JSON files are bundled at build time, so this works the same in the browser and in Node.

import abilitiesJson from '../../data/abilities.json';
import aiJson from '../../data/ai.json';
import buildingsJson from '../../data/buildings.json';
import campsJson from '../../data/camps.json';
import heroesJson from '../../data/heroes.json';
import itemsJson from '../../data/items.json';
import mapLayoutJson from '../../data/map-layout.json';
import rulesJson from '../../data/rules.json';
import shopsJson from '../../data/shops.json';
import unitsJson from '../../data/units.json';
import upgradesJson from '../../data/upgrades.json';
import type { z } from 'zod';
import {
  abilitiesSchema,
  aiSchema,
  buildingsSchema,
  campsSchema,
  heroesSchema,
  itemsSchema,
  mapLayoutSchema,
  rulesSchema,
  shopsSchema,
  unitsSchema,
  upgradesSchema,
} from './schemas';

export * from './schemas';
export { validateGameData } from './validate';

function parse<S extends z.ZodType>(name: string, schema: S, json: unknown): z.infer<S> {
  const result = schema.safeParse(json);
  if (!result.success) {
    const lines = result.error.issues.slice(0, 10).map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Bad data in shared/data/${name}.json:\n${lines.join('\n')}`);
  }
  return result.data;
}

export function loadGameData() {
  return {
    rules: parse('rules', rulesSchema, rulesJson),
    heroes: parse('heroes', heroesSchema, heroesJson).heroes,
    abilities: parse('abilities', abilitiesSchema, abilitiesJson).abilities,
    units: parse('units', unitsSchema, unitsJson).units,
    buildings: parse('buildings', buildingsSchema, buildingsJson),
    items: parse('items', itemsSchema, itemsJson).items,
    shops: parse('shops', shopsSchema, shopsJson).shops,
    camps: parse('camps', campsSchema, campsJson),
    upgrades: parse('upgrades', upgradesSchema, upgradesJson),
    ai: parse('ai', aiSchema, aiJson),
    map: parse('map-layout', mapLayoutSchema, mapLayoutJson),
  };
}

export type GameData = ReturnType<typeof loadGameData>;

/** Checked game data, loaded once. */
export const gameData: GameData = loadGameData();
