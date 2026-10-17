import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui', testMatch: '**/*.pw.ts', fullyParallel: true,
  workers: process.env.CI ? 2 : 3, timeout: 60_000,
  expect: { timeout: 15_000 }, reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:3100', browserName: 'chromium', trace: 'retain-on-failure', screenshot: 'only-on-failure', reducedMotion: 'reduce' },
  webServer: { command: 'node node_modules/vite/bin/vite.js --port 3100 --host 127.0.0.1 --strictPort', url: 'http://127.0.0.1:3100', reuseExistingServer: !process.env.CI },
});
