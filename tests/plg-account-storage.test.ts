import { describe, expect, it, vi } from 'vitest';
import { Firestore } from '@google-cloud/firestore';
import { randomUUID } from 'node:crypto';
import type { PlgDelivery, PlgState } from '../src/lib/plg';
import { accountHash, candidate, enroll, eraseAccount, initialPlgState, metrics } from '../src/server/plg/engine';
import { hydrateAccount, sealAccount, settings } from '../src/server/plg/account-state';
import { AccountPlgStore } from '../src/server/plg/account-store';
import { PLG_LEGACY_PATH, PLG_STORAGE_AUTHORITY, PlgFirestoreStorage, PlgStorageMigration } from '../src/server/plg/firestore-storage';
import { AccountStorageMigration } from '../src/server/plg/account-migration';
import { FirestorePlgStore, validatePlgState } from '../src/server/plg/store';
import { PlgService, type PlgRuntime } from '../src/server/plg/service';
import { runAutomationCycle } from '../src/server/plg/automation';
import { GoogleMailUnattempted } from '../src/server/plg/google-mail';

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
      if (options?.readTime && !inserted) { inserted = true; await enrollOne(root, 'concurrent-new'); }
      return value;
    }) as any);
    try {
      expect((await root.readWorkspace({}, NOW)).storage!.report!.metrics.enrolled).toBe(130);
      expect(inserted).toBe(true);
    } finally { hook.mockRestore(); }
    expect((await root.readWorkspace({}, NOW)).storage!.report!.metrics.enrolled).toBe(131);
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
    for (let pass = 0; pass < 2; pass++) await expect(one.transaction(state => { eraseAccount(state, 'person', NOW); }))
      .rejects.toThrow('cleanup');
    await one.transaction(state => { eraseAccount(state, 'person', NOW); });
    for (const collection of ['one_plg_receipts', 'one_plg_keys', 'one_plg_bindings', 'one_plg_emails'])
      expect((await db.collection(`one_plg_generations/${'a'.repeat(64)}/${collection}`).get()).size).toBe(0);
    await expect(enrollOne(root)).rejects.toThrow('erased');
  }), 30_000);
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
