// Phase 9: stats for the end screen.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gameData } from '../src/data/index';
import { parseTerrain } from '../src/map/terrain';
import { buildMatchNav } from '../src/nav/match-nav';
import { entityTypeIndex } from '../src/sim/entity-types';
import { MatchSim } from '../src/sim/match-sim';
import { matchSummary } from '../src/sim/summary';

const nav = buildMatchNav(parseTerrain(readFileSync(join(__dirname, '..', 'data', 'map-terrain.bin'))), gameData.map);

describe('match summary', () => {
  it('counts hero kills, deaths, gold and cleared camps', () => {
    const sim = new MatchSim(
      {
        seed: 2,
        slots: [0, 1].map((i) => ({
          index: i,
          heroType: entityTypeIndex(i ? 'blood_witch' : 'stone_golem'),
          team: i + 1,
          color: i,
          start: i,
        })),
      },
      nav,
    );
    const [a, b] = [sim.heroes[0]!, sim.heroes[1]!];
    sim.kill(b, { id: a.id, owner: 0, team: 1 });
    // The whole first camp, last hit by hero A.
    const camp = sim.camps[0]!;
    for (const m of camp.members) sim.kill(m, { id: a.id, owner: 0, team: 1 });
    const s = matchSummary(sim);
    const pa = s.players.find((p) => p.slot === 0)!,
      pb = s.players.find((p) => p.slot === 1)!;
    expect(pa).toMatchObject({ hero: 'stone_golem', kills: 1, deaths: 0, camps: 1 });
    expect(pa.gold).toBeGreaterThan(0);
    expect(pb).toMatchObject({ hero: 'blood_witch', kills: 0, deaths: 1 });
    expect(s.winnerTeam).toBe(0);
  });
});
