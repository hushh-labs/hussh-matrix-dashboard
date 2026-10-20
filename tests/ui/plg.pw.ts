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
  registerPlgCatalog,
} from '../../src/server/plg/engine';

async function mockPlg(page: Page, denied = false, withAgents = false) {
  const state = initialPlgState();
  if (withAgents) registerPlgCatalog(state, { revision: 'a'.repeat(64),
    agents: [{ id: 'agent_calendar', label: 'Calendar', public: true, available: true,
      outcome: { status: 'supported', proof: 'calendar.provider_effect.v1', label: 'Provider-confirmed Calendar change', reason: 'Retained positive evidence only.' } }],
    actions: [{ id: 'calendar.event.create', label: 'Create event', agentId: 'agent_calendar', kind: 'action', proof: 'client_reported' }] });
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
    else if (pathname.endsWith('/activity')) result = { catalog: state.catalog, deleted: false,
      activity: { enabled: true, epoch: 'b'.repeat(64), mode: 'best_effort', limited: true, startedAt: new Date().toISOString(), rollups: [] } };
    else if (pathname.endsWith('/audience')) result = {
      version: 1, environment: 'production', source: 'firebase_registered_accounts', traversal: 'live',
      catalog: { revision: 'a'.repeat(64), agents: [
        { id: 'agent_one', label: 'One', public: true, available: true,
          outcome: { status: 'supported', proof: 'one.distinct_domain_effects.v1', label: 'Distinct verified task outcomes', reason: 'Shared domain effects count once.' } },
        { id: 'agent_calendar', label: 'Calendar', public: true, available: true }],
        actions: [{ id: 'agent:agent_one', agentId: 'agent_one', label: 'One execution', kind: 'agent', proof: 'execution_observed' }] },
      asOf: new Date().toISOString(), windowStart: new Date(Date.now() - 7 * 86400000).toISOString(),
      graceMinutes: input.graceMinutes, scanned: 25, excluded: 0, campaignEnrollmentChanged: false,
      nextCursor: input.cursor ? null : 'page-two.' + 'b'.repeat(64),
      rows: input.cursor ? [] : [{ accountId: 'phone-only', agentId: input.agentId,
        identity: { name: 'Registered person', email: null, emailVerified: false, phoneNumber: '+919876543210', phoneVerified: true, source: 'canonical', updatedAt: null },
        activity: { coverage: 'observed', mode: 'best_effort', counts: { started: 1, returned: 0, failed: 0, cancelled: 0, blocked: 0, possibleIncomplete: 1, inProgress: 0, uncorrelated: 0, otherObservations: 0 },
          collectionStartedAt: null, firstAttemptAt: new Date(Date.now() - 7200000).toISOString(), lastObservedAt: new Date(Date.now() - 7200000).toISOString(), lastReturnedAt: null, lastFailureAt: null, lastActionId: 'agent:agent_one' },
        verified: { supported: input.agentId === 'agent_one', ...(input.agentId === 'agent_one' ? { proof: 'one.distinct_domain_effects.v1' } : {}), count: 0, lastAt: null, limited: false } }],
    };
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
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = 'auto';
    (document.activeElement as HTMLElement)?.blur();
    window.scrollTo(0, 0);
  });
  await page.screenshot({ path: '.codex/artifacts/plg/queue-1440.png', fullPage: true });
  await page.getByRole('button', { name: 'Preview next messages' }).click();
  await expect(page.getByRole('region', { name: 'Campaign preview' })).toContainText('0 eligible messages');
  expect(requests.some((url) => url.includes('/run') || url.includes('resend.com'))).toBe(false);
});

test('reads agent people with phone-only identity, filters and live pagination without enrolling', async ({ page }) => {
  const state = await mockPlg(page);
  const bodies: any[] = [], mutations: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/plg/audience')) bodies.push(request.postDataJSON());
    else if (request.method() !== 'GET') mutations.push(request.url());
  });
  await page.goto('/plg');
  await page.getByRole('tab', { name: 'Agent people', exact: true }).click();
  await expect(page.getByText('Registered person', { exact: true })).toBeVisible();
  await expect(page.getByText('+919876543210', { exact: true })).toBeVisible();
  await expect(page.getByText('Not enrolled in campaigns', { exact: true })).toBeVisible();
  await expect(page.getByText('Distinct verified task outcomes.', { exact: false })).toBeVisible();
  await expect(page.getByText('No verified value observed', { exact: true })).toBeVisible();
  await page.getByLabel('People agent').selectOption('agent_calendar');
  await expect(page.getByLabel('People agent')).toHaveValue('agent_calendar');
  await page.getByLabel('Attempt evidence').selectOption('possible_incomplete');
  await page.getByLabel('Search name, email or phone').fill('+9198');
  await page.getByLabel('No terminal observation after').selectOption('240');
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(page.getByText('Registered person', { exact: true })).toBeVisible();
  expect(bodies.at(-1)).toMatchObject({ agentId: 'agent_calendar', segment: 'possible_incomplete', query: '+9198', graceMinutes: 240, cursor: null });
  await page.getByRole('button', { name: 'Next source page' }).click();
  await expect(page.getByText('0 matches on source page 2')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next source page' })).toBeDisabled();
  await page.getByRole('button', { name: 'Previous source page' }).click();
  await expect(page.getByText('Registered person', { exact: true })).toBeVisible();
  expect(state.contacts).toHaveLength(0); expect(state.deliveries).toHaveLength(0);
  expect(mutations).toEqual([]);
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
    await mockPlg(page, false, true);
    await page.goto('/plg');
    await expect(page.getByText('Your first cohort starts here')).toBeVisible();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    for (const label of ['Follow-up queue', 'Journeys and content', 'Results and activity', 'Agents and actions', 'Agent people']) {
      await page.getByRole('tab', { name: label }).click();
      if (label === 'Agent people') await expect(page.getByText('Registered person', { exact: true })).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
        ),
      ).toBe(true);
    }
    await mkdir('.codex/artifacts/plg', { recursive: true });
    await page.evaluate(() => {
      document.documentElement.style.scrollBehavior = 'auto';
      (document.activeElement as HTMLElement)?.blur();
      window.scrollTo(0, 0);
    });
    await page.screenshot({ path: `.codex/artifacts/plg/workspace-${width}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });

test('filters registered actions and inspects limited activity without claiming activation', async ({ page }) => {
  const state = await mockPlg(page, false, true);
  enroll(state, { accountId: 'synthetic-ui-account', email: 'pilot@example.invalid', name: 'Pilot', journey: 'agent_calendar', cohort: 'existing', frequency: 'daily', consent: true, consentSource: 'Synthetic preference form', environment: 'production', internal: false }, 'test-operator', Date.now());
  await page.goto('/plg');
  await page.getByRole('tab', { name: 'Agents and actions' }).click();
  await expect(page.getByText('Not collected', { exact: true })).toBeVisible();
  await page.getByLabel('Agent filter').selectOption('agent_calendar');
  await page.getByLabel('Search actions').fill('Create event');
  await expect(page.getByText('calendar.event.create', { exact: true })).toBeVisible();
  await page.getByLabel('Inspect account').selectOption(state.contacts[0].id);
  await page.getByRole('button', { name: 'View action activity' }).click();
  await expect(page.getByRole('region', { name: 'All agent activity' }).getByRole('status')).toContainText('collection limit');
  expect(state.contacts[0].firstValueAt).toBeNull();
});
