import { gameData, validateGameData } from '@game/shared';
import { createGameServer, SERVER_VERSION } from './server';

// Our own variable names: tools often set PORT/HOST for the web dev server, not for us.
const PORT = Number(process.env['GAME_PORT'] ?? 8787);
const HOST = process.env['GAME_HOST'] ?? '0.0.0.0';

// Stop at once if the game data is broken, before anyone can join.
const problems = validateGameData(gameData);
if (problems.length) {
  console.error(`Game data has ${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

const server = createGameServer({
  // MATCH_INLINE=1 runs matches on the main thread (easier to debug).
  matchMode: process.env['MATCH_INLINE'] === '1' ? 'inline' : 'worker',
  // Load-test options (hundreds of test units) only on a dev server.
  allowTestOptions: process.env['NODE_ENV'] !== 'production',
});
server.http.listen(PORT, HOST, () => {
  console.log(`Temple Wars server ${SERVER_VERSION} on http://${HOST}:${PORT} (WebSocket at /ws)`);
});

const stop = () => {
  console.log('Shutting down...');
  void server.close().then(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
