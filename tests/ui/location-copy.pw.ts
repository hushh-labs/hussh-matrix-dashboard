import { expect, test } from '@playwright/test';
import { mockDashboard } from './fixtures';

for (const width of [390, 1440]) {
  test(`Save My Soul copy and details work at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.fallback() : route.abort());
    await mockDashboard(page);
    await page.goto('/location-analytics/production/features');
    await expect(page.getByRole('heading', { name: 'One Location', exact: true })).toBeVisible();
    await expect(page.getByText('This page failed to render.')).toHaveCount(0);
    const button = page.getByRole('button', { name: 'View details for Save My Soul', exact: true });
    await expect(button).toBeVisible();
    await expect(page.getByText('Recorded alert attempts. Delivery is unconfirmed.').locator('visible=true')).toBeVisible();
    await expect(page.getByText('SOS triggers recorded.', { exact: false })).toHaveCount(0);
    await button.click();
    await expect(page.getByRole('button', { name: 'Hide details for Save My Soul', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    expect(pageErrors).toEqual([]);
  });
}
