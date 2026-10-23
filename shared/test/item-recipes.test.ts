// Recipes (items made from other items), item upgrades, the new item stats (spell damage,
// cooldown cut, spell resist, heal power, critical hits, max mana) and item auras.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildMatchNav,
  buyPlan,
  CommandType,
  DamageKind,
  entityTypeIndex,
  EventType,
  gameData,
  itemIndex,
  ITEMS,
  MatchSim,
  NEUTRAL,
  NEUTRAL_TEAM,
  newCharges,
  parseTerrain,
  storeItem,
  TICK_RATE,
  type ItemStack,
  type SimEntity,
} from '../src/index';

const nav = buildMatchNav(parseTerrain(readFileSync(join(__dirname, '..', 'data', 'map-terrain.bin'))), gameData.map);
const ix = (id: string) => itemIndex(id);
const cost = (id: string) => ITEMS[ix(id)]!.cost!;
const RELIC_HALL = gameData.map.shops.find((s) => s.type === 'relic_hall')!.pos;
const inv = (...ids: string[]): (ItemStack | null)[] => [
  ...ids.map((id) => ({ item: ix(id), charges: 0 })),
  ...Array.from({ length: 6 - ids.length }, () => null),
];

function setup(heroes = ['blood_witch']) {
  const slots = heroes.map((h, i) => ({ index: i, heroType: entityTypeIndex(h), team: i + 1, color: i, start: i }));
  const sim = new MatchSim({ seed: 5, slots, noCamps: true }, nav);
  const hero = sim.heroes[0]!;
  hero.mover.x = 110;
  hero.mover.y = 222;
  sim.step();
  let seq = 0;
  const give = (e: SimEntity, id: string) => {
    storeItem(e.heroState!.inventory, ix(id), newCharges(ix(id)));
    sim.refreshStats(e);
  };
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds * TICK_RATE); i++) sim.step();
  };
  const dummy = (dx: number, unit = 'ogre_brute') => {
    const d = sim.spawn(entityTypeIndex(unit), NEUTRAL, NEUTRAL_TEAM, 0, hero.mover.x + dx, hero.mover.y);
    d.passive = true;
    d.thinkAt = Infinity;
    d.base = { ...d.base, hpRegen: 0 };
    d.stats = d.base;
    return d;
  };
  return { sim, hero, give, run, dummy, cmd: (c: Parameters<MatchSim['queueCommand']>[2]) => sim.queueCommand(0, ++seq, c) };
}

describe('recipes and upgrades', () => {
  it('every recipe costs its parts plus the fee, and some shop sells it', () => {
    const sold = new Set(gameData.shops.flatMap((s) => s.items));
    const recipes = gameData.items.filter((i) => i.recipe);
    expect(recipes.length).toBeGreaterThanOrEqual(25);
    for (const it of recipes) {
      expect(it.cost, it.id).toBe(it.recipe!.fee + it.recipe!.components.reduce((s, c) => s + cost(c), 0));
      expect(sold.has(it.id), it.id).toBe(true);
    }
  });

  it('carried parts pay for a recipe, also the parts of a missing part', () => {
    expect(buyPlan(inv(), ix('arcane_staff')).price).toBe(cost('arcane_staff'));
    expect(buyPlan(inv('focus_crystal'), ix('arcane_staff')).price).toBe(cost('arcane_staff') - cost('focus_crystal'));
    // Arcane Staff II = Arcane Staff + Focus Crystal; the staff's own parts count too.
    const plan = buyPlan(inv('sage_cloak', 'focus_crystal', 'focus_crystal'), ix('arcane_staff_2'));
    expect(plan.price).toBe(ITEMS[ix('arcane_staff')]!.recipe!.fee + ITEMS[ix('arcane_staff_2')]!.recipe!.fee);
    expect(plan.uses.sort()).toEqual([0, 1, 2]);
    // Buying a part again does not use the one you carry.
    expect(buyPlan(inv('focus_crystal'), ix('focus_crystal')).price).toBe(cost('focus_crystal'));
  });

  it('buying at the Relic Hall takes the parts out and pays the rest', () => {
    const { sim, hero, give, cmd, run } = setup();
    hero.mover.x = RELIC_HALL[0] + 2;
    hero.mover.y = RELIC_HALL[1];
    give(hero, 'hourglass_charm');
    give(hero, 'mana_pearl');
    const hs = hero.heroState!;
    hs.gold = 1000;
    cmd({ type: CommandType.BuyItem, item: ix('timeworn_tome') });
    run(0.1);
    expect(hs.inventory.filter(Boolean).map((s) => ITEMS[s!.item]!.id)).toEqual(['timeworn_tome']);
    expect(hs.gold).toBe(1000 - ITEMS[ix('timeworn_tome')]!.recipe!.fee);
    expect(sim.tick).toBeGreaterThan(0);
  });

  it('a full inventory can still build a recipe: its parts make room', () => {
    const parts = inv('chain_vest', 'heart_stone', 'iron_claws', 'iron_claws', 'iron_claws', 'iron_claws');
    const plan = buyPlan(parts, ix('bulwark_plate'));
    expect(plan.uses.sort()).toEqual([0, 1]);
  });
});

describe('new item stats', () => {
  it('spell damage items make spells hit harder; spell resist items cut spell damage taken', () => {
    const { sim, hero, give, dummy } = setup(['blood_witch', 'stone_golem']);
    const ogre = dummy(4);
    sim.spellHit(ogre, 100, hero);
    const plain = ogre.stats.maxHp - ogre.hp;
    give(hero, 'arcane_staff');
    ogre.hp = ogre.stats.maxHp;
    sim.spellHit(ogre, 100, hero);
    expect(ogre.stats.maxHp - ogre.hp).toBeCloseTo(plain * 1.12, 3);
    const golem = sim.heroes[1]!;
    golem.hp = golem.stats.maxHp;
    sim.spellHit(golem, 100, ogre);
    const plainHero = golem.stats.maxHp - golem.hp;
    give(golem, 'spellward_cloak');
    golem.hp = golem.stats.maxHp;
    sim.spellHit(golem, 100, ogre);
    expect(golem.stats.maxHp - golem.hp).toBeCloseTo(plainHero * 0.75, 3);
  });

  it('cooldown items make ability cooldowns shorter, up to the cap', () => {
    const { sim, hero, give, cmd, run, dummy } = setup();
    sim.addXp(hero, 99999);
    cmd({ type: CommandType.Learn, slot: 0 });
    run(0.1);
    give(hero, 'sages_hourglass');
    const target = dummy(4);
    hero.mana = hero.stats.maxMana;
    cmd({ type: CommandType.Cast, slot: 0, target: 1, id: target.id, x: 0, y: 0 });
    run(1);
    const a = gameData.abilities.find((x) => x.id === 'blood_bolt')!;
    const full = (a.cooldown as number) * TICK_RATE;
    const left = hero.cooldowns[0]! - sim.tick;
    expect(left).toBeLessThan(full * 0.8 + 1);
    expect(left).toBeGreaterThan(full * 0.8 - TICK_RATE * 1.5);
  });

  it('heal items make heals stronger; mana items add max mana', () => {
    const { sim, hero, give } = setup(['light_healer']);
    const mana = hero.stats.maxMana;
    give(hero, 'mana_pearl');
    expect(hero.stats.maxMana).toBe(mana + 150);
    hero.hp = 100;
    sim.heal(hero, 100, hero);
    const plain = hero.hp - 100;
    give(hero, 'healers_censer');
    hero.hp = 100;
    sim.heal(hero, 100, hero);
    expect(hero.hp - 100).toBeCloseTo(plain * 1.2, 3);
  });

  it('crit items make some attacks hit for 1.75 x damage', () => {
    const { sim, hero, give, run, dummy } = setup(['staff_warrior']);
    give(hero, 'kingslayer');
    give(hero, 'sky_piercer');
    const ogre = dummy(1.5);
    ogre.base = { ...ogre.base, maxHp: 1e6, armor: 0 };
    ogre.stats = ogre.base;
    ogre.hp = 1e6;
    hero.targetId = ogre.id;
    hero.order = 'attack';
    const hits: number[] = [];
    for (let i = 0; i < 20 * TICK_RATE; i++) {
      sim.step();
      for (let k = 0; k < sim.events.count; k++) {
        const e = sim.events.items[k]!;
        if (e.type === EventType.Damage && e.a === ogre.id && e.kind === DamageKind.Attack) hits.push(e.value);
      }
    }
    expect(hits.length).toBeGreaterThan(10);
    const max = hero.stats.damageMax * gameData.rules.items.critMultiplier;
    // 50% (the cap): some crits, some normal hits.
    expect(hits.some((h) => h > hero.stats.damageMax + 1)).toBe(true);
    expect(hits.some((h) => h <= hero.stats.damageMax + 1)).toBe(true);
    expect(Math.max(...hits)).toBeLessThanOrEqual(Math.ceil(max) + 1);
    run(0);
  });

  it('an aura item gives allies near the hero its bonus', () => {
    const { sim, hero, give, run } = setup(['light_healer']);
    const soldier = sim.spawn(entityTypeIndex('swordsman'), 0, hero.team, 0, hero.mover.x + 3, hero.mover.y);
    soldier.thinkAt = Infinity;
    const armor = soldier.stats.armor;
    give(hero, 'banner_of_valor');
    run(1);
    expect(soldier.stats.armor - armor).toBeCloseTo(3, 5);
  });
});
