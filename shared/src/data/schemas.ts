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
  hire: z.looseObject({ priceFactor: num, maxSupply: num, useRange: num, followDistance: num, leash: num }),
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
    /** hero level needed for each level of a basic ability (Q, W, E) */
    basicAbilityHeroLevels: z.array(num).min(1),
    /** hero level needed for each level of the ultimate (R) */
    ultimateHeroLevels: z.array(num).min(1),
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
    mineTimeSec: num,
    chopTimeSec: num,
    maxWorkersPerMine: num,
    supplyCap: num,
    upkeep: z.looseObject({ steps: z.array(z.strictObject({ fromSupply: num, goldPct: num, name: z.string() })).min(1) }),
    buildingPriceRise: z.record(z.string(), z.union([z.string(), z.strictObject({ freeCount: num, pctPerExtra: num })])),
  }),
  neutrals: z.looseObject({ aggroRange: num, leashRange: num, returnHealPctPerSec: num, respawnNeedsNoHeroInRange: num }),
  items: z.looseObject({
    groundItemSec: num,
    pickUpRange: num,
    giveRange: num,
    /** highest total of an item stat a hero can have */
    caps: z.partialRecord(z.enum(['cooldownReductionPct', 'spellResistPct', 'critChancePct', 'spellDamagePct', 'healPowerPct']), num),
    /** damage of a critical hit = normal damage x this */
    critMultiplier: num,
  }),
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
  abilities: z.array(id).min(4).max(6),
  look: z.looseObject({ silhouette: z.string(), palette: z.string(), teamColorParts: z.string(), scale: num }),
});
export const heroesSchema = z.looseObject({ version: num, heroes: z.array(heroSchema) });

export const abilitySchema = z.looseObject({
  id,
  hero: id,
  slot: z.enum(['Q', 'W', 'E', 'R', 'D', 'F']),
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
/** Name and text of a unit skill (shared/data/skills.json); the numbers are on the unit. */
export const skillInfoSchema = z.looseObject({
  id,
  name: z.string(),
  kind: z.enum(['active', 'passive', 'work']),
  text: z.string(),
  /** active skills: none = around the unit, unit = one target */
  target: z.enum(['none', 'unit']).optional(),
  targets: z.enum(['enemy', 'ally']).optional(),
  /** the code that runs (abilities.ts useSkill); default: the id */
  effect: z.string().optional(),
});
export const skillsSchema = z.looseObject({ version: num, skills: z.array(skillInfoSchema) });
export const unitSchema = z.looseObject({
  id,
  name: z.string(),
  group: z.enum(['faction', 'neutral', 'summon', 'mercenary']),
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
  buildingsOnly: z.boolean().optional(),
  mechanical: z.boolean().optional(),
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
  skills: z.array(skillSchema).optional(),
  fixedFacing: num.optional(),
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
  /** Hero Shrine: the faction summons its own hero here (once; it comes back to life here) */
  heroSummon: z.object({ cost, timeSec: num }).optional(),
});
export const buildingsSchema = z.looseObject({
  version: num,
  buildings: z.array(buildingSchema),
  neutralBuildings: z.array(z.looseObject({ id, name: z.string(), footprint: pair })),
});

/** Item stat names (items.json `stats`). Attributes count like hero attributes. */
export const itemStatKeys = [
  'strength',
  'agility',
  'intelligence',
  'damage',
  'armor',
  'maxHp',
  'hpRegen',
  'manaRegen',
  'moveSpeed',
  'attackSpeedPct',
  'lifeStealPct',
  'maxMana',
  /** more spell damage dealt, percent */
  'spellDamagePct',
  /** shorter hero ability cooldowns, percent */
  'cooldownReductionPct',
  /** less spell damage taken, percent */
  'spellResistPct',
  /** stronger heals given, percent */
  'healPowerPct',
  /** chance of a critical hit, percent */
  'critChancePct',
] as const;
export type ItemStatKey = (typeof itemStatKeys)[number];

export const itemSchema = z.looseObject({
  id,
  name: z.string(),
  tier: z.enum(['consumable', 'basic', 'advanced', 'rare', 'legendary']),
  /** who it is for (shop tabs, bots): mage, warrior, tank, support, damage */
  role: z.enum(['mage', 'warrior', 'tank', 'support', 'damage']).optional(),
  /** made from these items plus a fee (cost = components + fee) */
  recipe: z.object({ components: z.array(id).min(1), fee: num }).optional(),
  /** allies within radius get these bonuses */
  aura: z
    .looseObject({
      radius: num,
      bonusArmor: num.optional(),
      hpRegen: num.optional(),
      attackSpeedPct: num.optional(),
      moveSpeedPct: num.optional(),
      damagePct: num.optional(),
    })
    .optional(),
  cost: num.nullable(),
  value: num,
  text: z.string(),
  unique: z.boolean().optional(),
  charges: num.optional(),
  stackMax: num.optional(),
  stats: z.partialRecord(z.enum(itemStatKeys), num).optional(),
  active: z
    .looseObject({
      target: z.enum(['none', 'unit', 'point']),
      cooldown: num,
      cooldownGroup: id.optional(),
      castRange: num.optional(),
      heal: num.optional(),
      restoreMana: num.optional(),
      channelTime: num.optional(),
      teleportTo: z.literal('own_town_hall').optional(),
      duration: num.optional(),
      sight: num.optional(),
      invisible: z.boolean().optional(),
      gainXp: num.optional(),
    })
    .optional(),
  onHit: z
    .looseObject({
      slowPct: num.optional(),
      duration: num.optional(),
      chancePct: num.optional(),
      chainDamage: num.optional(),
      chainTargets: num.optional(),
      chainRange: num.optional(),
    })
    .optional(),
  passive: z.looseObject({ reviveOnDeath: z.boolean(), reviveDelaySec: num, reviveHpPct: num, consumed: z.boolean() }).optional(),
});
export const itemsSchema = z.looseObject({ version: num, items: z.array(itemSchema) });

export const shopsSchema = z.looseObject({
  version: num,
  shops: z.array(
    z.looseObject({
      id,
      name: z.string(),
      useRange: num,
      items: z.array(id),
      mercenaries: z.array(id).optional(),
      mercenaryStock: z.record(id, z.object({ max: num.int().min(1).max(255), restockSec: num.positive() })).optional(),
    }),
  ),
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
    fortifications: z.object({
      startMinute: num,
      everySec: num.positive(),
      maxSegments: num.int().positive().max(12).multipleOf(2),
      gap: num.min(6).multipleOf(2),
      frontDistance: num.positive(),
      rowStep: num.positive(),
      rows: num.int().positive(),
      minGold: num,
      minWood: num,
      upgradeReserveGold: num,
      upgradeReserveWood: num,
    }),
    difficulties: z.record(difficultyNames, z.looseObject({ thinkDelaySec: num, workerTarget: num, maxProductionBuildings: num })),
    buildOrder: z.array(
      z.looseObject({ do: z.enum(['build', 'train', 'upgrade', 'expand', 'summon']), what: z.string(), count: num.optional() }),
    ),
    unitMix: z.record(z.string(), z.union([z.string(), z.record(id, num)])),
    factionHero: z.looseObject({
      roles: z.record(id, z.enum(['front', 'ranged', 'support', 'caster'])),
      score: z.looseObject({ base: num, frontNeeded: num, rangedNeeded: num, supportBigArmy: num, casterBigArmy: num, random: num }),
      frontShareWanted: num,
      bigArmySupply: num,
      followArmyFromLevel: num,
    }),
    army: z.looseObject({
      roamAtSupply: num,
      roamRadius: z.array(num),
      roamMinHpPct: num,
      campLevelPerSupply: num,
      huntRange: num,
      huntStrengthRatio: num,
      siegeRange: num,
      chaseLeash: num,
      goalLeash: num,
      groupSpread: z.record(z.enum(['melee', 'ranged', 'siege']), num),
      fieldFightMinFromBase: num,
      lateGameMinute: num,
      reinforceSupply: num,
      attackAtSupplyUsed: num,
      trainUpToSupply: num,
      pushAfterWinPct: num,
    }),
    orders: z.looseObject({
      attackMinSupply: num,
      stayHomeRange: num,
      defendExtraTowers: num,
      farmRoamRadius: num,
      heroCampRange: z.looseObject({ defend: num, build_up: num }),
    }),
  }),
  heroBot: z.looseObject({
    difficulties: z.record(difficultyNames, z.looseObject({ reactionSec: num })),
    heroBuild: z.record(id, z.array(id)),
    hiring: z.looseObject({ fromLevel: num, goldBuffer: num, maxTravel: num }),
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
