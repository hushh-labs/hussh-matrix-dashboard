import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { dashboardNavigation } from '../../src/lib/dashboard-navigation';
import { founder, mockDashboard } from './fixtures';

async function navigate(page: Page, label: string) {
  if (page.viewportSize()!.width < 1280) await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('navigation', { name: 'Dashboard sections' }).getByRole('button', { name: label, exact: true }).click();
  await expect(page.locator('.dashboard-page-heading h1')).toHaveText(label);
  await expect(page.getByText('This page failed to render.')).toHaveCount(0);
}

async function assertFits(page: Page) {
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(dimensions.scroll, 'The page must not overflow the viewport').toBeLessThanOrEqual(dimensions.width + 1);
  for (const table of await page.locator('table:visible').all()) {
    expect(await table.evaluate(element => Boolean(element.closest('.metrics-table-scroll'))), 'Wide tables need an internal scroll region').toBe(true);
  }
}

for (const width of [320, 390, 768, 1024, 1440, 1920]) {
  test(`all main pages fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await mockDashboard(page);
    await page.goto('/');
    await expect(page.locator('.founder-kpi').first()).toBeVisible();
    await mkdir(`.codex/artifacts/ui/${width}`, { recursive: true });
    for (const item of dashboardNavigation) {
      await navigate(page, item.label);
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
      await assertFits(page);
      await page.screenshot({ path: `.codex/artifacts/ui/${width}/${item.key}.png` });
    }
    expect(errors).toEqual([]);
  });
}

test('location routes, environments and browser history work at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockDashboard(page);
  await page.goto('/');
  await expect(page.locator('.founder-kpi').first()).toBeVisible();
  await navigate(page, 'One Location');
  for (const environment of ['production', 'uat']) {
    for (const section of ['overview', 'features', 'circles', 'journey']) {
      await page.goto(`/location-analytics/${environment}${section === 'overview' ? '' : `/${section}`}`);
      await expect(page.locator('.dashboard-page-heading h1')).toHaveText('One Location');
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
      await expect(page.getByText('This page failed to render.')).toHaveCount(0);
      await assertFits(page);
      await page.screenshot({ path: `.codex/artifacts/ui/390/location-${environment}-${section}.png` });
    }
  }
  await page.reload();
  await expect(page.locator('.dashboard-page-heading h1')).toHaveText('One Location');
  await page.goBack();
  await expect(page.locator('.dashboard-page-heading h1')).toHaveText('One Location');
});

test('agent detail pages, feature disclosures and the chat panel fit small screens', async ({ page }) => {
  await mockDashboard(page);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/');
  await expect(page.locator('.founder-kpi').first()).toBeVisible();
  for (const label of ['Finance', 'Consent', 'Gmail', 'Advisor', 'Marketplace', 'Memory', 'Wallet', 'Calendar', 'KYC', 'Connected systems']) {
    await navigate(page, 'One app');
    await page.getByRole('button', { name: `Open detailed ${label} analytics`, exact: true }).click();
    await expect(page.getByRole('button', { name: /back/i }).first()).toBeVisible();
    await expect(page.getByText('This page failed to render.')).toHaveCount(0);
    await assertFits(page);
    const detail = page.getByRole('button', { name: /^View details for / }).first();
    if (await detail.count()) { await detail.click(); await assertFits(page); }
    await page.getByRole('button', { name: /back/i }).first().click();
  }
  for (const width of [320, 640, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('button', { name: 'Open Matrix Agent One', exact: true }).click();
    const panel = page.getByRole('dialog', { name: 'Matrix Agent One', exact: true });
    await expect(panel).toBeVisible();
    const bounds = await panel.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(-1);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
    await assertFits(page);
    await page.getByRole('button', { name: 'Close Matrix Agent One', exact: true }).click();
  }
});

test('mobile drawer and search trap focus, close on Escape and restore focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockDashboard(page); await page.goto('/');
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Dashboard navigation' })).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('#dashboard-navigation')))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeFocused();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('searchbox', { name: 'Search dashboard pages' })).toBeFocused();
  await page.getByRole('searchbox').fill('growth');
  await page.keyboard.press('Enter');
  await expect(page.locator('.dashboard-page-heading h1')).toHaveText('Growth');
  await expect(page.getByRole('dialog', { name: 'Find a dashboard page' })).toHaveCount(0);
  await assertFits(page);
});

test('overview keeps additional metrics and source coverage available on demand', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await mockDashboard(page); await page.goto('/');
  await expect(page.locator('.founder-kpi').first()).toBeVisible();
  await navigate(page, 'Analytics overview');
  await page.locator('summary').filter({ hasText: 'More product metrics' }).click();
  await expect(page.getByText('hushhtech.com Users', { exact: true })).toBeVisible();
  await page.locator('summary').filter({ hasText: 'Data sources and coverage' }).click();
  await expect(page.getByRole('heading', { name: 'Three-source metrics matrix', exact: true })).toBeVisible();
  await assertFits(page);
});

test('sidebar collapse, persistent theme, charts and date filtering work', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockDashboard(page); await page.goto('/');
  await expect(page.locator('.recharts-surface').first()).toBeVisible();
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  await expect(page.locator('.dashboard-shell')).toHaveClass(/is-collapsed/);
  await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.founder-kpi').first()).toBeVisible();
  await page.screenshot({ path: '.codex/artifacts/ui/founder-dark.png' });
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  const request = page.waitForRequest(request => request.url().includes('/api/analytics/founder?') && request.url().includes('start_date='));
  await page.getByRole('button', { name: 'Last 7 days', exact: true }).click();
  const requested = new URL((await request).url());
  const days = (Date.parse(requested.searchParams.get('end_date')!) - Date.parse(requested.searchParams.get('start_date')!)) / 86_400_000 + 1;
  expect(days).toBe(7);
  await page.getByText('Custom dates or calendar month', { exact: true }).click();
  await expect(page.getByLabel('Choose a month')).toBeVisible();
});

test('missing values stay unavailable and failed requests show a useful state', async ({ page }) => {
  await mockDashboard(page);
  await page.route('**/api/analytics/founder?*', route => route.fulfill({ json: { ...founder, one: { ...founder.one, activeAccounts: { current: null, previous: null } } } }));
  await page.goto('/');
  await expect(page.locator('.founder-kpi-value').first()).toContainText('—');
  await expect(page.locator('.founder-kpi-value').first()).toContainText('Comparison unavailable');
  await page.route('**/api/analytics/founder?*', route => route.fulfill({ status: 503, json: {} }));
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
});

test('sign-in is responsive and retains the server OAuth return path', async ({ page }) => {
  await page.route('**/api/auth/me', route => route.fulfill({ status: 401, json: { authenticated: false } }));
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/?returnTo=%2Flocation-analytics%2Fproduction%2Fcircles');
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    await assertFits(page);
    await page.screenshot({ path: `.codex/artifacts/ui/sign-in-${width}.png` });
  }
  await page.route('**/api/auth/google?*', route => route.fulfill({ contentType: 'text/html', body: '<p>QA OAuth destination</p>' }));
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page).toHaveURL(/api\/auth\/google\?returnTo=%2Flocation-analytics%2Fproduction%2Fcircles/);
});
