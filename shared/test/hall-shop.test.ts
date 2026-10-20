// Phase 8c: the hero buys Town Hall upgrades for its faction.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gameData } from '../src/data/index';
import { parseTerrain } from '../src/map/terrain';
import { buildMatchNav } from '../src/nav/match-nav';
import type { TreeList } from '../src/nav/trees';
import { CommandType } from '../src/sim/commands';
import { entityTypeIndex } from '../src/sim/entity-types';
import { UPGRADE_IDS } from '../src/sim/faction/hall-shop';
import { MatchSim, TICK_RATE } from '../src/sim/match-sim';

const DATA = join(__dirname, '..', 'data');
const terrain = parseTerrain(readFileSync(join(DATA, 'map-terrain.bin')));
const trees = (JSON.parse(readFileSync(join(DATA, 'map-trees.json'), 'utf8')) as { trees: TreeList }).trees;

function setup() {
  const sim = new MatchSim(
    {
      seed: 4,
      noCamps: true,
      slots: [0, 1].map((i) => ({ index: i, heroType: entityTypeIndex('stone_golem'), team: i + 1, color: i, start: i })),
    },
    buildMatchNav(terrain, gameData.map),
    { terrain, trees },
  );
  const hero = sim.heroes[0]!;
  hero.heroState!.gold = 2000;
  const f = sim.factions!.get(0)!;
  const hall = sim.get(f.homeHallId)!;
  // Next to the Town Hall (the hero spawns about 10 units away, the shop range is 6).
  sim.teleport(hero, hall.mover.x + 4.5, hall.mover.y);
  let seq = 0;
  const buy = (id: string) => {
    const ok = sim.queueCommand(0, ++seq, { type: CommandType.BuyUpgrade, upgrade: UPGRADE_IDS.indexOf(id as never) });
    sim.step();
    return ok;
  };
  return { sim, hero, f, buy };
}

describe('Town Hall upgrades', () => {
  it('sells an upgrade at the own Town Hall for hero gold', () => {
    const { sim, hero, f, buy } = setup();
    expect(buy('rich_veins')).toBe(true);
    expect(f.upgrades['rich_veins']).toBe(1);
    expect(hero.heroState!.gold).toBeLessThanOrEqual(2000 - 150);
    expect(sim.gatherFactor(f)).toBeCloseTo(1.1);
    // Needs a Forge first.
    expect(buy('sharper_blades')).toBe(false);
    // Far from the hall: refused.
    sim.teleport(hero, 128, 128);
    expect(buy('stone_walls')).toBe(false);
  });

  it('War Banner works for 60 s and has a cooldown; Tier Up Fund gives earmarked gold', () => {
    const { sim, f, buy } = setup();
    // War Banner is for the army (not workers).
    const worker = sim.factions!.spawnUnit(f, entityTypeIndex('swordsman'), 128, 128);
    const before = worker.stats.damageMax;
    expect(buy('war_banner')).toBe(true);
    expect(worker.stats.damageMax).toBeGreaterThan(before);
    expect(buy('war_banner')).toBe(false); // cooldown
    for (let i = 0; i < 61 * TICK_RATE; i++) sim.step();
    expect(worker.stats.damageMax).toBeCloseTo(before, 5);

    const gold = f.gold;
    expect(buy('tier_up_fund')).toBe(true);
    expect(f.gold).toBeGreaterThanOrEqual(gold + 200);
    expect(f.earmarkedGold).toBe(200);
  });
});
