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
  /** how far the monsters chase from the camp, and how close one must come to wake them */
  leash: number;
  aggro: number;
}

export function createCamps(sim: MatchSim): CampState[] {
  return gameData.map.camps.map((c, index) => {
    const def = gameData.camps.campTypes.find((t) => t.id === c.type);
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
      leash: def?.leashRange ?? N.leashRange,
      aggro: def?.aggroRange ?? N.aggroRange,
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
  // Monsters stand in a small ring around the camp spot and look toward the map center. Big
  // camps (a spread in the data) stand on rings: the boss in the middle, the rest around it.
  const facing = Math.atan2(-(sim.size / 2 - camp.x), sim.size / 2 - camp.y);
  const spots = campSpots(types.length, def.spread, def.center === true);
  types.forEach((unit, i) => {
    const [dx, dy] = spots[i]!;
    const p = nearestWalkable(sim.nav, camp.x + dx, camp.y + dy, 10) ?? [camp.x, camp.y];
    const m = sim.spawn(entityTypeIndex(unit), NEUTRAL, NEUTRAL_TEAM, 255, p[0], p[1], facing);
    m.camp = camp.index;
    camp.members.push(m);
  });
  camp.respawnAt = 0;
}

/**
 * Offsets of `count` monsters around the camp spot. Without a spread: one small ring (1.7). With
 * one: rings `spread` apart, as many on each as fit about `spread` apart; `center` puts the first
 * monster in the middle.
 */
export function campSpots(count: number, spread?: number, center = false): [number, number][] {
  const out: [number, number][] = [];
  if (!spread) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + 0.6;
      const r = count > 1 ? 1.7 : 0;
      out.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    return out;
  }
  if (center && count > 0) out.push([0, 0]);
  for (let ring = 1; out.length < count; ring++) {
    const r = ring * spread;
    const fit = Math.max(3, Math.floor((Math.PI * 2 * r) / spread));
    const n = Math.min(fit, count - out.length);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.6 + ring * 0.4;
      out.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
  }
  return out;
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
  if (home > camp.leash) return goHome(sim, m);
  const t = m.targetId ? sim.get(m.targetId) : undefined;
  if (t && (!t.alive || Math.hypot(t.mover.x - m.homeX, t.mover.y - m.homeY) > camp.leash + 2)) m.targetId = 0;
  if (m.targetId) {
    // Hit what stands next to you: do not walk past soldiers to reach the hero behind them.
    if ((sim.tick + m.id) % 5 === 0 && t && m.swing !== 1 && !inReach(m, t)) {
      const near = nearestIntruder(sim, camp, m, m.stats.attackRange + m.stats.radius + REACH_SLACK + 1);
      if (near && inReach(m, near)) switchTarget(m, near);
    }
    return;
  }
  // Someone still fights the camp? Take the nearest of them. Else look around (every 5 ticks).
  if ((sim.tick + m.id) % 5 !== 0 && home < 0.5) return;
  const found = nearestIntruder(sim, camp, m, home > 0.5 ? camp.leash : camp.aggro);
  if (found) aggro(sim, camp, found);
  else if (home > 0.5) goHome(sim, m);
}

function nearestIntruder(sim: MatchSim, camp: CampState, m: SimEntity, range: number): SimEntity | null {
  let best: SimEntity | null = null,
    bestD = Infinity;
  sim.grid.query(m.mover.x, m.mover.y, range, (o, d2) => {
    if (o.team === NEUTRAL_TEAM || o.passive || o.inert || !canAttackLayer(m.stats.canHitAir, o.stats.layer)) return;
    if (sim.isHiddenFrom(o, NEUTRAL_TEAM)) return;
    if (Math.hypot(o.mover.x - camp.x, o.mover.y - camp.y) > camp.leash) return;
    if (d2 < bestD) {
      bestD = d2;
      best = o;
    }
  });
  return best;
}

/** Extra gap (tiles) that still counts as "next to me" when a monster looks for a closer target. */
const REACH_SLACK = 0.5;

function inReach(m: SimEntity, o: SimEntity): boolean {
  return Math.hypot(o.mover.x - m.mover.x, o.mover.y - m.mover.y) - m.stats.radius - o.stats.radius <= m.stats.attackRange + REACH_SLACK;
}

function switchTarget(m: SimEntity, o: SimEntity): void {
  m.targetId = o.id;
  m.swing = 0;
  m.repathAt = 0;
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
  if (!camp || !attacker?.alive) return;
  aggro(sim, camp, attacker);
  // Hit by someone close while the own target is out of reach: fight back.
  const t = m.targetId ? sim.get(m.targetId) : undefined;
  if (
    t &&
    t !== attacker &&
    m.swing !== 1 &&
    !inReach(m, t) &&
    inReach(m, attacker) &&
    canAttackLayer(m.stats.canHitAir, attacker.stats.layer)
  )
    switchTarget(m, attacker);
}

export function onCampMemberDied(sim: MatchSim, m: SimEntity, killer?: DamageSource): void {
  const camp = sim.camps[m.camp];
  if (!camp || camp.members.some((o) => o.alive)) return;
  // The camp counts for the player whose unit (or hero) killed the last monster.
  const hs = killer ? sim.creditHero(killer)?.heroState : undefined;
  if (hs) hs.stats.camps++;
  const f = killer && sim.factions?.get(killer.owner);
  if (f) f.campsCleared++;
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
