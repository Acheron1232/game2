// WebSocket to the game server: hello on connect, ping every 2 seconds, reconnect on drop.

import { BinaryWriter, MsgId, PROTOCOL_VERSION, readBinaryMessage, writePing, type ServerLobbyMessage } from '@game/shared';

export type NetStatus = 'connecting' | 'online' | 'offline' | 'outdated';

export interface NetState {
  status: NetStatus;
  /** Smoothed round-trip time in ms, or null before the first pong. */
  pingMs: number | null;
  playerId: string | null;
}

const PING_EVERY_MS = 2000;

export class GameSocket {
  private ws: WebSocket | null = null;
  private readonly writer = new BinaryWriter(32);
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private retryMs = 1000;
  private readonly listeners = new Set<(s: NetState) => void>();
  readonly state: NetState = { status: 'connecting', pingMs: null, playerId: null };

  constructor(
    private readonly url: string,
    private readonly name: () => string,
  ) {}

  onChange(fn: (s: NetState) => void): void {
    this.listeners.add(fn);
    fn(this.state);
  }

  connect(): void {
    this.set({ status: 'connecting' });
    const ws = new WebSocket(this.url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.retryMs = 1000;
      ws.send(JSON.stringify({ type: 'hello', protocol: PROTOCOL_VERSION, name: this.name() }));
    };
    ws.onmessage = (ev) => (typeof ev.data === 'string' ? this.onText(ev.data) : this.onBinary(ev.data as ArrayBuffer));
    ws.onclose = () => {
      this.stopPing();
      this.ws = null;
      if (this.state.status === 'outdated') return;
      this.set({ status: 'offline', pingMs: null });
      setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 15000);
    };
  }

  private onText(text: string): void {
    const msg = JSON.parse(text) as ServerLobbyMessage;
    if (msg.type === 'welcome') {
      this.set({ status: 'online', playerId: msg.playerId });
      this.startPing();
    } else if (msg.type === 'error' && msg.code === 'bad_protocol') {
      this.set({ status: 'outdated' });
    }
  }

  private onBinary(data: ArrayBuffer): void {
    const msg = readBinaryMessage(data);
    if (msg.id === MsgId.Pong) {
      const rtt = performance.now() - msg.clientTime;
      // Smooth it so the number does not jump around.
      this.set({ pingMs: this.state.pingMs === null ? rtt : this.state.pingMs * 0.7 + rtt * 0.3 });
    }
  }

  private startPing(): void {
    this.stopPing();
    const ping = () => this.ws?.readyState === WebSocket.OPEN && this.ws.send(writePing(this.writer, { clientTime: performance.now() }));
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
