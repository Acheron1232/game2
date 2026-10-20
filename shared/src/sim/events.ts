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
  /** a = caster, b/value = point (quantized), kind = ability index: a jump lands, a blink, a dive */
  Impact: 9,
  /** a = caster: its channel stopped */
  ChannelEnd: 10,
  /** a = caster, b/value = end point (quantized), kind = ability index; speed is in the data */
  LineShot: 11,
} as const;
export type EventType = (typeof EventType)[keyof typeof EventType];

export const DamageKind = {
  Attack: 0,
  Spell: 1,
  Heal: 2,
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
