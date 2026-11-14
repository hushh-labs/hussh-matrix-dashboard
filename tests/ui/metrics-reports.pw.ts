import { createHmac } from 'node:crypto';
import { expect, test } from '@playwright/test';

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
