import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  MatchSim,
  gameData,
  parseTerrain,
  buildMatchNav,
  entityTypeIndex,
  TerrainFlag,
  CommandType,
  castProblem,
  BinaryReader,
  BinaryWriter,
  writeCommand,
  readCommand,
  BuffFlag,
} from '../src';
import { earthCharges } from '../src/sim/earth-spirit';
function setup() {
  const raw = parseTerrain(readFileSync(join(import.meta.dirname, '../data/map-terrain.bin')));
  const terrain = { ...raw, flags: new Uint8Array(raw.flags.length).fill(TerrainFlag.Passable | TerrainFlag.Buildable) };
  const sim = new MatchSim(
    {
      seed: 3,
      noCamps: true,
      slots: [
        { index: 0, heroType: entityTypeIndex('earth_spirit'), team: 1, color: 0, start: 0 },
        { index: 1, heroType: 0, team: 2, color: 1, start: 1 },
      ],
    },
    buildMatchNav(terrain, gameData.map),
  );
  const h = sim.heroes[0]!;
  sim.teleport(h, 100, 100);
  sim.addXp(h, 99999);
  h.heroState!.abilityLevels = [4, 4, 4, 2, 1, 1];
  h.mana = h.stats.maxMana;
  const step = (sec: number) => {
    for (let i = 0; i < sec * 20; i++) sim.step();
  };
  let seq = 1;
  const cast = (slot: number, x = 0, y = 0, id = 0) =>
    sim.queueCommand(0, seq++, { type: CommandType.Cast, slot, target: id ? 1 : slot === 3 ? 0 : 2, id, x, y });
  const dummy = (x: number, y: number, team = 2) => {
    const t = sim.spawn(entityTypeIndex('ogre_brute'), 1, team, 1, x, y);
    t.inert = true;
    t.base = { ...t.base, hpRegen: 0 };
    t.stats = t.base;
    t.hp = t.stats.maxHp = 5000;
    return t;
  };
  const stones = () => sim.entities.filter((e) => e.alive && e.type === entityTypeIndex('earth_remnant'));
  return { sim, h, step, cast, dummy, stones };
}
it('D and F survive the binary command without aliasing Q or W', () => {
  for (const slot of [4, 5]) {
    const r = new BinaryReader(writeCommand(new BinaryWriter(), 2, { type: CommandType.Cast, slot, target: 2, id: 0, x: 100, y: 102 }));
    r.u8();
    const cmd = readCommand(r)?.cmd;
    expect(cmd).toMatchObject({ slot, target: 2 });
    if (cmd?.type === CommandType.Cast) {
      expect(cmd.x).toBeCloseTo(100, 2);
      expect(cmd.y).toBeCloseTo(102, 2);
    }
  }
});
it('stone charges are finite, recharge from simulation time and grant stored damage', () => {
  const { sim, h, cast, step, stones } = setup();
  const max = earthCharges(sim, h)!.count;
  for (let i = 0; i < max; i++) {
    cast(4, 101, 100);
    step(0.15);
  }
  expect(stones()).toHaveLength(max);
  expect(earthCharges(sim, h)!.count).toBe(0);
  expect(castProblem(sim, h, 4, { kind: 2, id: 0, x: 101, y: 100 })).toBe('charges');
  step(18);
  expect(earthCharges(sim, h)!.count).toBeGreaterThan(0);
  expect(h.buffs.find((b) => b.id === 'earth-stored-stones')?.damagePct).toBeGreaterThan(0);
});
it('kicked stones hit several enemies, slow them and use the actual moving statue', () => {
  const { h, cast, step, dummy, stones } = setup();
  cast(4, 101, 100);
  step(0.2);
  const a = dummy(104, 100),
    b = dummy(108, 100);
  cast(0, 114, 100);
  step(1);
  expect(a.hp).toBeLessThan(5000);
  expect(b.hp).toBeLessThan(5000);
  expect(a.buffs.some((b) => b.slowPct === 50)).toBe(true);
  expect(stones()[0]!.mover.x).toBeGreaterThan(110);
  expect(h.buffs.some((b) => b.id === 'earth-used-stone')).toBe(true);
});
it('pulling a distant stone damages and silences enemies along its path', () => {
  const { cast, step, dummy, stones } = setup();
  cast(4, 109, 100);
  step(0.2);
  const enemy = dummy(104, 100);
  cast(2, 109, 100);
  step(1.2);
  expect(enemy.hp).toBeLessThan(5000);
  expect(enemy.buffs.some((b) => b.silence)).toBe(true);
  expect(stones()[0]!.mover.x).toBeCloseTo(101);
});
it('rolling consumes a stone, extends its distance, damages and stuns the first enemy hero', () => {
  const { sim, h, cast, step, stones } = setup();
  const foe = sim.heroes[1]!;
  sim.teleport(foe, 112, 100);
  foe.inert = true;
  foe.hp = 5000;
  cast(4, 102, 100);
  step(0.2);
  cast(1, 116, 100);
  step(1.6);
  expect(stones()).toHaveLength(0);
  expect(h.mover.x).toBeGreaterThan(108);
  expect(h.mover.x).toBeLessThan(113);
  expect(foe.buffs.some((b) => b.stun)).toBe(true);
  expect(foe.hp).toBeLessThan(5000);
  expect(h.forced).toBeNull();
  expect(h.buffs.some((b) => b.flags & BuffFlag.Rolling)).toBe(false);
});
it('Magnetize uses a nearby stone to spread, refresh and share silence', () => {
  const { sim, h, cast, step, dummy, stones } = setup();
  const a = dummy(103, 100),
    b = dummy(108, 100);
  cast(3);
  step(0.3);
  expect(a.buffs.some((x) => x.id === 'magnetize')).toBe(true);
  expect(b.buffs.some((x) => x.id === 'magnetize')).toBe(false);
  cast(4, 104, 100);
  step(0.8);
  expect(stones()).toHaveLength(0);
  expect(b.buffs.some((x) => x.id === 'magnetize')).toBe(true);
  cast(4, 106, 100);
  step(0.05);
  cast(2, 106, 100);
  step(0.7);
  expect(a.buffs.some((x) => x.silence)).toBe(true);
  expect(b.buffs.some((x) => x.silence)).toBe(true);
  expect(a.buffs.find((x) => x.id === 'magnetize')!.until).toBeGreaterThan(sim.tick);
  expect(h.mana).toBeGreaterThan(0);
});
it('Enchant hides a unit, protects it, lets the stone move and restores it on shatter', () => {
  const { sim, h, cast, step, dummy, stones } = setup();
  const ally = dummy(101, 100, 1),
    foe = dummy(106, 100);
  cast(5, 0, 0, ally.id);
  step(0.3);
  expect(ally.hidden).toBe(true);
  expect(ally.invulnerable).toBe(true);
  expect(stones()).toHaveLength(1);
  const hp = ally.hp;
  sim.spellHit(ally, 1000, h);
  expect(ally.hp).toBe(hp);
  cast(0, 110, 100);
  step(2.5);
  expect(ally.hidden).toBe(false);
  expect(ally.invulnerable).toBe(false);
  expect(ally.mover.x).toBeGreaterThan(110);
  expect(stones()).toHaveLength(0);
  expect(foe.hp).toBeLessThan(5000);
});

it('places a stone during a roll without replacing the forced move or queued order', () => {
  const { h, cast, step, stones } = setup();
  cast(1, 116, 100);
  step(0.8);
  expect(h.forced).not.toBeNull();
  const x = h.mover.x;
  cast(4, x + 1, 100);
  step(0.6);
  expect(stones()).toHaveLength(0);
  expect(h.mover.x).toBeGreaterThan(108);
});
it('stuns and roots prevent rolling; an invalid combo does not spend mana', () => {
  const { sim, h, cast, step } = setup();
  const before = h.mana;
  cast(0, 112, 100);
  step(0.2);
  expect(h.mana).toBeGreaterThanOrEqual(before);
  sim.addBuff(h, {
    id: 'test-root',
    sourceId: h.id,
    sourceOwner: h.owner,
    sourceTeam: h.team,
    until: sim.tick + 20,
    flags: BuffFlag.Root,
    root: true,
  });
  expect(castProblem(sim, h, 1, { kind: 2, id: 0, x: 110, y: 100 })).toBe('rooted');
});
