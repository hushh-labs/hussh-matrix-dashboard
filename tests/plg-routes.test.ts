import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Webhook } from 'svix';
import { registerPlgRoutes } from '../src/server/plg/routes';
import { MemoryPlgStore } from '../src/server/plg/store';
import { PlgService, preferenceToken, signValue, type PlgRuntime } from '../src/server/plg/service';
import { enroll } from '../src/server/plg/engine';
import { applyDeliveryEvent } from '../src/server/plg/delivery-events';
import * as audienceSource from '../src/server/plg/one-audience';

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
});
