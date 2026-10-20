// HTTP + WebSocket server on one port.
//   GET /health  -> small JSON status (for uptime checks and load balancers)
//   /ws          -> WebSocket for lobby (JSON) and game (binary) messages

import { createServer, type Server } from 'node:http';
import { gameData } from '@game/shared';
import { WebSocketServer } from 'ws';
import { readSharedDataFile } from './data-files';
import { Lobby, type LobbyOptions } from './lobby/lobby';
import { PlayerRegistry } from './lobby/players';
import { ClientConnection } from './net/connection';

export const SERVER_VERSION = '0.2.0';

export interface GameServer {
  http: Server;
  players: PlayerRegistry;
  lobby: Lobby;
  close(): Promise<void>;
}

export interface GameServerOptions extends Partial<Omit<LobbyOptions, 'serverVersion'>> {
  /** Ping clients this often to find dead connections. */
  heartbeatMs?: number;
}

export function createGameServer(options: GameServerOptions = {}): GameServer {
  const startedAt = Date.now();
  const players = new PlayerRegistry();
  let terrain: Uint8Array | null = null;
  const lobby = new Lobby(players, {
    serverVersion: SERVER_VERSION,
    matchMode: options.matchMode ?? 'worker',
    allowTestOptions: options.allowTestOptions ?? false,
    lobbyGraceMs: options.lobbyGraceMs ?? 20_000,
    reconnectMs: options.reconnectMs ?? gameData.rules.match.reconnectWindowSec * 1000,
    matchReadyTimeoutMs: options.matchReadyTimeoutMs ?? 10_000,
    terrain: options.terrain ?? (() => (terrain ??= readSharedDataFile('map-terrain.bin'))),
  });

  const http = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          version: SERVER_VERSION,
          uptimeSec: Math.round((Date.now() - startedAt) / 1000),
          players: players.online,
          ...lobby.summary(),
        }),
      );
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  });

  // 64 KB is far more than any command needs; bigger frames are refused.
  const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 64 * 1024 });
  const connections = new Set<ClientConnection>();

  wss.on('connection', (socket) => {
    // Small messages 20 times a second: send at once, do not wait to fill a packet.
    (socket as unknown as { _socket?: { setNoDelay?(on: boolean): void } })._socket?.setNoDelay?.(true);
    const conn = new ClientConnection(socket, lobby);
    connections.add(conn);
    socket.on('close', () => connections.delete(conn));
  });

  const heartbeat = setInterval(() => {
    for (const conn of connections) conn.heartbeat();
  }, options.heartbeatMs ?? 15_000);

  return {
    http,
    players,
    lobby,
    close: () =>
      new Promise((resolve) => {
        clearInterval(heartbeat);
        lobby.close();
        for (const conn of connections) conn.close(1001, 'Server is shutting down');
        wss.close(() => http.close(() => resolve()));
      }),
  };
}
