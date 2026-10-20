import { describe, expect, it } from 'vitest';
import { gameData } from '../src/data/index';
import {
  allUpgradeStatus,
  applyUpgrades,
  gatherFactor,
  trainTimeFactor,
  unitCategory,
  upgradeStatus,
  type FactionTech,
  type UpgradeId,
} from '../src/sim/faction/upgrades';
import type { CombatStats } from '../src/sim/stats';

const BASE: CombatStats = {
  maxHp: 100,
  maxMana: 50,
  hpRegen: 1,
  manaRegen: 1,
  armor: 3,
  armorType: 'heavy',
  attackType: 'normal',
  damageMin: 10,
  damageMax: 20,
  attackCooldown: 1,
  attackRange: 1,
  projectileSpeed: 0,
  canHitAir: false,
  moveSpeed: 4,
  layer: 'ground',
  radius: 0.5,
  sight: 10,
  level: 1,
};

function tech(overrides: Partial<FactionTech> = {}): FactionTech {
  return {
    tier: 1,
    buildings: new Set(),
    levels: {},
    readyAt: {},
    ...overrides,
  };
}

describe('upgrade status', () => {
  it("uses every upgrade's cost per level from data", () => {
    const buildings = new Set(gameData.buildings.buildings.map((building) => building.id));

    for (const upgrade of gameData.upgrades.upgrades) {
      for (let level = 0; level < upgrade.cost.length; level++) {
        const tier = upgrade.id === 'tier_up_fund' ? 2 : 3;
        const result = upgradeStatus(upgrade.id as UpgradeId, tech({ tier, buildings, levels: { [upgrade.id]: level } }), Infinity, 0);
        expect(result.cost, `${upgrade.id} level ${level + 1}`).toBe(upgrade.cost[level]);
      }
    }
  });

  it('returns every upgrade in data order', () => {
    expect(allUpgradeStatus(tech(), Infinity, 0).map((entry) => entry.id)).toEqual(gameData.upgrades.upgrades.map((upgrade) => upgrade.id));
  });

  it('checks needs, tier needs, gold, citadel, cooldown, and max in order', () => {
    expect(upgradeStatus('sharper_blades', tech(), Infinity, 0)).toMatchObject({ problem: 'needs', needs: ['forge'] });
    expect(
      upgradeStatus('sharper_blades', tech({ buildings: new Set(['forge']), levels: { sharper_blades: 1 } }), Infinity, 0),
    ).toMatchObject({ problem: 'needs', needs: ['stronghold'] });
    expect(
      upgradeStatus('sharper_blades', tech({ tier: 2, buildings: new Set(['forge']), levels: { sharper_blades: 1 } }), 249, 0),
    ).toMatchObject({ problem: 'gold', needs: [] });
    expect(upgradeStatus('tier_up_fund', tech({ tier: 3, readyAt: { tier_up_fund: 100 } }), Infinity, 0).problem).toBe('citadel');
    expect(upgradeStatus('war_banner', tech({ readyAt: { war_banner: 100 } }), Infinity, 99).problem).toBe('cooldown');
    expect(upgradeStatus('sharper_blades', tech({ levels: { sharper_blades: 3 } }), 0, 0)).toMatchObject({
      problem: 'max',
      cost: null,
    });
  });

  it('allows repeatable upgrades after their first use when ready', () => {
    expect(upgradeStatus('war_banner', tech({ levels: { war_banner: 1 }, readyAt: { war_banner: 10 } }), 200, 10)).toMatchObject({
      ok: true,
      cost: 200,
    });
  });
});

describe('upgrade stat effects', () => {
  it('classifies faction units and buildings', () => {
    expect(unitCategory('swordsman')).toBe('melee');
    expect(unitCategory('archer')).toBe('ranged');
    expect(unitCategory('catapult')).toBe('catapult');
    expect(unitCategory('worker')).toBe('worker');
    expect(unitCategory('watchtower')).toBe('tower');
    expect(unitCategory('barracks')).toBe('building');
    expect(unitCategory('grey_wolf')).toBe('other');
  });

  it('applies Sharper Blades level 2 only to melee units', () => {
    const levels = { sharper_blades: 2 };
    expect(applyUpgrades(BASE, 'swordsman', levels, false)).toMatchObject({ damageMin: 12, damageMax: 24 });
    expect(applyUpgrades(BASE, 'archer', levels, false)).toMatchObject({ damageMin: 10, damageMax: 20 });
    expect(applyUpgrades(BASE, 'catapult', levels, false)).toMatchObject({ damageMin: 10, damageMax: 20 });
  });

  it('applies Better Arrows to archers and Watchtowers', () => {
    const levels = { better_arrows: 1 };
    expect(applyUpgrades(BASE, 'archer', levels, false).damageMax).toBeCloseTo(22);
    expect(applyUpgrades(BASE, 'watchtower', levels, false).damageMax).toBeCloseTo(22);
    expect(applyUpgrades(BASE, 'swordsman', levels, false).damageMax).toBe(20);
  });

  it('applies Iron Plates to units but not buildings', () => {
    const levels = { iron_plates: 2 };
    expect(applyUpgrades(BASE, 'lancer', levels, false).armor).toBe(7);
    expect(applyUpgrades(BASE, 'worker', levels, false).armor).toBe(7);
    expect(applyUpgrades(BASE, 'barracks', levels, false).armor).toBe(3);
  });

  it('applies Stone Walls to buildings and towers', () => {
    const levels = { stone_walls: 2 };
    expect(applyUpgrades(BASE, 'barracks', levels, false)).toMatchObject({ maxHp: 140, armor: 7 });
    expect(applyUpgrades(BASE, 'watchtower', levels, false)).toMatchObject({ maxHp: 140, armor: 7 });
    expect(applyUpgrades(BASE, 'lancer', levels, false)).toMatchObject({ maxHp: 100, armor: 3 });
  });

  it('applies Siege Works only to catapults', () => {
    const levels = { siege_works: 2 };
    expect(applyUpgrades(BASE, 'catapult', levels, false).damageMax).toBe(28);
    expect(applyUpgrades(BASE, 'swordsman', levels, false).damageMax).toBe(20);
    expect(applyUpgrades(BASE, 'watchtower', levels, false).damageMax).toBe(20);
  });

  it('applies an active War Banner only to army units', () => {
    expect(applyUpgrades(BASE, 'swordsman', {}, true)).toMatchObject({ damageMin: 11.5, damageMax: 23, moveSpeed: 4.4 });
    expect(applyUpgrades(BASE, 'catapult', {}, true)).toMatchObject({ damageMin: 11.5, damageMax: 23, moveSpeed: 4.4 });
    expect(applyUpgrades(BASE, 'worker', {}, true)).toMatchObject({ damageMin: 10, damageMax: 20, moveSpeed: 4 });
    expect(applyUpgrades(BASE, 'swordsman', {}, false)).toMatchObject({ damageMin: 10, damageMax: 20, moveSpeed: 4 });
  });

  it('returns a new object without changing the base stats', () => {
    const result = applyUpgrades(BASE, 'swordsman', { sharper_blades: 1 }, false);
    expect(result).not.toBe(BASE);
    expect(BASE.damageMin).toBe(10);
  });
});

describe('economy factors', () => {
  it('reads Training Drills levels from data', () => {
    expect(trainTimeFactor({})).toBe(1);
    expect(trainTimeFactor({ training_drills: 1 })).toBe(0.9);
    expect(trainTimeFactor({ training_drills: 2 })).toBe(0.8);
  });

  it('reads Rich Veins levels from data', () => {
    expect(gatherFactor({})).toBe(1);
    expect(gatherFactor({ rich_veins: 1 })).toBe(1.1);
    expect(gatherFactor({ rich_veins: 2 })).toBe(1.2);
  });
});
