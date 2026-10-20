// One entity as the client knows it: a short list of motion keys from the server.
// Between two keys we blend; after the last key we keep moving on its velocity for a moment
// (the server only sends a new key when that guess would be wrong).

import { dqFacing, dqPos, dqVel, Field, TICK_DT, type NetEntityState, type NetUpdate } from '@game/shared';
import type { Unit } from '../render/world';

interface Key {
  tick: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number;
  state: number;
}

const MAX_KEYS = 24;
/** Do not guess further than this past the newest snapshot (a stalled connection). */
const MAX_EXTRAPOLATE_TICKS = 10;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export interface Pose {
  x: number;
  y: number;
  facing: number;
  state: number;
}

export class NetEntity {
  readonly id: number;
  readonly type: number;
  readonly owner: number;
  readonly color: number;
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  level: number;
  /** BuffFlag bits */
  buffs: number;
  /** buildings: construction / training / upgrade, 0..255 */
  progress: number;
  unit: Unit | null = null;
  /** for full snapshots: was it in the last one */
  mark = 0;
  private readonly keys: Key[] = [];

  constructor(tick: number, s: NetEntityState) {
    this.id = s.id;
    this.type = s.type;
    this.owner = s.owner;
    this.color = s.color;
    this.hp = s.hp;
    this.maxHp = s.maxHp;
    this.mana = s.mana;
    this.maxMana = s.maxMana;
    this.level = s.level;
    this.buffs = s.buffs;
    this.progress = s.progress;
    this.keys.push({ tick, x: dqPos(s.x), y: dqPos(s.y), vx: dqVel(s.vx), vy: dqVel(s.vy), facing: dqFacing(s.facing), state: s.state });
  }

  get last(): Key {
    return this.keys[this.keys.length - 1]!;
  }

  /** The state byte of the newest key (dead, attacking...). */
  get state(): number {
    return this.last.state;
  }

  apply(tick: number, u: NetUpdate): void {
    let prev = this.last;
    // A new motion after a long quiet time: first add where we guessed it was one tick before,
    // so the blend only covers the last tick (a blink must not slide across the map).
    if (u.mask & Field.Motion && tick - prev.tick > 1) {
      const t = (tick - 1 - prev.tick) * TICK_DT;
      this.keys.push({ ...prev, tick: tick - 1, x: prev.x + prev.vx * t, y: prev.y + prev.vy * t });
      prev = this.last;
    }
    const dt = (tick - prev.tick) * TICK_DT;
    // Fields that did not come stay as the client would guess them.
    const key: Key =
      u.mask & Field.Motion
        ? { tick, x: dqPos(u.x), y: dqPos(u.y), vx: dqVel(u.vx), vy: dqVel(u.vy), facing: prev.facing, state: prev.state }
        : { tick, x: prev.x + prev.vx * dt, y: prev.y + prev.vy * dt, vx: prev.vx, vy: prev.vy, facing: prev.facing, state: prev.state };
    if (u.mask & Field.Facing) key.facing = dqFacing(u.facing);
    if (u.mask & Field.State) key.state = u.state;
    if (u.mask & Field.Hp) this.hp = u.hp;
    if (u.mask & Field.MaxHp) this.maxHp = u.maxHp;
    if (u.mask & Field.Mana) {
      this.mana = u.mana;
      this.maxMana = u.maxMana;
    }
    if (u.mask & Field.Level) this.level = u.level;
    if (u.mask & Field.Buffs) this.buffs = u.buffs;
    if (u.mask & Field.Progress) this.progress = u.progress;
    if (prev.tick === tick) this.keys[this.keys.length - 1] = key;
    else this.keys.push(key);
    if (this.keys.length > MAX_KEYS) this.keys.shift();
  }

  /**
   * Position at a server tick (with fraction). `newest` is the tick of the newest snapshot: no
   * key since then means "still on the same line", but we stop guessing a bit after it.
   */
  sample(t: number, out: Pose, newest = t): Pose {
    const keys = this.keys;
    let i = keys.length - 1;
    while (i > 0 && keys[i]!.tick > t) i--;
    const a = keys[i]!;
    const b = keys[i + 1];
    if (t <= a.tick) {
      out.x = a.x;
      out.y = a.y;
      out.facing = a.facing;
      out.state = a.state;
    } else if (b) {
      const f = (t - a.tick) / (b.tick - a.tick);
      out.x = a.x + (b.x - a.x) * f;
      out.y = a.y + (b.y - a.y) * f;
      out.facing = a.facing + wrap(b.facing - a.facing) * f;
      out.state = a.state;
    } else {
      const dt = (Math.min(t, newest + MAX_EXTRAPOLATE_TICKS) - a.tick) * TICK_DT;
      out.x = a.x + a.vx * dt;
      out.y = a.y + a.vy * dt;
      out.facing = a.facing;
      out.state = a.state;
    }
    // Old keys are no longer needed once we draw past them.
    while (keys.length > 2 && keys[1]!.tick < t - 20) keys.shift();
    return out;
  }
}
