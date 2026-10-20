// WebSocket to the game server: hello on connect, ping every 2 seconds, reconnect on drop.
// Lobby messages are JSON, match messages are binary (snapshots).

import {
  BinaryWriter,
  MsgId,
  PROTOCOL_VERSION,
  readBinaryMessage,
  writePing,
  type ClientLobbyMessage,
  type ServerLobbyMessage,
} from '@game/shared';
import { LagLine, lagFromUrl, type LagSettings } from './lag';
import { forgetOwnSession, rememberSession, sessionCandidates } from './session';

export type NetStatus = 'connecting' | 'online' | 'offline' | 'outdated';

export interface NetState {
  status: NetStatus;
  /** Smoothed round-trip time in ms, or null before the first pong. */
  pingMs: number | null;
  playerId: string | null;
  /** bytes per second received (last second) */
  downBps: number;
  lag: LagSettings;
}

const PING_EVERY_MS = 2000;

export class GameSocket {
  private ws: WebSocket | null = null;
  private readonly writer = new BinaryWriter(32);
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private retryMs = 500;
  private readonly listeners = new Set<(s: NetState) => void>();
  private readonly lobbyListeners = new Set<(m: ServerLobbyMessage) => void>();
  private readonly snapshotListeners = new Set<(data: ArrayBuffer) => void>();
  private bytesThisSecond = 0;
  private readonly lagIn: LagLine<MessageEvent>;
  private readonly lagOut: LagLine<string | Uint8Array<ArrayBuffer>>;
  readonly state: NetState;

  constructor(
    private readonly url: string,
    private readonly name: () => string,
  ) {
    const lag = import.meta.env.DEV ? lagFromUrl() : { lagMs: 0, lossPct: 0 };
    this.state = { status: 'connecting', pingMs: null, playerId: null, downBps: 0, lag };
    this.lagIn = new LagLine(lag, (ev) => this.onMessage(ev));
    this.lagOut = new LagLine(lag, (data) => {
      if (this.state.status === 'online' && this.ws?.readyState === WebSocket.OPEN) this.ws.send(data);
    });
    setInterval(() => {
      this.set({ downBps: this.bytesThisSecond });
      this.bytesThisSecond = 0;
    }, 1000);
  }

  onChange(fn: (s: NetState) => void): void {
    this.listeners.add(fn);
    fn(this.state);
  }

  onLobby(fn: (m: ServerLobbyMessage) => void): () => void {
    this.lobbyListeners.add(fn);
    return () => this.lobbyListeners.delete(fn);
  }

  onSnapshot(fn: (data: ArrayBuffer) => void): () => void {
    this.snapshotListeners.add(fn);
    return () => this.snapshotListeners.delete(fn);
  }

  send(msg: ClientLobbyMessage): void {
    if (this.state.status === 'online') this.lagOut.push(JSON.stringify(msg));
  }

  /** Binary game message. The bytes are copied, so a reused writer is fine. */
  sendBinary(data: Uint8Array<ArrayBuffer>): void {
    if (this.state.status === 'online') this.lagOut.push(this.lagOut.active ? data.slice() : data);
  }

  connect(): void {
    if (this.ws) return;
    this.set({ status: 'connecting' });
    const ws = new WebSocket(this.url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.retryMs = 500;
      // hello goes out at once (not through the lag line), so connect order stays simple.
      const { own, others } = sessionCandidates();
      ws.send(
        JSON.stringify({
          type: 'hello',
          protocol: PROTOCOL_VERSION,
          name: this.name(),
          session: own,
          sessions: others,
        } satisfies ClientLobbyMessage),
      );
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      this.bytesThisSecond += typeof ev.data === 'string' ? ev.data.length : (ev.data as ArrayBuffer).byteLength;
      // As with hello, finish the handshake before simulating game latency. Otherwise a
      // protocol error may still be waiting in the lag queue when the socket closes.
      if (this.state.status !== 'online' && typeof ev.data === 'string') this.onText(ev.data);
      else this.lagIn.push(ev);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.stopPing();
      this.ws = null;
      this.lagIn.reset();
      this.lagOut.reset();
      if (ev.code === 4000) this.set({ status: 'outdated', pingMs: null });
      if (this.state.status === 'outdated') return;
      // Another tab took this player: start as a new one.
      if (ev.code === 4003) forgetOwnSession();
      this.set({ status: 'offline', pingMs: null });
      setTimeout(() => {
        if (!this.ws && this.state.status !== 'outdated') this.connect();
      }, this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 8000);
    };
  }

  private onMessage(ev: MessageEvent): void {
    if (typeof ev.data === 'string') this.onText(ev.data);
    else this.onBinary(ev.data as ArrayBuffer);
  }

  private onText(text: string): void {
    const msg = JSON.parse(text) as ServerLobbyMessage;
    if (msg.type === 'welcome') {
      rememberSession(msg.session);
      this.set({ status: 'online', playerId: msg.playerId });
      this.startPing();
    } else if (msg.type === 'error' && msg.code === 'bad_protocol') {
      this.set({ status: 'outdated' });
    }
    for (const fn of this.lobbyListeners) fn(msg);
  }

  private onBinary(data: ArrayBuffer): void {
    const id = new Uint8Array(data, 0, 1)[0];
    if (id === MsgId.Snapshot) {
      for (const fn of this.snapshotListeners) fn(data);
      return;
    }
    const msg = readBinaryMessage(data);
    if (msg.id === MsgId.Pong) {
      const rtt = performance.now() - msg.clientTime;
      // Smooth it so the number does not jump around.
      this.set({ pingMs: this.state.pingMs === null ? rtt : this.state.pingMs * 0.7 + rtt * 0.3 });
    }
  }

  private startPing(): void {
    this.stopPing();
    const ping = () => this.sendBinary(writePing(this.writer, { clientTime: performance.now() }));
    ping();
    this.pingTimer = setInterval(ping, PING_EVERY_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private set(patch: Partial<NetState>): void {
    Object.assign(this.state, patch);
    for (const fn of this.listeners) fn(this.state);
  }
}

export function defaultServerUrl(): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}
