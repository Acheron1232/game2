// HTTP + WebSocket server on one port.
//   GET /health  -> small JSON status (for uptime checks and load balancers)
//   /ws          -> WebSocket for lobby (JSON) and game (binary) messages

import { createServer, type Server } from 'node:http';
import { WebSocketServer } from 'ws';
import { ClientConnection } from './net/connection';
import { PlayerRegistry } from './lobby/players';

export const SERVER_VERSION = '0.1.0';

export interface GameServer {
  http: Server;
  players: PlayerRegistry;
  close(): Promise<void>;
}

export interface GameServerOptions {
  /** Ping clients this often to find dead connections. */
  heartbeatMs?: number;
}

export function createGameServer(options: GameServerOptions = {}): GameServer {
  const startedAt = Date.now();
  const players = new PlayerRegistry();

  const http = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          version: SERVER_VERSION,
          uptimeSec: Math.round((Date.now() - startedAt) / 1000),
          players: players.count,
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
    const conn = new ClientConnection(socket, players, SERVER_VERSION);
    connections.add(conn);
    socket.on('close', () => connections.delete(conn));
  });

  const heartbeat = setInterval(() => {
    for (const conn of connections) conn.heartbeat();
  }, options.heartbeatMs ?? 15_000);

  return {
    http,
    players,
    close: () =>
      new Promise((resolve) => {
        clearInterval(heartbeat);
        for (const conn of connections) conn.close(1001, 'Server is shutting down');
        wss.close(() => http.close(() => resolve()));
      }),
  };
}
