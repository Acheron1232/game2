// A tiny test client that speaks our protocol over a real WebSocket.

import {
  BinaryWriter,
  isHeroType,
  PROTOCOL_VERSION,
  readSnapshot,
  SnapshotData,
  writeCommand,
  type GameCommand,
  type ServerLobbyMessage,
} from '@game/shared';
import { WebSocket } from 'ws';

export class TestClient {
  readonly ws: WebSocket;
  readonly json: ServerLobbyMessage[] = [];
  readonly snapshots: { tick: number; ack: number; spawns: number[]; updates: number; gone: number[]; full: boolean; bytes: number }[] = [];
  /** last known quantized position per entity id */
  readonly pos = new Map<number, { x: number; y: number }>();
  readonly kinds = new Map<number, { type: number; owner: number }>();
  session = '';
  playerId = '';
  bytes = 0;
  private seq = 0;
  private readonly w = new BinaryWriter(64);
  private readonly snap = new SnapshotData();
  private waiters: (() => void)[] = [];

  private constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (data: Buffer, isBinary) => {
      this.bytes += data.byteLength;
      if (isBinary) {
        if (data[0] === 4) {
          const s = readSnapshot(data, this.snap);
          for (let i = 0; i < s.spawnCount; i++) {
            const e = s.spawns[i]!;
            this.pos.set(e.id, { x: e.x, y: e.y });
            this.kinds.set(e.id, { type: e.type, owner: e.owner });
          }
          for (let i = 0; i < s.updateCount; i++)
            if (s.updates[i]!.mask & 1) this.pos.set(s.updates[i]!.id, { x: s.updates[i]!.x, y: s.updates[i]!.y });
          this.snapshots.push({
            tick: s.tick,
            ack: s.ackSeq,
            spawns: s.spawns.slice(0, s.spawnCount).map((x) => x.id),
            updates: s.updateCount,
            gone: s.gone.slice(0, s.goneCount),
            full: (s.flags & 1) === 1,
            bytes: data.byteLength,
          });
        }
      } else {
        const msg = JSON.parse(data.toString()) as ServerLobbyMessage;
        if (msg.type === 'welcome') {
          this.session = msg.session;
          this.playerId = msg.playerId;
        }
        this.json.push(msg);
      }
      for (const w of this.waiters.splice(0)) w();
    });
  }

  static async connect(base: string, name: string, session?: string): Promise<TestClient> {
    const c = new TestClient(`ws://${base}/ws`);
    await new Promise<void>((resolve, reject) => {
      c.ws.once('open', () => resolve());
      c.ws.once('error', reject);
    });
    c.send({ type: 'hello', protocol: PROTOCOL_VERSION, name, session });
    await c.waitFor((m) => m.type === 'welcome');
    return c;
  }

  /** Entity id of the hero of this slot, once a snapshot has shown it. */
  ownHero(slot: number): number | undefined {
    for (const [id, k] of this.kinds) if (k.owner === slot && isHeroType(k.type)) return id;
    return undefined;
  }

  send(msg: object): void {
    this.ws.send(JSON.stringify(msg));
  }

  command(cmd: GameCommand): number {
    this.ws.send(writeCommand(this.w, ++this.seq, cmd));
    return this.seq;
  }

  /** Waits for a JSON message that matches (also one that came already, after `from`). */
  async waitFor<T extends ServerLobbyMessage>(test: (m: ServerLobbyMessage) => boolean, from = 0, timeoutMs = 3000): Promise<T> {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const found = this.json.slice(from).find(test);
      if (found) return found as T;
      if (Date.now() > end) throw new Error(`Timeout. Got: ${this.json.map((m) => m.type).join(', ')}`);
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        setTimeout(resolve, 50);
      });
    }
  }

  async waitUntil(test: () => boolean, timeoutMs = 3000): Promise<void> {
    const end = Date.now() + timeoutMs;
    while (!test()) {
      if (Date.now() > end) throw new Error('Timeout');
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  lastRoom() {
    const rooms = this.json.filter((m) => m.type === 'room');
    return (rooms[rooms.length - 1] as Extract<ServerLobbyMessage, { type: 'room' }> | undefined)?.room;
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.ws.readyState === WebSocket.CLOSED) return resolve();
      this.ws.once('close', () => resolve());
      this.ws.close();
    });
  }
}
