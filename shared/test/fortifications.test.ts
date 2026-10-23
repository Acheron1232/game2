import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { gameData, parseTerrain, TerrainFlag, buildMatchNav, MatchSim, findPath, type SimEntity } from '../src';
import { tryFortify, WALL_RULES } from '../src/sim/faction/fortifications';

it('each real map base has room for the AI to start a wall wing', () => {
  const terrain = parseTerrain(readFileSync(join(import.meta.dirname, '../data/map-terrain.bin')));
  const trees = JSON.parse(readFileSync(join(import.meta.dirname, '../data/map-trees.json'), 'utf8')).trees;
  const sim = new MatchSim(
    { seed: 8, noCamps: true, slots: [0, 1, 2, 3].map((i) => ({ index: i, heroType: 0, team: i + 1, color: i, start: i })) },
    buildMatchNav(terrain, gameData.map),
    { terrain, trees },
  );
  sim.tick = WALL_RULES.startMinute * 60 * 20;
  for (const f of sim.factions!.list) {
    if (!f) continue;
    f.tier = 2;
    f.gold = 300;
    f.wood = 200;
    const home = sim.get(f.homeHallId)!;
    const worker = [...f.units].map((id) => sim.get(id)!).find((e) => e.job)!;
    expect(
      tryFortify(sim, f, home, () => worker),
      `base ${f.start}`,
    ).toBe('Building wall wings');
  }
});

it('the AI builds four wall segments with a lane to the center and then starts normal upgrades', () => {
  const original = parseTerrain(readFileSync(join(import.meta.dirname, '../data/map-terrain.bin')));
  const terrain = { ...original, flags: new Uint8Array(original.flags.length).fill(TerrainFlag.Passable | TerrainFlag.Buildable) };
  const sim = new MatchSim(
    {
      seed: 4,
      noCamps: true,
      slots: [
        { index: 0, heroType: 0, team: 1, color: 0, start: 0 },
        { index: 1, heroType: 0, team: 2, color: 1, start: 1 },
      ],
    },
    buildMatchNav(terrain, gameData.map),
    { terrain, trees: [] },
  );
  const fs = sim.factions!,
    f = fs.get(0)!,
    home = sim.get(f.homeHallId)!;
  f.tier = 2;
  sim.tick = WALL_RULES.startMinute * 60 * 20;
  const worker = [...f.units].map((id) => sim.get(id)!).find((e) => e.job)!;
  const walls = (): SimEntity[] => [...f.buildings].map((id) => sim.get(id)!).filter((e) => e.building?.def?.id.endsWith('_wall'));
  for (let i = 0; i < 4; i++) {
    f.gold = 300;
    f.wood = 200;
    expect(tryFortify(sim, f, home, () => worker)).toBe('Building wall wings');
    expect(walls()).toHaveLength(i + 1);
    for (const e of walls()) {
      e.building!.done = true;
      e.building!.progress = 1;
    }
  }
  const h = home.mover;
  const path = findPath(sim.nav, h.x + 4, h.y + 4, sim.size / 2, sim.size / 2);
  expect(path.length).toBeGreaterThan(0);
  f.gold = 1000;
  f.wood = 1000;
  expect(tryFortify(sim, f, home, () => worker)).toBe('Upgrading walls');
  expect(walls().some((w) => w.building!.upgradeTo >= 0)).toBe(true);
});
