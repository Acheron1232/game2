// Phase 8a: factions on the real map — start, gold and wood, training, building, trees, defeat.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { entityTypeIndex, ENTITY_TYPES } from '../src/sim/entity-types';
import { EventType } from '../src/sim/events';
import { isTownHall } from '../src/sim/faction/faction';
import { MatchSim, TICK_RATE, type SimEntity } from '../src/sim/match-sim';
import { buildMatchNav } from '../src/nav/match-nav';
import { isWalkable } from '../src/nav/nav-grid';
import { parseTerrain } from '../src/map/terrain';
import { gameData } from '../src/data/index';
import type { TreeList } from '../src/nav/trees';

const DATA = join(__dirname, '..', 'data');
const terrain = parseTerrain(readFileSync(join(DATA, 'map-terrain.bin')));
const trees = (JSON.parse(readFileSync(join(DATA, 'map-trees.json'), 'utf8')) as { trees: TreeList }).trees;

function match(slots = 2, seed = 1) {
  const sim = new MatchSim(
    {
      seed,
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
  const run = (seconds: number, each?: () => void) => {
    for (let i = 0; i < seconds * TICK_RATE; i++) {
      sim.step();
      each?.();
    }
  };
  return { sim, f: sim.factions!, run };
}

const units = (sim: MatchSim, slot: number, id: string) =>
  sim.entities.filter((e) => e.alive && e.owner === slot && ENTITY_TYPES[e.type] === id);

describe('faction start', () => {
  it('gets a Town Hall, 5 workers, money and supply', () => {
    const { sim, f } = match();
    const a = f.get(0)!;
    expect(a.gold).toBe(500);
    expect(a.wood).toBe(150);
    expect(units(sim, 0, 'worker').length).toBe(5);
    const hall = sim.get(a.homeHallId)!;
    expect(isTownHall(hall)).toBe(true);
    expect(hall.building!.done).toBe(true);
    expect(a.supplyCap).toBe(12);
    expect(a.supplyUsed).toBe(5);
    // The hall blocks the walk grid; the 12 gold mines exist and can not be hurt.
    expect(isWalkable(sim.nav, hall.mover.x, hall.mover.y)).toBe(false);
    expect(sim.entities.filter((e) => e.building && !e.building.def).length).toBe(gameData.map.goldMines.length);
  });
});

describe('economy', () => {
  it('workers bring gold: about 5 workers x 10 gold per trip', () => {
    const { f, run } = match();
    run(60);
    const a = f.get(0)!;
    // Trip ≈ walk there and back + 1 s inside; at least 20 trips in a minute for 5 workers.
    expect(a.gold - 500).toBeGreaterThanOrEqual(200);
    expect(a.gold - 500).toBeLessThan(1000);
  });

  it('wood: a tree is chopped down, its cells open and an event says so', () => {
    const { sim, f, run } = match();
    const a = f.get(0)!;
    const ws = units(sim, 0, 'worker');
    for (const w of ws.slice(0, 3)) f.setJob(w, 'wood', -1);
    // setJob(-1) has no tree yet: the worker picks the nearest free one on its first update.
    let gone = -1;
    run(120, () => {
      for (let i = 0; i < sim.events.count; i++) if (sim.events.items[i]!.type === EventType.TreeGone) gone = sim.events.items[i]!.a;
    });
    expect(a.wood).toBeGreaterThan(150 + 50);
    expect(gone).toBeGreaterThanOrEqual(0);
    expect(f.trees.alive[gone]).toBe(0);
    expect(f.cutTrees).toContain(gone);
  });

  it('trains a worker: pays, takes supply, and the worker starts mining', () => {
    const { sim, f, run } = match();
    const a = f.get(0)!;
    const hall = sim.get(a.homeHallId)!;
    expect(f.train(a, hall, 'worker')).toBe(true);
    expect(a.gold).toBe(500 - 75);
    expect(a.supplyUsed).toBe(6);
    // A swordsman can not come from a Town Hall.
    expect(f.train(a, hall, 'swordsman')).toBe(false);
    run(16);
    const ws = units(sim, 0, 'worker');
    expect(ws.length).toBe(6);
    expect(ws.some((w) => w.job?.kind === 'gold')).toBe(true);
  });

  it('builds a House: site, progress while a worker builds, then more supply', () => {
    const { sim, f, run } = match();
    const a = f.get(0)!;
    const hall = sim.get(a.homeHallId)!;
    const w = units(sim, 0, 'worker')[0]!;
    // A spot 9 units toward the map center from the hall.
    const dx = Math.sign(128 - hall.mover.x),
      dy = Math.sign(128 - hall.mover.y);
    let site: SimEntity | null = null;
    for (let k = 0; k < 30 && !site; k++)
      site = f.startBuilding(a, 'house', Math.round(hall.mover.x + dx * (7 + k * 0.5)), Math.round(hall.mover.y + dy * 6), w);
    expect(site).toBeTruthy();
    expect(a.gold).toBe(500 - 80);
    expect(site!.building!.done).toBe(false);
    expect(site!.hp).toBeLessThan(site!.stats.maxHp * 0.2);
    run(40);
    expect(site!.building!.done).toBe(true);
    expect(site!.hp).toBeCloseTo(site!.stats.maxHp, 0);
    run(1);
    expect(a.supplyCap).toBe(12 + 8);
    // Can not start a building with a missing need (Archery Range needs Barracks).
    expect(f.startBuilding(a, 'archery_range', Math.round(hall.mover.x - dx * 9), Math.round(hall.mover.y + dy * 9), null)).toBeNull();
  });

  it('upgrades the Town Hall to a Stronghold', () => {
    const { sim, f, run } = match();
    const a = f.get(0)!;
    const hall = sim.get(a.homeHallId)!;
    a.gold = 1000;
    a.wood = 1000;
    expect(f.upgradeTier(a, hall)).toBe(true);
    expect(f.upgradeTier(a, hall)).toBe(false);
    run(91);
    expect(ENTITY_TYPES[hall.type]).toBe('stronghold');
    expect(a.tier).toBe(2);
    expect(hall.stats.maxHp).toBe(2500);
  });
});

describe('defeat and victory', () => {
  it('a team without a Town Hall loses, the last team wins', () => {
    const { sim, f, run } = match(2);
    const b = f.get(1)!;
    const hall = sim.get(b.homeHallId)!;
    const cells = hall.building!;
    sim.kill(hall, { id: 0, owner: 0, team: 1 });
    // The ruins open the walk grid at once.
    expect(isWalkable(sim.nav, hall.mover.x + cells.w / 2 - 0.3, hall.mover.y)).toBe(true);
    let over = 0;
    run(2, () => {
      for (let i = 0; i < sim.events.count; i++) if (sim.events.items[i]!.type === EventType.MatchOver) over = sim.events.items[i]!.a;
    });
    expect(b.defeated).toBe(true);
    expect(units(sim, 1, 'worker').length).toBe(0);
    expect(f.winnerTeam).toBe(1);
    expect(over).toBe(1);
  });
});
