// Game rules as plain functions: hero stats per level, damage math, XP and gold rules.
// All numbers come from shared/data (rules.json, heroes.json, units.json).

import { gameData, type BuildingDef, type HeroDef, type ItemStatKey, type UnitDef } from '../data/index';

const R = gameData.rules;

export type ArmorType = 'unarmored' | 'light' | 'medium' | 'heavy' | 'fortified' | 'hero';
export type AttackType = 'normal' | 'pierce' | 'siege' | 'magic' | 'hero';
export type Layer = 'ground' | 'lowAir' | 'air';

/** Everything combat needs about a unit. Items and buffs are added on top (Phase 7b/7c). */
export interface CombatStats {
  maxHp: number;
  maxMana: number;
  hpRegen: number;
  manaRegen: number;
  armor: number;
  armorType: ArmorType;
  attackType: AttackType;
  damageMin: number;
  damageMax: number;
  /** seconds between attacks, after attack speed */
  attackCooldown: number;
  attackRange: number;
  /** 0 = melee (instant hit) */
  projectileSpeed: number;
  canHitAir: boolean;
  moveSpeed: number;
  layer: Layer;
  radius: number;
  sight: number;
  level: number;
}

export interface Attributes {
  strength: number;
  agility: number;
  intelligence: number;
}

/** Hero attributes at a level, rounded down like in the design tables. */
export function heroAttributes(h: HeroDef, level: number): Attributes {
  const at = (k: keyof Attributes) => Math.floor(h.attributes[k][0] + h.attributes[k][1] * (level - 1));
  return { strength: at('strength'), agility: at('agility'), intelligence: at('intelligence') };
}

/** Hero stats at a level. `bonus` is what items add (attributes count like the hero's own). */
export function heroStats(h: HeroDef, level: number, bonus: Partial<Record<ItemStatKey, number>> = {}): CombatStats {
  const base = heroAttributes(h, level);
  const a: Attributes = {
    strength: base.strength + (bonus.strength ?? 0),
    agility: base.agility + (bonus.agility ?? 0),
    intelligence: base.intelligence + (bonus.intelligence ?? 0),
  };
  const hb = R.heroBase,
    at = R.attributes;
  const main = a[h.mainStat];
  const melee = h.attackRange <= 2;
  const damage = main * at.mainStatDamagePerPoint + (bonus.damage ?? 0);
  const attackSpeedPct = a.agility * at.agility.attackSpeedPctPerPoint + (bonus.attackSpeedPct ?? 0);
  return {
    maxHp: hb.hp + h.hpBonus + a.strength * at.strength.hpPerPoint + (bonus.maxHp ?? 0),
    maxMana: hb.mana + a.intelligence * at.intelligence.manaPerPoint,
    hpRegen: hb.hpRegen + a.strength * at.strength.hpRegenPerPoint + (bonus.hpRegen ?? 0),
    manaRegen: hb.manaRegen + a.intelligence * at.intelligence.manaRegenPerPoint + (bonus.manaRegen ?? 0),
    armor: h.baseArmor + a.agility * at.agility.armorPerPoint + (bonus.armor ?? 0),
    armorType: 'hero',
    attackType: 'hero',
    damageMin: h.baseDamage[0] + damage,
    damageMax: h.baseDamage[1] + damage,
    attackCooldown: h.attackCooldown / (1 + attackSpeedPct / 100),
    attackRange: h.attackRange,
    projectileSpeed: melee ? 0 : h.projectileSpeed,
    canHitAir: !melee,
    moveSpeed: h.moveSpeed + (bonus.moveSpeed ?? 0),
    layer: h.movementLayer as Layer,
    radius: hb.collisionRadius,
    sight: hb.sightRange,
    level,
  };
}

export function unitStats(u: UnitDef): CombatStats {
  return {
    maxHp: u.hp,
    maxMana: u.mana,
    hpRegen: u.group === 'neutral' ? 0.5 : 0.25,
    manaRegen: u.mana > 0 ? 0.5 : 0,
    armor: u.armor,
    armorType: u.armorType as ArmorType,
    attackType: u.attackType as AttackType,
    damageMin: u.damage[0],
    damageMax: u.damage[1],
    attackCooldown: u.attackCooldown,
    attackRange: u.attackRange,
    projectileSpeed: u.projectileSpeed,
    canHitAir: u.canHit.includes('air'),
    moveSpeed: u.moveSpeed,
    layer: u.movementLayer as Layer,
    radius: u.collisionRadius,
    sight: u.sight,
    level: u.level,
  };
}

/** A faction building: does not move; only buildings with `attack` (Watchtower) shoot. */
export function buildingStats(b: BuildingDef): CombatStats {
  const a = b.attack;
  return {
    maxHp: b.hp,
    maxMana: 0,
    hpRegen: 0,
    manaRegen: 0,
    armor: b.armor,
    armorType: b.armorType as ArmorType,
    attackType: (a?.attackType ?? 'normal') as AttackType,
    damageMin: a?.damage[0] ?? 0,
    damageMax: a?.damage[1] ?? 0,
    attackCooldown: a?.attackCooldown ?? 1,
    attackRange: a?.attackRange ?? 0,
    projectileSpeed: a?.projectileSpeed ?? 0,
    canHitAir: a ? a.canHit.includes('air') : false,
    moveSpeed: 0,
    layer: 'ground',
    radius: Math.min(b.footprint[0], b.footprint[1]) / 2,
    sight: b.sight,
    level: b.tier,
  };
}

/** The gold mine: a neutral rock that can not be hurt. */
export function mineStats(footprint: [number, number]): CombatStats {
  return {
    maxHp: 1,
    maxMana: 0,
    hpRegen: 0,
    manaRegen: 0,
    armor: 0,
    armorType: 'fortified',
    attackType: 'normal',
    damageMin: 0,
    damageMax: 0,
    attackCooldown: 1,
    attackRange: 0,
    projectileSpeed: 0,
    canHitAir: false,
    moveSpeed: 0,
    layer: 'ground',
    radius: Math.min(footprint[0], footprint[1]) / 2,
    sight: 0,
    level: 1,
  };
}

/** Distance from a point to the edge of a center-based rectangle (0 inside). */
export function rectDistance(px: number, py: number, cx: number, cy: number, w: number, h: number): number {
  const dx = Math.max(0, Math.abs(px - cx) - w / 2),
    dy = Math.max(0, Math.abs(py - cy) - h / 2);
  return Math.hypot(dx, dy);
}

/** Part of attack damage that armor lets through. Negative armor makes damage bigger. */
export function armorFactor(armor: number): number {
  if (armor >= 0) return 1 - (0.06 * armor) / (1 + 0.06 * armor);
  return 2 - Math.pow(0.94, -armor);
}

export function typeFactor(attack: AttackType, armor: ArmorType): number {
  return (R.damageTable.attackTypes as Record<string, Record<string, number>>)[attack]?.[armor] ?? 1;
}

/** Attack damage after armor and damage type. */
export function attackDamage(raw: number, attack: AttackType, targetArmorType: ArmorType, targetArmor: number): number {
  return raw * typeFactor(attack, targetArmorType) * armorFactor(targetArmor);
}

/** Spell damage ignores armor; heroes take 75%. */
export function spellDamage(raw: number, targetIsHero: boolean): number {
  return raw * (targetIsHero ? 0.75 : 1);
}

/** Melee can not hit units in the `air` layer; low air (Sky Dragon) can be hit by everyone. */
export function canAttackLayer(attackerCanHitAir: boolean, targetLayer: Layer): boolean {
  return targetLayer !== 'air' || attackerCanHitAir;
}

// ---------- experience and gold ----------

const XP_TABLE = R.experience.totalXpForLevel;
export const MAX_LEVEL = R.heroBase.maxLevel;

export function levelForXp(xp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && xp >= XP_TABLE[level]!) level++;
  return level;
}

export function xpForLevel(level: number): number {
  return XP_TABLE[Math.min(MAX_LEVEL, Math.max(1, level)) - 1]!;
}

export function xpForKillingUnit(level: number): number {
  const t = R.experience.xpForKillingUnitOfLevel;
  return t[Math.min(t.length, Math.max(1, Math.round(level))) - 1]!;
}

export function xpForKillingHero(victimLevel: number): number {
  const x = R.experience.xpForKillingHero;
  return x.base + x.perVictimLevel * (victimLevel - 1);
}

/** Share of XP from neutral monsters a hero of this level gets. */
export function neutralXpFactor(heroLevel: number): number {
  let f = 1;
  for (const [from, factor] of Object.entries(R.experience.neutralXpFactorByHeroLevel)) if (heroLevel >= Number(from)) f = factor;
  return f;
}

export function heroKillBounty(victimLevel: number): number {
  return R.gold.heroKillBounty.base + R.gold.heroKillBounty.perVictimLevel * victimLevel;
}

export function deathGoldLoss(level: number): number {
  return R.gold.deathGoldLossPerLevel * level;
}

export function respawnSeconds(level: number): number {
  return R.respawn.heroBaseSec + R.respawn.heroPerLevelSec * level;
}

/** Skill points: one per level. Basic level N needs hero level 2N-1, the ultimate needs 6. */
export function canLearn(slot: number, currentLevel: number, maxLevel: number, heroLevel: number): boolean {
  if (currentLevel >= maxLevel) return false;
  if (slot === 3) return heroLevel >= 6;
  return heroLevel >= 2 * (currentLevel + 1) - 1;
}
