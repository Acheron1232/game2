// Binary match messages: commands (client -> server) and snapshots (server -> client).
//
// Snapshots send motion, not every position: a unit's position plus its velocity. The client
// keeps moving it on that line by itself. The server knows what the client will guess and only
// sends a new update when the guess would be off by more than a small step (start, stop, turn).
// A unit that walks straight costs almost nothing.

import { gameData } from '../data/index';
import { CommandType, type GameCommand } from '../sim/commands';
import { BinaryReader, type BinaryWriter } from './binary';
import { MsgId } from './messages';

const MAP_SIZE = gameData.map.size.width;
const POS_SCALE = 65535 / MAP_SIZE;
/** Velocity steps: 1/2000 unit per second, up to about 16 units per second. */
const VEL_SCALE = 2000;
const TWO_PI = Math.PI * 2;

export const qPos = (v: number) => Math.round(Math.max(0, Math.min(MAP_SIZE, v)) * POS_SCALE);
export const dqPos = (q: number) => q / POS_SCALE;
export const qVel = (v: number) => Math.max(-32767, Math.min(32767, Math.round(v * VEL_SCALE)));
export const dqVel = (q: number) => q / VEL_SCALE;
export const qFacing = (f: number) => Math.round((((f % TWO_PI) + TWO_PI) % TWO_PI) * (256 / TWO_PI)) & 255;
export const dqFacing = (q: number) => {
  const f = (q / 256) * TWO_PI;
  return f > Math.PI ? f - TWO_PI : f;
};

/** Which fields an update carries. */
export const Field = {
  Motion: 1, // x, y (u16), vx, vy (i16)
  Facing: 2, // u8
  State: 4, // u8
  Hp: 8, // u16
  MaxHp: 16, // u16
} as const;

/** Bits of the entity state byte. */
export const UnitState = {
  Moving: 1,
} as const;

export const SnapshotFlag = {
  /** The client must drop every entity that is not in this snapshot (after a rejoin). */
  Full: 1,
} as const;

/** One entity as it is sent: quantized numbers. */
export interface NetEntityState {
  id: number;
  type: number;
  owner: number;
  color: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number;
  state: number;
  hp: number;
  maxHp: number;
}

export interface NetUpdate extends NetEntityState {
  mask: number;
}

// ---------- commands ----------

export function writeCommand(w: BinaryWriter, seq: number, cmd: GameCommand): Uint8Array<ArrayBuffer> {
  w.reset()
    .u8(MsgId.Command)
    .u16(seq & 0xffff)
    .u8(cmd.type);
  if (cmd.type === CommandType.Move)
    w.u16(qPos(cmd.x))
      .u16(qPos(cmd.y))
      .u8(cmd.queue ? 1 : 0);
  return w.bytes();
}

/** Reads a command after its message id. Returns null for an unknown command type. */
export function readCommand(r: BinaryReader): { seq: number; cmd: GameCommand } | null {
  const seq = r.u16();
  const type = r.u8();
  if (type === CommandType.Move) return { seq, cmd: { type, x: dqPos(r.u16()), y: dqPos(r.u16()), queue: (r.u8() & 1) === 1 } };
  if (type === CommandType.Stop) return { seq, cmd: { type } };
  return null;
}

/** Rounds a target point the same way the network does, so prediction plans the same path. */
export function quantizePoint(x: number, y: number): [number, number] {
  return [dqPos(qPos(x)), dqPos(qPos(y))];
}

// ---------- snapshots ----------

/** Builds one snapshot. Call begin, then spawn/update/gone in any order, then finish. */
export class SnapshotWriter {
  private spawns: NetEntityState[] = [];
  private updates: NetUpdate[] = [];
  private gone: number[] = [];
  private nSpawn = 0;
  private nUpdate = 0;
  private nGone = 0;
  private head = { tick: 0, ack: 0, sinceAck: 0, flags: 0 };

  begin(tick: number, ackSeq: number, ticksSinceAck: number, flags = 0): void {
    this.head.tick = tick;
    this.head.ack = ackSeq;
    this.head.sinceAck = Math.min(65535, ticksSinceAck);
    this.head.flags = flags;
    this.nSpawn = this.nUpdate = this.nGone = 0;
  }

  spawn(s: NetEntityState): void {
    const t = (this.spawns[this.nSpawn++] ??= blank());
    Object.assign(t, s);
  }

  update(u: NetUpdate): void {
    const t = (this.updates[this.nUpdate++] ??= { ...blank(), mask: 0 });
    Object.assign(t, u);
  }

  remove(id: number): void {
    this.gone[this.nGone++] = id;
  }

  get empty(): boolean {
    return this.nSpawn + this.nUpdate + this.nGone === 0;
  }

  finish(w: BinaryWriter): Uint8Array<ArrayBuffer> {
    w.reset()
      .u8(MsgId.Snapshot)
      .u32(this.head.tick)
      .u16(this.head.ack & 0xffff)
      .u16(this.head.sinceAck)
      .u8(this.head.flags);
    w.u16(this.nSpawn);
    for (let i = 0; i < this.nSpawn; i++) {
      const s = this.spawns[i]!;
      w.u16(s.id).u16(s.type).u8(s.owner).u8(s.color).u16(s.x).u16(s.y).i16(s.vx).i16(s.vy).u8(s.facing).u8(s.state).u16(s.hp).u16(s.maxHp);
    }
    w.u16(this.nUpdate);
    for (let i = 0; i < this.nUpdate; i++) {
      const u = this.updates[i]!;
      w.u16(u.id).u8(u.mask);
      if (u.mask & Field.Motion) w.u16(u.x).u16(u.y).i16(u.vx).i16(u.vy);
      if (u.mask & Field.Facing) w.u8(u.facing);
      if (u.mask & Field.State) w.u8(u.state);
      if (u.mask & Field.Hp) w.u16(u.hp);
      if (u.mask & Field.MaxHp) w.u16(u.maxHp);
    }
    w.u16(this.nGone);
    for (let i = 0; i < this.nGone; i++) w.u16(this.gone[i]!);
    return w.bytes();
  }
}

function blank(): NetEntityState {
  return { id: 0, type: 0, owner: 0, color: 0, x: 0, y: 0, vx: 0, vy: 0, facing: 0, state: 0, hp: 0, maxHp: 0 };
}

/** A read snapshot. The arrays are reused between reads: copy what you keep. */
export class SnapshotData {
  tick = 0;
  ackSeq = 0;
  ticksSinceAck = 0;
  flags = 0;
  spawnCount = 0;
  updateCount = 0;
  goneCount = 0;
  readonly spawns: NetEntityState[] = [];
  readonly updates: NetUpdate[] = [];
  readonly gone: number[] = [];

  /** Reads a snapshot after its message id. */
  read(r: BinaryReader): this {
    this.tick = r.u32();
    this.ackSeq = r.u16();
    this.ticksSinceAck = r.u16();
    this.flags = r.u8();
    this.spawnCount = r.u16();
    for (let i = 0; i < this.spawnCount; i++) {
      const s = (this.spawns[i] ??= blank());
      s.id = r.u16();
      s.type = r.u16();
      s.owner = r.u8();
      s.color = r.u8();
      s.x = r.u16();
      s.y = r.u16();
      s.vx = r.i16();
      s.vy = r.i16();
      s.facing = r.u8();
      s.state = r.u8();
      s.hp = r.u16();
      s.maxHp = r.u16();
    }
    this.updateCount = r.u16();
    for (let i = 0; i < this.updateCount; i++) {
      const u = (this.updates[i] ??= { ...blank(), mask: 0 });
      u.id = r.u16();
      u.mask = r.u8();
      if (u.mask & Field.Motion) {
        u.x = r.u16();
        u.y = r.u16();
        u.vx = r.i16();
        u.vy = r.i16();
      }
      if (u.mask & Field.Facing) u.facing = r.u8();
      if (u.mask & Field.State) u.state = r.u8();
      if (u.mask & Field.Hp) u.hp = r.u16();
      if (u.mask & Field.MaxHp) u.maxHp = r.u16();
    }
    this.goneCount = r.u16();
    for (let i = 0; i < this.goneCount; i++) this.gone[i] = r.u16();
    return this;
  }
}

export function readSnapshot(data: ArrayBuffer | Uint8Array, out: SnapshotData): SnapshotData {
  const r = new BinaryReader(data);
  if (r.u8() !== MsgId.Snapshot) throw new Error('Not a snapshot');
  return out.read(r);
}
