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
  });

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
  });

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

  it('a solo match says there is no enemy instead of waiting for the army forever', () => {
    const { ai, run } = match(4, 1);
    run(9 * 60);
    const status = ai.brain(0)!.status;
    expect(status).not.toContain('waiting for the army');
    expect(status).toMatch(/No enemy left to attack|Army clearing|Clearing/);
  });
});
