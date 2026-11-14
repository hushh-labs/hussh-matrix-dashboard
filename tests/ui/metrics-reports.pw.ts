import { createHmac } from 'node:crypto';
import { expect, test } from '@playwright/test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { metricsHostingGateway } from '../../src/server/reports/hosting-gateway';

const origin = 'http://127.0.0.1:3200';
function fixtureCookie() {
  const body = JSON.stringify({ email: 'staff@example.invalid', exp: Math.floor(Date.now() / 1000) + 60 });
  return `s:${body}.${createHmac('sha256', 'local-metrics-build-check-'.repeat(3)).update(body).digest('base64url')}`;
}
test('production Metrics build protects APIs and renders honest unavailable reports', async ({ page, context, request }) => {
  const anonymous = await request.get(`${origin}/api/reports/one.adoption?startDate=2026-11-10&endDate=2026-11-11&timezone=UTC`);
  expect(anonymous.status()).toBe(401);
  expect(anonymous.headers()['cache-control']).toContain('no-store');
  const operational = await request.get(`${origin}/plg/uat/workspace`);
  expect(operational.status()).toBe(503); // explicit missing compatibility binding, no legacy/source fallback
  expect(operational.headers()['cache-control']).toContain('no-store');
  const unknown = await request.get(`${origin}/api/analytics/unknown`);
  expect(unknown.status()).toBe(404);
  expect(await unknown.json()).toEqual({ message: 'Not found.' });
  await page.goto(origin);
  await expect(page.getByRole('heading', { name: 'Understand what is working.' })).toBeVisible();
  await context.addCookies([{ name: 'hussh_matrix_session', value: fixtureCookie(), url: origin, httpOnly: true, sameSite: 'Lax' }]);
  await page.goto(`${origin}/?report=hushhai.acquisition&startDate=2026-11-10&endDate=2026-11-11&timezone=UTC`);
  await expect(page.getByRole('heading', { name: 'Product performance' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Report unavailable' })).toBeVisible();
  await expect(page.getByLabel('From', { exact: true })).toHaveValue('2026-11-10');
  await expect(page.getByLabel('Report', { exact: true })).toHaveValue('hushhai.acquisition');
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeDisabled();
  await expect(page.getByRole('option', { name: 'Website activity', exact: true })).toHaveAttribute('value', 'hushhai.activity');
  expect(await page.content()).not.toContain('staff@example.invalid');
  const signed = await context.request.get(`${origin}/api/reports/one.adoption?startDate=2026-11-10&endDate=2026-11-11&timezone=UTC`);
  expect(signed.status()).toBe(503);
  expect(await signed.json()).toEqual({ state: 'unavailable', message: 'This report is currently unavailable.' });
  const job = await context.request.post(`${origin}/api/report-jobs`, { headers: { origin }, data: { reportId: 'one.adoption' } });
  expect(job.status()).toBe(503);
  await context.clearCookies(); await page.reload();
  await expect(page.getByRole('link', { name: 'Continue with Google' })).toBeVisible();
});

test('retained hosting serves the production Metrics build without a provider fallback', async ({ page, context }) => {
  const nativeOrigin = 'https://metrics-report-web-browser-fixture-uc.a.run.app';
  const app = express(); let legacyCalls = 0, hops = 0;
  app.use(metricsHostingGateway({ METRICS_BIGQUERY_ENABLED: 'false', METRICS_REPORT_WEB_FORWARDING_CONFIG: JSON.stringify({
    approved: true, publicOrigin: 'https://metrics.hussh.ai', webNativeOrigin: nativeOrigin,
    timeoutMs: 5000, maxRequestBytes: 4096, maxResponseBytes: 2_097_152,
  }) }, async () => ({ authorization: 'Bearer synthetic-browser-native-identity' }), async (target, init) => {
    const url = new URL(String(target));
    if (url.origin !== nativeOrigin) throw new Error('Only the fixture web origin may be invoked');
    hops++; return fetch(origin + url.pathname + url.search, init);
  }));
  app.use((_req, res) => { legacyCalls++; res.status(209).json({ retained: true }); });
  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
    const candidate = app.listen(0, '127.0.0.1', () => resolve(candidate));
  });
  const gateway = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const assetStatuses: number[] = [];
  page.on('response', response => { if (response.url().startsWith(gateway + '/_next/static/')) assetStatuses.push(response.status()); });
  try {
    await context.addCookies([{ name: 'hussh_matrix_session', value: fixtureCookie(), url: gateway, httpOnly: true, sameSite: 'Lax' }]);
    await page.goto(gateway + '/?report=one.adoption&startDate=2026-11-10&endDate=2026-11-11&timezone=UTC');
    await expect(page.getByRole('heading', { name: 'Product performance' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Report unavailable' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeDisabled();
    await page.getByLabel('Report', { exact: true }).selectOption('hushhai.activity');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page).toHaveURL(/report=hushhai.activity/);
    const report = await context.request.get(gateway + '/api/reports/one.adoption?startDate=2026-11-10&endDate=2026-11-11&timezone=UTC');
    expect(report.status()).toBe(503); expect(report.headers()['cache-control']).toContain('no-store');
    const oldProvider = await context.request.get(gateway + '/api/analytics/all');
    expect(oldProvider.status()).toBe(404); expect(legacyCalls).toBe(0);
    expect((await context.request.get(gateway + '/api/auth/me')).status()).toBe(209);
    expect(legacyCalls).toBe(1); expect(hops).toBeGreaterThan(2);
    expect(assetStatuses.length).toBeGreaterThan(0); expect(assetStatuses.every(status => status === 200)).toBe(true);
    await context.clearCookies(); await page.reload();
    await expect(page.getByRole('link', { name: 'Continue with Google' })).toBeVisible();
  } finally {
    await page.goto('about:blank');
    await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
  }
});
