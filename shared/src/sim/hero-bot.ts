import { entityTypeIndex } from './entity-types';
// A computer-controlled hero (Bot slots): learns abilities, farms camps that fit its level,
// retreats on low health, defends the base and joins the faction's attacks. It only sends the
// same commands a player sends. Written by Codex for Phase 8 (task: tools/codex-tasks/hero-bot.md).

import { abilityMechanic, gameData, type AbilityDef } from '../data/index';
import { castProblem, heroAbility, lv, param, targetAllowed, type CastTarget } from './abilities';
import type { CampState } from './camps';
import { CommandType, type GameCommand } from './commands';
import { isTownHall } from './faction/faction';
import { factionTech, hallInRange, UPGRADE_IDS, upgradeProblem } from './faction/hall-shop';
import { HIRE, hirePrice, hiredSupply, hireProblem, tavernStockAt } from './faction/hire';
import { upgradeStatus, type UpgradeId } from './faction/upgrades';
import { ITEMS, buyPlan, canStore, canStoreAfter, itemIndex, itemReadyAt, newCharges, shopInRange, type ItemStack } from './items';
import { NEUTRAL_TEAM, TICK_RATE, type MatchSim, type SimEntity } from './match-sim';
import { canLearn, rectDistance } from './stats';

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface HeroBotHooks {
  /** Where the faction's army is attacking now, or null (wired in Phase 8b). */
  armyTarget?: () => { x: number; y: number } | null;
  /** Our base is under attack: point to defend, or null. */
  baseUnderAttack?: () => { x: number; y: number } | null;
  /** A faction's own hero: where its army is while the army is out (camps, enemy armies, attacks), or null. */
  withArmy?: () => { x: number; y: number } | null;
  /** withArmy only from this hero level (before that the hero farms alone) */
  withArmyFromLevel?: number;
  /** hire soldiers at the faction's production buildings (player heroes played by a bot) */
  hires?: boolean;
  /** the kingdom (faction slot) the hero buys upgrades and hires for; default: its own slot */
  kingdom?: number;
  /** The kingdom's order keeps it near home (defend, build up): farm only camps this close to the point. */
  campArea?: () => { x: number; y: number; range: number } | null;
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
/** Between camps: heal first when below this (no enemy near). */
const REST_BELOW_PCT = 55;
/** A fountain may be this much farther than home and still be the better place to heal. */
const FOUNTAIN_DETOUR = 70;
const PLAN_NONE = 0;
const PLAN_RETREAT = 1;
const PLAN_FARM = 2;
const PLAN_DEFEND = 3;
const PLAN_ATTACK = 4;
const PLAN_SHOP = 5;
const PLAN_UPGRADES = 6;
const PLAN_ARMY = 7;
const PLAN_HIRE = 8;
const PLAN_HELP = 9;
/** an ally hero in a fight this close gets help (when we are not busy with the army or the base) */
const HELP_ALLY_RANGE = 35;
const HIRING = gameData.ai.heroBot.hiring;
/** a bot that hires at a tavern walks this close to its center */
const TAVERN_STAND = 4;
/** With the army: a new walk order only when the army moved this far from the last one. */
const ARMY_REORDER = 6;
const MAX_COMMANDS_PER_THINK = 3;
const POTION_ITEM = itemIndex('healing_potion');
const POTION_TARGET = 2;
const POTION_USE_PCT = 45;
const SHOP_NEAR = 25;
const HALL_NEAR = 30;
const ITEM_GOLD_BUFFER = 100;
/** a hit counts as a fight for this long */
const RECENT_HIT_TICKS = 4 * TICK_RATE;
const UPGRADE_GOLD_BUFFER = 300;
const UPGRADE_SPEND_SHARE = 0.3;
/** the upgrade savings stop growing here (the dearest upgrade level costs 375) */
const UPGRADE_BUDGET_MAX = 400;
const UPGRADE_ORDER: readonly UpgradeId[] = ['iron_plates', 'sharper_blades', 'better_arrows', 'rich_veins', 'stone_walls'];
const HERO_BUILDS = gameData.ai.heroBot.heroBuild as unknown as Record<string, readonly string[]>;
const HEALS = new Set(['radiant_touch', 'sanctuary', 'dawn_shield']);
const SELF_BUFFS = new Set(['iron_stance', 'stone_skin']);

/** Is `part` somewhere in the recipe of `item` (all the way down)? */
function madeFrom(item: number, part: number): boolean {
  const r = ITEMS[item]?.recipe;
  return !!r && r.components.some((c) => itemIndex(c) === part || madeFrom(itemIndex(c), part));
}

/**
 * What to buy now for a build item: the item itself when its price (carried parts count) fits
 * the budget, else the first missing part that fits (one level down at a time). -1 = wait.
 */
function nextPurchase(inv: readonly (ItemStack | null)[], goal: number, budget: number): number {
  if (buyPlan(inv, goal).price <= budget) return goal;
  const r = ITEMS[goal]!.recipe;
  if (!r) return -1;
  const used: number[] = [];
  for (const c of r.components) {
    const part = itemIndex(c);
    const slot = inv.findIndex((st, i) => st?.item === part && !used.includes(i));
    if (slot >= 0) {
      used.push(slot);
      continue;
    }
    return nextPurchase(inv, part, budget);
  }
  return -1;
}

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

/**
 * Where a hurt hero goes: the nearest Fountain of Life, unless home is much closer. The base has
 * no healing, and a fountain heals about ten times faster than resting, so a longer walk pays.
 */
function retreatPoint(hero: SimEntity): readonly [number, number] {
  const home: readonly [number, number] = hero.heroState!.home;
  let best = home;
  let bestD = distance(hero, home[0], home[1]) + FOUNTAIN_DETOUR;
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

function campHasFlyers(camp: CampState): boolean {
  for (const member of camp.members) if (member.alive && member.stats.layer !== 'ground') return true;
  return false;
}

function lowestHealthMember(camp: CampState): SimEntity | null {
  let best: SimEntity | null = null;
  for (const member of camp.members) if (member.alive && (!best || member.hp < best.hp)) best = member;
  return best;
}

export class HeroBot {
  private readonly settings: DifficultySettings;
  private readonly difficulty: BotDifficulty;
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
  private upgradeBudget = -1;
  private upgradeGoldMark = 0;
  private wasAlive = false;
  private randomState: number;

  constructor(
    private readonly slot: number,
    difficulty: BotDifficulty,
    private readonly hooks: HeroBotHooks = {},
  ) {
    this.difficulty = difficulty;
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

    this.trackUpgradeBudget(hero);
    let commands = 0;
    if (hero.heroState.skillPoints > 0 && this.learn(sim, hero)) commands++;

    const hpPct = (hero.hp / hero.stats.maxHp) * 100;
    const fighting = this.inFight(sim, hero);
    const defend = this.hooks.baseUnderAttack?.() ?? null;
    if (this.retreating && hpPct >= RETREAT_DONE_PCT) {
      this.retreating = false;
      this.plan = PLAN_NONE;
    } else if (
      !this.retreating &&
      ((hpPct < this.settings.retreatAtHpPct && this.enemyNear(sim, hero, 10)) ||
        (hpPct < REST_BELOW_PCT && !hero.targetId && !this.enemyNear(sim, hero, 10)))
    ) {
      this.retreating = true;
      this.campIndex = -1;
      this.plan = PLAN_NONE;
    }

    if (hpPct < POTION_USE_PCT && (fighting || this.retreating) && commands < MAX_COMMANDS_PER_THINK && this.usePotion(sim, hero)) {
      commands++;
    }

    if (this.retreating) {
      if (hero.order === 'cast') return;
      const start = retreatPoint(hero);
      if (!fighting && !defend) {
        const shopping = this.shopForPotions(sim, hero, start[0], start[1], MAX_COMMANDS_PER_THINK - commands);
        if (shopping >= 0) return;
        if (this.difficulty !== 'easy') {
          const upgrading = this.buyUpgrades(sim, hero, start[0], start[1], MAX_COMMANDS_PER_THINK - commands);
          if (upgrading >= 0) return;
        }
      }
      this.stateText = 'Retreating';
      if (commands < MAX_COMMANDS_PER_THINK && this.tryAbility(sim, hero, null, true)) return;
      if (commands < MAX_COMMANDS_PER_THINK && this.needsPointOrder(hero, PLAN_RETREAT, start[0], start[1])) {
        this.send(sim, { type: CommandType.Move, x: start[0], y: start[1], queue: false });
        this.setPointPlan(PLAN_RETREAT, start[0], start[1]);
      }
      return;
    }

    const current = hero.targetId ? sim.get(hero.targetId) : undefined;
    if (hero.order === 'cast') return;
    if (commands < MAX_COMMANDS_PER_THINK && this.tryAbility(sim, hero, current?.alive ? current : null, false)) return;

    if (defend) {
      this.campIndex = -1;
      this.stateText = 'Defending the base';
      if (commands < MAX_COMMANDS_PER_THINK && this.needsPointOrder(hero, PLAN_DEFEND, defend.x, defend.y)) {
        this.send(sim, { type: CommandType.AttackMove, x: defend.x, y: defend.y });
        this.setPointPlan(PLAN_DEFEND, defend.x, defend.y);
      }
      return;
    }

    // A shop trip goes on when a camp on the way attacks: turning back to farm made the bot swing
    // between the two for minutes. Low health still sends it home (retreat, above).
    if (!fighting || this.plan === PLAN_SHOP) {
      const shopping = this.shopForPotions(sim, hero, null, null, MAX_COMMANDS_PER_THINK - commands);
      if (shopping >= 0) return;
      if (this.difficulty !== 'easy') {
        const upgrading = this.buyUpgrades(sim, hero, null, null, MAX_COMMANDS_PER_THINK - commands);
        if (upgrading >= 0) return;
        const buildShopping = this.shopForBuild(sim, hero, MAX_COMMANDS_PER_THINK - commands);
        if (buildShopping >= 0) return;
      }
      if (this.hireSoldiers(sim, hero, MAX_COMMANDS_PER_THINK - commands) >= 0) return;
    }

    const ally = this.allyInFight(sim, hero);
    if (ally) {
      this.campIndex = -1;
      this.stateText = 'Helping an ally';
      const x = ally.mover.x,
        y = ally.mover.y;
      if (
        commands < MAX_COMMANDS_PER_THINK &&
        !hero.targetId &&
        (this.plan !== PLAN_HELP || Math.hypot(this.planX - x, this.planY - y) > 4)
      ) {
        this.send(sim, { type: CommandType.AttackMove, x, y });
        this.setPointPlan(PLAN_HELP, x, y);
      }
      return;
    }

    const group = hero.heroState.level >= (this.hooks.withArmyFromLevel ?? 1) ? (this.hooks.withArmy?.() ?? null) : null;
    if (group) {
      this.campIndex = -1;
      this.stateText = 'With the army';
      const moved = Math.hypot(this.planX - group.x, this.planY - group.y) > ARMY_REORDER;
      if (
        commands < MAX_COMMANDS_PER_THINK &&
        !hero.targetId &&
        (this.plan !== PLAN_ARMY ||
          (moved && distance(hero, group.x, group.y) > ARMY_REORDER) ||
          (hero.order !== 'attackMove' && distance(hero, group.x, group.y) > 3))
      ) {
        this.send(sim, { type: CommandType.AttackMove, x: group.x, y: group.y });
        this.setPointPlan(PLAN_ARMY, group.x, group.y);
      }
      return;
    }

    const army = this.settings.joinsAttacks && hero.heroState.level >= 4 ? (this.hooks.armyTarget?.() ?? null) : null;
    if (army) {
      this.campIndex = -1;
      this.stateText = 'Joining the attack';
      if (commands < MAX_COMMANDS_PER_THINK && this.needsPointOrder(hero, PLAN_ATTACK, army.x, army.y)) {
        this.send(sim, { type: CommandType.AttackMove, x: army.x, y: army.y });
        this.setPointPlan(PLAN_ATTACK, army.x, army.y);
      }
      return;
    }

    const camp = this.chooseCamp(sim, hero);
    if (!camp) {
      this.campIndex = -1;
      const area = this.hooks.campArea?.() ?? null;
      // Ordered to stay home and nothing to farm there: wait at the base.
      if (
        area &&
        commands < MAX_COMMANDS_PER_THINK &&
        distance(hero, area.x, area.y) > 12 &&
        this.needsPointOrder(hero, PLAN_ARMY, area.x, area.y)
      ) {
        this.send(sim, { type: CommandType.AttackMove, x: area.x, y: area.y });
        this.setPointPlan(PLAN_ARMY, area.x, area.y);
        this.stateText = 'Guarding the base';
        return;
      }
      this.plan = PLAN_NONE;
      this.stateText = area ? 'Guarding the base' : 'No safe camp';
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
        commands < MAX_COMMANDS_PER_THINK &&
        (this.plan !== PLAN_FARM || this.planTarget !== 0 || this.planX !== camp.x || this.planY !== camp.y || hero.order !== 'move')
      ) {
        this.send(sim, { type: CommandType.Move, x: camp.x, y: camp.y, queue: false });
        this.setPointPlan(PLAN_FARM, camp.x, camp.y);
      }
      return;
    }
    const refresh = hero.targetId !== 0 && sim.tick - this.lastFightOrderAt >= FIGHT_ORDER_TICKS;
    if (
      commands < MAX_COMMANDS_PER_THINK &&
      (this.plan !== PLAN_FARM || this.planTarget !== target.id || hero.order !== 'attack' || refresh)
    ) {
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
    // Then the least learned of the other two, so the third skill (often a passive or an aura)
    // is not left empty until level 8.
    const levels = hero.heroState!.abilityLevels;
    let pick = -1;
    for (let slot = 0; slot < 3; slot++) {
      if (slot === main || !this.canLearnSlot(hero, slot)) continue;
      if (pick < 0 || (levels[slot] ?? 0) < (levels[pick] ?? 0)) pick = slot;
    }
    return pick >= 0 && this.send(sim, { type: CommandType.Learn, slot: pick });
  }

  private canLearnSlot(hero: SimEntity, slot: number): boolean {
    const hs = hero.heroState!;
    const a = heroAbility(hero, slot);
    const level = hs.abilityLevels[slot] ?? 0;
    return !!a && canLearn(slot, level, a.maxLevel, hs.level);
  }

  /**
   * An allied hero (a teammate, human or bot) fighting enemy units or heroes, not monsters,
   * within HELP_ALLY_RANGE. Two heroes together win fights one alone loses.
   */
  private allyInFight(sim: MatchSim, hero: SimEntity): SimEntity | null {
    let best: SimEntity | null = null,
      bestD = HELP_ALLY_RANGE;
    for (const ally of sim.heroes) {
      if (!ally?.alive || ally === hero || ally.team !== hero.team) continue;
      const d = distance(hero, ally.mover.x, ally.mover.y);
      if (d >= bestD) continue;
      const t = ally.targetId ? sim.get(ally.targetId) : undefined;
      const hitBy = ally.lastHitBy ? sim.get(ally.lastHitBy) : undefined;
      const foe = (e: SimEntity | undefined) => !!e?.alive && e.team !== hero.team && e.team !== NEUTRAL_TEAM && !e.building;
      if (!foe(t) && !(foe(hitBy) && distance(ally, hitBy!.mover.x, hitBy!.mover.y) < 12)) continue;
      best = ally;
      bestD = d;
    }
    return best;
  }

  private enemyNear(sim: MatchSim, hero: SimEntity, radius: number): boolean {
    let found = false;
    sim.grid.query(hero.mover.x, hero.mover.y, radius, (e, d2) => {
      if (!found && e.alive && !e.invulnerable && e.team !== hero.team && d2 <= radius * radius && sim.canSee(hero.team, e)) found = true;
    });
    return found;
  }

  private inFight(sim: MatchSim, hero: SimEntity): boolean {
    let found = false;
    sim.grid.query(hero.mover.x, hero.mover.y, 10, (enemy, d2) => {
      if (
        !found &&
        enemy.alive &&
        enemy.team !== hero.team &&
        d2 <= 100 &&
        (hero.targetId === enemy.id ||
          (hero.order === 'attack' && hero.orderTarget === enemy.id) ||
          enemy.targetId === hero.id ||
          (enemy.order === 'attack' && enemy.orderTarget === hero.id) ||
          // A hit long ago is not a fight: a camp the hero hit once must not hold it near forever.
          (hero.lastHitBy === enemy.id && sim.tick - hero.lastHitAt < RECENT_HIT_TICKS) ||
          (enemy.lastHitBy === hero.id && sim.tick - enemy.lastHitAt < RECENT_HIT_TICKS))
      ) {
        found = true;
      }
    });
    return found;
  }

  private usePotion(sim: MatchSim, hero: SimEntity): boolean {
    const hs = hero.heroState!;
    for (let slot = 0; slot < hs.inventory.length; slot++) {
      const stack = hs.inventory[slot];
      if (stack?.item !== POTION_ITEM || itemReadyAt(hs, slot, sim.tick) !== 0) continue;
      if (this.send(sim, { type: CommandType.UseItem, slot, target: 0, id: 0, x: 0, y: 0 })) return true;
    }
    return false;
  }

  private potionCount(hero: SimEntity): number {
    let count = 0;
    for (const stack of hero.heroState!.inventory) if (stack?.item === POTION_ITEM) count += stack.charges;
    return count;
  }

  private shopForPotions(sim: MatchSim, hero: SimEntity, routeX: number | null, routeY: number | null, availableCommands: number): number {
    const count = this.potionCount(hero);
    const cost = ITEMS[POTION_ITEM]!.cost ?? Infinity;
    if (
      count >= POTION_TARGET ||
      hero.heroState!.gold < cost ||
      !canStore(hero.heroState!.inventory, POTION_ITEM, newCharges(POTION_ITEM))
    ) {
      return -1;
    }
    const shop = this.nearestShop(hero, POTION_ITEM, SHOP_NEAR, routeX, routeY);
    if (!shop) return -1;
    this.stateText = 'Shopping';
    this.campIndex = -1;
    if (!shopInRange(hero, POTION_ITEM)) {
      if (availableCommands > 0 && this.needsMoveOrder(hero, PLAN_SHOP, POTION_ITEM, shop.pos[0], shop.pos[1])) {
        this.send(sim, { type: CommandType.Move, x: shop.pos[0], y: shop.pos[1], queue: false });
        this.setItemPlan(PLAN_SHOP, POTION_ITEM, shop.pos[0], shop.pos[1]);
        return 1;
      }
      return 0;
    }
    let sent = 0;
    const buyCount = Math.min(POTION_TARGET - count, Math.floor(hero.heroState!.gold / cost), availableCommands);
    for (let i = 0; i < buyCount; i++) {
      if (this.send(sim, { type: CommandType.BuyItem, item: POTION_ITEM })) sent++;
    }
    return sent;
  }

  private shopForBuild(sim: MatchSim, hero: SimEntity, availableCommands: number): number {
    const build = HERO_BUILDS[hero.heroState!.def.id];
    if (!build) return -1;
    const inv = hero.heroState!.inventory;
    // Long recipe builds would eat all gold: keep some for soldiers until half the hire limit.
    const hs = hero.heroState!;
    const wantsSoldiers = this.hooks.hires && hs.level >= HIRING.fromLevel && hiredSupply(sim, hero) < HIRE.maxSupply / 2;
    const budget = hs.gold - Math.max(ITEM_GOLD_BUFFER, this.upgradeReserve(sim, hero)) - (wantsSoldiers ? HIRING.goldBuffer : 0);
    for (const id of build) {
      const goal = itemIndex(id);
      if (goal < 0 || this.hasItem(hero, goal)) continue;
      // The next build item, or a part of it while the whole recipe is too dear (wait for gold).
      const item = nextPurchase(inv, goal, budget);
      if (item < 0) return -1;
      if (!canStoreAfter(inv, buyPlan(inv, item), item)) continue;
      const shop = this.nearestShop(hero, item, Infinity, null, null);
      if (!shop) return -1;
      this.stateText = 'Shopping';
      this.campIndex = -1;
      if (!shopInRange(hero, item)) {
        if (availableCommands > 0 && this.needsMoveOrder(hero, PLAN_SHOP, item, shop.pos[0], shop.pos[1])) {
          this.send(sim, { type: CommandType.Move, x: shop.pos[0], y: shop.pos[1], queue: false });
          this.setItemPlan(PLAN_SHOP, item, shop.pos[0], shop.pos[1]);
          return 1;
        }
        return 0;
      }
      if (availableCommands > 0 && this.send(sim, { type: CommandType.BuyItem, item })) return 1;
      return 0;
    }
    return -1;
  }

  /**
   * Town Hall upgrade savings: UPGRADE_SPEND_SHARE of all gold the hero earns, kept apart from
   * items and hiring (they leave it alone, see upgradeReserve), so the hero buys upgrades even
   * while it spends the rest.
   */
  private trackUpgradeBudget(hero: SimEntity): void {
    const gold = hero.heroState!.gold;
    if (this.difficulty === 'easy') this.upgradeBudget = 0;
    else if (this.upgradeBudget < 0) this.upgradeBudget = Math.max(0, gold - UPGRADE_GOLD_BUFFER) * UPGRADE_SPEND_SHARE;
    else if (gold > this.upgradeGoldMark) this.upgradeBudget += (gold - this.upgradeGoldMark) * UPGRADE_SPEND_SHARE;
    this.upgradeBudget = Math.min(this.upgradeBudget, UPGRADE_BUDGET_MAX, Math.max(0, gold - UPGRADE_GOLD_BUFFER));
    this.upgradeGoldMark = gold;
  }

  /** Gold items and hiring must leave: the savings, while an upgrade can be bought soon. */
  private upgradeReserve(sim: MatchSim, hero: SimEntity): number {
    const faction = sim.factions?.get(this.hooks.kingdom ?? this.slot);
    if (!faction || faction.defeated || this.upgradeBudget <= 0) return 0;
    const tech = factionTech(sim, faction);
    for (const id of UPGRADE_ORDER) {
      const status = upgradeStatus(id, tech, hero.heroState!.gold, sim.tick);
      if (status.cost !== null && (status.ok || status.problem === 'gold')) return Math.min(this.upgradeBudget, status.cost);
    }
    return 0;
  }

  private buyUpgrades(sim: MatchSim, hero: SimEntity, routeX: number | null, routeY: number | null, availableCommands: number): number {
    const faction = sim.factions?.get(this.hooks.kingdom ?? this.slot);
    if (!faction || faction.defeated || hero.heroState!.gold <= UPGRADE_GOLD_BUFFER) return -1;
    const tech = factionTech(sim, faction);
    let upgrade = -1;
    let cost = 0;
    for (const id of UPGRADE_ORDER) {
      const status = upgradeStatus(id, tech, hero.heroState!.gold, sim.tick);
      if (!status.ok || status.cost === null || status.cost > this.upgradeBudget) continue;
      upgrade = UPGRADE_IDS.indexOf(id);
      cost = status.cost;
      break;
    }
    if (upgrade < 0) {
      if (this.plan === PLAN_UPGRADES) this.plan = PLAN_NONE;
      return -1;
    }
    // The savings are ready: the hero walks home from anywhere (from the army too).
    const hall = this.nearHall(sim, hero, faction.buildings, routeX, routeY, Infinity);
    if (!hall) return -1;
    this.stateText = 'Buying upgrades';
    this.campIndex = -1;
    if (!hallInRange(sim, hero, faction)) {
      this.setHallApproach(hero, hall);
      if (availableCommands > 0 && this.needsMoveOrder(hero, PLAN_UPGRADES, hall.id, this.planX, this.planY)) {
        this.send(sim, { type: CommandType.Move, x: this.planX, y: this.planY, queue: false });
        this.setItemPlan(PLAN_UPGRADES, hall.id, this.planX, this.planY);
        return 1;
      }
      return 0;
    }
    if (availableCommands > 0 && upgradeProblem(sim, hero, upgrade) === null && this.send(sim, { type: CommandType.BuyUpgrade, upgrade })) {
      this.upgradeBudget -= cost;
      this.plan = PLAN_UPGRADES;
      this.planTarget = hall.id;
      return 1;
    }
    return 0;
  }

  /**
   * Hire soldiers (ai.json heroBot.hiring): the most expensive unit an own production building
   * within maxTravel has, while the hire limit allows and gold stays above the buffer. -1 = nothing to do.
   */
  private hireSoldiers(sim: MatchSim, hero: SimEntity, availableCommands: number): number {
    const hs = hero.heroState!;
    if (!this.hooks.hires || hs.level < HIRING.fromLevel || hs.gold < HIRING.goldBuffer) return -1;
    const f = sim.factions?.get(this.hooks.kingdom ?? this.slot);
    if (!f || f.defeated) return -1;
    const room = HIRE.maxSupply - hiredSupply(sim, hero);
    if (room <= 0) return -1;
    // The upgrade savings are part of the gold buffer (not on top of it), so hiring goes on.
    const spare = hs.gold - Math.max(HIRING.goldBuffer, this.upgradeReserve(sim, hero) + 100);
    let building: SimEntity | null = null;
    let unit = -1;
    let best = 0;
    for (const id of f.buildings) {
      const b = sim.get(id);
      if (!b?.alive || !b.building?.done || !b.building.def?.trains.length) continue;
      const d = rectDistance(hero.mover.x, hero.mover.y, b.mover.x, b.mover.y, b.building.w, b.building.h);
      if (d > HIRING.maxTravel) continue;
      for (const unitId of b.building.def.trains) {
        const index = gameData.units.findIndex((u) => u.id === unitId);
        const price = hirePrice(index);
        const def = gameData.units[index];
        if (price === null || !def || price <= best || price > spare || (def.supply ?? 0) > room) continue;
        if (sim.factions!.missing(f, def.requires).length) continue;
        building = b;
        unit = index;
        best = price;
      }
    }
    // Tavern mercenaries count too (a tavern is a map shop, not an entity: target id 0).
    let tavern: { x: number; y: number } | null = null;
    for (const [shopIndex, t] of gameData.map.shops.entries()) {
      const shop = gameData.shops.find((d) => d.id === t.type) as { mercenaries?: string[] } | undefined;
      if (!shop?.mercenaries || distance(hero, t.pos[0], t.pos[1]) > HIRING.maxTravel) continue;
      for (const unitId of shop.mercenaries) {
        const index = gameData.units.findIndex((u) => u.id === unitId);
        if (tavernStockAt(sim, shopIndex, index)?.count === 0) continue;
        const price = hirePrice(index);
        const def = gameData.units[index];
        if (price === null || !def || price <= best || price > spare || (def.supply ?? 0) > room) continue;
        building = null;
        tavern = { x: t.pos[0], y: t.pos[1] };
        unit = index;
        best = price;
      }
    }
    if (!building && !tavern) {
      if (this.plan === PLAN_HIRE) this.plan = PLAN_NONE;
      return -1;
    }
    this.stateText = 'Hiring soldiers';
    this.campIndex = -1;
    const targetId = building?.id ?? 0;
    if (hireProblem(sim, hero, unit) === 'range') {
      if (building) this.setHallApproach(hero, building);
      else {
        // A few steps in front of the tavern, on the hero's side.
        const d = Math.max(0.001, distance(hero, tavern!.x, tavern!.y));
        this.planX = tavern!.x + ((hero.mover.x - tavern!.x) / d) * TAVERN_STAND;
        this.planY = tavern!.y + ((hero.mover.y - tavern!.y) / d) * TAVERN_STAND;
      }
      if (availableCommands > 0 && this.needsMoveOrder(hero, PLAN_HIRE, targetId, this.planX, this.planY)) {
        this.send(sim, { type: CommandType.Move, x: this.planX, y: this.planY, queue: false });
        this.setItemPlan(PLAN_HIRE, targetId, this.planX, this.planY);
        return 1;
      }
      return 0;
    }
    if (availableCommands > 0 && hireProblem(sim, hero, unit) === null && this.send(sim, { type: CommandType.Hire, unit })) {
      this.plan = PLAN_HIRE;
      this.planTarget = targetId;
      return 1;
    }
    return -1;
  }

  private nearestShop(
    hero: SimEntity,
    item: number,
    maxDistance: number,
    routeX: number | null,
    routeY: number | null,
  ): (typeof gameData.map.shops)[number] | null {
    let best: (typeof gameData.map.shops)[number] | null = null;
    let bestDistance = Infinity;
    for (const mapShop of gameData.map.shops) {
      const shop = gameData.shops.find((entry) => entry.id === mapShop.type);
      if (!shop || !shop.items.includes(ITEMS[item]!.id)) continue;
      const d = distance(hero, mapShop.pos[0], mapShop.pos[1]);
      const onRoute =
        routeX !== null &&
        routeY !== null &&
        this.pointSegmentDistance(mapShop.pos[0], mapShop.pos[1], hero, routeX, routeY) <= shop.useRange;
      if ((d > maxDistance && !onRoute) || d >= bestDistance) continue;
      bestDistance = d;
      best = mapShop;
    }
    return best;
  }

  private nearHall(
    sim: MatchSim,
    hero: SimEntity,
    buildings: ReadonlySet<number>,
    routeX: number | null,
    routeY: number | null,
    maxDistance = HALL_NEAR,
  ): SimEntity | null {
    let best: SimEntity | null = null;
    let bestDistance = Infinity;
    for (const id of buildings) {
      const hall = sim.get(id);
      if (!hall?.alive || !hall.building?.done || !isTownHall(hall)) continue;
      const d = Math.max(
        0,
        rectDistance(hero.mover.x, hero.mover.y, hall.mover.x, hall.mover.y, hall.building.w, hall.building.h) - hero.stats.radius,
      );
      const onRoute =
        routeX !== null &&
        routeY !== null &&
        this.pointSegmentDistance(hall.mover.x, hall.mover.y, hero, routeX, routeY) <=
          HALL_NEAR + Math.hypot(hall.building.w, hall.building.h) * 0.5 + hero.stats.radius;
      if ((d > maxDistance && !onRoute) || d >= bestDistance) continue;
      bestDistance = d;
      best = hall;
    }
    return best;
  }

  private pointSegmentDistance(x: number, y: number, hero: SimEntity, endX: number, endY: number): number {
    const dx = endX - hero.mover.x;
    const dy = endY - hero.mover.y;
    const length2 = dx * dx + dy * dy;
    const t = length2 > 0 ? Math.max(0, Math.min(1, ((x - hero.mover.x) * dx + (y - hero.mover.y) * dy) / length2)) : 0;
    return Math.hypot(x - (hero.mover.x + dx * t), y - (hero.mover.y + dy * t));
  }

  private setHallApproach(hero: SimEntity, hall: SimEntity): void {
    const building = hall.building!;
    const dx = hero.mover.x - hall.mover.x;
    const dy = hero.mover.y - hall.mover.y;
    if (Math.abs(dx) / building.w >= Math.abs(dy) / building.h) {
      this.planX = hall.mover.x + Math.sign(dx || 1) * (building.w * 0.5 + hero.stats.radius + 5);
      this.planY = hall.mover.y;
    } else {
      this.planX = hall.mover.x;
      this.planY = hall.mover.y + Math.sign(dy || 1) * (building.h * 0.5 + hero.stats.radius + 5);
    }
  }

  /** Carries the item, or an item made from it (Arcane Staff after Arcane Staff II). */
  private hasItem(hero: SimEntity, item: number): boolean {
    for (const stack of hero.heroState!.inventory) if (stack && (stack.item === item || madeFrom(stack.item, item))) return true;
    return false;
  }

  private hasAllyHeroNear(sim: MatchSim, hero: SimEntity): boolean {
    let found = false;
    sim.grid.query(hero.mover.x, hero.mover.y, 12, (e, d2) => {
      if (!found && e !== hero && e.alive && e.heroState && e.team === hero.team && d2 <= 144) found = true;
    });
    return found;
  }

  private chooseCamp(sim: MatchSim, hero: SimEntity): CampState | null {
    // ai.json campChoice: 4 + 2 x level (3 x with an ally hero near), so orange camps open at level 3.
    const maxLevel = 4 + hero.heroState!.level * (this.hasAllyHeroNear(sim, hero) ? 3 : 2);
    const area = this.hooks.campArea?.() ?? null;
    let best: CampState | null = null;
    let bestDistance = Infinity;
    for (const camp of sim.camps) {
      if (camp.respawnAt !== 0) continue;
      if (area && Math.hypot(camp.x - area.x, camp.y - area.y) > area.range) continue;
      const level = aliveCampLevel(camp);
      if (level === 0 || level > maxLevel) continue;
      // A melee hero can not hit flying monsters (harpies): it would stand under them forever.
      if (!hero.stats.canHitAir && campHasFlyers(camp)) continue;
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
    if (hero.heroState?.def.id === 'earth_spirit') return this.tryEarthSpirit(sim, hero, target, retreating);
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
      if (HEALS.has(abilityMechanic(a))) {
        const ally = this.lowestHurtAlly(sim, hero, a, level);
        if (!ally) continue;
        const castTarget: CastTarget =
          a.target === 'unit' ? { kind: 1, id: ally.id, x: 0, y: 0 } : { kind: 2, id: 0, x: ally.mover.x, y: ally.mover.y };
        if (this.cast(sim, hero, slot, castTarget)) return true;
        continue;
      }
      if (SELF_BUFFS.has(abilityMechanic(a))) {
        if (hero.lastHitBy && hero.hp < hero.stats.maxHp * 0.7 && this.cast(sim, hero, slot, { kind: 0, id: 0, x: 0, y: 0 })) return true;
        continue;
      }
      if (!target?.alive || !sim.canSee(hero.team, target)) continue;
      if (a.target === 'unit') {
        if (!targetAllowed(sim, hero, a, target) || !this.inCastRange(hero, target, a, level)) continue;
        // Debuffs (Mana Mark) only on heroes: they are worth it there.
        const debuff = target.hero && a.params.bonusSpellDamagePct !== undefined && !target.buffs.some((b) => b.id === a.id);
        if ((this.isDamageOrControl(a) || debuff) && this.cast(sim, hero, slot, { kind: 1, id: target.id, x: 0, y: 0 })) return true;
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

  private tryEarthSpirit(sim: MatchSim, hero: SimEntity, target: SimEntity | null, retreating: boolean): boolean {
    const point = (slot: number, x: number, y: number) => this.cast(sim, hero, slot, { kind: 2, id: 0, x, y });
    if (retreating) {
      const home = retreatPoint(hero);
      return point(1, home[0], home[1]);
    }
    if (!target?.alive || target.building || !sim.canSee(hero.team, target)) return false;
    const dx = target.mover.x - hero.mover.x,
      dy = target.mover.y - hero.mover.y,
      d = Math.hypot(dx, dy) || 1;
    const mag = heroAbility(hero, 3)!;
    if (
      d <= param(mag, 'radius', 1) &&
      !target.buffs.some((b) => b.id === 'magnetize' && b.sourceId === hero.id) &&
      this.cast(sim, hero, 3, { kind: 0, id: 0, x: 0, y: 0 })
    )
      return true;
    const stoneType = entityTypeIndex('earth_remnant');
    const stones = sim.entities.filter((e) => e.alive && e.type === stoneType && e.leaderId === hero.id);
    const close = stones.find((e) => distance(hero, e.mover.x, e.mover.y) <= 2);
    if (close && d <= 20 && point(0, target.mover.x, target.mover.y)) return true;
    const far = stones.find((e) => distance(hero, e.mover.x, e.mover.y) > 2 && distance(hero, e.mover.x, e.mover.y) <= 11);
    if (far && point(2, far.mover.x, far.mover.y)) return true;
    if (d > 3 && d <= 16 && point(1, target.mover.x, target.mover.y)) return true;
    if (target.hero && d < 1.75 && this.cast(sim, hero, 5, { kind: 1, id: target.id, x: 0, y: 0 })) return true;
    if (!stones.length && d <= 11) {
      const activeMag = target.buffs.some((b) => b.id === 'magnetize' && b.sourceId === hero.id);
      return point(4, activeMag ? target.mover.x : hero.mover.x + dx / d, activeMag ? target.mover.y : hero.mover.y + dy / d);
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

  private needsMoveOrder(hero: SimEntity, plan: number, target: number, x: number, y: number): boolean {
    return this.plan !== plan || this.planTarget !== target || this.planX !== x || this.planY !== y || hero.order !== 'move';
  }

  private setPointPlan(plan: number, x: number, y: number): void {
    this.plan = plan;
    this.planTarget = 0;
    this.planX = x;
    this.planY = y;
  }

  private setItemPlan(plan: number, target: number, x: number, y: number): void {
    this.plan = plan;
    this.planTarget = target;
    this.planX = x;
    this.planY = y;
  }
}
