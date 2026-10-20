// Items, shops, items on the ground, camp drops, fountains and uphill misses work as
// items.json, shops.json, camps.json and rules.json say, and the server refuses what it should.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BinaryWriter,
  buildMatchNav,
  ClientView,
  CommandType,
  DamageKind,
  entityTypeIndex,
  EventType,
  gameData,
  groundLevel,
  heroStats,
  itemIndex,
  ITEMS,
  MatchSim,
  NEUTRAL,
  NEUTRAL_TEAM,
  newCharges,
  NoticeCode,
  parseTerrain,
  readSnapshot,
  rollDropTable,
  SnapshotData,
  SnapshotWriter,
  storeItem,
  TeamVision,
  TICK_RATE,
  type GameCommand,
  type SimEntity,
} from '../src/index';

const nav = buildMatchNav(parseTerrain(readFileSync(join(__dirname, '..', 'data', 'map-terrain.bin'))), gameData.map);
const R = gameData.rules;
const it_ = (id: string) => ITEMS[itemIndex(id)]!;
const NORTH_SHOP = gameData.map.shops.find((s) => s.id === 'north_side_shop')!.pos;
const TEMPLE_MARKET = gameData.map.shops.find((s) => s.type === 'temple_market')!.pos;

/** Heroes on teams 1, 2... (or the given teams), no camps, on the open base field. */
function setup(heroes: string[] = ['staff_warrior'], teams?: number[]) {
  const slots = heroes.map((h, i) => ({ index: i, heroType: entityTypeIndex(h), team: teams?.[i] ?? i + 1, color: i, start: i }));
  const sim = new MatchSim({ seed: 3, slots, noCamps: true }, nav);
  const hero = sim.heroes[0]!;
  hero.mover.x = 110;
  hero.mover.y = 222;
  // One tick, so the unit grid is built (damage looks for helpers in it).
  sim.step();
  let seq = 0;
  const cmd = (c: GameCommand, slot = 0) => sim.queueCommand(slot, ++seq, c);
  const run = (seconds: number, each?: () => void) => {
    for (let i = 0; i < Math.round(seconds * TICK_RATE); i++) {
      sim.step();
      each?.();
    }
  };
  const give = (e: SimEntity, id: string, charges = newCharges(itemIndex(id))) => {
    expect(storeItem(e.heroState!.inventory, itemIndex(id), charges)).toBe(true);
    sim.refreshStats(e);
  };
  const toShop = (e: SimEntity, pos = NORTH_SHOP) => {
    e.mover.x = pos[0] + 3;
    e.mover.y = pos[1];
  };
  const dummy = (x: number, y: number, unit = 'ogre_brute'): SimEntity => {
    const d = sim.spawn(entityTypeIndex(unit), NEUTRAL, NEUTRAL_TEAM, 255, x, y);
    d.passive = true;
    d.thinkAt = Infinity;
    d.base = { ...d.base, hpRegen: 0 };
    d.stats = d.base;
    return d;
  };
  const inv = (e = hero) => e.heroState!.inventory.map((s) => (s ? `${ITEMS[s.item]!.id}${s.charges ? `x${s.charges}` : ''}` : '-'));
  return { sim, hero, cmd, run, give, toShop, dummy, inv };
}

const events = (sim: MatchSim, type: number) => sim.events.items.slice(0, sim.events.count).filter((e) => e.type === type);

describe('shops', () => {
  it('sell what shops.json lists, for gold, only in range', () => {
    const { sim, hero, cmd, run, toShop, inv } = setup();
    const claws = itemIndex('iron_claws');
    // Too far from any shop.
    expect(sim.itemCheck(0, { type: CommandType.BuyItem, item: claws })).toBe('range');
    toShop(hero);
    expect(sim.itemCheck(0, { type: CommandType.BuyItem, item: claws })).toBeNull();
    // Drop-only items are never sold; the side shop does not sell the Warblade.
    expect(sim.itemCheck(0, { type: CommandType.BuyItem, item: itemIndex('vampire_fang') })).toBe('item');
    expect(sim.itemCheck(0, { type: CommandType.BuyItem, item: itemIndex('warblade') })).toBe('range');
    const gold0 = hero.heroState!.gold;
    cmd({ type: CommandType.BuyItem, item: claws });
    run(0.05);
    expect(inv()).toEqual(['iron_claws', '-', '-', '-', '-', '-']);
    expect(hero.heroState!.gold).toBe(gold0 - 250);
    // 0 gold left (start gold 250): not enough for anything.
    expect(sim.itemCheck(0, { type: CommandType.BuyItem, item: itemIndex('healing_potion') })).toBe('gold');
    // The Temple Market sells the Warblade.
    hero.heroState!.gold = 5000;
    toShop(hero, TEMPLE_MARKET);
    expect(sim.itemCheck(0, { type: CommandType.BuyItem, item: itemIndex('warblade') })).toBeNull();
  });

  it('stack potions up to 5 and refuse when the inventory is full', () => {
    const { sim, hero, cmd, run, toShop, inv } = setup();
    toShop(hero);
    hero.heroState!.gold = 10000;
    for (let i = 0; i < 6; i++) cmd({ type: CommandType.BuyItem, item: itemIndex('healing_potion') });
    cmd({ type: CommandType.BuyItem, item: itemIndex('ward') });
    cmd({ type: CommandType.BuyItem, item: itemIndex('ward') });
    run(0.05);
    expect(inv()).toEqual(['healing_potionx5', 'healing_potionx1', 'wardx4', '-', '-', '-']);
    for (const id of ['guard_ring', 'guard_ring', 'guard_ring']) cmd({ type: CommandType.BuyItem, item: itemIndex(id) });
    run(0.05);
    expect(sim.itemCheck(0, { type: CommandType.BuyItem, item: itemIndex('guard_ring') })).toBe('full');
    // A potion still fits on the stack of one.
    expect(sim.itemCheck(0, { type: CommandType.BuyItem, item: itemIndex('healing_potion') })).toBeNull();
  });

  it('buy back half the value; charges count', () => {
    const { sim, hero, cmd, run, give, toShop } = setup();
    give(hero, 'boots_of_haste');
    give(hero, 'ward', 3);
    expect(sim.itemCheck(0, { type: CommandType.SellItem, slot: 0 })).toBe('range');
    toShop(hero);
    const gold0 = hero.heroState!.gold;
    cmd({ type: CommandType.SellItem, slot: 0 });
    cmd({ type: CommandType.SellItem, slot: 1 });
    run(0.05);
    // Boots 300 -> 150; wards 75 for 2 charges -> 3 charges sell for 56.
    expect(hero.heroState!.gold - gold0).toBe(150 + Math.floor(75 * 0.5 * 1.5));
    expect(hero.heroState!.inventory.every((s) => s === null)).toBe(true);
  });
});

describe('item stats', () => {
  it('add attributes, damage, armor, health, speed; unique items count once', () => {
    const { hero, give } = setup(['staff_warrior']);
    const def = hero.heroState!.def;
    const base = heroStats(def, 1);
    give(hero, 'giant_belt');
    expect(hero.stats.maxHp).toBe(base.maxHp + 6 * R.attributes.strength.hpPerPoint);
    give(hero, 'boots_of_haste');
    give(hero, 'boots_of_haste');
    expect(hero.stats.moveSpeed).toBeCloseTo(base.moveSpeed + 0.6, 5);
    give(hero, 'iron_claws');
    give(hero, 'iron_claws');
    expect(hero.stats.damageMin).toBe(base.damageMin + 16);
    give(hero, 'ironwood_shield');
    expect(hero.stats.armor).toBeCloseTo(base.armor + 5, 5);
    expect(hero.stats.maxHp).toBe(base.maxHp + 120 + 200);
  });

  it('attack speed and regen items', () => {
    const { hero, give } = setup(['arcane_huntress']);
    const base = heroStats(hero.heroState!.def, 1);
    const agi = Math.floor(hero.heroState!.def.attributes.agility[0]);
    give(hero, 'swift_gloves');
    give(hero, 'life_pendant');
    give(hero, 'mana_stone');
    expect(hero.stats.attackCooldown).toBeCloseTo(hero.heroState!.def.attackCooldown / (1 + (agi + 15) / 100), 5);
    expect(hero.stats.hpRegen).toBeCloseTo(base.hpRegen + 2.5, 5);
    expect(hero.stats.manaRegen).toBeCloseTo(base.manaRegen + 1.5, 5);
  });
});

describe('active items', () => {
  it('potions heal and share one cooldown', () => {
    const { sim, hero, cmd, run, give, inv } = setup();
    give(hero, 'healing_potion', 2);
    give(hero, 'mana_potion', 1);
    hero.hp = 100;
    hero.mana = 0;
    cmd({ type: CommandType.UseItem, slot: 0, target: 0, id: 0, x: 0, y: 0 });
    run(0.05);
    expect(hero.hp).toBeGreaterThanOrEqual(Math.min(hero.stats.maxHp, 350) - 1);
    expect(inv()).toEqual(['healing_potionx1', 'mana_potionx1', '-', '-', '-', '-']);
    expect(sim.itemCheck(0, { type: CommandType.UseItem, slot: 1, target: 0, id: 0, x: 0, y: 0 })).toBe('cooldown');
    run(10);
    cmd({ type: CommandType.UseItem, slot: 1, target: 0, id: 0, x: 0, y: 0 });
    let manaEvent = false;
    run(0.05, () => (manaEvent ||= events(sim, EventType.Damage).some((e) => e.kind === DamageKind.Mana && e.value === 150)));
    expect(manaEvent).toBe(true);
    expect(inv()[1]).toBe('-');
  });

  it('a potion does not stop an attack', () => {
    const { hero, cmd, run, give, dummy } = setup();
    give(hero, 'healing_potion');
    const d = dummy(hero.mover.x + 1.5, hero.mover.y);
    cmd({ type: CommandType.Attack, target: d.id });
    run(0.5);
    cmd({ type: CommandType.UseItem, slot: 0, target: 0, id: 0, x: 0, y: 0 });
    run(0.05);
    expect(hero.order).toBe('attack');
    expect(hero.targetId).toBe(d.id);
  });

  it('Scroll of Return: 3 s channel, then at the base; a move order stops it', () => {
    const { sim, hero, cmd, run, give, inv } = setup();
    give(hero, 'scroll_of_return', 2);
    hero.mover.x = 128;
    hero.mover.y = 190;
    cmd({ type: CommandType.UseItem, slot: 0, target: 0, id: 0, x: 0, y: 0 });
    run(1);
    cmd({ type: CommandType.Move, x: 128, y: 195, queue: false });
    run(3);
    expect(inv()[0]).toBe('scroll_of_returnx2');
    cmd({ type: CommandType.UseItem, slot: 0, target: 0, id: 0, x: 0, y: 0 });
    run(2.9);
    expect(hero.mover.y).toBeLessThan(200); // still channeling
    run(0.2);
    const home = gameData.map.starts[0]!.heroSpawn;
    expect(Math.hypot(hero.mover.x - home[0], hero.mover.y - home[1])).toBeLessThan(0.01);
    expect(inv()[0]).toBe('scroll_of_returnx1');
    expect(sim.itemCheck(0, { type: CommandType.UseItem, slot: 0, target: 0, id: 0, x: 0, y: 0 })).toBe('cooldown');
  });

  it('Tome of Wisdom gives 150 XP and is used up', () => {
    const { hero, cmd, run, give, inv } = setup();
    give(hero, 'tome_of_wisdom');
    cmd({ type: CommandType.UseItem, slot: 0, target: 0, id: 0, x: 0, y: 0 });
    run(0.05);
    expect(hero.heroState!.xp).toBe(150);
    expect(inv()[0]).toBe('-');
  });

  it('Smoke Bomb hides the hero from enemies until it attacks', () => {
    const { sim, hero, cmd, run, give, dummy } = setup(['staff_warrior', 'stone_golem']);
    const enemy = sim.heroes[1]!;
    enemy.mover.x = hero.mover.x + 4;
    enemy.mover.y = hero.mover.y;
    const vision = new TeamVision(sim.size);
    give(hero, 'smoke_bomb');
    cmd({ type: CommandType.UseItem, slot: 0, target: 0, id: 0, x: 0, y: 0 });
    run(0.05);
    vision.update(sim.entities);
    expect(vision.sees(enemy.team, hero)).toBe(false);
    expect(vision.sees(hero.team, hero)).toBe(true);
    // Enemies can not order an attack on it, and monsters do not pick it.
    sim.canSee = (team, e) => vision.sees(team, e);
    expect(sim.queueCommand(1, 50, { type: CommandType.Attack, target: hero.id })).toBe(false);
    expect(sim.acquire(enemy, 10, true)).not.toBe(hero.id);
    // Attacking ends it.
    const d = dummy(hero.mover.x - 1.5, hero.mover.y);
    cmd({ type: CommandType.Attack, target: d.id });
    run(1);
    vision.update(sim.entities);
    expect(vision.sees(enemy.team, hero)).toBe(true);
  });

  it('Watcher Ward: walk into range, place an invisible eye that sees 10 for 3 minutes', () => {
    const { sim, hero, cmd, run, give, inv } = setup(['staff_warrior', 'stone_golem']);
    const enemy = sim.heroes[1]!;
    give(hero, 'ward');
    const [tx, ty] = [hero.mover.x + 10, hero.mover.y];
    cmd({ type: CommandType.UseItem, slot: 0, target: 2, id: 0, x: tx, y: ty });
    run(3);
    const ward = sim.entities.find((e) => e.type === entityTypeIndex('watcher_ward'))!;
    expect(ward).toBeDefined();
    expect(ward.team).toBe(hero.team);
    expect(Math.hypot(ward.mover.x - tx, ward.mover.y - ty)).toBeLessThan(0.01);
    expect(Math.hypot(hero.mover.x - tx, hero.mover.y - ty)).toBeLessThanOrEqual(6.01);
    expect(inv()[0]).toBe('wardx1');
    const vision = new TeamVision(sim.size);
    // The ward sees an enemy 9 away; the enemy does not see the ward.
    hero.mover.x = 30;
    hero.mover.y = 30;
    enemy.mover.x = tx + 9;
    enemy.mover.y = ty;
    vision.update(sim.entities);
    expect(vision.sees(hero.team, enemy)).toBe(true);
    expect(vision.sees(enemy.team, ward)).toBe(false);
    run(R.items.groundItemSec);
    expect(ward.alive).toBe(false);
  });

  it('can not be used while stunned', () => {
    const { sim, hero, give } = setup();
    give(hero, 'healing_potion');
    sim.addBuff(hero, { id: 'stun', sourceId: 0, sourceOwner: 0, sourceTeam: 0, until: sim.tick + 40, flags: 0, stun: true });
    expect(sim.itemCheck(0, { type: CommandType.UseItem, slot: 0, target: 0, id: 0, x: 0, y: 0 })).toBe('stunned');
    // Passive items have nothing to use.
    give(hero, 'guard_ring');
    expect(sim.itemCheck(0, { type: CommandType.UseItem, slot: 1, target: 0, id: 0, x: 0, y: 0 })).toBe('passive');
  });
});

describe('passive items', () => {
  it('Vampire Fang heals 15% of attack damage', () => {
    const { sim, hero, cmd, run, give, dummy } = setup();
    give(hero, 'vampire_fang');
    hero.hp = 100;
    hero.base = { ...hero.base, hpRegen: 0 };
    hero.stats = { ...hero.stats, hpRegen: 0 };
    const d = dummy(hero.mover.x + 1.5, hero.mover.y);
    let dealt = 0,
      healed = 0;
    cmd({ type: CommandType.Attack, target: d.id });
    run(5, () => {
      for (const e of events(sim, EventType.Damage)) {
        if (e.a === d.id && e.kind === DamageKind.Attack) dealt += e.value;
        if (e.a === hero.id && e.kind === DamageKind.Heal) healed += e.value;
      }
    });
    expect(dealt).toBeGreaterThan(50);
    expect(healed).toBeGreaterThan(dealt * 0.15 - 4);
    expect(healed).toBeLessThan(dealt * 0.15 + 4);
  });

  it('Frost Orb slows the target by 20% for 2 s', () => {
    const { hero, cmd, run, give, dummy } = setup();
    give(hero, 'frost_orb');
    const d = dummy(hero.mover.x + 1.5, hero.mover.y);
    cmd({ type: CommandType.Attack, target: d.id });
    run(1.5);
    expect(d.stats.moveSpeed).toBeCloseTo(d.base.moveSpeed * 0.8, 5);
    cmd({ type: CommandType.Stop });
    run(2.5);
    expect(d.stats.moveSpeed).toBe(d.base.moveSpeed);
  });

  it('Storm Hammer lightning jumps to at most 3 enemies for 90 each', () => {
    const { sim, hero, cmd, run, give, dummy } = setup();
    give(hero, 'storm_hammer');
    const ds = [
      dummy(hero.mover.x + 1.5, hero.mover.y),
      dummy(hero.mover.x + 3, hero.mover.y + 2),
      dummy(hero.mover.x + 4, hero.mover.y - 2),
    ];
    ds.push(dummy(hero.mover.x + 6, hero.mover.y));
    for (const d of ds) d.hp = d.stats.maxHp = d.base.maxHp = 100000;
    let attacks = 0,
      chains = 0;
    const perTick: number[] = [];
    cmd({ type: CommandType.Attack, target: ds[0]!.id });
    run(60, () => {
      attacks += events(sim, EventType.Attack).filter((e) => e.a === hero.id).length;
      const c = events(sim, EventType.Chain);
      if (c.length) {
        chains++;
        perTick.push(c.length);
        for (const e of c) expect(sim.get(e.b)!.team).toBe(NEUTRAL_TEAM);
        expect(
          events(sim, EventType.Damage)
            .filter((e) => e.kind === DamageKind.Spell)
            .every((e) => e.value === 90),
        ).toBe(true);
      }
    });
    expect(Math.max(...perTick)).toBe(3);
    // About 20% of attacks.
    expect(chains / attacks).toBeGreaterThan(0.08);
    expect(chains / attacks).toBeLessThan(0.35);
  });

  it('Phoenix Feather brings the hero back where it fell, with half health, once', () => {
    const { sim, hero, run, give, inv } = setup(['staff_warrior', 'stone_golem']);
    const killer = sim.heroes[1]!;
    give(hero, 'phoenix_feather');
    hero.mover.x = 120;
    hero.mover.y = 215;
    sim.damage(hero, 99999, { id: killer.id, owner: 1, team: killer.team }, DamageKind.Spell);
    expect(hero.alive).toBe(false);
    expect(inv()[0]).toBe('-');
    run(2.05);
    expect(hero.alive).toBe(true);
    expect([hero.mover.x, hero.mover.y]).toEqual([120, 215]);
    expect(hero.hp).toBeCloseTo(hero.stats.maxHp / 2, 0);
    // No feather now: the normal respawn time.
    sim.damage(hero, 99999, { id: killer.id, owner: 1, team: killer.team }, DamageKind.Spell);
    run(2.05);
    expect(hero.alive).toBe(false);
  });
});

describe('items on the ground', () => {
  it('drop, pick up and give to an ally', () => {
    const { sim, hero, cmd, run, give, inv } = setup(['staff_warrior', 'light_healer'], [1, 1]);
    const ally = sim.heroes[1]!;
    give(hero, 'guard_ring');
    give(hero, 'giant_belt');
    const armor0 = hero.stats.armor;
    const [dx, dy] = [hero.mover.x + 5, hero.mover.y];
    cmd({ type: CommandType.DropItem, slot: 0, x: dx, y: dy });
    run(3);
    expect(inv()[0]).toBe('-');
    expect(hero.stats.armor).toBeCloseTo(armor0 - 3, 5);
    expect(sim.groundItems).toHaveLength(1);
    const g = sim.groundItems[0]!;
    expect(Math.hypot(g.x - dx, g.y - dy)).toBeLessThan(1);
    expect(Math.hypot(hero.mover.x - dx, hero.mover.y - dy)).toBeLessThanOrEqual(R.items.pickUpRange + 0.01);
    // The ally picks it up.
    ally.mover.x = hero.mover.x - 8;
    ally.mover.y = hero.mover.y;
    cmd({ type: CommandType.PickUp, id: g.id }, 1);
    run(4);
    expect(sim.groundItems).toHaveLength(0);
    expect(inv(ally)[0]).toBe('guard_ring');
    // Give the belt to the ally: walk next to it first.
    cmd({ type: CommandType.GiveItem, slot: 1, target: ally.id });
    run(4);
    expect(inv()[1]).toBe('-');
    expect(inv(ally)[1]).toBe('giant_belt');
    // Enemies are not allies.
    const { sim: s2, hero: h2, give: give2 } = setup(['staff_warrior', 'light_healer']);
    give2(h2, 'guard_ring');
    expect(s2.itemCheck(0, { type: CommandType.GiveItem, slot: 0, target: s2.heroes[1]!.id })).toBe('target');
  });

  it('a full inventory can not pick up; items vanish after 3 minutes', () => {
    const { sim, hero, cmd, run, give } = setup();
    for (let i = 0; i < 6; i++) give(hero, 'guard_ring');
    const g = sim.dropOnGround(itemIndex('warblade'), 0, hero.mover.x + 1, hero.mover.y);
    cmd({ type: CommandType.PickUp, id: g.id });
    let notice = false;
    run(1, () => (notice ||= events(sim, EventType.Notice).some((e) => e.a === hero.id && e.value === NoticeCode.InventoryFull)));
    expect(notice).toBe(true);
    expect(sim.groundItems).toHaveLength(1);
    run(R.items.groundItemSec);
    expect(sim.groundItems).toHaveLength(0);
  });

  it('swap moves an item and joins stacks; works while dead', () => {
    const { sim, hero, cmd, run, give, inv } = setup();
    give(hero, 'healing_potion', 3);
    give(hero, 'guard_ring');
    hero.heroState!.inventory[4] = { item: itemIndex('healing_potion'), charges: 4 };
    sim.damage(hero, 99999, { id: 0, owner: 255, team: 0 }, DamageKind.Spell);
    cmd({ type: CommandType.SwapItems, from: 1, to: 5 });
    cmd({ type: CommandType.SwapItems, from: 4, to: 0 });
    run(0.05);
    expect(inv()).toEqual(['healing_potionx5', '-', '-', '-', 'healing_potionx2', 'guard_ring']);
  });

  it('the client gets items in sight and its inventory', () => {
    const { sim, hero, give, run } = setup();
    give(hero, 'healing_potion', 3);
    const near = sim.dropOnGround(itemIndex('warblade'), 0, hero.mover.x + 3, hero.mover.y);
    sim.dropOnGround(itemIndex('warblade'), 0, 30, 30); // far away: not in sight
    run(0.05);
    const vision = new TeamVision(sim.size);
    vision.update(sim.entities);
    const view = new ClientView(0, hero.team);
    const snap = readSnapshot(view.write(sim, vision, new SnapshotWriter(), new BinaryWriter()), new SnapshotData());
    expect(snap.itemSpawnCount).toBe(1);
    expect(snap.itemSpawns[0]!.id).toBe(near.id);
    expect(snap.player.items[0]).toBe(itemIndex('healing_potion') + 1);
    expect(snap.player.charges[0]).toBe(3);
    sim.removeGroundItem(near.id);
    const next = readSnapshot(view.write(sim, vision, new SnapshotWriter(), new BinaryWriter()), new SnapshotData());
    expect(next.itemGone.slice(0, next.itemGoneCount)).toEqual([near.id]);
  });
});

describe('camp drops', () => {
  it('roll the table: chance, then one item by weight', () => {
    const { sim } = setup();
    const table = gameData.camps.dropTables['orange']!;
    const counts = new Map<number, number>();
    const N = 20000;
    let none = 0;
    for (let i = 0; i < N; i++) {
      const item = rollDropTable(sim, table);
      if (item < 0) none++;
      else counts.set(item, (counts.get(item) ?? 0) + 1);
    }
    expect(none / N).toBeCloseTo(1 - table.dropChancePct / 100, 1);
    const total = table.items.reduce((a, [, w]) => a + w, 0);
    const dropped = N - none;
    for (const [id, w] of table.items) expect((counts.get(itemIndex(id)) ?? 0) / dropped).toBeCloseTo(w / total, 1);
  });

  it('a red camp always drops one item where its last monster died', () => {
    const sim = new MatchSim(
      { seed: 4, slots: [{ index: 0, heroType: entityTypeIndex('stone_golem'), team: 1, color: 0, start: 0 }] },
      nav,
    );
    const camp = sim.camps.find((c) => c.type === 'red_ogres')!;
    const hero = sim.heroes[0]!;
    sim.step();
    for (const m of camp.members.slice(0, -1)) sim.damage(m, 99999, { id: hero.id, owner: 0, team: 1 }, DamageKind.Spell);
    expect(sim.groundItems).toHaveLength(0);
    const last = camp.members[camp.members.length - 1]!;
    sim.damage(last, 99999, { id: hero.id, owner: 0, team: 1 }, DamageKind.Spell);
    expect(sim.groundItems).toHaveLength(1);
    const g = sim.groundItems[0]!;
    const table = gameData.camps.dropTables['red']!;
    expect(table.items.map(([id]) => itemIndex(id))).toContain(g.item);
    expect(Math.hypot(g.x - last.mover.x, g.y - last.mover.y)).toBeLessThan(1);
  });
});

describe('fountains and hills', () => {
  it('a Fountain of Life heals 2.5% health and 2% mana per second; not monsters', () => {
    const { sim, hero, run } = setup(['light_healer']);
    const f = gameData.map.fountains[0]!;
    hero.mover.x = f.pos[0] + 2.5;
    hero.mover.y = f.pos[1];
    hero.base = { ...hero.base, hpRegen: 0, manaRegen: 0 };
    hero.stats = { ...hero.stats, hpRegen: 0, manaRegen: 0 };
    hero.hp = 10;
    hero.mana = 0;
    const wolf = sim.spawn(entityTypeIndex('grey_wolf'), NEUTRAL, NEUTRAL_TEAM, 255, f.pos[0] - 2.5, f.pos[1]);
    wolf.passive = true;
    wolf.thinkAt = Infinity;
    wolf.base = wolf.stats = { ...wolf.base, hpRegen: 0 };
    wolf.hp = 10;
    run(2);
    expect(hero.hp).toBeCloseTo(10 + hero.stats.maxHp * 0.025 * 2, 0);
    expect(hero.mana).toBeCloseTo(hero.stats.maxMana * 0.02 * 2, 0);
    expect(wolf.hp).toBe(10);
  });

  it('attacks from low ground up to high ground miss about 25% of the time', () => {
    const { sim, hero, cmd, run, dummy } = setup(['arcane_huntress']);
    // Just below the north cliff of the temple plateau, shooting up.
    hero.mover.x = 110;
    hero.mover.y = 179;
    const d = dummy(110, 173.5);
    d.hp = d.stats.maxHp = d.base.maxHp = 100000;
    expect(groundLevel(nav, 110, 173.5) - groundLevel(nav, 110, 179)).toBeGreaterThanOrEqual(0.5);
    let hits = 0,
      misses = 0;
    cmd({ type: CommandType.Attack, target: d.id });
    run(120, () => {
      for (const e of events(sim, EventType.Damage)) {
        if (e.a !== d.id) continue;
        if (e.kind === DamageKind.Miss) misses++;
        else if (e.kind === DamageKind.Attack) hits++;
      }
    });
    expect(hits + misses).toBeGreaterThan(40);
    expect(misses / (hits + misses)).toBeGreaterThan(0.12);
    expect(misses / (hits + misses)).toBeLessThan(0.38);
    // Same level: no misses.
    const { sim: s2, hero: h2, cmd: c2, run: r2, dummy: d2 } = setup(['arcane_huntress']);
    const t = d2(h2.mover.x + 4, h2.mover.y);
    t.hp = t.stats.maxHp = t.base.maxHp = 100000;
    c2({ type: CommandType.Attack, target: t.id });
    let miss2 = 0;
    r2(30, () => (miss2 += events(s2, EventType.Damage).filter((e) => e.kind === DamageKind.Miss).length));
    expect(miss2).toBe(0);
  });
});

describe('item data', () => {
  it('every shop item can be bought and every drop table item exists', () => {
    for (const shop of gameData.shops) for (const id of shop.items) expect(it_(id).cost).not.toBeNull();
    for (const t of Object.values(gameData.camps.dropTables)) for (const [id] of t.items) expect(itemIndex(id)).toBeGreaterThanOrEqual(0);
  });
});
