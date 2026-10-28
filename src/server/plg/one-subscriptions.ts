import { createHash } from 'node:crypto';
import type { PlgContact, PlgFrequency, PlgState } from '../../lib/plg';
import { accountHash, enroll, eraseAccountHash, PlgError } from './engine';
import { oneProductionEndpoint } from '../one-scope.mjs';
import { signValue } from './service';
import type { PlgStore } from './store';

const ROOT = '/api/one/plg/subscriptions';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash = /^sha256:[a-f0-9]{64}$/;
const unavailable = () => new PlgError(503, 'One email permission did not confirm success. Automatic delivery remains blocked.');
export interface SubscriptionChange {
  accountHash: string;
  revision: number;
  checkedAt: string;
  erased: boolean;
  enabled: boolean;
  eligible: boolean;
  generation?: string;
  frequency?: PlgFrequency;
  consentAt?: string | null;
  chosenAt?: string;
  accountId?: string;
  email?: string;
  name?: string;
  cohort?: 'new' | 'existing';
}
function timestamp(value: unknown, now: number, fresh = false): string {
  if (typeof value !== 'string' || value.length > 40) throw unavailable();
  const at = Date.parse(value);
  if (!Number.isFinite(at) || at > now + 10_000 || (fresh && at < now - 120_000)) throw unavailable();
  return new Date(at).toISOString();
}
function changes(value: any, now: number): SubscriptionChange[] {
  if (value?.version !== 1 || value.environment !== 'production' || !Array.isArray(value.changes) || value.changes.length > 25)
    throw unavailable();
  const seen = new Set<string>();
  return value.changes.map((row: any) => {
    if (!row || typeof row.accountHash !== 'string' || !hash.test(row.accountHash) || seen.has(row.accountHash) ||
      !Number.isSafeInteger(row.revision) || row.revision < 1 || typeof row.erased !== 'boolean' ||
      typeof row.enabled !== 'boolean' || typeof row.eligible !== 'boolean' || (row.eligible && !row.enabled) ||
      (row.erased && (row.enabled || row.eligible))) throw unavailable();
    seen.add(row.accountHash);
    const result: SubscriptionChange = { accountHash: row.accountHash, revision: row.revision,
      checkedAt: timestamp(row.checkedAt, now, true), erased: row.erased, enabled: row.enabled, eligible: row.eligible };
    if (row.erased) return result; // Erasure never imports a raw UID or identity.
    if (typeof row.generation !== 'string' || !uuid.test(row.generation) ||
      !['daily', 'weekly', 'updates'].includes(row.frequency) || row.disclosureVersion !== 'one-email-updates-v1') throw unavailable();
    result.generation = row.generation;
    result.frequency = row.frequency;
    result.chosenAt = timestamp(row.chosenAt, now);
    result.consentAt = row.consentAt === null ? null : timestamp(row.consentAt, now);
    if ((row.enabled && !result.consentAt) || (result.consentAt && result.consentAt > result.chosenAt)) throw unavailable();
    if (!row.eligible) return result; // Unavailable identity is not an opt-out.
    if (typeof row.accountId !== 'string' || !row.accountId || row.accountId.length > 128 ||
      row.accountHash !== `sha256:${accountHash(row.accountId)}` ||
      typeof row.email !== 'string' || row.email.length > 254 || row.email !== row.email.trim().toLowerCase() ||
      !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(row.email) ||
      typeof row.name !== 'string' || row.name.length > 200 ||
      !['new', 'existing'].includes(row.cohort)) throw unavailable();
    // The producer caps code points; JS/storage limits count UTF-16 units.
    // Normalize presentation text without splitting supplementary characters.
    let name = '';
    for (const part of row.name.replace(/[\x00-\x1f\x7f]/g, '').trim()) {
      if (name.length + part.length > 100) break;
      name += part;
    }
    return { ...result, accountId: row.accountId, email: row.email, name, cohort: row.cohort };
  });
}

/** A dedicated credential can read/acknowledge permission or revoke it, never grant it. */
export class OneSubscriptions {
  constructor(
    private options: { enabled: boolean; url: string; secret: string },
    private fetcher: typeof fetch = fetch,
    private clock = Date.now,
    private deadline = Infinity,
  ) {}
  private async request(purpose: 'pull' | 'ack' | 'revoke' | 'check', payload: unknown, timeout: number) {
    const root = oneProductionEndpoint(this.options.url, ROOT);
    if (!this.options.enabled || !root || this.options.secret.length < 32) throw unavailable();
    const body = JSON.stringify(payload), timestamp = String(this.clock());
    const remaining = Math.min(timeout, this.deadline - this.clock());
    if (remaining < 1) throw unavailable();
    try {
      const response = await this.fetcher(`${root.href}/${purpose}`, { method: 'POST', redirect: 'error',
        signal: AbortSignal.timeout(remaining), body, headers: { 'Content-Type': 'application/json',
          'X-PLG-Timestamp': timestamp,
          'X-PLG-Signature': signValue(`subscriptions.${purpose}\n${timestamp}\n${body}`, this.options.secret) } });
      if (!response.ok || !response.body) throw unavailable();
      const reader = response.body.getReader(), chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 64_000) { await reader.cancel(); throw unavailable(); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { throw unavailable(); }
  }
  async pull() { return changes(await this.request('pull', {}, 60_000), this.clock()); }
  async ack(applied: SubscriptionChange[]) {
    const result = await this.request('ack', { changes: applied.map(({ accountHash, revision }) => ({ accountHash, revision })) }, 20_000);
    if (result?.received !== true) throw unavailable();
  }
  async revoke(item: { accountHash: string; generation: string }) {
    if (!hash.test(item.accountHash) || !uuid.test(item.generation)) throw unavailable();
    const result = await this.request('revoke', item, 25_000);
    if (typeof result?.revoked !== 'boolean') throw unavailable();
  }
  async check(contact: PlgContact) {
    if (!contact.permission?.enabled || !contact.permission.eligible) return { allowed: false, erased: false };
    const result = await this.request('check', { accountId: contact.accountId,
      generation: contact.permission.generation, revision: contact.permission.revision,
      emailHash: createHash('sha256').update(contact.email.trim().toLowerCase()).digest('hex') }, 35_000);
    if (typeof result?.allowed !== 'boolean' || typeof result?.erased !== 'boolean' || (result.allowed && result.erased)) throw unavailable();
    return { allowed: result.allowed, erased: result.erased };
  }
}

export function applySubscription(state: PlgState, change: SubscriptionChange, now: number) {
  const hash = change.accountHash.slice(7);
  if (change.erased) { eraseAccountHash(state, hash, now); return; }
  if (state.erasedAccountHashes?.includes(hash)) return;
  const version = state.subscriptionVersions?.[hash];
  if (version && (version.revision > change.revision ||
    (version.revision === change.revision && version.checkedAt >= change.checkedAt))) return;
  state.subscriptionVersions ??= {};
  state.subscriptionVersions[hash] = { revision: change.revision, checkedAt: change.checkedAt };
  let contact = state.contacts.find((c) => accountHash(c.accountId) === hash);
  if (contact?.permission && (contact.permission.revision > change.revision ||
    (contact.permission.revision === change.revision && contact.permission.checkedAt >= change.checkedAt))) return;
  if (!contact && !change.eligible) return;
  if (!contact) {
    if (!state.catalog?.agents.some((a) => a.id === 'agent_one' && a.public && a.available))
      throw new PlgError(503, 'The current One agent catalog is required before automatic enrollment.');
    contact = enroll(state, { accountId: change.accountId, email: change.email, name: change.name,
      environment: 'production', internal: false, journey: 'agent_one', cohort: change.cohort,
      frequency: change.frequency, consent: true, consentSource: 'One email updates preference v1' }, 'One account preference', now);
  }
  if (change.eligible) {
    if (state.contacts.some((c) => c.id !== contact!.id && c.email === change.email))
      throw new PlgError(409, 'An email is already enrolled for another account. Automatic enrollment requires reconciliation.');
    // Only an explicit new generation can clear a previous subscriber opt-out.
    // Provider bounce, complaint and suppression survive every re-enrollment.
    if (contact.suppressed === 'unsubscribed' && contact.permission && contact.permission.generation !== change.generation)
      contact.suppressed = null;
    if (contact.email !== change.email) delete contact.customerReporting;
    contact.email = change.email!;
    contact.name = change.name!;
  }
  contact.frequency = change.frequency!;
  contact.consentAt = change.enabled ? change.consentAt! : null;
  contact.consentSource = 'One email updates preference v1';
  contact.permission = { revision: change.revision, generation: change.generation!,
    enabled: change.enabled, eligible: change.eligible, checkedAt: change.checkedAt };
}

/** Persist local opt-out and its backend retry intent in the same transaction. */
export function queueSubscriptionRevocation(state: PlgState, contact: PlgContact, generation = contact.permission?.generation) {
  if (!generation || !contact.permission) return;
  const item = { accountHash: `sha256:${accountHash(contact.accountId)}`, generation };
  state.pendingRevocations ??= [];
  if (!state.pendingRevocations.some((r) => r.accountHash === item.accountHash && r.generation === generation))
    state.pendingRevocations.push(item);
}

export async function syncSubscriptions(store: PlgStore, source: OneSubscriptions, now = Date.now) {
  const accounts = await store.accountStorage?.();
  if (accounts && store.scope !== 'account') {
    const pending = await accounts.revocationAccounts();
    for (const hash of pending.hashes) {
      const member = accounts.account(hash);
      for (const item of (await member.read()).pendingRevocations ?? []) {
        await source.revoke(item);
        await member.transaction(state => {
          state.pendingRevocations = state.pendingRevocations?.filter(row =>
            row.accountHash !== item.accountHash || row.generation !== item.generation);
        });
      }
    }
    if (pending.more || (await accounts.revocationAccounts()).hashes.length) throw unavailable();
    // pull() validates the entire batch before the first account is changed.
    // Partial application is replayable and cannot acknowledge later revisions.
    const pulled = await source.pull();
    for (const change of pulled) await accounts.account(change.accountHash.slice(7)).transaction(state =>
      applySubscription(state, change, now()));
    await source.ack(pulled);
    await accounts.transaction(state => { state.subscriptionSyncAt = new Date(now()).toISOString(); });
    return { changes: pulled.length };
  }
  const pending = (await store.read()).pendingRevocations ?? [];
  // Bounded retry; delivery stays blocked if even one opt-out is unconfirmed.
  for (const item of pending.slice(0, 10)) {
    await source.revoke(item);
    await store.transaction((state) => {
      state.pendingRevocations = state.pendingRevocations?.filter((r) => r.accountHash !== item.accountHash || r.generation !== item.generation);
    });
  }
  if ((await store.read()).pendingRevocations?.length) throw unavailable();
  const pulled = await source.pull();
  // Atomic apply then exact-revision acknowledgement. A failed acknowledgement
  // safely replays; no provider side effect runs in this transaction.
  await store.transaction((state) => { for (const change of pulled) applySubscription(state, change, now()); });
  await source.ack(pulled);
  await store.transaction((state) => { state.subscriptionSyncAt = new Date(now()).toISOString(); });
  return { changes: pulled.length };
}
