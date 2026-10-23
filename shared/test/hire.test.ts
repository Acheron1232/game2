// Hired soldiers: the hero pays hero gold at its own production building; the soldiers follow
// it, pick their own fights and leave a fight only when it is far from the hero.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gameData, type BuildingDef } from '../src/data/index';
import { parseTerrain } from '../src/map/terrain';
import { buildMatchNav } from '../src/nav/match-nav';
import type { TreeList } from '../src/nav/trees';
import { CommandType } from '../src/sim/commands';
import { entityTypeIndex } from '../src/sim/entity-types';
import { FactionAI } from '../src/sim/faction/brain';
import { blankBuilding } from '../src/sim/faction/faction';
import { HIRE, hirePrice, hiredSupply, hireProblem, tavernStockAt } from '../src/sim/faction/hire';
import { MatchSim, TICK_RATE, type SimEntity } from '../src/sim/match-sim';

const DATA = join(import.meta.dirname, '..', 'data');
const terrain = parseTerrain(readFileSync(join(DATA, 'map-terrain.bin')));
const trees = (JSON.parse(readFileSync(join(DATA, 'map-trees.json'), 'utf8')) as { trees: TreeList }).trees;
const unit = (id: string) => gameData.units.findIndex((u) => u.id === id);
const SWORDSMAN = unit('swordsman');

function setup() {
  const sim = new MatchSim(
    {
      seed: 1,
      noCamps: true,
      slots: [0, 1].map((i) => ({ index: i, heroType: entityTypeIndex('staff_warrior'), team: i + 1, color: i, start: i })),
    },
    buildMatchNav(terrain, gameData.map),
    { terrain, trees },
  );
  const f = sim.factions!.get(0)!;
  const hall = sim.get(f.homeHallId)!;
  const def = gameData.buildings.buildings.find((b) => b.id === 'barracks') as BuildingDef;
  const barracks = sim.spawn(entityTypeIndex('barracks'), 0, f.team, f.color, hall.mover.x, hall.mover.y - 10);
  barracks.building = blankBuilding(def, def.footprint[0], def.footprint[1]);
  barracks.building.done = true;
  f.buildings.add(barracks.id);
  const hero = sim.heroes[0]!;
  hero.mover.x = barracks.mover.x + 4;
  hero.mover.y = barracks.mover.y;
  hero.heroState!.gold = 5000;
  let seq = 0;
  const send = (cmd: Parameters<MatchSim['queueCommand']>[2]) => sim.queueCommand(0, ++seq, cmd);
  const run = (sec: number) => {
    for (let i = 0; i < sec * TICK_RATE; i++) sim.step();
  };
  return { sim, f, hero, barracks, send, run };
}

const near = (a: SimEntity, x: number, y: number) => Math.hypot(a.mover.x - x, a.mover.y - y);

describe('hiring soldiers', () => {
  it('new tavern stocks are shared, reject an empty hire without payment, and refill over simulation time', () => {
    const { sim, hero, send, run } = setup();
    const shop = gameData.map.shops.findIndex((s) => s.type === 'tavern_mossy');
    const at = gameData.map.shops[shop]!.pos;
    sim.teleport(hero, at[0] + 4, at[1]);
    const badger = unit('badger_mercenary');
    for (let i = 0; i < 2; i++) {
      expect(send({ type: CommandType.Hire, unit: badger })).toBe(true);
      run(0.1);
    }
    const gold = hero.heroState!.gold;
    expect(tavernStockAt(sim, shop, badger)?.count).toBe(0);
    expect(hireProblem(sim, hero, badger)).toBe('stock');
    expect(send({ type: CommandType.Hire, unit: badger })).toBe(false);
    expect(hero.heroState!.gold).toBe(gold);
    const other = sim.heroes[1]!;
    sim.teleport(other, at[0] + 4, at[1]);
    expect(hireProblem(sim, other, badger)).toBe('stock');
    sim.tick += 70 * TICK_RATE;
    expect(tavernStockAt(sim, shop, badger)?.count).toBe(1);
    expect(hireProblem(sim, hero, badger)).toBeNull();
    sim.tick += 70 * TICK_RATE;
    expect(tavernStockAt(sim, shop, badger)).toEqual({ count: 2, readyAt: 0 });
  });
  it.each([
    ['badger_mercenary', 'tavern_mossy'],
    ['fox_trailshot', 'tavern_mossy'],
    ['coalback_porter', 'tavern_ember'],
  ])('hires %s at the expanded %s roster', (id, tavern) => {
    const { sim, f, hero, send, run } = setup();
    const at = gameData.map.shops.find((s) => s.type === tavern)!.pos;
    sim.teleport(hero, at[0] + 4, at[1]);
    const gold = hero.heroState!.gold;
    expect(hireProblem(sim, hero, unit(id))).toBeNull();
    expect(send({ type: CommandType.Hire, unit: unit(id) })).toBe(true);
    run(0.1);
    const hired = [...f.hired].map((uid) => sim.get(uid)!).find((e) => e.type === entityTypeIndex(id));
    expect(hired?.leaderId).toBe(hero.id);
    expect(hero.heroState!.gold).toBeLessThanOrEqual(gold - hirePrice(unit(id))! + 1);
  });
  it('costs hero gold at an own building, uses no faction supply, and has a limit', () => {
    const { sim, f, hero, send, run } = setup();
    const supply = f.supplyUsed;
    const price = hirePrice(SWORDSMAN)!;
    expect(price).toBe(Math.round(120 * HIRE.priceFactor));
    expect(hirePrice(unit('worker'))).toBeNull();
    expect(hireProblem(sim, hero, unit('archer'))).toBe('range'); // no Archery Range here
    expect(hireProblem(sim, hero, unit('lancer'))).toBe('needs'); // Stronghold and Forge
    expect(send({ type: CommandType.Hire, unit: SWORDSMAN })).toBe(true);
    run(0.1);
    expect(hero.heroState!.gold).toBe(5000 - price);
    expect(f.hired.size).toBe(1);
    const s = sim.get([...f.hired][0]!)!;
    expect(s.hired && s.leaderId === hero.id && s.owner === 0 && s.team === f.team).toBe(true);
    run(1);
    expect(f.supplyUsed).toBe(supply);
    expect(f.units.has(s.id)).toBe(false);
    // Up to the limit (30 supply = 15 swordsmen), then 'limit'.
    expect(HIRE.maxSupply).toBe(30);
    for (let i = 0; i < 20; i++) send({ type: CommandType.Hire, unit: SWORDSMAN });
    run(0.5);
    expect(hiredSupply(sim, hero)).toBe(HIRE.maxSupply);
    expect(hireProblem(sim, hero, SWORDSMAN)).toBe('limit');
    // Away from the building: 'range'.
    hero.mover.x += 30;
    expect(hireProblem(sim, hero, SWORDSMAN)).toBe('range');
  });

  it('follows the hero, keeps its fight when the hero steps away, leaves a far fight', () => {
    const { sim, f, hero, send, run } = setup();
    send({ type: CommandType.Hire, unit: SWORDSMAN });
    run(1);
    const s = sim.get([...f.hired][0]!)!;
    // The hero walks away: the soldier follows.
    const [tx, ty] = [hero.mover.x + 20, hero.mover.y + 2];
    send({ type: CommandType.Move, x: tx, y: ty, queue: false });
    run(12);
    expect(near(hero, tx, ty)).toBeLessThan(1);
    expect(near(s, hero.mover.x, hero.mover.y)).toBeLessThan(HIRE.followDistance + 1);
    // An enemy near the soldier: it fights it on its own.
    const enemy = sim.spawn(entityTypeIndex('swordsman'), 1, 2, 1, s.mover.x + 3, s.mover.y);
    enemy.order = 'hold';
    enemy.hp = enemy.stats.maxHp = 5000;
    run(1);
    expect(s.targetId).toBe(enemy.id);
    // A few steps away: the soldier stays in its fight.
    send({ type: CommandType.Move, x: hero.mover.x + 6, y: hero.mover.y, queue: false });
    run(3);
    expect(s.targetId).toBe(enemy.id);
    // Far away: it leaves the fight and comes back.
    send({ type: CommandType.Move, x: hero.mover.x - 30, y: hero.mover.y, queue: false });
    run(15);
    expect(s.targetId).not.toBe(enemy.id);
    expect(near(s, hero.mover.x, hero.mover.y)).toBeLessThan(HIRE.followDistance + 2);
  });

  it('attacks the enemy the hero was ordered to attack, until the next order', () => {
    const { sim, f, hero, send, run } = setup();
    for (let i = 0; i < 3; i++) send({ type: CommandType.Hire, unit: SWORDSMAN });
    run(2);
    const soldiers = [...f.hired].map((id) => sim.get(id)!);
    expect(soldiers.length).toBe(3);
    const tough = (e: SimEntity) => {
      e.order = 'hold';
      e.hp = e.stats.maxHp = 50000;
      return e;
    };
    // One enemy right next to the soldiers (they take it on their own), one past the leash.
    const close = tough(sim.spawn(entityTypeIndex('swordsman'), 1, 2, 1, hero.mover.x + 3, hero.mover.y));
    const chosen = tough(sim.spawn(entityTypeIndex('swordsman'), 1, 2, 1, hero.mover.x + HIRE.leash + 4, hero.mover.y + 2));
    run(1);
    for (const s of soldiers) expect(s.targetId).toBe(close.id);
    // A + click on the far enemy: every soldier goes for it, the close one does not keep them.
    expect(send({ type: CommandType.Attack, target: chosen.id })).toBe(true);
    run(0.2);
    for (const s of soldiers) expect(s.targetId).toBe(chosen.id);
    run(6);
    // In a ring around it (four melee fighters on one target).
    for (const s of soldiers) expect(near(s, chosen.mover.x, chosen.mover.y)).toBeLessThan(4);
    expect(chosen.hp).toBeLessThan(50000);
    // A new order ends it: they leave the far fight and choose their own targets again (the
    // close enemy is within the leash of where the hero stops).
    send({ type: CommandType.Move, x: hero.mover.x - 25, y: hero.mover.y, queue: false });
    run(12);
    for (const s of soldiers) {
      expect(s.targetId).not.toBe(chosen.id);
      const t = sim.get(s.targetId);
      if (t) expect(near(t, hero.mover.x, hero.mover.y)).toBeLessThanOrEqual(HIRE.leash);
      else expect(near(s, hero.mover.x, hero.mover.y)).toBeLessThan(HIRE.followDistance + 2);
    }
  });

  it('bot heroes hire soldiers and buy Town Hall upgrades', () => {
    const sim = new MatchSim(
      {
        seed: 5,
        slots: [0, 1].map((i) => ({
          index: i,
          heroType: entityTypeIndex(i ? 'blood_witch' : 'staff_warrior'),
          team: i + 1,
          color: i,
          start: i,
          ai: 'normal' as const,
          bot: true,
        })),
      },
      buildMatchNav(terrain, gameData.map),
      { terrain, trees },
    );
    sim.ai = new FactionAI(sim);
    let hiredEver = 0;
    for (let t = 0; t < 16 * 60 * TICK_RATE; t++) {
      sim.step();
      if (t % TICK_RATE === 0) for (const slot of [0, 1]) hiredEver = Math.max(hiredEver, sim.factions!.get(slot)!.hired.size);
    }
    expect(hiredEver, 'soldiers hired by bots').toBeGreaterThan(0);
    const upgrades = [0, 1].reduce((n, slot) => n + Object.keys(sim.factions!.get(slot)!.upgrades).length, 0);
    expect(upgrades, 'Town Hall upgrades bought by bots').toBeGreaterThan(0);
  }, 60_000);

  it('a Cleric (army or hired) heals hurt allies, also after a fight', () => {
    const { sim, f, hero, run } = setup();
    const cleric = sim.spawn(entityTypeIndex('cleric'), 0, f.team, f.color, hero.mover.x + 1, hero.mover.y);
    cleric.leaderId = hero.id;
    cleric.hired = true;
    f.hired.add(cleric.id);
    const hurt = sim.spawn(entityTypeIndex('swordsman'), 0, f.team, f.color, hero.mover.x + 2, hero.mover.y + 1);
    f.units.add(hurt.id);
    hurt.hp = 100;
    run(4);
    expect(hurt.hp).toBeGreaterThan(130);
  });

  it('any hero hires mercenaries at a tavern: its own list, its own price, no kingdom tech', () => {
    const { sim, f, hero, send, run } = setup();
    const mossy = gameData.map.shops.find((s) => s.type === 'tavern_mossy')!;
    hero.mover.x = mossy.pos[0] + 4;
    hero.mover.y = mossy.pos[1];
    const ratling = unit('ratling_cutthroat');
    expect(hirePrice(ratling)).toBe(gameData.units[ratling]!.cost!.gold);
    expect(hireProblem(sim, hero, unit('ember_wisp'))).toBe('range'); // the other tavern hires wisps
    expect(hireProblem(sim, hero, SWORDSMAN)).toBe('range'); // no Barracks here
    expect(send({ type: CommandType.Hire, unit: ratling })).toBe(true);
    run(0.5);
    const s = sim.get([...f.hired][0]!)!;
    expect(s.type).toBe(entityTypeIndex('ratling_cutthroat'));
    expect(s.leaderId).toBe(hero.id);
    expect(near(s, mossy.pos[0], mossy.pos[1])).toBeLessThan(6);
  });
});
