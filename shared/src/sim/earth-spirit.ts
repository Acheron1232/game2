// Earth Spirit combo state belongs to the match. All distances/times/damage live in the data.
import { gameData, type AbilityDef } from '../data';
import type { CastTarget } from './abilities';
import { BuffFlag } from './buffs';
import { entityTypeIndex } from './entity-types';
import type { MatchSim, SimEntity } from './match-sim';
import { nearestWalkable } from '../nav/nav-grid';

const TPS = 20;
const ticks = (s: number) => Math.round(s * TPS);
const data = (id: string) => gameData.abilities.find((a) => a.id === id)!;
const n = (a: AbilityDef, key: string, level = 1): number => {
  const v = a.params[key];
  return Array.isArray(v) ? v[Math.min(level, v.length) - 1]! : typeof v === 'number' ? v : 0;
};
interface Charges {
  count: number;
  next: number;
  max: number;
}
interface Enchant {
  stone: number;
  unit: number;
  until: number;
  source: number;
  level: number;
  wasHidden: boolean;
  wasInvulnerable: boolean;
}
interface State {
  charges: Map<number, Charges>;
  enchants: Enchant[];
  shatter: Map<number, number>;
}
const matches = new WeakMap<MatchSim, State>();
function state(sim: MatchSim): State {
  let s = matches.get(sim);
  if (!s) {
    s = { charges: new Map(), enchants: [], shatter: new Map() };
    matches.set(sim, s);
  }
  return s;
}
export const isEarthAbility = (id: string) =>
  ['boulder_smash', 'rolling_boulder', 'geomagnetic_grip', 'magnetize', 'stone_remnant', 'enchant_remnant'].includes(id);
const remnantType = () => entityTypeIndex('earth_remnant');
const stone = (e: SimEntity) => e.type === remnantType();
function ours(e: SimEntity, h: SimEntity): boolean {
  return e.alive && stone(e) && e.leaderId === h.id;
}
function maxCharges(h: SimEntity): number {
  const a = data('stone_remnant');
  return n(a, 'charges') + Math.floor((h.heroState?.level ?? 1) / n(a, 'chargeLevelStep'));
}
export function earthCharges(sim: MatchSim, h: SimEntity): Charges | null {
  if (h.heroState?.def.id !== 'earth_spirit') return null;
  const s = state(sim),
    max = maxCharges(h);
  let c = s.charges.get(h.id);
  if (!c) {
    c = { count: max, max, next: 0 };
    s.charges.set(h.id, c);
  }
  if (max > c.max) {
    c.count += max - c.max;
    c.max = max;
  }
  const interval = ticks(n(data('stone_remnant'), 'rechargeSec'));
  if (c.next && sim.tick >= c.next) {
    const add = 1 + Math.floor((sim.tick - c.next) / interval);
    c.count = Math.min(max, c.count + add);
    c.next = c.count === max ? 0 : c.next + add * interval;
  }
  return c;
}
function nearest(sim: MatchSim, x: number, y: number, r: number, allow: (t: SimEntity) => boolean): SimEntity | undefined {
  let found: SimEntity | undefined,
    best = r * r;
  for (const t of sim.entities) {
    if (!t.alive || t.hidden || !allow(t)) continue;
    const d = (t.mover.x - x) ** 2 + (t.mover.y - y) ** 2;
    if (d <= best) {
      found = t;
      best = d;
    }
  }
  return found;
}
function pick(sim: MatchSim, h: SimEntity, a: AbilityDef, target: CastTarget): SimEntity | undefined {
  if (a.id === 'boulder_smash') {
    // Prefer a stone toward the aim point, then one near the monk, then a nearby unit.
    return (
      nearest(sim, target.x, target.y, n(a, 'pickRadius'), (t) => ours(t, h) && distance(h, t) <= n(a, 'pickRadius')) ??
      nearest(sim, h.mover.x, h.mover.y, n(a, 'pickRadius'), (t) => ours(t, h)) ??
      nearest(
        sim,
        h.mover.x,
        h.mover.y,
        n(a, 'pickRadius'),
        (t) => t !== h && !t.building && !t.invulnerable && t.stats.layer !== 'air' && sim.canSee(h.team, t),
      )
    );
  }
  return (
    nearest(sim, target.x, target.y, n(a, 'pickRadius'), (t) => ours(t, h)) ??
    nearest(
      sim,
      target.x,
      target.y,
      n(a, 'pickRadius'),
      (t) => t !== h && t.team === h.team && !t.building && !t.invulnerable && distance(h, t) <= n(a, 'allyRange'),
    )
  );
}
const distance = (a: SimEntity, b: SimEntity) => Math.hypot(a.mover.x - b.mover.x, a.mover.y - b.mover.y);
export function earthCastProblem(sim: MatchSim, h: SimEntity, a: AbilityDef, target: CastTarget): string | null {
  if (a.id === 'stone_remnant') {
    if ((earthCharges(sim, h)?.count ?? 0) < 1) return 'charges';
    if (target.kind === 2 && Math.hypot(target.x - h.mover.x, target.y - h.mover.y) > Number(a.castRange)) return 'range';
    if (target.kind === 2 && !nearestWalkable(sim.nav, target.x, target.y, 2)) return 'ground';
  }
  if ((a.id === 'boulder_smash' || a.id === 'geomagnetic_grip') && target.kind === 2) {
    const t = pick(sim, h, a, target);
    if (!t || (a.id === 'geomagnetic_grip' && distance(h, t) > Number(a.castRange))) return 'no stone or unit';
    if (a.id === 'boulder_smash' && stone(t) && distance(h, t) > n(a, 'pickRadius')) return 'range';
  }
  if (a.id === 'rolling_boulder' && sim.isRooted(h)) return 'rooted';
  return null;
}
function used(sim: MatchSim, h: SimEntity): void {
  const a = data('stone_remnant');
  sim.addBuff(h, {
    id: 'earth-used-stone',
    sourceId: h.id,
    sourceOwner: h.owner,
    sourceTeam: h.team,
    until: sim.tick + ticks(n(a, 'usedDuration')),
    flags: BuffFlag.Blessed,
    damagePct: n(a, 'usedDamagePct'),
  });
}
function spawnStone(sim: MatchSim, h: SimEntity, x: number, y: number, duration: number): SimEntity {
  const t = sim.spawn(remnantType(), h.owner, h.team, h.color, x, y);
  t.inert = true;
  t.invulnerable = true;
  t.leaderId = h.id;
  t.summonUntil = sim.tick + ticks(duration);
  return t;
}
function enemies(sim: MatchSim, h: SimEntity, x: number, y: number, r: number, fn: (t: SimEntity) => void): void {
  for (const t of sim.entities)
    if (
      t.alive &&
      !t.hidden &&
      !t.invulnerable &&
      !t.building &&
      t.team !== h.team &&
      Math.hypot(t.mover.x - x, t.mover.y - y) <= r + t.stats.radius
    )
      fn(t);
}
function magnetized(t: SimEntity, h: SimEntity) {
  return t.buffs.some((b) => b.id === 'magnetize' && b.sourceId === h.id);
}
function debuff(sim: MatchSim, h: SimEntity, t: SimEntity, a: AbilityDef, l: number): void {
  const slow = a.id === 'boulder_smash';
  const apply = (u: SimEntity) =>
    sim.addBuff(u, {
      id: a.id,
      sourceId: h.id,
      sourceOwner: h.owner,
      sourceTeam: h.team,
      until: sim.tick + ticks(n(a, slow ? 'slowDuration' : 'silenceDuration', l)),
      flags: slow ? BuffFlag.Slow : BuffFlag.Silence,
      ...(slow ? { slowPct: n(a, 'slowPct', l) } : { silence: true }),
    });
  apply(t);
  if (magnetized(t, h))
    for (const other of sim.entities) if (other !== t && other.alive && !other.hidden && magnetized(other, h)) apply(other);
}
function lineHit(
  sim: MatchSim,
  h: SimEntity,
  m: SimEntity,
  a: AbilityDef,
  l: number,
  hit: Set<number>,
  last: { x: number; y: number },
  stopHero = false,
  boost = false,
): void {
  const x = m.mover.x,
    y = m.mover.y,
    dx = x - last.x,
    dy = y - last.y,
    ds = dx * dx + dy * dy;
  let stopped = false;
  for (const t of sim.entities) {
    if (stopped || !t.alive || t.hidden || t.invulnerable || t.building || t.team === h.team || t.stats.layer === 'air' || hit.has(t.id))
      continue;
    const along = ds ? Math.max(0, Math.min(1, ((t.mover.x - last.x) * dx + (t.mover.y - last.y) * dy) / ds)) : 0;
    if (Math.hypot(t.mover.x - last.x - dx * along, t.mover.y - last.y - dy * along) > n(a, 'width') / 2 + t.stats.radius) continue;
    hit.add(t.id);
    const strength = h.heroState
      ? h.heroState.def.attributes.strength[0] + h.heroState.def.attributes.strength[1] * (h.heroState.level - 1)
      : 0;
    sim.spellHit(t, n(a, 'damage', l) + (stopHero ? strength * n(a, 'strengthFactor', l) : 0), h);
    if (stopHero && t.hero) {
      sim.addBuff(t, {
        id: a.id,
        sourceId: h.id,
        sourceOwner: h.owner,
        sourceTeam: h.team,
        until: sim.tick + ticks(n(a, 'stunDuration', l) + (boost ? n(a, 'stoneStunBonus', l) : 0)),
        flags: BuffFlag.Stun,
        stun: true,
      });
      m.forced = null;
      stopped = true;
    } else if (!stopHero) debuff(sim, h, t, a, l);
  }
  last.x = x;
  last.y = y;
}
function enchantFinish(sim: MatchSim, s: State, e: Enchant): void {
  const proxy = sim.get(e.stone),
    original = sim.get(e.unit),
    h = sim.get(e.source),
    a = data('enchant_remnant');
  const x = proxy?.mover.x ?? original?.mover.x ?? 0,
    y = proxy?.mover.y ?? original?.mover.y ?? 0;
  if (original?.alive) {
    original.hidden = e.wasHidden;
    original.invulnerable = e.wasInvulnerable;
    const at = nearestWalkable(sim.nav, x, y, 5);
    sim.teleport(original, at?.[0] ?? x, at?.[1] ?? y);
    sim.removeBuff(original, 'earth-enchanted', e.source);
  }
  if (proxy?.alive) sim.kill(proxy, { id: proxy.id, owner: proxy.owner, team: proxy.team });
  if (h) enemies(sim, h, x, y, n(a, 'radius', e.level), (t) => sim.spellHit(t, n(a, 'damage', e.level), h));
  s.shatter.delete(e.stone);
}
export function castEarthSpirit(sim: MatchSim, h: SimEntity, a: AbilityDef, l: number, target: CastTarget, t?: SimEntity): void {
  const s = state(sim);
  if (a.id === 'stone_remnant') {
    const c = earthCharges(sim, h)!,
      at = nearestWalkable(sim.nav, target.x, target.y, 2);
    if (!at || c.count < 1) return;
    c.count--;
    if (!c.next) c.next = sim.tick + ticks(n(a, 'rechargeSec'));
    spawnStone(sim, h, at[0], at[1], n(a, 'duration'));
  } else if (a.id === 'boulder_smash' || a.id === 'geomagnetic_grip') {
    const moving = pick(sim, h, a, target);
    if (!moving) return;
    const isStone = stone(moving),
      push = a.id === 'boulder_smash';
    const dx = (push ? target.x : moving.mover.x) - h.mover.x,
      dy = (push ? target.y : moving.mover.y) - h.mover.y,
      d = Math.hypot(dx, dy) || 1;
    const length = push ? n(a, isStone ? 'stoneDistance' : 'unitDistance') : Math.max(0, d - 1);
    const endX = push ? moving.mover.x + (dx / d) * length : h.mover.x + dx / d;
    const endY = push ? moving.mover.y + (dy / d) * length : h.mover.y + dy / d;
    const hit = new Set<number>(),
      last = { x: moving.mover.x, y: moving.mover.y };
    if (isStone) used(sim, h);
    else if (push && moving.team !== h.team) sim.spellHit(moving, n(a, 'damage', l), h);
    // A pull can replace an earlier stone push. Heroes still use terrain-aware forced motion.
    moving.forced = null;
    sim.forceMove(
      moving,
      endX,
      endY,
      length / n(a, !push && !isStone ? 'allySpeed' : 'speed'),
      isStone ? 'dive' : 'knock',
      undefined,
      () => {
        if (isStone) lineHit(sim, h, moving, a, l, hit, last);
      },
    );
  } else if (a.id === 'rolling_boulder') {
    const dx = target.x - h.mover.x,
      dy = target.y - h.mover.y,
      d = Math.hypot(dx, dy) || 1,
      ux = dx / d,
      uy = dy / d;
    let boost = false;
    const hit = new Set<number>(),
      last = { x: h.mover.x, y: h.mover.y },
      start = { x: h.mover.x, y: h.mover.y };
    const clear = () => sim.removeBuff(h, 'earth-rolling', h.id);
    sim.addBuff(h, {
      id: 'earth-rolling',
      sourceId: h.id,
      sourceOwner: h.owner,
      sourceTeam: h.team,
      until: sim.tick + ticks(n(a, 'distance') / n(a, 'speed') + 1),
      flags: BuffFlag.Rolling,
    });
    sim.forceMove(
      h,
      h.mover.x + ux * n(a, 'distance'),
      h.mover.y + uy * n(a, 'distance'),
      n(a, 'distance') / n(a, 'speed'),
      'charge',
      clear,
      () => {
        if (!boost) {
          const rem = nearest(sim, h.mover.x, h.mover.y, n(a, 'width'), (r) => ours(r, h));
          if (rem) {
            boost = true;
            used(sim, h);
            const enchant = s.enchants.find((e) => e.stone === rem.id);
            if (enchant) enchant.until = sim.tick;
            else sim.kill(rem, { id: rem.id, owner: rem.owner, team: rem.team });
            const f = h.forced!;
            f.fromX = h.mover.x;
            f.fromY = h.mover.y;
            f.start = sim.tick;
            f.toX = start.x + ux * n(a, 'stoneDistance');
            f.toY = start.y + uy * n(a, 'stoneDistance');
            f.end = sim.tick + ticks(Math.hypot(f.toX - f.fromX, f.toY - f.fromY) / n(a, 'stoneSpeed'));
          }
        }
        lineHit(sim, h, h, a, l, hit, last, true, boost);
        if (!h.forced) clear();
      },
    );
  } else if (a.id === 'magnetize') {
    enemies(sim, h, h.mover.x, h.mover.y, n(a, 'radius', l), (enemy) => addMagnet(sim, h, enemy, a, l));
  } else if (a.id === 'enchant_remnant' && t) {
    if (stone(t)) {
      t.summonUntil = sim.tick + ticks(n(a, 'duration'));
      s.enchants.push({ stone: t.id, unit: 0, until: t.summonUntil, source: h.id, level: l, wasHidden: false, wasInvulnerable: true });
      h.cooldowns[5] = sim.tick + ticks(n(a, 'stoneCooldown'));
    } else {
      const proxy = spawnStone(sim, h, t.mover.x, t.mover.y, n(a, 'duration') + 1);
      s.enchants.push({
        stone: proxy.id,
        unit: t.id,
        until: sim.tick + ticks(n(a, 'duration')),
        source: h.id,
        level: l,
        wasHidden: t.hidden,
        wasInvulnerable: t.invulnerable,
      });
      t.hidden = true;
      t.invulnerable = true;
      t.forced = null;
      t.cast = null;
      t.order = 'idle';
      t.targetId = 0;
      t.mover.path = [];
      sim.addBuff(t, {
        id: 'earth-enchanted',
        sourceId: h.id,
        sourceOwner: h.owner,
        sourceTeam: h.team,
        until: sim.tick + ticks(n(a, 'duration')),
        flags: BuffFlag.Stun,
        stun: true,
      });
    }
  }
}
function addMagnet(sim: MatchSim, h: SimEntity, t: SimEntity, a: AbilityDef, l: number): void {
  sim.addBuff(t, {
    id: 'magnetize',
    sourceId: h.id,
    sourceOwner: h.owner,
    sourceTeam: h.team,
    until: sim.tick + ticks(n(a, 'duration', l)),
    flags: BuffFlag.Magnetized,
    dps: n(a, 'dps', l),
  });
}
export function updateEarthSpirit(sim: MatchSim): void {
  const s = matches.get(sim);
  for (const h of sim.heroes) {
    if (!h?.alive || h.heroState?.def.id !== 'earth_spirit') continue;
    const c = earthCharges(sim, h)!,
      a = data('stone_remnant');
    const pct = c.count * n(a, 'damagePerChargePct'),
      old = h.buffs.find((b) => b.id === 'earth-stored-stones');
    if (old?.damagePct !== pct)
      sim.addBuff(h, {
        id: 'earth-stored-stones',
        sourceId: h.id,
        sourceOwner: h.owner,
        sourceTeam: h.team,
        until: Infinity,
        flags: 0,
        damagePct: pct,
      });
    if (h.buffs.some((b) => b.id === 'earth-rolling') && !h.forced) sim.removeBuff(h, 'earth-rolling', h.id);
  }
  if (!s) return;
  for (let i = s.enchants.length - 1; i >= 0; i--) {
    const e = s.enchants[i]!;
    if (sim.tick >= e.until || !sim.get(e.stone)?.alive) {
      enchantFinish(sim, s, e);
      s.enchants.splice(i, 1);
    }
  }
  // Only examine active magnetized victims, and a stone schedules a single delayed shatter.
  for (const h of sim.heroes) {
    if (!h?.heroState || h.heroState.def.id !== 'earth_spirit') continue;
    const a = data('magnetize'),
      l = h.heroState.abilityLevels[3] ?? 0;
    if (!l) continue;
    for (const r of sim.entities) {
      if (!ours(r, h) || s.shatter.has(r.id)) continue;
      const victim = sim.entities.find((t) => t.alive && !t.hidden && magnetized(t, h) && distance(t, r) <= n(a, 'refreshRadius', l));
      if (victim) s.shatter.set(r.id, sim.tick + ticks(n(a, 'stoneDelay', l)));
    }
    for (const [id, at] of s.shatter) {
      const r = sim.get(id);
      if (!r?.alive) {
        s.shatter.delete(id);
        continue;
      }
      if (r.leaderId !== h.id || sim.tick < at) continue;
      enemies(sim, h, r.mover.x, r.mover.y, n(a, 'spreadRadius', l), (enemy) => addMagnet(sim, h, enemy, a, l));
      used(sim, h);
      const enchant = s.enchants.find((e) => e.stone === r.id);
      if (enchant) enchant.until = sim.tick;
      else sim.kill(r, { id: r.id, owner: r.owner, team: r.team });
      s.shatter.delete(id);
    }
  }
}
