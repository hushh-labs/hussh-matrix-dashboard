import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import type { PlgDelivery } from '../../lib/plg';
import { PlgError } from './engine';
import { MAIL_OWNER, type MailControlStore, type MailCredentials } from './google-mail-store';
import { GmailReadError, type GmailRead } from './google-mail-reconcile';
import { googleMessageMetadata } from './google-mail-metadata';
import { GmailSubmissionRejected, mailBackoff, recordMailRejection, requireMailReady } from './google-mail-backpressure';

export const MAIL_SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.metadata'];
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export interface GoogleMailConfig { clientId: string; clientSecret: string; redirectUri: string }
export interface PreparedGoogleMail { token: string; version: string; generation: number; preparedAt: number }
export interface OwnInboxReceipt { id: string; messageId: string }

function ownMessageHeaders(value: any) {
  const headers = googleMessageMetadata(value);
  return headers?.from === `Neelesh Meena <${MAIL_OWNER}>` && headers.to === MAIL_OWNER ? headers.messageId : null;
}
export class GoogleMailUnattempted extends PlgError {
  constructor(status = 409) { super(status, 'Mail was not submitted. Check the provider status before retrying.'); }
}
async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error('Google mail preparation deadline expired.'));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
export interface MailOAuth {
  readReports?: boolean;
  url(input: { state: string; nonce: string; verifier: string }): string;
  exchange(code: string, verifier: string, nonce: string): Promise<string>;
  access(refreshToken: string): Promise<string>;
}
export class GoogleMailOAuth implements MailOAuth {
  constructor(private config: GoogleMailConfig, public readonly readReports = false) {}
  private scopes() { return this.readReports ? MAIL_SCOPES.map((s) => s.endsWith('/gmail.metadata') ? 'https://www.googleapis.com/auth/gmail.readonly' : s) : MAIL_SCOPES; }
  private client() {
    return new OAuth2Client({ clientId: this.config.clientId, clientSecret: this.config.clientSecret,
      redirectUri: this.config.redirectUri, transporterOptions: { timeout: 10_000, retry: false } });
  }
  url(input: { state: string; nonce: string; verifier: string }) {
    return this.client().generateAuthUrl({ scope: this.scopes(), state: input.state, nonce: input.nonce,
      access_type: 'offline', prompt: 'consent select_account', login_hint: MAIL_OWNER,
      code_challenge: createHash('sha256').update(input.verifier).digest('base64url'), code_challenge_method: 'S256' as any,
      include_granted_scopes: false });
  }
  async exchange(code: string, verifier: string, nonce: string) {
    const client = this.client();
    const { tokens } = await client.getToken({ code, codeVerifier: verifier });
    if (!tokens.id_token || !tokens.refresh_token) throw new PlgError(409, 'Reconnect and grant offline mail access.');
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: this.config.clientId });
    const user = ticket.getPayload();
    if (user?.nonce !== nonce || user?.email_verified !== true || user?.email?.toLowerCase() !== MAIL_OWNER)
      throw new PlgError(403, 'Connect the configured work mailbox.');
    const scopes = new Set((tokens.scope ?? '').split(' '));
    if (!this.scopes().filter((s) => s.includes('/gmail.')).every((s) => scopes.has(s)))
      throw new PlgError(409, 'Both sending and mail receipt verification permissions are required.');
    return tokens.refresh_token;
  }
  async access(refreshToken: string) {
    const client = this.client();
    client.setCredentials({ refresh_token: refreshToken });
    const { token } = await client.getAccessToken();
    if (!token) throw new Error('Reconnect the work mailbox.');
    return token;
  }
}
export function mailMessageId(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid mail reservation.');
  return `<plg-${id}@metrics.hussh.ai>`;
}
const header = (value: string) => {
  if (!value || /[\r\n\x00-\x1f\x7f]/.test(value)) throw new PlgError(400, 'Invalid email header.');
  return value;
};
const base64Lines = (value: string) => Buffer.from(value).toString('base64').match(/.{1,76}/g)?.join('\r\n') ?? '';
function encodedSubject(value: string) {
  const chunks: string[] = [];
  let chunk = '';
  for (const character of value) {
    if (Buffer.byteLength(chunk + character) > 39) { chunks.push(chunk); chunk = ''; }
    chunk += character;
  }
  if (chunk) chunks.push(chunk);
  return chunks.map((part) => `=?UTF-8?B?${Buffer.from(part).toString('base64')}?=`).join('\r\n ');
}
/** Small fixed MIME shape; untrusted text is base64 encoded and cannot become headers. */
export function googleMailMime(to: string, delivery: Pick<PlgDelivery, 'id' | 'subject'>,
  message: { text: string; html: string; headers: Record<string, string> }) {
  if (!/^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(to)) throw new PlgError(400, 'Invalid email address.');
  header(delivery.subject);
  const boundary = `plg_${randomBytes(24).toString('hex')}`;
  const values = [
    `From: Neelesh Meena <${MAIL_OWNER}>`, `Reply-To: ${MAIL_OWNER}`, `To: ${to}`,
    `Subject: ${encodedSubject(delivery.subject)}`,
    `Message-ID: ${mailMessageId(delivery.id)}`, `Date: ${new Date().toUTCString()}`, 'MIME-Version: 1.0',
    ...Object.entries(message.headers).map(([name, value]) => {
      if (!['List-Unsubscribe', 'List-Unsubscribe-Post'].includes(name)) throw new Error('Unsupported mail header.');
      return `${name}: ${header(value)}`;
    }),
    `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
    ...(['text/plain', 'text/html'] as const).flatMap((type, i) => [`--${boundary}`,
      `Content-Type: ${type}; charset=UTF-8`, 'Content-Transfer-Encoding: base64', '', base64Lines(i ? message.html : message.text)]),
    `--${boundary}--`, '',
  ];
  return Buffer.from(values.join('\r\n')).toString('base64url');
}
export class GoogleMail {
  constructor(public store: MailControlStore, private credentials: MailCredentials, private oauth: MailOAuth,
    private transport: typeof fetch = fetch, private now = Date.now) {}
  async begin() {
    const verifier = randomBytes(32).toString('base64url');
    const pending = { state: `plg-mail.${randomBytes(24).toString('hex')}`, nonce: randomBytes(24).toString('hex'),
      verifierHash: hash(verifier), expiresAt: this.now() + 600_000, generation: 0 };
    await this.store.transaction((s) => { pending.generation = ++s.generation; s.pending = pending; });
    return { url: this.oauth.url({ ...pending, verifier }), cookie: `${pending.state}.${verifier}` };
  }
  async complete(state: string, code: string, cookie: string) {
    const verifier = cookie.startsWith(`${state}.`) ? cookie.slice(state.length + 1) : '';
    if (!/^[a-zA-Z0-9_-]{43}$/.test(verifier) || !code || code.length > 4096) throw new PlgError(400, 'Invalid mail connection state.');
    const pending = await this.store.transaction((s) => {
      const p = s.pending;
      if (!p || p.state !== state || p.expiresAt <= this.now() || p.verifierHash !== hash(verifier) || p.generation !== s.generation)
        throw new PlgError(400, 'Mail connection expired or already used.');
      delete s.pending; // single use, even when the token exchange fails
      return p;
    });
    const token = await this.oauth.exchange(code, verifier, pending.nonce);
    const version = await this.credentials.save(token);
    await this.store.transaction((s) => {
      if (s.generation !== pending.generation) throw new PlgError(409, 'A newer mailbox connection replaced this attempt.');
      s.connection = { version, generation: pending.generation, connectedAt: this.now(), feedbackAllowed: this.oauth.readReports === true };
    });
  }
  async disconnect() {
    // Remove runtime authority first. Do not revoke the shared Google OAuth
    // client, which could also invalidate the dashboard's ordinary sign-in.
    await this.store.transaction((s) => { ++s.generation; delete s.connection; delete s.pending; });
  }
  async status() {
    const state = await this.store.read();
    const hold = mailBackoff(state);
    return { provider: 'google_workspace', email: MAIL_OWNER, connected: Boolean(state.connection),
      connectedAt: state.connection?.connectedAt ?? null, pending: Boolean(state.pending && state.pending.expiresAt > this.now()),
      reportReadingRequested: this.oauth.readReports === true, feedbackAuthorized: state.connection?.feedbackAllowed === true,
      feedbackCheckedAt: state.feedback?.checkedAt ?? null, feedbackBacklog: Boolean(state.feedback?.pending || state.feedback?.pageToken || state.feedback?.recovery),
      providerRetryAt: hold && hold.until > this.now() ? hold.until : null,
      deliveryObservation: 'API acceptance; inbox receipt for own tests. External delivery and opens are not inferred.' };
  }
  async feedbackReader(deadline: number): Promise<GmailRead> {
    const before = (await this.store.read()).connection;
    if (!before?.feedbackAllowed) throw new PlgError(409, 'Reconnect Google mail with report-reading permission before customer sending.');
    const signal = AbortSignal.timeout(Math.max(1, Math.min(15_000, deadline - this.now())));
    const token = await abortable(this.oauth.access(await abortable(this.credentials.read(before.version), signal)), signal);
    if (this.now() >= deadline) throw new PlgError(503, 'Google feedback authorization deadline expired.');
    return async (path, signal) => {
      const current = (await this.store.read()).connection;
      if (current?.version !== before.version || current.generation !== before.generation)
        throw new PlgError(409, 'Google mail connection changed during feedback verification.');
      return this.api(path, token, signal);
    };
  }
  async prepareCampaign(): Promise<PreparedGoogleMail> {
    try {
      const state = await this.store.read(), before = state.connection;
      requireMailReady(state, this.now());
      if (!before?.feedbackAllowed) throw new PlgError(409, 'Google feedback permission is missing.');
      const signal = AbortSignal.timeout(15_000);
      const token = await abortable(this.oauth.access(await abortable(this.credentials.read(before.version), signal)), signal);
      return { token, version: before.version, generation: before.generation, preparedAt: this.now() };
    } catch (error) {
      throw new GoogleMailUnattempted(error instanceof PlgError ? error.status : 503);
    }
  }
  private async api(path: string, token: string, signal: AbortSignal, body?: unknown) {
    const response = await this.transport(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
      method: body ? 'POST' : 'GET', redirect: 'error', signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (path === 'messages/send' && body && [401, 403, 429].includes(response.status))
        throw new GmailSubmissionRejected(response.status as 401 | 403 | 429, response.headers.get('retry-after'));
      throw new GmailReadError(response.status);
    }
    if (!response.body) throw new Error('Google mail request did not confirm success.');
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 512_000) { await reader.cancel(); throw new Error('Google mail response exceeds its bound.'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  async send(to: string, delivery: Pick<PlgDelivery, 'id' | 'subject'>,
    message: { text: string; html: string; headers: Record<string, string> }, purpose: 'test' | 'campaign' = 'test', prepared?: PreparedGoogleMail) {
    let submitted = false, reserved = false;
    try {
    const raw = googleMailMime(to, delivery, message);
    const signal = AbortSignal.timeout(15_000);
    const state = await this.store.read(), before = state.connection;
    requireMailReady(state, this.now());
    if (!before) throw new PlgError(409, 'Connect the work mailbox first.');
    if (purpose === 'campaign' && (!prepared || prepared.version !== before.version || prepared.generation !== before.generation ||
      this.now() - prepared.preparedAt < 0 || this.now() - prepared.preparedAt > 60_000))
      throw new PlgError(409, 'Prepare the Google transport before the canonical recipient check.');
    const token = purpose === 'campaign' ? prepared!.token :
      await abortable(this.oauth.access(await abortable(this.credentials.read(before.version), signal)), signal);
    // Refresh/Secret Manager requests consume the same overall send deadline.
    signal.throwIfAborted();
    await this.store.transaction((s) => {
      if (s.connection?.version !== before.version || s.connection?.generation !== before.generation)
        throw new PlgError(409, 'Mailbox connection changed before send.');
      requireMailReady(s, this.now());
      const feedbackAge = this.now() - (s.feedback?.checkedAt ?? 0);
      if (purpose === 'campaign' && (!s.connection.feedbackAllowed || !s.feedback?.checkedAt || feedbackAge < 0 || feedbackAge > 20 * 60_000 || s.feedback.pending || s.feedback.pageToken || s.feedback.recovery))
        throw new PlgError(409, 'Google feedback is not current; customer sending is held.');
      s.attempts = s.attempts.filter((a) => this.now() - a.at < 86_400_000);
      if (s.attempts.some((a) => a.id === delivery.id)) throw new PlgError(409, 'This mail reservation was already attempted.');
      if (s.attempts.length >= 100) throw new PlgError(409, 'Application mail limit reached for this rolling day.');
      // Gmail has no idempotency-key contract. Persist the attempt before I/O;
      // ambiguous failures are never blindly retried.
      s.attempts.push({ id: delivery.id, at: this.now() });
    });
    reserved = true;
    signal.throwIfAborted();
    submitted = true;
    let result: any;
    try { result = await this.api('messages/send', token, signal, { raw }); }
    catch (error) {
      if (!(error instanceof GmailSubmissionRejected)) throw error;
      // Release only after the rejection and mailbox-wide wait are durable.
      // A failed commit remains uncertain; there is no unrecorded retry loop.
      await this.store.transaction(s => recordMailRejection(s, before, delivery.id, error, this.now()));
      reserved = submitted = false;
      throw new PlgError(error.status, 'Email provider rejected the submission; it remains queued.');
    }
    if (typeof result.id !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(result.id)) throw new Error('Google acceptance missing.');
    return result.id;
    } catch (error) {
      if (submitted) throw error;
      if (reserved) await this.store.transaction((s) => { s.attempts = s.attempts.filter((a) => a.id !== delivery.id); });
      throw new GoogleMailUnattempted(error instanceof PlgError ? error.status : 503);
    }
  }
  async confirmOwnInbox(providerId: string, reservationId: string) {
    if (!/^[a-zA-Z0-9_-]{1,160}$/.test(providerId)) throw new Error('Invalid mail receipt.');
    mailMessageId(reservationId); // Validate the reservation; Gmail may replace its RFC Message-ID.
    const signal = AbortSignal.timeout(15_000);
    const connection = (await this.store.read()).connection;
    if (!connection) return null;
    const token = await this.oauth.access(await this.credentials.read(connection.version));
    signal.throwIfAborted();
    // Gmail's accepted ID can be only the SENT copy. Inspect its exact thread
    // for a separate received copy; acceptance or SENT alone is never a receipt.
    // No inbox search, mark-as-read, label changes or message bodies.
    const result = await this.api(`messages/${providerId}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=From&metadataHeaders=To`, token, signal);
    if (result.id !== providerId) return null;
    // The authenticated accepted Gmail ID binds this submission. Its actual
    // RFC Message-ID, rather than our requested one, binds any received copy.
    const messageId = ownMessageHeaders(result);
    if (!messageId) return null;
    const matches = (value: any): OwnInboxReceipt | null => {
      return typeof value.id === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(value.id) && Array.isArray(value.labelIds) && value.labelIds.includes('INBOX') &&
        ownMessageHeaders(value) === messageId ? { id: value.id, messageId } : null;
    };
    const direct = matches(result);
    if (direct) return direct;
    if (typeof result.threadId !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(result.threadId)) return null;
    const thread = await this.api(`threads/${result.threadId}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=From&metadataHeaders=To`, token, signal);
    if (thread.id !== result.threadId || !Array.isArray(thread.messages) || thread.messages.length > 100) return null;
    for (const received of thread.messages) {
      if (received.threadId !== result.threadId) continue;
      const receipt = matches(received);
      if (receipt) return receipt;
    }
    return null;
  }
}
