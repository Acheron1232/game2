// Kingdom orders (orders.ts): the players tell their kingdom AI to attack, defend, build up,
// farm or expand; bot heroes follow. Also the upkeep steps that replaced the hard army limit.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gameData } from '../src/data/index';
import { parseTerrain } from '../src/map/terrain';
import { buildMatchNav } from '../src/nav/match-nav';
import type { TreeList } from '../src/nav/trees';
import { CommandType } from '../src/sim/commands';
import { entityTypeIndex, ENTITY_TYPES } from '../src/sim/entity-types';
import { FactionAI } from '../src/sim/faction/brain';
import { upkeepStep } from '../src/sim/faction/faction';
import { KINGDOM_ORDERS, type KingdomOrder } from '../src/sim/faction/orders';
import { FACTION_HERO_SLOT, MatchSim, TICK_RATE } from '../src/sim/match-sim';

const DATA = join(__dirname, '..', 'data');
const terrain = parseTerrain(readFileSync(join(DATA, 'map-terrain.bin')));
const trees = (JSON.parse(readFileSync(join(DATA, 'map-trees.json'), 'utf8')) as { trees: TreeList }).trees;
const ORDERS = gameData.ai.faction.orders;

function match(seed: number, teams = false) {
  const heroes = gameData.heroes.map((h) => h.id);
  const slots = teams ? [0, 1, 2, 3, 4, 5, 6, 7] : [0, 1];
  const sim = new MatchSim(
    {
      seed,
      teams,
      slots: slots.map((i) => ({
        index: i,
        heroType: entityTypeIndex(heroes[i]!),
        team: (i % 4) + 1,
        color: i % 4,
        start: i % 4,
        ai: 'normal' as const,
        bot: true,
      })),
    },
    buildMatchNav(terrain, gameData.map),
    { terrain, trees },
  );
  const ai = new FactionAI(sim);
  sim.ai = ai;
  let seq = 1000;
  return {
    sim,
    ai,
    run: (sec: number) => {
      for (let i = 0; i < sec * TICK_RATE; i++) sim.step();
    },
    order: (slot: number, order: KingdomOrder, target = 255) =>
      sim.queueCommand(slot, seq++, { type: CommandType.KingdomOrder, order: KINGDOM_ORDERS.indexOf(order), target }),
  };
}

type Peek = { armyState: string };
const HALLS = new Set(['town_hall', 'stronghold', 'citadel']);
const hallOf = (sim: MatchSim, slot: number) => sim.get(sim.factions!.get(slot)!.homeHallId)!;
const armyUnits = (sim: MatchSim, slot: number) =>
  [...sim.factions!.get(slot)!.units].map((id) => sim.get(id)!).filter((u) => u?.alive && !u.job);

describe('kingdom orders', () => {
  it('an attack order sends the army at that kingdom now', () => {
    const { sim, ai, run, order } = match(7);
    run(7 * 60);
    expect(order(0, 'attack', 1)).toBe(true);
    run(20);
    const brain = ai.brain(0)!;
    expect(sim.factions!.get(0)!.order).toBe('attack');
    expect((brain as unknown as Peek).armyState).toBe('attack');
    const goal = brain.armyTarget()!;
    const hall = hallOf(sim, 1);
    expect(Math.hypot(goal.x - hall.mover.x, goal.y - hall.mover.y), 'goal at the Blue base').toBeLessThan(30);
    expect(brain.status).toMatch(/^Order: Attack Blue/);
  }, 60_000);

  it('defend keeps the army and the bot heroes at home', () => {
    const { sim, ai, run, order } = match(8);
    run(1);
    expect(order(0, 'defend')).toBe(true);
    const hall = hallOf(sim, 0);
    let far = 0;
    const states = new Set<string>();
    for (let t = 0; t < 12 * 60; t += 10) {
      run(10);
      states.add((ai.brain(0) as unknown as Peek).armyState);
      for (const u of armyUnits(sim, 0))
        if (Math.hypot(u.mover.x - hall.mover.x, u.mover.y - hall.mover.y) > ORDERS.stayHomeRange + 15) far++;
    }
    expect(states.has('attack') || states.has('creep'), [...states].join()).toBe(false);
    expect(far, 'army units far from home').toBe(0);
    // Both heroes of the kingdom (the player's bot and the shrine hero) farm only near home
    // (a camp within the range, plus a short chase).
    for (const slot of [0, FACTION_HERO_SLOT]) {
      const hero = sim.heroes[slot];
      if (!hero?.alive) continue;
      expect(Math.hypot(hero.mover.x - hall.mover.x, hero.mover.y - hall.mover.y), `hero ${slot}`).toBeLessThan(
        ORDERS.heroCampRange.defend + 25,
      );
    }
    expect(ai.brain(0)!.status).toMatch(/^Order: Defend/);
  }, 60_000);

  it('farm clears camps and never attacks a base', () => {
    const { sim, ai, run, order } = match(9);
    run(1);
    order(0, 'farm');
    let attacked = false;
    for (let t = 0; t < 12 * 60; t += 5) {
      run(5);
      if ((ai.brain(0) as unknown as Peek).armyState === 'attack') attacked = true;
    }
    expect(attacked).toBe(false);
    // Other kingdoms can win the neutral race with different heroes. The order promises farming, not a higher score than a rival.
    expect(sim.factions!.get(0)!.campsCleared).toBeGreaterThan(0);
    expect(ai.brain(0)!.status).toMatch(/^Order: Farm/);
  }, 60_000);

  it('expand takes a free gold mine now, then goes back to auto', () => {
    const { sim, run, order } = match(10);
    run(5 * 60);
    const f = sim.factions!.get(0)!;
    f.gold += 1500;
    order(0, 'expand');
    run(1);
    expect(f.order).toBe('expand');
    let t = 0;
    while (f.order === 'expand' && t++ < 4 * 60) run(1);
    expect(f.order).toBe('auto');
    const halls = sim.entities.filter((e) => e.alive && e.owner === 0 && HALLS.has(ENTITY_TYPES[e.type]!));
    expect(halls.length, 'Town Halls (sites too)').toBe(2);
  }, 60_000);

  it('is shared by the two heroes of a team kingdom; no attack on a friend', () => {
    const { sim, run, order } = match(11, true);
    run(1);
    const f = sim.factions!.get(0)!;
    expect(order(FACTION_HERO_SLOT, 'defend')).toBe(true);
    run(1);
    expect(f.order).toBe('defend');
    expect(f.orderBy).toBe(FACTION_HERO_SLOT);
    expect(order(0, 'farm')).toBe(true);
    run(1);
    expect(f.order).toBe('farm');
    expect(f.orderBy).toBe(0);
    expect(order(0, 'attack', 0), 'own kingdom').toBe(false);
    expect(order(0, 'attack', 9), 'no such kingdom').toBe(false);
    expect(order(FACTION_HERO_SLOT, 'attack', 2)).toBe(true);
    run(1);
    expect([f.order, f.orderTarget]).toEqual(['attack', 2]);
  });
});

describe('upkeep', () => {
  it('a bigger army brings less gold per trip; no step below 0 supply', () => {
    const steps = gameData.rules.economy.upkeep.steps;
    expect(upkeepStep(0).goldPct).toBe(100);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]!.fromSupply).toBeGreaterThan(steps[i - 1]!.fromSupply);
      expect(steps[i]!.goldPct).toBeLessThan(steps[i - 1]!.goldPct);
      expect(upkeepStep(steps[i]!.fromSupply).goldPct).toBe(steps[i]!.goldPct);
      expect(upkeepStep(steps[i]!.fromSupply - 1).goldPct).toBe(steps[i - 1]!.goldPct);
    }
  });

  it('mining brings the upkeep share of a trip', () => {
    const { sim, run } = match(12);
    const f = sim.factions!.get(0)!;
    const tripGold = () => {
      let most = 0;
      for (const id of f.units) {
        const j = sim.get(id)?.job;
        if (j?.carry === 'gold') most = Math.max(most, j.amount);
      }
      return most;
    };
    let normal = 0;
    for (let t = 0; t < 30 && !normal; t++, run(1)) normal = tripGold();
    expect(normal).toBe(gameData.rules.economy.goldPerTrip);
    // Pretend a big army: from now on every trip brings the high-upkeep share.
    const high = gameData.rules.economy.upkeep.steps.find((s) => s.goldPct === 60)!;
    const update = sim.factions!.updateSupply.bind(sim.factions);
    sim.factions!.updateSupply = (x) => {
      update(x);
      if (x === f) x.supplyUsed = high.fromSupply;
    };
    run(10);
    let cut = 0;
    for (let t = 0; t < 30 && !cut; t++, run(1)) cut = tripGold();
    expect(cut).toBe(Math.round((gameData.rules.economy.goldPerTrip * high.goldPct) / 100));
  });
});
