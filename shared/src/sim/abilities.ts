// Hero abilities from abilities.json: checks, the cast (walk into range, cast time, then the
// effect), channels, and the effect of every ability. Plus auras, passives and monster skills.
// Numbers always come from the data; this file only says what each ability does with them.

import { gameData, type AbilityDef } from '../data/index';
import { isWalkable, nearestWalkable } from '../nav/nav-grid';
import { qPos } from '../protocol/game';
import { BuffFlag, type Buff } from './buffs';
import { entityTypeIndex } from './entity-types';
import { abilityFxKind, EventType } from './events';
import { TICK_RATE, type DamageSource, type MatchSim, type SimEntity } from './match-sim';
import { canAttackLayer, canLearn, unitStats } from './stats';

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
  if (!t.alive) return false;
  const f = a.filter;
  const self = t === caster;
  const ally = !self && t.team === caster.team;
  const enemy = t.team !== caster.team;
  if (self && !f.includes('self')) return false;
  if (ally && !f.includes('ally')) return false;
  if (enemy && !f.includes('enemy')) return false;
  const air = t.stats.layer === 'air';
  if (air && !f.includes('air')) return false;
  if (!air && !f.includes('ground') && !self) return false;
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
  if (!e.alive) return 'dead';
  if (sim.isStunned(e) || e.forced) return 'stunned';
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
const CLAMP_RANGE = new Set(['blink', 'sky_pillar', 'inferno_dive', 'great_charge']);

/** How far away the cast may start. Infinity = no need to walk (self, line, cone, jumps). */
export function castReach(e: SimEntity, a: AbilityDef, level: number, t: SimEntity | undefined): number {
  if (a.target === 'none' || a.target === 'line' || a.target === 'cone' || CLAMP_RANGE.has(a.id)) return Infinity;
  const r = lv(a.castRange, level);
  return a.target === 'unit' && t ? r + e.stats.radius + t.stats.radius : r;
}

export function learn(sim: MatchSim, e: SimEntity, slot: number): boolean {
  const hs = e.heroState;
  const a = heroAbility(e, slot);
  if (!hs || !a || hs.skillPoints <= 0) return false;
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
    const level = hs.abilityLevels[slot] ?? 0;
    if (a.kind !== 'passive' || level < 1 || a.id === 'flurry') return;
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
  e.mana -= lv(a.manaCost, level);
  const hc = healthCost(a, level);
  if (hc) e.hp -= hc;
  e.cooldowns[c.slot] = sim.tick + secs(lv(a.cooldown, level));
  const kind = abilityFxKind(abilityIndex(a.id), level, c.target.kind === 2);
  sim.events.push(
    EventType.AbilityEffect,
    e.id,
    c.target.kind === 2 ? qPos(c.target.x) : c.target.id,
    c.target.kind === 2 ? qPos(c.target.y) : 0,
    kind,
  );
  const stay = EFFECTS[a.id]?.(sim, e, a, level, c.target, t);
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
  for (const h of sim.heroes) {
    const hs = h?.heroState;
    if (!h || !hs || !h.alive) continue;
    hs.def.abilities.forEach((id, slot) => {
      const level = hs.abilityLevels[slot] ?? 0;
      const make = AURA_PARAMS[id];
      if (!make || level < 1) return;
      const a = ABILITIES[abilityIndex(id)]!;
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
  }
}

// ---------- monster skills (auto-cast in a fight) ----------

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
  passive?: boolean;
}

export function monsterSkills(e: SimEntity): SkillDef[] {
  return (gameData.units.find((u) => u.id === unitId(e))?.skills ?? []) as SkillDef[];
}

function unitId(e: SimEntity): string {
  return gameData.units[e.type - gameData.heroes.length]?.id ?? '';
}

/** Passive monster skills at spawn (Stone Guard). */
export function monsterPassives(sim: MatchSim, e: SimEntity): void {
  for (const s of monsterSkills(e)) {
    if (s.passive && s.spellReductionPct)
      sim.addBuff(e, {
        id: `passive:${s.id}`,
        sourceId: e.id,
        sourceOwner: e.owner,
        sourceTeam: e.team,
        until: Infinity,
        flags: 0,
        spellReductionPct: s.spellReductionPct,
      });
  }
}

/** A fighting monster uses its skill when it is ready and useful. */
export function monsterCast(sim: MatchSim, m: SimEntity): void {
  if (!m.targetId || (sim.tick + m.id) % 10 !== 0 || sim.isStunned(m) || sim.isSilenced(m)) return;
  for (const s of monsterSkills(m)) {
    if (s.passive || (m.skillReady[s.id] ?? 0) > sim.tick) continue;
    if (!useSkill(sim, m, s)) continue;
    m.skillReady[s.id] = sim.tick + secs(s.cooldown ?? 10);
    sim.events.push(EventType.Cast, m.id, 0, 0, 255);
  }
}

function useSkill(sim: MatchSim, m: SimEntity, s: SkillDef): boolean {
  const target = sim.get(m.targetId);
  switch (s.id) {
    case 'howl': {
      forAllies(sim, m.team, m.mover.x, m.mover.y, s.radius ?? 8, (t) =>
        debuff(sim, m, t, 'howl', s.duration ?? 10, { damagePct: s.damagePct ?? 15, flags: BuffFlag.Blessed }),
      );
      return true;
    }
    case 'mend': {
      let best: SimEntity | null = null;
      forAllies(sim, m.team, m.mover.x, m.mover.y, s.range ?? 5, (t) => {
        if (t.hp < t.stats.maxHp - (s.heal ?? 25) && (!best || t.hp / t.stats.maxHp < best.hp / best.stats.maxHp)) best = t;
      });
      if (!best) return false;
      sim.heal(best, s.heal ?? 25, src(m));
      return true;
    }
    case 'screech': {
      let any = false;
      forEnemies(sim, m, m.mover.x, m.mover.y, s.radius ?? 5, (t) => {
        any = true;
        debuff(sim, m, t, 'screech', s.duration ?? 3, { slowPct: s.slowPct ?? 25, flags: BuffFlag.Slow });
      });
      return any;
    }
    case 'web': {
      if (!target || Math.hypot(target.mover.x - m.mover.x, target.mover.y - m.mover.y) > (s.range ?? 6)) return false;
      debuff(sim, m, target, 'web', s.rootDuration ?? 2, { root: true, flags: BuffFlag.Root });
      return true;
    }
    case 'ground_slam': {
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
          stun(sim, m, t, s.stunDuration ?? 1.5);
        },
        false,
      );
      return any;
    }
  }
  return false;
}
