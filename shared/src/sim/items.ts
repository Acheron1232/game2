// Items: the inventory, shops, item stats and passives, item actives (keys 1-6), items on the
// ground and camp drops. Numbers come from items.json, shops.json, camps.json and rules.json;
// this file only says what each kind of item does with them.

import { gameData, type ItemDef, type ItemStatKey } from '../data/index';
import { qPos } from '../protocol/game';
import type { CastTarget } from './abilities';
import { BuffFlag } from './buffs';
import type { CampState } from './camps';
import { CommandType, type GameCommand } from './commands';
import { entityTypeIndex } from './entity-types';
import { DamageKind, EventType, NoticeCode } from './events';
import { TICK_RATE, type DamageSource, type HeroState, type MatchSim, type SimEntity } from './match-sim';
import { unitStats } from './stats';

export const ITEMS: readonly ItemDef[] = gameData.items;
const INDEX = new Map(ITEMS.map((it, i) => [it.id, i]));
export const INVENTORY_SIZE = gameData.rules.heroBase.itemSlots;
const IR = gameData.rules.items;
const SELL_FACTOR = gameData.rules.gold.sellFactor;
const secs = (s: number) => Math.round(s * TICK_RATE);
/** Ground item ids are u16 on the wire; 0 means none. */
const MAX_GROUND_ID = 0xffff;

export function itemIndex(id: string): number {
  return INDEX.get(id) ?? -1;
}

/** One inventory slot. Items without charges (boots, rings...) have charges 0. */
export interface ItemStack {
  item: number;
  charges: number;
}

export interface GroundItem {
  id: number;
  item: number;
  charges: number;
  x: number;
  y: number;
  /** tick it vanishes */
  until: number;
}

/**
 * An item order that needs a walk first (a ward on a point, pick up, give, drop) or a channel
 * (Scroll of Return). Instant items (potions, tome, smoke) do not stop the current order.
 */
export interface ItemOrder {
  kind: 'use' | 'pickUp' | 'give' | 'drop';
  /** inventory slot (use, give, drop) */
  slot: number;
  /** use: the target; give: kind 1 + hero id; drop: kind 2 + point; pickUp: id = ground item id */
  target: CastTarget;
  /** Scroll of Return: tick the channel ends, 0 = not channeling */
  channelEnd: number;
}

export function emptyInventory(): (ItemStack | null)[] {
  return Array.from({ length: INVENTORY_SIZE }, () => null);
}

// ---------- stats and passives ----------

/** Stat bonus of all carried items. A `unique` item counts once, even if there are two. */
export function itemBonus(inv: readonly (ItemStack | null)[]): Partial<Record<ItemStatKey, number>> {
  const out: Partial<Record<ItemStatKey, number>> = {};
  const seen = new Set<number>();
  for (const st of inv) {
    if (!st) continue;
    const def = ITEMS[st.item]!;
    if (!def.stats) continue;
    if (def.unique) {
      if (seen.has(st.item)) continue;
      seen.add(st.item);
    }
    for (const [k, v] of Object.entries(def.stats) as [ItemStatKey, number][]) out[k] = (out[k] ?? 0) + v;
  }
  return out;
}

const CAPS = gameData.rules.items.caps as Partial<Record<ItemStatKey, number>>;

/** An item stat of a hero with its cap (rules.json items.caps): spell damage, cooldown cut... */
export function itemStat(hs: { bonus: Partial<Record<ItemStatKey, number>> }, key: ItemStatKey): number {
  return Math.min(CAPS[key] ?? Infinity, hs.bonus[key] ?? 0);
}

/** Items with an on-hit effect (Frost Orb, Storm Hammer). Unique: one of each counts. */
function onHitItems(inv: readonly (ItemStack | null)[]): ItemDef[] {
  const out: ItemDef[] = [];
  for (const st of inv) {
    const def = st ? ITEMS[st.item]! : undefined;
    if (def?.onHit && !out.includes(def)) out.push(def);
  }
  return out;
}

/** After an attack landed: slows and lightning from items. `dealt` > 0 means it hit. */
export function itemsOnHit(sim: MatchSim, s: SimEntity, t: SimEntity): void {
  const inv = s.heroState?.inventory;
  if (!inv) return;
  for (const def of onHitItems(inv)) {
    const h = def.onHit!;
    if (h.slowPct && t.alive && t.team !== s.team) {
      sim.addBuff(t, {
        id: `item:${def.id}`,
        sourceId: s.id,
        sourceOwner: s.owner,
        sourceTeam: s.team,
        until: sim.tick + secs(h.duration ?? 1),
        flags: BuffFlag.Slow,
        slowPct: h.slowPct,
      });
    }
    if (h.chainDamage && sim.rng.next() * 100 < (h.chancePct ?? 100)) chainLightning(sim, s, t, def);
  }
}

/** Lightning that hits the target and jumps to the nearest enemy not hit yet, up to N enemies. */
function chainLightning(sim: MatchSim, s: SimEntity, first: SimEntity, def: ItemDef): void {
  const h = def.onHit!;
  const source: DamageSource = { id: s.id, owner: s.owner, team: s.team };
  const hit = new Set<number>();
  let from: SimEntity = s;
  let cur: SimEntity | null = first;
  while (cur && hit.size < (h.chainTargets ?? 1)) {
    hit.add(cur.id);
    sim.events.push(EventType.Chain, from.id, cur.id);
    sim.spellHit(cur, h.chainDamage ?? 0, source);
    from = cur;
    let next: SimEntity | null = null,
      bestD = Infinity;
    sim.grid.query(from.mover.x, from.mover.y, h.chainRange ?? 5, (o, d2) => {
      if (!o.alive || o.team === s.team || hit.has(o.id) || o.inert || sim.isHiddenFrom(o, s.team)) return;
      if (d2 < bestD) {
        bestD = d2;
        next = o;
      }
    });
    cur = next;
  }
}

/** Phoenix Feather: takes the first revive item out of the inventory (it is used up). */
export function takeRevive(hs: HeroState): NonNullable<ItemDef['passive']> | null {
  const slot = hs.inventory.findIndex((st) => !!st && !!ITEMS[st.item]!.passive?.reviveOnDeath);
  if (slot < 0) return null;
  const p = ITEMS[hs.inventory[slot]!.item]!.passive!;
  if (p.consumed) hs.inventory[slot] = null;
  return p;
}

// ---------- inventory ----------

/** Puts an item into the inventory: first onto stacks of the same item, then into free slots. */
export function storeItem(inv: (ItemStack | null)[], item: number, charges: number, dryRun = false): boolean {
  const def = ITEMS[item]!;
  if (!def.charges) {
    const free = inv.indexOf(null);
    if (free < 0) return false;
    if (!dryRun) inv[free] = { item, charges: 0 };
    return true;
  }
  const max = Math.max(1, def.stackMax ?? 1);
  let left = charges;
  const plan: [number, number][] = [];
  inv.forEach((st, i) => {
    if (left > 0 && st && st.item === item && st.charges < max) {
      const add = Math.min(max - st.charges, left);
      plan.push([i, st.charges + add]);
      left -= add;
    }
  });
  inv.forEach((st, i) => {
    if (left > 0 && !st) {
      const add = Math.min(max, left);
      plan.push([i, add]);
      left -= add;
    }
  });
  if (left > 0) return false;
  if (!dryRun) for (const [i, c] of plan) inv[i] = { item, charges: c };
  return true;
}

export function canStore(inv: (ItemStack | null)[], item: number, charges: number): boolean {
  return storeItem(inv, item, charges, true);
}

// ---------- recipes ----------

export interface BuyPlan {
  /** gold to pay */
  price: number;
  /** inventory slots whose items go into the new one */
  uses: number[];
}

/**
 * What buying an item costs with the parts the hero carries. A recipe uses carried parts (and
 * the parts of missing parts, all the way down); the rest is bought with gold at shop price.
 */
export function buyPlan(inv: readonly (ItemStack | null)[], item: number): BuyPlan {
  const uses: number[] = [];
  const need = (id: number, top: boolean): number => {
    const def = ITEMS[id]!;
    if (!top) {
      const slot = inv.findIndex((st, i) => st?.item === id && !uses.includes(i));
      if (slot >= 0) {
        uses.push(slot);
        return 0;
      }
    }
    if (!def.recipe) return def.cost ?? 0;
    return def.recipe.fee + def.recipe.components.reduce((sum, c) => sum + need(itemIndex(c), false), 0);
  };
  const price = need(item, true);
  return { price, uses };
}

/** Would the new item fit once its parts are taken out? */
export function canStoreAfter(inv: readonly (ItemStack | null)[], plan: BuyPlan, item: number): boolean {
  const left = inv.map((st, i) => (plan.uses.includes(i) ? null : st));
  return storeItem(left, item, newCharges(item), true);
}

/** Gold for selling a stack: half the value, for the charges that are left. */
export function sellValue(st: ItemStack): number {
  const def = ITEMS[st.item]!;
  const share = def.charges ? st.charges / def.charges : 1;
  return Math.floor(def.value * SELL_FACTOR * share);
}

/** What a stack of this item holds when it is new (bought or dropped by a camp). */
export function newCharges(item: number): number {
  return ITEMS[item]!.charges ?? 0;
}

/** A shop on the map in range of the hero that sells this item (any shop when item < 0). */
export function shopInRange(e: SimEntity, item = -1): { x: number; y: number; type: string } | null {
  for (const s of gameData.map.shops) {
    const shop = gameData.shops.find((d) => d.id === s.type);
    if (!shop) continue;
    if (Math.hypot(s.pos[0] - e.mover.x, s.pos[1] - e.mover.y) > shop.useRange) continue;
    if (item >= 0 && !shop.items.includes(ITEMS[item]!.id)) continue;
    return { x: s.pos[0], y: s.pos[1], type: s.type };
  }
  return null;
}

function cooldownGroup(def: ItemDef): string {
  return def.active?.cooldownGroup ?? def.id;
}

/** Tick the item in this slot can be used again (0 = ready). */
export function itemReadyAt(hs: HeroState, slot: number, now: number): number {
  const st = hs.inventory[slot];
  if (!st) return 0;
  const t = hs.itemCooldowns.get(cooldownGroup(ITEMS[st.item]!)) ?? 0;
  return t > now ? t : 0;
}

// ---------- commands ----------

export function isItemCommand(cmd: GameCommand): boolean {
  return cmd.type >= CommandType.UseItem && cmd.type <= CommandType.SwapItems;
}

/** Commands that act at once and do not change what the hero is doing. */
export function isInstantItemCommand(e: SimEntity, cmd: GameCommand): boolean {
  switch (cmd.type) {
    case CommandType.BuyItem:
    case CommandType.SellItem:
    case CommandType.SwapItems:
      return true;
    case CommandType.UseItem: {
      const st = e.heroState?.inventory[cmd.slot];
      const a = st ? ITEMS[st.item]!.active : undefined;
      return !!a && a.target === 'none' && !a.channelTime;
    }
  }
  return false;
}

const inSlot = (n: number) => Number.isInteger(n) && n >= 0 && n < INVENTORY_SIZE;
const inMap = (sim: MatchSim, x: number, y: number) =>
  Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x <= sim.size && y <= sim.size;

/** Why the server refuses an item command (null = fine). Checked when it comes in. */
export function itemCommandProblem(sim: MatchSim, e: SimEntity, cmd: GameCommand): string | null {
  const hs = e.heroState;
  if (!hs) return 'no hero';
  if (cmd.type === CommandType.SwapItems) return inSlot(cmd.from) && inSlot(cmd.to) && cmd.from !== cmd.to ? null : 'slot';
  if (!e.alive) return 'dead';
  switch (cmd.type) {
    case CommandType.UseItem:
      return useProblem(sim, e, cmd.slot, { kind: cmd.target, id: cmd.id, x: cmd.x, y: cmd.y });
    case CommandType.BuyItem: {
      const def = ITEMS[cmd.item];
      if (!def || def.cost === null) return 'item';
      if (!shopInRange(e, cmd.item)) return 'range';
      const plan = buyPlan(hs.inventory, cmd.item);
      if (hs.gold < plan.price) return 'gold';
      return canStoreAfter(hs.inventory, plan, cmd.item) ? null : 'full';
    }
    case CommandType.SellItem:
      if (!inSlot(cmd.slot) || !hs.inventory[cmd.slot]) return 'slot';
      return shopInRange(e) ? null : 'range';
    case CommandType.DropItem:
      if (!inSlot(cmd.slot) || !hs.inventory[cmd.slot]) return 'slot';
      return inMap(sim, cmd.x, cmd.y) ? null : 'target';
    case CommandType.PickUp: {
      const g = sim.groundItem(cmd.id);
      return g && sim.canSeePoint(e.team, g.x, g.y) ? null : 'target';
    }
    case CommandType.GiveItem: {
      if (!inSlot(cmd.slot) || !hs.inventory[cmd.slot]) return 'slot';
      const t = sim.get(cmd.target);
      return t?.heroState && t.alive && t !== e && t.team === e.team ? null : 'target';
    }
  }
  return 'command';
}

/** Can the item in this slot be used on this target now? Same checks when it is ordered and when it fires. */
export function useProblem(sim: MatchSim, e: SimEntity, slot: number, target: CastTarget): string | null {
  const hs = e.heroState;
  if (!hs || !inSlot(slot)) return 'slot';
  const st = hs.inventory[slot];
  if (!st) return 'slot';
  const a = ITEMS[st.item]!.active;
  if (!a) return 'passive';
  if (!e.alive) return 'dead';
  if (sim.isStunned(e) || e.forced) return 'stunned';
  if (itemReadyAt(hs, slot, sim.tick)) return 'cooldown';
  if (a.target === 'point' && (target.kind !== 2 || !inMap(sim, target.x, target.y))) return 'target';
  if (a.target === 'unit') {
    const t = target.kind === 1 ? sim.get(target.id) : undefined;
    if (!t || !t.alive || !sim.canSee(e.team, t)) return 'target';
  }
  return null;
}

/** Buy, sell, swap and instant items (already checked). */
export function runInstantItemCommand(sim: MatchSim, e: SimEntity, cmd: GameCommand): void {
  const hs = e.heroState!;
  switch (cmd.type) {
    case CommandType.BuyItem: {
      // A recipe takes the parts out first; they make room for the new item.
      const plan = buyPlan(hs.inventory, cmd.item);
      for (const slot of plan.uses) hs.inventory[slot] = null;
      hs.gold -= plan.price;
      storeItem(hs.inventory, cmd.item, newCharges(cmd.item));
      break;
    }
    case CommandType.SellItem: {
      const st = hs.inventory[cmd.slot]!;
      hs.inventory[cmd.slot] = null;
      sim.addGold(e, sellValue(st), e);
      break;
    }
    case CommandType.SwapItems: {
      const a = hs.inventory[cmd.from] ?? null;
      hs.inventory[cmd.from] = hs.inventory[cmd.to] ?? null;
      hs.inventory[cmd.to] = a;
      // Same item on both sides: join the stacks.
      const b = hs.inventory[cmd.from];
      if (a && b && a.item === b.item && ITEMS[a.item]!.charges) {
        const max = ITEMS[a.item]!.stackMax ?? 1;
        const move = Math.min(max - a.charges, b.charges);
        a.charges += move;
        b.charges -= move;
        if (b.charges <= 0) hs.inventory[cmd.from] = null;
      }
      return; // the stats do not change
    }
    case CommandType.UseItem:
      useNow(sim, e, cmd.slot, { kind: 0, id: 0, x: 0, y: 0 });
      return;
  }
  sim.refreshStats(e);
}

/** An item order that needs a walk or a channel (already checked). */
export function orderItem(sim: MatchSim, e: SimEntity, cmd: GameCommand): void {
  let order: ItemOrder | null = null;
  const none: CastTarget = { kind: 0, id: 0, x: 0, y: 0 };
  switch (cmd.type) {
    case CommandType.UseItem:
      order = { kind: 'use', slot: cmd.slot, target: { kind: cmd.target, id: cmd.id, x: cmd.x, y: cmd.y }, channelEnd: 0 };
      break;
    case CommandType.PickUp:
      order = { kind: 'pickUp', slot: -1, target: { ...none, id: cmd.id }, channelEnd: 0 };
      break;
    case CommandType.GiveItem:
      order = { kind: 'give', slot: cmd.slot, target: { ...none, kind: 1, id: cmd.target }, channelEnd: 0 };
      break;
    case CommandType.DropItem:
      order = { kind: 'drop', slot: cmd.slot, target: { kind: 2, id: 0, x: cmd.x, y: cmd.y }, channelEnd: 0 };
      break;
  }
  if (!order) return;
  e.order = 'item';
  e.targetId = 0;
  e.swing = 0;
  e.itemOrder = order;
}

/** Every tick for a hero with an item order: walk, then act (or channel). */
export function updateItemOrder(sim: MatchSim, e: SimEntity): void {
  const o = e.itemOrder;
  const hs = e.heroState;
  if (!o || !hs) return endItemOrder(sim, e);
  if (o.channelEnd) {
    if (sim.tick < o.channelEnd) return;
    if (useProblem(sim, e, o.slot, o.target)) return endItemOrder(sim, e);
    useNow(sim, e, o.slot, o.target);
    return endItemOrder(sim, e);
  }
  // Where to go and how close is close enough.
  let tx = o.target.x,
    ty = o.target.y,
    reach: number;
  if (o.kind === 'use') {
    if (useProblem(sim, e, o.slot, o.target)) return endItemOrder(sim, e);
    const a = ITEMS[hs.inventory[o.slot]!.item]!.active!;
    const t = o.target.kind === 1 ? sim.get(o.target.id) : undefined;
    if (t) [tx, ty] = [t.mover.x, t.mover.y];
    reach = o.target.kind === 0 ? Infinity : (a.castRange ?? 0) + (t ? e.stats.radius + t.stats.radius : 0);
  } else if (o.kind === 'pickUp') {
    const g = sim.groundItem(o.target.id);
    if (!g) return endItemOrder(sim, e);
    [tx, ty] = [g.x, g.y];
    reach = IR.pickUpRange;
  } else if (o.kind === 'give') {
    const t = sim.get(o.target.id);
    if (!t?.alive || !hs.inventory[o.slot]) return endItemOrder(sim, e);
    [tx, ty] = [t.mover.x, t.mover.y];
    reach = IR.giveRange + e.stats.radius + t.stats.radius;
  } else {
    if (!hs.inventory[o.slot]) return endItemOrder(sim, e);
    reach = IR.pickUpRange;
  }
  const d = Math.hypot(tx - e.mover.x, ty - e.mover.y);
  if (d > reach) {
    if (sim.tick >= e.repathAt || !e.mover.path.length) {
      e.repathAt = sim.tick + 10;
      sim.moveTo(e, tx, ty);
    }
    return;
  }
  e.mover.path = [];
  switch (o.kind) {
    case 'use': {
      const a = ITEMS[hs.inventory[o.slot]!.item]!.active!;
      if (o.target.kind !== 0 && d > 0.01) e.mover.facing = Math.atan2(-(tx - e.mover.x), ty - e.mover.y);
      if (a.channelTime) {
        o.channelEnd = sim.tick + Math.max(1, secs(a.channelTime));
        sim.addBuff(e, {
          id: 'item_channel',
          sourceId: e.id,
          sourceOwner: e.owner,
          sourceTeam: e.team,
          until: o.channelEnd + 1,
          flags: BuffFlag.Channel,
        });
        return;
      }
      useNow(sim, e, o.slot, o.target);
      break;
    }
    case 'pickUp': {
      const g = sim.groundItem(o.target.id)!;
      if (storeItem(hs.inventory, g.item, g.charges)) {
        sim.removeGroundItem(g.id);
        sim.refreshStats(e);
      } else sim.events.push(EventType.Notice, e.id, 0, NoticeCode.InventoryFull);
      break;
    }
    case 'give': {
      const t = sim.get(o.target.id)!;
      const st = hs.inventory[o.slot]!;
      if (storeItem(t.heroState!.inventory, st.item, st.charges)) {
        hs.inventory[o.slot] = null;
        sim.refreshStats(e);
        sim.refreshStats(t);
      } else sim.events.push(EventType.Notice, e.id, 0, NoticeCode.AllyFull);
      break;
    }
    case 'drop': {
      const st = hs.inventory[o.slot]!;
      hs.inventory[o.slot] = null;
      sim.dropOnGround(st.item, st.charges, tx, ty);
      sim.refreshStats(e);
      break;
    }
  }
  endItemOrder(sim, e);
}

export function endItemOrder(sim: MatchSim, e: SimEntity): void {
  if (e.itemOrder?.channelEnd) {
    sim.events.push(EventType.ChannelEnd, e.id);
    sim.removeBuff(e, 'item_channel', e.id);
  }
  e.itemOrder = null;
  if (e.order === 'item') e.order = 'idle';
}

/** The effect of an active item: pay a charge, start the cooldown, do it. */
function useNow(sim: MatchSim, e: SimEntity, slot: number, target: CastTarget): void {
  const hs = e.heroState!;
  const st = hs.inventory[slot]!;
  const def = ITEMS[st.item]!;
  const a = def.active!;
  // Using an item ends Smoke Bomb (and a new Smoke Bomb starts after that).
  sim.breakInvisible(e);
  if (a.cooldown > 0) hs.itemCooldowns.set(cooldownGroup(def), sim.tick + secs(a.cooldown));
  if (def.charges) {
    st.charges--;
    if (st.charges <= 0) hs.inventory[slot] = null;
  }
  const self: DamageSource = { id: e.id, owner: e.owner, team: e.team };
  let px = e.mover.x,
    py = e.mover.y;
  if (a.heal) sim.heal(e, a.heal, self);
  if (a.restoreMana) {
    const before = e.mana;
    e.mana = Math.min(e.stats.maxMana, e.mana + a.restoreMana);
    if (e.mana - before >= 0.5) sim.events.push(EventType.Damage, e.id, e.id, Math.round(e.mana - before), DamageKind.Mana);
  }
  if (a.gainXp) sim.addXp(e, a.gainXp);
  if (a.teleportTo === 'own_town_hall') {
    [px, py] = hs.home;
    sim.teleport(e, px, py);
  }
  if (a.target === 'point' && a.sight) {
    // Watcher Ward: an invisible eye on the ground.
    [px, py] = [target.x, target.y];
    placeWard(sim, e, px, py, a.sight, a.duration ?? 60);
  } else if (a.invisible && a.duration) {
    sim.addBuff(e, {
      id: `item:${def.id}`,
      sourceId: e.id,
      sourceOwner: e.owner,
      sourceTeam: e.team,
      until: sim.tick + secs(a.duration),
      flags: BuffFlag.Invisible,
      invisible: true,
      breaksOnAct: true,
    });
  }
  sim.events.push(EventType.ItemUse, e.id, qPos(px), qPos(py), st.item);
  if (!hs.inventory[slot] || def.stats) sim.refreshStats(e);
}

const WARD_TYPE = entityTypeIndex('watcher_ward');
const WARD_DEF = gameData.units.find((u) => u.id === 'watcher_ward')!;

function placeWard(sim: MatchSim, e: SimEntity, x: number, y: number, sight: number, seconds: number): void {
  const w = sim.spawn(WARD_TYPE, e.owner, e.team, e.color, x, y, 0);
  const base = unitStats(WARD_DEF);
  base.sight = sight;
  w.base = w.stats = base;
  w.inert = true;
  w.summonUntil = sim.tick + secs(seconds);
  sim.addBuff(w, {
    id: 'ward',
    sourceId: e.id,
    sourceOwner: e.owner,
    sourceTeam: e.team,
    until: Infinity,
    flags: BuffFlag.Invisible,
    invisible: true,
  });
}

// ---------- camp drops ----------

/** One roll on the camp's drop table when the whole camp is dead. */
export function rollCampDrop(sim: MatchSim, camp: CampState): void {
  const type = gameData.camps.campTypes.find((t) => t.id === camp.type);
  const table = type ? gameData.camps.dropTables[type.dropTable] : undefined;
  if (!table) return;
  const item = rollDropTable(sim, table);
  if (item >= 0) sim.dropOnGround(item, newCharges(item), camp.lastDeathX, camp.lastDeathY);
}

/** Item index from a drop table, or -1 when nothing drops. */
export function rollDropTable(sim: MatchSim, table: { dropChancePct: number; items: [string, number][] }): number {
  if (sim.rng.next() * 100 >= table.dropChancePct) return -1;
  let total = 0;
  for (const [, w] of table.items) total += w;
  let r = sim.rng.next() * total;
  for (const [id, w] of table.items) {
    r -= w;
    if (r < 0) return itemIndex(id);
  }
  return itemIndex(table.items[table.items.length - 1]![0]);
}

export function nextGroundId(prev: number): number {
  return (prev % MAX_GROUND_ID) + 1;
}

export const GROUND_ITEM_TICKS = secs(IR.groundItemSec);
