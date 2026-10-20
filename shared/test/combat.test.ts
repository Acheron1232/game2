import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  armorFactor,
  attackDamage,
  buildMatchNav,
  CommandType,
  entityTypeIndex,
  EventType,
  gameData,
  heroStats,
  levelForXp,
  MatchSim,
  parseTerrain,
  respawnSeconds,
  spellDamage,
  TICK_RATE,
  typeFactor,
  xpForKillingHero,
  xpForKillingUnit,
  type SimEntity,
} from '../src/index';

const DOCS = join(__dirname, '..', '..', 'docs', 'design');
const nav = buildMatchNav(parseTerrain(readFileSync(join(__dirname, '..', 'data', 'map-terrain.bin'))), gameData.map);

describe('hero stats', () => {
  it('match the level 1 and 10 table in HEROES.md', () => {
    const md = readFileSync(join(DOCS, 'HEROES.md'), 'utf8');
    const table = md.slice(md.indexOf('<!-- table:hero-stats -->'), md.indexOf('<!-- /table -->', md.indexOf('<!-- table:hero-stats -->')));
    const rows = table.split('\n').filter((l) => /^\| (\*\*.+\*\*)? *\| (1|10) \|/.test(l));
    expect(rows.length).toBe(16);
    let hero = gameData.heroes[0]!;
    for (const row of rows) {
      const cells = row.split('|').map((c) => c.trim());
      const name = cells[1]!.replace(/\*/g, '');
      if (name) hero = gameData.heroes.find((h) => h.name === name)!;
      const level = Number(cells[2]);
      const s = heroStats(hero, level);
      expect(s.maxHp, `${hero.id} hp`).toBe(Number(cells[4]));
      expect(s.maxMana, `${hero.id} mana`).toBe(Number(cells[5]));
      expect(s.armor.toFixed(1), `${hero.id} armor`).toBe(cells[6]);
      expect(`${s.damageMin}-${s.damageMax}`, `${hero.id} damage`).toBe(cells[7]);
      expect((1 / s.attackCooldown).toFixed(2), `${hero.id} attacks/s`).toBe(cells[9]);
    }
  });
});

describe('damage math', () => {
  it('armor blocks less per point (GDD: 5 armor = 23%, 10 armor = 38%)', () => {
    expect(1 - armorFactor(5)).toBeCloseTo(0.2308, 3);
    expect(1 - armorFactor(10)).toBeCloseTo(0.375, 3);
    expect(armorFactor(0)).toBe(1);
    expect(armorFactor(-3)).toBeGreaterThan(1);
  });

  it('uses the damage type table', () => {
    expect(typeFactor('pierce', 'light')).toBe(2);
    expect(typeFactor('pierce', 'hero')).toBe(0.5);
    expect(typeFactor('magic', 'heavy')).toBe(2);
    expect(typeFactor('hero', 'fortified')).toBe(0.5);
    expect(attackDamage(100, 'normal', 'medium', 0)).toBe(150);
  });

  it('spells skip armor and do 75% to heroes', () => {
    expect(spellDamage(100, true)).toBe(75);
    expect(spellDamage(100, false)).toBe(100);
  });
});

describe('experience and respawn', () => {
  it('follows the XP table in GDD.md', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(199)).toBe(1);
    expect(levelForXp(200)).toBe(2);
    expect(levelForXp(5400)).toBe(10);
    expect(levelForXp(99999)).toBe(10);
    expect(xpForKillingUnit(1)).toBe(25);
    expect(xpForKillingUnit(7)).toBe(190);
    expect(xpForKillingHero(1)).toBe(100);
    expect(xpForKillingHero(10)).toBe(550);
    expect(respawnSeconds(1)).toBe(8);
    expect(respawnSeconds(10)).toBe(35);
  });
});

function sim(heroes: string[], camps = false) {
  return new MatchSim(
    {
      seed: 5,
      noCamps: !camps,
      slots: heroes.map((h, i) => ({ index: i, heroType: entityTypeIndex(h), team: i + 1, color: i, start: i })),
    },
    nav,
  );
}

function run(s: MatchSim, seconds: number, each?: () => void): void {
  for (let i = 0; i < seconds * TICK_RATE; i++) {
    s.step();
    each?.();
  }
}

describe('combat in the simulation', () => {
  it('a level 1 hero kills a green camp and gets gold and XP', () => {
    const s = sim(['staff_warrior'], true);
    const hero = s.heroes[0]!;
    const camp = s.camps.find((c) => c.id === 'north_green_wolves')!;
    // Hero starts next to the wolves.
    hero.mover.x = camp.x + 4;
    hero.mover.y = camp.y;
    const gold0 = hero.heroState!.gold;
    let deaths = 0,
      hits = 0;
    const wolf = camp.members[0]!;
    s.queueCommand(0, 1, { type: CommandType.Attack, target: wolf.id });
    run(s, 40, () => {
      for (let i = 0; i < s.events.count; i++) {
        const e = s.events.items[i]!;
        if (e.type === EventType.Death && camp.members.some((m) => m.id === e.a)) deaths++;
        if (e.type === EventType.Damage && e.b === hero.id) hits++;
      }
      // Attack the next wolf when one dies, like a player would (idle heroes do not start fights with monsters).
      if (hero.order === 'idle' && !hero.targetId) {
        const next = camp.members.find((m) => m.alive);
        if (next) s.queueCommand(0, s.lastSeq[0]! + 1, { type: CommandType.Attack, target: next.id });
      }
    });
    expect(hits).toBeGreaterThan(5);
    expect(deaths).toBe(3);
    expect(hero.alive).toBe(true);
    expect(hero.heroState!.gold - gold0).toBeGreaterThan(36 + 40); // 3 bounties of 12-16 plus 40 s of income
    expect(hero.heroState!.xp).toBe(75); // 3 level-1 kills, alone
    expect(camp.respawnAt).toBeGreaterThan(0);
  });

  it('monsters chase only so far, then run home and heal', () => {
    const s = sim(['arcane_huntress'], true);
    const hero = s.heroes[0]!;
    const camp = s.camps.find((c) => c.id === 'north_green_wolves')!;
    const wolf = camp.members[0]!;
    hero.mover.x = camp.x + 6;
    hero.mover.y = camp.y;
    s.queueCommand(0, 1, { type: CommandType.Attack, target: wolf.id });
    run(s, 2);
    expect(wolf.targetId).toBe(hero.id);
    // Run far away from the camp.
    s.queueCommand(0, 2, { type: CommandType.Move, x: camp.x + 40, y: camp.y - 10, queue: false });
    let returned = false;
    run(s, 20, () => (returned ||= wolf.returning));
    expect(returned).toBe(true);
    expect(Math.hypot(wolf.mover.x - wolf.homeX, wolf.mover.y - wolf.homeY)).toBeLessThan(1);
    expect(wolf.hp).toBe(wolf.stats.maxHp);
  });

  it('a dead hero loses gold and comes back at its start after 5 + 3 x level seconds', () => {
    const s = sim(['blood_witch', 'stone_golem']);
    const [a, b] = [s.heroes[0]!, s.heroes[1]!];
    // Put them together and let the golem win.
    b.mover.x = a.mover.x + 1.5;
    b.mover.y = a.mover.y;
    a.hp = 30;
    a.heroState!.gold = 100;
    s.queueCommand(1, 1, { type: CommandType.Attack, target: a.id });
    let diedAt = 0;
    for (let i = 0; i < 10 * TICK_RATE && !diedAt; i++) {
      s.step();
      if (!a.alive) diedAt = s.tick;
    }
    expect(diedAt).toBeGreaterThan(0);
    expect(a.heroState!.respawnAt - diedAt).toBe(8 * TICK_RATE);
    expect(a.heroState!.gold).toBeLessThan(100 - 15 + 11);
    expect(b.heroState!.xp).toBe(100); // level 1 hero kill
    expect(b.heroState!.gold).toBeGreaterThanOrEqual(250 + 165); // start gold + 150 + 15 bounty
    // The golem goes home, so it does not wait at the witch's start.
    b.mover.x = gameData.map.starts[1]!.heroSpawn[0];
    b.mover.y = gameData.map.starts[1]!.heroSpawn[1];
    b.order = 'idle';
    b.targetId = 0;
    run(s, 7.9);
    expect(a.alive).toBe(false);
    run(s, 0.2);
    expect(a.alive).toBe(true);
    const [x, y] = gameData.map.starts[0]!.heroSpawn;
    expect(Math.hypot(a.mover.x - x, a.mover.y - y)).toBeLessThan(0.5);
    expect(a.hp).toBe(a.stats.maxHp);
  });

  it('levels up with skill points and stronger stats', () => {
    const s = sim(['forest_elf']);
    const hero = s.heroes[0]!;
    const hp1 = hero.stats.maxHp;
    s.addXp(hero, 5400);
    expect(hero.heroState!.level).toBe(10);
    expect(hero.heroState!.skillPoints).toBe(10);
    expect(hero.stats.maxHp).toBeGreaterThan(hp1);
  });

  it('melee can not attack air units, the server says no', () => {
    const s = sim(['staff_warrior'], true);
    const harpy: SimEntity = s.camps.find((c) => c.id === 'north_orange_harpies')!.members[0]!;
    expect(harpy.stats.layer).toBe('air');
    expect(s.queueCommand(0, 1, { type: CommandType.Attack, target: harpy.id })).toBe(false);
    // Ranged heroes can.
    const s2 = sim(['arcane_huntress'], true);
    const h2 = s2.camps.find((c) => c.id === 'north_orange_harpies')!.members[0]!;
    expect(s2.queueCommand(0, 1, { type: CommandType.Attack, target: h2.id })).toBe(true);
  });
});

describe('following allied units', () => {
  it('tracks a moving ally, keeps a gap, and stops on a new order', () => {
    const s = sim(['stone_golem', 'forest_elf']);
    const hero = s.heroes[0]!;
    const ally = s.heroes[1]!;
    ally.team = hero.team;
    const [x, y] = gameData.map.starts[0]!.heroSpawn;
    hero.mover.x = x;
    hero.mover.y = y;
    ally.mover.x = x + 5;
    ally.mover.y = y;
    expect(s.queueCommand(0, 1, { type: CommandType.Follow, target: ally.id })).toBe(true);
    run(s, 3);
    expect(hero.order).toBe('follow');
    expect(Math.hypot(hero.mover.x - ally.mover.x, hero.mover.y - ally.mover.y)).toBeLessThan(2.8);
    expect(hero.targetId).toBe(0);
    ally.mover.x = x;
    ally.mover.y = y - 5;
    run(s, 5);
    expect(Math.hypot(hero.mover.x - ally.mover.x, hero.mover.y - ally.mover.y)).toBeLessThan(2.8);
    s.queueCommand(0, 2, { type: CommandType.Hold });
    run(s, 1);
    expect(hero.order).toBe('hold');
  });

  it('rejects enemies and unseen units and stops if the ally dies', () => {
    const s = sim(['stone_golem', 'forest_elf']);
    const hero = s.heroes[0]!;
    const ally = s.heroes[1]!;
    expect(s.queueCommand(0, 1, { type: CommandType.Follow, target: ally.id })).toBe(false);
    ally.team = hero.team;
    s.canSee = () => false;
    expect(s.queueCommand(0, 2, { type: CommandType.Follow, target: ally.id })).toBe(false);
    s.canSee = () => true;
    expect(s.queueCommand(0, 3, { type: CommandType.Follow, target: ally.id })).toBe(true);
    s.step();
    ally.alive = false;
    s.step();
    expect(hero.order).toBe('idle');
    expect(hero.mover.path).toHaveLength(0);
  });
});
