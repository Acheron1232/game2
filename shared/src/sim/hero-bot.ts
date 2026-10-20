// A computer-controlled hero (Bot slots): learns abilities, farms camps that fit its level,
// retreats on low health, defends the base and joins the faction's attacks. It only sends the
// same commands a player sends. Written by Codex for Phase 8 (task: tools/codex-tasks/hero-bot.md).

import { gameData, type AbilityDef } from '../data/index';
import { castProblem, heroAbility, lv, param, targetAllowed, type CastTarget } from './abilities';
import type { CampState } from './camps';
import { CommandType, type GameCommand } from './commands';
import { TICK_RATE, type MatchSim, type SimEntity } from './match-sim';
import { canLearn } from './stats';

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface HeroBotHooks {
  /** Where the faction's army is attacking now, or null (wired in Phase 8b). */
  armyTarget?: () => { x: number; y: number } | null;
  /** Our base is under attack: point to defend, or null. */
  baseUnderAttack?: () => { x: number; y: number } | null;
}

interface DifficultySettings {
  reactionSec: number;
  abilityUseQuality: number;
  retreatAtHpPct: number;
  lastHitSkill: number;
  joinsAttacks: boolean;
}

const DIFFICULTIES = gameData.ai.heroBot.difficulties as unknown as Record<BotDifficulty, DifficultySettings>;
const FIGHT_ORDER_TICKS = Math.round(1.5 * TICK_RATE);
const RETREAT_DONE_PCT = 85;
const PLAN_NONE = 0;
const PLAN_RETREAT = 1;
const PLAN_FARM = 2;
const PLAN_DEFEND = 3;
const PLAN_ATTACK = 4;
const HEALS = new Set(['radiant_touch', 'sanctuary', 'dawn_shield']);
const SELF_BUFFS = new Set(['iron_stance', 'stone_skin']);

function distance(a: SimEntity, x: number, y: number): number {
  return Math.hypot(a.mover.x - x, a.mover.y - y);
}

function maxParam(a: AbilityDef, key: string): number {
  const value = a.params[key];
  if (Array.isArray(value)) {
    let best = 0;
    for (const n of value) best = Math.max(best, n);
    return best;
  }
  return typeof value === 'number' ? value : 0;
}

function mainAbilitySlot(hero: SimEntity): number {
  let bestSlot = 0;
  let bestScore = -1;
  for (let slot = 0; slot < 3; slot++) {
    const a = heroAbility(hero, slot);
    if (!a) continue;
    let damage = maxParam(a, 'damage') + maxParam(a, 'impactDamage');
    damage += maxParam(a, 'damagePerSec') * Math.max(1, maxParam(a, 'duration'));
    damage += maxParam(a, 'damagePerWave') * Math.max(1, maxParam(a, 'waves'));
    damage += maxParam(a, 'burnDamagePerSec') * Math.max(1, maxParam(a, 'burnDuration'));
    const controls = a.params.stunDuration !== undefined || a.params.rootDuration !== undefined;
    const score = damage + (controls ? 10_000 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestSlot = slot;
    }
  }
  return bestSlot;
}

/** Where a hurt hero goes: the nearest Fountain of Life, or home when that is closer. */
function retreatPoint(hero: SimEntity): readonly [number, number] {
  let best = gameData.map.starts[hero.heroState!.start]!.heroSpawn as readonly [number, number];
  let bestD = distance(hero, best[0], best[1]);
  for (const f of gameData.map.fountains) {
    const d = distance(hero, f.pos[0], f.pos[1]);
    if (d < bestD) {
      bestD = d;
      best = f.pos as readonly [number, number];
    }
  }
  return best;
}

function aliveCampLevel(camp: CampState): number {
  let total = 0;
  for (const member of camp.members) if (member.alive) total += member.stats.level;
  return total;
}

function lowestHealthMember(camp: CampState): SimEntity | null {
  let best: SimEntity | null = null;
  for (const member of camp.members) if (member.alive && (!best || member.hp < best.hp)) best = member;
  return best;
}

export class HeroBot {
  private readonly settings: DifficultySettings;
  private readonly reactionTicks: number;
  private nextThinkAt = 0;
  private seq = 0;
  private stateText = 'Idle';
  private retreating = false;
  private campIndex = -1;
  private plan = PLAN_NONE;
  private planTarget = 0;
  private planX = 0;
  private planY = 0;
  private lastFightOrderAt = -FIGHT_ORDER_TICKS;
  private wasAlive = false;
  private randomState: number;

  constructor(
    private readonly slot: number,
    difficulty: BotDifficulty,
    private readonly hooks: HeroBotHooks = {},
  ) {
    this.settings = DIFFICULTIES[difficulty];
    this.reactionTicks = Math.max(1, Math.round(this.settings.reactionSec * TICK_RATE));
    this.randomState = Math.imul(slot + 1, 0x9e3779b1) ^ (difficulty === 'easy' ? 1 : difficulty === 'normal' ? 2 : 3);
  }

  /** For tests and the AI panel: "Farming wolves", "Retreating", "Joining the attack"... */
  get state(): string {
    return this.stateText;
  }

  /** Call once per sim tick, after sim.step(). Thinks only every reactionSec. */
  update(sim: MatchSim): void {
    if (sim.tick < this.nextThinkAt) return;
    this.nextThinkAt = sim.tick + this.reactionTicks;

    const hero = sim.heroes[this.slot];
    if (!hero?.heroState) return;
    if (!hero.alive) {
      this.wasAlive = false;
      this.stateText = 'Waiting to respawn';
      return;
    }
    if (!this.wasAlive) {
      this.wasAlive = true;
      this.plan = PLAN_NONE;
      this.planTarget = 0;
      this.campIndex = -1;
      this.retreating = false;
    }

    let commands = 0;
    if (hero.heroState.skillPoints > 0 && this.learn(sim, hero)) commands++;

    const hpPct = (hero.hp / hero.stats.maxHp) * 100;
    if (this.retreating && hpPct >= RETREAT_DONE_PCT) {
      this.retreating = false;
      this.plan = PLAN_NONE;
    } else if (!this.retreating && hpPct < this.settings.retreatAtHpPct && this.enemyNear(sim, hero, 10)) {
      this.retreating = true;
      this.campIndex = -1;
      this.plan = PLAN_NONE;
    }

    if (this.retreating) {
      this.stateText = 'Retreating';
      if (hero.order === 'cast') return;
      if (commands < 3 && this.tryAbility(sim, hero, null, true)) return;
      const start = retreatPoint(hero);
      if (commands < 3 && this.needsPointOrder(hero, PLAN_RETREAT, start[0], start[1])) {
        this.send(sim, { type: CommandType.Move, x: start[0], y: start[1], queue: false });
        this.setPointPlan(PLAN_RETREAT, start[0], start[1]);
      }
      return;
    }

    const current = hero.targetId ? sim.get(hero.targetId) : undefined;
    if (hero.order === 'cast') return;
    if (commands < 3 && this.tryAbility(sim, hero, current?.alive ? current : null, false)) return;

    const defend = this.hooks.baseUnderAttack?.() ?? null;
    if (defend) {
      this.campIndex = -1;
      this.stateText = 'Defending the base';
      if (commands < 3 && this.needsPointOrder(hero, PLAN_DEFEND, defend.x, defend.y)) {
        this.send(sim, { type: CommandType.AttackMove, x: defend.x, y: defend.y });
        this.setPointPlan(PLAN_DEFEND, defend.x, defend.y);
      }
      return;
    }

    const army = this.settings.joinsAttacks && hero.heroState.level >= 4 ? (this.hooks.armyTarget?.() ?? null) : null;
    if (army) {
      this.campIndex = -1;
      this.stateText = 'Joining the attack';
      if (commands < 3 && this.needsPointOrder(hero, PLAN_ATTACK, army.x, army.y)) {
        this.send(sim, { type: CommandType.AttackMove, x: army.x, y: army.y });
        this.setPointPlan(PLAN_ATTACK, army.x, army.y);
      }
      return;
    }

    const camp = this.chooseCamp(sim, hero);
    if (!camp) {
      this.campIndex = -1;
      this.plan = PLAN_NONE;
      this.stateText = 'No safe camp';
      return;
    }
    const target = lowestHealthMember(camp);
    if (!target) {
      this.campIndex = -1;
      return;
    }
    if (this.campIndex !== camp.index) {
      this.campIndex = camp.index;
      const name = camp.type.slice(camp.type.indexOf('_') + 1).replaceAll('_', ' ');
      this.stateText = `Farming ${name}`;
    }
    if (distance(hero, target.mover.x, target.mover.y) > 7) {
      if (
        commands < 3 &&
        (this.plan !== PLAN_FARM || this.planTarget !== 0 || this.planX !== camp.x || this.planY !== camp.y || hero.order !== 'move')
      ) {
        this.send(sim, { type: CommandType.Move, x: camp.x, y: camp.y, queue: false });
        this.setPointPlan(PLAN_FARM, camp.x, camp.y);
      }
      return;
    }
    const refresh = hero.targetId !== 0 && sim.tick - this.lastFightOrderAt >= FIGHT_ORDER_TICKS;
    if (commands < 3 && (this.plan !== PLAN_FARM || this.planTarget !== target.id || hero.order !== 'attack' || refresh)) {
      this.send(sim, { type: CommandType.Attack, target: target.id });
      this.plan = PLAN_FARM;
      this.planTarget = target.id;
      this.lastFightOrderAt = sim.tick;
    }
  }

  private send(sim: MatchSim, command: GameCommand): boolean {
    this.seq = Math.max(this.seq + 1, (sim.lastSeq[this.slot] ?? 0) + 1);
    return sim.queueCommand(this.slot, this.seq, command);
  }

  private learn(sim: MatchSim, hero: SimEntity): boolean {
    const main = mainAbilitySlot(hero);
    if (this.canLearnSlot(hero, 3)) return this.send(sim, { type: CommandType.Learn, slot: 3 });
    if (this.canLearnSlot(hero, main)) return this.send(sim, { type: CommandType.Learn, slot: main });
    for (let slot = 0; slot < 3; slot++) {
      if (slot !== main && this.canLearnSlot(hero, slot)) return this.send(sim, { type: CommandType.Learn, slot });
    }
    return false;
  }

  private canLearnSlot(hero: SimEntity, slot: number): boolean {
    const hs = hero.heroState!;
    const a = heroAbility(hero, slot);
    const level = hs.abilityLevels[slot] ?? 0;
    return !!a && canLearn(slot, level, a.maxLevel, hs.level);
  }

  private enemyNear(sim: MatchSim, hero: SimEntity, radius: number): boolean {
    let found = false;
    sim.grid.query(hero.mover.x, hero.mover.y, radius, (e, d2) => {
      if (!found && e.alive && !e.invulnerable && e.team !== hero.team && d2 <= radius * radius && sim.canSee(hero.team, e)) found = true;
    });
    return found;
  }

  private hasAllyHeroNear(sim: MatchSim, hero: SimEntity): boolean {
    let found = false;
    sim.grid.query(hero.mover.x, hero.mover.y, 12, (e, d2) => {
      if (!found && e !== hero && e.alive && e.heroState && e.team === hero.team && d2 <= 144) found = true;
    });
    return found;
  }

  private chooseCamp(sim: MatchSim, hero: SimEntity): CampState | null {
    // Every camp has at least three levels. Let a new solo hero start on the weakest camp.
    const maxLevel = Math.max(3, hero.heroState!.level * (this.hasAllyHeroNear(sim, hero) ? 3 : 2));
    let best: CampState | null = null;
    let bestDistance = Infinity;
    for (const camp of sim.camps) {
      if (camp.respawnAt !== 0) continue;
      const level = aliveCampLevel(camp);
      if (level === 0 || level > maxLevel) continue;
      const d = distance(hero, camp.x, camp.y);
      if (d < bestDistance) {
        bestDistance = d;
        best = camp;
      }
    }
    return best;
  }

  private tryAbility(sim: MatchSim, hero: SimEntity, target: SimEntity | null, retreating: boolean): boolean {
    if (hero.cast || hero.forced || this.nextRandom() >= this.settings.abilityUseQuality) return false;
    if (retreating) {
      for (let slot = 0; slot < 4; slot++) {
        const a = heroAbility(hero, slot);
        if (a?.id !== 'blink') continue;
        const start = retreatPoint(hero);
        const level = hero.heroState!.abilityLevels[slot] ?? 0;
        if (level < 1 || distance(hero, start[0], start[1]) < param(a, 'minRange', level)) return false;
        const range = lv(a.castRange, level);
        const d = distance(hero, start[0], start[1]);
        const scale = Math.min(1, range / Math.max(d, 0.001));
        return this.cast(sim, hero, slot, {
          kind: 2,
          id: 0,
          x: hero.mover.x + (start[0] - hero.mover.x) * scale,
          y: hero.mover.y + (start[1] - hero.mover.y) * scale,
        });
      }
      return false;
    }

    for (let slot = 3; slot >= 0; slot--) {
      const a = heroAbility(hero, slot);
      const level = hero.heroState!.abilityLevels[slot] ?? 0;
      if (!a || level < 1 || a.kind !== 'active') continue;
      const healthCost = param(a, 'healthCost', level);
      if (healthCost > 0 && hero.hp - healthCost < hero.stats.maxHp * 0.7) continue;
      if (HEALS.has(a.id)) {
        const ally = this.lowestHurtAlly(sim, hero, a, level);
        if (!ally) continue;
        const castTarget: CastTarget =
          a.target === 'unit' ? { kind: 1, id: ally.id, x: 0, y: 0 } : { kind: 2, id: 0, x: ally.mover.x, y: ally.mover.y };
        if (this.cast(sim, hero, slot, castTarget)) return true;
        continue;
      }
      if (SELF_BUFFS.has(a.id)) {
        if (hero.lastHitBy && hero.hp < hero.stats.maxHp * 0.7 && this.cast(sim, hero, slot, { kind: 0, id: 0, x: 0, y: 0 })) return true;
        continue;
      }
      if (!target?.alive || !sim.canSee(hero.team, target)) continue;
      if (a.target === 'unit') {
        if (!targetAllowed(sim, hero, a, target) || !this.inCastRange(hero, target, a, level)) continue;
        if (this.isDamageOrControl(a) && this.cast(sim, hero, slot, { kind: 1, id: target.id, x: 0, y: 0 })) return true;
      } else if (a.target === 'point' || a.target === 'line' || a.target === 'cone') {
        if (!this.pointInRange(hero, target.mover.x, target.mover.y, a, level)) continue;
        const radius = Math.max(1.5, param(a, 'radius', level), param(a, 'width', level));
        if (
          (target.hero || this.enemyCount(sim, hero, target.mover.x, target.mover.y, radius, a) >= 2) &&
          this.cast(sim, hero, slot, { kind: 2, id: 0, x: target.mover.x, y: target.mover.y })
        )
          return true;
      } else if (a.target === 'none') {
        const radius = Math.max(param(a, 'radius', level), param(a, 'tauntRadius', level));
        if (
          radius > 0 &&
          this.enemyCount(sim, hero, hero.mover.x, hero.mover.y, radius, a) >= 2 &&
          this.cast(sim, hero, slot, { kind: 0, id: 0, x: 0, y: 0 })
        )
          return true;
      }
    }
    return false;
  }

  private isDamageOrControl(a: AbilityDef): boolean {
    return (
      a.params.damage !== undefined ||
      a.params.damagePerSec !== undefined ||
      a.params.stunDuration !== undefined ||
      a.params.rootDuration !== undefined
    );
  }

  private lowestHurtAlly(sim: MatchSim, hero: SimEntity, a: AbilityDef, level: number): SimEntity | null {
    const range = a.target === 'unit' ? lv(a.castRange, level) + 2 : lv(a.castRange, level);
    let best: SimEntity | null = hero.hp < hero.stats.maxHp * 0.5 ? hero : null;
    let bestPct = best ? best.hp / best.stats.maxHp : 0.5;
    sim.grid.query(hero.mover.x, hero.mover.y, range + 1, (ally) => {
      if (!ally.alive || ally.team !== hero.team || ally.hp >= ally.stats.maxHp * 0.5 || !targetAllowed(sim, hero, a, ally)) return;
      if (a.target === 'unit' ? !this.inCastRange(hero, ally, a, level) : !this.pointInRange(hero, ally.mover.x, ally.mover.y, a, level))
        return;
      const pct = ally.hp / ally.stats.maxHp;
      if (!best || pct < bestPct) {
        best = ally;
        bestPct = pct;
      }
    });
    return best;
  }

  private enemyCount(sim: MatchSim, hero: SimEntity, x: number, y: number, radius: number, a: AbilityDef): number {
    let count = 0;
    sim.grid.query(x, y, radius + 1, (enemy) => {
      if (!enemy.alive || enemy.team === hero.team || !sim.canSee(hero.team, enemy)) return;
      if (distance(enemy, x, y) > radius + enemy.stats.radius) return;
      const air = enemy.stats.layer === 'air';
      if ((air && !a.filter.includes('air')) || (!air && !a.filter.includes('ground'))) return;
      count++;
    });
    return count;
  }

  private inCastRange(hero: SimEntity, target: SimEntity, a: AbilityDef, level: number): boolean {
    return distance(hero, target.mover.x, target.mover.y) <= lv(a.castRange, level) + hero.stats.radius + target.stats.radius;
  }

  private pointInRange(hero: SimEntity, x: number, y: number, a: AbilityDef, level: number): boolean {
    return distance(hero, x, y) <= lv(a.castRange, level);
  }

  private cast(sim: MatchSim, hero: SimEntity, slot: number, target: CastTarget): boolean {
    if (castProblem(sim, hero, slot, target) !== null) return false;
    return this.send(sim, { type: CommandType.Cast, slot, target: target.kind, id: target.id, x: target.x, y: target.y });
  }

  private nextRandom(): number {
    let x = this.randomState | 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.randomState = x;
    return (x >>> 0) / 4_294_967_296;
  }

  private needsPointOrder(hero: SimEntity, plan: number, x: number, y: number): boolean {
    const order = plan === PLAN_RETREAT ? 'move' : 'attackMove';
    return this.plan !== plan || this.planX !== x || this.planY !== y || hero.order !== order;
  }

  private setPointPlan(plan: number, x: number, y: number): void {
    this.plan = plan;
    this.planTarget = 0;
    this.planX = x;
    this.planY = y;
  }
}
