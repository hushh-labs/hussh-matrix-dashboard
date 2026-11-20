import { expect, test } from '@playwright/test';
import { founder, mockDashboard } from './fixtures';

test('unavailable search remains neutral and does not invent values', async ({ page }) => {
  await mockDashboard(page);
  await page.route('**/api/analytics/founder?*', route => route.fulfill({ json: { ...founder,
    search: { ...founder.search, available: false, clicks: { current: null, previous: null }, impressions: { current: null, previous: null } } } }));
  await page.goto('/');
  await page.getByText('Search performance', { exact: true }).click();
  await expect(page.getByText('Search data is unavailable or incomplete for this period. No value is estimated.')).toBeVisible();
  const search = page.locator('details').filter({ hasText: 'Search performance' });
  await expect(search.getByText('—', { exact: true })).toHaveCount(2);
});

test('failed refresh identifies retained results as the selected period', async ({ page }) => {
  await mockDashboard(page);
  let calls = 0;
  await page.route('**/api/analytics/founder?*', route => {
    calls++;
    return calls === 1 ? route.fulfill({ json: founder }) : route.fulfill({ status: 503, json: {} });
  });
  await page.goto('/');
  await expect(page.locator('.founder-kpi').first()).toBeVisible();
  await page.getByRole('button', { name: 'Refresh metrics' }).click();
  await expect(page.getByText('Refresh failed. Showing the last available results for the selected period.')).toBeVisible();
  await expect(page.locator('.founder-kpi').first()).toBeVisible();
});
