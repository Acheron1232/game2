import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  workers: 1,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    browserName: 'chromium',
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    launchOptions: { args: ['--enable-unsafe-swiftshader'] },
  },
  webServer: [
    {
      command: 'pnpm --filter @game/server dev',
      url: 'http://127.0.0.1:8787/health',
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @game/client dev --host 127.0.0.1',
      env: { GAME_SERVER: 'http://127.0.0.1:8787' },
      url: 'http://127.0.0.1:5173/health',
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
    },
  ],
});
