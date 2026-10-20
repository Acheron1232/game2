import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameSocket } from '../src/net/socket';

class Socket {
  static readonly OPEN = 1;
  static readonly instances: Socket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string | ArrayBuffer }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  readonly sent: unknown[] = [];
  constructor() {
    Socket.instances.push(this);
  }
  send(data: unknown) {
    this.sent.push(data);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  message(data: string | ArrayBuffer) {
    this.onmessage?.({ data });
  }
  close(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
  Socket.instances.length = 0;
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('location', { search: '?lag=200&loss=0' });
  const store = () => {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => data.set(k, v),
      removeItem: (k: string) => data.delete(k),
    };
  };
  vi.stubGlobal('sessionStorage', store());
  vi.stubGlobal('localStorage', store());
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('socket reconnect with simulated latency', () => {
  it('drops queued commands instead of sending them through the replacement socket', () => {
    vi.stubGlobal('location', { search: '?lag=2000&loss=0' });
    const net = new GameSocket('ws://test/ws', () => 'Player');
    net.connect();
    const first = Socket.instances[0]!;
    first.open();
    first.message(JSON.stringify({ type: 'welcome', playerId: 'p1', session: 's1', version: 6, name: 'Player' }));
    vi.advanceTimersByTime(1000);
    net.sendBinary(new Uint8Array([99]));
    first.close();
    vi.advanceTimersByTime(500);
    const next = Socket.instances[1]!;
    next.open();
    next.message(JSON.stringify({ type: 'welcome', playerId: 'p1', session: 's1', version: 6, name: 'Player' }));
    vi.advanceTimersByTime(500);
    expect(next.sent.some((data) => data instanceof Uint8Array && data[0] === 99)).toBe(false);
    expect(net.state.status).toBe('online');
  });

  it('does not deliver an old connection snapshot after disconnect', () => {
    const net = new GameSocket('ws://test/ws', () => 'Player');
    const snapshot = vi.fn();
    net.onSnapshot(snapshot);
    net.connect();
    const ws = Socket.instances[0]!;
    ws.open();
    ws.message(JSON.stringify({ type: 'welcome', playerId: 'p1', session: 's1', version: 6, name: 'Player' }));
    vi.advanceTimersByTime(100);
    expect(net.state.status).toBe('online');
    ws.message(new Uint8Array([4]).buffer);
    ws.close();
    vi.advanceTimersByTime(100);
    expect(snapshot).not.toHaveBeenCalled();
  });

  it('does not reconnect an outdated client after a delayed protocol error', () => {
    const net = new GameSocket('ws://test/ws', () => 'Player');
    net.connect();
    const ws = Socket.instances[0]!;
    ws.open();
    ws.message(JSON.stringify({ type: 'error', code: 'bad_protocol', text: 'Please reload.' }));
    ws.close(4000);
    vi.advanceTimersByTime(1000);
    expect(net.state.status).toBe('outdated');
    expect(Socket.instances).toHaveLength(1);
  });
});
