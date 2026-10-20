// Town Hall upgrades: what the hero can buy for its faction, and how the bought levels change
// faction units and buildings. All numbers from upgrades.json.
// Written by Codex for Phase 8 (task: tools/codex-tasks/upgrades.md).

import { gameData } from '../../data/index';
import type { CombatStats } from '../stats';

export type UpgradeId =
  | 'sharper_blades'
  | 'better_arrows'
  | 'iron_plates'
  | 'training_drills'
  | 'stone_walls'
  | 'siege_works'
  | 'rich_veins'
  | 'war_banner'
  | 'tier_up_fund';

export interface FactionTech {
  tier: 1 | 2 | 3;
  /** ids of finished buildings the faction has (town_hall / stronghold / citadel follow the tier rule above) */
  buildings: ReadonlySet<string>;
  levels: Readonly<Record<string, number>>;
  /** tick each repeatable upgrade is ready again */
  readyAt: Readonly<Record<string, number>>;
}

export type UpgradeProblem = 'max' | 'needs' | 'gold' | 'cooldown' | 'citadel';

export interface UpgradeStatus {
  id: UpgradeId;
  level: number;
  maxLevel: number;
  cost: number | null;
  ok: boolean;
  problem?: UpgradeProblem;
  needs: string[];
}

export type UnitCategory = 'melee' | 'ranged' | 'catapult' | 'worker' | 'tower' | 'building' | 'other';

interface UpgradeEffect {
  damagePct?: number[];
  bonusArmor?: number[];
  maxHpPct?: number[];
  moveSpeedPct?: number[];
  trainTimePct?: number[];
  gatherPct?: number[];
}

type UpgradeDef = (typeof gameData.upgrades.upgrades)[number];

const PERCENT = 100;
const UPGRADE_IDS = gameData.upgrades.upgrades.map((upgrade) => upgrade.id as UpgradeId);
const UPGRADE_BY_ID = new Map(gameData.upgrades.upgrades.map((upgrade) => [upgrade.id, upgrade]));
const BUILDING_IDS = new Set(gameData.buildings.buildings.map((building) => building.id));

function upgradeDef(id: UpgradeId): UpgradeDef {
  return UPGRADE_BY_ID.get(id)!;
}

function effect(id: UpgradeId): UpgradeEffect {
  return upgradeDef(id).effect as UpgradeEffect;
}

function levelValue(values: number[] | undefined, level: number): number {
  if (!values || level <= 0) return 0;
  return values[Math.min(level, values.length) - 1] ?? 0;
}

function hasRequirement(requirement: string, tech: FactionTech): boolean {
  if (requirement === 'town_hall') return tech.tier >= 1;
  if (requirement === 'stronghold') return tech.tier >= 2;
  if (requirement === 'citadel') return tech.tier >= 3;
  return tech.buildings.has(requirement);
}

function status(
  id: UpgradeId,
  level: number,
  maxLevel: number,
  cost: number | null,
  needs: string[],
  problem?: UpgradeProblem,
): UpgradeStatus {
  const result: UpgradeStatus = { id, level, maxLevel, cost, ok: problem === undefined, needs };
  if (problem !== undefined) result.problem = problem;
  return result;
}

export function upgradeStatus(id: UpgradeId, tech: FactionTech, heroGold: number, tick: number): UpgradeStatus {
  const upgrade = upgradeDef(id);
  const level = tech.levels[id] ?? 0;

  if (!upgrade.repeatable && level >= upgrade.maxLevel) return status(id, level, upgrade.maxLevel, null, [], 'max');

  const nextLevel = upgrade.repeatable ? 0 : level;
  const cost = upgrade.cost[nextLevel] ?? null;

  if (id === 'tier_up_fund' && tech.tier === 3) return status(id, level, upgrade.maxLevel, cost, [], 'citadel');
  if (tick < (tech.readyAt[id] ?? 0)) return status(id, level, upgrade.maxLevel, cost, [], 'cooldown');

  const needs = (upgrade.requires[nextLevel] ?? []).filter((requirement) => !hasRequirement(requirement, tech));
  if (needs.length > 0) return status(id, level, upgrade.maxLevel, cost, needs, 'needs');
  if (cost !== null && heroGold < cost) return status(id, level, upgrade.maxLevel, cost, needs, 'gold');
  return status(id, level, upgrade.maxLevel, cost, needs);
}

export function allUpgradeStatus(tech: FactionTech, heroGold: number, tick: number): UpgradeStatus[] {
  return UPGRADE_IDS.map((id) => upgradeStatus(id, tech, heroGold, tick));
}

export function unitCategory(typeId: string): UnitCategory {
  if (typeId === 'swordsman' || typeId === 'lancer' || typeId === 'hawk_rider') return 'melee';
  if (typeId === 'archer' || typeId === 'cleric') return 'ranged';
  if (typeId === 'catapult') return 'catapult';
  if (typeId === 'worker') return 'worker';
  if (typeId === 'watchtower') return 'tower';
  if (BUILDING_IDS.has(typeId)) return 'building';
  return 'other';
}

/** Faction stat effects of the bought levels (+ War Banner while active) on one unit or building. Returns a new object; base is not changed. */
export function applyUpgrades(
  base: CombatStats,
  typeId: string,
  levels: Readonly<Record<string, number>>,
  warBannerActive: boolean,
): CombatStats {
  const category = unitCategory(typeId);
  const army = category === 'melee' || category === 'ranged' || category === 'catapult';
  let damagePct = 0;
  let bonusArmor = 0;
  let maxHpPct = 0;
  let moveSpeedPct = 0;

  if (category === 'melee') damagePct += levelValue(effect('sharper_blades').damagePct, levels.sharper_blades ?? 0);
  if (category === 'ranged' || category === 'tower') damagePct += levelValue(effect('better_arrows').damagePct, levels.better_arrows ?? 0);
  if (category === 'catapult') damagePct += levelValue(effect('siege_works').damagePct, levels.siege_works ?? 0);
  if (category !== 'building' && category !== 'tower' && category !== 'other') {
    bonusArmor += levelValue(effect('iron_plates').bonusArmor, levels.iron_plates ?? 0);
  }
  if (category === 'building' || category === 'tower') {
    maxHpPct += levelValue(effect('stone_walls').maxHpPct, levels.stone_walls ?? 0);
    bonusArmor += levelValue(effect('stone_walls').bonusArmor, levels.stone_walls ?? 0);
  }
  if (warBannerActive && army) {
    const warBannerLevel = upgradeDef('war_banner').maxLevel;
    damagePct += levelValue(effect('war_banner').damagePct, warBannerLevel);
    moveSpeedPct += levelValue(effect('war_banner').moveSpeedPct, warBannerLevel);
  }

  return {
    ...base,
    maxHp: base.maxHp * (1 + maxHpPct / PERCENT),
    armor: base.armor + bonusArmor,
    damageMin: base.damageMin * (1 + damagePct / PERCENT),
    damageMax: base.damageMax * (1 + damagePct / PERCENT),
    moveSpeed: base.moveSpeed * (1 + moveSpeedPct / PERCENT),
  };
}

/** Multiplier for train time (Training Drills: -10% / -20% => 0.9 / 0.8). */
export function trainTimeFactor(levels: Readonly<Record<string, number>>): number {
  const percent = levelValue(effect('training_drills').trainTimePct, levels.training_drills ?? 0);
  return 1 + percent / PERCENT;
}

/** Multiplier for gold / wood per trip (Rich Veins). */
export function gatherFactor(levels: Readonly<Record<string, number>>): number {
  const percent = levelValue(effect('rich_veins').gatherPct, levels.rich_veins ?? 0);
  return 1 + percent / PERCENT;
}
