// Kingdom orders: the players of a kingdom tell its AI what to do next (attack a kingdom, defend,
// build up the army, farm camps, expand, or let the AI decide). One order per kingdom: in a team
// match both heroes share it and the last order counts. The brain and the kingdom's bot heroes
// follow it. Numbers: ai.json faction.orders. Rules: docs/design/FACTION.md "Kingdom orders".

import type { MatchSim, SimEntity } from '../match-sim';
import type { FactionState } from './faction';

/** In this order on the wire (the command sends the index). */
export const KINGDOM_ORDERS = ['auto', 'attack', 'defend', 'build_up', 'farm', 'expand'] as const;
export type KingdomOrder = (typeof KINGDOM_ORDERS)[number];

/** Short names for the panel and the status line ("Attack" gets the kingdom's color after it). */
export const ORDER_NAMES: Record<KingdomOrder, string> = {
  auto: 'Auto',
  attack: 'Attack',
  defend: 'Defend',
  build_up: 'Build up',
  farm: 'Farm',
  expand: 'Expand',
};

export const KINGDOM_COLOR_NAMES = ['Red', 'Blue', 'Teal', 'Purple'];

/** The kingdom a hero gives orders to (its owner), or null. */
export function kingdomOf(sim: MatchSim, hero: SimEntity): FactionState | null {
  return sim.factions?.get(hero.owner) ?? null;
}

/** Why this order can not be given now, or null. `target` is a kingdom slot (attack only). */
export function kingdomOrderProblem(sim: MatchSim, hero: SimEntity, order: number, target: number): string | null {
  const f = kingdomOf(sim, hero);
  if (!f || f.defeated) return 'No kingdom.';
  const kind = KINGDOM_ORDERS[order];
  if (!kind) return 'Unknown order.';
  if (kind !== 'attack') return null;
  const t = sim.factions?.get(target);
  if (!t || t.defeated) return 'That kingdom is gone.';
  if (t.team === f.team) return 'That kingdom is a friend.';
  return null;
}

export function giveKingdomOrder(sim: MatchSim, hero: SimEntity, order: number, target: number): void {
  const f = kingdomOf(sim, hero);
  if (!f) return;
  f.order = KINGDOM_ORDERS[order] ?? 'auto';
  f.orderTarget = f.order === 'attack' ? target : -1;
  f.orderBy = hero.heroState ? sim.heroes.indexOf(hero) : -1;
}

/** Back to the AI's own choice (the order is done or can not be done). */
export function clearKingdomOrder(f: FactionState): void {
  f.order = 'auto';
  f.orderTarget = -1;
}

/** "Attack Blue", "Defend"... */
export function orderLabel(sim: MatchSim, f: FactionState): string {
  if (f.order !== 'attack') return ORDER_NAMES[f.order];
  const color = sim.factions?.get(f.orderTarget)?.color ?? -1;
  return `Attack ${KINGDOM_COLOR_NAMES[color] ?? 'the enemy'}`;
}
