// One connected client. Text frames are lobby JSON, binary frames are game messages.
// The client must say "hello" with the right protocol version before anything else.

import {
  BinaryWriter,
  MsgId,
  parseClientLobbyMessage,
  PROTOCOL_VERSION,
  readBinaryMessage,
  writePong,
  type ServerLobbyMessage,
} from '@game/shared';
import type { RawData, WebSocket } from 'ws';
import type { PlayerRegistry } from '../lobby/players';

/** Max messages per second before we drop the client. Real play needs far less. */
const MAX_MESSAGES_PER_SEC = 60;

export const CloseCode = {
  BadProtocol: 4000,
  BadMessage: 4001,
  TooManyMessages: 4002,
} as const;

export class ClientConnection {
  private playerId: string | null = null;
  private alive = true;
  private messagesThisSecond = 0;
  private secondStartedAt = Date.now();
  private readonly writer = new BinaryWriter(64);

  constructor(
    private readonly socket: WebSocket,
    private readonly players: PlayerRegistry,
    private readonly serverVersion: string,
  ) {
    socket.binaryType = 'nodebuffer';
    socket.on('message', (data, isBinary) => this.onMessage(data, isBinary));
    socket.on('pong', () => (this.alive = true));
    socket.on('close', () => {
      if (this.playerId) this.players.remove(this.playerId);
    });
    socket.on('error', () => socket.terminate());
  }

  /** Called on a timer. A client that did not answer the last ping is gone. */
  heartbeat(): void {
    if (!this.alive) {
      this.socket.terminate();
      return;
    }
    this.alive = false;
    this.socket.ping();
  }

  close(code: number, reason: string): void {
    this.socket.close(code, reason);
  }

  private onMessage(data: RawData, isBinary: boolean): void {
    if (!this.withinRateLimit()) {
      this.close(CloseCode.TooManyMessages, 'Too many messages');
      return;
    }
    const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
    if (isBinary) this.onBinary(bytes);
    else this.onText(bytes.toString('utf8'));
  }

  private onText(text: string): void {
    const msg = parseClientLobbyMessage(text);
    if (!msg) return this.fail('bad_message', 'This message is not valid.', CloseCode.BadMessage);
    if (msg.type === 'hello') {
      if (msg.protocol !== PROTOCOL_VERSION) {
        return this.fail('bad_protocol', 'The game was updated. Please reload the page.', CloseCode.BadProtocol);
      }
      if (!this.playerId) this.playerId = this.players.add(msg.name || 'Player').id;
      this.sendJson({ type: 'welcome', playerId: this.playerId, serverVersion: this.serverVersion });
    }
  }

  private onBinary(bytes: Buffer): void {
    if (!this.playerId) return this.fail('bad_message', 'Say hello first.', CloseCode.BadMessage);
    let msg;
    try {
      msg = readBinaryMessage(bytes);
    } catch {
      return this.fail('bad_message', 'This message is not valid.', CloseCode.BadMessage);
    }
    if (msg.id === MsgId.Ping) {
      this.socket.send(writePong(this.writer, { clientTime: msg.clientTime, serverTime: Date.now() }), { binary: true });
    }
  }

  private fail(code: 'bad_protocol' | 'bad_message', text: string, closeCode: number): void {
    this.sendJson({ type: 'error', code, text });
    this.close(closeCode, code);
  }

  private sendJson(msg: ServerLobbyMessage): void {
    this.socket.send(JSON.stringify(msg));
  }

  private withinRateLimit(): boolean {
    const now = Date.now();
    if (now - this.secondStartedAt >= 1000) {
      this.secondStartedAt = now;
      this.messagesThisSecond = 0;
    }
    return ++this.messagesThisSecond <= MAX_MESSAGES_PER_SEC;
  }
}
