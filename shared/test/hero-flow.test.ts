// The Phase 7 "done when" list, run in the simulation for every hero: farm a camp, reach
// level 10, use all 4 abilities, buy and use items, die and come back.
// (The same flow is checked by hand in the browser with two players; see docs/PROGRESS.md.)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ABILITIES,
  abilityIndex,
  buildMatchNav,
  CommandType,
  DamageKind,
  entityTypeIndex,
  gameData,
  itemIndex,
  ITEMS,
  MatchSim,
  NEUTRAL,
  NEUTRAL_TEAM,
  parseTerrain,
  respawnSeconds,
  TICK_RATE,
  xpForLevel,
  type GameCommand,
} from '../src/index';

const nav = buildMatchNav(parseTerrain(readFileSync(join(__dirname, '..', 'data', 'map-terrain.bin'))), gameData.map);
const SHOP = gameData.map.shops.find((s) => s.id === 'north_side_shop')!.pos;

describe('every hero, the whole way', () => {
  for (const def of gameData.heroes) {
    it(`${def.name}: farm, level 10, Q W E R, items, death and respawn`, () => {
      const sim = new MatchSim(
        {
          seed: 11,
          slots: [
            { index: 0, heroType: entityTypeIndex(def.id), team: 1, color: 0, start: 0 },
            { index: 1, heroType: entityTypeIndex('stone_golem'), team: 2, color: 1, start: 1 },
          ],
        },
        nav,
      );
      const hero = sim.heroes[0]!;
      const hs = hero.heroState!;
      let seq = 0;
      const cmd = (c: GameCommand) => sim.queueCommand(0, ++seq, c);
      const run = (seconds: number, each?: () => void) => {
        for (let i = 0; i < Math.round(seconds * TICK_RATE); i++) {
          sim.step();
          each?.();
        }
      };

      // 1. Farm the green wolves next to the base, like a player: attack the next wolf when
      // one dies. A hero that dies walks back after the respawn.
      const camp = sim.camps.find((c) => c.id === 'north_green_wolves')!;
      hero.mover.x = camp.x + 4;
      hero.mover.y = camp.y;
      cmd({ type: CommandType.Learn, slot: 0 });
      run(90, () => {
        if (!hero.alive || hero.order !== 'idle' || hero.targetId) return;
        const next = camp.members.find((m) => m.alive);
        if (next) cmd({ type: CommandType.Attack, target: next.id });
      });
      expect(
        camp.members.every((m) => !m.alive),
        'camp cleared',
      ).toBe(true);
      expect(hs.xp, 'XP from the camp').toBeGreaterThan(0);

      // 2. Level 10 (the rest of the XP at once) and learn everything.
      sim.addXp(hero, xpForLevel(10) - hs.xp);
      expect(hs.level).toBe(10);
      for (let i = 0; i < 12; i++) for (let s = 0; s < 4; s++) cmd({ type: CommandType.Learn, slot: s });
      run(0.1);
      expect(hs.abilityLevels).toEqual(def.abilities.map((id) => ABILITIES[abilityIndex(id)]!.maxLevel));
      if (!hero.alive) run(respawnSeconds(10) + 1);

      // 3. All four abilities. Actives: the cast goes through (cooldown starts). Passives and
      // auras: their buff is on the hero.
      hero.mover.x = 110;
      hero.mover.y = 222;
      hero.mover.path = [];
      const ogre = sim.spawn(entityTypeIndex('ogre_brute'), NEUTRAL, NEUTRAL_TEAM, 255, 113, 222);
      ogre.passive = true;
      ogre.thinkAt = Infinity;
      ogre.hp = ogre.stats.maxHp = ogre.base.maxHp = 1e6;
      def.abilities.forEach((id, slot) => {
        const a = ABILITIES[abilityIndex(id)]!;
        hero.mana = hero.stats.maxMana;
        hero.hp = hero.stats.maxHp;
        if (a.kind !== 'active') {
          run(0.6);
          expect(hero.buffs.some((b) => b.id === `passive:${id}` || b.id === `aura:${id}`) || id === 'flurry', `${id} works`).toBe(true);
          return;
        }
        const enemyUnit = a.filter.includes('enemy');
        const target =
          a.target === 'none'
            ? { kind: 0 as const, id: 0, x: 0, y: 0 }
            : a.target === 'unit'
              ? { kind: 1 as const, id: enemyUnit ? ogre.id : hero.id, x: 0, y: 0 }
              : { kind: 2 as const, id: 0, x: ogre.mover.x, y: ogre.mover.y };
        expect(sim.castCheck(0, slot, target), `${id} allowed`).toBeNull();
        cmd({ type: CommandType.Cast, slot, target: target.kind, id: target.id, x: target.x, y: target.y });
        run(Math.max(1.5, a.castTime + 1) + (id === 'arcane_storm' ? 3 : 0));
        expect(hero.cooldowns[slot]!, `${id} was cast`).toBeGreaterThan(sim.tick);
      });

      // 4. Buy at the Trader's Tent, use a potion, carry boots.
      hero.mover.x = SHOP[0] + 3;
      hero.mover.y = SHOP[1];
      hero.mover.path = [];
      hs.gold = 1000;
      const speed0 = hero.stats.moveSpeed;
      cmd({ type: CommandType.BuyItem, item: itemIndex('healing_potion') });
      cmd({ type: CommandType.BuyItem, item: itemIndex('boots_of_haste') });
      run(0.1);
      expect(hs.inventory.map((s) => (s ? ITEMS[s.item]!.id : null)).slice(0, 2)).toEqual(['healing_potion', 'boots_of_haste']);
      expect(hs.gold).toBeLessThan(1000 - 350 + 5);
      expect(hero.stats.moveSpeed).toBeGreaterThan(speed0);
      hero.hp = hero.stats.maxHp / 2;
      const hp0 = hero.hp;
      cmd({ type: CommandType.UseItem, slot: 0, target: 0, id: 0, x: 0, y: 0 });
      run(0.1);
      expect(hero.hp).toBeGreaterThan(hp0 + 200);
      expect(hs.inventory[0]).toBeNull();

      // 5. Die to the enemy hero and come back at the base after 5 + 3 x 10 seconds.
      // (Wait for shields like Dawn Shield to end first: they keep the hero alive.)
      run(10);
      const enemy = sim.heroes[1]!;
      sim.damage(hero, 1e6, { id: enemy.id, owner: 1, team: 2 }, DamageKind.Spell);
      expect(hero.alive).toBe(false);
      run(respawnSeconds(10) - 1);
      expect(hero.alive).toBe(false);
      run(1.1);
      expect(hero.alive).toBe(true);
      expect([hero.mover.x, hero.mover.y]).toEqual(gameData.map.starts[0]!.heroSpawn);
      expect(hero.hp).toBe(hero.stats.maxHp);
      // Items stay after death.
      expect(hs.inventory[1] && ITEMS[hs.inventory[1].item]!.id).toBe('boots_of_haste');
    });
  }
});
