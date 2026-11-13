import { defineConfig } from '@playwright/test';

// A dedicated port prevents a worktree run from reusing another checkout's Vite server.
const port = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Choose a valid PLAYWRIGHT_PORT.');
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/ui', testMatch: '**/*.pw.ts', fullyParallel: true,
  workers: process.env.CI ? 2 : 3, timeout: 60_000,
  expect: { timeout: 15_000 }, reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL, browserName: 'chromium', trace: 'retain-on-failure', screenshot: 'only-on-failure', reducedMotion: 'reduce' },
  webServer: [
    { command: `node node_modules/vite/bin/vite.js --port ${port} --host 127.0.0.1 --strictPort`, url: baseURL,
      reuseExistingServer: !process.env.CI && !process.env.PLAYWRIGHT_PORT },
    { command: 'npm --prefix src/metrics-web start', url: 'http://127.0.0.1:3200', reuseExistingServer: false,
      env: { SESSION_SECRET: 'local-metrics-build-check-'.repeat(3), ALLOWED_EMAIL_DOMAINS: 'example.invalid',
        ALLOWED_EMAILS: '', METRICS_SCOPE_DIGEST: 'a'.repeat(64), METRICS_REPORTING_PROJECT: '',
        METRICS_REPORTING_DATABASE: '', METRICS_WEB_ORIGIN: 'http://127.0.0.1:3200',
        METRICS_BIGQUERY_ENABLED: 'false', NEXT_TELEMETRY_DISABLED: '1' } },
  ],
});
