import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Webhook } from 'svix';
import { registerPlgRoutes } from '../src/server/plg/routes';
import { MemoryPlgStore } from '../src/server/plg/store';
import { PlgService, preferenceToken, signValue, type PlgRuntime } from '../src/server/plg/service';
import { accountHash, enroll, registerPlgCatalog } from '../src/server/plg/engine';
import { applyDeliveryEvent } from '../src/server/plg/delivery-events';
import * as audienceSource from '../src/server/plg/one-audience';
import * as evidenceSource from '../src/server/plg/one-source';
import { PLG_SYNC_REQUEST_TIMEOUT_MS } from '../src/lib/plg-budgets.mjs';

const secret = 'test-plg-signing-secret-more-than-32-characters';
const config: PlgRuntime = {
  enabled: true,
  deliveryEnabled: false,
  origin: 'https://metrics.example.invalid',
  admins: new Set(['admin@example.invalid']),
  operators: new Set(['operator@example.invalid']),
  signingSecret: secret,
  syncSecret: 'test-only-dedicated-sync-secret-over-32-characters',
  cycleSecret: 'test-only-dedicated-cycle-secret-over-32-characters',
  webhookSecret: 'whsec_' + Buffer.from('test-webhook-signing-secret-value').toString('base64'),
  apiKey: '',
  from: '',
  replyTo: '',
};
const input = {
  accountId: 'customer-1',
  email: 'customer@example.invalid',
  name: 'Customer',
  journey: 'memory',
  cohort: 'existing',
  frequency: 'daily',
  consent: true,
  consentSource: 'Preference form',
  environment: 'production',
  internal: false,
};
let store: MemoryPlgStore;
function app(runtime = config) {
  const server = express();
  server.use(
    express.json({
      verify(req, _res, buffer) {
        (req as any).plgRawBody = buffer.toString();
      },
    }),
  );
  server.use(express.urlencoded({ extended: false }));
  // This header simulates an already authenticated session only in this test app.
  server.use((req, _res, next) => {
    if (req.get('Test-User')) (req as any).sessionUser = { email: req.get('Test-User') };
    next();
  });
  registerPlgRoutes(server, false, new PlgService(store, runtime));
  return server;
}
describe('Private PLG API boundaries', () => {
  it('finishes the signed sync path before its legacy worker timeout with response margin', async () => {
    const started = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(started);
    await store.transaction((s) => { enroll(s, input, 'admin', started); });
    const source = vi.spyOn(evidenceSource, 'syncOneEvidence').mockImplementation(async (_store, _options, _fetcher, _clock, _inspection, deadline) => {
      expect(deadline).toBeGreaterThan(started);
      expect(deadline! - started).toBeLessThanOrEqual(PLG_SYNC_REQUEST_TIMEOUT_MS - 20_000);
      return { accounts: 1, imported: 0, erased: 0, retainedOnly: true };
    });
    const timestamp = String(started), body = '{}';
    const response = await request(app()).post('/integrations/plg/sync')
      .set('Content-Type', 'application/json').set('X-PLG-Timestamp', timestamp)
      .set('X-PLG-Signature', signValue(`sync\n${timestamp}\n${body}`, config.syncSecret!)).send(body);
    expect(response.status).toBe(200);
    expect(source).toHaveBeenCalledOnce();
  });
  it('refreshes a stale catalog lacking One before automatically enrolling a verified subscriber', async () => {
    const generation = '14dfc8fb-f456-46c2-ae3e-dc51f92a0816', at = new Date().toISOString();
    const catalog = { revision: 'b'.repeat(64), agents: [{ id: 'agent_one' as const, label: 'One', public: true, available: true }], actions: [] };
    await store.transaction((s) => { registerPlgCatalog(s, { revision: 'a'.repeat(64),
      agents: [{ id: 'agent_calendar', label: 'Calendar', public: true, available: true }], actions: [] }); });
    const reader = vi.spyOn(audienceSource, 'readOneAudience').mockResolvedValue({ catalog } as any);
    vi.spyOn(evidenceSource, 'syncOneEvidence').mockImplementation(async (store) => {
      expect((await store.read()).contacts[0]).toMatchObject({ accountId: input.accountId, journey: 'agent_one' });
      return { accounts: 1, imported: 0, erased: 0, retainedOnly: true };
    });
    vi.stubGlobal('fetch', vi.fn(async (url) => String(url).endsWith('/pull') ? Response.json({ version: 1, environment: 'production', changes: [{
      accountHash: `sha256:${accountHash(input.accountId)}`, revision: 1, erased: false, enabled: true, eligible: true,
      checkedAt: at, generation, frequency: 'weekly', chosenAt: at, consentAt: at, disclosureVersion: 'one-email-updates-v1',
      accountId: input.accountId, email: input.email, name: input.name, cohort: 'existing',
    }] }) : Response.json({ received: true })));
    try {
      const response = await request(app({ ...config, subscriptions: { enabled: true,
        url: 'https://api.hushh.ai/api/one/plg/subscriptions', secret: 'test-only-subscription-key-over-32-characters' } }))
        .post('/api/plg/sync').set('Test-User', 'operator@example.invalid').set('Origin', config.origin).send({});
      expect(response.status).toBe(200);
      expect(reader).toHaveBeenCalledOnce();
      expect((await store.read()).contacts).toHaveLength(1);
      expect((await store.read()).deliveries).toHaveLength(0);
    } finally { vi.unstubAllGlobals(); }
  });
  it('bootstraps the validated agent catalog without enrolling directory people or inventing coverage', async () => {
    const catalog = { revision: 'a'.repeat(64), agents: [{ id: 'agent_one', label: 'One', public: true, available: true }], actions: [] };
    const source = vi.spyOn(audienceSource, 'readOneAudience').mockResolvedValue({ catalog, rows: [{ accountId: 'PRIVATE', identity: { email: 'private@example.invalid' } }] } as any);
    const sync = () => request(app()).post('/api/plg/sync').set('Test-User', 'operator@example.invalid').set('Origin', config.origin).send({});
    const response = await sync();
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ accounts: 0, imported: 0, erased: 0 });
    expect(response.text).not.toContain('PRIVATE');
    const state = await store.read();
    expect(state.catalog).toEqual(catalog);
    expect(state.contacts).toHaveLength(0);
    expect(state.deliveries).toHaveLength(0);
    expect(Object.values(state.ready).every((ready) => !ready)).toBe(true);
    await store.transaction((state) => enroll(state, input, 'admin', Date.now()));
    expect((await sync()).status).toBe(503); // No configured cohort exporter.
    expect(source).toHaveBeenCalledOnce(); // Never fall back after enrollment.
  });
  it('requires administrator and same-origin authority to change automation', async () => {
    for (const [user, origin, status] of [
      ['', config.origin, 401], ['operator@example.invalid', config.origin, 403],
      ['admin@example.invalid', 'https://foreign.example.invalid', 403],
    ] as const) {
      const req = request(app()).patch('/api/plg/automation').set('Origin', origin);
      if (user) req.set('Test-User', user);
      expect((await req.send({ enabled: true })).status).toBe(status);
    }
    expect((await request(app()).patch('/api/plg/automation').set('Test-User', 'admin@example.invalid')
      .set('Origin', config.origin).send({ enabled: true })).status).toBe(200);
    expect((await store.read()).automation?.enabled).toBe(true);
    expect((await store.read()).deliveries).toHaveLength(0);
  });
  it('protects all-agent sync and inspection with session, role and same-origin authority', async () => {
    for (const route of ['/api/plg/sync', '/api/plg/activity', '/api/plg/audience']) {
      expect((await request(app()).post(route).send({ contactId: 'anything' })).status).toBe(401);
      expect((await request(app()).post(route).set('Test-User', 'viewer@example.invalid').set('Origin', config.origin).send({ contactId: 'anything' })).status).toBe(403);
      expect((await request(app()).post(route).set('Test-User', 'operator@example.invalid').send({ contactId: 'anything' })).status).toBe(403);
      const body = route.endsWith('/audience') ? { agentId: 'agent_one', segment: 'all', query: '', graceMinutes: 60 } : { contactId: 'anything' };
      const allowed = await request(app()).post(route).set('Test-User', 'operator@example.invalid').set('Origin', config.origin).send(body);
      // Source configuration is intentionally absent; authenticated authority
      // reaches the integration, never a sender or enrollment bypass.
      expect(allowed.status).toBe(503);
    }
  });
  it('keeps audience reads behind activation and never enrolls or sends', async () => {
    const source = vi.spyOn(audienceSource, 'readOneAudience').mockResolvedValue({ rows: [] } as any);
    const allowed = () => request(app()).post('/api/plg/audience').set('Test-User', 'operator@example.invalid').set('Origin', config.origin).send({ agentId: 'agent_one' });
    const disabled = await request(app({ ...config, enabled: false })).post('/api/plg/audience').set('Test-User', 'operator@example.invalid').set('Origin', config.origin).send({});
    expect(disabled.status).toBe(503);
    expect(source).not.toHaveBeenCalled();
    const response = await allowed();
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(source).toHaveBeenCalledOnce();
    expect((await store.read()).contacts).toHaveLength(0);
    expect((await store.read()).deliveries).toHaveLength(0);
  });
  it('does not let a sync credential authorize delivery or enrollment', async () => {
    const timestamp = String(Date.now()),
      body = '{}';
    for (const purpose of ['events', 'run', 'cycle']) {
      const denied = await request(app())
        .post(`/integrations/plg/${purpose}`)
        .set('Content-Type', 'application/json')
        .set('X-PLG-Timestamp', timestamp)
        .set('X-PLG-Signature', signValue(`${purpose}\n${timestamp}\n${body}`, config.syncSecret!))
        .send(body);
      expect(denied.status).toBe(401);
    }
    const denied = await request(app())
      .post('/integrations/plg/sync')
      .set('Content-Type', 'application/json')
      .set('X-PLG-Timestamp', timestamp)
      .set('X-PLG-Signature', signValue(`sync\n${timestamp}\n${body}`, secret))
      .send(body);
    expect(denied.status).toBe(401);
    const accepted = await request(app())
      .post('/integrations/plg/sync')
      .set('Content-Type', 'application/json')
      .set('X-PLG-Timestamp', timestamp)
      .set('X-PLG-Signature', signValue(`sync\n${timestamp}\n${body}`, config.syncSecret!))
      .send(body);
    // Authorized, but source configuration is absent in this fixture.
    expect(accepted.status).toBe(503);
    expect(accepted.body.error).toContain('evidence');
  });
  it('keeps the cycle worker key separate from enrollment, sync and preference signing', async () => {
    const timestamp = String(Date.now()), body = '{}';
    for (const purpose of ['events', 'run', 'sync']) {
      expect((await request(app()).post(`/integrations/plg/${purpose}`)
        .set('Content-Type', 'application/json').set('X-PLG-Timestamp', timestamp)
        .set('X-PLG-Signature', signValue(`${purpose}\n${timestamp}\n${body}`, config.cycleSecret!)).send(body)).status).toBe(401);
    }
    expect((await request(app()).post('/integrations/plg/cycle')
      .set('Content-Type', 'application/json').set('X-PLG-Timestamp', timestamp)
      .set('X-PLG-Signature', signValue(`cycle\n${timestamp}\n${body}`, secret)).send(body)).status).toBe(401);
    expect((await request(app()).post('/integrations/plg/cycle')
      .set('Content-Type', 'application/json').set('X-PLG-Timestamp', timestamp)
      .set('X-PLG-Signature', signValue(`cycle\n${timestamp}\n${body}`, config.cycleSecret!)).send(body)).status).toBe(503);
    expect((await store.read()).automation?.lastCycle?.status).toBe('failed');
    expect((await store.read()).deliveries).toHaveLength(0);
  });
  beforeEach(() => {
    store = new MemoryPlgStore();
  });
  afterEach(() => vi.restoreAllMocks());
  it('requires a real session and explicit role even when analytics is public', async () => {
    expect((await request(app()).get('/api/plg/workspace')).status).toBe(401);
    const denied = await request(app())
      .get('/api/plg/workspace')
      .set('Test-User', 'viewer@example.invalid');
    expect(denied.status).toBe(403);
    expect(denied.text).not.toContain('customer@');
    const allowed = await request(app())
      .get('/api/plg/workspace')
      .set('Test-User', 'operator@example.invalid');
    expect(allowed.status).toBe(200);
    expect(allowed.headers['cache-control']).toBe('no-store');
    expect(allowed.body.state.contacts).toEqual([]);
  });
  it('requires same-origin writes and prevents operators changing campaign settings', async () => {
    expect(
      (
        await request(app())
          .post('/api/plg/contacts')
          .set('Test-User', 'operator@example.invalid')
          .send(input)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app())
          .post('/api/plg/contacts')
          .set('Test-User', 'operator@example.invalid')
          .set('Origin', config.origin)
          .send(input)
      ).status,
    ).toBe(201);
    expect(
      (
        await request(app())
          .patch('/api/plg/settings')
          .set('Test-User', 'operator@example.invalid')
          .set('Origin', config.origin)
          .send({ paused: false, ready: { memory: true, mail: true } })
      ).status,
    ).toBe(403);
  });
  it('authenticates the raw body, purpose and timestamp before event ingestion', async () => {
    const server = app();
    const timestamp = String(Date.now());
    const payload = JSON.stringify({
      ...input,
      eventId: 'event-1',
      kind: 'activity_observed',
      occurredAt: new Date().toISOString(),
    });
    await store.transaction((s) => enroll(s, input, 'admin', Date.now() - 1000));
    expect(
      (await request(server).post('/integrations/plg/events').send(JSON.parse(payload))).status,
    ).toBe(401);
    const good = await request(server)
      .post('/integrations/plg/events')
      .set('Content-Type', 'application/json')
      .set('X-PLG-Timestamp', timestamp)
      .set('X-PLG-Signature', signValue(`events\n${timestamp}\n${payload}`, secret))
      .send(payload);
    expect(good.status).toBe(200);
    const wrong = await request(server)
      .post('/integrations/plg/events')
      .set('Content-Type', 'application/json')
      .set('X-PLG-Timestamp', timestamp)
      .set('X-PLG-Signature', signValue(`run\n${timestamp}\n${payload}`, secret))
      .send(payload);
    expect(wrong.status).toBe(401);
  });
  it('never unsubscribes on GET and supports signed one-click POST', async () => {
    const c = await store.transaction((s) => enroll(s, input, 'admin', Date.now()));
    const token = preferenceToken(c.id, secret);
    const server = app();
    const url = `/integrations/plg/unsubscribe/${token}`;
    expect((await request(server).get(url)).status).toBe(200);
    expect((await store.read()).contacts[0].suppressed).toBeNull();
    expect(
      (await request(server).post(url).type('form').send({ 'List-Unsubscribe': 'One-Click' }))
        .status,
    ).toBe(200);
    expect((await store.read()).contacts[0].suppressed).toBe('unsubscribed');
    expect((await request(server).get(url + 'tampered')).status).toBe(400);
  });
  it('binds canonical unsubscribe to the email generation and durably preserves its retry intent', async () => {
    const generation = '14dfc8fb-f456-46c2-ae3e-dc51f92a0816';
    const renewed = '24dfc8fb-f456-46c2-ae3e-dc51f92a0816';
    const c = await store.transaction((s) => {
      const c = enroll(s, input, 'admin', Date.now());
      c.permission = { revision: 2, generation: renewed, enabled: true, eligible: true, checkedAt: new Date().toISOString() };
      return c;
    });
    const server = app();
    const oldLink = `/integrations/plg/unsubscribe/${preferenceToken(c.id, secret, generation)}`;
    expect((await request(server).post(oldLink).type('form').send({})).status).toBe(200);
    let state = await store.read();
    expect(state.contacts[0].suppressed).toBeNull();
    expect(state.pendingRevocations).toEqual([{ accountHash: `sha256:${accountHash(input.accountId)}`, generation }]);
    const currentLink = `/integrations/plg/unsubscribe/${preferenceToken(c.id, secret, renewed)}`;
    expect((await request(server).get(currentLink)).status).toBe(200);
    expect((await store.read()).contacts[0].suppressed).toBeNull();
    expect((await request(server).post(currentLink).type('form').send({})).status).toBe(200);
    state = await store.read();
    expect(state.contacts[0].suppressed).toBe('unsubscribed');
    expect(state.pendingRevocations).toHaveLength(2);
    expect((await request(server).post(`/integrations/plg/unsubscribe/${preferenceToken(c.id, secret)}`).type('form').send({})).status).toBe(409);
  });
  it('validates delivery signatures and immediately suppresses signed complaints', async () => {
    await store.transaction((s) => enroll(s, input, 'admin', Date.now()));
    let transactionFailure: unknown;
    const transact = store.transaction.bind(store);
    vi.spyOn(store, 'transaction').mockImplementation((fn) =>
      transact(fn).catch((error) => {
        transactionFailure = error;
        throw error;
      }),
    );
    const payload = JSON.stringify({ type: 'email.complained', data: { to: [input.email] } });
    expect(
      (await request(app()).post('/integrations/plg/resend').send(JSON.parse(payload))).status,
    ).toBe(401);
    const id = 'msg_test_plg';
    const timestamp = new Date();
    const signature = new Webhook(config.webhookSecret).sign(id, timestamp, payload);
    const response = await request(app())
      .post('/integrations/plg/resend')
      .set('Content-Type', 'application/json')
      .set('svix-id', id)
      .set('svix-timestamp', String(Math.floor(timestamp.getTime() / 1000)))
      .set('svix-signature', signature)
      .send(payload);
    expect(transactionFailure).toBeUndefined();
    expect(response.status).toBe(200);
    expect((await store.read()).contacts[0].suppressed).toBe('complained');
  });
  it('does not expose storage and provider diagnostics', async () => {
    vi.spyOn(store, 'read').mockRejectedValue(
      new Error('private-provider-secret-and-customer@example.invalid'),
    );
    const result = await request(app())
      .get('/api/plg/workspace')
      .set('Test-User', 'operator@example.invalid');
    expect(result.status).toBe(503);
    expect(result.text).not.toContain('private-provider');
    expect(result.text).not.toContain('customer@');
  });
  it('reconciles signed delivery correlation without recipient crossover or status regression', async () => {
    const contact = await store.transaction((state) => {
      const c = enroll(state, input, 'admin', Date.now());
      state.deliveries.push({ id: 'stable-delivery-id', contactId: c.id, templateId: 'memory-feedback', step: 'feedback',
        key: 'permanent-step-key', status: 'uncertain', createdAt: new Date().toISOString(), subject: 'Welcome', body: 'Guide',
        ctaLabel: 'Open One', ctaUrl: 'https://one.hushh.ai/', providerId: null });
      return c;
    });
    const data = { email_id: 'provider_email_1', to: [contact.email], tags: { plg_delivery_id: 'stable-delivery-id' } };
    await store.transaction((state) => applyDeliveryEvent(state, { type: 'email.delivered', data: { ...data, to: ['foreign@example.invalid'] } }, Date.now()));
    expect((await store.read()).deliveries[0].status).toBe('uncertain');
    await store.transaction((state) => applyDeliveryEvent(state, { type: 'email.delivered', data }, Date.now()));
    expect((await store.read()).deliveries[0]).toMatchObject({ status: 'delivered', providerId: data.email_id });
    const pause = (await store.read()).contacts[0].pauseUntil;
    expect(Date.parse(pause!)).toBe(Date.parse((await store.read()).deliveries[0].createdAt) + 30 * 86_400_000);
    for (const type of ['email.sent', 'email.bounced', 'email.delivered', 'email.complained', 'email.sent'])
      await store.transaction((state) => applyDeliveryEvent(state, { type, data }, Date.now()));
    const state = await store.read();
    expect(state.deliveries[0].status).toBe('complained');
    expect(state.contacts[0].suppressed).toBe('complained');
    expect(state.contacts[0].pauseUntil).toBe(pause);
    expect(state.contacts[0].firstValueAt).toBeNull();
    expect(state.contacts[0].valueDays).toEqual([]);
  });
  it('persists a signed provider suppression so future journey steps stay blocked', async () => {
    await store.transaction((state) => enroll(state, input, 'admin', Date.now()));
    const payload = JSON.stringify({ type: 'email.suppressed', data: { to: [input.email] } });
    const id = 'msg_suppressed_test', at = new Date();
    const signature = new Webhook(config.webhookSecret).sign(id, at, payload);
    const response = await request(app()).post('/integrations/plg/resend')
      .set('Content-Type', 'application/json').set('svix-id', id)
      .set('svix-timestamp', String(Math.floor(at.getTime() / 1000))).set('svix-signature', signature).send(payload);
    expect(response.status).toBe(200);
    const state = await store.read();
    expect(state.contacts[0].suppressed).toBe('provider_suppressed');
    const workspace = await new PlgService(store, config).workspace('admin');
    expect(workspace.queue[0]).toMatchObject({ eligible: false, reason: 'Suppressed: provider_suppressed' });
  });
});
