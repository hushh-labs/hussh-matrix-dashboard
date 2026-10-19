import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { mockDashboard } from './fixtures';
import {
  enroll,
  initialPlgState,
  metrics,
  candidate,
  updateContact,
  updateTemplate,
} from '../../src/server/plg/engine';

async function mockPlg(page: Page, denied = false) {
  const state = initialPlgState();
  await mockDashboard(page);
  await page.route('**/api/plg/**', async (route) => {
    if (denied)
      return route.fulfill({ status: 403, json: { error: 'This action requires PLG workspace access.' } });
    const request = route.request(),
      pathname = new URL(request.url()).pathname;
    const input = request.method() === 'GET' ? {} : request.postDataJSON();
    let result: unknown = {};
    if (pathname.endsWith('/workspace'))
      result = {
        role: 'admin',
        configured: true,
        deliveryEnabled: false,
        state,
        queue: state.contacts.map((c) => candidate(state, c, Date.now())),
        metrics: metrics(state, Date.now()),
      };
    else if (pathname.endsWith('/contacts')) {
      result = { contact: enroll(state, input, 'test-operator', Date.now()) };
    } else if (pathname.includes('/contacts/'))
      result = {
        contact: updateContact(state, pathname.split('/').at(-1)!, input, 'test-operator', Date.now()),
      };
    else if (pathname.endsWith('/settings')) {
      state.paused = input.paused;
      state.ready = input.ready;
    } else if (pathname.includes('/templates/'))
      result = updateTemplate(state, pathname.split('/').at(-1)!, input, 'test-admin', Date.now());
    else if (pathname.endsWith('/preview'))
      result = { messages: [], candidates: state.contacts.map((c) => candidate(state, c, Date.now(), true)) };
    return route.fulfill({ json: result });
  });
  return state;
}
test('enrolls an account and operates the shared follow-up queue without sending', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const state = await mockPlg(page);
  const requests: string[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET') requests.push(r.url());
  });
  await page.goto('/plg');
  await expect(page.getByText('Your first cohort starts here')).toBeVisible();
  await expect(page.getByText('Live sending disabled')).toBeVisible();
  await page.getByRole('button', { name: 'Enroll account', exact: true }).click();
  await page.getByLabel('Firebase account UID').fill('synthetic-ui-account');
  await page.getByLabel('Email address', { exact: true }).fill('pilot@example.invalid');
  await page.getByLabel('Display name').fill('Pilot account');
  await page.getByLabel('Messaging permission source').fill('Synthetic test preference form');
  await page.getByLabel('Messaging permission is recorded').check();
  await page.getByLabel('I verified this is a production customer account', { exact: false }).check();
  await page.locator('form').getByRole('button', { name: 'Enroll account', exact: true }).click();
  await expect(page.getByText('Pilot account', { exact: true })).toBeVisible();
  await expect(page.locator('tbody').getByText('Activity unknown', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open pilot@example.invalid' }).click();
  await page.getByLabel('Follow-up owner').fill('PLG team');
  await page.getByLabel('Assistance open; pause promotional messages').check();
  await page.getByRole('button', { name: 'Save follow-up' }).click();
  await expect(page.locator('tbody').getByText('PLG team', { exact: true })).toBeVisible();
  expect(state.contacts[0].supportOpen).toBe(true);
  await page.getByRole('button', { name: 'Close account details' }).click();
  await mkdir('.codex/artifacts/plg', { recursive: true });
  await page.screenshot({ path: '.codex/artifacts/plg/queue-1440.png', fullPage: true });
  await page.getByRole('button', { name: 'Preview next messages' }).click();
  await expect(page.getByRole('region', { name: 'Campaign preview' })).toContainText('0 eligible messages');
  expect(requests.some((url) => url.includes('/run') || url.includes('resend.com'))).toBe(false);
});

test('edits content, verifies journeys and leaves immature cohorts unavailable', async ({ page }) => {
  const state = await mockPlg(page);
  await page.goto('/plg');
  await page.getByRole('tab', { name: 'Journeys and content' }).click();
  await page.getByLabel('memory task verified', { exact: false }).check();
  await page.getByRole('button', { name: /memory · demo/ }).click();
  await page.getByLabel('Subject', { exact: true }).fill('Save a useful note with One');
  await page
    .getByLabel('Message', { exact: true })
    .fill('Watch the approved demonstration and try the task.');
  await page.getByLabel('Verified task link on one.hushh.ai').fill('https://one.hushh.ai/?task=memory');
  await page.getByLabel('Publish this reviewed message').check();
  await page.getByRole('button', { name: 'Save message' }).click();
  await expect(page.getByRole('button', { name: 'Save message' })).toHaveCount(0);
  expect(state.ready.memory).toBe(true);
  expect(state.templates.find((t) => t.id === 'memory-demo')!.published).toBe(true);
  await page.getByRole('tab', { name: 'Results and activity' }).click();
  await expect(page.getByText('Waiting for mature cohorts')).toHaveCount(2);
  await expect(page.getByText('Twenty percent of accounts', { exact: false })).toBeVisible();
});

test('does not expose contacts to an unauthorized dashboard viewer', async ({ page }) => {
  await mockPlg(page, true);
  await page.goto('/plg');
  await expect(page.getByRole('heading', { name: 'Private PLG workspace' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enroll account', exact: true })).toHaveCount(0);
  await expect(page.getByText('pilot@example.invalid')).toHaveCount(0);
});

for (const width of [320, 768, 1440])
  test(`PLG views fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await mockPlg(page);
    await page.goto('/plg');
    await expect(page.getByText('Your first cohort starts here')).toBeVisible();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    for (const label of ['Follow-up queue', 'Journeys and content', 'Results and activity']) {
      await page.getByRole('tab', { name: label }).click();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
        ),
      ).toBe(true);
    }
    await mkdir('.codex/artifacts/plg', { recursive: true });
    await page.screenshot({ path: `.codex/artifacts/plg/workspace-${width}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
