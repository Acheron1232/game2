// Shapes of the JSON files in shared/data/. Loading checks every file against these,
// so a typo in a data file fails at startup, not in the middle of a match.
// Extra fields are kept (looseObject), so design notes in the JSON do not break loading.

import { z } from 'zod';

const num = z.number();
const pair = z.tuple([num, num]);
/** Same value at every level, or one value per level. */
const perLevel = z.union([num, z.array(num)]);
const id = z.string().regex(/^[a-z0-9_]+$/, 'ids use lower_snake_case');

export const armorTypes = ['unarmored', 'light', 'medium', 'heavy', 'fortified', 'hero'] as const;
export const attackTypes = ['normal', 'pierce', 'siege', 'magic', 'hero'] as const;
export const movementLayers = ['ground', 'lowAir', 'air'] as const;

const armorType = z.enum(armorTypes);
const attackType = z.enum(attackTypes);
const movementLayer = z.enum(movementLayers);
const cost = z.object({ gold: num, wood: num });

export const rulesSchema = z.looseObject({
  version: num,
  simulation: z.looseObject({ tickRate: num, aiFactionThinkRate: num, heroBotThinkRate: num, navCellSize: num, flowFieldCellSize: num }),
  match: z.looseObject({ maxSlots: num, reconnectWindowSec: num }),
  attributes: z.looseObject({
    strength: z.object({ hpPerPoint: num, hpRegenPerPoint: num }),
    agility: z.object({ armorPerPoint: num, attackSpeedPctPerPoint: num }),
    intelligence: z.object({ manaPerPoint: num, manaRegenPerPoint: num }),
    mainStatDamagePerPoint: num,
  }),
  heroBase: z.looseObject({
    hp: num,
    mana: num,
    hpRegen: num,
    manaRegen: num,
    maxLevel: num,
    itemSlots: num,
    sightRange: num,
    collisionRadius: num,
  }),
  experience: z.looseObject({
    totalXpForLevel: z.array(num),
    xpForKillingUnitOfLevel: z.array(num),
    xpForKillingHero: z.object({ base: num, perVictimLevel: num }),
    shareRange: num,
    neutralXpFactorByHeroLevel: z.record(z.string(), num),
  }),
  gold: z.looseObject({
    startGold: num,
    passiveIncomePerSec: num,
    heroKillBounty: z.object({ base: num, perVictimLevel: num }),
    assistShare: num,
    assistRange: num,
    deathGoldLossPerLevel: num,
    sellFactor: num,
  }),
  respawn: z.looseObject({ heroBaseSec: num, heroPerLevelSec: num }),
  combat: z.looseObject({ meleeRange: num, attackPointFraction: num, missChanceUphill: num, airLayers: z.record(z.string(), z.string()) }),
  damageTable: z.looseObject({ armorTypes: z.array(armorType), attackTypes: z.record(attackType, z.record(armorType, num)) }),
  economy: z.looseObject({
    factionStartGold: num,
    factionStartWood: num,
    goldPerTrip: num,
    woodPerTrip: num,
    maxWorkersPerMine: num,
    supplyCap: num,
  }),
  neutrals: z.looseObject({ aggroRange: num, leashRange: num, returnHealPctPerSec: num, respawnNeedsNoHeroInRange: num }),
  fountain: z.looseObject({ hpPctPerSec: num, manaPctPerSec: num }),
});

const attributeSchema = z.tuple([num, num]);
export const heroSchema = z.looseObject({
  id,
  name: z.string(),
  role: z.string(),
  hotkeyOrder: num,
  mainStat: z.enum(['strength', 'agility', 'intelligence']),
  attributes: z.object({ strength: attributeSchema, agility: attributeSchema, intelligence: attributeSchema }),
  baseDamage: pair,
  baseArmor: num,
  attackCooldown: num,
  attackRange: num,
  projectileSpeed: num,
  moveSpeed: num,
  movementLayer,
  hpBonus: num,
  abilities: z.tuple([id, id, id, id]),
  look: z.looseObject({ silhouette: z.string(), palette: z.string(), teamColorParts: z.string(), scale: num }),
});
export const heroesSchema = z.looseObject({ version: num, heroes: z.array(heroSchema) });

export const abilitySchema = z.looseObject({
  id,
  hero: id,
  slot: z.enum(['Q', 'W', 'E', 'R']),
  name: z.string(),
  text: z.string(),
  kind: z.enum(['active', 'passive', 'aura']),
  target: z.enum(['none', 'unit', 'point', 'line', 'cone']),
  filter: z.array(z.string()),
  maxLevel: num,
  castTime: num,
  castRange: perLevel,
  manaCost: perLevel,
  cooldown: perLevel,
  params: z.record(z.string(), z.union([perLevel, z.string(), z.boolean()])),
});
export const abilitiesSchema = z.looseObject({ version: num, abilities: z.array(abilitySchema) });

const skillSchema = z.looseObject({ id });
export const unitSchema = z.looseObject({
  id,
  name: z.string(),
  group: z.enum(['faction', 'neutral', 'summon']),
  level: num,
  hp: num,
  mana: num,
  armor: num,
  armorType,
  attackType,
  damage: pair,
  attackCooldown: num,
  attackRange: num,
  projectileSpeed: num,
  canHit: z.array(z.enum(['ground', 'air'])),
  moveSpeed: num,
  movementLayer,
  sight: num,
  collisionRadius: num,
  cost: cost.optional(),
  supply: num.optional(),
  buildTime: num.optional(),
  trainedAt: id.optional(),
  requires: z.array(id).optional(),
  bounty: pair,
  skills: z.array(skillSchema),
});
export const unitsSchema = z.looseObject({ version: num, units: z.array(unitSchema) });

export const buildingSchema = z.looseObject({
  id,
  name: z.string(),
  tier: num,
  hp: num,
  armor: num,
  armorType,
  cost,
  buildTime: num,
  footprint: pair,
  supplyGiven: num,
  trains: z.array(id),
  requires: z.array(id),
  upgradesTo: id.nullable(),
  sight: num,
  bounty: num,
  attack: z
    .looseObject({
      attackType,
      damage: pair,
      attackCooldown: num,
      attackRange: num,
      projectileSpeed: num,
      canHit: z.array(z.enum(['ground', 'air'])),
    })
    .optional(),
});
export const buildingsSchema = z.looseObject({
  version: num,
  buildings: z.array(buildingSchema),
  neutralBuildings: z.array(z.looseObject({ id, name: z.string(), footprint: pair })),
});

export const itemSchema = z.looseObject({
  id,
  name: z.string(),
  tier: z.enum(['consumable', 'basic', 'advanced', 'rare']),
  cost: num.nullable(),
  value: num,
  text: z.string(),
  unique: z.boolean().optional(),
  charges: num.optional(),
  stackMax: num.optional(),
  stats: z.record(z.string(), num).optional(),
  active: z.looseObject({ target: z.enum(['none', 'unit', 'point']), cooldown: num }).optional(),
});
export const itemsSchema = z.looseObject({ version: num, items: z.array(itemSchema) });

export const shopsSchema = z.looseObject({
  version: num,
  shops: z.array(z.looseObject({ id, name: z.string(), useRange: num, items: z.array(id) })),
});

export const campsSchema = z.looseObject({
  version: num,
  campTypes: z.array(
    z.looseObject({ id, tier: z.enum(['green', 'orange', 'red']), respawnSec: num, monsters: z.array(z.tuple([id, num])), dropTable: id }),
  ),
  dropTables: z.record(z.string(), z.looseObject({ dropChancePct: num, items: z.array(z.tuple([id, num])) })),
});

export const upgradesSchema = z.looseObject({
  version: num,
  useRange: num,
  upgrades: z.array(
    z.looseObject({
      id,
      name: z.string(),
      maxLevel: num,
      cost: z.array(num),
      text: z.string(),
      effect: z.looseObject({ affects: z.string() }),
      requires: z.array(z.array(id)),
      repeatable: z.boolean().optional(),
      cooldown: num.optional(),
    }),
  ),
});

const difficultyNames = z.enum(['easy', 'normal', 'hard']);
export const aiSchema = z.looseObject({
  version: num,
  faction: z.looseObject({
    difficulties: z.record(difficultyNames, z.looseObject({ thinkDelaySec: num, workerTarget: num, maxProductionBuildings: num })),
    buildOrder: z.array(z.looseObject({ do: z.enum(['build', 'train', 'upgrade', 'expand']), what: z.string(), count: num.optional() })),
    unitMix: z.record(z.string(), z.union([z.string(), z.record(id, num)])),
  }),
  heroBot: z.looseObject({
    difficulties: z.record(difficultyNames, z.looseObject({ reactionSec: num })),
    heroBuild: z.record(id, z.array(id)),
  }),
});

const point = pair;
export const mapLayoutSchema = z.looseObject({
  id,
  name: z.string(),
  version: num,
  size: z.object({ width: num, height: num }),
  border: z.looseObject({ width: num }),
  starts: z.array(z.looseObject({ id, townHall: point, heroSpawn: point, buildArea: z.object({ center: point, radius: num }) })),
  goldMines: z.array(
    z.looseObject({ id, kind: z.enum(['main', 'natural', 'corner']), pos: point, gold: num, townHallSpot: point.optional() }),
  ),
  openAreas: z.array(z.looseObject({ tag: z.string(), center: point, radius: num, ground: z.string() })),
  roads: z.array(z.looseObject({ tag: z.string(), width: num, points: z.array(point) })),
  water: z.array(z.looseObject({ tag: z.string(), center: point, radii: pair, rotationDeg: num })),
  plateaus: z.array(z.looseObject({ id, level: num, polygon: z.array(point) })),
  ramps: z.array(z.looseObject({ from: point, to: point, width: num })),
  camps: z.array(z.looseObject({ id, type: id, pos: point })),
  shops: z.array(z.looseObject({ id, type: id, pos: point })),
  fountains: z.array(z.looseObject({ id, type: id, pos: point, radius: num })),
});

export const treesSchema = z.looseObject({
  version: num,
  types: z.array(z.string()),
  trees: z.array(z.tuple([num, num, num, num])),
});

export type Rules = z.infer<typeof rulesSchema>;
export type HeroDef = z.infer<typeof heroSchema>;
export type AbilityDef = z.infer<typeof abilitySchema>;
export type UnitDef = z.infer<typeof unitSchema>;
export type BuildingDef = z.infer<typeof buildingSchema>;
export type ItemDef = z.infer<typeof itemSchema>;
export type MapLayout = z.infer<typeof mapLayoutSchema>;
