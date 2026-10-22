// Phase 8b: the faction brain plays its build order, keeps workers busy, trains an army and
// attacks. Full-length checks run with `pnpm --filter @game/server sim:matches`.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gameData } from '../src/data/index';
import { parseTerrain } from '../src/map/terrain';
import { buildMatchNav } from '../src/nav/match-nav';
import type { TreeList } from '../src/nav/trees';
import { entityTypeIndex, ENTITY_TYPES } from '../src/sim/entity-types';
import { FactionAI } from '../src/sim/faction/brain';
import { heroKingdom } from '../src/sim/faction/hire';
import { makePersonality } from '../src/sim/faction/personality';
import { ClientView } from '../src/protocol/client-view';
import { FACTION_HERO_SLOT, MatchSim, TICK_RATE } from '../src/sim/match-sim';

const DATA = join(__dirname, '..', 'data');
const terrain = parseTerrain(readFileSync(join(DATA, 'map-terrain.bin')));
const trees = (JSON.parse(readFileSync(join(DATA, 'map-trees.json'), 'utf8')) as { trees: TreeList }).trees;
const nav0 = () => buildMatchNav(terrain, gameData.map);

function match(seed: number, slots = 2) {
  const sim = new MatchSim(
    {
      seed,
      slots: [0, 1].slice(0, slots).map((i) => ({
        index: i,
        heroType: entityTypeIndex(i ? 'blood_witch' : 'staff_warrior'),
        team: i + 1,
        color: i,
        start: i,
        ai: 'normal' as const,
        bot: true,
      })),
    },
    nav0(),
    { terrain, trees },
  );
  const ai = new FactionAI(sim);
  sim.ai = ai;
  return { sim, ai, run: (sec: number) => Array.from({ length: sec * TICK_RATE }, () => sim.step()) };
}

const count = (sim: MatchSim, slot: number, id: string) =>
  sim.entities.filter((e) => e.alive && e.owner === slot && ENTITY_TYPES[e.type] === id).length;

describe('faction brain', () => {
  it('follows the build order and has an army after 7 minutes', () => {
    const { sim, ai, run } = match(5);
    run(7 * 60);
    for (const slot of [0, 1]) {
      const f = sim.factions!.get(slot)!;
      expect(count(sim, slot, 'worker'), 'workers').toBeGreaterThanOrEqual(12);
      expect(count(sim, slot, 'barracks'), 'barracks').toBeGreaterThanOrEqual(1);
      expect(count(sim, slot, 'archery_range'), 'archery range').toBeGreaterThanOrEqual(1);
      expect(count(sim, slot, 'house'), 'houses').toBeGreaterThanOrEqual(3);
      expect(f.tier, 'tier').toBeGreaterThanOrEqual(2);
      const army = count(sim, slot, 'swordsman') + count(sim, slot, 'archer');
      expect(army, 'army units').toBeGreaterThanOrEqual(5);
      expect(f.supplyUsed).toBeLessThanOrEqual(f.supplyCap);
      expect(ai.brain(slot)!.status.length).toBeGreaterThan(0);
    }
  }, 60_000);

  it('a hero bot can take over a hero and give it back', () => {
    const { ai, sim, run } = match(3);
    expect(ai.bots.length).toBe(2); // both slots are Bot slots here
    ai.setHeroBot(0, false);
    expect(ai.bots.length).toBe(1);
    const hero = sim.heroes[0]!;
    const at = [hero.mover.x, hero.mover.y];
    run(20);
    // Nobody plays hero 0 now: it stays where it is.
    expect([hero.mover.x, hero.mover.y]).toEqual(at);
    ai.setHeroBot(0, true);
    ai.setHeroBot(0, true);
    expect(ai.bots.length).toBe(2);
    run(30);
    expect(Math.hypot(hero.mover.x - at[0]!, hero.mover.y - at[1]!)).toBeGreaterThan(1);
  });

  it('is the same game for the same seed', () => {
    const a = match(9),
      b = match(9);
    a.run(150);
    b.run(150);
    const sum = (m: ReturnType<typeof match>) =>
      m.sim.entities.reduce((s, e) => s + (e.alive ? e.mover.x * 3 + e.mover.y + e.hp : 0), 0) + m.sim.factions!.get(0)!.gold;
    expect(sum(a)).toBeCloseTo(sum(b), 6);
    expect(a.sim.factions!.get(1)!.status).toBe(b.sim.factions!.get(1)!.status);
  });

  it('summons its own hero at the shrine; the hero walks with the army and levels up', () => {
    const { sim, run } = match(5);
    run(13 * 60);
    for (const slot of [0, 1]) {
      const f = sim.factions!.get(slot)!;
      expect(count(sim, slot, 'hero_shrine'), 'shrine').toBe(1);
      const hero = sim.heroes[FACTION_HERO_SLOT + slot];
      expect(hero, 'faction hero').toBeTruthy();
      expect(hero!.id).toBe(f.heroId);
      // Never a copy of the player's hero.
      expect(hero!.type).not.toBe(sim.heroes[slot]!.type);
      expect(hero!.heroState!.level, 'faction hero level').toBeGreaterThanOrEqual(2);
    }
    const camps = sim.factions!.get(0)!.campsCleared + sim.factions!.get(1)!.campsCleared;
    expect(camps, 'camps cleared').toBeGreaterThan(2);
  }, 60_000);

  it('a roaming army comes home when the base is attacked', () => {
    const { sim, ai, run } = match(5);
    type Peek = { armyState: string; gather: { targetX: number; targetY: number; mode: string } };
    const brain = ai.brain(0)! as unknown as Peek;
    let t = 0;
    while (brain.armyState !== 'creep' && t++ < 12 * 60) run(1);
    expect(brain.armyState).toBe('creep');
    // Enemy soldiers next to our Town Hall.
    const hall = sim.get(sim.factions!.get(0)!.homeHallId)!;
    for (let i = 0; i < 4; i++) {
      const u = sim.spawn(entityTypeIndex('swordsman'), 1, 2, 1, hall.mover.x + 6, hall.mover.y + i);
      sim.factions!.get(1)!.units.add(u.id);
      u.order = 'hold';
    }
    run(2);
    expect(brain.armyState).toBe('gather');
    expect(brain.gather.mode).toBe('attack');
    expect(Math.hypot(brain.gather.targetX - hall.mover.x, brain.gather.targetY - hall.mover.y)).toBeLessThan(12);
    expect(ai.brain(0)!.status).toContain('Defending');
  });

  it('every match gets its own AI personality; the same seed gives the same one', () => {
    const order = gameData.ai.faction.buildOrder as Parameters<typeof makePersonality>[2];
    expect(makePersonality(7, 1, order)).toEqual(makePersonality(7, 1, order));
    const styles = new Set<string>();
    const angles = new Set<number>();
    for (let seed = 0; seed < 40; seed++) {
      const p = makePersonality(seed, seed % 4, order);
      styles.add(p.style);
      angles.add(Math.round(p.growAngle));
      // The changed build order still has every step of the data one.
      for (const s of order) expect(p.buildOrder.some((x) => x.do === s.do && x.what === s.what)).toBe(true);
    }
    expect(styles.size).toBe(4);
    expect(angles.size).toBeGreaterThan(3);
  });

  it('buildings of one type cost more after the free count (rules.json buildingPriceRise)', () => {
    const { sim } = match(2, 1);
    const fs = sim.factions!;
    const f = fs.get(0)!;
    // Barracks need nothing else (a watchtower needs a barracks first).
    const tower = gameData.buildings.buildings.find((b) => b.id === 'barracks')!;
    const rise = gameData.rules.economy.buildingPriceRise['barracks'] as { freeCount: number; pctPerExtra: number };
    const hall = sim.get(f.homeHallId)!;
    expect(fs.buildCost(f, tower)).toEqual(tower.cost);
    f.gold = f.wood = 100_000;
    let placed = 0;
    for (let i = 0; placed < rise.freeCount + 2 && i < 200; i++) {
      const x = Math.round(hall.mover.x - 18 + (i % 8) * 5);
      const y = Math.round(hall.mover.y - 18 + Math.floor(i / 8) * 5);
      const before = fs.buildCost(f, tower);
      const gold = f.gold;
      if (!fs.startBuilding(f, 'barracks', x, y, null)) continue;
      expect(gold - f.gold, 'paid the shown price').toBe(before.gold);
      placed++;
    }
    expect(placed).toBe(rise.freeCount + 2);
    // Two over the free count: the next one is three steps up.
    expect(fs.buildCost(f, tower).gold).toBe(Math.round(tower.cost.gold * (1 + (3 * rise.pctPerExtra) / 100)));
    // Houses never rise.
    const house = gameData.buildings.buildings.find((b) => b.id === 'house')!;
    expect(fs.buildCost(f, house)).toEqual(house.cost);
  });

  it("the player's bot hero walks with the army instead of farming alone", () => {
    const { ai, run } = match(5);
    const states = new Set<string>();
    for (let s = 0; s < 12 * 60; s += 2) {
      run(2);
      states.add(ai.bots[0]!.state);
    }
    expect(states.has('With the army')).toBe(true);
  }, 60_000);

  it('a team match: two heroes per kingdom, the second one plays for the same kingdom', () => {
    const heroes = gameData.heroes.map((h) => h.id);
    const sim = new MatchSim(
      {
        seed: 21,
        teams: true,
        slots: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
          index: i,
          heroType: entityTypeIndex(heroes[i]!),
          team: (i % 4) + 1,
          color: i % 4,
          start: i % 4,
          ai: 'normal' as const,
          bot: true,
        })),
      },
      nav0(),
      { terrain, trees },
    );
    const ai = new FactionAI(sim);
    sim.ai = ai;
    expect(ai.bots.length).toBe(8);
    expect(ai.factionBots.length).toBe(0);
    for (let k = 0; k < 4; k++) {
      const second = sim.heroes[FACTION_HERO_SLOT + k]!;
      expect(second.owner).toBe(k);
      expect(second.team).toBe(sim.heroes[k]!.team);
      expect(sim.factions!.get(k)!.heroId).toBe(second.id);
      expect(heroKingdom(sim, second)).toBe(sim.factions!.get(k));
    }
    expect(sim.factions!.get(FACTION_HERO_SLOT)).toBeNull();
    expect(new ClientView(FACTION_HERO_SLOT + 2, 3).kingdom).toBe(2);
    const states = new Set<string>();
    for (let t = 0; t < 9 * 60; t += 2) {
      for (let i = 0; i < 2 * TICK_RATE; i++) sim.step();
      for (const b of ai.bots) states.add(b.state);
    }
    for (let k = 0; k < 4; k++) expect(count(sim, k, 'hero_shrine'), 'no shrine in a team match').toBe(0);
    expect(states.has('With the army')).toBe(true);
    const levels = [4, 5, 6, 7].map((slot) => sim.heroes[slot]!.heroState!.level);
    expect(Math.max(...levels), 'second heroes level up').toBeGreaterThanOrEqual(2);
  }, 60_000);

  it('a solo match says there is no enemy instead of waiting for the army forever', () => {
    const { ai, run } = match(4, 1);
    run(9 * 60);
    const status = ai.brain(0)!.status;
    expect(status).not.toContain('waiting for the army');
    expect(status).toMatch(/No enemy left to attack|Army clearing|Clearing/);
  });
});
