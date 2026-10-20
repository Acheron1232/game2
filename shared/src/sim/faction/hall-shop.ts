// The hero buys Town Hall upgrades for its own faction, with hero gold, at one of its own
// finished Town Halls (upgrades.json useRange, from the building edge). Rules and effects:
// upgrades.ts; this file checks the command and applies the purchase.

import { gameData } from '../../data/index';
import { rectDistance } from '../stats';
import { TICK_RATE, type MatchSim, type SimEntity } from '../match-sim';
import { isTownHall, type FactionState } from './faction';
import { upgradeStatus, type FactionTech, type UpgradeId } from './upgrades';

export const UPGRADES = gameData.upgrades.upgrades;
export const UPGRADE_IDS = UPGRADES.map((u) => u.id as UpgradeId);
const USE_RANGE = gameData.upgrades.useRange;
const WAR_BANNER = UPGRADES.find((u) => u.id === 'war_banner')!;
const FUND = UPGRADES.find((u) => u.id === 'tier_up_fund')!;

/** What upgrades.ts needs to know about a faction. */
export function factionTech(sim: MatchSim, f: FactionState): FactionTech {
  const buildings = new Set<string>();
  for (const id of f.buildings) {
    const b = sim.get(id);
    if (b?.alive && b.building?.done && b.building.def) buildings.add(b.building.def.id);
  }
  return { tier: f.tier, buildings, levels: f.upgrades, readyAt: f.upgradeReadyAt };
}

/** A finished Town Hall of the hero's faction in use range, or null. */
export function hallInRange(sim: MatchSim, hero: SimEntity, f: FactionState): SimEntity | null {
  for (const id of f.buildings) {
    const b = sim.get(id);
    if (!b?.alive || !b.building?.done || !isTownHall(b)) continue;
    const d = rectDistance(hero.mover.x, hero.mover.y, b.mover.x, b.mover.y, b.building.w, b.building.h) - hero.stats.radius;
    if (d <= USE_RANGE) return b;
  }
  return null;
}

/** Why the server refuses to sell this upgrade now (null = fine). */
export function upgradeProblem(sim: MatchSim, hero: SimEntity, index: number): string | null {
  const id = UPGRADE_IDS[index];
  const f = hero.heroState ? sim.factions?.get(hero.heroState.slot) : null;
  if (!id || !f || f.defeated) return 'upgrade';
  if (!hero.alive) return 'dead';
  if (!hallInRange(sim, hero, f)) return 'range';
  const st = upgradeStatus(id, factionTech(sim, f), hero.heroState!.gold, sim.tick);
  return st.ok ? null : (st.problem ?? 'upgrade');
}

/** Pays and applies an upgrade (already checked with upgradeProblem). */
export function buyUpgrade(sim: MatchSim, hero: SimEntity, index: number): void {
  const id = UPGRADE_IDS[index]!;
  const def = UPGRADES[index]!;
  const f = sim.factions!.get(hero.heroState!.slot)!;
  const level = f.upgrades[id] ?? 0;
  const cost = def.repeatable ? (def.cost[0] ?? 0) : (def.cost[level] ?? 0);
  hero.heroState!.gold -= cost;
  if (def.repeatable) {
    f.upgradeReadyAt[id] = sim.tick + Math.round((def.cooldown ?? 0) * TICK_RATE);
    f.upgrades[id] = level + 1;
  } else f.upgrades[id] = level + 1;
  if (def === FUND) {
    const gold = (FUND.effect as { giveGold?: number[] }).giveGold?.[0] ?? 0;
    f.gold += gold;
    f.earmarkedGold += gold;
    return;
  }
  if (def === WAR_BANNER) {
    const sec = (WAR_BANNER.effect as { duration?: number }).duration ?? 60;
    f.warBannerUntil = sim.tick + Math.round(sec * TICK_RATE);
  }
  refreshFactionStats(sim, f);
}

/** New stats for every unit and building of the faction (upgrades work on living units too). */
export function refreshFactionStats(sim: MatchSim, f: FactionState): void {
  for (const id of f.units) {
    const u = sim.get(id);
    if (u?.alive) sim.applyFactionStats(u);
  }
  for (const id of f.buildings) {
    const b = sim.get(id);
    if (b?.alive) sim.applyFactionStats(b);
  }
}
