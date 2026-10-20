// One-time things that happened in a tick (an attack swing, a hit, a death...). The client uses
// them for animations, projectiles, damage numbers and sounds. They are reused every tick.

export const EventType = {
  /** a = attacker, b = target: start of the attack swing */
  Attack: 1,
  /** a = source, b = target, value = speed, kind = projectile id (for the client to match it) */
  Projectile: 2,
  /** a = target, b = source, value = amount, kind = DamageKind */
  Damage: 3,
  /** a = who died, b = killer */
  Death: 4,
  /** a = where (entity), value = gold, kind = slot that got it */
  Gold: 5,
  /** a = hero, value = new level */
  LevelUp: 6,
  /** a = hero */
  Respawn: 7,
  /** a = caster; kind = ability index (| 128 for a point: b, value = x, y quantized; else b = target id). 255 = monster skill */
  Cast: 8,
  /** a = caster, b/value = point (quantized), kind = packed ability index and level: jump, blink, dive */
  Impact: 9,
  /** a = caster: its channel stopped */
  ChannelEnd: 10,
  /** a = caster, b/value = end point (quantized), kind = ability index; speed is in the data */
  LineShot: 11,
  /** A paid, completed cast. Same target as Cast; kind packs index (5 bits), level-1 (2), point (1). */
  AbilityEffect: 12,
  /** a = tree index: it fell (its walk cells open) */
  TreeGone: 13,
  /** a = worker, b = tree index: a chop starts */
  Chop: 14,
  /** a = new unit, b = building that trained it */
  Trained: 15,
  /** a = building that reached the next tier */
  Upgraded: 16,
  /** a = slot of the faction that lost */
  Defeated: 17,
  /** a = winner team */
  MatchOver: 18,
  /** a = from, b = to: a lightning jump (Storm Hammer) */
  Chain: 19,
  /** a = hero, b/value = point (quantized), kind = item index: an item was used (or a ward placed) */
  ItemUse: 20,
  /** a = hero, value = NoticeCode: a message only for the hero's player */
  Notice: 21,
} as const;
export type EventType = (typeof EventType)[keyof typeof EventType];

/** All 32 current hero abilities fit in five bits; levels use the next two bits. */
export const abilityFxKind = (index: number, level: number, point = false) => index | ((level - 1) << 5) | (point ? 128 : 0);

export const DamageKind = {
  Attack: 0,
  Spell: 1,
  Heal: 2,
  /** an attack up a hill that missed (value 0) */
  Miss: 3,
  /** mana given back (Mana Potion) */
  Mana: 4,
} as const;

/** Why an order did nothing, for the player's alert. */
export const NoticeCode = {
  InventoryFull: 1,
  /** the ally has no room for the item */
  AllyFull: 2,
} as const;

export interface SimEvent {
  type: EventType;
  a: number;
  b: number;
  value: number;
  kind: number;
}

export class EventList {
  readonly items: SimEvent[] = [];
  count = 0;

  push(type: EventType, a: number, b = 0, value = 0, kind = 0): void {
    const e = (this.items[this.count++] ??= { type, a, b, value, kind });
    e.type = type;
    e.a = a;
    e.b = b;
    e.value = value;
    e.kind = kind;
  }

  clear(): void {
    this.count = 0;
  }
}
