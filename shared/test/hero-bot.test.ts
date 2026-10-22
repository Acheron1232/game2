import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gameData } from '../src/data/index';
import { parseTerrain } from '../src/map/terrain';
import { buildMatchNav } from '../src/nav/match-nav';
import { CommandType, type GameCommand } from '../src/sim/commands';
import { entityTypeIndex } from '../src/sim/entity-types';
import { EventType } from '../src/sim/events';
import { HeroBot } from '../src/sim/hero-bot';
import { MatchSim, NEUTRAL, NEUTRAL_TEAM, TICK_RATE } from '../src/sim/match-sim';

const nav = buildMatchNav(parseTerrain(readFileSync(join(__dirname, '..', 'data', 'map-terrain.bin'))), gameData.map);

function slot(index: number, hero: string, start = index) {
  return { index, heroType: entityTypeIndex(hero), team: index + 1, color: index, start, bot: true, ai: 'normal' as const };
}

describe('hero bots', () => {
  // Solo, with only three weak camps near each base, about 400-600 XP in 8 minutes is what a good
  // player gets too (level 3 is 500 XP). In real matches the faction army helps creep (8b).
  it('farms, learns, casts, and stays alive on four heroes', () => {
    let commands = 0;
    let refused = 0;
    const heroes = ['blood_witch', 'staff_warrior', 'sky_dragon', 'stone_golem'];
    for (let index = 0; index < heroes.length; index++) {
      const sim = new MatchSim({ seed: 731 + index, slots: [slot(0, heroes[index]!, index)] }, nav);
      const bot = new HeroBot(0, 'normal');
      const hero = sim.heroes[0]!;
      let casts = 0;
      let deaths = 0;
      const queueCommand = sim.queueCommand.bind(sim);
      sim.queueCommand = (owner: number, seq: number, command: GameCommand) => {
        commands++;
        const accepted = queueCommand(owner, seq, command);
        if (!accepted) refused++;
        return accepted;
      };

      for (let tick = 0; tick < 8 * 60 * TICK_RATE; tick++) {
        sim.step();
        for (let eventIndex = 0; eventIndex < sim.events.count; eventIndex++) {
          const event = sim.events.items[eventIndex]!;
          if (event.type === EventType.Cast && event.a === hero.id) casts++;
          else if (event.type === EventType.Death && event.a === hero.id) deaths++;
        }
        bot.update(sim);
      }

      expect(hero.heroState!.xp, `${hero.heroState!.def.id} xp`).toBeGreaterThanOrEqual(400);
      expect(hero.alive || deaths <= 2, `${hero.heroState!.def.id} survival`).toBe(true);
      expect(hero.heroState!.skillPoints, `${hero.heroState!.def.id} skill points`).toBeLessThanOrEqual(1);
      expect(casts, `${hero.heroState!.def.id} casts`).toBeGreaterThan(3);
    }
    expect(refused / commands).toBeLessThan(0.05);
  });

  it('retreats toward home or a fountain within three seconds', () => {
    const sim = new MatchSim({ seed: 19, slots: [slot(0, 'stone_golem')], noCamps: true }, nav);
    const bot = new HeroBot(0, 'normal');
    const hero = sim.heroes[0]!;
    const start = gameData.map.starts[0]!.heroSpawn;
    hero.mover.x = start[0] + 14;
    hero.mover.y = start[1] - 8;
    hero.hp = hero.stats.maxHp * 0.15;
    const monster = sim.spawn(entityTypeIndex('ogre_warlord'), NEUTRAL, NEUTRAL_TEAM, 255, hero.mover.x + 1, hero.mover.y);
    monster.passive = true;
    monster.thinkAt = Infinity;
    const before = Math.hypot(hero.mover.x - start[0], hero.mover.y - start[1]);

    for (let tick = 0; tick < 3 * TICK_RATE; tick++) {
      sim.step();
      bot.update(sim);
    }

    expect(bot.state).toBe('Retreating');
    expect(Math.hypot(hero.mover.x - start[0], hero.mover.y - start[1])).toBeLessThan(before);
  });

  it('reacts sooner on hard than on easy', () => {
    function defendTick(difficulty: 'easy' | 'hard'): number {
      let defend = false;
      const sim = new MatchSim({ seed: 41, slots: [slot(0, 'blood_witch')], noCamps: true }, nav);
      const bot = new HeroBot(0, difficulty, {
        baseUnderAttack: () => (defend ? { x: 128, y: 128 } : null),
      });
      const queueCommand = sim.queueCommand.bind(sim);
      let orderedAt = Infinity;
      sim.queueCommand = (owner: number, seq: number, command: GameCommand) => {
        if (command.type === CommandType.AttackMove) orderedAt = sim.tick;
        return queueCommand(owner, seq, command);
      };
      sim.step();
      bot.update(sim);
      defend = true;
      for (let tick = 0; tick < TICK_RATE && !Number.isFinite(orderedAt); tick++) {
        sim.step();
        bot.update(sim);
      }
      return orderedAt;
    }

    expect(defendTick('hard')).toBeLessThan(defendTick('easy'));
  });
});
