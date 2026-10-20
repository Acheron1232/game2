import { describe, expect, it } from 'vitest';
import {
  BinaryReader,
  BinaryWriter,
  CommandType,
  DamageKind,
  EventType,
  Field,
  MsgId,
  parseClientLobbyMessage,
  readBinaryMessage,
  readCommand,
  readSnapshot,
  SnapshotData,
  SnapshotFlag,
  SnapshotWriter,
  UnitState,
  writeCommand,
  writePing,
  writePong,
} from '../src/index';

describe('binary writer and reader', () => {
  it('reads back every type it writes', () => {
    const w = new BinaryWriter(4); // small on purpose, so it has to grow
    w.u8(200).u16(60000).u32(4_000_000_000).i32(-12345).f32(1.5).f64(Math.PI).str('Blood Witch ✦');
    const r = new BinaryReader(w.bytes());
    expect(r.u8()).toBe(200);
    expect(r.u16()).toBe(60000);
    expect(r.u32()).toBe(4_000_000_000);
    expect(r.i32()).toBe(-12345);
    expect(r.f32()).toBe(1.5);
    expect(r.f64()).toBe(Math.PI);
    expect(r.str()).toBe('Blood Witch ✦');
    expect(r.remaining).toBe(0);
  });

  it('throws on a short message', () => {
    expect(() => new BinaryReader(new Uint8Array([1, 2])).u32()).toThrow(RangeError);
  });

  it('reset reuses the same writer', () => {
    const w = new BinaryWriter();
    w.u32(1).u32(2);
    expect(w.reset().u8(7).length).toBe(1);
  });
});

describe('messages', () => {
  it('ping and pong survive a round trip', () => {
    const w = new BinaryWriter();
    expect(readBinaryMessage(writePing(w, { clientTime: 1234.5 }))).toEqual({ id: MsgId.Ping, clientTime: 1234.5 });
    expect(readBinaryMessage(writePong(w, { clientTime: 1, serverTime: 2 }))).toEqual({ id: MsgId.Pong, clientTime: 1, serverTime: 2 });
  });

  it('rejects unknown ids', () => {
    expect(() => readBinaryMessage(new Uint8Array([250]))).toThrow();
  });

  it('parses only valid hello messages', () => {
    expect(parseClientLobbyMessage('{"type":"hello","protocol":1,"name":"Andrii"}')).toEqual({
      type: 'hello',
      protocol: 1,
      name: 'Andrii',
    });
    expect(parseClientLobbyMessage('{"type":"hello"}')).toBeNull();
    expect(parseClientLobbyMessage('not json')).toBeNull();
  });
});

describe('match messages', () => {
  it('commands survive the trip', () => {
    const w = new BinaryWriter();
    const cmds = [
      { type: CommandType.Move, x: 100.5, y: 20.25, queue: true },
      { type: CommandType.Attack, target: 4321 },
      { type: CommandType.AttackMove, x: 3, y: 250 },
      { type: CommandType.Stop },
      { type: CommandType.Hold },
    ] as const;
    for (const c of cmds) {
      const r = new BinaryReader(writeCommand(w, 77, c));
      expect(r.u8()).toBe(MsgId.Command);
      const back = readCommand(r)!;
      expect(back.seq).toBe(77);
      expect(back.cmd.type).toBe(c.type);
      if ('x' in c && 'x' in back.cmd) expect(back.cmd.x).toBeCloseTo(c.x, 2);
      if ('target' in c && 'target' in back.cmd) expect(back.cmd.target).toBe(c.target);
    }
  });

  it('a snapshot keeps player state, fields and events', () => {
    const sw = new SnapshotWriter();
    sw.begin(1234, 9, 3, SnapshotFlag.Full);
    sw.playerState({
      heroId: 5,
      gold: 777,
      xp: 1500,
      level: 4,
      skillPoints: 2,
      respawnTicks: 60,
      moveSpeed: 310,
      abilityLevels: [1, 0, 2, 0],
    });
    sw.spawn({
      id: 5,
      type: 2,
      owner: 1,
      color: 1,
      x: 100,
      y: 200,
      vx: -30,
      vy: 40,
      facing: 9,
      state: UnitState.Moving,
      hp: 400,
      maxHp: 560,
      mana: 50,
      maxMana: 180,
      level: 4,
    });
    sw.update({
      id: 9,
      type: 0,
      owner: 0,
      color: 0,
      x: 1,
      y: 2,
      vx: 3,
      vy: 4,
      facing: 5,
      state: UnitState.Dead,
      hp: 0,
      maxHp: 200,
      mana: 7,
      maxMana: 8,
      level: 3,
      mask: Field.State | Field.Hp | Field.Mana,
    });
    sw.remove(33);
    sw.event(EventType.Damage, 9, 5, 26, DamageKind.Attack);
    const s = readSnapshot(sw.finish(new BinaryWriter()), new SnapshotData());
    expect([s.tick, s.ackSeq, s.ticksSinceAck, s.hasPlayer, s.flags & SnapshotFlag.Full]).toEqual([1234, 9, 3, true, 1]);
    expect(s.player).toMatchObject({
      heroId: 5,
      gold: 777,
      xp: 1500,
      level: 4,
      skillPoints: 2,
      respawnTicks: 60,
      moveSpeed: 310,
      abilityLevels: [1, 0, 2, 0],
    });
    expect(s.spawns[0]).toMatchObject({ id: 5, vx: -30, mana: 50, maxMana: 180, level: 4 });
    expect(s.updates[0]).toMatchObject({ id: 9, state: UnitState.Dead, hp: 0, mana: 7, maxMana: 8 });
    expect(s.gone.slice(0, s.goneCount)).toEqual([33]);
    expect(s.events[0]).toMatchObject({ type: EventType.Damage, a: 9, b: 5, value: 26, kind: DamageKind.Attack });
  });
});
