import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { OAuth2Client } from 'google-auth-library';
import express from 'express';
import request from 'supertest';
import { GoogleMail, GoogleMailOAuth, GoogleMailUnattempted, MAIL_SCOPES, googleMailMime, mailMessageId, type MailOAuth } from '../src/server/plg/google-mail';
import { emptyMailControl, MAIL_OWNER, type MailControl, type MailControlStore } from '../src/server/plg/google-mail-store';
import { registerGoogleMailRoutes } from '../src/server/plg/google-mail-routes';
import { MemoryPlgStore } from '../src/server/plg/store';
import { accountHash, initialPlgState, registerPlgCatalog } from '../src/server/plg/engine';
import { applyGoogleHardBounce, applyGoogleSubmission, reportedHardBounces } from '../src/server/plg/google-mail-feedback';
import { createHash } from 'node:crypto';
import { GmailReadError, reconcileGoogleFeedback, type GmailRead } from '../src/server/plg/google-mail-reconcile';
import { PlgService, type PlgRuntime } from '../src/server/plg/service';
import { applySubscription, OneSubscriptions } from '../src/server/plg/one-subscriptions';
import { renderPlgEmailHtml } from '../src/server/plg/email-layout';
import { renderPlgTestPreview } from '../src/server/plg/test-preview';

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
    tokens.refresh_token = 'synthetic-refresh';
    const reports = new GoogleMailOAuth({ clientId: 'synthetic-client', clientSecret: 'synthetic-client-secret', redirectUri: `${origin}/auth/callback` }, true);
    await expect(reports.exchange('code', 'verifier', 'nonce')).rejects.toThrow();
    tokens.scope = MAIL_SCOPES.map((s) => s.replace('gmail.metadata', 'gmail.readonly')).join(' ');
    expect(await reports.exchange('code', 'verifier', 'nonce')).toBe('synthetic-refresh');
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
  it.each([401, 403, 429])('persists %s provider rejection backpressure without making a customer submission uncertain', async (status) => {
    transport.mockResolvedValueOnce(new Response('private provider response must not be retained', { status }));
    await expect(mail.send(MAIL_OWNER, delivery, message)).rejects.toBeInstanceOf(GoogleMailUnattempted);
    expect(control.state.attempts).toHaveLength(0);
    expect(JSON.stringify(control.state)).not.toContain('private provider response');
    const secondWorker = new GoogleMail(control, { save: vi.fn(), read: vi.fn() }, oauth, transport);
    await expect(secondWorker.send(MAIL_OWNER, { ...delivery, id: 'b763337a-bf20-4ad2-96e9-a9335b2a126c' }, message)).rejects.toBeInstanceOf(GoogleMailUnattempted);
    control.state.connection!.feedbackAllowed = true;
    await expect(secondWorker.prepareCampaign()).rejects.toBeInstanceOf(GoogleMailUnattempted);
    expect(transport).toHaveBeenCalledOnce();
    expect(oauth.access).toHaveBeenCalledOnce();
    expect((await secondWorker.status()).providerRetryAt).toBeGreaterThan(Date.now());
  });
  it.each(['7200', 'Thu, 29 Oct 2026 02:00:00 GMT'])('honors Retry-After %s, then safely retries only a definitely rejected reservation', async (retryAfter) => {
    let clock = Date.parse('2026-10-29T00:00:00Z');
    mail = new GoogleMail(control, { save: vi.fn(), read: vi.fn(async () => 'synthetic') }, oauth, transport, () => clock);
    transport.mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': retryAfter } }));
    await expect(mail.send(MAIL_OWNER, delivery, message)).rejects.toBeInstanceOf(GoogleMailUnattempted);
    clock += 60 * 60_000;
    await expect(mail.send(MAIL_OWNER, delivery, message)).rejects.toBeInstanceOf(GoogleMailUnattempted);
    expect(transport).toHaveBeenCalledOnce();
    clock += 60 * 60_000 + 1;
    expect(await mail.send(MAIL_OWNER, delivery, message)).toBe('accepted123');
    expect(transport).toHaveBeenCalledTimes(2);
    expect(control.state.attempts).toEqual([{ id, at: clock }]);
    await expect(mail.send(MAIL_OWNER, delivery, message)).rejects.toBeInstanceOf(GoogleMailUnattempted);
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it.each([null, '30'])('never shortens a longer mailbox wait when a concurrent rejection has Retry-After %s', async (shorter) => {
    let clock = Date.parse('2026-10-29T00:00:00Z');
    mail = new GoogleMail(control, { save: vi.fn(), read: vi.fn(async () => 'synthetic') }, oauth, transport, () => clock);
    const finish: ((response: Response) => void)[] = [];
    transport.mockImplementationOnce(() => new Promise(resolve => { finish[0] = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { finish[1] = resolve; }));
    const first = mail.send(MAIL_OWNER, delivery, message).catch(error => error);
    await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
    const second = mail.send(MAIL_OWNER, { ...delivery, id: 'b763337a-bf20-4ad2-96e9-a9335b2a126c' }, message).catch(error => error);
    await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
    finish[0](new Response(null, { status: 429, headers: { 'Retry-After': '7200' } }));
    expect(await first).toBeInstanceOf(GoogleMailUnattempted);
    const deadline = (await mail.status()).providerRetryAt;
    finish[1](new Response(null, { status: 429, ...(shorter ? { headers: { 'Retry-After': shorter } } : {}) }));
    expect(await second).toBeInstanceOf(GoogleMailUnattempted);
    expect((await mail.status()).providerRetryAt).toBe(deadline);
    clock += 2 * 60 * 60_000 - 1;
    await expect(mail.send(MAIL_OWNER, delivery, message)).rejects.toBeInstanceOf(GoogleMailUnattempted);
    expect(transport).toHaveBeenCalledTimes(2);
    clock += 2;
    expect(await mail.send(MAIL_OWNER, delivery, message)).toBe('accepted123');
    expect(transport).toHaveBeenCalledTimes(3);
  });
  it.each([408, 500, 503])('keeps an ambiguous HTTP %s send permanently reserved without automatic resubmission', async (status) => {
    transport.mockResolvedValueOnce(new Response(null, { status }));
    const result = await mail.send(MAIL_OWNER, delivery, message).catch(error => error);
    expect(result).not.toBeInstanceOf(GoogleMailUnattempted);
    await expect(mail.send(MAIL_OWNER, delivery, message)).rejects.toBeInstanceOf(GoogleMailUnattempted);
    expect(control.state.attempts).toHaveLength(1); expect(transport).toHaveBeenCalledOnce();
  });
  it('does not apply a late rejection to a replacement mailbox grant', async () => {
    transport.mockImplementationOnce(async () => {
      await control.transaction(state => { state.connection = { version: '2', generation: 2, connectedAt: Date.now() }; });
      return new Response(null, { status: 429 });
    });
    await expect(mail.send(MAIL_OWNER, delivery, message)).rejects.toBeInstanceOf(GoogleMailUnattempted);
    expect((await mail.status()).providerRetryAt).toBeNull();
    expect(await mail.send(MAIL_OWNER, delivery, message)).toBe('accepted123');
  });
  it('retains uncertainty when a definite provider rejection cannot be durably recorded', async () => {
    const transaction = control.transaction.bind(control);
    vi.spyOn(control, 'transaction').mockImplementation(async change => transaction(state => {
      const result = change(state);
      if (JSON.stringify(state).includes('sendBackoff')) throw new Error('Synthetic storage commit failure');
      return result;
    }));
    transport.mockResolvedValueOnce(new Response(null, { status: 429 }));
    const result = await mail.send(MAIL_OWNER, delivery, message).catch(error => error);
    expect(result).not.toBeInstanceOf(GoogleMailUnattempted);
    expect(control.state.attempts).toHaveLength(1);
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
    const htmlPart = raw.match(/Content-Type: text\/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)\r\n--plg_/);
    expect(htmlPart).not.toBeNull();
    const html = Buffer.from(htmlPart![1].replaceAll('\r\n', ''), 'base64').toString();
    expect(html).toBe(renderPlgEmailHtml({ ...renderPlgTestPreview(template), preview: true }));
    expect(html).toContain('PLG TEST PREVIEW');
    expect(html).not.toContain('/integrations/plg/preferences/');
    expect(html).not.toContain('/integrations/plg/unsubscribe/');
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

describe('Correlated Google feedback boundaries', () => {
  const recipient = 'synthetic@example.invalid';
  const assignedId = '<google-assigned=opaque@mail.gmail.com>';
  const recipientHash = createHash('sha256').update(recipient).digest('hex');
  function campaign() {
    const state = initialPlgState();
    state.contacts.push({ id: 'synthetic-contact', email: recipient, suppressed: null, timeline: [] } as any);
    state.deliveries.push({ id, contactId: 'synthetic-contact', provider: 'google_workspace', providerId: 'gmailSent123', rfcMessageId: assignedId,
      recipientHash, status: 'uncertain', step: 'welcome' } as any);
    return state;
  }
  function report(status = '5.1.1', action = 'failed', to = recipient) {
    return { id: 'report123', payload: { mimeType: 'multipart/report', headers: [
      { name: 'Content-Type', value: 'multipart/report; boundary="sample"; report-type=delivery-status' },
    ], parts: [
      { mimeType: 'message/delivery-status', body: { data: Buffer.from(`Reporting-MTA: dns; mx.example.invalid\r\n\r\nFinal-Recipient: rfc822; ${to}\r\nAction: ${action}\r\nStatus: ${status}\r\n`).toString('base64url') } },
      { mimeType: 'text/rfc822-headers', body: { data: Buffer.from(`Message-ID: ${assignedId}\r\nTo: ${recipient}\r\n`).toString('base64url') } },
    ] } };
  }
  it('stops only the exact Google reservation/recipient pair on a structured hard failure', () => {
    const state = campaign(), parsed = reportedHardBounces(report());
    expect(parsed).toEqual([{ messageId: assignedId, recipientHash }]);
    expect(applyGoogleHardBounce(state, { ...parsed[0], recipientHash: '0'.repeat(64) }, Date.now())).toBe(false);
    expect(state.contacts[0].suppressed).toBeNull();
    expect(applyGoogleHardBounce(state, parsed[0], Date.now())).toBe(true);
    expect(state.contacts[0].suppressed).toBe('bounced');
    expect(state.deliveries[0].status).toBe('bounced');
    const before = structuredClone(state);
    expect(applyGoogleHardBounce(state, parsed[0], Date.now())).toBe(true);
    expect(state).toEqual(before);
    state.deliveries[0].provider = 'resend';
    expect(applyGoogleHardBounce(state, parsed[0], Date.now())).toBe(false);
  });
  it('does not turn temporary/positive reports or arbitrary text into a hard bounce', () => {
    expect(reportedHardBounces(report('4.2.0', 'delayed'))).toEqual([]);
    expect(reportedHardBounces(report('2.0.0', 'delivered'))).toEqual([]);
    const arbitrary = report(); arbitrary.payload.mimeType = 'text/plain';
    expect(reportedHardBounces(arbitrary)).toEqual([]);
    const ambiguous = report();
    ambiguous.payload.parts.push({ mimeType: 'text/rfc822-headers', body: { data: Buffer.from(`Message-ID: <plg-1c945b22-f529-4aba-9397-93acb3919ee1@metrics.hussh.ai>`).toString('base64url') } });
    expect(reportedHardBounces(ambiguous)).toEqual([]);
  });
  it('binds only a durable acceptance ID; unknown sends and erased contacts remain held', () => {
    const state = campaign();
    const sent = { id: 'gmailSent123', labelIds: ['SENT'], payload: { headers: [
      { name: 'Message-ID', value: assignedId }, { name: 'From', value: `Neelesh Meena <${MAIL_OWNER}>` }, { name: 'To', value: recipient },
    ] } };
    state.deliveries[0].providerId = null;
    delete state.deliveries[0].rfcMessageId;
    expect(applyGoogleSubmission(state, sent)).toBe(false);
    expect(state.deliveries[0]).toMatchObject({ status: 'uncertain', providerId: null });
    state.deliveries[0].providerId = 'gmailSent123';
    expect(applyGoogleSubmission(state, sent)).toBe(true);
    expect(state.deliveries[0]).toMatchObject({ status: 'sent', providerId: 'gmailSent123', rfcMessageId: assignedId });
    state.deliveries[0].status = 'bounced';
    expect(applyGoogleSubmission(state, sent)).toBe(true);
    expect(state.deliveries[0].status).toBe('bounced');
    state.contacts = [];
    expect(applyGoogleSubmission(state, sent)).toBe(false);
    expect(state.contacts).toHaveLength(0);
  });
});

describe('Bounded Gmail feedback checkpoint', () => {
  it('establishes its cursor before any Google campaign send and never resets missing prior coverage', async () => {
    control.state.connection!.feedbackAllowed = true;
    const campaigns = new MemoryPlgStore();
    const api = vi.fn(async () => ({ historyId: '100' }));
    expect(await reconcileGoogleFeedback(control, campaigns, api)).toEqual({ complete: true, inspected: 0 });
    expect(control.state.feedback?.cursor).toBe('100');
    expect(api.mock.calls).toHaveLength(1);
    delete control.state.feedback;
    await campaigns.transaction((s) => { s.deliveries.push({ provider: 'google_workspace' } as any); });
    await expect(reconcileGoogleFeedback(control, campaigns, api)).rejects.toThrow('missing');
    expect(control.state.feedback).toBeUndefined();
    expect(control.state.feedbackLease).toBeUndefined();
  });
  it('holds sending across partial batches/pages and commits only the first page watermark', async () => {
    control.state.connection!.feedbackAllowed = true;
    control.state.feedback = { cursor: '100', checkedAt: 1 };
    const campaigns = new MemoryPlgStore();
    const api = vi.fn<GmailRead>(async (path: string) => {
      if (path.startsWith('history?') && !path.includes('pageToken')) return { historyId: '200', nextPageToken: 'next', history: [
        { messagesAdded: Array.from({ length: 25 }, (_, i) => ({ message: { id: `message${i}` } })) },
      ] };
      if (path.startsWith('history?')) return { historyId: '300', history: [] };
      return { id: path.match(/^messages\/([^?]+)/)![1], labelIds: [], payload: { headers: [] } };
    });
    expect(await reconcileGoogleFeedback(control, campaigns, api)).toEqual({ complete: false, inspected: 20 });
    expect(control.state.feedback).toMatchObject({ cursor: '100', checkedAt: 1, pending: { ids: ['message20','message21','message22','message23','message24'] } });
    expect(await reconcileGoogleFeedback(control, campaigns, api)).toEqual({ complete: false, inspected: 5 });
    expect(control.state.feedback).toMatchObject({ cursor: '100', checkedAt: 1, pageToken: 'next', upper: '200' });
    expect(await reconcileGoogleFeedback(control, campaigns, api)).toEqual({ complete: true, inspected: 0 });
    expect(control.state.feedback?.cursor).toBe('200');
    expect(control.state.feedback?.pending).toBeUndefined();
    expect(control.state.feedback?.checkedAt).toBeGreaterThan(1);
    expect(api.mock.calls.filter(([path]) => path.startsWith('history?'))).toHaveLength(2);
  });
  it('never advances or applies partial facts after failed reads or a disconnected grant', async () => {
    control.state.connection!.feedbackAllowed = true;
    control.state.feedback = { cursor: '100', checkedAt: 1 };
    const campaigns = new MemoryPlgStore(), before = await campaigns.read();
    const api = vi.fn<GmailRead>(async (path: string) => {
      if (path.startsWith('history?')) return { historyId: '200', history: [{ messagesAdded: [{ message: { id: 'missing123' } }] }] };
      throw new Error('Synthetic history record is unavailable');
    });
    await expect(reconcileGoogleFeedback(control, campaigns, api)).rejects.toThrow('incomplete');
    expect(control.state.feedback?.cursor).toBe('100');
    expect(control.state.feedback?.checkedAt).toBe(1);
    expect(await campaigns.read()).toEqual(before);
    api.mockImplementation(async () => { delete control.state.connection; return { id: 'missing123', payload: { headers: [] } }; });
    await expect(reconcileGoogleFeedback(control, campaigns, api)).rejects.toThrow('ownership');
    expect(control.state.feedback?.cursor).toBe('100');
    expect(await campaigns.read()).toEqual(before);
    expect(control.state.feedbackLease).toBeUndefined();
  });
  it('recovers an expired cursor in bounded retained-mail pages, then catches up before allowing sends', async () => {
    control.state.connection!.feedbackAllowed = true;
    control.state.feedback = { cursor: '100', checkedAt: 1 };
    const campaigns = new MemoryPlgStore(), at = Date.now() - 86_400_000;
    await campaigns.transaction((s) => { s.deliveries.push({ provider: 'google_workspace', createdAt: new Date(at).toISOString() } as any); });
    const api = vi.fn<GmailRead>(async (path) => {
      if (path.startsWith('history?') && path.includes('startHistoryId=100')) throw new GmailReadError(404);
      if (path === 'profile') return { historyId: '200' };
      if (path.startsWith('messages?')) {
        const q = new URLSearchParams(path.split('?')[1]);
        expect(q.get('includeSpamTrash')).toBe('true');
        expect(q.get('q')).toBe(`after:${Math.floor((at - 86_400_000) / 1000)}`);
        return q.has('pageToken') ? { messages: [] } : { messages: [{ id: 'retainedReport' }], nextPageToken: 'second' };
      }
      if (path.startsWith('messages/')) return { id: 'retainedReport', payload: { headers: [] } };
      expect(path).toContain('startHistoryId=200');
      return { historyId: '250', history: [] };
    });
    expect(await reconcileGoogleFeedback(control, campaigns, api)).toEqual({ complete: false, inspected: 1 });
    expect(control.state.feedback).toMatchObject({ cursor: '100', checkedAt: null, recovery: { upper: '200' }, pageToken: 'second' });
    expect(await reconcileGoogleFeedback(control, campaigns, api)).toEqual({ complete: false, inspected: 0 });
    expect(control.state.feedback).toEqual({ cursor: '200', checkedAt: null });
    expect(await reconcileGoogleFeedback(control, campaigns, api)).toEqual({ complete: true, inspected: 0 });
    expect(control.state.feedback?.cursor).toBe('250');
    expect(control.state.feedback?.checkedAt).toBeGreaterThan(1);
    // An outage is never misclassified as an expired cursor or silently reset.
    api.mockRejectedValueOnce(new GmailReadError(403));
    await expect(reconcileGoogleFeedback(control, campaigns, api)).rejects.toThrow();
    expect(control.state.feedback?.cursor).toBe('250');
  });
});

describe('Canonical permission to Google transport integration', () => {
  const options = { enabled: true, url: 'https://api.hushh.ai/api/one/plg/subscriptions', secret: 'synthetic-only-canonical-secret-over-32-characters' };
  const runtime: PlgRuntime = { ...config, enabled: true, deliveryEnabled: true, emailProvider: 'google_workspace', googleMailCampaignsEnabled: true,
    operators: new Set(), signingSecret: 'synthetic-preference-signature-over-32-characters', apiKey: '', webhookSecret: '',
    from: `Neelesh Meena <${MAIL_OWNER}>`, replyTo: MAIL_OWNER, subscriptions: options };
  async function fixture() {
    const campaigns = new MemoryPlgStore(), at = Date.now(), stamp = new Date(at).toISOString();
    await campaigns.transaction((s) => {
      registerPlgCatalog(s, { revision: 'a'.repeat(64), agents: [{ id: 'agent_one', label: 'One', public: true, available: true }], actions: [] });
      applySubscription(s, { accountHash: `sha256:${accountHash('synthetic-owner')}`, revision: 1, checkedAt: stamp,
        enabled: true, eligible: true, erased: false, generation: id, frequency: 'daily', consentAt: stamp, chosenAt: stamp,
        accountId: 'synthetic-owner', email: 'synthetic@example.invalid', name: 'Synthetic', cohort: 'new' }, at);
      s.customerReporting = { policyRevision: 'b'.repeat(64), checkedAt: stamp };
      s.contacts[0].customerReporting = { ...s.customerReporting, eligible: true };
      s.contacts[0].group = 'treatment'; s.paused = false; s.ready.agent_one = true;
      s.templates.find((t) => t.journey === 'agent_one' && t.step === 'welcome')!.published = true;
    });
    control.state.connection!.feedbackAllowed = true;
    control.state.feedback = { cursor: '100', checkedAt: at };
    return campaigns;
  }
  it.each(['allowed', 'revoked', 'changed_during_prepare'] as const)('%s: prepares credentials before the final One decision, then sends at most once', async (outcome) => {
    const campaigns = await fixture(), order: string[] = [];
    (oauth.access as Mock).mockImplementation(async () => {
      order.push('prepare');
      if (outcome === 'changed_during_prepare') await campaigns.transaction((s) => { s.contacts[0].permission!.enabled = false; });
      return 'synthetic-access';
    });
    transport.mockImplementation(async () => { order.push('send'); return Response.json({ id: 'googleAccepted' }); });
    const source = new OneSubscriptions(options, (async () => {
      order.push('permission'); return Response.json({ allowed: outcome === 'allowed', erased: false });
    }) as typeof fetch);
    const service = new PlgService(campaigns, runtime, Date.now, undefined, source, mail);
    const result = await service.run('Synthetic local verification');
    expect(result.sent).toBe(outcome === 'allowed' ? 1 : 0);
    expect(order).toEqual(outcome === 'allowed' ? ['prepare', 'permission', 'send'] : outcome === 'revoked' ? ['prepare', 'permission'] : ['prepare']);
    if (outcome === 'allowed') {
      expect((await campaigns.read()).deliveries[0]).toMatchObject({ provider: 'google_workspace', providerId: 'googleAccepted', status: 'sent' });
      transport.mockImplementation(async (url) => Response.json(String(url).includes('/messages/googleAccepted?')
        ? { id: 'googleAccepted', labelIds: ['SENT'], payload: { headers: [
          { name: 'Message-ID', value: '<accepted=canonical@mail.gmail.com>' },
          { name: 'From', value: `Neelesh Meena <${MAIL_OWNER}>` }, { name: 'To', value: 'synthetic@example.invalid' },
        ] } } : { historyId: '101', history: [] }));
      await service.run('Synthetic replay');
      expect(transport.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
    } else {
      expect(transport).not.toHaveBeenCalled();
      expect((await campaigns.read()).deliveries).toHaveLength(0);
    }
  });
  it('shows stale feedback as blocked and never sends while recovery still has pending mail', async () => {
    const campaigns = await fixture();
    control.state.feedback!.checkedAt = Date.now() - 21 * 60_000;
    const service = new PlgService(campaigns, runtime, Date.now, undefined, undefined, mail);
    expect((await service.workspace('admin')).automation!.blockers.join(' ')).toContain('current complete checkpoint');
    control.state.feedback!.checkedAt = Date.now();
    control.state.feedback!.recovery = { after: 1, upper: '200' };
    const prepared = await mail.prepareCampaign();
    await expect(mail.send('synthetic@example.invalid', delivery, message, 'campaign', prepared)).rejects.toThrow('not submitted');
    expect(transport).not.toHaveBeenCalled();
    expect(control.state.attempts).toHaveLength(0);
  });
});
