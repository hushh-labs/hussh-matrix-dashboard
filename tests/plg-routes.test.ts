import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Webhook } from 'svix';
import { registerPlgRoutes } from '../src/server/plg/routes';
import { MemoryPlgStore } from '../src/server/plg/store';
import { PlgService, preferenceToken, signValue, type PlgRuntime } from '../src/server/plg/service';
import { enroll } from '../src/server/plg/engine';

const secret = 'test-plg-signing-secret-more-than-32-characters';
const config: PlgRuntime = {
  enabled: true,
  deliveryEnabled: false,
  origin: 'https://metrics.example.invalid',
  admins: new Set(['admin@example.invalid']),
  operators: new Set(['operator@example.invalid']),
  signingSecret: secret,
  syncSecret: 'test-only-dedicated-sync-secret-over-32-characters',
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
function app() {
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
  registerPlgRoutes(server, false, new PlgService(store, config));
  return server;
}
describe('Private PLG API boundaries', () => {
  it('protects all-agent sync and inspection with session, role and same-origin authority', async () => {
    for (const route of ['/api/plg/sync', '/api/plg/activity']) {
      expect((await request(app()).post(route).send({ contactId: 'anything' })).status).toBe(401);
      expect((await request(app()).post(route).set('Test-User', 'viewer@example.invalid').set('Origin', config.origin).send({ contactId: 'anything' })).status).toBe(403);
      expect((await request(app()).post(route).set('Test-User', 'operator@example.invalid').send({ contactId: 'anything' })).status).toBe(403);
      const allowed = await request(app()).post(route).set('Test-User', 'operator@example.invalid').set('Origin', config.origin).send({ contactId: 'anything' });
      // Source configuration is intentionally absent; authenticated authority
      // reaches the integration, never a sender or enrollment bypass.
      expect(allowed.status).toBe(503);
    }
  });
  it('does not let a sync credential authorize delivery or enrollment', async () => {
    const timestamp = String(Date.now()),
      body = '{}';
    for (const purpose of ['events', 'run']) {
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
});
