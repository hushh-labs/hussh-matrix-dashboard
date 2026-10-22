import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { OAuth2Client } from 'google-auth-library';
import express from 'express';
import request from 'supertest';
import { GoogleMail, GoogleMailOAuth, MAIL_SCOPES, googleMailMime, mailMessageId, type MailOAuth } from '../src/server/plg/google-mail';
import { emptyMailControl, MAIL_OWNER, type MailControl, type MailControlStore } from '../src/server/plg/google-mail-store';
import { registerGoogleMailRoutes } from '../src/server/plg/google-mail-routes';
import { MemoryPlgStore } from '../src/server/plg/store';
import { initialPlgState } from '../src/server/plg/engine';
import type { PlgRuntime } from '../src/server/plg/service';

class Control implements MailControlStore {
  state = emptyMailControl();
  private pending = Promise.resolve();
  async read() { await this.pending; return structuredClone(this.state); }
  async transaction<T>(change: (s: MailControl) => T): Promise<T> {
    const result = this.pending.then(() => {
      const draft = structuredClone(this.state), result = change(draft);
      this.state = draft; return structuredClone(result);
    });
    this.pending = result.then(() => {}, () => {}); return result;
  }
}
const id = 'a763337a-bf20-4ad2-96e9-a9335b2a126c';
const origin = 'https://metrics.example.invalid';
const config = { enabled: true, origin, admins: new Set([MAIL_OWNER, 'other@example.invalid']) } as PlgRuntime;
let control: Control, mail: GoogleMail, transport: Mock<typeof fetch>, oauth: MailOAuth;
const message = { text: 'A real preview', html: '<p>A real preview</p>', headers: {} };
const delivery = { id, subject: 'One preview' };
afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
  control = new Control();
  control.state.connection = { generation: 1, version: '1', connectedAt: Date.now() };
  oauth = { url: vi.fn((v) => `https://accounts.google.com/?state=${v.state}`), exchange: vi.fn(async () => 'test-only-refresh'), access: vi.fn(async () => 'test-only-access') };
  transport = vi.fn(async () => Response.json({ id: 'accepted123' }));
  mail = new GoogleMail(control, { save: vi.fn(async () => '2'), read: vi.fn(async () => 'test-only-refresh') }, oauth, transport);
});
function app(campaigns = new MemoryPlgStore()) {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { if (req.get('Test-User')) (req as any).sessionUser = { email: req.get('Test-User') }; next(); });
  registerGoogleMailRoutes(app, config, async () => (await campaigns.read()).templates, mail);
  app.get('/auth/callback', (_req, res) => res.json({ regularLogin: true }));
  return app;
}
describe('Google mailbox authority and uncertain sends', () => {
  it('verifies the exact owner, nonce, verified email, offline grant and complete scopes', async () => {
    const tokens = { id_token: 'synthetic-id', refresh_token: 'synthetic-refresh', scope: MAIL_SCOPES.join(' ') };
    const identity = { email: MAIL_OWNER, email_verified: true, nonce: 'nonce' };
    vi.spyOn(OAuth2Client.prototype, 'getToken').mockImplementation(async () => ({ tokens }) as any);
    vi.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockImplementation(async () => ({ getPayload: () => identity }) as any);
    const google = new GoogleMailOAuth({ clientId: 'synthetic-client', clientSecret: 'synthetic-client-secret', redirectUri: `${origin}/auth/callback` });
    expect(await google.exchange('code', 'verifier', 'nonce')).toBe('synthetic-refresh');
    identity.email = 'other@example.invalid';
    await expect(google.exchange('code', 'verifier', 'nonce')).rejects.toThrow();
    identity.email = MAIL_OWNER; identity.email_verified = false;
    await expect(google.exchange('code', 'verifier', 'nonce')).rejects.toThrow();
    identity.email_verified = true; identity.nonce = 'wrong';
    await expect(google.exchange('code', 'verifier', 'nonce')).rejects.toThrow();
    identity.nonce = 'nonce'; tokens.scope = 'openid email';
    await expect(google.exchange('code', 'verifier', 'nonce')).rejects.toThrow();
    tokens.scope = MAIL_SCOPES.join(' '); tokens.refresh_token = '';
    await expect(google.exchange('code', 'verifier', 'nonce')).rejects.toThrow();
  });
  it('consumes purpose-separated PKCE once and rejects wrong cookies, expiry and replaced connections', async () => {
    const first = await mail.begin();
    const state = new URL(first.url).searchParams.get('state')!;
    await expect(mail.complete(state, 'code', `${state}.wrong`)).rejects.toThrow();
    await mail.complete(state, 'code', first.cookie);
    await expect(mail.complete(state, 'code', first.cookie)).rejects.toThrow();
    expect(oauth.exchange).toHaveBeenCalledOnce();
    const second = await mail.begin();
    control.state.pending!.expiresAt = 0;
    await expect(mail.complete(new URL(second.url).searchParams.get('state')!, 'code', second.cookie)).rejects.toThrow();
    const third = await mail.begin();
    (oauth.exchange as any).mockImplementationOnce(async () => { await mail.disconnect(); return 'test-only-refresh'; });
    await expect(mail.complete(new URL(third.url).searchParams.get('state')!, 'code', third.cookie)).rejects.toThrow();
    expect((await control.read()).connection).toBeUndefined();
  });
  it('never retries an ambiguous Gmail send and fences disconnects during token refresh', async () => {
    transport.mockRejectedValueOnce(new Error('Network response lost'));
    await expect(mail.send(MAIL_OWNER, delivery, message)).rejects.toThrow();
    await expect(mail.send(MAIL_OWNER, delivery, message)).rejects.toThrow('not submitted');
    expect(transport).toHaveBeenCalledOnce();
    control.state.attempts = [];
    (oauth.access as any).mockImplementationOnce(async () => { await mail.disconnect(); return 'test-only-access'; });
    await expect(mail.send(MAIL_OWNER, delivery, message)).rejects.toThrow('not submitted');
    expect(transport).toHaveBeenCalledOnce();
  });
  it('binds rewritten Message-ID to the accepted Gmail ID and still requires Inbox', async () => {
    const assigned = '<google-assigned=opaque@mail.gmail.com>';
    const receipt = { id: 'accepted123', labelIds: ['SENT'], payload: { headers: [
      { name: 'Message-ID', value: assigned }, { name: 'From', value: `Neelesh Meena <${MAIL_OWNER}>` }, { name: 'To', value: MAIL_OWNER },
    ] } };
    transport.mockImplementation(async () => Response.json(receipt));
    expect(await mail.confirmOwnInbox('accepted123', id)).toBeNull();
    receipt.labelIds.push('INBOX');
    expect(await mail.confirmOwnInbox('accepted123', id)).toEqual({ id: 'accepted123', messageId: assigned });
    receipt.id = 'different456';
    expect(await mail.confirmOwnInbox('accepted123', id)).toBeNull();
    receipt.id = 'accepted123';
    receipt.payload.headers[2].value = 'other@example.invalid';
    expect(await mail.confirmOwnInbox('accepted123', id)).toBeNull();
    receipt.payload.headers[2].value = MAIL_OWNER;
    receipt.payload.headers.push({ name: 'Message-ID', value: '<ambiguous@example.invalid>' });
    expect(await mail.confirmOwnInbox('accepted123', id)).toBeNull();
    expect(String(transport.mock.calls[0][0])).toContain('format=metadata');
  });
  it('correlates a separate received copy without assuming the SENT copy has INBOX', async () => {
    const assigned = '<google-thread-copy=opaque@mail.gmail.com>';
    const headers = [{ name: 'Message-ID', value: assigned }, { name: 'From', value: `Neelesh Meena <${MAIL_OWNER}>` }, { name: 'To', value: MAIL_OWNER }];
    const sent = { id: 'accepted123', threadId: 'thread123', labelIds: ['SENT'], payload: { headers } };
    const received = { ...sent, id: 'received456', labelIds: ['INBOX'] };
    transport.mockImplementation(async (url) => Response.json(String(url).includes('/threads/')
      ? { id: 'thread123', messages: [sent, received] } : sent));
    expect(await mail.confirmOwnInbox('accepted123', id)).toEqual({ id: 'received456', messageId: assigned });
    received.threadId = 'unrelatedThread';
    expect(await mail.confirmOwnInbox('accepted123', id)).toBeNull();
    received.threadId = sent.threadId;
    received.payload = { headers: headers.map((h) => h.name === 'Message-ID' ? { ...h, value: '<different@example.invalid>' } : h) };
    expect(await mail.confirmOwnInbox('accepted123', id)).toBeNull();
    received.payload = { headers }; received.labelIds = ['SENT'];
    expect(await mail.confirmOwnInbox('accepted123', id)).toBeNull();
  });
  it('rejects header injection and preserves UTF-8 text as MIME content', () => {
    expect(() => googleMailMime('x@example.invalid\r\nBcc: victim@example.invalid', delivery, message)).toThrow();
    expect(() => googleMailMime(MAIL_OWNER, { ...delivery, subject: 'A\r\nBcc: victim' }, message)).toThrow();
    const raw = Buffer.from(googleMailMime(MAIL_OWNER, delivery, { ...message, text: 'नमस्ते\nBcc: harmless body' }), 'base64url').toString();
    expect(raw).toContain(`From: Neelesh Meena <${MAIL_OWNER}>`);
    expect(raw).toContain(`Message-ID: ${mailMessageId(id)}`);
    expect(raw).not.toContain('\r\nBcc:');
    const long = Buffer.from(googleMailMime(MAIL_OWNER, { ...delivery, subject: 'नमस्ते'.repeat(30) }, message), 'base64url').toString();
    const words = long.match(/=\?UTF-8\?B\?[^?]+\?=/g)!;
    expect(words.length).toBeGreaterThan(1);
    expect(words.every((w) => w.length <= 75)).toBe(true);
    expect(long.split('\r\n').filter((line) => line.includes('=?UTF-8?B?')).every((line) => line.length <= 76)).toBe(true);
    expect(words.map((w) => Buffer.from(w.slice(10, -2), 'base64').toString()).join('')).toBe('नमस्ते'.repeat(30));
  });
});
describe('Private fixed-recipient test API', () => {
  it('requires owner admin, same origin, and lets ordinary sign-in retain its callback', async () => {
    const server = app();
    expect((await request(server).get('/api/plg/google-mail/status')).status).toBe(401);
    expect((await request(server).get('/api/plg/google-mail/status').set('Test-User', 'other@example.invalid')).status).toBe(403);
    expect((await request(server).post('/api/plg/google-mail/connect').set('Test-User', MAIL_OWNER).send({})).status).toBe(403);
    expect((await request(server).get('/auth/callback?state=ordinary')).body).toEqual({ regularLogin: true });
    const connected = await request(server).post('/api/plg/google-mail/connect').set('Test-User', MAIL_OWNER).set('Origin', origin).send({});
    expect(connected.status).toBe(200);
    expect(connected.headers['set-cookie'][0]).toContain('HttpOnly; SameSite=Lax');
    const state = new URL(connected.body.url).searchParams.get('state')!;
    const finished = await request(server).get(`/auth/callback?state=${state}&code=code`)
      .set('Test-User', MAIL_OWNER).set('Cookie', connected.headers['set-cookie'][0].split(';')[0]);
    expect(finished.status).toBe(303);
    expect(finished.headers.location).toBe('/plg');
  });
  it('sends only to the fixed work mailbox, blocks duplicates and leaves customer analytics byte-identical', async () => {
    const campaigns = new MemoryPlgStore(), before = await campaigns.read();
    const server = app(campaigns), template = before.templates[0];
    const send = (body: Record<string, unknown>) => request(server).post('/api/plg/mail-tests').set('Test-User', MAIL_OWNER).set('Origin', origin).send(body);
    expect((await send({ templateId: template.id, to: 'someone@example.invalid' })).status).toBe(400);
    const [first, duplicate] = await Promise.all([send({ templateId: template.id }), send({ templateId: template.id })]);
    expect([first.status, duplicate.status].sort()).toEqual([202, 409]);
    expect(transport).toHaveBeenCalledOnce();
    const sent = JSON.parse(String(transport.mock.calls[0][1].body));
    const raw = Buffer.from(sent.raw, 'base64url').toString();
    expect(raw).toContain(`To: ${MAIL_OWNER}\r\n`);
    expect(control.state.tests[0].status).toBe('accepted');
    const accepted = control.state.tests[0];
    const assigned = '<api-assigned=opaque@mail.gmail.com>';
    transport.mockImplementation(async () => Response.json({ id: accepted.providerId, labelIds: ['INBOX'], payload: { headers: [
      { name: 'Message-ID', value: assigned }, { name: 'From', value: `Neelesh Meena <${MAIL_OWNER}>` }, { name: 'To', value: MAIL_OWNER },
    ] } }));
    const checked = await request(server).get('/api/plg/mail-tests').set('Test-User', MAIL_OWNER);
    expect(checked.status).toBe(200);
    expect(checked.body.tests[0]).toMatchObject({ id: accepted.id, providerId: accepted.providerId,
      status: 'inbox_confirmed', receiptId: accepted.providerId, receiptMessageId: assigned });
    expect(transport.mock.calls.slice(1).every((call) => call[1].method === 'GET' && String(call[0]).includes('format=metadata'))).toBe(true);
    expect(await campaigns.read()).toEqual(before);
  });
  it('allows definitely unsent retries without failed churn evicting accepted reservations', async () => {
    const server = app(), templates = initialPlgState().templates;
    const send = (templateId: string) => request(server).post('/api/plg/mail-tests').set('Test-User', MAIL_OWNER).set('Origin', origin).send({ templateId });
    expect((await send(templates[0].id)).status).toBe(202);
    const accepted = control.state.tests[0].id;
    (oauth.access as any).mockRejectedValue(new Error('Credential access denied'));
    for (let i = 0; i < 52; i++) {
      const failed = await send(templates[1].id);
      expect(failed.status).toBe(202);
      expect(failed.body.test.status).toBe('failed');
    }
    expect(control.state.tests).toHaveLength(50);
    expect(control.state.tests.some((t) => t.id === accepted && t.status === 'accepted')).toBe(true);
    expect((await send(templates[0].id)).status).toBe(409);
    (oauth.access as any).mockResolvedValue('test-only-access');
    expect((await send(templates[1].id)).body.test.status).toBe('accepted');
    expect(transport).toHaveBeenCalledTimes(2);
  });
});
