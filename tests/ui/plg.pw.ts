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
import type { PlgAudienceFilters, PlgAudiencePage, PlgAutomationStatus, PlgWorkspace, PlgDelivery } from '../../src/lib/plg';
import type { PlgRuntime } from '../../src/server/plg/service';
import { decodeWorkspacePage, encodeWorkspacePages } from '../../src/server/plg/workspace-pages';

const automationRuntime = { enabled: true, deliveryEnabled: false, origin: 'https://metrics.example.invalid',
  admins: new Set<string>(), operators: new Set<string>(), signingSecret: 'test-only-key-over-32-characters-long',
  webhookSecret: '', apiKey: '', from: 'Neelesh Meena <i-neelesh@hushh.ai>', replyTo: 'i-neelesh@hushh.ai' };

async function mockPlg(page: Page, denied = false, withAgents = false,
  audience?: (input: PlgAudienceFilters, result: PlgAudiencePage) => PlgAudiencePage | Promise<PlgAudiencePage>, mailOwner = false,
  automation?: { runtime?: Partial<PlgRuntime>; feedback?: PlgAutomationStatus['emailFeedback']; blockers?: string[] }) {
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
    const runtime = { ...automationRuntime, ...automation?.runtime };
    let result: unknown = {};
    if (pathname.endsWith('/workspace'))
      result = {
        role: 'admin',
        configured: true,
        deliveryEnabled: runtime.deliveryEnabled,
        mailOwner,
        automation: { ...automationStatus(state, runtime, Date.now()),
          ...(automation?.feedback ? { emailFeedback: automation.feedback } : {}),
          ...(automation?.blockers ? { blockers: automation.blockers } : {}) },
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
      if (input.staffTestingEnabled !== undefined) state.staffTestingEnabled = input.staffTestingEnabled;
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
      version: 1, environment: 'production', customerReporting: { scope: 'production_registered_contacts', policyRevision: 'd'.repeat(64) }, source: 'firebase_registered_accounts', traversal: 'live',
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
    if (pathname.endsWith('/audience') && audience) result = await audience(input, result as PlgAudiencePage);
    return route.fulfill({ json: result });
  });
  return state;
}

test('pages the complete campaign queue and independent history while retaining global results', async ({ page }) => {
  let offPageId = '';
  const state = await mockPlg(page, false, false, (_input, result) => ({ ...result,
    rows: result.rows.map(row => ({ ...row, campaignContactId: offPageId })) }));
  for (let n = 0; n < 33; n++) {
    const contact = enroll(state, { accountId: `page-${n}`, email: `page-${n}@example.invalid`, name: `Page ${n}`,
      journey: 'memory', cohort: 'new', frequency: 'daily', consent: true, consentSource: 'Synthetic UI test',
      environment: 'production', internal: false }, 'Fixture', Date.now());
    contact.group = 'treatment';
  }
  offPageId = state.contacts[32].id;
  const requests: { path: string; body: any }[] = [], generation = 'a'.repeat(64), secret = automationRuntime.signingSecret;
  await page.route(/\/api\/plg\/workspace(?:\/query)?$/, async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const body = request.method() === 'GET' ? {} : request.postDataJSON(); requests.push({ path, body });
    const query = request.method() === 'GET' ? {} : decodeWorkspacePage(body, 'operator@example.invalid', secret);
    const matching = state.contacts.filter(contact => !query.contactId || contact.id === query.contactId)
      .filter(contact => contact.email.includes(query.query ?? ''));
    const contacts = matching.slice(query.after ? 25 : 0, query.after ? 50 : 25);
    const history = Array.from({ length: query.historyAfter ? 2 : 25 }, (_, n): PlgDelivery => ({
      id: `receipt-${n + (query.historyAfter ? 25 : 0)}`, contactId: offPageId, templateId: 'memory-welcome',
      key: `synthetic-${n}`, step: 'welcome', status: 'sent', createdAt: new Date().toISOString(), providerId: `accepted-${n}`,
      subject: 'Synthetic', body: 'Synthetic', ctaLabel: 'Open', ctaUrl: 'https://one.hussh.ai/',
    }));
    const totals = { enrolled: 1001, observed: 200, activated: 100, repeat: 50,
      activationEligible: 0, activationConverted: 0, retentionEligible: 0, retained: 0 };
    const result: PlgWorkspace = { configured: true, deliveryEnabled: false, role: 'operator', metrics: totals,
      queue: contacts.map(contact => candidate(state, contact, Date.now())), state: { ...state, contacts, deliveries: history,
        storage: { mode: 'accounts', generation, report: { asOf: new Date().toISOString(), metrics: totals,
          reporting: { pending: 0, excluded: 0 }, eligible: 0, blockedReasons: [],
          cohorts: [{ cohort: 'new', group: 'treatment', enrolled: 1001, activated: 100, repeat: 50 }],
          activity: { connectedAccounts: 0, agents: [] }, contacts: { nextAfter: !query.after && matching.length > 25 ? 'b'.repeat(64) : null,
            matches: matching.length, checked: 1001 }, history: { nextAfter: query.historyAfter ? null :
              { createdAt: history[24].createdAt, id: history[24].id }, emails: { [offPageId]: 'page-32@example.invalid' } } } } } };
    await route.fulfill({ json: encodeWorkspacePages(result, query, 'operator@example.invalid', secret) });
  });
  await page.goto('/plg');
  // Source-directory enrollment resolves independently of the first 25 queue contacts.
  await page.getByRole('button', { name: 'Open follow-up', exact: true }).click();
  await expect(page.getByLabel('Follow-up owner')).toBeVisible();
  expect(requests.at(-1)?.body.contactId).toBe(offPageId);
  await page.getByRole('button', { name: 'Close account details' }).click();
  const queuePages = page.getByLabel('Campaign queue pages');
  await expect(queuePages).toContainText('33 matching accounts');
  await page.getByRole('button', { name: 'Next queue page', exact: true }).click();
  await expect(page.locator('tbody').getByText('Page 32', { exact: true })).toBeVisible();
  await expect(queuePages).toContainText('page 2');
  await page.getByRole('button', { name: 'Previous queue page', exact: true }).click();
  await expect(page.locator('tbody').getByText('Page 0', { exact: true })).toBeVisible();
  await page.getByLabel('Search enrolled accounts').fill('page-32@');
  await expect(page.locator('tbody').getByText('Page 0', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Apply queue filters', exact: true }).click();
  await expect(queuePages).toContainText('1 matching account');
  await expect(page.locator('tbody').getByText('Page 32', { exact: true })).toBeVisible();
  expect(requests.at(-1)?.body).toMatchObject({ query: 'page-32@', queueCursor: null });
  await page.getByRole('tab', { name: 'Results', exact: true }).click();
  await expect(page.getByText('Enrolled accounts', { exact: true }).locator('..')).toContainText('1001');
  const deliveryTable = page.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'Provider reference', exact: true }) });
  await expect(deliveryTable.locator('tbody tr')).toHaveCount(25);
  await expect(deliveryTable.locator('tbody tr').first()).toContainText('page-32@example.invalid');
  await page.getByRole('button', { name: 'Next history page', exact: true }).click();
  await expect(deliveryTable.locator('tbody tr')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Next history page', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Previous history page', exact: true }).click();
  await expect(deliveryTable.locator('tbody tr')).toHaveCount(25);
  await expect(page.getByText('Enrolled accounts', { exact: true }).locator('..')).toContainText('1001');
  expect(requests.every(request => request.path === '/api/plg/workspace' || request.path === '/api/plg/workspace/query')).toBe(true);
});

test('keeps work-mail previews separate and distinguishes acceptance from inbox confirmation', async ({ page }) => {
  const state = await mockPlg(page, false, false, undefined, true);
  const before = JSON.stringify(state);
  let receipt: string | null = null;
  let reportsRequested = false;
  const submissions: unknown[] = [];
  await page.route('**/api/plg/google-mail/status', (route) => route.fulfill({ json: {
    email: 'i-neelesh@hushh.ai', connected: true, connectedAt: Date.now(), pending: false,
    reportReadingRequested: reportsRequested, feedbackAuthorized: false, feedbackCheckedAt: null, feedbackBacklog: false,
  } }));
  await page.route('**/api/plg/mail-tests', (route) => {
    if (route.request().method() === 'POST') {
      submissions.push(route.request().postDataJSON()); receipt = 'accepted';
      return route.fulfill({ status: 202, json: { test: { status: receipt } } });
    }
    return route.fulfill({ json: { tests: receipt ? [{ id: 'isolated-test', step: 'welcome', subject: '[PLG TEST]',
      status: receipt, createdAt: Date.now(), confirmedAt: null }] : [] } });
  });
  await page.goto('/plg');
  await page.getByRole('tab', { name: 'Automation', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Google work mailbox' });
  await expect(panel).toContainText('Customer bounce handling must pass a separate release gate');
  await panel.getByRole('button', { name: 'Send preview to my work email' }).click();
  await expect(panel).toContainText('welcome · accepted');
  expect(submissions).toEqual([{ templateId: state.templates[0].id }]);
  receipt = 'inbox_confirmed';
  reportsRequested = true;
  await panel.getByRole('button', { name: 'Check connection and receipts' }).click();
  await expect(panel).toContainText('welcome · inbox confirmed');
  await expect(panel).toContainText('read-only mail access');
  await expect(panel).toContainText('requires Google consent');
  await expect(panel).toContainText('Reconnect required');
  expect(JSON.stringify(state)).toBe(before);
});
test('lets a staff operator check only their own activity without mailbox privileges or sending', async ({ page }) => {
  await mockPlg(page);
  const writes: string[] = [], mailboxReads: string[] = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/plg/') && request.method() !== 'GET' && path !== '/api/plg/audience') writes.push(path);
    if (path.includes('/google-mail/') || path.endsWith('/mail-tests')) mailboxReads.push(path);
  });
  await page.route('**/api/plg/my-behaviour', route => {
    expect(new URL(route.request().url()).search).toBe('');
    return route.fulfill({ json: { environment: 'production', checkedAt: new Date().toISOString(), since: new Date().toISOString(), limited: true,
      observations: [{ agentId: 'agent_personal_information', label: 'Memory',
        reported: { started: 2, returned: 1, failed: 0, cancelled: 1, blocked: 0 },
        executed: { started: 3, returned: 1, failed: 1, cancelled: 0, blocked: 1 } }],
      captureEnabled: true, captureEpochPresent: true, positives: [{ agentId: 'agent_personal_information',
        label: 'Memory', count: 1, lastAt: new Date().toISOString(), currentCapture: true }] } });
  });
  await page.goto('/plg');
  await page.getByRole('tab', { name: 'Automation', exact: true }).click();
  await page.getByText('Check my One activity', { exact: true }).click();
  await page.getByRole('button', { name: 'Check my activity', exact: true }).click();
  await expect(page.getByText(/Memory: 1 confirmed action/)).toBeVisible();
  await page.getByText('Captured observations by agent', { exact: true }).click();
  await expect(page.getByRole('cell', { name: '2 / 3', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Cancelled', exact: true })).toBeVisible();
  await expect(page.getByText('Collection limit reached; this observation window is incomplete.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send preview to my work email' })).toHaveCount(0);
  expect(writes).toEqual([]);
  expect(mailboxReads).toEqual([]);
});

test('switches staff testing explicitly without altering customer totals or dispatching email', async ({ page }) => {
  const state = await mockPlg(page), before = metrics(state, Date.now()), writes: string[] = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/plg/') && request.method() !== 'GET' && path !== '/api/plg/audience') writes.push(path);
  });
  await page.goto('/plg');
  await page.getByRole('tab', { name: 'Automation', exact: true }).click();
  await page.getByRole('button', { name: 'Staff testing: Off', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Staff testing: On', exact: true })).toBeVisible();
  expect(state.staffTestingEnabled).toBe(true);
  await page.getByRole('button', { name: 'Staff testing: On', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Staff testing: Off', exact: true })).toBeVisible();
  expect(state.staffTestingEnabled).toBe(false);
  expect(state.deliveries).toHaveLength(0);
  expect(metrics(state, Date.now())).toEqual(before);
  expect(writes).toEqual(['/api/plg/settings', '/api/plg/settings']);
});

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
  await expect(panel).toContainText('Neelesh Meena');
  await expect(panel).toContainText('Email provider authentication is missing');
  await expect(panel).toContainText('Scheduled worker has not been observed');
  await page.getByRole('button', { name: 'Enable automatic follow-ups', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause automatic follow-ups', exact: true })).toBeVisible();
  expect(state.automation?.enabled).toBe(true);
  await expect(panel).toContainText('Live email delivery is disabled');
  await expect(panel.getByText('Customer email delivery', { exact: true }).locator('..')).toHaveText('Customer email deliveryOff');
  await expect(panel).toContainText('Waiting for the first account with recorded email permission');
  await expect(panel.getByRole('listitem').filter({ hasText: 'No permission-backed accounts are enrolled' })).toHaveCount(0);
  await panel.getByText('Delivery and activity details', { exact: true }).click();
  await expect(panel).toContainText('Email connection details are unavailable. Check the configured email connection before sending.');
  expect(state.deliveries).toHaveLength(0);
  expect(mutations).toEqual(['/api/plg/automation']);
});

test('refreshes mounted automation from read-only status checks and preserves message drafts', async ({ page }) => {
  await page.clock.install();
  const state = await mockPlg(page);
  let reads = 0;
  const mutations: string[] = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path === '/api/plg/workspace' && request.method() === 'GET') reads++;
    if (path.startsWith('/api/plg/') && request.method() !== 'GET' && path !== '/api/plg/audience') mutations.push(path);
  });
  await page.goto('/plg');
  const automationTab = page.getByRole('tab', { name: 'Automation', exact: true });
  await expect(automationTab).toBeVisible();
  const entryRead = page.waitForResponse(response => new URL(response.url()).pathname === '/api/plg/workspace' && response.request().method() === 'GET');
  await automationTab.click();
  await (await entryRead).finished();
  const panel = page.getByRole('region', { name: 'Automatic follow-up operations' });
  await expect(panel.getByRole('button', { name: 'Enable automatic follow-ups', exact: true })).toBeVisible();
  await expect(panel).toContainText('Status checked');
  state.automation = { enabled: true };
  const before = reads;
  await page.clock.fastForward(31_000);
  await expect(panel.getByRole('button', { name: 'Pause automatic follow-ups', exact: true })).toBeVisible();
  expect(reads).toBeGreaterThan(before);
  expect(mutations).toEqual([]);

  await page.getByRole('tab', { name: 'Messages', exact: true }).click();
  await page.getByRole('button', { name: /^memory · welcome / }).click();
  await page.getByLabel('Subject', { exact: true }).fill('Unsaved operator draft');
  const editingReads = reads;
  await page.clock.fastForward(90_000);
  await expect(page.getByLabel('Subject', { exact: true })).toHaveValue('Unsaved operator draft');
  expect(reads).toBe(editingReads);
  expect(mutations).toEqual([]);
});

test('a rejected automatic status read clears private workspace state instead of claiming freshness', async ({ page }) => {
  await page.clock.install();
  await mockPlg(page);
  await page.goto('/plg');
  const automationTab = page.getByRole('tab', { name: 'Automation', exact: true });
  await expect(automationTab).toBeVisible();
  const entryRead = page.waitForResponse(response => new URL(response.url()).pathname === '/api/plg/workspace' && response.request().method() === 'GET');
  await automationTab.click();
  await (await entryRead).finished();
  await expect(page.getByRole('region', { name: 'Automatic follow-up operations' })).toContainText('Status checked');
  await page.route('**/api/plg/workspace', route => route.fulfill({ status: 403, json: { error: 'Workspace authorization ended.' } }));
  await page.clock.fastForward(31_000);
  await expect(page.getByRole('heading', { name: 'Private PLG workspace', exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Workspace authorization ended.' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Automatic follow-up operations' })).toHaveCount(0);
});

test('separates Google permission and sending state from an enabled scheduler and empty cohort', async ({ page }) => {
  const options = { runtime: { emailProvider: 'google_workspace' as const, deliveryEnabled: false,
    googleMailCampaignsEnabled: true, subscriptions: { enabled: true, url: '', secret: '' } },
    feedback: { provider: 'google_workspace' as const, authorized: false, checkedAt: null as number | null, backlog: false },
    blockers: ['Live email delivery is disabled', 'Google feedback authorization or current complete checkpoint is missing', 'No permission-backed accounts are enrolled'] };
  const state = await mockPlg(page, false, false, undefined, false, options);
  state.paused = false;
  state.automation = { enabled: true, lastCycle: { id: 'synthetic-cycle', startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(), status: 'blocked', accounts: 0, sent: 0, uncertain: 0,
    reason: 'Signed delivery callbacks are not configured' } };
  const errors: string[] = [];
  const warnings: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
    if (message.type() === 'warning') warnings.push(message.text());
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/plg');
  await page.getByRole('tab', { name: 'Automation', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Automatic follow-up operations' });
  await expect(page).toHaveTitle(/hussh/i);
  await expect(panel.getByText('Scheduled checks', { exact: true }).locator('..')).toHaveText('Scheduled checksOn');
  await expect(panel.getByText('Customer email delivery', { exact: true }).locator('..')).toHaveText('Customer email deliveryOff');
  await expect(panel).toContainText('Google feedback authorization or current complete checkpoint is missing');
  await expect(panel.getByRole('listitem').filter({ hasText: /Signed delivery callbacks are not configured|No permission-backed accounts are enrolled/ })).toHaveCount(0);
  await expect(panel.getByText('Recorded reason for that cycle:', { exact: false })).not.toBeVisible();
  await page.screenshot({ path: test.info().outputPath('google-sending-held-desktop.png'), fullPage: true });
  await panel.getByText('Delivery and activity details', { exact: true }).click();
  await expect(panel).toContainText('Google bounce checks: Read permission required');
  await expect(panel).toContainText('Gmail polling reads structured failure reports');
  await expect(panel).not.toContainText('Email connection details are unavailable');
  await expect(panel).not.toContainText('Domain verification');
  await expect(panel).toContainText('Recorded reason for that cycle: Signed delivery callbacks are not configured');

  options.runtime.deliveryEnabled = true;
  options.feedback.authorized = true;
  options.feedback.checkedAt = Date.now();
  options.blockers = ['No permission-backed accounts are enrolled'];
  // A fresh API refresh can enable sending without inventing an enrollment.
  await panel.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await expect(panel.getByText('Customer email delivery', { exact: true }).locator('..')).toContainText('Enabled; eligibility checks apply');
  await expect(panel.getByRole('heading', { name: 'Needs attention before sending' })).toHaveCount(0);
  await expect(panel).toContainText('Waiting for the first account with recorded email permission');
  await expect(panel).toContainText('Google bounce checks: Read permission granted');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel.getByRole('button', { name: 'Pause automatic follow-ups' })).toBeVisible();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('google-empty-cohort-mobile.png'), fullPage: true });
  expect(state.contacts).toHaveLength(0);
  expect(state.deliveries).toHaveLength(0);
  expect(errors).toEqual([]);
  // The suite deliberately enables reduced motion; Motion explains that setting in development.
  expect(warnings.filter(message => !message.startsWith('You have Reduced Motion enabled on your device.'))).toEqual([]);
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
  await expect(page.getByText('No accounts enrolled in follow-ups yet')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run campaign', exact: true })).toHaveCount(0);
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

  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = 'auto';
    (document.activeElement as HTMLElement)?.blur();
    window.scrollTo(0, 0);
  });
  await page.screenshot({ path: test.info().outputPath('queue-1440.png'), fullPage: true });
  await page.getByRole('tab', { name: 'Messages', exact: true }).click();
  await expect(page.getByText('Live sending disabled', { exact: true })).toBeVisible();
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
  await page.getByText('How to read activity and completions', { exact: true }).click();
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
  await expect(page.getByText('0 accounts in this result')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next source page' })).toBeDisabled();
  await page.getByRole('button', { name: 'Previous source page' }).click();
  await expect(page.getByText('Registered person', { exact: true })).toBeVisible();
  expect(state.contacts).toHaveLength(0); expect(state.deliveries).toHaveLength(0);
  expect(mutations).toEqual([]);
});

test('starts with people and searches beyond empty filtered source pages without stale results', async ({ page }) => {
  const cursors: (string | null | undefined)[] = [];
  await mockPlg(page, false, false, (input, result) => {
    if (input.segment !== 'failed') return result;
    cursors.push(input.cursor);
    const index = input.cursor ? Number(input.cursor.slice(5)) : 0;
    return { ...result, scanned: 25, nextCursor: index < 2 ? `scan-${index + 1}` : null,
      rows: index < 2 ? [] : ['Later match', 'Another match'].map((name, i) => ({ ...result.rows[0], accountId: `later-match-${i}`, agentId: input.agentId,
        identity: { name, email: null, emailVerified: false, phoneNumber: null,
          phoneVerified: false, source: 'canonical', updatedAt: null },
        activity: { coverage: 'observed', mode: 'best_effort', counts: { started: 1, returned: 0, failed: 1, cancelled: 0, blocked: 0, possibleIncomplete: 0, inProgress: 0, uncorrelated: 0, otherObservations: 0 },
          collectionStartedAt: null, firstAttemptAt: null, lastObservedAt: null, lastReturnedAt: null, lastFailureAt: null, lastActionId: null },
        verified: { supported: false, count: 0, lastAt: null, limited: false } })) };
  });
  await page.goto('/plg');
  await expect(page.getByRole('tab', { name: 'Users & drop-offs', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Registered person', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Enrolled campaign accounts only')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Agent', exact: true }).selectOption('agent_calendar');
  await page.getByLabel('Task status').selectOption('failed');
  await expect(page.getByText('Registered person', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Filters changed. Apply filters to update the results.')).toBeVisible();
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(page.getByText('Later match', { exact: true })).toBeVisible();
  expect(cursors).toEqual([null, 'scan-1', 'scan-2']);
  await expect(page.getByText('Checked 75 source accounts', { exact: false })).toBeVisible();
  await expect(page.getByText('Another match', { exact: true })).toBeVisible();
  await expect(page.getByText('This connection does not provide verified completion tracking for Calendar.', { exact: false })).toHaveCount(1);
  await expect(page.getByText('Starts 1', { exact: false })).toHaveCount(2);
  await expect(page.getByText('No verified value observed', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Business completion is not measured for this agent', { exact: false })).toHaveCount(0);
  await expect(page.getByText('Completion definition', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Next source page' })).toBeDisabled();
});

test('keeps missing collection baselines distinct from measured zero usage', async ({ page }) => {
  await mockPlg(page, false, false, (_input, result) => ({ ...result,
    rows: result.rows.map((person) => ({ ...person, activity: { ...person.activity,
      coverage: 'not_started', firstAttemptAt: null, lastObservedAt: null, lastActionId: null,
      counts: { started: 0, returned: 0, failed: 0, cancelled: 0, blocked: 0, possibleIncomplete: 0, inProgress: 0, uncorrelated: 0, otherObservations: 0 },
    } })) }));
  await page.goto('/plg');
  await expect(page.getByText('This result cannot establish zero usage.', { exact: false })).toBeVisible();
  await expect(page.getByText('No collection baseline', { exact: true })).toBeVisible();
  await expect(page.getByText('Starts 0', { exact: false })).toHaveCount(0);
});

test('retains the partial-count warning when execution collection is limited', async ({ page }) => {
  await mockPlg(page, false, false, (_input, result) => ({ ...result,
    rows: result.rows.map((person) => ({ ...person, activity: { ...person.activity, coverage: 'limited' } })) }));
  await page.goto('/plg');
  await expect(page.getByText('Activity collection limit reached; these counts are partial.', { exact: true })).toBeVisible();
  await expect(page.getByText('Starts 1', { exact: false })).toBeVisible();
});

test('keeps a bounded empty search resumable instead of claiming a global zero', async ({ page }) => {
  const cursors: (string | null | undefined)[] = [];
  await mockPlg(page, false, false, (input, result) => {
    if (!input.query) return result;
    cursors.push(input.cursor);
    const index = input.cursor ? Number(input.cursor.slice(5)) : 0;
    return { ...result, scanned: 25, rows: [], nextCursor: `scan-${index + 1}` };
  });
  await page.goto('/plg');
  await expect(page.getByText('Registered person', { exact: true })).toBeVisible();
  await page.getByLabel('Search name, email or phone').fill('Synthetic filter');
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(page.getByText('No matches in the accounts checked so far.', { exact: false })).toBeVisible();
  expect(cursors).toHaveLength(160); expect(cursors[0]).toBeNull(); expect(cursors.at(-1)).toBe('scan-159');
  await expect(page.getByText('Checked 4000 source accounts', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next source page' })).toBeEnabled();
  await page.getByRole('button', { name: 'Next source page' }).click();
  await expect(page.getByText('No matches in the accounts checked so far.', { exact: false })).toBeVisible();
  expect(cursors.at(160)).toBe('scan-160');
  await expect(page.getByRole('button', { name: 'Previous source page' })).toBeEnabled();
});

test('finds a filtered account beyond the first 150 source accounts without another click', async ({ page }) => {
  let match: PlgAudiencePage['rows'][number];
  await mockPlg(page, false, false, (input, result) => {
    if (input.segment !== 'failed') { match = result.rows[0]; return result; }
    const index = input.cursor ? Number(input.cursor.slice(5)) : 0;
    return { ...result, scanned: 25, nextCursor: index < 7 ? `late-${index + 1}` : null,
      rows: index === 7 ? [{ ...match, accountId: 'synthetic-late-match',
        identity: { ...match.identity, name: 'Late filtered account' },
        activity: { ...match.activity, counts: { ...match.activity.counts, failed: 1 } } }] : [] };
  });
  await page.goto('/plg');
  await expect(page.getByText('Registered person', { exact: true })).toBeVisible();
  await page.getByLabel('Task status').selectOption('failed');
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(page.getByText('Late filtered account', { exact: true })).toBeVisible();
  await expect(page.getByText('Checked 200 source accounts', { exact: false })).toBeVisible();
  await mkdir('.codex/artifacts/ui', { recursive: true });
  await page.screenshot({ path: '.codex/artifacts/ui/plg-deep-filter-search.png', fullPage: false });
});

test('pauses a filtered search at its confirmed cursor and ignores its late response', async ({ page }) => {
  let release: () => void = () => {}, ready: () => void = () => {};
  const waiting = new Promise<void>(resolve => { ready = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  let first = true;
  await mockPlg(page, false, false, async (input, result) => {
    if (input.segment !== 'failed') return result;
    const index = input.cursor ? Number(input.cursor.slice(5)) : 0;
    if (index === 2 && first) { first = false; ready(); await held; }
    return { ...result, scanned: 25, rows: [], nextCursor: index < 3 ? `part-${index + 1}` : null };
  });
  await page.goto('/plg');
  await expect(page.getByText('Registered person', { exact: true })).toBeVisible();
  await page.getByLabel('Task status').selectOption('failed');
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await waiting;
  await page.getByRole('button', { name: 'Pause search', exact: true }).click(); release();
  await expect(page.getByText('Search paused.', { exact: false })).toBeVisible();
  await expect(page.getByText('Checked 50 source accounts', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Next source page', exact: true }).click();
  await expect(page.getByText('Reached the end of this directory traversal.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next source page' })).toBeDisabled();
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

test('filters the message library and closes a draft from the previous journey', async ({ page }) => {
  await mockPlg(page);
  await page.goto('/plg');
  await page.getByRole('tab', { name: 'Messages', exact: true }).click();
  await expect(page.getByRole('button', { name: /Show all .* message templates/ })).toBeVisible();
  await page.getByRole('button', { name: /^memory · demo/ }).click();
  await expect(page.getByRole('button', { name: 'Save message' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Message journey', exact: true }).selectOption('mail');
  await expect(page.getByRole('button', { name: 'Save message' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^memory ·/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^mail ·/ })).toHaveCount(7);
  await expect(page.getByText('7 templates · 0 published. Drafts are not sent.')).toBeVisible();
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
        await expect(page.getByText('No accounts enrolled in follow-ups yet')).toBeVisible();
        await page.getByRole('button', { name: 'Back to users', exact: true }).click();
      }
      if (label === 'Results') {
        await page.getByRole('button', { name: 'View tracking coverage', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Tracking details', exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Back to results', exact: true }).click();
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
        ),
      ).toBe(true);
    }

    await page.evaluate(() => {
      document.documentElement.style.scrollBehavior = 'auto';
      (document.activeElement as HTMLElement)?.blur();
      window.scrollTo(0, 0);
    });
    await page.screenshot({ path: test.info().outputPath(`workspace-${width}.png`), fullPage: true });
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
