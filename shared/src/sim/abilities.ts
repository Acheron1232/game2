import { castEarthSpirit, earthCastProblem, isEarthAbility } from './earth-spirit';
// Hero abilities from abilities.json: checks, the cast (walk into range, cast time, then the
// effect), channels, and the effect of every ability. Plus auras, passives and monster skills.
// Numbers always come from the data; this file only says what each ability does with them.

import { abilityMechanic, gameData, type AbilityDef } from '../data/index';
import { isWalkable, nearestWalkable } from '../nav/nav-grid';
import { qPos } from '../protocol/game';
import { BuffFlag, type Buff } from './buffs';
import { entityTypeIndex } from './entity-types';
import { abilityFxKind, EventType } from './events';
import { TICK_RATE, type DamageSource, type MatchSim, type SimEntity } from './match-sim';
import { ITEMS, itemStat } from './items';
import { canAttackLayer, canLearn, unitStats, type Layer } from './stats';

export const ABILITIES: readonly AbilityDef[] = gameData.abilities;
const INDEX = new Map(ABILITIES.map((a, i) => [a.id, i]));
const secs = (s: number) => Math.round(s * TICK_RATE);

export function abilityIndex(id: string): number {
  return INDEX.get(id) ?? -1;
}

/** The value of a number or per-level list at a level (1-based). */
export function lv(v: number | number[] | string | boolean | undefined, level: number): number {
  if (Array.isArray(v)) return v[Math.min(v.length, Math.max(1, level)) - 1] ?? 0;
  return typeof v === 'number' ? v : 0;
}

export function param(a: AbilityDef, key: string, level: number): number {
  return lv(a.params[key], level);
}

export function heroAbility(e: SimEntity, slot: number): AbilityDef | undefined {
  const id = e.heroState?.def.abilities[slot];
  return id ? ABILITIES[abilityIndex(id)] : undefined;
}

export interface CastTarget {
  /** 0 = none, 1 = unit, 2 = point */
  kind: 0 | 1 | 2;
  id: number;
  x: number;
  y: number;
}

/** Health cost of Blood Bolt and friends (paid instead of mana). */
function healthCost(a: AbilityDef, level: number): number {
  return param(a, 'healthCost', level);
}

/** Can this unit be the target of this ability? */
export function targetAllowed(sim: MatchSim, caster: SimEntity, a: AbilityDef, t: SimEntity): boolean {
  if (!t.alive || t.hidden) return false;
  if (a.id === 'enchant_remnant' && t.building) return false;
  return abilityTargetAllowed(a, t === caster ? 'self' : t.team === caster.team ? 'ally' : 'enemy', t.stats.layer);
}

/** Shared with aiming feedback; low-air targets use the ground filter, like in combat. */
export function abilityTargetAllowed(a: AbilityDef, relation: 'self' | 'ally' | 'enemy', layer: Layer): boolean {
  const f = a.filter;
  if (!f.includes(relation)) return false;
  const air = layer === 'air';
  if (air && !f.includes('air')) return false;
  if (!air && !f.includes('ground') && relation !== 'self') return false;
  return true;
}

/** Why a cast is refused (null = it is fine now). Same checks when it is ordered and when it fires. */
export function castProblem(sim: MatchSim, e: SimEntity, slot: number, target: CastTarget): string | null {
  const hs = e.heroState;
  const a = heroAbility(e, slot);
  if (!hs || !a) return 'no ability';
  const level = hs.abilityLevels[slot] ?? 0;
  if (level < 1) return 'not learned';
  if (a.kind !== 'active') return 'passive';
  const earthProblem = earthCastProblem(sim, e, a, target);
  if (earthProblem) return earthProblem;
  if (!e.alive) return 'dead';
  if (sim.isStunned(e) || (e.forced && !(a.id === 'stone_remnant' && e.buffs.some((b) => b.flags & BuffFlag.Rolling)))) return 'stunned';
  if (sim.isSilenced(e)) return 'silenced';
  if ((e.cooldowns[slot] ?? 0) > sim.tick) return 'cooldown';
  if (e.mana < lv(a.manaCost, level)) return 'mana';
  const hc = healthCost(a, level);
  if (hc && e.hp <= hc) return 'health';
  if (a.target === 'unit') {
    if (target.kind !== 1) return 'target';
    const t = sim.get(target.id);
    if (!t || !targetAllowed(sim, e, a, t) || !sim.canSee(e.team, t)) return 'target';
  }
  if (a.target === 'point' || a.target === 'line' || a.target === 'cone') {
    if (target.kind !== 2 || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return 'target';
    if (target.x < 0 || target.y < 0 || target.x > sim.size || target.y > sim.size) return 'target';
  }
  return null;
}

/** Abilities that jump or move the hero use the range as the most they go; others walk closer. */
const CLAMP_RANGE = new Set([
  'blink',
  'sky_pillar',
  'inferno_dive',
  'great_charge',
  'boulder_smash',
  'rolling_boulder',
  'geomagnetic_grip',
]);

/** How far away the cast may start. Infinity = no need to walk (self, line, cone, jumps). */
export function castReach(e: SimEntity, a: AbilityDef, level: number, t: SimEntity | undefined): number {
  if (a.target === 'none' || a.target === 'line' || a.target === 'cone' || CLAMP_RANGE.has(abilityMechanic(a))) return Infinity;
  const r = a.id === 'enchant_remnant' && t && t.team !== e.team ? param(a, 'enemyRange', level) : lv(a.castRange, level);
  return a.target === 'unit' && t ? r + e.stats.radius + t.stats.radius : r;
}

export function learn(sim: MatchSim, e: SimEntity, slot: number): boolean {
  const hs = e.heroState;
  const a = heroAbility(e, slot);
  if (!hs || !a || hs.skillPoints <= 0) return false;
  if (a.params['innate']) return false;
  const cur = hs.abilityLevels[slot] ?? 0;
  if (!canLearn(slot, cur, a.maxLevel, hs.level)) return false;
  hs.abilityLevels[slot] = cur + 1;
  hs.skillPoints--;
  refreshPassives(sim, e);
  return true;
}

/** Passive abilities that are plain stat buffs (Dragon Scales). Flurry is used in the attack. */
export function refreshPassives(sim: MatchSim, e: SimEntity): void {
  const hs = e.heroState!;
  hs.def.abilities.forEach((id, slot) => {
    const a = ABILITIES[abilityIndex(id)]!;
    if (a.params['innate'] && hs.level >= Number(a.params['unlockLevel'] ?? 1)) hs.abilityLevels[slot] = 1;
    const level = hs.abilityLevels[slot] ?? 0;
    if (a.kind !== 'passive' || level < 1 || abilityMechanic(a) === 'flurry') return;
    sim.addBuff(e, {
      id: `passive:${a.id}`,
      sourceId: e.id,
      sourceOwner: e.owner,
      sourceTeam: e.team,
      until: Infinity,
      flags: 0,
      bonusArmor: param(a, 'bonusArmor', level),
      spellReductionPct: param(a, 'spellReductionPct', level),
    });
  });
}

/** Flurry: chance for an attack to hit twice. */
export function extraHitChance(e: SimEntity): number {
  const hs = e.heroState;
  if (!hs) return 0;
  const slot = hs.def.abilities.indexOf('flurry');
  if (slot < 0 || !hs.abilityLevels[slot]) return 0;
  return param(ABILITIES[abilityIndex('flurry')]!, 'chancePct', hs.abilityLevels[slot]!) / 100;
}

// ---------- the cast ----------

/** Stone placement is instant and never interrupts a roll, walk or another cast. */
export function placeInstantStone(sim: MatchSim, e: SimEntity, slot: number, target: CastTarget): void {
  const a = heroAbility(e, slot);
  if (!a || a.id !== 'stone_remnant' || castProblem(sim, e, slot, target)) return;
  castEarthSpirit(sim, e, a, 1, target);
  sim.events.push(EventType.AbilityEffect, e.id, qPos(target.x), qPos(target.y), abilityFxKind(abilityIndex(a.id), 1, true));
}

/** A new cast order (already checked). The hero walks into range first if it needs to. */
export function orderCast(sim: MatchSim, e: SimEntity, slot: number, target: CastTarget): void {
  e.order = 'cast';
  e.targetId = 0;
  e.swing = 0;
  e.cast = { slot, target, castEnd: 0, channelEnd: 0, nextWave: 0, wave: 0 };
}

/** Every tick for a hero with a cast order. */
export function updateCast(sim: MatchSim, e: SimEntity): void {
  const c = e.cast;
  if (!c) return;
  const a = heroAbility(e, c.slot)!;
  const level = e.heroState!.abilityLevels[c.slot] ?? 1;
  if (c.channelEnd) return updateChannel(sim, e, a, level);
  const t = c.target.kind === 1 ? sim.get(c.target.id) : undefined;
  if (c.castEnd === 0) {
    const problem = castProblem(sim, e, c.slot, c.target);
    if (problem) return endCast(sim, e);
    const tx = t ? t.mover.x : c.target.x,
      ty = t ? t.mover.y : c.target.y;
    const reach = castReach(e, a, level, t);
    const d = Math.hypot(tx - e.mover.x, ty - e.mover.y);
    if (d > reach) {
      // Walk closer, re-plan now and then (the target may move).
      if (sim.tick >= e.repathAt || !e.mover.path.length) {
        e.repathAt = sim.tick + 10;
        sim.moveTo(e, tx, ty);
      }
      return;
    }
    e.mover.path = [];
    if (c.target.kind !== 0 && d > 0.01) e.mover.facing = Math.atan2(-(tx - e.mover.x), ty - e.mover.y);
    c.castEnd = sim.tick + Math.max(1, secs(a.castTime));
    const idx = abilityIndex(a.id);
    if (c.target.kind === 2) sim.events.push(EventType.Cast, e.id, qPos(c.target.x), qPos(c.target.y), idx | 128);
    else sim.events.push(EventType.Cast, e.id, c.target.kind === 1 ? c.target.id : 0, 0, idx);
    return;
  }
  if (sim.tick < c.castEnd) return;
  // The effect: check once more (mana, stun...), pay, start the cooldown.
  if (castProblem(sim, e, c.slot, c.target)) return endCast(sim, e);
  sim.breakInvisible(e);
  e.mana -= lv(a.manaCost, level);
  const hc = healthCost(a, level);
  if (hc) e.hp -= hc;
  // Cooldown items (Timeworn Tome...) cut it.
  e.cooldowns[c.slot] = sim.tick + secs(lv(a.cooldown, level) * (1 - itemStat(e.heroState!, 'cooldownReductionPct') / 100));
  const kind = abilityFxKind(abilityIndex(a.id), level, c.target.kind === 2);
  sim.events.push(
    EventType.AbilityEffect,
    e.id,
    c.target.kind === 2 ? qPos(c.target.x) : c.target.id,
    c.target.kind === 2 ? qPos(c.target.y) : 0,
    kind,
  );
  const stay = isEarthAbility(a.id)
    ? castEarthSpirit(sim, e, a, level, c.target, t)
    : EFFECTS[abilityMechanic(a)]?.(sim, e, a, level, c.target, t);
  if (stay !== true) endCast(sim, e);
}

export function endCast(sim: MatchSim, e: SimEntity): void {
  if (e.cast?.channelEnd) {
    sim.events.push(EventType.ChannelEnd, e.id);
    sim.removeBuff(e, 'channel', e.id);
  }
  e.cast = null;
  if (e.order === 'cast') e.order = 'idle';
}

function updateChannel(sim: MatchSim, e: SimEntity, a: AbilityDef, level: number): void {
  const c = e.cast!;
  if (sim.isStunned(e) || sim.isSilenced(e) || sim.tick >= c.channelEnd) return endCast(sim, e);
  if (sim.tick < c.nextWave) return;
  const waves = param(a, 'waves', level);
  c.nextWave = sim.tick + Math.max(1, Math.round(secs(param(a, 'channelTime', level)) / waves));
  c.wave++;
  forEnemies(sim, e, c.target.x, c.target.y, param(a, 'radius', level), (t) => sim.spellHit(t, param(a, 'damagePerWave', level), e));
  if (c.wave >= waves) endCast(sim, e);
}

// ---------- helpers for effects ----------

type Effect = (sim: MatchSim, e: SimEntity, a: AbilityDef, level: number, target: CastTarget, t: SimEntity | undefined) => boolean | void;

function src(e: SimEntity): DamageSource {
  return { id: e.id, owner: e.owner, team: e.team };
}

function forEnemies(
  sim: MatchSim,
  e: DamageSource & { team: number },
  x: number,
  y: number,
  r: number,
  fn: (t: SimEntity) => void,
  air = true,
): void {
  const hit: SimEntity[] = [];
  sim.grid.query(x, y, r + 1, (t) => {
    if (!t.alive || t.team === e.team || (!air && t.stats.layer === 'air')) return;
    if (Math.hypot(t.mover.x - x, t.mover.y - y) <= r + t.stats.radius) hit.push(t);
  });
  for (const t of hit) fn(t);
}

function forAllies(sim: MatchSim, team: number, x: number, y: number, r: number, fn: (t: SimEntity) => void): void {
  const hit: SimEntity[] = [];
  sim.grid.query(x, y, r + 1, (t) => {
    if (t.alive && t.team === team && Math.hypot(t.mover.x - x, t.mover.y - y) <= r + t.stats.radius) hit.push(t);
  });
  for (const t of hit) fn(t);
}

function debuff(sim: MatchSim, caster: SimEntity, t: SimEntity, id: string, seconds: number, b: Partial<Buff>): void {
  if (seconds <= 0) return;
  sim.addBuff(t, {
    id,
    sourceId: caster.id,
    sourceOwner: caster.owner,
    sourceTeam: caster.team,
    until: sim.tick + secs(seconds),
    flags: 0,
    ...b,
  });
}

function stun(sim: MatchSim, caster: SimEntity, t: SimEntity, seconds: number): void {
  debuff(sim, caster, t, 'stun', seconds, { stun: true, flags: BuffFlag.Stun });
}

/** Push a unit away from (fx, fy) by `dist` over a quarter second. Stops at walls. */
function knockback(sim: MatchSim, t: SimEntity, fx: number, fy: number, dist: number): void {
  if (dist <= 0 || t.stats.layer === 'air') return;
  let dx = t.mover.x - fx,
    dy = t.mover.y - fy;
  const d = Math.hypot(dx, dy) || 1;
  dx /= d;
  dy /= d;
  sim.forceMove(t, t.mover.x + dx * dist, t.mover.y + dy * dist, 0.25, 'knock');
}

/** The farthest point toward (x, y) within `range` (for jumps and blink). */
function clampPoint(e: SimEntity, x: number, y: number, range: number, min = 0): [number, number] {
  let dx = x - e.mover.x,
    dy = y - e.mover.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-3) return [e.mover.x, e.mover.y];
  const want = Math.max(min, Math.min(range, d));
  dx /= d;
  dy /= d;
  return [e.mover.x + dx * want, e.mover.y + dy * want];
}

/** Ground units must land on open ground. */
function landing(sim: MatchSim, e: SimEntity, x: number, y: number): [number, number] {
  if (sim.isFlying(e) || isWalkable(sim.nav, x, y)) return [x, y];
  return nearestWalkable(sim.nav, x, y, 16, 0) ?? [e.mover.x, e.mover.y];
}

// ---------- every ability ----------

export const EFFECTS: Record<string, Effect> = {
  // Blood Witch
  blood_bolt: (sim, e, a, level, _tg, t) => {
    if (t)
      sim.spellProjectile(e, t, param(a, 'projectileSpeed', level), abilityIndex(a.id), (hit) =>
        sim.spellHit(hit, param(a, 'damage', level), e),
      );
  },
  bleed: (sim, e, a, level, _tg, t) => {
    if (!t) return;
    debuff(sim, e, t, 'bleed', param(a, 'duration', level), {
      dps: param(a, 'damagePerSec', level),
      slowPct: param(a, 'slowPct', level),
      flags: BuffFlag.Burning | BuffFlag.Slow,
    });
  },
  blood_moon: (sim, e, a, level, tg) => {
    const healFactor = param(a, 'healFactor', level);
    sim.addZone(e, tg.x, tg.y, param(a, 'radius', level), param(a, 'duration', level), abilityIndex(a.id), (z) => {
      forEnemies(sim, e, z.x, z.y, z.radius, (t) => {
        const dealt = sim.spellHit(t, param(a, 'damagePerSec', level) * 0.5, e);
        if (e.alive && dealt > 0) sim.heal(e, dealt * healFactor, src(e));
      });
    });
  },
  // Staff Warrior
  sweep: (sim, e, a, level) => {
    forEnemies(
      sim,
      e,
      e.mover.x,
      e.mover.y,
      param(a, 'radius', level),
      (t) => {
        sim.spellHit(t, param(a, 'damage', level), e);
        knockback(sim, t, e.mover.x, e.mover.y, param(a, 'knockback', level));
      },
      false,
    );
  },
  iron_stance: (sim, e, a, level) => {
    debuff(sim, e, e, 'iron_stance', param(a, 'duration', level), {
      damageBlockPct: param(a, 'damageBlockPct', level),
      slowPct: param(a, 'selfSlowPct', level),
      flags: BuffFlag.Shield,
    });
  },
  sky_pillar: (sim, e, a, level, tg) => {
    const [x, y] = landing(sim, e, ...clampPoint(e, tg.x, tg.y, lv(a.castRange, level)));
    sim.forceMove(e, x, y, param(a, 'leapTime', level), 'leap', () => {
      sim.events.push(EventType.Impact, e.id, qPos(x), qPos(y), abilityFxKind(abilityIndex(a.id), level));
      forEnemies(
        sim,
        e,
        x,
        y,
        param(a, 'radius', level),
        (t) => {
          sim.spellHit(t, param(a, 'damage', level), e);
          stun(sim, e, t, param(a, 'stunDuration', level));
        },
        false,
      );
    });
  },
  // Sky Dragon
  fire_breath: (sim, e, a, level, tg) => {
    const len = param(a, 'length', level),
      half = (param(a, 'angleDeg', level) * Math.PI) / 360;
    const dir = Math.atan2(tg.y - e.mover.y, tg.x - e.mover.x);
    e.mover.facing = Math.atan2(-(tg.x - e.mover.x), tg.y - e.mover.y);
    forEnemies(sim, e, e.mover.x, e.mover.y, len, (t) => {
      const ang = Math.atan2(t.mover.y - e.mover.y, t.mover.x - e.mover.x);
      const diff = Math.abs(Math.atan2(Math.sin(ang - dir), Math.cos(ang - dir)));
      if (diff <= half || Math.hypot(t.mover.x - e.mover.x, t.mover.y - e.mover.y) < 1) sim.spellHit(t, param(a, 'damage', level), e);
    });
  },
  wing_gust: (sim, e, a, level) => {
    forEnemies(
      sim,
      e,
      e.mover.x,
      e.mover.y,
      param(a, 'radius', level),
      (t) => {
        sim.spellHit(t, param(a, 'damage', level), e);
        knockback(sim, t, e.mover.x, e.mover.y, param(a, 'knockback', level));
        debuff(sim, e, t, 'wing_gust', param(a, 'slowDuration', level), { slowPct: param(a, 'slowPct', level), flags: BuffFlag.Slow });
      },
      false,
    );
  },
  inferno_dive: (sim, e, a, level, tg) => {
    const [x, y] = landing(sim, e, ...clampPoint(e, tg.x, tg.y, lv(a.castRange, level)));
    sim.forceMove(e, x, y, param(a, 'diveTime', level), 'dive', () => {
      const r = param(a, 'radius', level);
      sim.events.push(EventType.Impact, e.id, qPos(x), qPos(y), abilityFxKind(abilityIndex(a.id), level));
      forEnemies(sim, e, x, y, r, (t) => sim.spellHit(t, param(a, 'impactDamage', level), e), false);
      sim.addZone(e, x, y, r, param(a, 'burnDuration', level), abilityIndex(a.id), (z) =>
        forEnemies(sim, e, z.x, z.y, z.radius, (t) => sim.spellHit(t, param(a, 'burnDamagePerSec', level) * 0.5, e), false),
      );
    });
  },
  // Stone Golem
  boulder_toss: (sim, e, a, level, _tg, t) => {
    if (!t) return;
    sim.spellProjectile(e, t, param(a, 'projectileSpeed', level), abilityIndex(a.id), (hit) => {
      sim.spellHit(hit, param(a, 'damage', level), e);
      stun(sim, e, hit, param(a, 'stunDuration', level));
    });
  },
  stone_skin: (sim, e, a, level) => {
    debuff(sim, e, e, 'stone_skin', param(a, 'duration', level), {
      damageReductionPct: param(a, 'damageReductionPct', level),
      flags: BuffFlag.Shield,
    });
  },
  tremor: (sim, e, a, level) => {
    forEnemies(
      sim,
      e,
      e.mover.x,
      e.mover.y,
      param(a, 'radius', level),
      (t) => {
        sim.spellHit(t, param(a, 'damage', level), e);
        debuff(sim, e, t, 'tremor', param(a, 'slowDuration', level), { slowPct: param(a, 'slowPct', level), flags: BuffFlag.Slow });
      },
      false,
    );
  },
  mountain_form: (sim, e, a, level) => {
    debuff(sim, e, e, 'mountain_form', param(a, 'duration', level), {
      bonusMaxHpPct: param(a, 'bonusMaxHpPct', level),
      scale: param(a, 'scale', level),
      flags: BuffFlag.Big,
    });
    forEnemies(sim, e, e.mover.x, e.mover.y, param(a, 'tauntRadius', level), (t) => {
      if (!canAttackLayer(t.stats.canHitAir, e.stats.layer)) return;
      debuff(sim, e, t, 'taunt', param(a, 'tauntDuration', level), { tauntId: e.id, flags: BuffFlag.Taunted });
      t.targetId = e.id;
    });
  },
  // Light Healer
  radiant_touch: (sim, e, a, level, _tg, t) => {
    if (t) sim.heal(t, param(a, 'heal', level), src(e));
  },
  blessing: (sim, e, a, level, _tg, t) => {
    if (!t) return;
    debuff(sim, e, t, 'blessing', param(a, 'duration', level), {
      bonusArmor: param(a, 'bonusArmor', level),
      moveSpeedPct: param(a, 'moveSpeedPct', level),
      flags: BuffFlag.Blessed,
    });
  },
  sanctuary: (sim, e, a, level, tg) => {
    sim.addZone(e, tg.x, tg.y, param(a, 'radius', level), param(a, 'duration', level), abilityIndex(a.id), (z) =>
      forAllies(sim, e.team, z.x, z.y, z.radius, (t) => sim.heal(t, param(a, 'healPerSec', level) * 0.5, src(e))),
    );
  },
  dawn_shield: (sim, e, a, level, _tg, t) => {
    if (!t) return;
    debuff(sim, e, t, 'dawn_shield', param(a, 'duration', level), {
      minHp: param(a, 'minHp', level),
      healAtEnd: param(a, 'healAtEnd', level),
      flags: BuffFlag.Shield | BuffFlag.Blessed,
    });
  },
  // Arcane Huntress
  arcane_arrow: (sim, e, a, level, tg) => {
    sim.lineShot(
      e,
      tg.x,
      tg.y,
      param(a, 'length', level),
      param(a, 'width', level),
      param(a, 'projectileSpeed', level),
      a.params['hitsFirstOnly'] === true,
      abilityIndex(a.id),
      (t) => sim.spellHit(t, param(a, 'damage', level), e),
    );
  },
  blink: (sim, e, a, level, tg) => {
    const [x, y] = landing(sim, e, ...clampPoint(e, tg.x, tg.y, lv(a.castRange, level), param(a, 'minRange', level)));
    sim.events.push(EventType.Impact, e.id, qPos(x), qPos(y), abilityFxKind(abilityIndex(a.id), level));
    sim.teleport(e, x, y);
  },
  mana_mark: (sim, e, a, level, _tg, t) => {
    if (!t) return;
    debuff(sim, e, t, 'mana_mark', param(a, 'duration', level), {
      spellDamageTakenPct: param(a, 'bonusSpellDamagePct', level),
      reveal: a.params['reveals'] === true,
      flags: BuffFlag.Marked,
    });
  },
  arcane_storm: (sim, e, a, level, tg) => {
    // Channel: the hero stands still; waves come over the channel time.
    const c = e.cast!;
    c.channelEnd = sim.tick + secs(param(a, 'channelTime', level));
    c.nextWave = sim.tick;
    c.target = { ...tg };
    debuff(sim, e, e, 'channel', param(a, 'channelTime', level), { flags: BuffFlag.Channel });
    updateChannel(sim, e, a, level);
    return true;
  },
  // Centaur Raider
  spear_throw: (sim, e, a, level, tg) => {
    sim.lineShot(
      e,
      tg.x,
      tg.y,
      param(a, 'length', level),
      param(a, 'width', level),
      param(a, 'projectileSpeed', level),
      a.params['hitsFirstOnly'] === true,
      abilityIndex(a.id),
      (t) => sim.spellHit(t, param(a, 'damage', level), e),
    );
  },
  trample: (sim, e, a, level) => {
    forEnemies(
      sim,
      e,
      e.mover.x,
      e.mover.y,
      param(a, 'radius', level),
      (t) => {
        sim.spellHit(t, param(a, 'damage', level), e);
        stun(sim, e, t, param(a, 'stunDuration', level));
      },
      false,
    );
  },
  great_charge: (sim, e, a, level, tg) => {
    const [x, y] = landing(sim, e, ...clampPoint(e, tg.x, tg.y, lv(a.castRange, level)));
    const dist = Math.hypot(x - e.mover.x, y - e.mover.y);
    const dx = (x - e.mover.x) / (dist || 1),
      dy = (y - e.mover.y) / (dist || 1);
    const hit = new Set<number>();
    const width = param(a, 'width', level);
    sim.forceMove(e, x, y, dist / param(a, 'chargeSpeed', level), 'charge', undefined, () => {
      // Every tick of the charge: hit enemies next to the path once and throw them aside.
      forEnemies(
        sim,
        e,
        e.mover.x,
        e.mover.y,
        width / 2 + 0.5,
        (t) => {
          if (hit.has(t.id)) return;
          hit.add(t.id);
          sim.spellHit(t, param(a, 'damage', level), e);
          stun(sim, e, t, param(a, 'stunDuration', level));
          // Aside: to the left or right of the charge, whichever side the unit is on.
          const side = Math.sign((t.mover.x - e.mover.x) * dy - (t.mover.y - e.mover.y) * dx) || 1;
          knockback(sim, t, t.mover.x - dy * side, t.mover.y + dx * side, param(a, 'sideKnockback', level));
        },
        false,
      );
    });
  },
  // Forest Elf
  vine_snare: (sim, e, a, level, _tg, t) => {
    if (!t) return;
    debuff(sim, e, t, 'vine_snare', param(a, 'rootDuration', level), {
      root: true,
      dps: param(a, 'damagePerSec', level),
      flags: BuffFlag.Root | BuffFlag.Burning,
    });
  },
  forest_spirit: (sim, e, a, level, tg) => {
    const count = param(a, 'count', level);
    const unit = gameData.units.find((u) => u.id === a.params['summonUnit'])!;
    for (let i = 0; i < count; i++) {
      const p = nearestWalkable(sim.nav, tg.x + i * 1.5, tg.y, 10) ?? [e.mover.x, e.mover.y];
      const s = sim.spawn(entityTypeIndex(unit.id), e.owner, e.team, e.color, p[0], p[1], e.mover.facing);
      const base = unitStats(unit);
      base.maxHp = param(a, 'summonHp', level);
      base.damageMin = base.damageMax = param(a, 'summonDamage', level);
      s.base = base;
      s.stats = base;
      s.hp = base.maxHp;
      s.leaderId = e.id;
      s.removeAt = 0;
      s.summonUntil = sim.tick + secs(param(a, 'duration', level));
    }
  },
  wrath_of_the_grove: (sim, e, a, level) => {
    forEnemies(
      sim,
      e,
      e.mover.x,
      e.mover.y,
      param(a, 'radius', level),
      (t) => {
        sim.spellHit(t, param(a, 'damage', level), e);
        debuff(sim, e, t, 'wrath_of_the_grove', param(a, 'rootDuration', level), { root: true, flags: BuffFlag.Root });
      },
      false,
    );
  },
};

// ---------- auras ----------

const AURA_PARAMS: Record<string, (a: AbilityDef, level: number) => Partial<Buff>> = {
  crimson_pact: (a, l) => ({ lifeStealPct: param(a, 'lifeStealPct', l) }),
  herd_call: (a, l) => ({ moveSpeedPct: param(a, 'moveSpeedPct', l), attackSpeedPct: param(a, 'attackSpeedPct', l) }),
  natures_gift: (a, l) => ({ hpRegen: param(a, 'bonusHpRegen', l) }),
};

/** Every half second: heroes with an aura give it to allies near (and themselves). */
export function updateAuras(sim: MatchSim): void {
  if (sim.tick % 10 !== 0) return;
  // Unit and defense auras use the same short-lived buffs as hero/item auras.
  // sourceId 0 keeps equal support units from multiplying the same aura.
  for (const e of sim.entities) {
    if (!e.alive || e.hidden || (e.building && !e.building.done)) continue;
    for (const s of monsterSkills(e)) {
      if (!s.aura) continue;
      forAllies(sim, e.team, e.mover.x, e.mover.y, s.radius ?? 5, (t) => {
        if (s.rangedOnly && (t.building || t.stats.attackRange <= 2)) return;
        if (s.unitsOnly && t.building) return;
        if (s.outOfCombat && (t.building || t.targetId || (t.lastHitBy && sim.tick - t.lastHitAt < secs(5)))) return;
        sim.addBuff(t, {
          id: `unit-aura:${s.id}`,
          sourceId: 0,
          sourceOwner: e.owner,
          sourceTeam: e.team,
          until: sim.tick + 12,
          flags: 0,
          ...(s.bonusArmor ? { bonusArmor: s.bonusArmor } : {}),
          ...(s.hpRegen ? { hpRegen: s.hpRegen } : {}),
          ...(s.rangedReductionPct ? { rangedReductionPct: s.rangedReductionPct } : {}),
          ...(s.repairSpeedPct ? { repairSpeedPct: s.repairSpeedPct } : {}),
          ...(s.attackSpeedPct ? { attackSpeedPct: s.attackSpeedPct } : {}),
        });
      });
    }
    if (e.building) monsterCast(sim, e, true);
  }
  for (const h of sim.heroes) {
    const hs = h?.heroState;
    if (!h || !hs || !h.alive) continue;
    hs.def.abilities.forEach((id, slot) => {
      const level = hs.abilityLevels[slot] ?? 0;
      const a = ABILITIES[abilityIndex(id)]!;
      const make = AURA_PARAMS[abilityMechanic(a)];
      if (!make || level < 1) return;
      forAllies(sim, h.team, h.mover.x, h.mover.y, param(a, 'radius', level), (t) =>
        sim.addBuff(t, {
          id: `aura:${id}`,
          sourceId: h.id,
          sourceOwner: h.owner,
          sourceTeam: h.team,
          until: sim.tick + 12,
          flags: 0,
          ...make(a, level),
        }),
      );
    });
    // Item auras (Banner of Valor...). sourceId 0: the same item on two heroes does not stack.
    const seen = new Set<number>();
    for (const st of hs.inventory) {
      const def = st && !seen.has(st.item) ? ITEMS[st.item] : undefined;
      if (!def?.aura) continue;
      seen.add(st!.item);
      const { radius, bonusArmor, hpRegen, attackSpeedPct, moveSpeedPct, damagePct } = def.aura;
      forAllies(sim, h.team, h.mover.x, h.mover.y, radius, (t) =>
        sim.addBuff(t, {
          id: `item-aura:${def.id}`,
          sourceId: 0,
          sourceOwner: h.owner,
          sourceTeam: h.team,
          until: sim.tick + 12,
          flags: 0,
          ...(bonusArmor ? { bonusArmor } : {}),
          ...(hpRegen ? { hpRegen } : {}),
          ...(attackSpeedPct ? { attackSpeedPct } : {}),
          ...(moveSpeedPct ? { moveSpeedPct } : {}),
          ...(damagePct ? { damagePct } : {}),
        }),
      );
    }
  }
}

// ---------- unit skills (monsters, army units, hired soldiers) ----------
// Units use them by themselves in a fight. The player can also press an active skill of an own
// unit (CommandType.UnitCast): then it goes off now, at the target the player chose.
// Names, targets and the effect code are in skills.json, the numbers on the unit in units.json.

interface SkillDef {
  id: string;
  cooldown?: number;
  radius?: number;
  range?: number;
  heal?: number;
  damage?: number;
  damagePct?: number;
  slowPct?: number;
  duration?: number;
  rootDuration?: number;
  stunDuration?: number;
  spellReductionPct?: number;
  bonusArmor?: number;
  bonusSpellDamagePct?: number;
  hpRegen?: number;
  passive?: boolean;
  manaCost?: number;
  aura?: boolean;
  rangedOnly?: boolean;
  outOfCombat?: boolean;
  buildingsOnly?: boolean;
  groundOnly?: boolean;
  rangedReductionPct?: number;
  repairSpeedPct?: number;
  sharePct?: number;
  jumps?: number;
  distance?: number;
  attackSpeedPct?: number;
  minRange?: number;
  constructOnly?: boolean;
  unitsOnly?: boolean;
  summonUnit?: string;
  healThreshold?: number;
}

export function monsterSkills(e: SimEntity): SkillDef[] {
  if (e.building) return (e.building.def?.skills ?? []) as SkillDef[];
  return (gameData.units.find((u) => u.id === unitId(e))?.skills ?? []) as SkillDef[];
}

function unitId(e: SimEntity): string {
  return gameData.units[e.type - gameData.heroes.length]?.id ?? '';
}

const SKILL_INFO = new Map(gameData.skills.map((s) => [s.id, s]));

function skillEffect(s: SkillDef): string {
  return SKILL_INFO.get(s.id)?.effect ?? s.id;
}

/** Passive unit skills at spawn (Stone Guard, Troll Blood). */
export function monsterPassives(sim: MatchSim, e: SimEntity): void {
  for (const s of monsterSkills(e)) {
    if (s.passive && !s.aura && (s.spellReductionPct || s.hpRegen || s.rangedReductionPct))
      sim.addBuff(e, {
        id: `passive:${s.id}`,
        sourceId: e.id,
        sourceOwner: e.owner,
        sourceTeam: e.team,
        until: Infinity,
        flags: 0,
        ...(s.spellReductionPct ? { spellReductionPct: s.spellReductionPct } : {}),
        ...(s.hpRegen ? { hpRegen: s.hpRegen } : {}),
        ...(s.rangedReductionPct ? { rangedReductionPct: s.rangedReductionPct } : {}),
      });
  }
}

/**
 * A unit uses its skills when they are ready and useful. Skills on allies (Mend, Faith Ward) also
 * work when the unit itself is not fighting; the others only while it fights.
 */
export function monsterCast(sim: MatchSim, m: SimEntity, defensePulse = false): void {
  if ((!defensePulse && (sim.tick + m.id) % 10 !== 0) || sim.isStunned(m) || sim.isSilenced(m)) return;
  monsterSkills(m).forEach((s, index) => {
    if (s.passive || (m.skillReady[s.id] ?? 0) > sim.tick) return;
    if (m.mana < (s.manaCost ?? 0)) return;
    if (!m.building && !m.targetId && SKILL_INFO.get(s.id)?.targets !== 'ally') return;
    const target = useSkill(sim, m, s, null, false);
    if (target === false) return;
    paySkill(sim, m, s, index, target);
  });
}

function paySkill(sim: MatchSim, m: SimEntity, s: SkillDef, index: number, target: number): void {
  m.mana -= s.manaCost ?? 0;
  m.skillReady[s.id] = sim.tick + secs(s.cooldown ?? 10);
  // kind 255 = a unit skill; b = its index in the unit's list, value = the target (client cooldowns).
  sim.events.push(EventType.Cast, m.id, index, target, 255);
}

/** Why an own unit can not use its skill now (null = it can). The client checks the same things first. */
export function unitSkillProblem(sim: MatchSim, hero: SimEntity, unitId: number, index: number, targetId: number): string | null {
  const m = sim.get(unitId);
  if (!m || !m.alive || m.hero || m.owner !== hero.owner || m.team !== hero.team) return 'not your unit';
  const s = monsterSkills(m)[index];
  const info = s && SKILL_INFO.get(s.id);
  if (!s || !info || info.kind !== 'active') return 'no skill';
  if (sim.isStunned(m) || sim.isSilenced(m)) return 'stunned';
  if ((m.skillReady[s.id] ?? 0) > sim.tick) return 'cooldown';
  if (m.mana < (s.manaCost ?? 0)) return 'mana';
  if (info.target !== 'unit') return null;
  const t = sim.get(targetId);
  if (!t || !t.alive || t.building) return 'target';
  if (info.targets === 'enemy' ? !sim.isEnemy(m, t) || !sim.canSee(m.team, t) : t.team !== m.team) return 'target';
  const reach = (s.range ?? 5) + m.stats.radius + t.stats.radius;
  if (Math.hypot(t.mover.x - m.mover.x, t.mover.y - m.mover.y) > reach) return 'range';
  return null;
}

/** The player pressed an own unit's skill (checked with unitSkillProblem first). */
export function unitCast(sim: MatchSim, unitId: number, index: number, targetId: number): void {
  const m = sim.get(unitId)!;
  const s = monsterSkills(m)[index]!;
  const forced = SKILL_INFO.get(s.id)?.target === 'unit' ? sim.get(targetId) : undefined;
  const target = useSkill(sim, m, s, forced ?? null, true);
  if (target !== false) paySkill(sim, m, s, index, target);
}

function inReach(m: SimEntity, t: SimEntity, range: number): boolean {
  return Math.hypot(t.mover.x - m.mover.x, t.mover.y - m.mover.y) <= range + m.stats.radius + t.stats.radius;
}

/**
 * Runs the skill. `forced` = the player's target; `pressed` = the player pressed it, so it goes off
 * (and costs) even if it hits nobody. Returns the target id (0 = none), or false if nothing happened.
 */
function useSkill(sim: MatchSim, m: SimEntity, s: SkillDef, forced: SimEntity | null, pressed: boolean): number | false {
  const fighting = sim.get(m.targetId);
  // Enemy-target skills hit the unit's own target, if it is in reach.
  let enemy = forced ?? (fighting && fighting.alive && inReach(m, fighting, s.range ?? 5) ? fighting : null);
  if (!enemy && m.building)
    forEnemies(sim, m, m.mover.x, m.mover.y, s.range ?? s.radius ?? 5, (t) => {
      if (!t.building) enemy ??= t;
    });
  switch (skillEffect(s)) {
    case 'place_lantern': {
      const type = entityTypeIndex(s.summonUnit ?? 'healing_lantern');
      if (sim.entities.some((e) => e.alive && e.type === type && e.leaderId === m.id)) return false;
      let needed = pressed;
      forAllies(sim, m.team, m.mover.x, m.mover.y, s.range ?? 6, (t) => {
        if (!t.building && t.hp < t.stats.maxHp - (s.healThreshold ?? 30)) needed = true;
      });
      if (!needed) return false;
      const at = nearestWalkable(sim.nav, m.mover.x + 0.8, m.mover.y + 0.4, 3);
      if (!at) return false;
      const lantern = sim.spawn(type, m.owner, m.team, m.color, at[0], at[1]);
      lantern.inert = true;
      lantern.leaderId = m.id;
      lantern.summonUntil = sim.tick + secs(s.duration ?? 24);
      return lantern.id;
    }
    case 'charge': {
      if (!enemy || enemy.building || enemy.stats.layer !== 'ground' || m.forced || sim.isRooted(m)) return false;
      const target = enemy;
      const dx = target.mover.x - m.mover.x,
        dy = target.mover.y - m.mover.y;
      const distance = Math.hypot(dx, dy);
      if (distance < (s.minRange ?? 3)) return false;
      const travel = Math.max(0, distance - m.stats.radius - target.stats.radius);
      const endX = m.mover.x + (dx / distance) * travel,
        endY = m.mover.y + (dy / distance) * travel;
      // Refuse a charge through a wall, cliff or tree; roots/stuns can stop it in flight too.
      for (let n = 1; n <= Math.ceil(travel * 3); n++) {
        const t = n / Math.ceil(travel * 3);
        if (!isWalkable(sim.nav, m.mover.x + (endX - m.mover.x) * t, m.mover.y + (endY - m.mover.y) * t)) return false;
      }
      sim.forceMove(m, endX, endY, s.duration ?? 0.5, 'charge', () => {
        if (!m.alive || !target.alive || !inReach(m, target, 2)) return;
        sim.applyAttack(m, target, s.damage ?? 60, m.stats.attackType);
        if (s.stunDuration) stun(sim, m, target, s.stunDuration);
      });
      return target.id;
    }
    case 'pierce_line':
    case 'bomb_line': {
      if (!enemy || (s.groundOnly && enemy.stats.layer !== 'ground')) return false;
      const dx = enemy.mover.x - m.mover.x,
        dy = enemy.mover.y - m.mover.y;
      const length = Math.hypot(dx, dy) || 1;
      const ux = dx / length,
        uy = dy / length;
      forEnemies(
        sim,
        m,
        m.mover.x,
        m.mover.y,
        s.range ?? 8,
        (t) => {
          const tx = t.mover.x - m.mover.x,
            ty = t.mover.y - m.mover.y;
          const along = tx * ux + ty * uy;
          if (along < 0 || along > (s.range ?? 8) + t.stats.radius || Math.abs(tx * uy - ty * ux) > (s.radius ?? 0.7) + t.stats.radius)
            return;
          sim.applyAttack(m, t, s.damage ?? 80, m.stats.attackType);
        },
        !s.groundOnly,
      );
      return enemy.id;
    }
    case 'mark_shot': {
      if (!enemy) return false;
      sim.applyAttack(m, enemy, s.damage ?? 40, m.stats.attackType);
      if (enemy.alive)
        debuff(sim, m, enemy, s.id, s.duration ?? 6, { bonusArmor: s.bonusArmor ?? -3, reveal: true, flags: BuffFlag.Marked });
      return enemy.id;
    }
    case 'repair_construct': {
      let best: SimEntity | null = null;
      forAllies(sim, m.team, m.mover.x, m.mover.y, s.range ?? 5, (t) => {
        if (forced && t.id !== forced.id) return;
        if (t.building || !gameData.units[t.type - gameData.heroes.length]?.mechanical || t.hp >= t.stats.maxHp - (s.heal ?? 80)) return;
        if (!best || t.hp / t.stats.maxHp < best.hp / best.stats.maxHp) best = t;
      });
      if (!best) return false;
      const target: SimEntity = best;
      sim.heal(target, s.heal ?? 80, src(m));
      return target.id;
    }
    case 'armor_break': {
      if (!enemy) return false;
      debuff(sim, m, enemy, s.id, s.duration ?? 6, { bonusArmor: s.bonusArmor ?? -4, flags: BuffFlag.Marked });
      return enemy.id;
    }
    case 'screen': {
      let any = false;
      forAllies(sim, m.team, m.mover.x, m.mover.y, s.radius ?? 5, (t) => {
        if (s.buildingsOnly && !t.building) return;
        if (!pressed && !t.targetId && !enemy && !(t.lastHitBy && sim.tick - t.lastHitAt < secs(4))) return;
        if (t.buffs.some((b) => b.id === s.id)) return;
        any = true;
        debuff(sim, m, t, s.id, s.duration ?? 5, {
          ...(s.spellReductionPct ? { spellReductionPct: s.spellReductionPct } : {}),
          ...(s.rangedReductionPct ? { rangedReductionPct: s.rangedReductionPct } : {}),
          flags: BuffFlag.Shield,
        });
      });
      return any ? 0 : false;
    }
    case 'guard_link':
    case 'cleanse': {
      const cleanse = skillEffect(s) === 'cleanse';
      const harmful = (b: Buff) => !!(b.stun || b.root || b.silence || b.slowPct || b.dps || (b.bonusArmor && b.bonusArmor < 0));
      let best = forced;
      if (!best)
        forAllies(sim, m.team, m.mover.x, m.mover.y, s.range ?? 5, (t) => {
          if (t.id === m.id || t.building || t.buffs.some((b) => b.id === s.id)) return;
          if (cleanse ? !t.buffs.some(harmful) : !t.targetId) return;
          if (!best || t.hp / t.stats.maxHp < best.hp / best.stats.maxHp) best = t;
        });
      if (!best) return false;
      if (cleanse) {
        const bad = best.buffs.find(harmful);
        if (bad) sim.removeBuff(best, bad.id, bad.sourceId);
      }
      debuff(
        sim,
        m,
        best,
        s.id,
        s.duration ?? 6,
        cleanse
          ? { spellReductionPct: s.spellReductionPct ?? 30, flags: BuffFlag.Shield }
          : { guardId: m.id, guardSharePct: s.sharePct ?? 30, guardRange: s.range ?? 5, flags: BuffFlag.Shield },
      );
      return best.id;
    }
    case 'chain': {
      if (!enemy) return false;
      const hit = new Set<number>();
      let next: SimEntity | null = enemy;
      for (let i = 0; i < (s.jumps ?? 3) && next; i++) {
        const current: SimEntity = next;
        hit.add(current.id);
        sim.spellHit(current, (s.damage ?? 50) * Math.pow(0.8, i), m);
        next = null;
        forEnemies(sim, m, current.mover.x, current.mover.y, s.radius ?? 3, (t) => {
          if (!t.building && !hit.has(t.id) && !next) next = t;
        });
      }
      return 0;
    }
    case 'silence_pulse':
    case 'gust': {
      let any = false;
      forEnemies(sim, m, m.mover.x, m.mover.y, s.radius ?? 5, (t) => {
        if (t.building || (skillEffect(s) === 'gust' && t.stats.layer !== 'air')) return;
        any = true;
        if (skillEffect(s) === 'gust') knockback(sim, t, m.mover.x, m.mover.y, s.distance ?? 2);
        else {
          debuff(sim, m, t, s.id, s.duration ?? 2, { silence: true, flags: BuffFlag.Silence });
          if (t.cast) endCast(sim, t);
        }
      });
      return any ? 0 : false;
    }
    case 'howl': {
      forAllies(sim, m.team, m.mover.x, m.mover.y, s.radius ?? 8, (t) =>
        debuff(sim, m, t, 'howl', s.duration ?? 10, { damagePct: s.damagePct ?? 15, flags: BuffFlag.Blessed }),
      );
      return 0;
    }
    case 'mend': {
      let best: SimEntity | null = forced;
      if (!best)
        forAllies(sim, m.team, m.mover.x, m.mover.y, s.range ?? 5, (t) => {
          if (t.hp < t.stats.maxHp - (s.heal ?? 25) && (!best || t.hp / t.stats.maxHp < best.hp / best.stats.maxHp)) best = t;
        });
      if (!best) return false;
      sim.heal(best, s.heal ?? 25, src(m));
      return best.id;
    }
    case 'ward': {
      // Auto: an ally in a fight without the ward yet, the most hurt first.
      let best: SimEntity | null = forced;
      if (!best)
        forAllies(sim, m.team, m.mover.x, m.mover.y, s.range ?? 6, (t) => {
          if (!t.targetId || t.building || t.buffs.some((b) => b.id === s.id)) return;
          if (!best || t.hp / t.stats.maxHp < best.hp / best.stats.maxHp) best = t;
        });
      if (!best) return false;
      debuff(sim, m, best, s.id, s.duration ?? 10, { bonusArmor: s.bonusArmor ?? 3, flags: BuffFlag.Blessed });
      return best.id;
    }
    case 'screech': {
      let any = false;
      forEnemies(
        sim,
        m,
        m.mover.x,
        m.mover.y,
        s.radius ?? 5,
        (t) => {
          any = true;
          debuff(sim, m, t, s.id, s.duration ?? 3, { slowPct: s.slowPct ?? 25, flags: BuffFlag.Slow });
        },
        !s.groundOnly,
      );
      return any || pressed ? 0 : false;
    }
    case 'web': {
      if (!enemy) return false;
      debuff(sim, m, enemy, 'web', s.rootDuration ?? 2, { root: true, flags: BuffFlag.Root });
      return enemy.id;
    }
    case 'bolt': {
      if (!enemy) return false;
      sim.spellHit(enemy, s.damage ?? 50, m);
      if (s.slowPct) debuff(sim, m, enemy, s.id, s.duration ?? 2, { slowPct: s.slowPct, flags: BuffFlag.Slow });
      return enemy.id;
    }
    case 'curse': {
      if (!enemy) return false;
      debuff(sim, m, enemy, s.id, s.duration ?? 4, {
        slowPct: s.slowPct ?? 0,
        spellDamageTakenPct: s.bonusSpellDamagePct ?? 0,
        flags: BuffFlag.Slow | BuffFlag.Marked,
      });
      return enemy.id;
    }
    case 'slam': {
      let any = false;
      forEnemies(
        sim,
        m,
        m.mover.x,
        m.mover.y,
        s.radius ?? 3.5,
        (t) => {
          any = true;
          sim.spellHit(t, s.damage ?? 80, m);
          if (s.stunDuration) stun(sim, m, t, s.stunDuration);
        },
        false,
      );
      return any || pressed ? 0 : false;
    }
  }
  return false;
}
