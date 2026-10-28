import { createHash } from 'node:crypto';
import type { DocumentSnapshot, Firestore, Transaction } from '@google-cloud/firestore';
import type { PlgState } from '../../lib/plg';
import { accountHash, eraseAccountHash, initialPlgState, PlgError, timeline } from './engine';
import { applyAcceptedDelivery } from './delivery-events';
import { validRfcMessageId } from './google-mail-metadata';

export const PLG_LEGACY_PATH = 'one_plg_pilot/state';
export const PLG_STORAGE_AUTHORITY = 'one_plg_storage/control';
const GENERATIONS = 'one_plg_generations';
const RECORDS = 'one_plg_records';
const MAX_RECORDS = 20_000;
const MAX_WRITES = 400;
const MAX_WRITE_BYTES = 2_000_000; // Reserve request space for paths and index changes.
const DRAIN_MS = 300_000;
const fields = ['contacts', 'deliveries', 'eventIds', 'erasedAccountHashes', 'pendingRevocations', 'subscriptionVersions'] as const;
type Field = typeof fields[number];
type Validate = (state: PlgState) => void;
interface Entity { schema: 1; kind: Field; ordinal: number; json: string }
interface Image { schema: 1; baseJSON: string; fields: Field[]; records: number; stateHash: string }
interface Stage { generation: string; sourceVersion: string; sourceHash: string; copied: number; total: number; startedAt: number; verified: boolean; discarding?: boolean }
interface Transition { kind: 'activate' | 'rollback' | 'erase_recovery'; generation: string; sourceHash?: string; sourceVersionHash?: string }
interface Authority { protocol: 1; mode: 'legacy' | 'normalized'; revision: number; generation?: string; stateChangedAt?: number; staging?: Stage; retired?: string; cleanupRequired?: boolean; fencedLegacy?: boolean; lastTransition?: Transition }
export interface PlgStorageAttestation {
  protocol: 1;
  serving: { revision: string; sourceSha: string };
  rollback: { revision: string; sourceSha: string };
  checkedAt: number;
}
const fail = (message = 'PLG storage authority or parity did not confirm success.'): never => { throw new PlgError(409, message); };
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function clean(state: PlgState, validate: Validate): PlgState {
  validate(state);
  const copy = JSON.parse(JSON.stringify(state)) as PlgState;
  validate(copy);
  return copy;
}
function image(state: PlgState, validate: Validate) {
  const copy = clean(state, validate), base = { ...copy } as any;
  const included: Field[] = [], records = new Map<string, Entity>();
  for (const kind of fields) {
    if (!Object.hasOwn(base, kind)) continue;
    included.push(kind);
    const value = base[kind]; delete base[kind];
    if (kind === 'subscriptionVersions' ? !value || typeof value !== 'object' || Array.isArray(value) : !Array.isArray(value)) fail();
    const values = kind === 'subscriptionVersions' ? Object.entries(value).map(([key, entry]) => ({ key, entry })) : value;
    const occurrences = new Map<string, number>();
    for (const [ordinal, entry] of values.entries()) {
      const key = kind === 'contacts' || kind === 'deliveries' ? entry?.id
        : kind === 'subscriptionVersions' ? entry.key : canonical(entry);
      if (typeof key !== 'string' || !key || key.length > 4096) fail();
      const occurrence = occurrences.get(key) ?? 0; occurrences.set(key, occurrence + 1);
      const id = `${kind}-${sha(`${key}\n${occurrence}`)}`;
      records.set(id, { schema: 1, kind, ordinal, json: JSON.stringify(entry) });
    }
  }
  if (!['contacts', 'deliveries', 'eventIds'].every(kind => included.includes(kind as Field)) || records.size > MAX_RECORDS)
    fail('PLG normalized record capacity reached; no history was trimmed.');
  return { state: copy, entities: records, meta: { schema: 1, baseJSON: JSON.stringify(base), fields: included,
    records: records.size, stateHash: sha(canonical(copy)) } as Image };
}
function restore(meta: Image, rows: { id: string; value: Entity }[], validate: Validate) {
  if (meta?.schema !== 1 || !Number.isSafeInteger(meta.records) || meta.records < 0 || meta.records > MAX_RECORDS ||
    rows.length !== meta.records || typeof meta.baseJSON !== 'string' || !/^[a-f0-9]{64}$/.test(meta.stateHash) ||
    !Array.isArray(meta.fields) || new Set(meta.fields).size !== meta.fields.length || meta.fields.some(field => !fields.includes(field))) fail();
  const state = JSON.parse(meta.baseJSON);
  if (!state || Array.isArray(state) || typeof state !== 'object' || fields.some(field => Object.hasOwn(state, field))) fail();
  for (const field of meta.fields) {
    const group = rows.filter(row => row.value?.kind === field).sort((a, b) => a.value.ordinal - b.value.ordinal);
    const values = group.map(({ value }, ordinal) => {
      if (value.schema !== 1 || value.ordinal !== ordinal || typeof value.json !== 'string' ||
        Object.keys(value).sort().join(',') !== 'json,kind,ordinal,schema') fail();
      return JSON.parse(value.json);
    });
    state[field] = field === 'subscriptionVersions' ? Object.fromEntries(values.map(value => [value.key, value.entry])) : values;
  }
  const rebuilt = image(state, validate);
  if (rebuilt.meta.stateHash !== meta.stateHash || canonical(rebuilt.meta) !== canonical(meta) ||
    rows.some(row => canonical(rebuilt.entities.get(row.id)) !== canonical(row.value))) fail();
  return rebuilt;
}
function authority(doc: DocumentSnapshot): Authority {
  if (!doc.exists) return { protocol: 1, mode: 'legacy', revision: 0 };
  const value = doc.data() as Authority;
  if (value?.protocol !== 1 || !['legacy', 'normalized'].includes(value.mode) || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
    (value.stateChangedAt !== undefined && !Number.isFinite(value.stateChangedAt)) ||
    (value.fencedLegacy !== undefined && value.fencedLegacy !== true) ||
    (value.cleanupRequired !== undefined && (value.cleanupRequired !== true || value.mode !== 'legacy' || (!value.staging && !value.retired))) ||
    (value.mode === 'normalized' && !/^[a-f0-9]{64}$/.test(value.generation ?? '')) ||
    (value.retired !== undefined && (!/^[a-f0-9]{64}$/.test(value.retired) || value.mode !== 'legacy' || value.staging))) fail();
  if (value.staging) {
    const s = value.staging;
    if (value.mode !== 'legacy' || !/^[a-f0-9]{64}$/.test(s.generation) || !/^[a-f0-9]{64}$/.test(s.sourceHash) || typeof s.sourceVersion !== 'string' ||
      !Number.isSafeInteger(s.copied) || !Number.isSafeInteger(s.total) || s.copied < 0 || s.copied > s.total || s.total > MAX_RECORDS ||
      !Number.isFinite(s.startedAt) || typeof s.verified !== 'boolean' || (s.discarding !== undefined && typeof s.discarding !== 'boolean')) fail();
  }
  if (value.lastTransition) {
    const t = value.lastTransition;
    if (!['activate', 'rollback', 'erase_recovery'].includes(t.kind) || !/^[a-f0-9]{64}$/.test(t.generation) ||
      (t.kind === 'activate' && (!/^[a-f0-9]{64}$/.test(t.sourceHash ?? '') || !/^[a-f0-9]{64}$/.test(t.sourceVersionHash ?? '')))) fail();
  }
  return value;
}
function legacyState(doc: DocumentSnapshot, control: Authority, validate: Validate) {
  if (!doc.exists) { if (control.fencedLegacy) fail(); return initialPlgState(); }
  const payload = JSON.parse(doc.get('payload'));
  if (control.fencedLegacy) {
    if (payload.version !== 2 || payload.authority !== PLG_STORAGE_AUTHORITY || payload.state?.version !== 1) fail();
    return clean(payload.state, validate);
  }
  return clean(payload, validate);
}
const legacyPayload = (state: PlgState, control: Authority) => JSON.stringify(control.fencedLegacy
  ? { version: 2, authority: PLG_STORAGE_AUTHORITY, state } : state);
function source(doc: DocumentSnapshot, validate: Validate, control: Authority) {
  if (!doc.exists || !doc.updateTime) fail('Initialize and verify the legacy PLG store before migration.');
  const state = legacyState(doc, control, validate);
  const snapshot = image(state, validate);
  return { ...snapshot, version: `${doc.updateTime!.seconds}:${doc.updateTime!.nanoseconds}` };
}
const generationPath = (generation: string) => `${GENERATIONS}/${generation}`;
const recordPath = (generation: string, id: string) => `${generationPath(generation)}/${RECORDS}/${id}`;
const withinBudget = (values: unknown[], count = values.length) => count <= MAX_WRITES && Buffer.byteLength(JSON.stringify(values)) <= MAX_WRITE_BYTES;
function boundWrites(values: unknown[], count = values.length) {
  if (!withinBudget(values, count))
    fail('PLG atomic storage change exceeds its safe budget; no partial update was applied.');
}
/** Only the real existing-delivery acceptance side effects may cross a cleanup hold. */
function positiveReceipt(before: PlgState, after: PlgState, now: number) {
  if (before.deliveries.length !== after.deliveries.length || before.contacts.length !== after.contacts.length) return false;
  const expected = structuredClone(before), changed = new Map<string, string[]>();
  const rank = { manual: 0, sending: 0, uncertain: 0, sent: 1, delivered: 2, failed: 3, bounced: 4, complained: 5 };
  for (const [index, current] of after.deliveries.entries()) {
    const old = before.deliveries[index];
    if (canonical(old) === canonical(current)) continue;
    if (old.id !== current.id || old.status === 'manual' || !/^[a-zA-Z0-9_-]{1,160}$/.test(current.providerId ?? '') ||
      (old.providerId && old.providerId !== current.providerId) || !Object.hasOwn(rank, old.status) || !Object.hasOwn(rank, current.status) ||
      rank[current.status] < rank[old.status] || (!['sent', 'delivered'].includes(current.status) && current.status !== old.status) ||
      (old.rfcMessageId && old.rfcMessageId !== current.rfcMessageId) || (current.rfcMessageId && !validRfcMessageId(current.rfcMessageId))) return false;
    const delivery = { ...old, status: current.status, providerId: current.providerId,
      ...(current.rfcMessageId ? { rfcMessageId: current.rfcMessageId } : {}) };
    if (canonical(delivery) !== canonical(current) || !expected.contacts.some(c => c.id === delivery.contactId)) return false;
    expected.deliveries[index] = delivery;
    applyAcceptedDelivery(expected, delivery);
    changed.set(delivery.contactId, [...(changed.get(delivery.contactId) ?? []), `Sent ${delivery.step} email.`]);
  }
  if (!changed.size) return false;
  for (const contact of expected.contacts) {
    const current = after.contacts.find(c => c.id === contact.id);
    if (!current) return false;
    if (canonical(current.timeline) !== canonical(contact.timeline)) {
      const entry = current.timeline[0], at = Date.parse(entry?.at);
      if (!changed.get(contact.id)?.includes(entry?.action) || !entry.actor || entry.actor.length > 200 ||
        !Number.isFinite(at) || at > now + 60_000) return false;
      timeline(contact, entry.actor, entry.action, at);
    }
  }
  return canonical(expected) === canonical(after);
}
async function readGeneration(db: Firestore, tx: Transaction, generation: string, validate: Validate) {
  const meta = await tx.get(db.doc(generationPath(generation)));
  const records = await tx.get(db.collection(`${generationPath(generation)}/${RECORDS}`).limit(MAX_RECORDS + 1));
  if (!meta.exists) fail();
  return restore(meta.data() as Image, records.docs.map(doc => ({ id: doc.id, value: doc.data() as Entity })), validate);
}
async function discardInactive(db: Firestore, tx: Transaction, control: Authority, batchSize: number) {
  if (control.mode !== 'legacy') fail('Active normalized storage cannot be cleaned up.');
  const generation = control.retired ?? control.staging?.generation;
  if (!generation) return { complete: true, removed: 0 };
  const records = await tx.get(db.collection(`${generationPath(generation)}/${RECORDS}`).limit(batchSize + 1));
  const selected = records.docs.slice(0, batchSize), complete = records.size <= batchSize;
  const next = { ...control, revision: control.revision + 1 };
  if (complete) { delete next.retired; delete next.staging; delete next.cleanupRequired; }
  else {
    next.cleanupRequired = true;
    if (next.staging) next.staging = { ...next.staging, verified: false, discarding: true };
  }
  boundWrites([next, ...selected.map(doc => doc.data())], selected.length + (complete ? 2 : 1));
  for (const doc of selected) tx.delete(doc.ref);
  if (complete) tx.delete(db.doc(generationPath(generation)));
  tx.set(db.doc(PLG_STORAGE_AUTHORITY), next);
  return { complete, removed: selected.length };
}

/** Bridge release: v1 stays authoritative until an explicit, verified operator cutover. */
export class PlgFirestoreStorage {
  constructor(private db: Firestore, private validate: Validate, private now = Date.now) {}
  private async readState(tx: Transaction, control: Authority) {
    if (control.mode === 'normalized') return readGeneration(this.db, tx, control.generation!, this.validate);
    const doc = await tx.get(this.db.doc(PLG_LEGACY_PATH));
    return { state: legacyState(doc, control, this.validate), entities: new Map<string, Entity>() };
  }
  async read() {
    return this.db.runTransaction(async tx => {
      const control = authority(await tx.get(this.db.doc(PLG_STORAGE_AUTHORITY)));
      return (await this.readState(tx, control)).state;
    }, { readOnly: true });
  }
  /** Read the immutable predecessor while its replacement authority fences writes. */
  async readFrozen(sourceAuthority: unknown, expectedHash: string) {
    return this.db.runTransaction(async tx => {
      const current = (await tx.get(this.db.doc(PLG_STORAGE_AUTHORITY))).data();
      const recorded = current?.mode === 'staging_accounts' ? current.sourceAuthority : current?.retiredLegacy?.sourceAuthority;
      if (current?.protocol !== 2 || current.sourceHash !== expectedHash ||
        !recorded || canonical(recorded) !== canonical(sourceAuthority)) fail();
      const control = authority({ exists: true, data: () => sourceAuthority } as DocumentSnapshot);
      if (control.staging || control.retired || control.cleanupRequired) fail('Finish the existing storage transition first.');
      const state = (await this.readState(tx, control)).state;
      if (sha(JSON.stringify(state)) !== expectedHash) fail('Frozen source parity changed.');
      return state;
    }, { readOnly: true });
  }
  /** Freeze the exact predecessor read in the authority transaction. */
  async freezeAccounts(prepare: (state: PlgState, previous: Record<string, any>) => {
    control: Record<string, any>; metadata: Record<string, unknown>;
  }) {
    return this.db.runTransaction(async tx => {
      const doc = await tx.get(this.db.doc(PLG_STORAGE_AUTHORITY)), control = authority(doc);
      if (!doc.exists || control.staging || control.retired || control.cleanupRequired)
        fail('Finish the existing storage transition first.');
      const state = (await this.readState(tx, control)).state;
      const next = prepare(state, doc.data()!);
      if (next.control.protocol !== 2 || next.control.mode !== 'staging_accounts' ||
        canonical(next.control.sourceAuthority) !== canonical(doc.data()) ||
        next.control.sourceHash !== sha(JSON.stringify(state))) fail();
      tx.set(doc.ref, next.control);
      tx.create(this.db.doc(generationPath(next.control.generation)), next.metadata);
      return next.control;
    });
  }
  async transaction<T>(fn: (state: PlgState) => T): Promise<T> {
    const commit = (prepared: boolean) => this.db.runTransaction(async tx => {
      const control = authority(await tx.get(this.db.doc(PLG_STORAGE_AUTHORITY)));
      if (control.cleanupRequired && !prepared) return { prepareCleanup: true as const };
      const before = await this.readState(tx, control);
      const draft = structuredClone(before.state), result = fn(draft), state = clean(draft, this.validate);
      const erasure = before.state.contacts.some(contact => !state.contacts.some(current => current.id === contact.id)) ||
        (state.erasedAccountHashes ?? []).some(hash => !before.state.erasedAccountHashes?.includes(hash));
      const receipt = control.cleanupRequired && positiveReceipt(before.state, state, this.now());
      if (control.cleanupRequired && !receipt) return { held: true as const };
      if (erasure && !control.cleanupRequired && (control.staging || control.retired)) {
        // Keep the source erase unacknowledged until *every* inactive copy is gone.
        // The committed cursor is retryable; no private account state is partially erased.
        await discardInactive(this.db, tx, control, 100);
        return { held: true as const };
      }
      const next = { ...control, revision: control.revision + 1, stateChangedAt: this.now() };
      if (!Number.isSafeInteger(next.revision)) fail();
      if (control.mode === 'legacy') {
        boundWrites([state, next], 2);
        tx.set(this.db.doc(PLG_LEGACY_PATH), { payload: legacyPayload(state, control), updatedAt: new Date(this.now()).toISOString() });
      } else {
        const after = image(state, this.validate);
        const removed = [...before.entities].filter(([id]) => !after.entities.has(id));
        const changed = [...after.entities].filter(([id, value]) => canonical(before.entities.get(id)) !== canonical(value));
        // Deleted documents and their old contents also consume the request budget.
        const writes = [after.meta, next, ...removed, ...changed], count = removed.length + changed.length + 2;
        if (!withinBudget(writes, count) && erasure) {
          // Commit only actual erasure effects before returning pending. Arbitrary
          // caller changes must not commit and then be applied again on its retry.
          const redacted = structuredClone(before.state);
          const hashes = new Set([
            ...before.state.contacts.filter(contact => !state.contacts.some(current => current.id === contact.id)).map(contact => accountHash(contact.accountId)),
            ...(state.erasedAccountHashes ?? []).filter(hash => !before.state.erasedAccountHashes?.includes(hash)),
          ]);
          for (const hash of hashes) eraseAccountHash(redacted, hash, this.now());
          clean(redacted, this.validate);
          // Retain the old generation only as tracked private cleanup work.
          // The v2 carrier keeps old writers fenced throughout recovery.
          const recovery: Authority = { protocol: 1, mode: 'legacy', revision: next.revision, stateChangedAt: this.now(),
            retired: control.generation!, cleanupRequired: true, fencedLegacy: true,
            lastTransition: { kind: 'erase_recovery', generation: control.generation! } };
          boundWrites([redacted, recovery], 2);
          tx.set(this.db.doc(PLG_LEGACY_PATH), { payload: legacyPayload(redacted, recovery), updatedAt: new Date(this.now()).toISOString() });
          tx.set(this.db.doc(PLG_STORAGE_AUTHORITY), recovery);
          return { held: true as const };
        }
        boundWrites(writes, count);
        for (const [id] of removed) tx.delete(this.db.doc(recordPath(control.generation!, id)));
        for (const [id, value] of changed) tx.set(this.db.doc(recordPath(control.generation!, id)), { ...value });
        tx.set(this.db.doc(generationPath(control.generation!)), { ...after.meta });
      }
      tx.set(this.db.doc(PLG_STORAGE_AUTHORITY), next);
      return { held: false as const, result };
    });
    let outcome = await commit(false);
    if ('prepareCleanup' in outcome) {
      await this.db.runTransaction(async tx => {
        const control = authority(await tx.get(this.db.doc(PLG_STORAGE_AUTHORITY)));
        if (control.cleanupRequired) await discardInactive(this.db, tx, control, 100);
      });
      outcome = await commit(true);
    }
    if ('result' in outcome) return outcome.result;
    return fail('Inactive-copy cleanup is pending; erasure acknowledgement is held. Retry after cleanup.');
  }
}

/** No route calls this helper. Cloud release/cutover remains an explicit operator action. */
export class PlgStorageMigration {
  constructor(private db: Firestore, private validate: Validate, private now = Date.now) {}
  private match(control: Authority, snapshot: ReturnType<typeof source>, expected: Stage) {
    const stage = control.staging;
    if (control.mode !== 'legacy' || !stage || stage.discarding || stage.generation !== expected.generation ||
      stage.sourceVersion !== snapshot.version || stage.sourceHash !== snapshot.meta.stateHash ||
      expected.sourceVersion !== stage.sourceVersion || expected.sourceHash !== stage.sourceHash) fail('PLG migration source changed; begin a new staged generation.');
    return stage;
  }
  private attest(value: PlgStorageAttestation) {
    if (value?.protocol !== 1 || !Number.isFinite(value.checkedAt) || this.now() - value.checkedAt < 0 || this.now() - value.checkedAt > DRAIN_MS ||
      ![value.serving, value.rollback].every(release => /^hushh-matrix-dashboard-\d{5}-[a-z0-9-]+$/.test(release?.revision ?? '') && /^[a-f0-9]{40}$/.test(release?.sourceSha ?? '')) ||
      value.serving.revision === value.rollback.revision) fail('Attest both compatible serving and captured rollback revisions before changing storage authority.');
  }
  private quiescent(state: PlgState) {
    if (!state.paused || state.automation?.enabled ||
      (state.automation?.lease && Date.parse(state.automation.lease.until) > this.now()) || state.deliveries.some(row => row.status === 'sending'))
      fail('Quiesce campaigns and scheduled workers; active sends cannot cross a storage cutover.');
  }
  async begin(attestation: PlgStorageAttestation): Promise<Stage> {
    return this.db.runTransaction(async tx => {
      this.attest(attestation);
      const control = authority(await tx.get(this.db.doc(PLG_STORAGE_AUTHORITY)));
      if (control.mode !== 'legacy') fail('Normalized storage is already authoritative.');
      if (control.retired || control.staging?.discarding) fail('Finish inactive-generation cleanup before beginning another migration.');
      const snapshot = source(await tx.get(this.db.doc(PLG_LEGACY_PATH)), this.validate, control);
      this.quiescent(snapshot.state);
      const generation = sha(`${snapshot.version}\n${snapshot.meta.stateHash}`);
      if (control.staging?.generation === generation) return control.staging;
      if (control.staging) fail('Discard the stale staged generation explicitly before beginning a new one.');
      const staging: Stage = { generation, sourceVersion: snapshot.version, sourceHash: snapshot.meta.stateHash,
        copied: 0, total: snapshot.entities.size, startedAt: this.now(), verified: false };
      tx.set(this.db.doc(generationPath(generation)), { ...snapshot.meta });
      tx.set(this.db.doc(PLG_STORAGE_AUTHORITY), { ...control, revision: control.revision + 1, staging });
      return staging;
    });
  }
  async step(expected: Stage, batchSize = 100): Promise<Stage> {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) fail('Choose a migration batch between one and 100 records.');
    return this.db.runTransaction(async tx => {
      const control = authority(await tx.get(this.db.doc(PLG_STORAGE_AUTHORITY)));
      const snapshot = source(await tx.get(this.db.doc(PLG_LEGACY_PATH)), this.validate, control);
      const stage = this.match(control, snapshot, expected);
      const batch = [...snapshot.entities].slice(stage.copied, stage.copied + batchSize);
      const staging = { ...stage, copied: stage.copied + batch.length, verified: false };
      boundWrites([staging, ...batch], batch.length + 1);
      for (const [id, value] of batch) tx.set(this.db.doc(recordPath(stage.generation, id)), { ...value });
      tx.set(this.db.doc(PLG_STORAGE_AUTHORITY), { ...control, revision: control.revision + 1, staging });
      return staging;
    });
  }
  async verify(expected: Stage): Promise<Stage> {
    return this.db.runTransaction(async tx => {
      const control = authority(await tx.get(this.db.doc(PLG_STORAGE_AUTHORITY)));
      const snapshot = source(await tx.get(this.db.doc(PLG_LEGACY_PATH)), this.validate, control);
      const stage = this.match(control, snapshot, expected);
      if (stage.copied !== stage.total) fail('Finish every migration batch before parity verification.');
      const rebuilt = await readGeneration(this.db, tx, stage.generation, this.validate);
      if (canonical(rebuilt.state) !== canonical(snapshot.state)) fail();
      const staging = { ...stage, verified: true };
      tx.set(this.db.doc(PLG_STORAGE_AUTHORITY), { ...control, revision: control.revision + 1, staging });
      return staging;
    });
  }
  async activate(expected: Stage, attestation: PlgStorageAttestation) {
    return this.db.runTransaction(async tx => {
      const control = authority(await tx.get(this.db.doc(PLG_STORAGE_AUTHORITY)));
      if (control.mode === 'normalized') {
        const receipt = control.lastTransition;
        if (control.generation !== expected.generation || receipt?.kind !== 'activate' || receipt.generation !== expected.generation ||
          receipt.sourceHash !== expected.sourceHash || receipt.sourceVersionHash !== sha(expected.sourceVersion)) fail('The requested activation is not the current recorded transition.');
        const current = await readGeneration(this.db, tx, control.generation, this.validate);
        return { generation: control.generation, stateHash: current.meta.stateHash, records: current.meta.records, alreadyActive: true };
      }
      this.attest(attestation);
      const snapshot = source(await tx.get(this.db.doc(PLG_LEGACY_PATH)), this.validate, control);
      const stage = this.match(control, snapshot, expected);
      if (!stage.verified || stage.copied !== stage.total || this.now() - stage.startedAt < DRAIN_MS) fail('Verify parity and drain writers for five minutes before cutover.');
      this.quiescent(snapshot.state);
      const rebuilt = await readGeneration(this.db, tx, stage.generation, this.validate);
      if (canonical(rebuilt.state) !== canonical(snapshot.state)) fail();
      const next: Authority = { protocol: 1, mode: 'normalized', revision: control.revision + 1,
        generation: stage.generation, stateChangedAt: this.now(), fencedLegacy: true,
        lastTransition: { kind: 'activate', generation: stage.generation, sourceHash: stage.sourceHash, sourceVersionHash: sha(stage.sourceVersion) } };
      // Existing v1 writers validate this document inside their transaction.
      // A concurrent old write retries against this fence, never its stale copy.
      tx.set(this.db.doc(PLG_LEGACY_PATH), { payload: JSON.stringify({ version: 2, authority: PLG_STORAGE_AUTHORITY }),
        updatedAt: new Date(this.now()).toISOString() });
      tx.set(this.db.doc(PLG_STORAGE_AUTHORITY), next);
      return { generation: stage.generation, stateHash: rebuilt.meta.stateHash, records: rebuilt.meta.records, alreadyActive: false };
    });
  }
  async rollback(attestation: PlgStorageAttestation, expectedGeneration: string) {
    return this.db.runTransaction(async tx => {
      const control = authority(await tx.get(this.db.doc(PLG_STORAGE_AUTHORITY)));
      if (!/^[a-f0-9]{64}$/.test(expectedGeneration ?? '')) fail('Supply the intended normalized generation for rollback.');
      if (control.mode === 'legacy') {
        if (control.lastTransition?.kind !== 'rollback' || control.lastTransition.generation !== expectedGeneration)
          fail('No matching completed rollback is recorded.');
        const state = legacyState(await tx.get(this.db.doc(PLG_LEGACY_PATH)), control, this.validate);
        return { stateHash: sha(canonical(state)), alreadyRolledBack: true };
      }
      this.attest(attestation);
      if (control.generation !== expectedGeneration) fail('The intended rollback generation is not active.');
      if (control.mode !== 'normalized' || !control.stateChangedAt || this.now() - control.stateChangedAt < DRAIN_MS)
        fail('Quiesce normalized writers for five minutes before storage rollback.');
      const current = await readGeneration(this.db, tx, control.generation!, this.validate);
      this.quiescent(current.state);
      const next: Authority = { protocol: 1, mode: 'legacy', revision: control.revision + 1, stateChangedAt: this.now(), retired: control.generation!,
        fencedLegacy: true, lastTransition: { kind: 'rollback', generation: control.generation! } };
      boundWrites([current.state, next], 2);
      tx.set(this.db.doc(PLG_LEGACY_PATH), { payload: legacyPayload(current.state, next), updatedAt: new Date(this.now()).toISOString() });
      tx.set(this.db.doc(PLG_STORAGE_AUTHORITY), next);
      return { stateHash: current.meta.stateHash, records: current.meta.records, alreadyRolledBack: false };
    });
  }
  /** Delete only a tracked inactive copy; never select a generation by arbitrary path. */
  async cleanup(batchSize = 100) {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) fail('Choose a cleanup batch between one and 100 records.');
    return this.db.runTransaction(async tx => {
      const control = authority(await tx.get(this.db.doc(PLG_STORAGE_AUTHORITY)));
      if (control.mode !== 'legacy') fail('Active normalized storage cannot be cleaned up.');
      if (!control.retired && !control.staging) return { complete: true, removed: 0 };
      const legacy = await tx.get(this.db.doc(PLG_LEGACY_PATH));
      const state = legacyState(legacy, control, this.validate);
      this.quiescent(state);
      return discardInactive(this.db, tx, control, batchSize);
    });
  }
}
