// Binary match messages: commands (client -> server) and snapshots (server -> client).
//
// Snapshots send motion, not every position: a unit's position plus its velocity. The client
// keeps moving it on that line by itself. The server knows what the client will guess and only
// sends a new update when the guess would be off by more than a small step (start, stop, turn).
// A unit that walks straight costs almost nothing.
//
// Snapshot layout:
//   u8 id, u32 tick, u16 ackSeq, u16 predictionSeq, u16 ticksSinceAck, u8 flags
//   [player state, if flags & HasPlayer]   [faction state, if flags & HasFaction]
//   u16 spawns, spawns...   u16 updates, updates...   u16 gone, ids...   u16 events, events...
//   [if flags & HasItems: u8 item spawns, spawns...   u8 items gone, ids...]  (items on the ground)

import { gameData } from '../data/index';
import { CommandType, type GameCommand } from '../sim/commands';
import { BinaryReader, type BinaryWriter } from './binary';
import { MsgId } from './messages';
import { dqPos, qPos } from '../map/coordinates';
export { dqPos, qPos, quantizePoint } from '../map/coordinates';

/** Velocity steps: 1/2000 unit per second, up to about 16 units per second. */
const VEL_SCALE = 2000;
const TWO_PI = Math.PI * 2;

export const qVel = (v: number) => Math.max(-32767, Math.min(32767, Math.round(v * VEL_SCALE)));
export const dqVel = (q: number) => q / VEL_SCALE;
export const qFacing = (f: number) => Math.round((((f % TWO_PI) + TWO_PI) % TWO_PI) * (256 / TWO_PI)) & 255;
export const dqFacing = (q: number) => {
  const f = (q / 256) * TWO_PI;
  return f > Math.PI ? f - TWO_PI : f;
};
/** Health and mana go as whole numbers; a living unit never shows 0. */
export const qHp = (hp: number, alive: boolean) => Math.min(65535, alive ? Math.max(1, Math.ceil(hp)) : 0);

/** Which fields an update carries. */
export const Field = {
  Motion: 1, // x, y (u16), vx, vy (i16)
  Facing: 2, // u8
  State: 4, // u8
  Hp: 8, // u16
  MaxHp: 16, // u16
  Mana: 32, // mana u16, max mana u16
  Level: 64, // u8
  Buffs: 128, // u16 BuffFlag bits
  Progress: 256, // u8: construction, training or tier upgrade, 0..255
} as const;

/** Bits of the entity state byte. */
export const UnitState = {
  Moving: 1,
  /** in an attack wind-up (play the attack animation) */
  Attacking: 2,
  Dead: 4,
  /** the unit follows a server order (attack, chase, hold): do not predict it */
  ServerDriven: 8,
  /** a building site, not finished yet */
  Constructing: 16,
  /** a worker inside a gold mine: do not draw it */
  Hidden: 32,
  CarryGold: 64,
  CarryWood: 128,
} as const;

export const SnapshotFlag = {
  /** The client must drop every entity that is not in this snapshot (after a rejoin). */
  Full: 1,
  /** A player state block follows the header. */
  HasPlayer: 2,
  /** Faction state blocks follow (after the player state): the own one, or all for a spectator. */
  HasFaction: 4,
  /** Items on the ground came into view or went away (block at the end). */
  HasItems: 8,
} as const;

/** Most ground items in one snapshot block (u8 count); the rest come next tick. */
export const MAX_ITEMS_PER_SNAPSHOT = 255;

/** An AI faction, for the faction panel (the own one; spectators get all). */
export interface NetFactionState {
  slot: number;
  gold: number;
  wood: number;
  supplyUsed: number;
  supplyCap: number;
  tier: number;
  workers: number;
  /** army supply (not workers) */
  army: number;
  /** one short line: what the AI does now */
  status: string;
  /** Town Hall upgrade levels, in upgrades.json order */
  upgrades: number[];
  /** tick when each upgrade can be bought again (repeatable ones), 0 = now */
  upgradeReady: number[];
  /** finished building ids the faction has (for upgrade needs), as type indices */
  tech: number[];
}

export function blankFactionState(): NetFactionState {
  return {
    slot: 0,
    gold: 0,
    wood: 0,
    supplyUsed: 0,
    supplyCap: 0,
    tier: 1,
    workers: 0,
    army: 0,
    status: '',
    upgrades: [],
    upgradeReady: [],
    tech: [],
  };
}

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
  mana: number;
  maxMana: number;
  level: number;
  buffs: number;
  /** buildings: progress of construction / training / upgrade, 0..255 */
  progress: number;
}

export interface NetUpdate extends NetEntityState {
  mask: number;
}

export interface NetEvent {
  type: number;
  a: number;
  b: number;
  value: number;
  kind: number;
}

/** Private data of the player's own hero. */
export interface NetPlayerState {
  heroId: number;
  gold: number;
  xp: number;
  level: number;
  skillPoints: number;
  /** ticks until the hero is back, 0 when alive */
  respawnTicks: number;
  /** move speed * 100, for prediction */
  moveSpeed: number;
  abilityLevels: [number, number, number, number];
  /** server tick each ability is ready again (0 = ready) */
  cooldownEnds: [number, number, number, number];
  /** per inventory slot: item index + 1 (0 = empty) */
  items: number[];
  /** per inventory slot: charges */
  charges: number[];
  /** per inventory slot: server tick the item is ready again (0 = ready) */
  itemCooldownEnds: number[];
}

/** An item on the ground as it is sent. */
export interface NetGroundItem {
  id: number;
  /** index in items.json */
  item: number;
  charges: number;
  /** quantized like positions */
  x: number;
  y: number;
}

export function blankPlayerState(): NetPlayerState {
  return {
    heroId: 0,
    gold: 0,
    xp: 0,
    level: 1,
    skillPoints: 0,
    respawnTicks: 0,
    moveSpeed: 0,
    abilityLevels: [0, 0, 0, 0],
    cooldownEnds: [0, 0, 0, 0],
    items: [0, 0, 0, 0, 0, 0],
    charges: [0, 0, 0, 0, 0, 0],
    itemCooldownEnds: [0, 0, 0, 0, 0, 0],
  };
}

/** Inventory slots on the wire (rules.json heroBase.itemSlots). */
const SLOTS = gameData.rules.heroBase.itemSlots;

// ---------- commands ----------

export function writeCommand(w: BinaryWriter, seq: number, cmd: GameCommand): Uint8Array<ArrayBuffer> {
  w.reset()
    .u8(MsgId.Command)
    .u16(seq & 0xffff)
    .u8(cmd.type);
  switch (cmd.type) {
    case CommandType.Move:
      w.u16(qPos(cmd.x))
        .u16(qPos(cmd.y))
        .u8(cmd.queue ? 1 : 0);
      break;
    case CommandType.AttackMove:
      w.u16(qPos(cmd.x)).u16(qPos(cmd.y));
      break;
    case CommandType.Attack:
    case CommandType.Follow:
      w.u16(cmd.target);
      break;
    case CommandType.Cast:
      w.u8(cmd.slot).u8(cmd.target);
      if (cmd.target === 1) w.u16(cmd.id);
      if (cmd.target === 2) w.u16(qPos(cmd.x)).u16(qPos(cmd.y));
      break;
    case CommandType.Learn:
      w.u8(cmd.slot);
      break;
    case CommandType.UseItem:
      w.u8(cmd.slot).u8(cmd.target);
      if (cmd.target === 1) w.u16(cmd.id);
      if (cmd.target === 2) w.u16(qPos(cmd.x)).u16(qPos(cmd.y));
      break;
    case CommandType.BuyItem:
      w.u8(cmd.item);
      break;
    case CommandType.SellItem:
      w.u8(cmd.slot);
      break;
    case CommandType.DropItem:
      w.u8(cmd.slot).u16(qPos(cmd.x)).u16(qPos(cmd.y));
      break;
    case CommandType.PickUp:
      w.u16(cmd.id);
      break;
    case CommandType.GiveItem:
      w.u8(cmd.slot).u16(cmd.target);
      break;
    case CommandType.SwapItems:
      w.u8(cmd.from).u8(cmd.to);
      break;
    case CommandType.BuyUpgrade:
      w.u8(cmd.upgrade);
      break;
  }
  return w.bytes();
}

/** Reads a command after its message id. Returns null for an unknown command type. */
export function readCommand(r: BinaryReader): { seq: number; cmd: GameCommand } | null {
  const seq = r.u16();
  const type = r.u8();
  switch (type) {
    case CommandType.Move:
      return { seq, cmd: { type, x: dqPos(r.u16()), y: dqPos(r.u16()), queue: (r.u8() & 1) === 1 } };
    case CommandType.AttackMove:
      return { seq, cmd: { type, x: dqPos(r.u16()), y: dqPos(r.u16()) } };
    case CommandType.Attack:
    case CommandType.Follow:
      return { seq, cmd: { type, target: r.u16() } };
    case CommandType.Stop:
    case CommandType.Hold:
      return { seq, cmd: { type } };
    case CommandType.Cast: {
      const slot = r.u8() & 3,
        target = r.u8();
      if (target === 1) return { seq, cmd: { type, slot, target, id: r.u16(), x: 0, y: 0 } };
      if (target === 2) return { seq, cmd: { type, slot, target, id: 0, x: dqPos(r.u16()), y: dqPos(r.u16()) } };
      return { seq, cmd: { type, slot, target: 0, id: 0, x: 0, y: 0 } };
    }
    case CommandType.Learn:
      return { seq, cmd: { type, slot: r.u8() & 3 } };
    case CommandType.UseItem: {
      const slot = r.u8(),
        target = r.u8();
      if (target === 1) return { seq, cmd: { type, slot, target, id: r.u16(), x: 0, y: 0 } };
      if (target === 2) return { seq, cmd: { type, slot, target, id: 0, x: dqPos(r.u16()), y: dqPos(r.u16()) } };
      return { seq, cmd: { type, slot, target: 0, id: 0, x: 0, y: 0 } };
    }
    case CommandType.BuyItem:
      return { seq, cmd: { type, item: r.u8() } };
    case CommandType.SellItem:
      return { seq, cmd: { type, slot: r.u8() } };
    case CommandType.DropItem:
      return { seq, cmd: { type, slot: r.u8(), x: dqPos(r.u16()), y: dqPos(r.u16()) } };
    case CommandType.PickUp:
      return { seq, cmd: { type, id: r.u16() } };
    case CommandType.GiveItem:
      return { seq, cmd: { type, slot: r.u8(), target: r.u16() } };
    case CommandType.SwapItems:
      return { seq, cmd: { type, from: r.u8(), to: r.u8() } };
    case CommandType.BuyUpgrade:
      return { seq, cmd: { type, upgrade: r.u8() } };
  }
  return null;
}

/** Rounds a target point the same way the network does, so prediction plans the same path. */

// ---------- snapshots ----------

function blank(): NetEntityState {
  return {
    id: 0,
    type: 0,
    owner: 0,
    color: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    facing: 0,
    state: 0,
    hp: 0,
    maxHp: 0,
    mana: 0,
    maxMana: 0,
    level: 0,
    buffs: 0,
    progress: 0,
  };
}

function blankEvent(): NetEvent {
  return { type: 0, a: 0, b: 0, value: 0, kind: 0 };
}

/** Builds one snapshot. Call begin, then spawn/update/remove/event in any order, then finish. */
export class SnapshotWriter {
  private spawns: NetEntityState[] = [];
  private updates: NetUpdate[] = [];
  private gone: number[] = [];
  private events: NetEvent[] = [];
  private nSpawn = 0;
  private nUpdate = 0;
  private nGone = 0;
  private nEvent = 0;
  private player: NetPlayerState | null = null;
  private readonly factionList: NetFactionState[] = [];
  private itemSpawns: NetGroundItem[] = [];
  private itemGone: number[] = [];
  private nItemSpawn = 0;
  private nItemGone = 0;
  private head = { tick: 0, ack: 0, prediction: 0, sinceAck: 0, flags: 0 };

  begin(tick: number, ackSeq: number, ticksSinceAck: number, flags = 0, predictionSeq = ackSeq): void {
    this.head.tick = tick;
    this.head.ack = ackSeq;
    this.head.prediction = predictionSeq;
    this.head.sinceAck = Math.min(65535, ticksSinceAck);
    this.head.flags = flags;
    this.nSpawn = this.nUpdate = this.nGone = this.nEvent = 0;
    this.nItemSpawn = this.nItemGone = 0;
    this.player = null;
    this.factionList.length = 0;
  }

  spawn(s: NetEntityState): void {
    Object.assign((this.spawns[this.nSpawn++] ??= blank()), s);
  }

  update(u: NetUpdate): void {
    Object.assign((this.updates[this.nUpdate++] ??= { ...blank(), mask: 0 }), u);
  }

  remove(id: number): void {
    this.gone[this.nGone++] = id;
  }

  event(type: number, a: number, b: number, value: number, kind: number): void {
    const e = (this.events[this.nEvent++] ??= blankEvent());
    e.type = type;
    e.a = a;
    e.b = b;
    e.value = value;
    e.kind = kind;
  }

  playerState(p: NetPlayerState): void {
    this.player = p;
  }

  /** Adds a faction block (call once per faction to send). */
  factionState(f: NetFactionState): void {
    this.factionList.push(f);
  }

  /** False when the item block is full (send the rest next tick). */
  itemSpawn(g: NetGroundItem): boolean {
    if (this.nItemSpawn >= MAX_ITEMS_PER_SNAPSHOT) return false;
    Object.assign((this.itemSpawns[this.nItemSpawn++] ??= { id: 0, item: 0, charges: 0, x: 0, y: 0 }), g);
    return true;
  }

  itemRemove(id: number): boolean {
    if (this.nItemGone >= MAX_ITEMS_PER_SNAPSHOT) return false;
    this.itemGone[this.nItemGone++] = id;
    return true;
  }

  get empty(): boolean {
    return (
      this.nSpawn + this.nUpdate + this.nGone + this.nEvent + this.nItemSpawn + this.nItemGone === 0 &&
      !this.player &&
      !this.factionList.length
    );
  }

  finish(w: BinaryWriter): Uint8Array<ArrayBuffer> {
    const items = this.nItemSpawn + this.nItemGone > 0;
    const flags =
      this.head.flags |
      (this.player ? SnapshotFlag.HasPlayer : 0) |
      (this.factionList.length ? SnapshotFlag.HasFaction : 0) |
      (items ? SnapshotFlag.HasItems : 0);
    w.reset()
      .u8(MsgId.Snapshot)
      .u32(this.head.tick)
      .u16(this.head.ack & 0xffff)
      .u16(this.head.prediction & 0xffff)
      .u16(this.head.sinceAck)
      .u8(flags);
    const p = this.player;
    if (p) {
      w.u16(p.heroId).u32(p.gold).u32(p.xp).u8(p.level).u8(p.skillPoints).u16(p.respawnTicks).u16(p.moveSpeed);
      for (const l of p.abilityLevels) w.u8(l);
      for (const c of p.cooldownEnds) w.u32(c);
      for (let i = 0; i < SLOTS; i++)
        w.u8(p.items[i] ?? 0)
          .u8(p.charges[i] ?? 0)
          .u32(p.itemCooldownEnds[i] ?? 0);
    }
    if (this.factionList.length) w.u8(this.factionList.length);
    for (const f of this.factionList) {
      w.u8(f.slot).u32(f.gold).u32(f.wood).u8(f.supplyUsed).u8(f.supplyCap).u8(f.tier).u8(f.workers).u8(f.army).str(f.status);
      w.u8(f.upgrades.length);
      for (let i = 0; i < f.upgrades.length; i++) w.u8(f.upgrades[i]!).u32(f.upgradeReady[i] ?? 0);
      w.u8(f.tech.length);
      for (const t of f.tech) w.u16(t);
    }
    w.u16(this.nSpawn);
    for (let i = 0; i < this.nSpawn; i++) {
      const s = this.spawns[i]!;
      w.u16(s.id).u16(s.type).u8(s.owner).u8(s.color).u16(s.x).u16(s.y).i16(s.vx).i16(s.vy).u8(s.facing).u8(s.state);
      w.u16(s.hp).u16(s.maxHp).u16(s.mana).u16(s.maxMana).u8(s.level).u16(s.buffs).u8(s.progress);
    }
    w.u16(this.nUpdate);
    for (let i = 0; i < this.nUpdate; i++) {
      const u = this.updates[i]!;
      w.u16(u.id).u16(u.mask);
      if (u.mask & Field.Motion) w.u16(u.x).u16(u.y).i16(u.vx).i16(u.vy);
      if (u.mask & Field.Facing) w.u8(u.facing);
      if (u.mask & Field.State) w.u8(u.state);
      if (u.mask & Field.Hp) w.u16(u.hp);
      if (u.mask & Field.MaxHp) w.u16(u.maxHp);
      if (u.mask & Field.Mana) w.u16(u.mana).u16(u.maxMana);
      if (u.mask & Field.Level) w.u8(u.level);
      if (u.mask & Field.Buffs) w.u16(u.buffs);
      if (u.mask & Field.Progress) w.u8(u.progress);
    }
    w.u16(this.nGone);
    for (let i = 0; i < this.nGone; i++) w.u16(this.gone[i]!);
    w.u16(this.nEvent);
    for (let i = 0; i < this.nEvent; i++) {
      const e = this.events[i]!;
      w.u8(e.type)
        .u16(e.a)
        .u16(e.b)
        .u16(Math.max(0, Math.min(65535, e.value)))
        .u8(e.kind);
    }
    if (items) {
      w.u8(this.nItemSpawn);
      for (let i = 0; i < this.nItemSpawn; i++) {
        const g = this.itemSpawns[i]!;
        w.u16(g.id).u8(g.item).u8(g.charges).u16(g.x).u16(g.y);
      }
      w.u8(this.nItemGone);
      for (let i = 0; i < this.nItemGone; i++) w.u16(this.itemGone[i]!);
    }
    return w.bytes();
  }
}

/** A read snapshot. The arrays are reused between reads: copy what you keep. */
export class SnapshotData {
  tick = 0;
  ackSeq = 0;
  /** Most recent Move/Stop; ticksSinceAck is relative to this command, not a Learn. */
  predictionSeq = 0;
  ticksSinceAck = 0;
  flags = 0;
  spawnCount = 0;
  updateCount = 0;
  goneCount = 0;
  eventCount = 0;
  hasPlayer = false;
  itemSpawnCount = 0;
  itemGoneCount = 0;
  readonly player: NetPlayerState = blankPlayerState();
  hasFaction = false;
  factionCount = 0;
  /** faction blocks of this snapshot (0..factionCount-1) */
  readonly factions: NetFactionState[] = [];
  readonly itemSpawns: NetGroundItem[] = [];
  readonly itemGone: number[] = [];
  readonly spawns: NetEntityState[] = [];
  readonly updates: NetUpdate[] = [];
  readonly gone: number[] = [];
  readonly events: NetEvent[] = [];

  /** Reads a snapshot after its message id. */
  read(r: BinaryReader): this {
    this.tick = r.u32();
    this.ackSeq = r.u16();
    this.predictionSeq = r.u16();
    this.ticksSinceAck = r.u16();
    this.flags = r.u8();
    this.hasPlayer = (this.flags & SnapshotFlag.HasPlayer) !== 0;
    if (this.hasPlayer) {
      const p = this.player;
      p.heroId = r.u16();
      p.gold = r.u32();
      p.xp = r.u32();
      p.level = r.u8();
      p.skillPoints = r.u8();
      p.respawnTicks = r.u16();
      p.moveSpeed = r.u16();
      for (let i = 0; i < 4; i++) p.abilityLevels[i] = r.u8();
      for (let i = 0; i < 4; i++) p.cooldownEnds[i] = r.u32();
      for (let i = 0; i < SLOTS; i++) {
        p.items[i] = r.u8();
        p.charges[i] = r.u8();
        p.itemCooldownEnds[i] = r.u32();
      }
    }
    this.hasFaction = (this.flags & SnapshotFlag.HasFaction) !== 0;
    this.factionCount = this.hasFaction ? r.u8() : 0;
    for (let k = 0; k < this.factionCount; k++) {
      const f = (this.factions[k] ??= blankFactionState());
      f.slot = r.u8();
      f.gold = r.u32();
      f.wood = r.u32();
      f.supplyUsed = r.u8();
      f.supplyCap = r.u8();
      f.tier = r.u8();
      f.workers = r.u8();
      f.army = r.u8();
      f.status = r.str();
      const n = r.u8();
      f.upgrades.length = f.upgradeReady.length = n;
      for (let i = 0; i < n; i++) {
        f.upgrades[i] = r.u8();
        f.upgradeReady[i] = r.u32();
      }
      const t = r.u8();
      f.tech.length = t;
      for (let i = 0; i < t; i++) f.tech[i] = r.u16();
    }
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
      s.mana = r.u16();
      s.maxMana = r.u16();
      s.level = r.u8();
      s.buffs = r.u16();
      s.progress = r.u8();
    }
    this.updateCount = r.u16();
    for (let i = 0; i < this.updateCount; i++) {
      const u = (this.updates[i] ??= { ...blank(), mask: 0 });
      u.id = r.u16();
      u.mask = r.u16();
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
      if (u.mask & Field.Mana) {
        u.mana = r.u16();
        u.maxMana = r.u16();
      }
      if (u.mask & Field.Level) u.level = r.u8();
      if (u.mask & Field.Buffs) u.buffs = r.u16();
      if (u.mask & Field.Progress) u.progress = r.u8();
    }
    this.goneCount = r.u16();
    for (let i = 0; i < this.goneCount; i++) this.gone[i] = r.u16();
    this.eventCount = r.u16();
    for (let i = 0; i < this.eventCount; i++) {
      const e = (this.events[i] ??= blankEvent());
      e.type = r.u8();
      e.a = r.u16();
      e.b = r.u16();
      e.value = r.u16();
      e.kind = r.u8();
    }
    this.itemSpawnCount = this.itemGoneCount = 0;
    if (this.flags & SnapshotFlag.HasItems) {
      this.itemSpawnCount = r.u8();
      for (let i = 0; i < this.itemSpawnCount; i++) {
        const g = (this.itemSpawns[i] ??= { id: 0, item: 0, charges: 0, x: 0, y: 0 });
        g.id = r.u16();
        g.item = r.u8();
        g.charges = r.u8();
        g.x = r.u16();
        g.y = r.u16();
      }
      this.itemGoneCount = r.u8();
      for (let i = 0; i < this.itemGoneCount; i++) this.itemGone[i] = r.u16();
    }
    return this;
  }
}

export function readSnapshot(data: ArrayBuffer | Uint8Array, out: SnapshotData): SnapshotData {
  const r = new BinaryReader(data);
  if (r.u8() !== MsgId.Snapshot) throw new Error('Not a snapshot');
  return out.read(r);
}
