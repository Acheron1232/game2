// Message ids and the messages we have so far.
// Lobby messages are JSON text frames. Game messages are binary frames that start with a u8 id.

import { BinaryReader, type BinaryWriter } from './binary';

/** Bump this when a message changes. Old clients are told to reload. */
export const PROTOCOL_VERSION = 9;

/** First byte of every binary message. */
export const MsgId = {
  Ping: 1,
  Pong: 2,
  /** client -> server, see game.ts */
  Command: 3,
  /** server -> client, see game.ts */
  Snapshot: 4,
} as const;
export type MsgId = (typeof MsgId)[keyof typeof MsgId];

export interface PingMessage {
  clientTime: number;
}

export interface PongMessage {
  clientTime: number;
  serverTime: number;
}

export function writePing(w: BinaryWriter, msg: PingMessage): Uint8Array<ArrayBuffer> {
  return w.reset().u8(MsgId.Ping).f64(msg.clientTime).bytes();
}

export function writePong(w: BinaryWriter, msg: PongMessage): Uint8Array<ArrayBuffer> {
  return w.reset().u8(MsgId.Pong).f64(msg.clientTime).f64(msg.serverTime).bytes();
}

export type BinaryMessage = ({ id: typeof MsgId.Ping } & PingMessage) | ({ id: typeof MsgId.Pong } & PongMessage);

/** Reads one binary message. Throws on an unknown id or a short message. */
export function readBinaryMessage(data: ArrayBuffer | Uint8Array): BinaryMessage {
  const r = new BinaryReader(data);
  const id = r.u8();
  switch (id) {
    case MsgId.Ping:
      return { id, clientTime: r.f64() };
    case MsgId.Pong:
      return { id, clientTime: r.f64(), serverTime: r.f64() };
    default:
      throw new Error(`Unknown message id ${id}`);
  }
}
