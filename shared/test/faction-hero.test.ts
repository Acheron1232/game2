// Faction AI pass: the Hero Shrine and the faction's own hero, who gets the kill gold, and the
// new target classes (fighters before towers, buildings last).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gameData, type BuildingDef } from '../src/data/index';
import { parseTerrain } from '../src/map/terrain';
import { buildMatchNav } from '../src/nav/match-nav';
import type { TreeList } from '../src/nav/trees';
import { entityTypeIndex } from '../src/sim/entity-types';
import { blankBuilding } from '../src/sim/faction/faction';
import { HeroBot } from '../src/sim/hero-bot';
import { pickTarget } from '../src/sim/faction/targeting';
import { FACTION_HERO_SLOT, MatchSim, TICK_RATE, type SimEntity } from '../src/sim/match-sim';

const DATA = join(import.meta.dirname, '..', 'data');
const terrain = parseTerrain(readFileSync(join(DATA, 'map-terrain.bin')));
const trees = (JSON.parse(readFileSync(join(DATA, 'map-trees.json'), 'utf8')) as { trees: TreeList }).trees;
const SHRINE = gameData.buildings.buildings.find((b) => b.heroSummon)!;

function match(slots = 2): MatchSim {
  return new MatchSim(
    {
      seed: 1,
      noCamps: true,
      slots: Array.from({ length: slots }, (_, i) => ({
        index: i,
        heroType: entityTypeIndex('stone_golem'),
        team: i + 1,
        color: i,
        start: i,
      })),
    },
    buildMatchNav(terrain, gameData.map),
    { terrain, trees },
  );
}

/** A finished building of slot `slot` at a free spot near its hall. */
function building(sim: MatchSim, slot: number, id: string, dx: number, dy: number): SimEntity {
  const f = sim.factions!.get(slot)!;
  const hall = sim.get(f.homeHallId)!;
  const def = gameData.buildings.buildings.find((b) => b.id === id) as BuildingDef;
  const e = sim.spawn(entityTypeIndex(id), slot, f.team, f.color, hall.mover.x + dx, hall.mover.y + dy);
  e.building = blankBuilding(def, def.footprint[0], def.footprint[1]);
  e.building.done = true;
  f.buildings.add(e.id);
  return e;
}

const run = (sim: MatchSim, seconds: number) => {
  for (let i = 0; i < seconds * TICK_RATE; i++) sim.step();
};

describe('faction hero', () => {
  it('is summoned at the shrine (pays, waits), gets its own command slot and comes back there', () => {
    const sim = match();
    const f = sim.factions!.get(0)!;
    f.gold = f.wood = 5000;
    const shrine = building(sim, 0, SHRINE.id, -9, 0);
    const golem = entityTypeIndex('light_healer');
    expect(sim.factions!.summonHero(f, shrine, golem)).toBe(true);
    expect(f.gold).toBe(5000 - SHRINE.heroSummon!.cost.gold);
    // One at a time.
    expect(sim.factions!.summonHero(f, shrine, golem)).toBe(false);
    run(sim, SHRINE.heroSummon!.timeSec - 1);
    expect(f.heroId).toBe(0);
    run(sim, 2);
    const hero = sim.heroes[FACTION_HERO_SLOT]!;
    expect(hero.id).toBe(f.heroId);
    expect(hero.type).toBe(golem);
    expect(hero.owner).toBe(0);
    expect(hero.team).toBe(f.team);
    expect(hero.heroState!.slot).toBe(FACTION_HERO_SLOT);
    // Not an army unit: no supply, not in the faction's unit list.
    expect(f.units.has(hero.id)).toBe(false);
    expect(Math.hypot(hero.mover.x - shrine.mover.x, hero.mover.y - shrine.mover.y)).toBeLessThan(6);
    // It takes commands on its own slot, like a player's hero.
    expect(sim.factions!.summonHero(f, shrine, golem)).toBe(false);
    const home = [...hero.heroState!.home];
    sim.kill(hero, { id: 0, owner: 1, team: 2 });
    run(sim, 60);
    expect(hero.alive).toBe(true);
    expect([hero.mover.x, hero.mover.y]).toEqual(home);
  });

  it('gets the gold of its own last hits, not the player hero', () => {
    const sim = match();
    const f = sim.factions!.get(0)!;
    f.gold = f.wood = 5000;
    const shrine = building(sim, 0, SHRINE.id, -9, 0);
    sim.factions!.summonHero(f, shrine, entityTypeIndex('forest_elf'));
    run(sim, SHRINE.heroSummon!.timeSec + 1);
    const hero = sim.get(f.heroId)!;
    const player = sim.heroes[0]!;
    const playerGold = player.heroState!.gold;
    const heroGold = hero.heroState!.gold;
    const victim = sim.spawn(entityTypeIndex('swordsman'), 1, 2, 1, hero.mover.x + 2, hero.mover.y);
    sim.kill(victim, { id: hero.id, owner: 0, team: 1 });
    expect(hero.heroState!.gold).toBeGreaterThan(heroGold);
    expect(player.heroState!.gold).toBe(playerGold);
  });
});

describe('army target classes', () => {
  it('a swordsman hits an enemy fighter before a tower that shoots it, and a tower before a building', () => {
    const sim = match();
    const [x, y] = [128, 128];
    const me = sim.spawn(entityTypeIndex('swordsman'), 0, 1, 0, x, y);
    sim.factions!.get(0)!.units.add(me.id);
    const tower = building(sim, 1, 'watchtower', 0, 0);
    tower.mover.x = x + 2;
    tower.mover.y = y;
    tower.targetId = me.id;
    const house = building(sim, 1, 'house', 0, 0);
    house.mover.x = x - 2.5;
    house.mover.y = y;
    sim.grid.rebuild(sim.entities, (e) => e.alive);
    const rules = { focusFire: true, takeNeutrals: false };
    expect(pickTarget(sim, me, 7, rules)).toBe(tower.id);
    const enemy = sim.spawn(entityTypeIndex('archer'), 1, 2, 1, x, y + 5);
    sim.grid.rebuild(sim.entities, (e) => e.alive);
    expect(pickTarget(sim, me, 7, rules)).toBe(enemy.id);
  });

  it('an army unit hitting a building turns to an enemy fighter that comes close', () => {
    const sim = match();
    const f = sim.factions!.get(0)!;
    const house = building(sim, 1, 'house', 0, 0);
    const [x, y] = [house.mover.x + 2.4, house.mover.y];
    const me = sim.spawn(entityTypeIndex('swordsman'), 0, 1, 0, x, y);
    f.units.add(me.id);
    me.order = 'attackMove';
    me.orderX = house.mover.x;
    me.orderY = house.mover.y;
    me.targetId = house.id;
    run(sim, 1);
    expect(me.targetId).toBe(house.id);
    const enemy = sim.spawn(entityTypeIndex('swordsman'), 1, 2, 1, x + 4, y);
    enemy.order = 'hold';
    run(sim, 1);
    expect(me.targetId).toBe(enemy.id);
  });
});

describe('hero bot skills', () => {
  it('learns all three basic skills by level 4 (the third one is not left empty)', () => {
    const sim = match();
    const hero = sim.heroes[0]!;
    sim.addXp(hero, gameData.rules.experience.totalXpForLevel[3]!);
    expect(hero.heroState!.level).toBe(4);
    const bot = new HeroBot(0, 'hard');
    for (let i = 0; i < 3 * TICK_RATE; i++) {
      bot.update(sim);
      sim.step();
    }
    expect(hero.heroState!.abilityLevels.slice(0, 3).every((l) => l >= 1)).toBe(true);
    expect(hero.heroState!.skillPoints).toBe(0);
  });

  it('a melee hero does not pick a camp of flying monsters (it could not hit them)', () => {
    const pick = (heroId: string) => {
      const sim = new MatchSim(
        { seed: 1, slots: [{ index: 0, heroType: entityTypeIndex(heroId), team: 1, color: 0, start: 0 }] },
        buildMatchNav(terrain, gameData.map),
      );
      const hero = sim.heroes[0]!;
      sim.addXp(hero, gameData.rules.experience.totalXpForLevel[9]!);
      // Only the harpy camps are up.
      for (const c of sim.camps) if (!c.members.some((m) => m.stats.layer !== 'ground')) c.respawnAt = 1e9;
      const bot = new HeroBot(0, 'normal') as unknown as { chooseCamp(sim: MatchSim, hero: SimEntity): { type: string } | null };
      return bot.chooseCamp(sim, hero);
    };
    expect(pick('staff_warrior')).toBeNull();
    expect(pick('forest_elf')?.type).toMatch(/harp/);
  });
});
