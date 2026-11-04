import { expect, test, type Page } from '@playwright/test';
import { mockDashboard } from './fixtures';

function snapshot(environment: string, count: number) {
  const at = new Date().toISOString();
  return { environment, checkedAt: at, deliveryAuthorized: false,
    catalog: { revision: 'a'.repeat(64), agents: [{ id: 'agent_one', label: 'One', public: true, available: true }],
      actions: [{ id: 'agent:agent_one', agentId: 'agent_one', label: 'One attempt', kind: 'agent', proof: 'execution_observed' }] },
    activity: { enabled: true, mode: 'best_effort', limited: false, startedAt: at, epoch: 'b'.repeat(64),
      rollups: [{ agentId: 'agent_one', actionId: 'agent:agent_one', source: 'execution_observed', phase: 'returned',
        count, firstAt: at, lastAt: at, days: [at.slice(0, 10)] }] } };
}
const countCell = (page: Page) => page.locator('tbody tr').first().locator('td').nth(4);

for (const environment of ['dev', 'uat', 'production']) {
  test(`${environment} activity refreshes automatically and clears revoked evidence`, async ({ page }) => {
    await mockDashboard(page);
    await page.clock.install();
    let count = 1, revoked = false;
    const endpoint = environment === 'production' ? '/api/plg/my-activity' : `/api/plg/${environment}/my-behaviour`;
    await page.route(`**${endpoint}`, route => {
      expect(route.request().method()).toBe('GET');
      expect(new URL(route.request().url()).search).toBe('');
      return revoked ? route.fulfill({ status: 403, json: { error: 'Access revoked' } })
        : route.fulfill({ json: snapshot(environment, count) });
    });
    await page.goto(environment === 'production' ? '/plg/activity' : `/plg/${environment}`);
    await expect(countCell(page)).toHaveText('1');
    count = 2;
    await page.clock.fastForward(30_001);
    await expect(countCell(page)).toHaveText('2');
    revoked = true;
    await page.clock.fastForward(30_001);
    await expect(page.getByRole('alert')).toContainText('Activity is unavailable');
    await expect(page.getByRole('table')).toHaveCount(0);
  });
}

test('own activity pauses hidden polling and ignores an aborted older response', async ({ page }) => {
  await mockDashboard(page);
  await page.clock.install();
  let reads = 0, count = 1, hold = false, waiting = false, release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/plg/uat/my-behaviour', async route => {
    reads++;
    const delayed = hold && !waiting;
    if (delayed) { waiting = true; await held; }
    await route.fulfill({ json: snapshot('uat', delayed ? 999 : count) }).catch(() => {});
  });
  await page.goto('/plg/uat');
  await expect(countCell(page)).toHaveText('1');
  hold = true;
  await page.clock.fastForward(30_001);
  await expect.poll(() => waiting).toBe(true);
  const readsBeforeHidden = reads;
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
  await page.clock.fastForward(90_000);
  expect(reads).toBe(readsBeforeHidden);
  count = 3;
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(countCell(page)).toHaveText('3');
  release();
  await page.clock.fastForward(1);
  await expect(countCell(page)).toHaveText('3');
});
