import { describe, expect, it } from 'vitest';
import { BinaryReader, BinaryWriter, MsgId, parseClientLobbyMessage, readBinaryMessage, writePing, writePong } from '../src/index';

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
