import { defineConfig } from 'vite';

const SERVER = process.env['GAME_SERVER'] ?? 'http://localhost:8787';

export default defineConfig({
  server: {
    port: 5173,
    // The client talks to the same origin; in dev, Vite passes /ws and /health on to the game server.
    proxy: {
      '/ws': { target: SERVER, ws: true },
      '/health': { target: SERVER },
    },
  },
  build: {
    target: 'es2022',
    // Babylon alone is over the default warning size; that is expected.
    chunkSizeWarningLimit: 4000,
  },
});
