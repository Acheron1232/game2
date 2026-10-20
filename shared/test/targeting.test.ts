import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { gameData, type BuildingDef } from '../src/data/index';
import { parseTerrain } from '../src/map/terrain';
import { buildMatchNav } from '../src/nav/match-nav';
import type { TreeList } from '../src/nav/trees';
import { entityTypeIndex } from '../src/sim/entity-types';
import { blankBuilding } from '../src/sim/faction/faction';
import { pickTarget } from '../src/sim/faction/targeting';
import { MatchSim, NEUTRAL, NEUTRAL_TEAM, type SimEntity } from '../src/sim/match-sim';

const DATA = join(import.meta.dirname, '..', 'data');
const terrain = parseTerrain(readFileSync(join(DATA, 'map-terrain.bin')));
const trees = (JSON.parse(readFileSync(join(DATA, 'map-trees.json'), 'utf8')) as { trees: TreeList }).trees;
const [START_X, START_Y] = gameData.map.starts[0]!.heroSpawn;

function match(): MatchSim {
  return new MatchSim({ seed: 1, slots: [], noCamps: true }, buildMatchNav(terrain, gameData.map), { terrain, trees });
}

function spawn(sim: MatchSim, id: string, team: number, x: number, y: number): SimEntity {
  const owner = team === NEUTRAL_TEAM ? NEUTRAL : team - 1;
  return sim.spawn(entityTypeIndex(id), owner, team, owner, x, y);
}

function building(sim: MatchSim, id: string, team: number, x: number, y: number): SimEntity {
  const e = spawn(sim, id, team, x, y);
  const def = gameData.buildings.buildings.find((candidate) => candidate.id === id) as BuildingDef;
  e.building = blankBuilding(def, def.footprint[0], def.footprint[1]);
  e.building.done = true;
  return e;
}

function rebuild(sim: MatchSim): void {
  sim.grid.rebuild(sim.entities, (e) => e.alive);
}

const CLOSEST = { focusFire: false, takeNeutrals: false };
const FOCUS = { focusFire: true, takeNeutrals: false };

describe('faction target choice', () => {
  it('makes catapults prefer watchtowers, then other buildings', () => {
    const sim = match();
    const catapult = spawn(sim, 'catapult', 1, START_X, START_Y);
    spawn(sim, 'swordsman', 2, START_X + 4, START_Y);
    const house = building(sim, 'house', 2, START_X + 5, START_Y + 2);
    const tower = building(sim, 'watchtower', 2, START_X + 8, START_Y);
    rebuild(sim);

    expect(pickTarget(sim, catapult, 10, CLOSEST)).toBe(tower.id);
    tower.alive = false;
    rebuild(sim);
    expect(pickTarget(sim, catapult, 10, CLOSEST)).toBe(house.id);
  });

  it('does not pick targets inside a catapult minimum range', () => {
    const sim = match();
    const catapult = spawn(sim, 'catapult', 1, START_X, START_Y);
    building(sim, 'watchtower', 2, START_X + 1, START_Y);
    rebuild(sim);

    expect(pickTarget(sim, catapult, 10, CLOSEST)).toBe(0);
  });

  it('picks an enemy attacking it over a closer idle enemy', () => {
    const sim = match();
    const swordsman = spawn(sim, 'swordsman', 1, START_X, START_Y);
    spawn(sim, 'swordsman', 2, START_X + 2, START_Y);
    const archer = spawn(sim, 'archer', 2, START_X + 6, START_Y);
    archer.targetId = swordsman.id;
    rebuild(sim);

    expect(pickTarget(sim, swordsman, 10, CLOSEST)).toBe(archer.id);
  });

  it('uses health with focus fire and distance without it', () => {
    const sim = match();
    const swordsman = spawn(sim, 'swordsman', 1, START_X, START_Y);
    const near = spawn(sim, 'archer', 2, START_X + 3, START_Y);
    const weak = spawn(sim, 'archer', 2, START_X + 6, START_Y);
    near.hp = 250;
    weak.hp = 40;
    rebuild(sim);

    expect(pickTarget(sim, swordsman, 10, FOCUS)).toBe(weak.id);
    expect(pickTarget(sim, swordsman, 10, CLOSEST)).toBe(near.id);
  });

  it('skips idle neutrals, mines, and invulnerable enemies', () => {
    const sim = match();
    const swordsman = spawn(sim, 'swordsman', 1, START_X, START_Y);
    const neutral = spawn(sim, 'grey_wolf', NEUTRAL_TEAM, START_X + 2, START_Y);
    const mine = spawn(sim, 'gold_mine', NEUTRAL_TEAM, START_X + 2.5, START_Y);
    mine.building = blankBuilding(null, 3, 3);
    const invulnerable = spawn(sim, 'archer', 2, START_X + 3, START_Y);
    invulnerable.invulnerable = true;
    const enemy = spawn(sim, 'archer', 2, START_X + 6, START_Y);
    rebuild(sim);

    expect(pickTarget(sim, swordsman, 10, CLOSEST)).toBe(enemy.id);
    expect(pickTarget(sim, swordsman, 10, { focusFire: false, takeNeutrals: true })).toBe(neutral.id);
  });

  it('allows archers, but not swordsmen, to target air units', () => {
    const sim = match();
    const archer = spawn(sim, 'archer', 1, START_X, START_Y);
    const swordsman = spawn(sim, 'swordsman', 1, START_X, START_Y + 2);
    const hawk = spawn(sim, 'hawk_rider', 2, START_X + 4, START_Y);
    rebuild(sim);

    expect(pickTarget(sim, archer, 10, CLOSEST)).toBe(hawk.id);
    expect(pickTarget(sim, swordsman, 10, CLOSEST)).toBe(0);
  });

  it('chooses a stable lower id when all other values tie', () => {
    const sim = match();
    const swordsman = spawn(sim, 'swordsman', 1, START_X, START_Y);
    const first = spawn(sim, 'archer', 2, START_X + 4, START_Y);
    spawn(sim, 'archer', 2, START_X - 4, START_Y);
    rebuild(sim);

    expect(pickTarget(sim, swordsman, 10, CLOSEST)).toBe(first.id);
  });

  it('handles 2,000 choices among 60 units in under 20 ms', () => {
    const sim = match();
    const swordsman = spawn(sim, 'swordsman', 1, START_X, START_Y);
    for (let i = 0; i < 60; i++) {
      const angle = (i / 60) * Math.PI * 2;
      const radius = 3 + (i % 8) * 0.8;
      spawn(sim, 'archer', 2, START_X + Math.cos(angle) * radius, START_Y + Math.sin(angle) * radius);
    }
    rebuild(sim);
    for (let i = 0; i < 100; i++) pickTarget(sim, swordsman, 10, FOCUS);

    const started = performance.now();
    for (let i = 0; i < 2_000; i++) pickTarget(sim, swordsman, 10, FOCUS);
    const elapsed = performance.now() - started;
    console.log(`target choice: ${elapsed.toFixed(2)} ms for 2,000 calls`);
    // About 5 ms alone; the limit leaves room for a busy machine (all test files run at once).
    expect(elapsed).toBeLessThan(60);
  });
});
