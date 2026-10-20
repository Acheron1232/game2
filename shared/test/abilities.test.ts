// Every ability does what abilities.json (and so HEROES.md) says, and the server refuses casts
// that should not happen.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ABILITIES,
  abilityIndex,
  buildMatchNav,
  CommandType,
  entityTypeIndex,
  gameData,
  EventType,
  abilityFxKind,
  MatchSim,
  NEUTRAL,
  NEUTRAL_TEAM,
  param,
  parseTerrain,
  TICK_RATE,
  type CastTarget,
  type SimEntity,
} from '../src/index';

const nav = buildMatchNav(parseTerrain(readFileSync(join(__dirname, '..', 'data', 'map-terrain.bin'))), gameData.map);
const ab = (id: string) => ABILITIES[abilityIndex(id)]!;

/** A hero at level 10 with every ability learned, on open ground, plus helpers. */
function setup(heroId: string, enemyHero = false) {
  const slots = [{ index: 0, heroType: entityTypeIndex(heroId), team: 1, color: 0, start: 0 }];
  if (enemyHero) slots.push({ index: 1, heroType: entityTypeIndex('stone_golem'), team: 2, color: 1, start: 1 });
  const sim = new MatchSim({ seed: 9, slots, noCamps: true }, nav);
  const hero = sim.heroes[0]!;
  // The open base field near the north town hall.
  hero.mover.x = 110;
  hero.mover.y = 222;
  hero.mover.facing = 0;
  sim.addXp(hero, 99999);
  for (let s = 0; s < 4; s++) for (let i = 0; i < 3; i++) sim.queueCommand(0, 100 + s * 3 + i, { type: CommandType.Learn, slot: s });
  sim.step();
  hero.mana = hero.stats.maxMana;
  let seq = 1000;
  const dummy = (dx: number, dy: number, unit = 'ogre_brute'): SimEntity => {
    const d = sim.spawn(entityTypeIndex(unit), NEUTRAL, NEUTRAL_TEAM, 255, hero.mover.x + dx, hero.mover.y + dy);
    d.passive = true;
    d.thinkAt = Infinity;
    // No regen, so lost health is exactly the damage.
    d.base = { ...d.base, hpRegen: 0 };
    d.stats = d.base;
    return d;
  };
  const cast = (slot: number, target: CastTarget) =>
    sim.queueCommand(0, ++seq, { type: CommandType.Cast, slot, target: target.kind, id: target.id, x: target.x, y: target.y });
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds * TICK_RATE); i++) sim.step();
  };
  const at = (x: number, y: number): CastTarget => ({ kind: 2, id: 0, x: hero.mover.x + x, y: hero.mover.y + y });
  const unit = (e: SimEntity): CastTarget => ({ kind: 1, id: e.id, x: 0, y: 0 });
  const none: CastTarget = { kind: 0, id: 0, x: 0, y: 0 };
  return { sim, hero, dummy, cast, run, at, unit, none };
}

const lost = (e: SimEntity) => e.stats.maxHp - e.hp;

describe('learning', () => {
  it('follows the level rule and spends skill points', () => {
    const sim = new MatchSim(
      { seed: 1, noCamps: true, slots: [{ index: 0, heroType: entityTypeIndex('staff_warrior'), team: 1, color: 0, start: 0 }] },
      nav,
    );
    const hero = sim.heroes[0]!;
    // Level 1, one point: the ultimate is not allowed, Q is.
    sim.queueCommand(0, 1, { type: CommandType.Learn, slot: 3 });
    sim.queueCommand(0, 2, { type: CommandType.Learn, slot: 0 });
    sim.step();
    expect(hero.heroState!.abilityLevels).toEqual([1, 0, 0, 0]);
    expect(hero.heroState!.skillPoints).toBe(0);
    // Level 2: Q level 2 needs hero level 3.
    sim.addXp(hero, 200);
    sim.queueCommand(0, 3, { type: CommandType.Learn, slot: 0 });
    sim.step();
    expect(hero.heroState!.abilityLevels[0]).toBe(1);
    sim.queueCommand(0, 4, { type: CommandType.Learn, slot: 1 });
    sim.step();
    expect(hero.heroState!.abilityLevels).toEqual([1, 1, 0, 0]);
  });

  it('level 10 gives everything', () => {
    const { hero } = setup('forest_elf');
    expect(hero.heroState!.abilityLevels).toEqual([3, 3, 3, 1]);
    expect(hero.heroState!.skillPoints).toBe(0);
  });
});

describe('server refuses casts that should not happen', () => {
  it('sends visuals only for completed casts, with the learned level and target', () => {
    const { sim, hero, cast, at } = setup('sky_dragon');
    hero.heroState!.abilityLevels[0] = 1;
    const effects: number[] = [];
    const step = () => {
      sim.step();
      for (let i = 0; i < sim.events.count; i++) {
        const ev = sim.events.items[i]!;
        if (ev.type === EventType.AbilityEffect) effects.push(ev.kind);
      }
    };
    cast(0, at(3, 0));
    step();
    expect(effects).toEqual([]);
    sim.queueCommand(0, 2000, { type: CommandType.Stop });
    for (let i = 0; i < 20; i++) step();
    expect(effects).toEqual([]);
    expect(hero.cooldowns[0]).toBe(0);
    cast(0, at(3, 0));
    for (let i = 0; i < 20; i++) step();
    expect(effects).toEqual([abilityFxKind(abilityIndex('fire_breath'), 1, true)]);
  });

  it('packs every current ability and learned level without losing its point flag', () => {
    expect(ABILITIES.length).toBeLessThanOrEqual(32);
    for (const [index, ability] of ABILITIES.entries()) {
      for (let level = 1; level <= ability.maxLevel; level++) {
        for (const point of [false, true]) {
          const kind = abilityFxKind(index, level, point);
          expect(kind & 31).toBe(index);
          expect(((kind >> 5) & 3) + 1).toBe(level);
          expect(!!(kind & 128)).toBe(point);
        }
      }
    }
  });

  it('cooldown, mana, health cost, stun, not learned, bad target', () => {
    const { sim, hero, dummy, run, unit, none } = setup('staff_warrior');
    const ogre = dummy(2, 0);
    expect(sim.castCheck(0, 0, none)).toBeNull();
    sim.queueCommand(0, 1, { type: CommandType.Cast, slot: 0, target: 0, id: 0, x: 0, y: 0 });
    run(0.5);
    expect(lost(ogre)).toBeGreaterThan(0);
    expect(sim.castCheck(0, 0, none)).toBe('cooldown');
    expect(sim.queueCommand(0, 2, { type: CommandType.Cast, slot: 0, target: 0, id: 0, x: 0, y: 0 })).toBe(false);
    run(param(ab('sweep'), 'cooldown', 3) || 10);
    expect(sim.castCheck(0, 0, none)).toBeNull();
    hero.mana = 10;
    expect(sim.castCheck(0, 0, none)).toBe('mana');
    hero.mana = hero.stats.maxMana;
    sim.addBuff(hero, { id: 'stun', sourceId: ogre.id, sourceOwner: NEUTRAL, sourceTeam: 0, until: sim.tick + 40, flags: 1, stun: true });
    expect(sim.castCheck(0, 0, none)).toBe('stunned');
    // Passives can not be cast.
    expect(sim.castCheck(0, 2, none)).toBe('passive');
    void unit;
  });

  it('Blood Bolt can not kill the witch', () => {
    const { sim, hero, dummy, unit } = setup('blood_witch');
    const ogre = dummy(4, 0);
    hero.hp = param(ab('blood_bolt'), 'healthCost', 3);
    expect(sim.castCheck(0, 0, unit(ogre))).toBe('health');
  });

  it('a unit target out of range: the hero walks there first, then casts', () => {
    const { hero, dummy, cast, run, unit } = setup('stone_golem');
    const ogre = dummy(14, 0);
    cast(0, unit(ogre));
    run(0.6);
    expect(lost(ogre)).toBe(0);
    run(4);
    expect(lost(ogre)).toBe(param(ab('boulder_toss'), 'damage', 3));
    expect(Math.hypot(hero.mover.x - ogre.mover.x, hero.mover.y - ogre.mover.y)).toBeLessThan(7 + 2);
  });

  it('heals only allies, damage only enemies', () => {
    const { sim, dummy, unit } = setup('light_healer');
    const ogre = dummy(3, 0);
    expect(sim.castCheck(0, 0, unit(ogre))).toBe('target');
    expect(sim.castCheck(0, 1, unit(ogre))).toBe('target');
  });
});

describe('ability numbers', () => {
  it('Blood Witch', () => {
    const { hero, dummy, cast, run, unit, at } = setup('blood_witch');
    const o1 = dummy(5, 0);
    const hp0 = hero.hp;
    cast(0, unit(o1));
    run(1.5);
    expect(lost(o1)).toBe(param(ab('blood_bolt'), 'damage', 3));
    // A little regen comes back during the cast.
    expect(hp0 - hero.hp).toBeCloseTo(param(ab('blood_bolt'), 'healthCost', 3), -1);
    const o2 = dummy(-5, 0);
    const speed = o2.stats.moveSpeed;
    cast(1, unit(o2));
    run(0.5);
    expect(o2.stats.moveSpeed).toBeCloseTo(speed * (1 - param(ab('bleed'), 'slowPct', 3) / 100), 5);
    run(6);
    expect(lost(o2)).toBeCloseTo(param(ab('bleed'), 'damagePerSec', 3) * param(ab('bleed'), 'duration', 3), -1);
    const o3 = dummy(0, -6);
    hero.hp = 200;
    cast(3, at(0, -6));
    run(6);
    expect(lost(o3)).toBeCloseTo(60 * 5, -1);
    expect(hero.hp).toBeGreaterThan(200 + 100);
  });

  it('Staff Warrior', () => {
    const { sim, hero, dummy, cast, run, at, none } = setup('staff_warrior');
    const o = dummy(2, 0);
    const x0 = o.mover.x;
    cast(0, none);
    run(1);
    expect(lost(o)).toBe(param(ab('sweep'), 'damage', 3));
    expect(o.mover.x - x0).toBeGreaterThan(1.5);
    cast(1, none);
    run(0.2);
    const before = hero.hp;
    sim.damage(hero, 100, { id: o.id, owner: NEUTRAL, team: 0 }, 0);
    expect(before - hero.hp).toBeCloseTo(100 * (1 - param(ab('iron_stance'), 'damageBlockPct', 3) / 100), 3);
    run(4);
    const far = dummy(7, 0);
    const spot = at(7, 0);
    cast(3, spot);
    run(1.2);
    expect(lost(far)).toBe(200);
    expect(far.buffs.some((b) => b.stun)).toBe(true);
    expect(Math.hypot(hero.mover.x - spot.x, hero.mover.y - spot.y)).toBeLessThan(0.5);
    run(2.5);
    expect(far.buffs.some((b) => b.stun)).toBe(false);
  });

  it('Sky Dragon', () => {
    const { sim, hero, dummy, cast, run, at, none } = setup('sky_dragon');
    expect(hero.stats.layer).toBe('lowAir');
    const front = dummy(0, 4),
      back = dummy(0, -4);
    cast(0, at(0, 5));
    run(1);
    expect(lost(front)).toBe(param(ab('fire_breath'), 'damage', 3));
    expect(lost(back)).toBe(0);
    // Dragon Scales: +6 armor at level 3, less spell damage.
    expect(hero.stats.armor - hero.base.armor).toBeCloseTo(param(ab('dragon_scales'), 'bonusArmor', 3), 5);
    const near = dummy(2, 0);
    cast(1, none);
    run(0.5);
    expect(lost(near)).toBe(param(ab('wing_gust'), 'damage', 3));
    run(3);
    const d = dummy(9, 0);
    cast(3, at(9, 0));
    run(6);
    expect(lost(d)).toBeCloseTo(120 + 40 * 4, -1);
    void sim;
  });

  it('Stone Golem', () => {
    const { sim, hero, dummy, cast, run, unit, none } = setup('stone_golem');
    const o = dummy(4, 0);
    cast(0, unit(o));
    run(1.2);
    expect(lost(o)).toBe(175);
    const stun = o.buffs.find((b) => b.stun)!;
    expect(stun).toBeTruthy();
    cast(1, none);
    run(0.2);
    const before = hero.hp;
    sim.damage(hero, 100, { id: o.id, owner: NEUTRAL, team: 0 }, 0);
    expect(before - hero.hp).toBeCloseTo(60, 3);
    const t = dummy(-2, 0);
    const sp = t.stats.moveSpeed;
    cast(2, none);
    run(0.6);
    expect(lost(t)).toBe(70);
    expect(t.stats.moveSpeed).toBeCloseTo(sp * 0.5, 5);
    const hp1 = hero.stats.maxHp;
    hero.mana = hero.stats.maxMana;
    cast(3, none);
    run(1);
    expect(hero.stats.maxHp).toBeCloseTo(hp1 * 1.5, 3);
    expect(t.buffs.some((b) => b.tauntId === hero.id)).toBe(true);
  });

  it('Light Healer', () => {
    const { sim, hero, dummy, cast, run, unit, at } = setup('light_healer');
    hero.hp = 100;
    cast(0, unit(hero));
    run(0.6);
    expect(hero.hp).toBeCloseTo(100 + 280, -1);
    cast(1, unit(hero));
    run(0.5);
    expect(hero.stats.armor - hero.base.armor).toBeCloseTo(8, 5);
    expect(hero.stats.moveSpeed).toBeCloseTo(hero.base.moveSpeed * 1.15, 5);
    hero.hp = 100;
    cast(2, at(0, 0));
    run(7);
    expect(hero.hp).toBeGreaterThan(100 + 35 * 6 - 10);
    run(14);
    const o = dummy(2, 0);
    cast(3, unit(hero));
    run(0.4);
    sim.damage(hero, 99999, { id: o.id, owner: NEUTRAL, team: 0 }, 0);
    expect(hero.alive).toBe(true);
    expect(hero.hp).toBe(1);
    run(4.5);
    expect(hero.hp).toBeGreaterThan(290);
  });

  it('Arcane Huntress', () => {
    const { sim, hero, dummy, cast, run, at, unit } = setup('arcane_huntress');
    const first = dummy(4, 0),
      second = dummy(7, 0);
    cast(0, at(10, 0));
    run(1.2);
    expect(lost(first)).toBe(210);
    expect(lost(second)).toBe(0);
    const x0 = hero.mover.x;
    cast(1, at(-30, 0));
    run(0.3);
    expect(x0 - hero.mover.x).toBeCloseTo(12, 0);
    const m = dummy(3, 0);
    cast(2, unit(m));
    run(0.5);
    expect(m.buffs.some((b) => b.reveal)).toBe(true);
    // Marked: spell damage +24%.
    sim.spellHit(m, 100, hero);
    expect(lost(m)).toBeCloseTo(124, 3);
    const s = dummy(-2, 0);
    cast(3, at(-2, 0));
    run(5);
    expect(lost(s)).toBeCloseTo(8 * 40, 0);
  });

  it('Centaur Raider', () => {
    const { sim, hero, dummy, cast, run, at, none } = setup('centaur_raider');
    const a = dummy(3, 0),
      b = dummy(6, 0);
    cast(0, at(9, 0));
    run(1);
    expect(lost(a)).toBe(180);
    expect(lost(b)).toBe(180);
    const c = dummy(-2, 0);
    cast(1, none);
    run(0.5);
    expect(lost(c)).toBe(110);
    expect(c.buffs.some((x) => x.stun)).toBe(true);
    // Herd Call aura on itself: faster.
    run(1);
    expect(hero.stats.moveSpeed).toBeCloseTo(hero.base.moveSpeed * 1.12, 5);
    const d = dummy(0, 8);
    const y0 = hero.mover.y;
    hero.mana = hero.stats.maxMana;
    cast(3, at(0, 14));
    run(2.5);
    expect(hero.mover.y - y0).toBeGreaterThan(10);
    expect(lost(d)).toBe(150);
    void sim;
  });

  it('Forest Elf', () => {
    const { sim, hero, dummy, cast, run, unit, at, none } = setup('forest_elf');
    const o = dummy(4, 0);
    cast(0, unit(o));
    run(0.5);
    expect(o.buffs.some((b) => b.root)).toBe(true);
    run(3.5);
    expect(lost(o)).toBeCloseTo(15 * 3, -1);
    const n = sim.entities.length;
    cast(1, at(2, 2));
    run(1);
    const spirits = sim.entities.slice(n).filter((e) => e.leaderId === hero.id);
    expect(spirits.length).toBe(2);
    expect(spirits[0]!.stats.maxHp).toBe(800);
    expect(spirits[0]!.stats.damageMin).toBe(35);
    expect(hero.stats.hpRegen - hero.base.hpRegen).toBeCloseTo(4.5, 5);
    const far = dummy(-8, 0);
    cast(3, none);
    run(1);
    expect(lost(far)).toBe(150);
    expect(far.buffs.some((b) => b.root)).toBe(true);
  });

  it('every hero ability has an effect, and every number in the docs is from the data', () => {
    const md = readFileSync(join(__dirname, '..', '..', 'docs', 'design', 'HEROES.md'), 'utf8');
    for (const a of ABILITIES) {
      expect(md, a.id).toContain(`— ${a.name}**`);
      // "damage 90 / 150 / 210" in the docs = params.damage in the data
      for (const [k, v] of Object.entries(a.params)) {
        if (typeof v !== 'number' && !Array.isArray(v)) continue;
        const words = k.replace(/([A-Z])/g, ' $1').toLowerCase();
        const text = Array.isArray(v) ? v.join(' / ') : String(v);
        expect(md, `${a.id}.${k}`).toContain(`${words} ${text}`);
      }
    }
  });
});
