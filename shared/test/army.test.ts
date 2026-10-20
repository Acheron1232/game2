import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { gameData } from '../src/data/index';
import { parseTerrain } from '../src/map/terrain';
import { buildFlowField, flowDirection } from '../src/nav/flow-field';
import { buildMatchNav } from '../src/nav/match-nav';
import { nearestWalkable } from '../src/nav/nav-grid';
import type { TreeList } from '../src/nav/trees';
import { entityTypeIndex } from '../src/sim/entity-types';
import { ArmyMover } from '../src/sim/faction/army';
import { MatchSim, TICK_RATE, type SimEntity } from '../src/sim/match-sim';

const DATA = join(import.meta.dirname, '..', 'data');
const terrain = parseTerrain(readFileSync(join(DATA, 'map-terrain.bin')));
const trees = (JSON.parse(readFileSync(join(DATA, 'map-trees.json'), 'utf8')) as { trees: TreeList }).trees;

function match(): MatchSim {
  return new MatchSim(
    {
      seed: 41,
      noCamps: true,
      slots: [0, 1].map((i) => ({
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

function spawnArmy(sim: MatchSim): SimEntity[] {
  const [cx, cy] = gameData.map.starts[0]!.heroSpawn;
  const units: SimEntity[] = [];
  const used = new Set<string>();
  for (let ring = 0; ring <= 12 && units.length < 40; ring++) {
    for (let y = -ring; y <= ring && units.length < 40; y++) {
      for (let x = -ring; x <= ring && units.length < 40; x++) {
        if (ring && Math.abs(x) !== ring && Math.abs(y) !== ring) continue;
        const point = nearestWalkable(sim.nav, cx + x * 1.25, cy + y * 1.25, 8);
        if (!point) continue;
        const key = `${point[0]},${point[1]}`;
        if (used.has(key)) continue;
        used.add(key);
        const type = entityTypeIndex(units.length < 30 ? 'swordsman' : 'archer');
        units.push(sim.spawn(type, 0, 1, 0, point[0], point[1]));
      }
    }
  }
  expect(units).toHaveLength(40);
  return units;
}

function run(sim: MatchSim, mover: ArmyMover, ticks: number, each?: () => void): number {
  let updateMs = 0;
  for (let tick = 0; tick < ticks; tick++) {
    const started = performance.now();
    mover.update();
    updateMs += performance.now() - started;
    sim.step();
    each?.();
  }
  return updateMs;
}

describe('army movement', () => {
  it('gathers 40 units at the map center and rebuilds after a new blocker', () => {
    const sim = match();
    const units = spawnArmy(sim);
    const mover = new ArmyMover(sim);
    const group = mover.create(
      units.map((e) => e.id),
      'gather',
      128,
      128,
    );
    const lastX = units.map((e) => e.mover.x);
    const lastY = units.map((e) => e.mover.y);
    const movedAt = units.map(() => sim.tick);
    let longestStill = 0;
    let updateMs = 0;

    updateMs += run(sim, mover, 5 * TICK_RATE, () => {
      for (let i = 0; i < units.length; i++) {
        const e = units[i]!;
        if (Math.hypot(e.mover.x - lastX[i]!, e.mover.y - lastY[i]!) > 0.02) {
          lastX[i] = e.mover.x;
          lastY[i] = e.mover.y;
          movedAt[i] = sim.tick;
        }
      }
    });

    const center = { x: 0, y: 0 };
    expect(mover.center(group, center)).toBe(true);
    const towardX = 128 - center.x;
    const towardY = 128 - center.y;
    const length = Math.hypot(towardX, towardY);
    const bx = center.x + (towardX / length) * 8;
    const by = center.y + (towardY / length) * 8;
    const cache = (mover as unknown as { fields: { version: number } }).fields;
    const oldVersion = cache.version;
    sim.factions!.blockers.addRect(bx, by, 4, 4);
    mover.update();
    expect(cache.version).toBeGreaterThan(oldVersion);

    updateMs += run(sim, mover, 55 * TICK_RATE - 1, () => {
      for (let i = 0; i < units.length; i++) {
        const e = units[i]!;
        if (Math.hypot(e.mover.x - lastX[i]!, e.mover.y - lastY[i]!) > 0.02) {
          lastX[i] = e.mover.x;
          lastY[i] = e.mover.y;
          movedAt[i] = sim.tick;
        }
        if (Math.hypot(128 - e.mover.x, 128 - e.mover.y) > 8) longestStill = Math.max(longestStill, sim.tick - movedAt[i]!);
      }
    });

    const averageMs = updateMs / (60 * TICK_RATE);
    console.log(`army update, 40 units: ${averageMs.toFixed(3)} ms/tick`);
    expect(mover.arrived(group, 8)).toBeGreaterThanOrEqual(0.9);
    expect(longestStill).toBeLessThanOrEqual(6 * TICK_RATE);
    expect(averageMs).toBeLessThan(0.2);
  });

  it('attack-moves into enemies, then drops targets and retreats', () => {
    const sim = match();
    const units = spawnArmy(sim);
    const mover = new ArmyMover(sim);
    const enemyHall = sim.get(sim.factions!.get(1)!.homeHallId)!;
    const [sx, sy] = gameData.map.starts[0]!.heroSpawn;
    const field = buildFlowField(sim.nav, enemyHall.mover.x, enemyHall.mover.y);
    const direction = { x: 0, y: 0 };
    let ambushX = sx;
    let ambushY = sy;
    for (let i = 0; i < 50; i++) {
      expect(flowDirection(field, ambushX, ambushY, direction)).toBe(true);
      ambushX += direction.x * 0.5;
      ambushY += direction.y * 0.5;
    }
    for (let i = 0; i < 8; i++) {
      const point = nearestWalkable(sim.nav, ambushX + (i % 4) * 1.2, ambushY + Math.floor(i / 4) * 1.2, 12)!;
      sim.spawn(entityTypeIndex('swordsman'), 1, 2, 1, point[0], point[1]);
    }
    const group = mover.create(
      units.map((e) => e.id),
      'attack',
      enemyHall.mover.x,
      enemyHall.mover.y,
    );

    let startedFighting = false;
    run(sim, mover, 40 * TICK_RATE, () => {
      if (units.some((e) => e.alive && e.targetId !== 0)) startedFighting = true;
    });
    expect(startedFighting).toBe(true);

    const home = gameData.map.starts[0]!.heroSpawn;
    const target = sim.heroes[1]!;
    for (const e of units) if (e.alive) e.targetId = target.id;
    mover.setGoal(group, 'retreat', home[0], home[1]);
    mover.update();
    for (const e of units) {
      if (!e.alive) continue;
      expect(e.targetId).toBe(0);
      expect(e.order).toBe('move');
    }
    const before = { x: 0, y: 0 };
    const after = { x: 0, y: 0 };
    expect(mover.center(group, before)).toBe(true);
    run(sim, mover, 2 * TICK_RATE);
    expect(mover.center(group, after)).toBe(true);
    expect(Math.hypot(home[0] - after.x, home[1] - after.y)).toBeLessThan(Math.hypot(home[0] - before.x, home[1] - before.y));
  });

  it('moves members between groups and removes dead or missing ids', () => {
    const sim = match();
    const units = spawnArmy(sim).slice(0, 3);
    const mover = new ArmyMover(sim);
    const first = mover.create(
      units.map((e) => e.id),
      'gather',
      128,
      128,
    );
    const second = mover.create([units[0]!.id, 999_999], 'retreat', 20, 20);
    expect(first.members).toEqual([units[1]!.id, units[2]!.id]);
    sim.kill(units[0]!, { id: 0, owner: 1, team: 2 });
    mover.update();
    expect(second.members).toEqual([]);
    mover.disband(first);
    expect(mover.groups).toEqual([second]);
  });
});
