// The end screen data (UI.md section 7): one line per player, built from the simulation when
// the match is over. Sent once in the lobby's matchEnd message (JSON).

import { gameData } from '../data/index';
import { ENTITY_TYPES } from './entity-types';

const SUPPLY = ENTITY_TYPES.map((id) => gameData.units.find((u) => u.id === id)?.supply ?? 0);
import { TICK_RATE, type MatchSim } from './match-sim';

export interface PlayerSummary {
  slot: number;
  team: number;
  color: number;
  hero: string;
  level: number;
  kills: number;
  deaths: number;
  gold: number;
  camps: number;
  /** Town Hall upgrade levels the hero bought */
  upgrades: number;
  /** faction army supply now, and Town Hall tier (scoreboard) */
  army: number;
  tier: number;
  defeated: boolean;
}

export interface MatchSummary {
  winnerTeam: number;
  seconds: number;
  players: PlayerSummary[];
}

export function matchSummary(sim: MatchSim): MatchSummary {
  const players: PlayerSummary[] = [];
  for (const s of sim.setup.slots) {
    const hero = sim.heroes[s.index];
    const hs = hero?.heroState;
    const f = sim.factions?.get(s.index);
    let upgrades = 0,
      army = 0;
    if (f) {
      for (const n of Object.values(f.upgrades)) upgrades += n;
      for (const id of f.units) {
        const u = sim.get(id);
        if (u?.alive && !u.job) army += SUPPLY[u.type] ?? 0;
      }
    }
    players.push({
      slot: s.index,
      team: s.team,
      color: s.color,
      hero: ENTITY_TYPES[s.heroType] ?? '',
      level: hs?.level ?? 1,
      kills: hs?.stats.kills ?? 0,
      deaths: hs?.stats.deaths ?? 0,
      gold: Math.floor(hs?.stats.goldEarned ?? 0),
      camps: hs?.stats.camps ?? 0,
      upgrades,
      army,
      tier: f?.tier ?? 1,
      defeated: f?.defeated ?? false,
    });
  }
  return { winnerTeam: sim.factions?.winnerTeam ?? 0, seconds: Math.floor(sim.tick / TICK_RATE), players };
}
