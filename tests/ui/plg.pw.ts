import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { mockDashboard, one } from './fixtures';
import {
  enroll,
  initialPlgState,
  metrics,
  candidate,
  updateContact,
  updateTemplate,
  registerPlgCatalog,
} from '../../src/server/plg/engine';
import { automationStatus } from '../../src/server/plg/automation';

const automationRuntime = { enabled: true, deliveryEnabled: false, origin: 'https://metrics.example.invalid',
  admins: new Set<string>(), operators: new Set<string>(), signingSecret: 'test-only-key-over-32-characters-long',
  webhookSecret: '', apiKey: '', from: 'Rachel Morgan <rachel@example.invalid>', replyTo: 'rachel@example.invalid' };

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
        automation: automationStatus(state, automationRuntime, Date.now()),
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
    } else if (pathname.endsWith('/automation')) {
      state.automation ??= { enabled: false };
      state.automation.enabled = input.enabled;
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
test('shows automation blockers and changes future cycle controls without sending', async ({ page }) => {
  const state = await mockPlg(page);
  const mutations: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET' && path !== '/api/plg/audience') mutations.push(path);
  });
  await page.goto('/plg');
  await page.getByRole('tab', { name: 'Automation', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Automatic follow-up operations' });
  await expect(panel).toContainText('Rachel Morgan');
  await expect(panel).toContainText('Email provider authentication is missing');
  await expect(panel).toContainText('Scheduled worker has not been observed');
  await page.getByRole('button', { name: 'Enable automatic follow-ups', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause automatic follow-ups', exact: true })).toBeVisible();
  expect(state.automation?.enabled).toBe(true);
  await expect(panel).toContainText('Live email delivery is disabled');
  expect(state.deliveries).toHaveLength(0);
  expect(mutations).toEqual(['/api/plg/automation']);
});

test('enrolls an account and operates the shared follow-up queue without sending', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const state = await mockPlg(page);
  const requests: string[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET') requests.push(r.url());
  });
  await page.goto('/plg');
  await page.getByRole('button', { name: 'Campaign follow-up queue', exact: true }).click();
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
  await expect(page.getByRole('tab', { name: 'Users & drop-offs', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Campaign results', exact: true })).toHaveCount(0);
  await expect(page.getByText('Registered person', { exact: true })).toBeVisible();
  await expect(page.getByText('+919876543210', { exact: true })).toBeVisible();
  await expect(page.getByText('Not enrolled in campaigns', { exact: true })).toBeVisible();
  await expect(page.getByText('Distinct verified task outcomes.', { exact: false })).toBeVisible();
  await expect(page.getByText('No verified value observed', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Agent', exact: true }).selectOption('agent_calendar');
  await expect(page.getByRole('combobox', { name: 'Agent', exact: true })).toHaveValue('agent_calendar');
  await page.getByLabel('Task status').selectOption('possible_incomplete');
  await page.getByLabel('Search name, email or phone').fill('+9198');
  await page.getByLabel('Time since start').selectOption('240');
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
  await page.getByRole('tab', { name: 'Messages', exact: true }).click();
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
  await page.getByRole('tab', { name: 'Results', exact: true }).click();
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

test('keeps app-wide accounts and devices separate from the campaign cohort and changes reporting dates', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockPlg(page);
  const reads: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/analytics/one/app') reads.push(request.url());
  });
  await page.goto('/plg');
  expect(reads).toHaveLength(0);
  await page.getByRole('tab', { name: 'Results', exact: true }).click();
  const usage = page.getByRole('region', { name: 'App-wide One usage', exact: true });
  await expect(usage.getByText('8,420', { exact: true })).toBeVisible();
  await expect(usage.getByRole('row', { name: 'Signed-in accounts 148 704 1,284' })).toBeVisible();
  await expect(usage.getByRole('row', { name: 'Device/browser IDs 164 780 1,460' })).toBeVisible();
  await expect(usage).toContainText('latest finalized GA4 day');
  await expect(page.getByText('Enrolled accounts', { exact: true }).locator('..')).toContainText('0');
  await usage.getByLabel('Reporting period').selectOption('7');
  await expect.poll(() => reads.length).toBe(2);
  const query = new URL(reads.at(-1)!).searchParams;
  expect(query.get('environment')).toBe('production');
  expect((Date.parse(query.get('one_end_date')!) - Date.parse(query.get('one_start_date')!)) / 86400000 + 1).toBe(7);
  await expect(usage).not.toHaveAttribute('aria-busy', 'true');
  await mkdir('.codex/artifacts/plg', { recursive: true });
  await page.screenshot({ path: '.codex/artifacts/plg/app-usage-1440.png', fullPage: true });
});

test('shows query failure as unavailable while preserving a healthy selected-range account read', async ({ page }) => {
  await mockPlg(page);
  await page.route('**/api/analytics/one/app?*', (route) => route.fulfill({ json: {
    environment: 'production',
    data: { production: { ...one, activeUsers: { ...one.activeUsers, available: false, dau: 0, wau: 0, mau: 0 },
      identifiedUsers: { ...one.identifiedUsers, activityAvailable: false, dau: 0, wau: 0, mau: 0 } }, uat: null },
    error: 'Sanitized aggregate read failure', fetchedAt: new Date().toISOString(),
  } }));
  await page.goto('/plg');
  await page.getByRole('tab', { name: 'Results', exact: true }).click();
  const usage = page.getByRole('region', { name: 'App-wide One usage', exact: true });
  await expect(usage).toContainText('Some source reads failed');
  await expect(usage.getByRole('row', { name: 'Signed-in accounts Unavailable Unavailable Unavailable' })).toBeVisible();
  await expect(usage.getByText('1,284', { exact: true })).toBeVisible();
  await expect(usage.getByRole('cell', { name: '0', exact: true })).toHaveCount(0);
});

test('withholds app aggregates when a response mixes UAT into a production-only request', async ({ page }) => {
  await mockPlg(page);
  await page.route('**/api/analytics/one/app?*', (route) => route.fulfill({ json: {
    environment: 'production', data: { production: one, uat: one }, error: null,
  } }));
  await page.goto('/plg');
  await page.getByRole('tab', { name: 'Results', exact: true }).click();
  const usage = page.getByRole('region', { name: 'App-wide One usage', exact: true });
  await expect(usage).toContainText('Production aggregates are unavailable. No zero is inferred.');
  await expect(usage.getByText('8,420', { exact: true })).toHaveCount(0);
  await expect(usage.getByText('1,284', { exact: true })).toHaveCount(0);
});

for (const width of [320, 768, 1440])
  test(`PLG views fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await mockPlg(page, false, true);
    await page.goto('/plg');
    await expect(page.getByText('Registered person', { exact: true })).toBeVisible();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    for (const label of ['Users & drop-offs', 'Messages', 'Results', 'Automation']) {
      await page.getByRole('tab', { name: label, exact: true }).click();
      if (label === 'Users & drop-offs') {
        await expect(page.getByText('Registered person', { exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Campaign follow-up queue', exact: true }).click();
        await expect(page.getByText('Your first cohort starts here')).toBeVisible();
        await page.getByRole('button', { name: 'Back to users', exact: true }).click();
      }
      if (label === 'Results') {
        await page.getByRole('button', { name: 'View tracking coverage', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Agents and actions', exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Back to results', exact: true }).click();
      }
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
  await page.getByRole('tab', { name: 'Results', exact: true }).click();
  await page.getByRole('button', { name: 'View tracking coverage', exact: true }).click();
  await expect(page.getByText('Not collected', { exact: true })).toBeVisible();
  await page.getByLabel('Agent filter').selectOption('agent_calendar');
  await page.getByLabel('Search actions').fill('Create event');
  await expect(page.getByText('calendar.event.create', { exact: true })).toBeVisible();
  await page.getByLabel('Inspect account').selectOption(state.contacts[0].id);
  await page.getByRole('button', { name: 'View action activity' }).click();
  await expect(page.getByRole('region', { name: 'All agent activity' }).getByRole('status')).toContainText('collection limit');
  expect(state.contacts[0].firstValueAt).toBeNull();
});
