import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { dashboardNavigation } from '../../src/lib/dashboard-navigation';
import { allAnalytics, founder, mockDashboard, one } from './fixtures';

async function navigate(page: Page, label: string) {
  if (page.viewportSize()!.width < 1280) await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('navigation', { name: 'Dashboard sections' }).getByRole('button', { name: label, exact: true }).click();
  await expect(page.locator('.dashboard-page-heading h1')).toHaveText(label);
  await expect(page.getByText('This page failed to render.')).toHaveCount(0);
}

async function assertFits(page: Page) {
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  const heading = (await page.locator('.dashboard-page-heading h1').allTextContents())[0] ?? 'Sign-in';
  expect(dimensions.scroll, `${heading} must not overflow the ${dimensions.width}px viewport`).toBeLessThanOrEqual(dimensions.width + 1);
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
    if (label === 'Finance') await expect(page.getByRole('img', { name: 'Daily agent device trend', exact: true })).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'Where each product’s data comes from', exact: true })).toBeVisible();
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
  const request = page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.pathname === '/api/analytics/founder'
      && (Date.parse(url.searchParams.get('end_date') ?? '') - Date.parse(url.searchParams.get('start_date') ?? '')) / 86_400_000 + 1 === 7;
  });
  await page.getByRole('button', { name: 'Last 7 days', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Last 7 days', exact: true })).toHaveAttribute('aria-pressed', 'true');
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


test('exact-day reporting and adjacent-day controls use existing API date parameters', async ({ page }) => {
  await mockDashboard(page); await page.goto('/');
  await expect(page.locator('.founder-kpi').first()).toBeVisible();
  const requested = page.waitForRequest(request => request.url().includes('/api/analytics/founder?') && new URL(request.url()).searchParams.get('start_date') === '2026-09-30');
  await page.getByLabel('Briefing specific day', { exact: true }).fill('2026-09-30');
  const url = new URL((await requested).url());
  expect(url.searchParams.get('end_date')).toBe('2026-09-30');
  await page.getByRole('button', { name: 'Briefing specific day: next day', exact: true }).click();
  await expect(page.getByLabel('Briefing specific day', { exact: true })).toHaveValue('2026-10-01');
  await page.getByRole('button', { name: 'Latest complete day', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Briefing specific day: next day', exact: true })).toBeDisabled();
  await page.getByText('View daily numbers', { exact: true }).click();
  await expect(page.getByRole('region', { name: 'Daily accounts and feature actions', exact: true })).toBeVisible();
  await navigate(page, 'One app');
  const oneRequest = page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.pathname === '/api/analytics/all' && url.searchParams.get('one_start_date') === '2026-09-30' && url.searchParams.get('one_end_date') === '2026-09-30';
  });
  await page.getByLabel('One app specific day', { exact: true }).fill('2026-09-30');
  await oneRequest;
  await page.getByRole('button', { name: 'One app specific day: previous day', exact: true }).click();
  await expect(page.getByLabel('One app specific day', { exact: true })).toHaveValue('2026-09-29');
  await page.getByText('Custom date range', { exact: true }).click();
  await page.getByLabel('One app start date', { exact: true }).fill('2026-09-25');
  await page.getByLabel('One app end date', { exact: true }).fill('2026-09-30');
  const customRequest = page.waitForRequest(request => request.url().includes('one_start_date=2026-09-25') && request.url().includes('one_end_date=2026-09-30'));
  await page.getByRole('button', { name: 'Apply dates', exact: true }).click();
  await customRequest;
});

test('daily agent traffic shows real drops, withholds missing data and preserves test-source separation', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await mockDashboard(page);
  const daily = [{ eventDate: '2026-09-29', users: 10 }, { eventDate: '2026-09-30', users: 4 }];
  const production = { ...one, capabilities: one.capabilities.map(item => ({ ...item, daily })) };
  await page.route('**/api/analytics/all?*', route => route.fulfill({ json: { ...allAnalytics, one: { platform: 'One', data: { production, uat: null } } } }));
  await page.goto('/'); await navigate(page, 'One app');
  const section = page.getByRole('region', { name: 'Daily agent traffic', exact: true });
  await expect(section.getByRole('heading', { name: 'Which agents gained or lost traffic?' })).toBeVisible();
  const row = section.getByRole('row').filter({ has: page.getByRole('button', { name: 'Explore daily Finance activity', exact: true }) });
  await expect(row).toContainText('-6 (-60.0%)');
  await section.getByRole('button', { name: 'Inspect agent activity on: previous day' }).click();
  await expect(row).toContainText('Unavailable');
  await assertFits(page);
  await page.getByRole('tab', { name: 'Test analytics', exact: true }).click();
  await expect(page.getByText('One app data is unavailable for this selection.', { exact: true })).toBeVisible();
  await expect(section).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to Main analytics' }).click();
  await expect(section).toBeVisible();
});

test('test-source empty cards never substitute production mobile metrics', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await mockDashboard(page);
  const uat = { ...one, sourceWebHost: 'uat.one.hushh.ai', platforms: one.platforms.filter(row => row.platform === 'WEB') };
  await page.route('**/api/analytics/all?*', route => route.fulfill({ json: { ...allAnalytics, one: { platform: 'One', data: { production: one, uat } } } }));
  await page.goto('/'); await navigate(page, 'One app');
  const dates = await page.getByLabel('One app specific day', { exact: true }).inputValue();
  await page.getByRole('tab', { name: 'Test analytics', exact: true }).click();
  const platforms = page.getByRole('region', { name: 'One activity by platform', exact: true });
  await expect(platforms).toContainText('Production metrics are not used as a fallback.');
  await expect(platforms.getByRole('button', { name: 'View captured mobile metrics', exact: true })).toHaveCount(0);
  await expect(platforms).toContainText('No iOS activity in Test analytics for these dates.');
  await expect(platforms).toContainText('No Android activity in Test analytics for these dates.');
  await expect(platforms.getByText('Active app-instance IDs', { exact: true })).toHaveCount(0);
  await assertFits(page);
  await page.getByRole('tab', { name: 'Main analytics', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Main analytics', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(platforms.getByText('Active app-instance IDs', { exact: true })).toHaveCount(2);
  await expect(page.getByLabel('One app specific day', { exact: true })).toHaveValue(dates);
  await assertFits(page);
  const differentRange = { ...one.range, startDate: '2026-01-01', endDate: '2026-01-01' };
  await page.route('**/api/analytics/all?*', route => route.fulfill({ json: { ...allAnalytics, one: { platform: 'One', data: { production: { ...one, range: differentRange }, uat } } } }));
  await page.reload(); await navigate(page, 'One app');
  await page.getByRole('tab', { name: 'Test analytics', exact: true }).click();
  await expect(platforms.getByRole('button', { name: 'View captured mobile metrics', exact: true })).toHaveCount(0);
  await expect(platforms).not.toContainText('activity is available in Main analytics');
});

test('failed daily query cannot appear as zero activity or a confirmed traffic drop', async ({ page }) => {
  await mockDashboard(page);
  await page.route('**/api/analytics/all?*', route => route.fulfill({ json: { ...allAnalytics, one: { platform: 'One', data: { production: { ...one, capabilityDailyAvailable: false }, uat: null } } } }));
  await page.goto('/'); await navigate(page, 'One app');
  const section = page.getByRole('region', { name: 'Daily agent traffic', exact: true });
  await expect(section).toContainText('Daily agent data is unavailable');
  await expect(section.getByRole('table')).toHaveCount(0);
  const finance = page.getByRole('button', { name: 'Open detailed Finance analytics', exact: true });
  await expect(finance).toContainText('Daily trend unavailable');
  await expect(finance.locator('.recharts-surface')).toHaveCount(0);
  await finance.click();
  await expect(page.getByRole('img', { name: 'Daily agent device trend', exact: true })).toHaveCount(0);
});


for (const width of [320, 1440]) {
  test(`all nested Location and agent pages remain usable at ${width}px`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 900 }); await mockDashboard(page);
    for (const environment of ['production', 'uat']) for (const section of ['', '/features', '/circles', '/journey']) {
      await page.goto(`/location-analytics/${environment}${section}`);
      await expect(page.getByRole('heading', { name: 'One Location analytics', exact: true })).toBeVisible();
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
      await assertFits(page);
    }
    for (const label of ['Finance', 'Consent', 'Gmail', 'Advisor', 'Marketplace', 'Memory', 'Wallet', 'Calendar', 'KYC', 'Connected systems']) {
      await navigate(page, 'One app');
      await page.getByRole('button', { name: `Open detailed ${label} analytics`, exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Which agents gained or lost traffic?', exact: true })).toBeVisible();
      await assertFits(page);
      await page.getByRole('button', { name: /back/i }).first().click();
    }
  });
}

test('Instagram filters, pagination, campaign links and metrics chat retain their behavior', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 }); await mockDashboard(page); await page.goto('/');
  await navigate(page, 'Instagram');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('Page 2 of 2', { exact: true })).toBeVisible();
  await page.getByLabel('Type', { exact: true }).selectOption('REELS');
  await expect(page.locator('#instagram-content').getByRole('status')).toContainText('Showing 7 collected items: 7 Reels');
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toHaveCount(0);
  await page.getByLabel('Published', { exact: true }).selectOption('7');
  await page.getByLabel('Sort by', { exact: true }).selectOption('views');
  await page.getByLabel('Campaign name', { exact: true }).fill('release-check');
  await page.getByLabel('Placement or variant', { exact: true }).fill('bio');
  const campaign = page.getByRole('link', { name: /utm_campaign=release-check/ });
  await expect(campaign).toHaveAttribute('href', /utm_source=instagram/);
  await expect(campaign).toHaveAttribute('href', /utm_content=bio/);
  await assertFits(page);
  await page.route('**/api/chat', route => route.fulfill({ json: { reply: 'QA: Daily accounts and devices are different counts.', claims: [], sources: [] } }));
  await page.getByRole('button', { name: 'Open Matrix Agent One', exact: true }).click();
  await page.getByPlaceholder('Message Matrix Agent One...').fill('Explain daily usage');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('QA: Daily accounts and devices are different counts.', { exact: true })).toBeVisible();
});
