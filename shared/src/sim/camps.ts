// Neutral camps: monsters wait at home, fight together when someone comes close or hits one,
// run back (and heal) when pulled too far, and come back some time after the whole camp died.

import { gameData } from '../data/index';
import { nearestWalkable } from '../nav/nav-grid';
import { applyMove } from './commands';
import { entityTypeIndex } from './entity-types';
import { rollCampDrop } from './items';
import { canAttackLayer } from './stats';
import { NEUTRAL, NEUTRAL_TEAM, TICK_DT, TICK_RATE, type DamageSource, type MatchSim, type SimEntity } from './match-sim';

const N = gameData.rules.neutrals;

export interface CampState {
  index: number;
  id: string;
  type: string;
  x: number;
  y: number;
  members: SimEntity[];
  /** tick to try to bring the camp back, 0 = camp is alive */
  respawnAt: number;
  /** where the last monster died: the drop falls here */
  lastDeathX: number;
  lastDeathY: number;
}

export function createCamps(sim: MatchSim): CampState[] {
  return gameData.map.camps.map((c, index) => {
    const camp: CampState = {
      index,
      id: c.id,
      type: c.type,
      x: c.pos[0],
      y: c.pos[1],
      members: [],
      respawnAt: 0,
      lastDeathX: 0,
      lastDeathY: 0,
    };
    spawnCamp(sim, camp);
    return camp;
  });
}

function spawnCamp(sim: MatchSim, camp: CampState): void {
  const def = gameData.camps.campTypes.find((t) => t.id === camp.type);
  if (!def) return;
  const types: string[] = [];
  for (const [unit, count] of def.monsters) for (let i = 0; i < count; i++) types.push(unit);
  camp.members = [];
  // Monsters stand in a small ring around the camp spot and look toward the map center.
  const facing = Math.atan2(-(sim.size / 2 - camp.x), sim.size / 2 - camp.y);
  types.forEach((unit, i) => {
    const a = (i / types.length) * Math.PI * 2 + 0.6;
    const r = types.length > 1 ? 1.7 : 0;
    const p = nearestWalkable(sim.nav, camp.x + Math.cos(a) * r, camp.y + Math.sin(a) * r, 10) ?? [camp.x, camp.y];
    const m = sim.spawn(entityTypeIndex(unit), NEUTRAL, NEUTRAL_TEAM, 255, p[0], p[1], facing);
    m.camp = camp.index;
    camp.members.push(m);
  });
  camp.respawnAt = 0;
}

/** Called once per tick before units act. */
export function updateCamps(sim: MatchSim): void {
  for (const camp of sim.camps) {
    if (camp.respawnAt) {
      if (sim.tick >= camp.respawnAt) tryRespawn(sim, camp);
      continue;
    }
    for (const m of camp.members) if (m.alive) think(sim, camp, m);
  }
}

function think(sim: MatchSim, camp: CampState, m: SimEntity): void {
  const home = Math.hypot(m.mover.x - m.homeX, m.mover.y - m.homeY);
  if (m.returning) {
    // Running home: heal fast, ignore everyone.
    m.hp = Math.min(m.stats.maxHp, m.hp + m.stats.maxHp * (N.returnHealPctPerSec / 100) * TICK_DT);
    if (home < 0.4 || !m.mover.path.length) {
      m.returning = false;
      m.mover.path = [];
      m.mover.facing = m.homeFacing;
    }
    return;
  }
  if (home > N.leashRange) return goHome(sim, m);
  const t = m.targetId ? sim.get(m.targetId) : undefined;
  if (t && (!t.alive || Math.hypot(t.mover.x - m.homeX, t.mover.y - m.homeY) > N.leashRange + 2)) m.targetId = 0;
  if (m.targetId) return;
  // Someone still fights the camp? Take the nearest of them. Else look around (every 5 ticks).
  if ((sim.tick + m.id) % 5 !== 0 && home < 0.5) return;
  const found = nearestIntruder(sim, camp, m, home > 0.5 ? N.leashRange : N.aggroRange);
  if (found) aggro(sim, camp, found);
  else if (home > 0.5) goHome(sim, m);
}

function nearestIntruder(sim: MatchSim, camp: CampState, m: SimEntity, range: number): SimEntity | null {
  let best: SimEntity | null = null,
    bestD = Infinity;
  sim.grid.query(m.mover.x, m.mover.y, range, (o, d2) => {
    if (o.team === NEUTRAL_TEAM || o.passive || o.inert || !canAttackLayer(m.stats.canHitAir, o.stats.layer)) return;
    if (sim.isHiddenFrom(o, NEUTRAL_TEAM)) return;
    if (Math.hypot(o.mover.x - camp.x, o.mover.y - camp.y) > N.leashRange) return;
    if (d2 < bestD) {
      bestD = d2;
      best = o;
    }
  });
  return best;
}

/** The whole camp fights: every monster without a target takes this one. */
function aggro(sim: MatchSim, camp: CampState, target: SimEntity): void {
  for (const o of camp.members) {
    if (!o.alive || o.returning || o.targetId) continue;
    if (!canAttackLayer(o.stats.canHitAir, target.stats.layer)) continue;
    o.targetId = target.id;
    o.repathAt = 0;
  }
}

function goHome(sim: MatchSim, m: SimEntity): void {
  m.targetId = 0;
  m.swing = 0;
  m.returning = true;
  applyMove(m.mover, sim.nav, m.homeX, m.homeY, false, sim.isFlying(m));
}

export function onCampMemberAttacked(sim: MatchSim, m: SimEntity, source: DamageSource): void {
  if (m.returning || source.team === NEUTRAL_TEAM) return;
  const camp = sim.camps[m.camp];
  const attacker = sim.get(source.id);
  if (camp && attacker?.alive) aggro(sim, camp, attacker);
}

export function onCampMemberDied(sim: MatchSim, m: SimEntity): void {
  const camp = sim.camps[m.camp];
  if (!camp || camp.members.some((o) => o.alive)) return;
  const def = gameData.camps.campTypes.find((t) => t.id === camp.type);
  camp.lastDeathX = m.mover.x;
  camp.lastDeathY = m.mover.y;
  camp.respawnAt = sim.tick + Math.round((def?.respawnSec ?? 180) * TICK_RATE);
  rollCampDrop(sim, camp);
}

/**
 * Comes back only when no hero is close, so it never pops up in someone's face. A faction
 * building there (a Town Hall on a cleared expansion) keeps the camp away for good.
 */
function tryRespawn(sim: MatchSim, camp: CampState): void {
  let heroNear = false;
  sim.grid.query(camp.x, camp.y, N.respawnNeedsNoHeroInRange, (o) => {
    if (o.hero || (o.alive && o.building?.def)) return (heroNear = true);
  });
  if (heroNear) {
    camp.respawnAt = sim.tick + TICK_RATE; // try again in a second
    return;
  }
  spawnCamp(sim, camp);
}
