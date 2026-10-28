/** Per-account transactions under the existing PLG storage authority. */
import { FieldPath, type DocumentSnapshot, type Firestore, type Transaction } from '@google-cloud/firestore';
import { randomUUID } from 'node:crypto';
import type { PlgDelivery, PlgState } from '../../lib/plg';
import type { PlgStore } from './store';
import { PLG_STORAGE_AUTHORITY } from './firestore-storage';
import { accountHash, PlgError } from './engine';
import { validRfcMessageId } from './google-mail-metadata';
import { accountFields, digest, hydrateAccount, projectPolicy, RECENT_KEYS, sealAccount, settings, stableHash, updatePolicy,
  accountProjectionHash, type AccountRecord } from './account-state';
import { readAccountReport, type AccountReportQuery } from './account-report';
export { accountProjectionHash } from './account-state';

export interface AccountAuthority {
  protocol: 2;
  mode: 'staging_accounts' | 'accounts';
  generation: string;
  revision: number;
  sourceHash: string;
  retiredLegacy?: Record<string, unknown>;
  sourceAuthority?: Record<string, unknown>;
}
const fail = (message = 'PLG account storage did not confirm success.'): never => {
  throw new PlgError(503, message);
};
export function accountAuthority(doc: DocumentSnapshot): AccountAuthority {
  const value = doc.data() as AccountAuthority;
  if (value?.protocol !== 2 || !['staging_accounts', 'accounts'].includes(value.mode) ||
    !/^[a-f0-9]{64}$/.test(value.generation ?? '') || !/^[a-f0-9]{64}$/.test(value.sourceHash ?? '') ||
    !Number.isSafeInteger(value.revision) || value.revision < 1) return fail();
  return value;
}
const root = (generation: string) => `one_plg_generations/${generation}`;
const accountsPath = (generation: string) => `${root(generation)}/one_plg_accounts`;
const receiptsPath = (generation: string) => `${root(generation)}/one_plg_receipts`;
const keysPath = (generation: string) => `${root(generation)}/one_plg_keys`;
const emailsPath = (generation: string) => `${root(generation)}/one_plg_emails`;
export function receiptBindingKey(delivery: PlgDelivery) {
  if (delivery.provider !== 'google_workspace' || !validRfcMessageId(delivery.rfcMessageId)) return null;
  if (!/^[a-f0-9]{64}$/.test(delivery.recipientHash ?? '')) fail('An immutable receipt recipient proof is required.');
  return digest(delivery.rfcMessageId + '\n' + delivery.recipientHash);
}
const same = (left: unknown, right: unknown) => stableHash(left) === stableHash(right);
const CLEANUP_PENDING = 'Account erasure cleanup is pending; acknowledgement is held.';
interface MailFence { pending: number; lease?: { id: string; until: number } }
export function needsMailReceipt(delivery: PlgDelivery) {
  return delivery.provider === 'google_workspace' && (['sending', 'uncertain'].includes(delivery.status) ||
    Boolean(delivery.providerId) && !validRfcMessageId(delivery.rfcMessageId));
}

/** No account selector means settings transactions and a private reporting read. */
export class AccountPlgStore implements PlgStore {
  get scope() { return this.hash ? 'account' as const : 'workspace' as const; }
  constructor(private db: Firestore, private generation: string, private hash?: string,
    private receiptIds: string[] = [], private feedbackLeaseId?: string) {
    if (!/^[a-f0-9]{64}$/.test(generation) || (hash && !/^[a-f0-9]{64}$/.test(hash))) fail();
  }
  account(hash: string) { return new AccountPlgStore(this.db, this.generation, hash, [], this.feedbackLeaseId); }
  async accountStorage() { return new AccountPlgStore(this.db, this.generation, undefined, [], this.feedbackLeaseId); }
  private async context(tx: Transaction) {
    const authority = accountAuthority(await tx.get(this.db.doc(PLG_STORAGE_AUTHORITY)));
    if (authority.generation !== this.generation || authority.mode !== 'accounts')
      fail('Account storage is transitioning; retry after the migration completes.');
    const doc = await tx.get(this.db.doc(root(this.generation)));
    const value = doc.data();
    if (!doc.exists || value?.schema !== 2 || !value.settings || value.settings.version !== 1 ||
      !Number.isSafeInteger(value.mailFence?.pending) || value.mailFence.pending < 0 ||
      accountFields.some(field => Object.hasOwn(value.settings, field))) fail();
    const mailFence = value.mailFence as MailFence;
    if (this.feedbackLeaseId && (mailFence.lease?.id !== this.feedbackLeaseId || mailFence.lease.until <= Date.now()))
      fail('Mailbox feedback authority expired; the page remains replayable.');
    return { authority, base: value.settings as ReturnType<typeof settings>, mailFence, readTime: doc.readTime };
  }
  async readSettings() {
    return this.db.runTransaction(async tx => {
      const { base } = await this.context(tx);
      return hydrateAccount(base);
    }, { readOnly: true });
  }
  async page(after: string | null, limit = 20) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25 ||
      (after !== null && !/^[a-f0-9]{64}$/.test(after))) throw new PlgError(400, 'Invalid account page.');
    return this.db.runTransaction(async tx => {
      await this.context(tx);
      let query = this.db.collection(accountsPath(this.generation)).where('needsWork', '==', true).orderBy(FieldPath.documentId()).limit(limit + 1);
      if (after) query = query.startAfter(after);
      const rows = await tx.get(query);
      const selected = rows.docs.slice(0, limit);
      return { accounts: selected.filter(doc => doc.get('contact') || doc.get('cleanupPending')).map(doc => doc.id),
        next: rows.size > limit ? selected.at(-1)!.id : null };
    }, { readOnly: true });
  }
  async readAccounts(hashes: string[]) {
    if (hashes.length > 25 || new Set(hashes).size !== hashes.length || hashes.some(hash => !/^[a-f0-9]{64}$/.test(hash)))
      throw new PlgError(400, 'Invalid account selection.');
    return this.db.runTransaction(async tx => {
      const { base } = await this.context(tx), state = hydrateAccount(base);
      const docs = hashes.length ? await tx.getAll(...hashes.map(hash => this.db.doc(`${accountsPath(this.generation)}/${hash}`))) : [];
      for (const doc of docs) if (doc.exists) {
        const record = doc.data() as AccountRecord;
        if (doc.get('projectionHash') !== accountProjectionHash(record) || record.contact && accountHash(record.contact.accountId) !== doc.id) fail();
        const local = hydrateAccount(base, record);
        state.contacts.push(...local.contacts);
        state.pendingRevocations = [...state.pendingRevocations ?? [], ...local.pendingRevocations ?? []];
      }
      return state;
    }, { readOnly: true });
  }
  async resumeCleanup(hashes: string[], deadline: number, now = Date.now) {
    if (this.hash || hashes.length > 25 || new Set(hashes).size !== hashes.length ||
      hashes.some(hash => !/^[a-f0-9]{64}$/.test(hash))) throw new PlgError(400, 'Invalid cleanup selection.');
    const pending = await this.db.runTransaction(async tx => {
      await this.context(tx);
      const docs = hashes.length ? await tx.getAll(...hashes.map(hash => this.db.doc(`${accountsPath(this.generation)}/${hash}`)),
        { fieldMask: ['cleanupPending'] }) : [];
      return docs.filter(doc => doc.get('cleanupPending') === true).map(doc => doc.id);
    }, { readOnly: true });
    let batches = 0;
    for (const hash of pending) for (;;) {
      if (++batches > 20 || now() + 5_000 >= deadline) throw new PlgError(409, CLEANUP_PENDING);
      try { await this.account(hash).transaction(() => undefined); break; }
      catch (error) {
        if (!(error instanceof PlgError && error.status === 409 && error.message === CLEANUP_PENDING)) throw error;
      }
    }
  }
  async revocationAccounts() {
    return this.db.runTransaction(async tx => {
      await this.context(tx);
      const docs = await tx.get(this.db.collection(accountsPath(this.generation)).where('hasRevocations', '==', true).limit(11));
      return { hashes: docs.docs.slice(0, 10).map(doc => doc.id), more: docs.size > 10 };
    }, { readOnly: true });
  }
  async contact(id: string) {
    const docs = await this.db.collection(accountsPath(this.generation)).where('contact.id', '==', id).limit(2).get();
    if (!docs.size) throw new PlgError(404, 'Account is not enrolled.');
    if (docs.size !== 1) fail('Account identity is ambiguous.');
    return this.account(docs.docs[0].id);
  }
  async receipt(reference: { id?: string; providerId?: string; messageId?: string; recipientHash?: string }) {
    const collection = this.db.collection(receiptsPath(this.generation));
    const rows = reference.id ? [await collection.doc(reference.id).get()] : reference.messageId ?
      (await collection.where('delivery.rfcMessageId', '==', reference.messageId)
        .where('delivery.recipientHash', '==', reference.recipientHash ?? '').limit(2).get()).docs :
      (await collection.where('delivery.providerId', '==', reference.providerId ?? '').limit(2).get()).docs;
    if (!rows.length || rows.length === 1 && !rows[0].exists) throw new PlgError(404, 'Delivery is not recorded.');
    if (rows.length !== 1) fail('Delivery identity is ambiguous.');
    const hash = rows[0].get('accountHash');
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) fail();
    return new AccountPlgStore(this.db, this.generation, hash, [rows[0].id], this.feedbackLeaseId);
  }
  async email(address: string) {
    const docs = await this.db.collection(accountsPath(this.generation)).where('contact.email', '==', address).limit(2).get();
    if (!docs.size) return null;
    if (docs.size !== 1) fail('Email ownership is ambiguous.');
    return this.account(docs.docs[0].id);
  }
  async mailView(): Promise<PlgState> {
    return this.db.runTransaction(async tx => {
      const { base } = await this.context(tx), state = hydrateAccount(base);
      const collection = this.db.collection(receiptsPath(this.generation));
      const recent = await tx.get(collection.orderBy('delivery.createdAt', 'desc').limit(50));
      const oldest = await tx.get(collection.orderBy('delivery.createdAt', 'asc').limit(1));
      const unbound = await tx.get(collection.where('needsReceipt', '==', true).limit(101));
      if (unbound.size > 100) fail('Delivery reconciliation backlog requires another bounded pass.');
      const receipts = [...new Map([...recent.docs, ...oldest.docs, ...unbound.docs].map(doc => [doc.id, doc])).values()];
      const hashes = [...new Set(receipts.map(doc => doc.get('accountHash')))];
      if (hashes.some(hash => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))) fail();
      const contacts = hashes.length ? await tx.getAll(...hashes.map(hash => this.db.doc(`${accountsPath(this.generation)}/${hash}`))) : [];
      for (const doc of contacts) if (doc.exists && doc.get('contact')) state.contacts.push(doc.get('contact'));
      const ids = new Set(state.contacts.map(contact => contact.id));
      state.deliveries = receipts.map(doc => doc.get('delivery') as PlgDelivery).filter(delivery => ids.has(delivery.contactId));
      return state;
    }, { readOnly: true });
  }
  async withFeedbackFence(operation: (store: AccountPlgStore) => Promise<void>) {
    const id = randomUUID(), until = Date.now() + 45_000;
    const acquired = await this.db.runTransaction(async tx => {
      const { mailFence } = await this.context(tx);
      if (mailFence.pending || mailFence.lease && mailFence.lease.until > Date.now()) return false;
      tx.update(this.db.doc(root(this.generation)), { mailFence: { ...mailFence, lease: { id, until } } });
      return true;
    });
    if (!acquired) return false;
    let complete = false;
    try {
      await operation(new AccountPlgStore(this.db, this.generation, undefined, [], id));
      complete = await this.db.runTransaction(async tx => {
        const { mailFence } = await this.context(tx);
        return mailFence.lease?.id === id && mailFence.lease.until > Date.now() && mailFence.pending === 0;
      });
    } finally {
      await this.db.runTransaction(async tx => {
        const { mailFence } = await this.context(tx);
        if (mailFence.lease?.id === id) {
          delete mailFence.lease;
          tx.update(this.db.doc(root(this.generation)), { mailFence });
        }
      });
    }
    return complete;
  }
  private async member(tx: Transaction, base: ReturnType<typeof settings>) {
    const doc = await tx.get(this.db.doc(`${accountsPath(this.generation)}/${this.hash}`));
    const record = doc.exists ? doc.data() as AccountRecord : undefined;
    if (record && (doc.get('projectionHash') !== accountProjectionHash(record) ||
      record.contact && accountHash(record.contact.accountId) !== this.hash)) fail();
    const state = hydrateAccount(base, record);
    for (const id of this.receiptIds) {
      const receipt = await tx.get(this.db.doc(`${receiptsPath(this.generation)}/${id}`));
      if (receipt.exists) {
        if (receipt.get('accountHash') !== this.hash) fail('Delivery owner changed.');
        const delivery = receipt.get('delivery') as PlgDelivery;
        if (delivery.id !== id) fail('Delivery owner changed.');
        if (!state.contacts.length) continue; // An erasure during I/O must never recreate a contact.
        if (delivery.contactId !== state.contacts[0].id) fail('Delivery owner changed.');
        if (!state.deliveries.some(value => value.id === id)) state.deliveries.push(delivery);
      }
    }
    return { doc, record, state };
  }
  async readWithoutReservation(deliveryId: string): Promise<PlgState> {
    if (!this.hash) return fail('An account selector is required.');
    return this.db.runTransaction(async tx => {
      const { base } = await this.context(tx), { state, record } = await this.member(tx, base);
      const before = record?.preReservationPolicy;
      if (!before || before.deliveryId !== deliveryId ||
        !state.deliveries.some(delivery => delivery.id === deliveryId && ['sending', 'uncertain'].includes(delivery.status)))
        return fail('The exact pending reservation did not confirm success.');
      state.deliveries = state.deliveries.filter(delivery => delivery.id !== deliveryId);
      if (state.contacts[0]) state.deliveryPolicies = { [state.contacts[0].id]:
        projectPolicy(updatePolicy(before.policy, state.deliveries), state.contacts[0]) };
      return state;
    }, { readOnly: true });
  }
  async read(): Promise<PlgState> {
    if (!this.hash) return this.readWorkspace();
    return this.db.runTransaction(async tx => {
      const { base } = await this.context(tx);
      return (await this.member(tx, base)).state;
    }, { readOnly: true });
  }
  async readWorkspace(query: AccountReportQuery = {}, now = Date.now()) {
    if (this.hash) fail('Choose workspace scope before reading campaign pages.');
    return readAccountReport(this.db, this.generation, tx => this.context(tx), query, now);
  }
  private assertSettings(before: PlgState, after: PlgState) {
    for (const field of ['paused', 'ready', 'catalog', 'templates', 'automation'] as const)
      if (!same(before[field], after[field])) fail('Use the settings operation for shared campaign changes.');
  }
  private async knownKeys(tx: Transaction, state: PlgState, initial: PlgState) {
    const oldEvents = new Set(initial.eventIds), oldDeliveries = new Set(initial.deliveries.map(delivery => delivery.id));
    const events = [...new Set(state.eventIds.filter(key => !oldEvents.has(key)))];
    const deliveries = state.deliveries.filter(delivery => !oldDeliveries.has(delivery.id));
    if (events.length + deliveries.length > 300) fail('This account operation exceeds its atomic budget.');
    const inputs = [...events.map(key => ({ key, kind: 'event' })),
      ...deliveries.map(delivery => ({ key: delivery.key, kind: 'delivery' }))];
    const refs = inputs.map(item => this.db.doc(`${keysPath(this.generation)}/${digest(item.kind + '\n' + item.key)}`));
    const docs = refs.length ? await tx.getAll(...refs) : [];
    if (docs.some(doc => doc.exists && doc.get('seen') !== true)) fail('Deduplication record did not confirm success.');
    return { inputs, docs, existing: inputs.filter((_, index) => docs[index].exists) };
  }
  async transaction<T>(fn: (state: PlgState) => T): Promise<T> {
    const outcome = await this.db.runTransaction(async tx => {
      const { authority, base, mailFence } = await this.context(tx);
      if (!this.hash) {
        const state = hydrateAccount(base), result = fn(state);
        if (accountFields.some(field => Object.keys(state[field] ?? {}).length))
          fail('An account selector is required before changing account records.');
        tx.update(this.db.doc(root(this.generation)), { settings: settings(state) });
        return { result, held: false };
      }
      const before = await this.member(tx, base), initial = before.state;
      let draft = structuredClone(initial), result = fn(draft);
      let keys = await this.knownKeys(tx, draft, initial);
      const known = new Map<string, (typeof keys.existing)[number]>();
      for (let round = 0; keys.existing.length; round++) {
        if (round >= 128) fail('Duplicate reservations did not converge; no write was applied.');
        for (const item of keys.existing) known.set(item.kind + '\n' + item.key, item);
        const replay = structuredClone(initial);
        for (const item of known.values()) {
          if (item.kind === 'event') replay.eventIds.push(item.key);
          else if (replay.contacts[0]) replay.deliveryPolicies![replay.contacts[0].id].claimedKeys.push(item.key);
        }
        const replayBaseline = structuredClone(replay);
        draft = replay; result = fn(draft);
        keys = await this.knownKeys(tx, draft, replayBaseline);
      }
      this.assertSettings(initial, draft);
      if (initial.erasedAccountHashes?.includes(this.hash) &&
        (!draft.erasedAccountHashes?.includes(this.hash) || draft.contacts.length))
        throw new PlgError(409, 'This account was erased; delayed enrollment cannot restore it.');
      const oldEmail = initial.contacts[0]?.email, newEmail = draft.contacts[0]?.email;
      const emailRefs = [...new Set([oldEmail, newEmail].filter((value): value is string => Boolean(value)))]
        .map(email => this.db.doc(`${emailsPath(this.generation)}/${digest(email.trim().toLowerCase())}`));
      const emailClaims = emailRefs.length ? await tx.getAll(...emailRefs) : [];
      if (emailClaims.some(claim => claim.exists && claim.get('accountHash') !== this.hash))
        throw new PlgError(409, 'An email is already enrolled for another account; reconcile it before sending.');
      if (oldEmail && !emailClaims[emailRefs.findIndex(ref => ref.id === digest(oldEmail.trim().toLowerCase()))]?.exists)
        fail('Current email ownership did not confirm success.');
      let write = sealAccount(draft, this.hash, before.record);
      const erased = !write.record.contact && (Boolean(before.record?.contact) || before.record?.cleanupPending);
      const retired = erased ? await tx.get(this.db.collection(receiptsPath(this.generation)).where('accountHash', '==', this.hash).limit(101)) : null;
      const prior = new Map(initial.deliveries.map(delivery => [delivery.id, delivery]));
      const released = erased ? [] : initial.deliveries.filter(delivery =>
        !draft.deliveries.some(current => current.id === delivery.id));
      if (released.some(delivery => delivery.status !== 'sending' || delivery.providerId))
        fail('Confirmed or uncertain delivery history cannot be removed.');
      if (released.length) {
        const reservation = before.record?.preReservationPolicy;
        if (released.length !== 1 || reservation?.deliveryId !== released[0].id || !before.record)
          fail('The exact unsent reservation did not confirm success.');
        const restored = { ...before.record, policy: reservation.policy };
        if (draft.contacts[0]) draft.deliveryPolicies = { [draft.contacts[0].id]:
          projectPolicy(restored.policy, draft.contacts[0]) };
        write = sealAccount(draft, this.hash, restored);
      }
      const releaseKeys = released.length ? await tx.getAll(...released.map(delivery =>
        this.db.doc(`${keysPath(this.generation)}/${digest('delivery\n' + delivery.key)}`))) : [];
      if (releaseKeys.some((doc, index) => !doc.exists || doc.get('deliveryId') !== released[index].id))
        fail('The exact unsent reservation did not confirm success.');
      const changed = erased ? [] : write.receipts.filter(delivery => !same(delivery, prior.get(delivery.id)));
      if (changed.some(delivery => { const old = prior.get(delivery.id);
        return old && (old.rfcMessageId && old.rfcMessageId !== delivery.rfcMessageId ||
          old.recipientHash && old.recipientHash !== delivery.recipientHash || old.providerId && old.providerId !== delivery.providerId);
      })) fail('Confirmed receipt identity cannot change.');
      const bindings = changed.map(delivery => ({ key: receiptBindingKey(delivery), id: delivery.id })).filter(row => row.key);
      if (new Set(bindings.map(row => row.key)).size !== bindings.length) fail('Receipt identity is ambiguous.');
      const bindingDocs = bindings.length ? await tx.getAll(...bindings.map(row =>
        this.db.doc(`${root(this.generation)}/one_plg_bindings/${row.key}`))) : [];
      if (bindingDocs.some((doc, index) => doc.exists && doc.get('deliveryId') !== bindings[index].id)) fail('Receipt identity is ambiguous.');
      const reserved = changed.filter(delivery => !prior.has(delivery.id) && delivery.status === 'sending');
      if (reserved.length > 1) fail('Only one message may be reserved for an account.');
      if (reserved.length &&
        mailFence.lease && mailFence.lease.until > Date.now())
        fail('Mailbox feedback is being reconciled; no new send was reserved.');
      if (reserved[0]) {
        const policy = structuredClone(before.record?.policy ?? { unresolvedIds: [], latestPromotions: [], latestStepAt: {}, latestReturnAt: null, claimedKeys: [] });
        // Preflight must preserve the permanent claims that selected a fallback,
        // while excluding only this new reservation and its frequency effect.
        policy.claimedKeys = [...new Set([...policy.claimedKeys,
          ...[...known.values()].filter(item => item.kind === 'delivery').map(item => item.key)])].slice(-RECENT_KEYS);
        write.record.preReservationPolicy = { deliveryId: reserved[0].id, policy };
      }
      else if (before.record?.preReservationPolicy && draft.deliveries.some(delivery =>
        delivery.id === before.record!.preReservationPolicy!.deliveryId && ['sending', 'uncertain'].includes(delivery.status)))
        write.record.preReservationPolicy = before.record.preReservationPolicy;
      const newKeys = keys.inputs.filter((_, index) => !keys.docs[index].exists);
      const cleanup = Boolean(erased && (retired!.size > 100 || authority.retiredLegacy));
      const retiring = retired?.docs.slice(0, 100) ?? [];
      const retiredClaims = retiring.flatMap(doc => {
        const delivery = doc.get('delivery') as PlgDelivery;
        if (delivery.id !== doc.id) fail('Retired receipt identity changed.');
        const binding = receiptBindingKey(delivery);
        return [{ ref: this.db.doc(`${keysPath(this.generation)}/${digest('delivery\n' + delivery.key)}`), id: doc.id },
          ...(binding ? [{ ref: this.db.doc(`${root(this.generation)}/one_plg_bindings/${binding}`), id: doc.id }] : [])];
      });
      const retiredDocs = retiredClaims.length ? await tx.getAll(...retiredClaims.map(row => row.ref)) : [];
      if (retiredDocs.some((doc, index) => doc.exists && doc.get('deliveryId') !== retiredClaims[index].id))
        fail('Retired receipt claim ownership changed.');
      if (changed.length + bindings.length + newKeys.length + released.length * 2 + (retired ? Math.min(retired.size, 100) * 3 : 0) + 4 > 400)
        fail('This account operation exceeds its atomic budget.');
      for (const [index, binding] of bindings.entries()) if (!bindingDocs[index].exists)
        tx.create(bindingDocs[index].ref, { deliveryId: binding.id });
      for (const item of newKeys) tx.create(this.db.doc(`${keysPath(this.generation)}/${digest(item.kind + '\n' + item.key)}`), {
        seen: true, ...(item.kind === 'delivery' ? { deliveryId: draft.deliveries.find(delivery => delivery.key === item.key)!.id } : {}),
      });
      let delta = 0;
      for (const [index, delivery] of released.entries()) {
        delta -= Number(needsMailReceipt(delivery));
        tx.delete(releaseKeys[index].ref);
        tx.delete(this.db.doc(`${receiptsPath(this.generation)}/${delivery.id}`));
      }
      for (const delivery of changed) {
        delta += Number(needsMailReceipt(delivery)) - Number(prior.has(delivery.id) && needsMailReceipt(prior.get(delivery.id)!));
        tx.set(this.db.doc(`${receiptsPath(this.generation)}/${delivery.id}`), {
          accountHash: this.hash, delivery, needsReceipt: needsMailReceipt(delivery),
        });
      }
      for (const doc of retired?.docs.slice(0, 100) ?? []) delta -= Number(doc.get('needsReceipt') === true);
      if (delta) {
        if (!Number.isSafeInteger(mailFence.pending + delta) || mailFence.pending + delta < 0) fail('Mailbox receipt counters changed.');
        tx.update(this.db.doc(root(this.generation)), { 'mailFence.pending': mailFence.pending + delta });
      }
      for (const claim of retiredDocs) if (claim.exists) tx.delete(claim.ref);
      for (const doc of retiring) tx.delete(doc.ref);
      if (oldEmail !== newEmail) {
        if (oldEmail) tx.delete(this.db.doc(`${emailsPath(this.generation)}/${digest(oldEmail.trim().toLowerCase())}`));
        if (newEmail) tx.set(this.db.doc(`${emailsPath(this.generation)}/${digest(newEmail.trim().toLowerCase())}`), { accountHash: this.hash });
      }
      tx.set(before.doc.ref, { ...write.record, projectionHash: accountProjectionHash(write.record),
        enrolled: Boolean(write.record.contact),
        needsWork: Boolean(write.record.contact || cleanup || draft.pendingRevocations?.length),
        hasRevocations: Boolean(draft.pendingRevocations?.length),
        ...(cleanup ? { cleanupPending: true } : {}) });
      return { result, held: cleanup };
    });
    if (outcome.held) throw new PlgError(409, CLEANUP_PENDING);
    return outcome.result;
  }
}
