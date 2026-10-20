import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gameData } from '../src/data/index';
import { parseTerrain } from '../src/map/terrain';
import { buildMatchNav } from '../src/nav/match-nav';
import type { TreeList } from '../src/nav/trees';
import { entityTypeIndex } from '../src/sim/entity-types';
import { HeroBot, type BotDifficulty } from '../src/sim/hero-bot';
import { itemIndex } from '../src/sim/items';
import { MatchSim, NEUTRAL, NEUTRAL_TEAM, TICK_RATE, type SimEntity } from '../src/sim/match-sim';

const DATA = join(__dirname, '..', 'data');
const terrain = parseTerrain(readFileSync(join(DATA, 'map-terrain.bin')));
const trees = (JSON.parse(readFileSync(join(DATA, 'map-trees.json'), 'utf8')) as { trees: TreeList }).trees;
const healingPotion = itemIndex('healing_potion');

function slot(hero: string, difficulty: BotDifficulty = 'normal') {
  return { index: 0, heroType: entityTypeIndex(hero), team: 1, color: 0, start: 0, bot: true, ai: difficulty };
}

function setup(hero = 'blood_witch', difficulty: BotDifficulty = 'normal', factions = false) {
  const sim = new MatchSim(
    { seed: 83, slots: [slot(hero, difficulty)], noCamps: true },
    buildMatchNav(terrain, gameData.map),
    factions ? { terrain, trees } : undefined,
  );
  return { sim, bot: new HeroBot(0, difficulty), hero: sim.heroes[0]! };
}

function run(sim: MatchSim, bot: HeroBot, ticks: number): void {
  for (let tick = 0; tick < ticks; tick++) {
    sim.step();
    bot.update(sim);
  }
}

function itemCount(hero: SimEntity, item: number): number {
  let count = 0;
  for (const stack of hero.heroState!.inventory) if (stack?.item === item) count += stack.charges || 1;
  return count;
}

describe('hero bot shopping', () => {
  it("buys healing potions up to two at a nearby Trader's Tent", () => {
    const { sim, bot, hero } = setup();
    const shop = gameData.map.shops.find((entry) => entry.type === 'side_shop')!;
    sim.teleport(hero, shop.pos[0], shop.pos[1]);
    hero.heroState!.gold = 400;

    run(sim, bot, 2);

    expect(itemCount(hero, healingPotion)).toBe(2);
    expect(hero.heroState!.gold).toBe(300);
  });

  it('walks to a shop and buys the first item in its hero build', () => {
    const { sim, bot, hero } = setup('blood_witch');
    const firstItem = itemIndex(gameData.ai.heroBot.heroBuild.blood_witch![0]!);
    const startX = hero.mover.x;
    hero.heroState!.gold = 1000;

    run(sim, bot, 15 * TICK_RATE);

    expect(hero.mover.x).not.toBe(startX);
    expect(itemCount(hero, firstItem)).toBe(1);
  });

  it('drinks a ready healing potion below 45% health in a fight', () => {
    const { sim, bot, hero } = setup('stone_golem');
    hero.heroState!.inventory[0] = { item: healingPotion, charges: 1 };
    hero.hp = hero.stats.maxHp * 0.35;
    const hpBefore = hero.hp;
    const enemy = sim.spawn(entityTypeIndex('ogre_warlord'), NEUTRAL, NEUTRAL_TEAM, 255, hero.mover.x + 1, hero.mover.y);
    hero.order = 'attack';
    hero.targetId = enemy.id;
    hero.orderTarget = enemy.id;
    enemy.targetId = hero.id;

    run(sim, bot, 2);

    expect(itemCount(hero, healingPotion)).toBe(0);
    expect(hero.hp).toBeGreaterThan(hpBefore);
  });

  it('buys allowed Town Hall upgrades within the 30% budget', () => {
    const { sim, bot, hero } = setup('stone_golem', 'normal', true);
    const faction = sim.factions!.get(0)!;
    const hall = sim.get(faction.homeHallId)!;
    sim.teleport(hero, hall.mover.x + 4.5, hall.mover.y);
    hero.heroState!.gold = 1500;
    const goldBefore = hero.heroState!.gold;

    run(sim, bot, 3 * TICK_RATE);

    expect(faction.upgrades.rich_veins).toBe(1);
    expect(faction.upgrades.iron_plates).toBeUndefined();
    expect(faction.upgrades.sharper_blades).toBeUndefined();
    expect(faction.upgrades.better_arrows).toBeUndefined();
    expect(goldBefore - hero.heroState!.gold).toBeLessThanOrEqual((goldBefore - 300) * 0.3);
  });

  it('does not buy hero-build items on Easy', () => {
    const { sim, bot, hero } = setup('blood_witch', 'easy');
    const shop = gameData.map.shops.find((entry) => entry.type === 'side_shop')!;
    const firstItem = itemIndex(gameData.ai.heroBot.heroBuild.blood_witch![0]!);
    sim.teleport(hero, shop.pos[0], shop.pos[1]);
    hero.heroState!.gold = 1000;

    run(sim, bot, 3 * TICK_RATE);

    expect(itemCount(hero, healingPotion)).toBe(2);
    expect(itemCount(hero, firstItem)).toBe(0);
  });
});
