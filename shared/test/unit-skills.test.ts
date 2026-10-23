// Unit skills: casters and monsters use them by themselves; the player can press the skills of
// own units (CommandType.UnitCast). Names and targets are in skills.json, numbers in units.json.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BinaryReader,
  BinaryWriter,
  blankBuilding,
  buildMatchNav,
  CommandType,
  entityTypeIndex,
  gameData,
  MatchSim,
  NEUTRAL,
  NEUTRAL_TEAM,
  parseTerrain,
  readCommand,
  TICK_RATE,
  unitSkillProblem,
  writeCommand,
  type SimEntity,
} from '../src/index';

const nav = buildMatchNav(parseTerrain(readFileSync(join(__dirname, '..', 'data', 'map-terrain.bin'))), gameData.map);
const skill = (unit: string, id: string) =>
  gameData.units.find((u) => u.id === unit)!.skills.find((s) => s.id === id)! as Record<string, number>;
const index = (unit: string, id: string) => gameData.units.find((u) => u.id === unit)!.skills.findIndex((s) => s.id === id);

function setup() {
  const sim = new MatchSim(
    {
      seed: 3,
      noCamps: true,
      slots: [
        { index: 0, heroType: entityTypeIndex('stone_golem'), team: 1, color: 0, start: 0 },
        { index: 1, heroType: entityTypeIndex('staff_warrior'), team: 2, color: 1, start: 1 },
      ],
    },
    nav,
  );
  const hero = sim.heroes[0]!;
  hero.mover.x = 110;
  hero.mover.y = 222;
  const unit = (id: string, owner: number, team: number, dx: number, dy = 0): SimEntity => {
    const u = sim.spawn(entityTypeIndex(id), owner, team, owner === NEUTRAL ? 0 : owner, hero.mover.x + dx, hero.mover.y + dy);
    u.thinkAt = Infinity;
    return u;
  };
  let seq = 0;
  const press = (slot: number, u: SimEntity, skillIndex: number, target = 0) =>
    sim.queueCommand(slot, ++seq, { type: CommandType.UnitCast, unit: u.id, skill: skillIndex, target });
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds * TICK_RATE); i++) sim.step();
  };
  return { sim, hero, unit, press, run };
}

describe('unit skills the player presses', () => {
  it('an own Cleric puts Faith Ward on the hero, pays mana and waits for the cooldown', () => {
    const { sim, hero, unit, press, run } = setup();
    const cleric = unit('cleric', 0, 1, 3);
    const ward = skill('cleric', 'faith_ward');
    const armor = hero.stats.armor;
    const mana = cleric.mana;
    press(0, cleric, index('cleric', 'faith_ward'), hero.id);
    run(0.1);
    expect(hero.stats.armor - armor).toBeCloseTo(ward['bonusArmor']!, 5);
    expect(cleric.mana).toBeLessThanOrEqual(mana - ward['manaCost']! + 1);
    // Pressed again at once: on cooldown, nothing happens.
    expect(unitSkillProblem(sim, hero, cleric.id, index('cleric', 'faith_ward'), hero.id)).toBe('cooldown');
  });

  it('a Frost Adept throws Ice Shard at the enemy the player picks: damage and slow', () => {
    const { hero, unit, press, run } = setup();
    const adept = unit('frost_adept', 0, 1, 2);
    const ogre = unit('ogre_brute', NEUTRAL, NEUTRAL_TEAM, 7);
    ogre.base = { ...ogre.base, hpRegen: 0 };
    ogre.stats = ogre.base;
    const speed = ogre.stats.moveSpeed;
    press(0, adept, index('frost_adept', 'ice_shard'), ogre.id);
    run(0.1);
    expect(ogre.stats.maxHp - ogre.hp).toBeGreaterThan(skill('frost_adept', 'ice_shard')['damage']! * 0.5);
    expect(ogre.stats.moveSpeed).toBeLessThan(speed);
    expect(hero.alive).toBe(true);
  });

  it('refuses: not your unit, out of range, wrong kind of target, a passive skill', () => {
    const { sim, hero, unit } = setup();
    const enemyHero = sim.heroes[1]!;
    const myAdept = unit('frost_adept', 0, 1, 2);
    const theirAdept = unit('frost_adept', 1, 2, -2);
    const ogreFar = unit('ogre_brute', NEUTRAL, NEUTRAL_TEAM, 30);
    const ogreNear = unit('ogre_brute', NEUTRAL, NEUTRAL_TEAM, 6);
    const shard = index('frost_adept', 'ice_shard');
    expect(unitSkillProblem(sim, hero, theirAdept.id, shard, ogreNear.id)).toBe('not your unit');
    expect(unitSkillProblem(sim, enemyHero, myAdept.id, shard, ogreNear.id)).toBe('not your unit');
    expect(unitSkillProblem(sim, hero, myAdept.id, shard, ogreFar.id)).toBe('range');
    expect(unitSkillProblem(sim, hero, myAdept.id, shard, hero.id)).toBe('target');
    expect(unitSkillProblem(sim, hero, myAdept.id, shard, ogreNear.id)).toBeNull();
    const golem = unit('foundry_golem', 0, 1, 1);
    expect(unitSkillProblem(sim, hero, golem.id, index('foundry_golem', 'stone_guard'), 0)).toBe('no skill');
    // A skill around the unit needs no target.
    expect(unitSkillProblem(sim, hero, golem.id, index('foundry_golem', 'ground_slam'), 0)).toBeNull();
  });

  it('the command survives the wire', () => {
    const bytes = writeCommand(new BinaryWriter(), 7, { type: CommandType.UnitCast, unit: 1234, skill: 1, target: 999 });
    const r = new BinaryReader(bytes);
    r.u8();
    expect(readCommand(r)?.cmd).toEqual({ type: CommandType.UnitCast, unit: 1234, skill: 1, target: 999 });
  });
});

describe('unit skills used by themselves', () => {
  it('the novice places one destroyable stationary healing lantern; destroying it stops healing', () => {
    const { sim, unit, run } = setup();
    const novice = unit('lantern_novice', 0, 1, 0, 5);
    const ally = unit('swordsman', 0, 1, 2, 5);
    ally.hp -= 150;
    run(0.65);
    const type = entityTypeIndex('healing_lantern');
    const lantern = sim.entities.find((e) => e.alive && e.type === type)!;
    expect(lantern).toBeDefined();
    expect(lantern.leaderId).toBe(novice.id);
    const hp = ally.hp,
      x = lantern.mover.x,
      y = lantern.mover.y;
    novice.skillReady['place_lantern'] = 0;
    run(1);
    expect(ally.hp - hp).toBeGreaterThanOrEqual(7);
    expect([lantern.mover.x, lantern.mover.y]).toEqual([x, y]);
    expect(sim.entities.filter((e) => e.alive && e.type === type)).toHaveLength(1);
    novice.mana = 0;
    sim.damage(lantern, 9999, sim.heroes[1]!, 0);
    run(0.7);
    const after = ally.hp;
    run(1);
    expect(ally.hp - after).toBeLessThan(1);
    novice.mana = 100;
    run(0.65);
    const next = sim.entities.find((e) => e.alive && e.type === type)!;
    expect(next).toBeDefined();
    sim.tick = next.summonUntil;
    sim.step();
    expect(next.alive).toBe(false);
  });
  it('a boar charges automatically and a root interrupts a later charge', () => {
    const { sim, unit, run } = setup();
    const boar = unit('boar_lancer', 0, 1, 0, 5);
    const foe = unit('ogre_brute', NEUTRAL, NEUTRAL_TEAM, 5, 5);
    boar.targetId = foe.id;
    const hp = foe.hp;
    run(1.2);
    expect(boar.skillReady['boar_charge']).toBeGreaterThan(sim.tick);
    expect(foe.hp).toBeLessThan(hp);
    sim.teleport(boar, 110, 227);
    sim.teleport(foe, 115, 227);
    boar.skillReady['boar_charge'] = 0;
    boar.targetId = foe.id;
    run(0.5);
    expect(boar.forced?.kind).toBe('charge');
    sim.addBuff(boar, {
      id: 'test-root',
      sourceId: foe.id,
      sourceOwner: foe.owner,
      sourceTeam: foe.team,
      until: sim.tick + 100,
      flags: 2,
      root: true,
    });
    run(0.1);
    expect(boar.forced).toBeNull();
  });

  it.each([
    ['bolt_cart', 'piercing_bolt'],
    ['kite_bomber', 'bomb_run'],
  ])('%s hits a ground line with %s and leaves air untouched', (id, ability) => {
    const { sim, unit, run } = setup();
    const caster = unit(id, 0, 1, 0, 5);
    const a = unit('ogre_brute', NEUTRAL, NEUTRAL_TEAM, 4, 5);
    const b = unit('ogre_brute', NEUTRAL, NEUTRAL_TEAM, 5.5, 5);
    const aside = unit('ogre_brute', NEUTRAL, NEUTRAL_TEAM, 4, 9);
    const air = unit('hawk_rider', NEUTRAL, NEUTRAL_TEAM, 4, 5);
    caster.targetId = a.id;
    const hp = [a.hp, b.hp, aside.hp, air.hp];
    run(0.65);
    expect(caster.skillReady[ability]).toBeGreaterThan(sim.tick);
    expect(a.hp).toBeLessThan(hp[0]!);
    expect(b.hp).toBeLessThan(hp[1]!);
    expect(aside.hp).toBe(hp[2]);
    expect(air.hp).toBe(hp[3]);
  });

  it('a fox marks its target and a porter repairs constructs instead of organic allies', () => {
    const { sim, unit, run } = setup();
    const fox = unit('fox_trailshot', 0, 1, 0, 5);
    const foe = unit('ogre_brute', NEUTRAL, NEUTRAL_TEAM, 4, 5);
    fox.targetId = foe.id;
    const porter = unit('coalback_porter', 0, 1, 0, -5);
    const golem = unit('foundry_golem', 0, 1, 2, -5);
    const human = unit('swordsman', 0, 1, 1, -5);
    golem.hp -= 200;
    human.hp -= 200;
    const hp = golem.hp,
      humanHp = human.hp;
    run(0.65);
    expect(foe.buffs.some((b) => b.id === 'trail_mark' && b.reveal)).toBe(true);
    expect(foe.stats.armor).toBeLessThan(foe.base.armor);
    expect(porter.skillReady['coalback_repair']).toBeGreaterThan(sim.tick);
    expect(golem.hp - hp).toBeGreaterThanOrEqual(80);
    expect(human.hp - humanHp).toBeLessThan(1);
  });

  it('drum auras do not stack; covered rams reject unit targets and resist ranged attacks', () => {
    const { sim, unit, run } = setup();
    unit('ram_drummer', 0, 1, 0, 5);
    unit('ram_drummer', 0, 1, 1, 5);
    const ally = unit('swordsman', 0, 1, 2, 5);
    const ram = unit('covered_ram', 0, 1, 0, -5);
    const enemy = unit('archer', 1, 2, 3, -5);
    run(0.55);
    expect(ally.stats.attackCooldown).toBeCloseTo(ally.base.attackCooldown / 1.15);
    expect(ram.stats.buildingsOnly).toBe(true);
    expect(sim.acquire(ram, 8, true)).toBe(0);
    const hp = ram.hp;
    sim.damage(ram, 100, enemy, 0);
    expect(hp - ram.hp).toBeCloseTo(25);
  });

  it.each([
    ['chainbreaker', 'shatter_armor'],
    ['rune_gunner', 'rune_shot'],
    ['siege_golem', 'demolition_slam'],
  ])('%s automatically uses %s against an enemy', (id, ability) => {
    const { sim, unit, run } = setup();
    const caster = unit(id, 0, 1, 0, 5);
    const target = unit('ogre_brute', NEUTRAL, NEUTRAL_TEAM, 1.5, 5);
    caster.targetId = target.id;
    const hp = target.hp;
    const armor = target.stats.armor;
    run(0.65);
    expect(caster.skillReady[ability]).toBeGreaterThan(sim.tick);
    if (ability === 'shatter_armor') expect(target.stats.armor).toBeLessThan(armor);
    else expect(target.hp).toBeLessThan(hp);
  });

  it.each([
    ['null_warden', 'null_screen'],
    ['reliquary_guard', 'reliquary_link'],
    ['veil_sister', 'veil_cleanse'],
  ])('%s automatically supports an ally with %s', (id, ability) => {
    const { sim, unit, run } = setup();
    const caster = unit(id, 0, 1, 0, 5);
    const ally = unit('swordsman', 0, 1, 2, 5);
    const foe = unit('ogre_brute', NEUTRAL, NEUTRAL_TEAM, 3.5, 5);
    ally.targetId = foe.id;
    ally.hp -= 150;
    if (id === 'veil_sister')
      sim.addBuff(ally, {
        id: 'test-slow',
        sourceId: foe.id,
        sourceOwner: foe.owner,
        sourceTeam: foe.team,
        until: 1000,
        flags: 8,
        slowPct: 30,
      });
    run(0.65);
    expect(caster.skillReady[ability]).toBeGreaterThan(sim.tick);
    expect(ally.buffs.some((b) => b.id === ability)).toBe(true);
    if (id === 'veil_sister') expect(ally.buffs.some((b) => b.id === 'test-slow')).toBe(false);
    if (id === 'reliquary_guard') {
      const guardHp = caster.hp;
      const allyHp = ally.hp;
      sim.damage(ally, 100, foe, 0);
      expect(caster.hp).toBeLessThan(guardHp);
      expect(allyHp - ally.hp).toBeCloseTo(70);
    }
  });

  it('captain auras do not stack and bulwark cover reduces ranged damage', () => {
    const { sim, unit, run } = setup();
    unit('banner_captain', 0, 1, 0, 5);
    unit('banner_captain', 0, 1, 1, 5);
    unit('bulwark_golem', 0, 1, 0, 6);
    const archer = unit('archer', 0, 1, 2, 5);
    const enemy = unit('archer', 1, 2, 7, 5);
    const armor = archer.stats.armor;
    run(0.55);
    expect(archer.stats.armor - armor).toBe(2);
    const hp = archer.hp;
    sim.damage(archer, 100, enemy, 0);
    expect(hp - archer.hp).toBeCloseTo(75);
  });

  it.each(['chain_spire', 'frost_obelisk', 'bell_ward', 'pitch_basin', 'wind_totem', 'shield_pylon'])(
    '%s triggers its defense skill without a player command',
    (id) => {
      const { sim, unit, run } = setup();
      const building = unit(id, 0, 1, 0, 5);
      const def = gameData.buildings.buildings.find((b) => b.id === id)!;
      building.building = blankBuilding(def, ...def.footprint);
      building.building.done = true;
      const foe = unit(id === 'wind_totem' ? 'hawk_rider' : 'ogre_brute', NEUTRAL, NEUTRAL_TEAM, 1.5, 5);
      foe.targetId = building.id;
      run(0.55);
      const skillId = def.skills![0]!.id;
      expect(building.skillReady[skillId]).toBeGreaterThan(sim.tick);
      if (id === 'frost_obelisk' || id === 'pitch_basin') expect(foe.stats.moveSpeed).toBeLessThan(foe.base.moveSpeed);
      if (id === 'bell_ward') expect(sim.isSilenced(foe)).toBe(true);
    },
  );

  it('a Troll Shaman hits its target with Hex Bolt; a Forest Troll has Troll Blood regen', () => {
    const { sim, unit, run } = setup();
    const shaman = unit('troll_shaman', NEUTRAL, NEUTRAL_TEAM, 0, 5);
    const target = unit('swordsman', 0, 1, 0, 9);
    target.base = { ...target.base, hpRegen: 0 };
    target.stats = target.base;
    shaman.targetId = target.id;
    run(1);
    expect(target.stats.maxHp - target.hp).toBeGreaterThanOrEqual(skill('troll_shaman', 'hex_bolt')['damage']! * 0.5);
    const troll = unit('forest_troll', NEUTRAL, NEUTRAL_TEAM, 0, -5);
    expect(troll.buffs.some((b) => b.id === 'passive:troll_blood')).toBe(true);
    expect(sim.tick).toBeGreaterThan(0);
  });
});
