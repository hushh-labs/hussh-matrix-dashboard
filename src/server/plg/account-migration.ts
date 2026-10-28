/** Explicit migration of the bounded predecessor; never runs during a request. */
import type { Firestore } from '@google-cloud/firestore';
import type { PlgState } from '../../lib/plg';
import { accountHash, PlgError } from './engine';
import { digest, sealAccount, settings, stableHash } from './account-state';
import { accountAuthority, accountProjectionHash, needsMailReceipt, receiptBindingKey } from './account-store';
import { PLG_LEGACY_PATH, PLG_STORAGE_AUTHORITY, PlgFirestoreStorage } from './firestore-storage';
import { validatePlgState } from './store';

const DRAIN_MS = 300_000;
const fail = (message: string): never => { throw new PlgError(409, message); };
interface Progress { copied: number; total: number; startedAt: number; verified: boolean; aborting?: true }
interface Attestation { protocol: 2; checkedAt: number; serving: { revision: string; sourceSha: string }; rollback: { revision: string; sourceSha: string } }
function requireFreshAttestation(value: Attestation, now: number) {
  if (!value || value.protocol !== 2 || !Number.isFinite(value.checkedAt) || Math.abs(now - value.checkedAt) > 60_000 ||
    !value.serving || !value.rollback || value.serving.revision === value.rollback.revision ||
    [value.serving, value.rollback].some(row => !/^hushh-matrix-dashboard-[a-z0-9-]+$/.test(row.revision) || !/^[a-f0-9]{40}$/.test(row.sourceSha)))
    fail('A fresh compatible serving and rollback attestation is required.');
  return { serving: value.serving, rollback: value.rollback };
}
type Item = { path: string; value: Record<string, unknown> };

export function accountMigrationPlan(source: PlgState, generation: string): Item[] {
  validatePlgState(source);
  const root = `one_plg_generations/${generation}`, result: Item[] = [];
  const owners = new Map(source.contacts.map(contact => [contact.id, accountHash(contact.accountId)]));
  const emails = source.contacts.map(contact => contact.email.trim().toLowerCase());
  if (owners.size !== source.contacts.length || new Set(owners.values()).size !== source.contacts.length ||
    new Set(emails).size !== emails.length || source.deliveries.some(delivery => !owners.has(delivery.contactId)) ||
    source.deliveries.some(needsMailReceipt)) fail('Reconcile predecessor identities and delivery receipts before migration.');
  const hashes = new Set([...owners.values(), ...source.erasedAccountHashes ?? [],
    ...Object.keys(source.subscriptionVersions ?? {}), ...(source.pendingRevocations ?? []).map(row => row.accountHash.slice(7))]);
  for (const hash of [...hashes].sort()) {
    if (!/^[a-f0-9]{64}$/.test(hash)) fail('Invalid predecessor account scope.');
    const contacts = source.contacts.filter(contact => accountHash(contact.accountId) === hash);
    const contact = contacts[0];
    const state: PlgState = { ...settings(source), contacts,
      deliveries: source.deliveries.filter(delivery => delivery.contactId === contact?.id), eventIds: [], audit: [],
      erasedAccountHashes: source.erasedAccountHashes?.includes(hash) ? [hash] : [],
      pendingRevocations: source.pendingRevocations?.filter(row => row.accountHash === `sha256:${hash}`) ?? [],
      subscriptionVersions: source.subscriptionVersions?.[hash] ? { [hash]: source.subscriptionVersions[hash] } : {},
      storage: { mode: 'accounts' } };
    if (contact && state.erasedAccountHashes?.length) fail('An erased predecessor account cannot remain enrolled.');
    const { record } = sealAccount(state, hash);
    result.push({ path: `${root}/one_plg_accounts/${hash}`, value: { ...record, enrolled: Boolean(record.contact),
      projectionHash: accountProjectionHash(record), needsWork: Boolean(contact || state.pendingRevocations?.length),
      hasRevocations: Boolean(state.pendingRevocations?.length) } });
    if (contact) result.push({ path: `${root}/one_plg_emails/${digest(contact.email.trim().toLowerCase())}`, value: { accountHash: hash } });
  }
  for (const delivery of source.deliveries) {
    if (!/^[a-zA-Z0-9_-]{1,160}$/.test(delivery.id)) fail('Invalid predecessor receipt reference.');
    result.push({ path: `${root}/one_plg_receipts/${delivery.id}`, value: { accountHash: owners.get(delivery.contactId), delivery, needsReceipt: false } });
    result.push({ path: `${root}/one_plg_keys/${digest('delivery\n' + delivery.key)}`, value: { seen: true, deliveryId: delivery.id } });
    const binding = receiptBindingKey(delivery);
    if (binding) result.push({ path: `${root}/one_plg_bindings/${binding}`, value: { deliveryId: delivery.id } });
  }
  for (const key of source.eventIds) for (const event of [key, ...(key.startsWith('event:') ? [`eventhash:${accountHash(key.slice(6))}`] : [])])
    result.push({ path: `${root}/one_plg_keys/${digest('event\n' + event)}`, value: { seen: true } });
  const unique = new Map<string, Item>();
  for (const item of result) {
    if (unique.has(item.path) && JSON.stringify(unique.get(item.path)!.value) !== JSON.stringify(item.value))
      fail('Conflicting predecessor deduplication records.');
    unique.set(item.path, item);
  }
  return [...unique.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/** Older binaries are fenced throughout staging; rollback needs protocol2 code. */
export class AccountStorageMigration {
  constructor(private db: Firestore, private now = Date.now) {}
  private async frozen(control: any, allowAbort = false) {
    if (control?.protocol !== 2 || control.mode !== 'staging_accounts' || !control.sourceAuthority || !control.migration)
      fail('A frozen account migration is required.');
    const progress = control.migration as Progress;
    if (!Number.isSafeInteger(progress.copied) || !Number.isSafeInteger(progress.total) || progress.copied < 0 ||
      progress.copied > progress.total || progress.total > 50_000 || !Number.isFinite(progress.startedAt) ||
      typeof progress.verified !== 'boolean' || progress.aborting !== undefined && progress.aborting !== true)
      fail('Migration progress did not confirm its shape.');
    if (progress.aborting && !allowAbort) fail('An abort is in progress; copying and activation are fenced.');
    const source = await new PlgFirestoreStorage(this.db, validatePlgState, this.now).readFrozen(control.sourceAuthority, control.sourceHash);
    const items = accountMigrationPlan(source, control.generation);
    if (items.length !== control.migration.total) fail('Migration manifest changed.');
    return { source, items };
  }
  async freeze(attestation: Attestation, resume: { paused: boolean; automatic: boolean }) {
    const cutover = requireFreshAttestation(attestation, this.now());
    if (typeof resume.paused !== 'boolean' || typeof resume.automatic !== 'boolean') fail('Verify compatible serving and rollback binaries before migration.');
    const adapter = new PlgFirestoreStorage(this.db, validatePlgState, this.now);
    const prepared = await adapter.freezeAccounts((source, previous) => {
      if (previous.protocol !== 1 || !['legacy', 'normalized'].includes(previous.mode) ||
        previous.staging || previous.retired || previous.cleanupRequired || !source.paused || source.automation?.enabled ||
        source.automation?.lease && Date.parse(source.automation.lease.until) > this.now())
        fail('Pause campaigns and drain the current cycle before freezing storage.');
      if (previous.mode === 'legacy' && previous.fencedLegacy !== true)
        fail('Fence legacy storage through the existing normalized migration first.');
      const sourceHash = digest(JSON.stringify(source)), generation = digest(`plg-accounts-v2\n${sourceHash}\n${this.now()}`);
      const items = accountMigrationPlan(source, generation), startedAt = this.now();
      return { control: { protocol: 2, mode: 'staging_accounts', generation,
        revision: previous.revision + 1, sourceHash, sourceAuthority: previous, resume, cutover,
        migration: { copied: 0, total: items.length, startedAt, verified: false } },
        metadata: { schema: 2, settings: settings(source), mailFence: { pending: 0 } } };
    });
    // Source state and authority froze atomically. Confirm the same bytes
    // through the compatibility reader before copying any account records.
    await this.frozen((await this.db.doc(PLG_STORAGE_AUTHORITY).get()).data());
    return { generation: prepared.generation as string, ...prepared.migration as Progress };
  }
  async copy(limit = 100) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail('Choose a copy batch between one and 100 records.');
    const before = (await this.db.doc(PLG_STORAGE_AUTHORITY).get()).data(), { items } = await this.frozen(before);
    return this.db.runTransaction(async tx => {
      const doc = await tx.get(this.db.doc(PLG_STORAGE_AUTHORITY)), control = doc.data()!;
      if (control.mode !== 'staging_accounts' || control.generation !== before!.generation) fail('Migration ownership changed.');
      if (control.migration.aborting) fail('An abort is in progress; copying is fenced.');
      const progress = control.migration as Progress, selected: Item[] = [];
      for (const item of items.slice(progress.copied, progress.copied + limit)) {
        if (selected.length && Buffer.byteLength(JSON.stringify([...selected, item])) > 1_500_000) break;
        selected.push(item);
      }
      for (const item of selected) tx.set(this.db.doc(item.path), item.value);
      const next = { ...progress, copied: progress.copied + selected.length, verified: false };
      tx.update(doc.ref, { migration: next, revision: control.revision + 1 });
      return next;
    });
  }
  async verify() {
    const before = (await this.db.doc(PLG_STORAGE_AUTHORITY).get()).data(), { source, items } = await this.frozen(before);
    if (before!.migration.copied !== items.length) fail('Copy every migration record before verification.');
    for (let offset = 0; offset < items.length; offset += 100) {
      const batch = items.slice(offset, offset + 100), docs = await this.db.getAll(...batch.map(item => this.db.doc(item.path)));
      if (docs.some((doc, index) => !doc.exists || stableHash(doc.data()) !== stableHash(batch[index].value)))
        fail('Account migration parity did not confirm success.');
    }
    const generation = `one_plg_generations/${before!.generation}`;
    for (const collection of ['one_plg_accounts', 'one_plg_receipts', 'one_plg_keys', 'one_plg_emails', 'one_plg_bindings']) {
      const prefix = `${generation}/${collection}/`, expected = items.filter(item => item.path.startsWith(prefix)).length;
      if ((await this.db.collection(`${generation}/${collection}`).count().get()).data().count !== expected)
        fail('Unexpected records remain in the migration generation.');
    }
    const metadata = (await this.db.doc(generation).get()).data();
    if (metadata?.schema !== 2 || metadata.mailFence?.pending !== 0 || metadata.mailFence.lease ||
      stableHash(metadata.settings) !== stableHash(settings(source))) fail('Migrated settings parity changed.');
    await this.db.runTransaction(async tx => {
      const doc = await tx.get(this.db.doc(PLG_STORAGE_AUTHORITY)), current = doc.data()!;
      if (current.migration?.aborting) fail('An abort is in progress; verification is fenced.');
      if (current.mode !== 'staging_accounts' || current.generation !== before!.generation ||
        current.revision !== before!.revision || current.migration.copied !== items.length)
        fail('Migration changed during verification.');
      tx.update(doc.ref, { 'migration.verified': true, revision: current.revision + 1 });
    });
  }
  async activate(attestation: Attestation) {
    return this.db.runTransaction(async tx => {
      const doc = await tx.get(this.db.doc(PLG_STORAGE_AUTHORITY)), value = accountAuthority(doc), control = doc.data()!;
      if (control.migration?.aborting) fail('An abort is in progress; activation is fenced.');
      const cutover = requireFreshAttestation(attestation, this.now());
      if (stableHash(cutover) !== stableHash(control.cutover)) fail('The serving or rollback binaries changed; abort and requalify the cutover.');
      if (value.mode !== 'staging_accounts' || !control.migration.verified || control.migration.copied !== control.migration.total ||
        this.now() - control.migration.startedAt < DRAIN_MS) fail('Verify parity and drain old writers for five minutes before activation.');
      tx.update(doc.ref, { mode: 'accounts', revision: value.revision + 1,
        retiredLegacy: { sourceAuthority: control.sourceAuthority } });
    });
  }
  async cleanup(limit = 100) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail('Choose a cleanup batch between one and 100 records.');
    return this.db.runTransaction(async tx => {
      const doc = await tx.get(this.db.doc(PLG_STORAGE_AUTHORITY)), value = accountAuthority(doc), control = doc.data()!;
      if (value.mode !== 'accounts') fail('Activate verified storage before cleaning the predecessor.');
      if (!value.retiredLegacy) return { complete: true, removed: 0 };
      const old = value.retiredLegacy.sourceAuthority as { protocol: number; mode: string; generation?: string };
      if (!old || old.protocol !== 1 || !['legacy', 'normalized'].includes(old.mode) ||
        old.mode === 'normalized' && (!/^[a-f0-9]{64}$/.test(old.generation ?? '') || old.generation === value.generation))
        fail('The exact retired predecessor did not confirm success.');
      const rows = old.mode === 'normalized' ? await tx.get(this.db.collection(`one_plg_generations/${old.generation}/one_plg_records`).limit(limit + 1)) : null;
      for (const row of rows?.docs.slice(0, limit) ?? []) tx.delete(row.ref);
      const complete = !rows || rows.size <= limit;
      if (complete) {
        if (old.mode === 'normalized') tx.delete(this.db.doc(`one_plg_generations/${old.generation}`));
        tx.set(this.db.doc(PLG_LEGACY_PATH), { payload: JSON.stringify({ version: 2, authority: PLG_STORAGE_AUTHORITY }) });
        const next: Record<string, unknown> = { ...control, revision: value.revision + 1 };
        delete next.retiredLegacy; delete next.sourceAuthority;
        tx.set(doc.ref, next);
      }
      return { complete, removed: Math.min(rows?.size ?? 0, limit) };
    });
  }
  async abort(limit = 100) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail('Choose an abort batch between one and 100 records.');
    const before = (await this.db.doc(PLG_STORAGE_AUTHORITY).get()).data();
    await this.frozen(before, true);
    return this.db.runTransaction(async tx => {
      const doc = await tx.get(this.db.doc(PLG_STORAGE_AUTHORITY)), control = doc.data()!;
      if (control.mode !== 'staging_accounts' || control.generation !== before!.generation || control.revision !== before!.revision)
        fail('Only the same frozen migration can be aborted; refresh its progress.');
      let remaining = limit, complete = true;
      const removed: import('@google-cloud/firestore').QueryDocumentSnapshot[] = [];
      for (const collection of ['one_plg_accounts', 'one_plg_receipts', 'one_plg_keys', 'one_plg_emails', 'one_plg_bindings']) {
        const rows = await tx.get(this.db.collection(`one_plg_generations/${control.generation}/${collection}`).limit(remaining + 1));
        const selected = rows.docs.slice(0, remaining);
        if (rows.size > selected.length) complete = false;
        removed.push(...selected); remaining -= selected.length;
      }
      for (const row of removed) tx.delete(row.ref);
      if (complete) {
        tx.delete(this.db.doc(`one_plg_generations/${control.generation}`));
        tx.set(doc.ref, { ...control.sourceAuthority, revision: control.revision + 1 });
      } else {
        // Deleting any staged record irreversibly invalidates its old parity
        // certificate in the same transaction. Abort cleanup alone may resume.
        tx.update(doc.ref, { migration: { ...control.migration, verified: false, aborting: true },
          revision: control.revision + 1 });
      }
      return { complete, removed: removed.length };
    });
  }
}
