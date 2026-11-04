import { createHash, createHmac } from 'node:crypto';
import type { GmailRead, GoogleFeedbackExtension } from './google-mail-reconcile';
import { reportedHardBounces, type GmailMessage } from './google-mail-feedback';
import { googleMessageMetadata } from './google-mail-metadata';
import { MAIL_OWNER } from './google-mail-store';

export type AttemptEnvironment = 'uat' | 'production';
export interface AttemptReference { id: string; accountId: string }
export interface AttemptGrant {
  id: string; claimId: string; to: string; agentId: string; actionId: string;
  agentLabel: string; actionLabel: string; phase: 'returned' | 'failed' | 'cancelled' | 'blocked';
  observedAt: string; source: 'client_reported'; permissionGeneration: string; unsubscribeUrl: string;
}
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const opaque = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(v);
const label = (v: unknown, limit: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= limit && !/[\x00-\x1f\x7f]/.test(v);
const digest = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const failure = () => new Error('Attempt email source did not confirm the request.');

/** Fixed environment endpoints, distinct purposes, bounded responses, no submission retries. */
export class OneAttemptEmails implements GoogleFeedbackExtension {
  readonly origin: string;
  constructor(readonly environment: AttemptEnvironment, private secret: string,
    private fetcher: typeof fetch = fetch, private now = Date.now) {
    if (!['uat', 'production'].includes(environment) || secret.length < 32) throw failure();
    this.origin = environment === 'uat' ? 'https://api.uat.hushh.ai' : 'https://api.hushh.ai';
  }
  private async request(action: string, input: object) {
    const started = this.now(), body = JSON.stringify(input);
    const signature = createHmac('sha256', this.secret).update(`attempt-emails.${this.environment}.${action}\n${started}\n${body}`).digest('hex');
    try {
      const response = await this.fetcher(`${this.origin}/api/one/plg/attempt-email/${action}`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000), body,
        headers: { 'Content-Type': 'application/json', 'X-PLG-Timestamp': String(started), 'X-PLG-Signature': signature },
      });
      if (!response.ok || !response.body) { await response.body?.cancel(); throw failure(); }
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          bytes += value.byteLength;
          if (bytes > 64_000) { await reader.cancel(); throw failure(); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (data?.environment !== this.environment || this.now() < started || this.now() - started > 35_000) throw failure();
      return data;
    } catch { throw failure(); } // Provider/source bodies and recipient fields never enter logs.
  }
  async pending(): Promise<AttemptReference[]> {
    const data = await this.request('pull', {}), rows = data.deliveries;
    if (!Array.isArray(rows) || rows.length > 20 || rows.some(r => !uuid(r?.id) || !label(r?.accountId, 128)) ||
      new Set(rows.map(r => r.id)).size !== rows.length) throw failure();
    return rows.map(r => ({ id: r.id, accountId: r.accountId }));
  }
  async claim(row: AttemptReference, claimId: string): Promise<AttemptGrant | null> {
    if (!uuid(row.id) || !uuid(claimId) || !label(row.accountId, 128)) throw failure();
    const data = await this.request('claim', { ...row, claimId }), d = data.delivery;
    if (d === null) return null;
    if (!d || d.id !== row.id || d.claimId !== claimId || !uuid(d.permissionGeneration) ||
      !label(d.agentId, 128) || !label(d.actionId, 256) || !label(d.agentLabel, 160) || !label(d.actionLabel, 240) ||
      !label(d.to, 254) || !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(d.to) ||
      !['returned', 'failed', 'cancelled', 'blocked'].includes(d.phase) || d.source !== 'client_reported' ||
      !label(d.observedAt, 40) || !Number.isFinite(Date.parse(d.observedAt)) ||
      Date.parse(d.observedAt) > this.now() + 60_000 || Date.parse(d.observedAt) < this.now() - 86_400_000 ||
      !label(d.unsubscribeUrl, 400)) throw failure();
    const link = new URL(d.unsubscribeUrl);
    if (link.origin !== this.origin || link.pathname !== '/api/one/plg/attempt-email/unsubscribe' ||
      link.hash || link.username || link.password || [...link.searchParams.keys()].join(',') !== 'token' ||
      !/^[a-f0-9]{64}\.[a-f0-9-]{36}\.[a-f0-9]{64}$/.test(link.searchParams.get('token') ?? '')) throw failure();
    const [ownerHash, permission] = link.searchParams.get('token')!.split('.');
    if (ownerHash !== createHash('sha256').update(row.accountId).digest('hex') || permission !== d.permissionGeneration) throw failure();
    return { id: d.id, claimId: d.claimId, to: d.to, agentId: d.agentId, actionId: d.actionId,
      agentLabel: d.agentLabel, actionLabel: d.actionLabel, phase: d.phase, observedAt: d.observedAt,
      source: d.source, permissionGeneration: d.permissionGeneration, unsubscribeUrl: d.unsubscribeUrl };
  }
  async settle(row: AttemptReference, claimId: string, providerId: string | null, notSubmitted = false) {
    if (!uuid(row.id) || !uuid(claimId) || !label(row.accountId, 128) || providerId !== null && !opaque(providerId)) throw failure();
    if (notSubmitted && providerId !== null) throw failure();
    const data = await this.request('settle', { ...row, claimId, providerId, notSubmitted });
    if (data.received !== true) throw failure();
  }
  private async state() {
    const data = await this.request('feedback-state', {});
    if (typeof data.unsettled !== 'boolean' || !Array.isArray(data.unbound) || data.unbound.length > 20 ||
      data.unbound.some(r => !uuid(r?.id) || !opaque(r?.providerId) || !digest(r?.recipientHash)) ||
      new Set(data.unbound.map(r => r.providerId)).size !== data.unbound.length ||
      data.oldestAt !== null && (!label(data.oldestAt, 40) || !Number.isFinite(Date.parse(data.oldestAt)) || Date.parse(data.oldestAt) > this.now())) throw failure();
    return data as { oldestAt: string | null; unsettled: boolean; unbound: { id: string; providerId: string; recipientHash: string }[] };
  }
  async oldestReservation() { return (await this.state()).oldestAt; }
  async bind(api: GmailRead, signal: AbortSignal, assertAuthority: () => Promise<unknown>) {
    const state = await this.state(), submissions = [];
    for (const row of state.unbound) {
      signal.throwIfAborted();
      const message = await api(`messages/${row.providerId}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=From&metadataHeaders=To`, signal);
      const bound = this.submission(message);
      if (message.id !== row.providerId || !bound || bound.recipientHash !== row.recipientHash) throw failure();
      submissions.push(bound);
    }
    await assertAuthority();
    return this.applyFacts(submissions, []);
  }
  private submission(message: GmailMessage) {
    const headers = googleMessageMetadata(message);
    if (!opaque(message.id) || !message.labelIds?.includes('SENT') ||
      !headers || headers.from !== `Neelesh Meena <${MAIL_OWNER}>`) return null;
    return { providerId: message.id, messageId: headers.messageId,
      recipientHash: createHash('sha256').update(headers.to).digest('hex') };
  }
  private async applyFacts(submissions: object[], bounces: object[]) {
    if (submissions.length > 20 || bounces.length > 100) throw failure();
    // Each signed body stays below One's existing 16KB integration limit.
    // Partial application is idempotent; the Gmail page remains replayable.
    const batches = [{ submissions, bounces: [] as object[] }];
    for (let i = 0; i < bounces.length; i += 20) batches.push({ submissions: [], bounces: bounces.slice(i, i + 20) });
    for (const batch of batches) {
      if (Buffer.byteLength(JSON.stringify(batch)) > 16_000) throw failure();
      const data = await this.request('feedback-apply', batch);
      if (typeof data.complete !== 'boolean') throw failure();
      if (!data.complete) return false;
    }
    return true;
  }
  async apply(messages: GmailMessage[]) {
    return this.applyFacts(messages.flatMap(m => { const s = this.submission(m); return s ? [s] : []; }),
      messages.flatMap(reportedHardBounces));
  }
}
