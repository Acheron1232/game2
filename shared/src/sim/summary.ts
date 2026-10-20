// The end screen data (UI.md section 7): one line per player, built from the simulation when
// the match is over. Sent once in the lobby's matchEnd message (JSON).

import { ENTITY_TYPES } from './entity-types';
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
    let upgrades = 0;
    if (f) for (const n of Object.values(f.upgrades)) upgrades += n;
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
    });
  }
  return { winnerTeam: sim.factions?.winnerTeam ?? 0, seconds: Math.floor(sim.tick / TICK_RATE), players };
}
