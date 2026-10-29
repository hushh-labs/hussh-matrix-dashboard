import { describe, expect, it, vi } from 'vitest';
import { Firestore } from '@google-cloud/firestore';
import { randomUUID } from 'node:crypto';
import type { PlgDelivery, PlgState } from '../src/lib/plg';
import { outcomeProofs } from '../src/lib/plg-outcomes';
import { accountHash, candidate, DAY, enroll, eraseAccount, ingestEvent, initialPlgState, metrics, registerPlgCatalog } from '../src/server/plg/engine';
import { digest, hydrateAccount, sealAccount, settings } from '../src/server/plg/account-state';
import { AccountPlgStore } from '../src/server/plg/account-store';
import { PLG_LEGACY_PATH, PLG_STORAGE_AUTHORITY, PlgFirestoreStorage, PlgStorageMigration } from '../src/server/plg/firestore-storage';
import { AccountStorageMigration } from '../src/server/plg/account-migration';
import { FirestorePlgStore, validatePlgState } from '../src/server/plg/store';
import { PlgService, signValue, type PlgRuntime } from '../src/server/plg/service';
import { runAutomationCycle } from '../src/server/plg/automation';
import { GoogleMail, GoogleMailUnattempted } from '../src/server/plg/google-mail';
import { FirestoreMailControl, MAIL_OWNER } from '../src/server/plg/google-mail-store';
import { applySubscription, OneSubscriptions } from '../src/server/plg/one-subscriptions';
import express from 'express';
import request from 'supertest';
import { registerPlgRoutes } from '../src/server/plg/routes';
import * as sourceModule from '../src/server/plg/one-source';
import { Webhook } from 'svix';

const NOW = Date.parse('2026-10-29T00:00:00Z');
const accountProof = (checkedAt: number) => ({ protocol: 2 as const, checkedAt,
  serving: { revision: 'hushh-matrix-dashboard-00003-test', sourceSha: 'c'.repeat(40) },
  rollback: { revision: 'hushh-matrix-dashboard-00004-test', sourceSha: 'd'.repeat(40) } });
const stateFor = (accountId = 'person') => {
  const state = initialPlgState(); state.storage = { mode: 'accounts' };
  const contact = enroll(state, { accountId, email: `${accountId}@example.invalid`, name: 'Synthetic',
    journey: 'memory', cohort: 'new', environment: 'production', internal: false,
    consent: true, consentSource: 'Synthetic test fixture', frequency: 'daily' }, 'Fixture', NOW);
  contact.group = 'treatment'; state.paused = false; state.ready.memory = true;
  state.templates.find(template => template.id === 'memory-welcome')!.published = true;
  const proof = { policyRevision: 'd'.repeat(64), checkedAt: new Date(NOW).toISOString() };
  state.customerReporting = proof; contact.customerReporting = { ...proof, eligible: true };
  return state;
};
const receipt = (state: PlgState, id: string, status: PlgDelivery['status'] = 'sent'): PlgDelivery => ({
  id, contactId: state.contacts[0].id, templateId: 'memory-welcome', step: 'welcome', key: id,
  status, createdAt: new Date(NOW).toISOString(), subject: 'Synthetic', body: 'Synthetic', ctaLabel: 'Open',
  ctaUrl: 'https://one.hussh.ai/', providerId: status === 'sent' ? id : null, provider: 'google_workspace',
  recipientHash: accountHash(state.contacts[0].email),
  ...(status === 'sent' ? { rfcMessageId: `<${id}@example.invalid>` } : {}),
});

describe('bounded account codec', () => {
  it('retains archive facts while bounding the working history and event keys', () => {
    const state = stateFor();
    state.deliveries = Array.from({ length: 160 }, (_, i) => receipt(state, `history-${i}`));
    state.deliveries.push(receipt(state, 'unknown-send', 'uncertain'));
    state.eventIds = Array.from({ length: 160 }, (_, i) => `eventhash:${i}`);
    const sealed = sealAccount(state, accountHash('person'));
    expect(sealed.receipts).toHaveLength(161); expect(sealed.keys).toHaveLength(160);
    const loaded = hydrateAccount(settings(state), sealed.record);
    expect(loaded.deliveries).toHaveLength(51); expect(loaded.eventIds).toHaveLength(50);
    expect(loaded.deliveryPolicies![state.contacts[0].id].unresolved).toBe(true);
    expect(sealed.record.policy.latestPromotions).toHaveLength(3); // Equal times are separate reservations.
  });
  it('has no cohort-size document or shared 100-account enrollment cap', () => {
    for (let i = 0; i < 1001; i++) {
      const state = stateFor(`person-${i}`);
      const sealed = sealAccount(state, accountHash(`person-${i}`));
      expect(hydrateAccount(settings(state), sealed.record).contacts[0].accountId).toBe(`person-${i}`);
    }
  });
  it('rejects foreign scope, malformed policy and corrupted private projections', () => {
    const state = stateFor(), sealed = sealAccount(state, accountHash('person'));
    expect(() => sealAccount(state, accountHash('other'))).toThrow('scope');
    expect(() => hydrateAccount(settings(state), { ...sealed.record, policy: {} as any })).toThrow('policy');
    expect(() => hydrateAccount(settings(state), { ...sealed.record, contact: null })).toThrow('parity');
    expect(() => hydrateAccount(settings(state), { ...sealed.record, payload: '{PRIVATE' })).toThrow('shape');
  });
});

const emulator = process.env.PLG_STORAGE_EMULATOR_TESTS === 'true';
if (emulator && !/^127\.0\.0\.1:\d{2,5}$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? ''))
  throw new Error('Account storage tests require the explicit local Firestore emulator.');
describe.skipIf(!emulator)('account Firestore integration', () => {
  async function fixture(run: (root: AccountPlgStore, db: Firestore) => Promise<void>) {
    const db = new Firestore({ projectId: 'demo-plg-storage', databaseId: `demo-accounts-${randomUUID().slice(0, 8)}` });
    const generation = 'a'.repeat(64), state = stateFor();
    await db.doc(PLG_STORAGE_AUTHORITY).set({ protocol: 2, mode: 'accounts', generation, revision: 1, sourceHash: 'b'.repeat(64) });
    await db.doc(`one_plg_generations/${generation}`).set({ schema: 2, settings: settings(state), mailFence: { pending: 0 } });
    try { await run(new AccountPlgStore(db, generation), db); } finally { await db.terminate(); }
  }
  const enrollOne = async (root: AccountPlgStore, id = 'person') => {
    const store = root.account(accountHash(id));
    await store.transaction(state => Object.assign(state, stateFor(id)));
    return store;
  };
  it.each([false, true])('persists staff test routing and isolates customer reporting (disable during permission check: %s)', async disable => fixture(async root => {
    await enrollOne(root, 'customer');
    const staff = await enrollOne(root, 'staff');
    await root.transaction(s => { s.staffTestingEnabled = true; });
    await staff.transaction(s => {
      const c = s.contacts[0]; c.email = 'synthetic-team@hushh.ai'; c.group = 'control';
      c.customerReporting!.eligible = false;
      c.permission = { enabled: true, eligible: true, generation: '14dfc8fb-f456-46c2-ae3e-dc51f92a0816', revision: 1, checkedAt: new Date(NOW).toISOString() };
      c.staffTesting = { generation: c.permission.generation, email: c.email, checkedAt: new Date(NOW).toISOString() };
    });
    const before = await root.readWorkspace({ query: 'synthetic-team' }, NOW);
    expect(before.contacts).toHaveLength(1); expect(before.storage!.report!.metrics.enrolled).toBe(1);
    expect(before.storage!.report!.reporting.excluded).toBe(1);
    const runtime: PlgRuntime = { enabled: true, deliveryEnabled: true, origin: 'https://metrics.example.invalid',
      admins: new Set(), operators: new Set(), signingSecret: 'test-only-signing-over-thirty-two-characters',
      apiKey: 'synthetic', webhookSecret: 'synthetic', from: 'Test <sender@example.invalid>', replyTo: 'reply@example.invalid' };
    const permission = new OneSubscriptions({ enabled: true, url: 'https://api.hushh.ai/api/one/plg/subscriptions', secret: 'synthetic-only-permission-key-over-thirty-two' },
      (async () => { if (disable) await root.transaction(s => { s.staffTestingEnabled = false; }); return Response.json({ allowed: true, erased: false }); }) as typeof fetch, () => NOW);
    const send = vi.fn(async () => 'synthetic-staff-accepted');
    const service = new PlgService(staff, runtime, () => NOW, send, permission);
    expect(await service.run('Team test')).toEqual({ sent: disable ? 0 : 1, uncertain: 0 });
    expect(send).toHaveBeenCalledTimes(disable ? 0 : 1);
    expect(await service.run('Replay')).toEqual({ sent: 0, uncertain: 0 });
    if (!disable) {
      const visible = await root.readWorkspace({}, NOW);
      expect(visible.deliveries).toHaveLength(1);
      expect(visible.deliveries[0].subject).toContain('[PLG TEAM TEST]');
      expect(visible.storage!.report!.metrics.enrolled).toBe(1);
      await root.transaction(s => { s.staffTestingEnabled = false; });
    }
    expect((await root.readWorkspace({ query: 'synthetic-team' }, NOW)).contacts).toHaveLength(0);
    expect((await staff.read()).contacts[0].customerReporting?.eligible).toBe(false);
  }));
  it('persists canonical observation grant fences through account reload and renewal without losing a delivery claim', async () => fixture(async (root, db) => {
    const id = 'canonical-behavior-1', firstGrant = '14dfc8fb-f456-46c2-ae3e-dc51f92a0816';
    const nextGrant = '24dfc8fb-f456-46c2-ae3e-dc51f92a0816', now = NOW + 3 * DAY;
    await root.transaction(state => {
      registerPlgCatalog(state, { revision: 'c'.repeat(64), actions: [], agents: [{ id: 'agent_one', label: 'One', public: true, available: true,
        outcome: { status: 'supported', proof: 'one.distinct_domain_effects.v1', label: 'Confirmed effect', reason: 'Positive domain receipts only.' } },
        { id: 'agent_personal_information', label: 'Memory', public: true, available: true,
          outcome: { status: 'supported', proof: outcomeProofs.agent_personal_information, label: 'Confirmed save', reason: 'Positive domain receipts only.' } }] });
      state.ready.agent_one = state.ready.memory = true;
      state.templates.filter(template => ['agent_one', 'memory'].includes(template.journey)).forEach(template => { template.published = true; });
      state.customerReporting!.checkedAt = new Date(now).toISOString();
    });
    const member = root.account(accountHash(id));
    const change = { accountHash: `sha256:${accountHash(id)}`, revision: 1, checkedAt: new Date(now).toISOString(),
      erased: false, enabled: true, eligible: true, generation: firstGrant, frequency: 'weekly' as const,
      consentAt: new Date(NOW).toISOString(), chosenAt: new Date(NOW).toISOString(), accountId: id,
      email: 'canonical@example.invalid', name: 'Synthetic', cohort: 'existing' as const };
    await member.transaction(state => {
      applySubscription(state, change, NOW);
      const contact = state.contacts[0];
      contact.customerReporting = { ...state.customerReporting!, eligible: true };
      contact.firstValueAt = new Date(NOW + 1000).toISOString();
      contact.lastValueAt = new Date(NOW + DAY).toISOString();
      contact.valueDays = [contact.firstValueAt.slice(0, 10), contact.lastValueAt.slice(0, 10)];
      contact.activity = { enabled: true, mode: 'best_effort', limited: false,
        epoch: 'e'.repeat(64), startedAt: new Date(NOW).toISOString(), agents: [] };
      contact.routingEvidence = { checkedAt: new Date(now).toISOString(), generation: firstGrant,
        epoch: 'e'.repeat(64), agents: [{ agentId: 'agent_one', proof: outcomeProofs.agent_one,
          firstAt: contact.firstValueAt, lastAt: new Date(now - 1000).toISOString() },
          { agentId: 'agent_personal_information', proof: outcomeProofs.agent_personal_information,
            firstAt: contact.firstValueAt, lastAt: contact.lastValueAt }] };
      const welcome = { ...receipt(state, 'canonical-welcome'), templateId: 'agent_one-welcome',
        key: `${contact.id}:agent_one-welcome:1` };
      state.deliveries.push(welcome);
      ingestEvent(state, { eventId: 'canonical-complete', accountId: id, journey: 'agent_one', environment: 'production',
        internal: false, kind: 'observation_completed', verified: true, permissionGeneration: firstGrant,
        activityEpoch: 'e'.repeat(64), occurredAt: new Date(now).toISOString() }, now);
    });
    const before = await member.read(), oldContact = before.contacts[0];
    expect(oldContact).toMatchObject({ journey: 'agent_one', observationPermissionGeneration: firstGrant });
    expect(candidate(before, oldContact, now)).toMatchObject({ eligible: true, step: 'repeat' });
    const positiveOnly = structuredClone(before);
    delete positiveOnly.contacts[0].observationAt;
    delete positiveOnly.contacts[0].observationPermissionGeneration;
    delete positiveOnly.contacts[0].observationEpoch;
    expect(candidate(positiveOnly, positiveOnly.contacts[0], now)).toMatchObject({
      eligible: true, step: 'repeat', journey: 'memory', templateId: 'memory-repeat',
    });
    positiveOnly.contacts[0].routingEvidence!.epoch = 'f'.repeat(64);
    expect(candidate(positiveOnly, positiveOnly.contacts[0], now)).toMatchObject({ eligible: true, step: 'newsletter' });
    await member.transaction(state => applySubscription(state, { ...change, revision: 2 }, now));
    const sameGrant = await member.read();
    expect(candidate(sameGrant, sameGrant.contacts[0], now)).toMatchObject({ eligible: true, step: 'repeat' });
    await member.transaction(state => { state.contacts[0].activity!.epoch = 'f'.repeat(64); });
    const nextEpoch = await member.read();
    expect(nextEpoch.contacts[0].observationEpoch).toBe('e'.repeat(64));
    expect(candidate(nextEpoch, nextEpoch.contacts[0], now)).toMatchObject({ eligible: true, step: 'newsletter' });
    await member.transaction(state => applySubscription(state, { ...change, revision: 3, generation: nextGrant,
      consentAt: new Date(now).toISOString(), chosenAt: new Date(now).toISOString() }, now));
    const after = await member.read(), contact = after.contacts[0];
    expect(contact.firstValueAt).toBe(oldContact.firstValueAt);
    expect(contact.observationAt).toBeUndefined();
    expect(contact.observationPermissionGeneration).toBeUndefined();
    expect(contact.observationEpoch).toBeUndefined();
    expect(after.deliveries).toEqual(before.deliveries);
    expect(candidate(after, contact, now)).toMatchObject({ eligible: true, step: 'newsletter' });
    const claim = db.doc(`one_plg_generations/${'a'.repeat(64)}/one_plg_keys/${digest('delivery\n' + before.deliveries[0].key)}`);
    expect((await claim.get()).get('deliveryId')).toBe('canonical-welcome');
    await expect(member.transaction(state => ingestEvent(state, { eventId: 'delayed-old-complete', accountId: id,
      journey: 'agent_one', environment: 'production', internal: false, kind: 'observation_completed', verified: true,
      permissionGeneration: firstGrant, occurredAt: new Date(now).toISOString() }, now)))
      .rejects.toThrow('current One email permission');
    expect((await member.read()).eventIds).toEqual(after.eventIds);
  }), 15_000);
  it('isolates accounts, enforces a unique email and rejects cross-account erasure', async () => fixture(async root => {
    const one = await enrollOne(root), two = await enrollOne(root, 'second');
    await expect(two.transaction(state => { state.contacts[0].email = 'person@example.invalid'; })).rejects.toThrow('already enrolled');
    expect((await one.read()).contacts[0].email).toBe('person@example.invalid');
    await expect(two.transaction(state => { state.erasedAccountHashes = [accountHash('person')]; })).rejects.toThrow('scope');
  }), 15_000);
  it('persists and fairly paginates 130 independent accounts beyond the former cap', async () => fixture(async (root, db) => {
    for (let offset = 0; offset < 130; offset += 4)
      await Promise.all(Array.from({ length: Math.min(4, 130 - offset) }, (_, n) => enrollOne(root, `member-${offset + n}`)));
    const seen = new Set<string>(); let cursor: string | null = null;
    do {
      const page = await root.page(cursor, 20);
      page.accounts.forEach(hash => { expect(seen.has(hash)).toBe(false); seen.add(hash); });
      cursor = page.next;
    } while (cursor);
    expect(seen.size).toBe(130); expect((await root.read()).storage!.totalContacts).toBe(130);
    const people = new Set<string>(); let after: string | null = null;
    do {
      const result = await root.readWorkspace({ after }, NOW);
      expect(result.contacts.length).toBeLessThanOrEqual(25);
      expect(result.storage!.report!.metrics.enrolled).toBe(130);
      expect(metrics(result, NOW).enrolled).toBe(130);
      for (const contact of result.contacts) { expect(people.has(contact.id)).toBe(false); people.add(contact.id); }
      after = result.storage!.report!.contacts.nextAfter;
    } while (after);
    expect(people.size).toBe(130);
    const match = await root.readWorkspace({ query: 'member-129' }, NOW);
    expect(match.contacts.map(contact => contact.accountId)).toEqual(['member-129']);
    expect(match.storage!.report!.contacts.matches).toBe(1);
    expect(match.storage!.report!.metrics.enrolled).toBe(130);
    const run = db.runTransaction.bind(db); let inserted = false;
    const hook = vi.spyOn(db, 'runTransaction').mockImplementation((async (fn: any, options: any) => {
      const value = await run(fn, options);
      if (options?.readTime && !inserted) {
        inserted = true; await enrollOne(root, 'concurrent-new');
        await root.transaction(state => { state.customerReporting!.checkedAt = new Date(NOW + 1).toISOString(); });
      }
      return value;
    }) as any);
    try {
      expect((await root.readWorkspace({}, NOW)).storage!.report!.metrics.enrolled).toBe(130);
      expect(inserted).toBe(true);
    } finally { hook.mockRestore(); }
    expect((await root.readWorkspace({}, NOW)).storage!.report!.metrics.enrolled).toBe(131);
    let changed = false;
    const revision = vi.spyOn(db, 'runTransaction').mockImplementation((async (fn: any, options: any) => {
      const value = await run(fn, options);
      if (options?.readTime && !changed) {
        changed = true; await root.transaction(state => { state.customerReporting!.policyRevision = 'f'.repeat(64); });
      }
      return value;
    }) as any);
    try { await expect(root.readWorkspace({}, NOW)).rejects.toThrow('Campaign settings changed'); }
    finally { revision.mockRestore(); }
  }), 30_000);
  it('reduces 1001 real independent account records without materializing their private payloads or history', async () => fixture(async root => {
    for (let offset = 0; offset < 1001; offset += 4)
      await Promise.all(Array.from({ length: Math.min(4, 1001 - offset) }, (_, n) => enrollOne(root, `scale-${offset + n}`)));
    const started = Date.now(), result = await root.readWorkspace({ query: 'scale-1000@' }, NOW);
    expect(result.contacts.map(contact => contact.accountId)).toEqual(['scale-1000']);
    expect(result.storage!.totalContacts).toBe(1001);
    expect(result.storage!.report!.contacts).toMatchObject({ matches: 1, checked: 1001 });
    expect(metrics(result, NOW).enrolled).toBe(1001);
    expect(result.storage!.report!.cohorts.reduce((sum, row) => sum + row.enrolled, 0)).toBe(1001);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(100_000);
    expect(Date.now() - started).toBeLessThan(20_000);
  }), 60_000);
  it('filters actual decision stages while retaining global cohorts, activity and off-page delivery history', async () => fixture(async root => {
    const blocked = await enrollOne(root, 'blocked'), success = await enrollOne(root, 'success');
    await enrollOne(root, 'unknown'); const excluded = await enrollOne(root, 'excluded');
    const pending = await enrollOne(root, 'pending');
    await excluded.transaction(state => { state.contacts[0].customerReporting!.eligible = false; });
    await pending.transaction(state => { state.contacts[0].customerReporting!.checkedAt = new Date(NOW - 2 * 86400_000).toISOString(); });
    await blocked.transaction(state => {
      const contact = state.contacts[0]; contact.firstValueAt = contact.lastValueAt = new Date(NOW - 2 * 3600_000).toISOString();
      contact.failedAt = new Date(NOW - 3600_000).toISOString();
      contact.activity = { enabled: true, epoch: 'e'.repeat(64), mode: 'best_effort', limited: false, startedAt: contact.firstValueAt,
        agents: [{ agentId: 'agent_calendar', executed: 2, reported: 1, failed: 1, lastAt: contact.failedAt, days: ['2026-10-29'] }] };
      state.deliveries.push(receipt(state, 'off-page-receipt'));
    });
    await success.transaction(state => { state.contacts[0].firstValueAt = state.contacts[0].lastValueAt = new Date(NOW).toISOString(); });
    const help = await root.readWorkspace({ filter: 'assistance' }, NOW);
    expect(help.contacts.map(contact => contact.accountId)).toEqual(['blocked']);
    const unknown = await root.readWorkspace({ filter: 'unknown' }, NOW);
    expect(unknown.contacts.map(contact => contact.accountId)).toEqual(['unknown']);
    const none = await root.readWorkspace({ query: 'no-matching-account' }, NOW);
    expect(none.contacts).toHaveLength(0); expect(metrics(none, NOW).enrolled).toBe(3);
    expect(none.storage!.report!.reporting).toEqual({ pending: 1, excluded: 1 });
    expect(none.storage!.report!.activity).toEqual({ connectedAccounts: 1,
      agents: [{ agentId: 'agent_calendar', observedAccounts: 1, executed: 2, reported: 1, failed: 1 }] });
    expect(none.deliveries.map(delivery => delivery.id)).toEqual(['off-page-receipt']);
    expect(none.storage!.report!.history.emails[help.contacts[0].id]).toBe('blocked@example.invalid');
    await expect(root.readWorkspace({ generation: 'f'.repeat(64) }, NOW)).rejects.toThrow('storage changed');
  }));
  it('blocks sends during feedback, persists uncertain holds and advances the pending fence atomically', async () => fixture(async (root, db) => {
    const one = await enrollOne(root);
    await expect(root.withFeedbackFence(async () => {
      await expect(one.transaction(state => { state.deliveries.push(receipt(state, 'refused', 'sending')); })).rejects.toThrow('feedback');
    })).resolves.toBe(true);
    await one.transaction(state => { state.deliveries.push(receipt(state, 'pending', 'sending')); });
    expect((await db.doc(`one_plg_generations/${'a'.repeat(64)}`).get()).get('mailFence.pending')).toBe(1);
    await one.transaction(state => { state.deliveries[0].status = 'uncertain'; });
    expect(await root.withFeedbackFence(async () => { throw new Error('Must not consume a page'); })).toBe(false);
    expect(candidate(await one.read(), (await one.read()).contacts[0], NOW).reason).toContain('confirmation pending');
  }));
  it('releases only an exact unattempted reservation and permits its next legitimate retry', async () => fixture(async root => {
    const one = await enrollOne(root);
    await one.transaction(state => { state.deliveries.push(receipt(state, 'unattempted', 'sending')); });
    const pending = await one.read();
    expect(candidate(pending, pending.contacts[0], NOW).eligible).toBe(false);
    const before = await one.readWithoutReservation('unattempted');
    expect(candidate(before, before.contacts[0], NOW).eligible).toBe(true);
    await one.transaction(state => { state.deliveries = []; });
    const released = await one.read();
    expect(candidate(released, released.contacts[0], NOW).eligible).toBe(true);
    expect(await root.withFeedbackFence(async () => {})).toBe(true);
    await one.transaction(state => { state.deliveries.push(receipt(state, 'unattempted', 'sending')); });
    expect((await one.read()).deliveries).toHaveLength(1);
  }));
  it('preserves global dedup facts beyond the working set and never copies another account history', async () => fixture(async (root, db) => {
    const one = await enrollOne(root), two = await enrollOne(root, 'second');
    await one.transaction(state => { state.eventIds = Array.from({ length: 120 }, (_, i) => `event-${i}`); });
    expect((await one.read()).eventIds).toHaveLength(50);
    const duplicate = await two.transaction(state => {
      if (state.eventIds.includes('event-0')) return true;
      state.eventIds.push('event-0'); state.contacts[0].notes = 'must-not-apply'; return false;
    });
    expect(duplicate).toBe(true); expect((await two.read()).contacts[0].notes).toBe('');
    expect((await db.collection(`one_plg_generations/${'a'.repeat(64)}/one_plg_keys`).get()).size).toBe(120);
  }));
  it('runs a real service reservation/preflight/receipt loop without sending twice', async () => fixture(async root => {
    const one = await enrollOne(root); let sends = 0;
    const runtime: PlgRuntime = { enabled: true, deliveryEnabled: true, origin: 'https://metrics.example.invalid',
      admins: new Set(), operators: new Set(), signingSecret: 'test-only-signing-over-thirty-two-characters',
      apiKey: 'synthetic', webhookSecret: 'synthetic', from: 'Test <sender@example.invalid>', replyTo: 'reply@example.invalid' };
    const service = new PlgService(one, runtime, () => NOW, async () => { sends++; return 'accepted'; });
    expect(await service.run('Fixture')).toEqual({ sent: 1, uncertain: 0 });
    expect(await service.run('Fixture')).toEqual({ sent: 0, uncertain: 0 });
    expect(sends).toBe(1); expect((await one.read()).deliveries[0].providerId).toBe('accepted');
  }));
  it('keeps a cycle budget tail queued and resumes at the first unsent account without duplication', async () => fixture(async root => {
    for (const id of ['first', 'second', 'third']) await enrollOne(root, id);
    await root.transaction(state => { state.automation = { enabled: true }; });
    const original = await root.page(null, 25); let clock = NOW, sends = 0;
    const runtime: PlgRuntime = { enabled: true, deliveryEnabled: true, origin: 'https://metrics.example.invalid',
      admins: new Set(), operators: new Set(), signingSecret: 'test-only-signing-over-thirty-two-characters',
      apiKey: 'synthetic', webhookSecret: 'synthetic', from: 'Test <sender@example.invalid>', replyTo: 'reply@example.invalid' };
    const service = new PlgService(root, runtime, () => clock, async () => {
      if (++sends === 1) clock += 145_000;
      return `accepted-${sends}`;
    });
    const sync = async () => {
      const after = (await root.readSettings()).automation?.accountCursor ?? null, page = await root.page(after, 25);
      return { accounts: page.accounts.length, imported: 0, erased: 0, accountHashes: page.accounts, accountPage: { after, next: page.next } };
    };
    expect(await runAutomationCycle(service, sync, () => clock)).toMatchObject({ sent: 1 });
    expect((await root.readSettings()).automation?.accountCursor).toBe(original.accounts[0]);
    expect(await runAutomationCycle(service, sync, () => clock)).toMatchObject({ sent: 2 });
    expect((await root.readSettings()).automation?.accountCursor).toBeNull();
    expect(sends).toBe(3);
    for (const hash of original.accounts) expect((await root.account(hash).read()).deliveries).toHaveLength(1);
  }));
  it('walks multiple source pages fairly in one bounded cycle without treating held accounts as sends', async () => fixture(async root => {
    for (let n = 0; n < 70; n++) {
      const member = await enrollOne(root, `held-${n}`);
      await member.transaction(state => { state.contacts[0].group = 'control'; });
    }
    await root.transaction(state => { state.automation = { enabled: true }; });
    const visited = new Set<string>(), continuations: boolean[] = [];
    const sync = async (_deadline?: number, continuation = false) => {
      continuations.push(continuation);
      const after = (await root.readSettings()).automation?.accountCursor ?? null, page = await root.page(after, 25);
      page.accounts.forEach(hash => { expect(visited.has(hash)).toBe(false); visited.add(hash); });
      return { accounts: page.accounts.length, imported: 0, erased: 0, accountHashes: page.accounts, accountPage: { after, next: page.next } };
    };
    const runtime: PlgRuntime = { enabled: true, deliveryEnabled: true, origin: 'https://metrics.example.invalid',
      admins: new Set(), operators: new Set(), signingSecret: 'test-only-signing-over-thirty-two-characters',
      apiKey: 'synthetic', webhookSecret: 'synthetic', from: 'Test <sender@example.invalid>', replyTo: 'reply@example.invalid' };
    const transport = vi.fn(async () => 'must-not-send');
    const result = await runAutomationCycle(new PlgService(root, runtime, () => NOW, transport), sync, () => NOW);
    expect(result).toMatchObject({ status: 'completed', accounts: 70, sent: 0, uncertain: 0 });
    expect(visited.size).toBe(70); expect(continuations).toEqual([false, true, true]);
    expect((await root.readSettings()).automation?.accountCursor).toBeNull(); expect(transport).not.toHaveBeenCalled();
  }), 30_000);
  it('retains the first unsubmitted account under provider backpressure and releases its exact reservation', async () => fixture(async root => {
    const member = await enrollOne(root);
    await root.transaction(state => { state.automation = { enabled: true }; });
    const runtime: PlgRuntime = { enabled: true, deliveryEnabled: true, origin: 'https://metrics.example.invalid',
      admins: new Set(), operators: new Set(), signingSecret: 'test-only-signing-over-thirty-two-characters',
      apiKey: 'synthetic', webhookSecret: 'synthetic', from: 'Test <sender@example.invalid>', replyTo: 'reply@example.invalid' };
    const sync = async () => {
      const after = (await root.readSettings()).automation?.accountCursor ?? null, page = await root.page(after, 25);
      return { accounts: page.accounts.length, imported: 0, erased: 0, accountHashes: page.accounts, accountPage: { after, next: page.next } };
    };
    const refused = vi.fn(async () => { throw new GoogleMailUnattempted(409); });
    const held = await runAutomationCycle(new PlgService(root, runtime, () => NOW, refused), sync, () => NOW);
    expect(held).toMatchObject({ status: 'blocked', sent: 0, uncertain: 0 });
    expect(held.reason).toContain('unsubmitted'); expect(refused).toHaveBeenCalledOnce();
    expect((await root.readSettings()).automation?.accountCursor ?? null).toBeNull();
    expect((await member.read()).deliveries).toHaveLength(0);
    const accepted = vi.fn(async () => 'accepted');
    expect(await runAutomationCycle(new PlgService(root, runtime, () => NOW, accepted), sync, () => NOW)).toMatchObject({ sent: 1 });
    expect(accepted).toHaveBeenCalledOnce(); expect((await member.read()).deliveries).toHaveLength(1);
  }));
  it('durably holds real Google rejections and resumes the same native account queue without duplicates', async () => fixture(async (root, db) => {
    const members = [];
    for (let n = 0; n < 12; n++) members.push(await enrollOne(root, `google-paced-${n}`));
    for (const member of members) await member.transaction(state => {
      state.contacts[0].permission = { revision: 1, generation: randomUUID(), enabled: true, eligible: true, checkedAt: new Date(NOW).toISOString() };
    });
    await root.transaction(state => { state.automation = { enabled: true }; });
    let clock = NOW, posts = 0;
    const control = new FirestoreMailControl('demo-plg-storage', db.databaseId, db);
    await control.transaction(state => {
      state.generation = 1; state.connection = { version: '1', generation: 1, connectedAt: NOW, feedbackAllowed: true };
      state.feedback = { cursor: '100', checkedAt: clock };
    });
    const accepted = new Map<string, { to: string; messageId: string }>();
    const transport = vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
      const url = String(input);
      if (options?.method === 'POST') {
        posts++;
        if (posts === 1) return new Response('Synthetic quota rejection', { status: 429, headers: { 'Retry-After': '900' } });
        const mime = Buffer.from(JSON.parse(String(options.body)).raw, 'base64url').toString();
        const id = `accepted${posts}`;
        accepted.set(id, { to: mime.match(/\r\nTo: ([^\r\n]+)/)![1], messageId: `<${id}@example.invalid>` });
        return Response.json({ id });
      }
      if (url.includes('/messages/')) {
        const id = new URL(url).pathname.split('/').at(-1)!, metadata = accepted.get(id)!;
        return Response.json({ id, labelIds: ['SENT'], payload: { headers: [
          { name: 'Message-ID', value: metadata.messageId }, { name: 'From', value: `Neelesh Meena <${MAIL_OWNER}>` },
          { name: 'To', value: metadata.to },
        ] } });
      }
      if (url.includes('/history?')) return Response.json({ historyId: '101', history: [] });
      throw new Error('Unexpected synthetic provider request');
    });
    const mail = new GoogleMail(control, { save: async () => '1', read: async () => 'synthetic-refresh' },
      { readReports: true, url: () => '', exchange: async () => '', access: async () => 'synthetic-access' }, transport, () => clock);
    const subscriptions = { enabled: true, url: 'https://api.hushh.ai/api/one/plg/subscriptions', secret: 'synthetic-only-secret-over-thirty-two-characters' };
    const permission = new OneSubscriptions(subscriptions, (async () => Response.json({ allowed: true, erased: false })) as typeof fetch, () => clock);
    const runtime: PlgRuntime = { enabled: true, deliveryEnabled: true, origin: 'https://metrics.example.invalid',
      admins: new Set(), operators: new Set(), signingSecret: 'synthetic-only-signing-over-thirty-two-characters',
      emailProvider: 'google_workspace', googleMailCampaignsEnabled: true, subscriptions,
      apiKey: '', webhookSecret: '',
      from: `Neelesh Meena <${MAIL_OWNER}>`, replyTo: MAIL_OWNER };
    const service = new PlgService(root, runtime, () => clock, undefined, permission, mail);
    const sync = async () => {
      const after = (await root.readSettings()).automation?.accountCursor ?? null, page = await root.page(after, 25);
      return { accounts: page.accounts.length, imported: 0, erased: 0, accountHashes: page.accounts, accountPage: { after, next: page.next } };
    };
    expect(await runAutomationCycle(service, sync, () => clock)).toMatchObject({ status: 'blocked', sent: 0, uncertain: 0 });
    expect((await control.read()).sendBackoff).toMatchObject({ status: 429, generation: 1 });
    expect((await control.read()).attempts).toHaveLength(0);
    for (const member of members) expect((await member.read()).deliveries).toHaveLength(0);
    expect((await root.readSettings()).automation?.accountCursor ?? null).toBeNull();
    expect((await service.workspace('admin')).automation!.blockers.join(' ')).toContain('provider retry is deferred');
    expect(await runAutomationCycle(service, sync, () => clock)).toMatchObject({ status: 'blocked', sent: 0, uncertain: 0 });
    expect(posts).toBe(1);
    clock += 16 * 60_000;
    await control.transaction(state => { state.feedback!.checkedAt = clock; });
    expect(await runAutomationCycle(service, sync, () => clock)).toMatchObject({ status: 'blocked', sent: 10, uncertain: 0 });
    expect(await runAutomationCycle(service, sync, () => clock)).toMatchObject({ sent: 0, uncertain: 0 });
    const reloaded = new FirestoreMailControl('demo-plg-storage', db.databaseId, db);
    expect((await reloaded.read()).pacingNextAt).toBe(clock + 10 * 60_000);
    clock += 16 * 60_000;
    await control.transaction(state => { state.feedback!.checkedAt = clock; });
    expect(await runAutomationCycle(service, sync, () => clock)).toMatchObject({ status: 'completed', sent: 2, uncertain: 0 });
    expect(posts).toBe(13); expect((await control.read()).attempts).toHaveLength(12);
    for (const member of members) expect((await member.read()).deliveries).toMatchObject([{ status: 'sent', provider: 'google_workspace' }]);
    expect((await root.readSettings()).automation?.accountCursor ?? null).toBeNull();
  }), 30_000);
  it('preserves the longest native mailbox hold across concurrently in-flight provider rejections', async () => fixture(async (_root, db) => {
    let clock = NOW;
    const control = new FirestoreMailControl('demo-plg-storage', db.databaseId, db);
    await control.transaction(state => {
      state.generation = 1; state.connection = { version: '1', generation: 1, connectedAt: NOW };
    });
    const finish: ((response: Response) => void)[] = [];
    const transport = vi.fn(async () => Response.json({ id: 'acceptedAfterWait' }))
      .mockImplementationOnce(() => new Promise(resolve => { finish[0] = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { finish[1] = resolve; }));
    const mail = new GoogleMail(control, { save: async () => '1', read: async () => 'synthetic-refresh' },
      { url: () => '', exchange: async () => '', access: async () => 'synthetic-access' }, transport, () => clock);
    const delivery = { id: randomUUID(), subject: 'Synthetic native quota test' };
    const message = { text: 'Synthetic', html: '<p>Synthetic</p>', headers: {} };
    const first = mail.send(MAIL_OWNER, delivery, message).catch(error => error);
    await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    const second = mail.send(MAIL_OWNER, { ...delivery, id: randomUUID() }, message).catch(error => error);
    await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(2), { timeout: 10_000 });
    finish[0](new Response(null, { status: 429, headers: { 'Retry-After': '7200' } }));
    expect(await first).toBeInstanceOf(GoogleMailUnattempted);
    finish[1](new Response(null, { status: 403 }));
    expect(await second).toBeInstanceOf(GoogleMailUnattempted);
    expect((await control.read()).sendBackoff).toMatchObject({ until: NOW + 7200_000, failures: 2, generation: 1 });
    clock += 7200_000 - 1;
    await expect(mail.send(MAIL_OWNER, delivery, message)).rejects.toBeInstanceOf(GoogleMailUnattempted);
    expect(transport).toHaveBeenCalledTimes(2); expect((await control.read()).attempts).toHaveLength(0);
    clock += 2;
    expect(await mail.send(MAIL_OWNER, delivery, message)).toBe('acceptedAfterWait');
    expect(transport).toHaveBeenCalledTimes(3); expect((await control.read()).attempts).toHaveLength(1);
  }), 30_000);
  it('continues independent evidence collection across paused cycles without moving the unsent cursor', async () => fixture(async root => {
    for (let offset = 0; offset < 70; offset += 4)
      await Promise.all(Array.from({ length: Math.min(4, 70 - offset) }, (_, n) => enrollOne(root, `paused-${offset + n}`)));
    await root.transaction(state => { state.paused = true; state.automation = { enabled: true, accountCursor: '0'.repeat(64) }; });
    const seen = new Set<string>(), transport = vi.fn(async () => 'must-not-send');
    const source = vi.spyOn(sourceModule, 'syncOneEvidence').mockImplementation(async (_store, _options, _fetcher, _clock, _id, _deadline, hashes) => {
      for (const hash of hashes!) { expect(seen.has(hash)).toBe(false); seen.add(hash); }
      return { accounts: hashes!.length, imported: 0, erased: 0, retainedOnly: true };
    });
    const runtime: PlgRuntime = { enabled: true, deliveryEnabled: true, origin: 'https://metrics.example.invalid',
      admins: new Set(), operators: new Set(), signingSecret: 'test-only-signing-over-thirty-two-characters',
      cycleSecret: 'test-only-cycle-key-over-thirty-two-characters', apiKey: 'synthetic', webhookSecret: 'synthetic',
      from: 'Test <sender@example.invalid>', replyTo: 'reply@example.invalid' };
    const app = express(); app.use(express.json({ verify(req, _res, buffer) { (req as any).plgRawBody = buffer.toString(); } }));
    registerPlgRoutes(app, false, new PlgService(root, runtime, Date.now, transport));
    try {
      for (let n = 0; n < 3; n++) {
        const timestamp = String(Date.now()), body = '{}';
        const response = await request(app).post('/integrations/plg/cycle').set('Content-Type', 'application/json')
          .set('X-PLG-Timestamp', timestamp).set('X-PLG-Signature', signValue(`cycle\n${timestamp}\n${body}`, runtime.cycleSecret!)).send(body);
        expect(response.status).toBe(200); expect(response.body).toMatchObject({ status: 'blocked', sent: 0 });
      }
      expect(seen.size).toBe(70); expect(source).toHaveBeenCalledTimes(3);
      expect((await root.readSettings()).automation).toMatchObject({ accountCursor: '0'.repeat(64), sourceCursor: null });
      expect(transport).not.toHaveBeenCalled();
    } finally { source.mockRestore(); }
  }), 30_000);
  it('resolves archived routing claims before due filters, totals, preview and reservation choose the same alternative', async () => fixture(async (root, db) => {
    await root.transaction(state => {
      registerPlgCatalog(state, { revision: 'c'.repeat(64), actions: [], agents: [
        { id: 'agent_one', label: 'One', public: true, available: true,
          outcome: { status: 'supported', proof: 'one.distinct_domain_effects.v1', label: 'Positive result', reason: 'Synthetic' } },
        { id: 'agent_personal_information', label: 'Memory', public: true, available: true,
          outcome: { status: 'supported', proof: 'memory.confirmed_save.v1', label: 'Saved item', reason: 'Synthetic' } },
      ] });
      state.ready.agent_one = true; state.templates.forEach(template => { template.published = true; });
    });
    const member = root.account(accountHash('routed'));
    await member.transaction(state => {
      const contact = enroll(state, { accountId: 'routed', email: 'routed@example.invalid', journey: 'agent_one', cohort: 'existing',
        frequency: 'daily', consent: true, consentSource: 'Synthetic', environment: 'production', internal: false }, 'Fixture', NOW - 4 * 86400_000);
      contact.group = 'treatment'; contact.firstValueAt = contact.lastValueAt = new Date(NOW - 2 * 86400_000).toISOString();
      contact.customerReporting = { ...state.customerReporting!, eligible: true };
      contact.permission = { enabled: true, eligible: true, generation: '14dfc8fb-f456-46c2-ae3e-dc51f92a0816', revision: 1, checkedAt: new Date(NOW).toISOString() };
      contact.routingEvidence = { checkedAt: new Date(NOW).toISOString(), generation: contact.permission.generation,
        agents: [{ agentId: 'agent_personal_information', proof: 'memory.confirmed_save.v1', lastAt: new Date(NOW - 86400_000).toISOString() }] };
    });
    const before = await member.read(), original = candidate(before, before.contacts[0], NOW);
    expect(original).toMatchObject({ eligible: true, journey: 'memory', step: 'newsletter' });
    await member.transaction(state => { state.deliveries.push({ ...receipt(state, 'archived-memory'), step: 'newsletter',
      key: original.key!, templateId: original.templateId!, createdAt: new Date(NOW - 3 * 86400_000).toISOString() }); });
    await member.transaction(state => { state.deliveries.push(...Array.from({ length: 51 }, (_, n) => ({
      ...receipt(state, `more-recent-${n}`), step: 'manual' as const, createdAt: new Date(NOW - 2 * 86400_000 + n).toISOString(),
    }))); });
    const trimmed = await member.read(); expect(trimmed.deliveryPolicies![trimmed.contacts[0].id].claimedKeys).not.toContain(original.key);
    const due = await root.readWorkspace({ filter: 'due' }, NOW);
    expect(due.contacts).toHaveLength(1); expect(due.storage!.report!.eligible).toBe(1);
    expect(candidate(due, due.contacts[0], NOW)).toMatchObject({ eligible: true, templateId: 'agent_one-newsletter' });
    const runtime: PlgRuntime = { enabled: true, deliveryEnabled: true, origin: 'https://metrics.example.invalid',
      admins: new Set(), operators: new Set(), signingSecret: 'test-only-signing-over-thirty-two-characters',
      apiKey: 'synthetic', webhookSecret: 'synthetic', from: 'Test <sender@example.invalid>', replyTo: 'reply@example.invalid' };
    const transport = vi.fn(async (input: any) => { expect(input.delivery.templateId).toBe('agent_one-newsletter'); return 'accepted-one'; });
    const service = new PlgService(root, runtime, () => NOW, transport, { check: async () => ({ allowed: true, erased: false }) } as any);
    expect((await service.workspace('operator', { filter: 'due' })).queue[0].templateId).toBe('agent_one-newsletter');
    expect((await service.preview({ filter: 'due' })).candidates[0].templateId).toBe('agent_one-newsletter');
    await root.transaction(state => { state.paused = true; });
    expect((await service.preview()).candidates[0]).toMatchObject({ eligible: true, templateId: 'agent_one-newsletter' });
    expect((await root.readWorkspace({}, NOW)).storage!.report!.eligible).toBe(0);
    await root.transaction(state => { state.paused = false; });
    expect(await service.withStore(member).run('Fixture')).toMatchObject({ sent: 1 }); expect(transport).toHaveBeenCalledOnce();
    const accepted = (await member.read()).deliveries.find(delivery => delivery.providerId === 'accepted-one')!;
    expect((await db.doc(`one_plg_generations/${'a'.repeat(64)}/one_plg_keys/${digest('delivery\n' + accepted.key)}`).get()).get('deliveryId')).toBe(accepted.id);
  }), 15_000);
  it('erases the account and permanent receipts without permitting delayed re-enrollment', async () => fixture(async root => {
    const one = await enrollOne(root);
    await one.transaction(state => { state.deliveries.push(receipt(state, 'accepted')); });
    await one.transaction(state => { eraseAccount(state, 'person', NOW); });
    expect((await one.read()).contacts).toHaveLength(0);
    await expect(enrollOne(root)).rejects.toThrow('erased');
    expect((await root.mailView()).deliveries).toHaveLength(0);
  }));
  it('rejects ambiguous RFC bindings and preserves confirmed receipt identity', async () => fixture(async root => {
    const one = await enrollOne(root);
    await one.transaction(state => { state.deliveries.push(receipt(state, 'first-proof')); });
    await expect(one.transaction(state => { state.deliveries[0].rfcMessageId = '<different@example.invalid>'; }))
      .rejects.toThrow('identity cannot change');
    await expect(one.transaction(state => {
      state.deliveries.push({ ...receipt(state, 'second-proof'), rfcMessageId: '<first-proof@example.invalid>' });
    })).rejects.toThrow('ambiguous');
    expect((await one.read()).deliveries).toHaveLength(1);
  }));
  it('completes multi-batch erasure of archived receipts, bindings and delivery claims', async () => fixture(async (root, db) => {
    const one = await enrollOne(root);
    for (let start = 0; start < 225; start += 75) await one.transaction(state => {
      state.deliveries.push(...Array.from({ length: 75 }, (_, i) => receipt(state, `archive-${start + i}`)));
    });
    const history = new Set<string>(); let historyAfter: { createdAt: string; id: string } | null = null;
    do {
      const result = await root.readWorkspace({ historyAfter }, NOW);
      expect(result.deliveries.length).toBeLessThanOrEqual(25);
      for (const delivery of result.deliveries) { expect(history.has(delivery.id)).toBe(false); history.add(delivery.id); }
      historyAfter = result.storage!.report!.history.nextAfter;
    } while (historyAfter);
    expect(history.size).toBe(225);
    const source = vi.fn(async (_url: any, init: any) => {
      const request = JSON.parse(init.body);
      return Response.json({ version: 2, environment: 'production', retainedOnly: true, asOf: new Date(NOW).toISOString(),
        customerReporting: { scope: 'production_registered_contacts', policyRevision: 'd'.repeat(64) },
        catalog: { revision: 'c'.repeat(64), actions: [], agents: [{ id: 'agent_personal_information', label: 'Memory', public: true, available: true }] },
        accounts: request.accounts.map((row: any) => ({ ...row, deleted: true, reportingEligible: false, tasks: [], activity: null, verified: [] })) });
    });
    const options = { url: 'https://api.hushh.ai/api/one/plg/snapshot', secret: 'test-source-key-more-than-thirty-two-characters' };
    await expect(sourceModule.syncOneEvidence(root, options, source, () => NOW, undefined, NOW + 120_000, [accountHash('person')])).rejects.toThrow('cleanup');
    expect((await one.read()).contacts).toHaveLength(0);
    expect((await db.collection(`one_plg_generations/${'a'.repeat(64)}/one_plg_receipts`).get()).size).toBe(125);
    // The ordinary source retry must drain bodies even though no contact remains
    // to produce another deletion snapshot or subscription replay.
    await sourceModule.syncOneEvidence(root, options, source, () => NOW, undefined, NOW + 120_000, [accountHash('person')]);
    for (const collection of ['one_plg_receipts', 'one_plg_keys', 'one_plg_bindings', 'one_plg_emails'])
      expect((await db.collection(`one_plg_generations/${'a'.repeat(64)}/${collection}`).get()).size).toBe(0);
    await expect(enrollOne(root)).rejects.toThrow('erased');
  }), 30_000);
  it('recovers a lost-provider-response bounce by delivery tag after the enrolled address changes', async () => fixture(async root => {
    const one = await enrollOne(root);
    await one.transaction(state => { state.deliveries.push({ ...receipt(state, 'lost-provider-response', 'uncertain'), provider: 'resend' }); });
    await one.transaction(state => { state.contacts[0].email = 'new-address@example.invalid'; });
    const runtime: PlgRuntime = { enabled: true, deliveryEnabled: false, origin: 'https://metrics.example.invalid',
      admins: new Set(), operators: new Set(), signingSecret: 'test-only-signing-over-thirty-two-characters', apiKey: '', from: '', replyTo: '',
      webhookSecret: 'whsec_' + Buffer.from('test-only-callback-secret').toString('base64') };
    const app = express(); app.use(express.json({ verify(req, _res, buffer) { (req as any).plgRawBody = buffer.toString(); } }));
    registerPlgRoutes(app, false, new PlgService(root, runtime));
    const event = JSON.stringify({ type: 'email.bounced', data: { email_id: 'accepted-after-lost-response',
      to: ['person@example.invalid'], tags: { plg_delivery_id: 'lost-provider-response' } } });
    const at = new Date(), id = 'msg_test-lost-response';
    const result = await request(app).post('/integrations/plg/resend').set('Content-Type', 'application/json')
      .set('svix-id', id).set('svix-timestamp', String(Math.floor(at.getTime() / 1000)))
      .set('svix-signature', new Webhook(runtime.webhookSecret).sign(id, at, event)).send(event);
    expect(result.status).toBe(200);
    const state = await one.read();
    expect(state.deliveries[0]).toMatchObject({ status: 'bounced', providerId: 'accepted-after-lost-response' });
    expect(state.contacts[0]).toMatchObject({ email: 'new-address@example.invalid', suppressed: 'bounced' });
  }));
});

describe.skipIf(!emulator)('explicit account storage migration', () => {
  it('aborts a partial copy without losing the frozen predecessor or restoring automation', async () => {
    const db = new Firestore({ projectId: 'demo-plg-storage', databaseId: `demo-abort-${randomUUID().slice(0, 8)}` });
    const source = stateFor(); delete source.storage; source.paused = true; source.automation = { enabled: false };
    source.deliveries = [receipt(source, 'abort-proof')];
    let time = NOW;
    try {
      await db.doc(PLG_LEGACY_PATH).set({ payload: JSON.stringify({ version: 2, authority: PLG_STORAGE_AUTHORITY, state: source }) });
      await db.doc(PLG_STORAGE_AUTHORITY).set({ protocol: 1, mode: 'legacy', revision: 1, fencedLegacy: true });
      const migration = new AccountStorageMigration(db, () => time);
      const frozen = await migration.freeze({ protocol: 2, checkedAt: NOW,
        serving: { revision: 'hushh-matrix-dashboard-00003-test', sourceSha: 'c'.repeat(40) },
        rollback: { revision: 'hushh-matrix-dashboard-00004-test', sourceSha: 'd'.repeat(40) } }, { paused: false, automatic: true });
      let progress = await migration.copy(100);
      while (progress.copied < progress.total) progress = await migration.copy(100);
      await migration.verify(); time += 300_001;
      let outcome = await migration.abort(1);
      expect(outcome.complete).toBe(false);
      await expect(migration.activate(accountProof(time))).rejects.toThrow('abort');
      await expect(migration.copy()).rejects.toThrow('abort');
      await expect(migration.verify()).rejects.toThrow('abort');
      while (!outcome.complete) outcome = await migration.abort(1);
      const restored = await new PlgFirestoreStorage(db, validatePlgState).read();
      expect(restored.contacts).toEqual(source.contacts); expect(restored.deliveries).toEqual(source.deliveries);
      expect(restored.paused).toBe(true); expect(restored.automation!.enabled).toBe(false);
      expect((await db.doc(PLG_STORAGE_AUTHORITY).get()).get('mode')).toBe('legacy');
      expect((await db.doc(`one_plg_generations/${frozen.generation}`).get()).exists).toBe(false);
      for (const collection of ['one_plg_accounts', 'one_plg_receipts', 'one_plg_keys', 'one_plg_emails', 'one_plg_bindings'])
        expect((await db.collection(`one_plg_generations/${frozen.generation}/${collection}`).get()).size).toBe(0);
    } finally { await db.terminate(); }
  }, 30_000);
  it('refuses a parity certificate when abort commits before its final transaction', async () => {
    const db = new Firestore({ projectId: 'demo-plg-storage', databaseId: `demo-abort-race-${randomUUID().slice(0, 8)}` });
    const source = stateFor(); delete source.storage; source.paused = true; source.automation = { enabled: false };
    source.deliveries = [receipt(source, 'race-proof')];
    let hook: ReturnType<typeof vi.spyOn> | undefined;
    try {
      await db.doc(PLG_LEGACY_PATH).set({ payload: JSON.stringify({ version: 2, authority: PLG_STORAGE_AUTHORITY, state: source }) });
      await db.doc(PLG_STORAGE_AUTHORITY).set({ protocol: 1, mode: 'legacy', revision: 1, fencedLegacy: true });
      const migration = new AccountStorageMigration(db, () => NOW);
      await migration.freeze(accountProof(NOW), { paused: false, automatic: true });
      let progress = await migration.copy(100);
      while (progress.copied < progress.total) progress = await migration.copy(100);
      const run = db.runTransaction.bind(db); let injected = false;
      hook = vi.spyOn(db, 'runTransaction').mockImplementation((async (fn: any, options: any) => {
        if (!options?.readOnly && !injected) { injected = true; expect((await migration.abort(1)).complete).toBe(false); }
        return run(fn, options);
      }) as any);
      await expect(migration.verify()).rejects.toThrow('abort');
      expect(injected).toBe(true);
      const control = (await db.doc(PLG_STORAGE_AUTHORITY).get()).data()!;
      expect(control.migration.aborting).toBe(true); expect(control.migration.verified).toBe(false);
    } finally { hook?.mockRestore(); await db.terminate(); }
  }, 30_000);
  it.each(['legacy', 'normalized'])('fences %s writers, proves copy parity and erases every retired private copy', async mode => {
    const db = new Firestore({ projectId: 'demo-plg-storage', databaseId: `demo-migration-${randomUUID().slice(0, 8)}` });
    let time = NOW; const clock = () => time;
    const source = stateFor(); delete source.storage; source.paused = true; source.automation = { enabled: false };
    source.eventIds = ['event:legacy-event'];
    source.deliveries = [receipt(source, 'old-acceptance')];
    source.erasedAccountHashes = [accountHash('already-erased')];
    const adapter = new PlgFirestoreStorage(db, validatePlgState, clock);
    const bridge = new FirestorePlgStore('demo-plg-storage', 'unused', db);
    try {
      await db.doc(PLG_LEGACY_PATH).set({ payload: JSON.stringify(mode === 'legacy' ?
        { version: 2, authority: PLG_STORAGE_AUTHORITY, state: source } : source) });
      await db.doc(PLG_STORAGE_AUTHORITY).set({ protocol: 1, mode: 'legacy', revision: 1,
        ...(mode === 'legacy' ? { fencedLegacy: true } : {}) });
      if (mode === 'normalized') {
        const original = new PlgStorageMigration(db, validatePlgState, clock);
        let stage = await original.begin({ protocol: 1, checkedAt: time,
          serving: { revision: 'hushh-matrix-dashboard-00001-test', sourceSha: 'a'.repeat(40) },
          rollback: { revision: 'hushh-matrix-dashboard-00002-test', sourceSha: 'b'.repeat(40) } });
        while (stage.copied < stage.total) stage = await original.step(stage);
        stage = await original.verify(stage); time += 300_001;
        await original.activate(stage, { protocol: 1, checkedAt: time,
          serving: { revision: 'hushh-matrix-dashboard-00001-test', sourceSha: 'a'.repeat(40) },
          rollback: { revision: 'hushh-matrix-dashboard-00002-test', sourceSha: 'b'.repeat(40) } });
      }
      const oldGeneration = (await db.doc(PLG_STORAGE_AUTHORITY).get()).get('generation');
      const migration = new AccountStorageMigration(db, clock);
      const frozen = await migration.freeze({ protocol: 2, checkedAt: time,
        serving: { revision: 'hushh-matrix-dashboard-00003-test', sourceSha: 'c'.repeat(40) },
        rollback: { revision: 'hushh-matrix-dashboard-00004-test', sourceSha: 'd'.repeat(40) } }, { paused: false, automatic: true });
      expect((await bridge.read()).contacts).toEqual(source.contacts);
      await expect(adapter.transaction(state => { state.contacts[0].notes = 'OLD WRITER'; })).rejects.toThrow('authority');
      await expect(bridge.transaction(state => { state.paused = false; })).rejects.toThrow('transitioning');
      await expect(migration.verify()).rejects.toThrow('every migration record');
      let progress = await migration.copy(1);
      while (progress.copied < progress.total) progress = await migration.copy(100);
      const first = db.doc(`one_plg_generations/${frozen.generation}/one_plg_accounts/${accountHash('person')}`);
      const correct = (await first.get()).data()!;
      await first.update({ payload: '{CORRUPTED' });
      await expect(migration.verify()).rejects.toThrow('parity');
      await first.set(correct); await migration.verify();
      await expect(migration.activate(accountProof(time))).rejects.toThrow('five minutes');
      const stale = accountProof(time); time += 300_001;
      await expect(migration.activate(stale)).rejects.toThrow('fresh');
      const changed = accountProof(time); changed.serving.sourceSha = 'e'.repeat(40);
      await expect(migration.activate(changed)).rejects.toThrow('binaries changed');
      await migration.activate(accountProof(time));
      const accounts = (await bridge.accountStorage())!, member = accounts.account(accountHash('person'));
      const duplicate = await member.transaction(state => {
        const alias = `eventhash:${accountHash('legacy-event')}`;
        if (state.eventIds.includes(alias)) return true;
        state.eventIds.push(alias); state.contacts[0].notes = 'must-not-apply'; return false;
      });
      expect(duplicate).toBe(true); expect((await member.read()).contacts[0].notes).toBe('');
      expect((await member.read()).deliveries[0].id).toBe('old-acceptance');
      await expect(member.transaction(state => { eraseAccount(state, 'person', clock()); })).rejects.toThrow('cleanup');
      expect((await member.read()).contacts).toHaveLength(0);
      while (!(await migration.cleanup(1)).complete) { /* bounded batches */ }
      await member.transaction(state => { eraseAccount(state, 'person', clock()); });
      expect((await accounts.mailView()).deliveries).toHaveLength(0);
      if (oldGeneration) {
        expect((await db.doc(`one_plg_generations/${oldGeneration}`).get()).exists).toBe(false);
        expect((await db.collection(`one_plg_generations/${oldGeneration}/one_plg_records`).get()).size).toBe(0);
      }
      expect(JSON.parse((await db.doc(PLG_LEGACY_PATH).get()).get('payload'))).toEqual({ version: 2, authority: PLG_STORAGE_AUTHORITY });
      const erased = await accounts.account(accountHash('already-erased')).read();
      expect(erased.erasedAccountHashes).toEqual([accountHash('already-erased')]);
    } finally { await db.terminate(); }
  }, 30_000);
});
