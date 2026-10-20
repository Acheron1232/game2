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
import { MatchSim, TICK_RATE } from '../src/sim/match-sim';

const DATA = join(__dirname, '..', 'data');
const terrain = parseTerrain(readFileSync(join(DATA, 'map-terrain.bin')));
const trees = (JSON.parse(readFileSync(join(DATA, 'map-trees.json'), 'utf8')) as { trees: TreeList }).trees;
const nav0 = () => buildMatchNav(terrain, gameData.map);

function match(seed: number) {
  const sim = new MatchSim(
    {
      seed,
      slots: [0, 1].map((i) => ({
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
});
