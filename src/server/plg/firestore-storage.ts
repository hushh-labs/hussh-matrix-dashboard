import { createHash } from 'node:crypto';
import type { DocumentSnapshot, Firestore, Transaction } from '@google-cloud/firestore';
import type { PlgState } from '../../lib/plg';
import { initialPlgState, PlgError } from './engine';

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
interface Authority { protocol: 1; mode: 'legacy' | 'normalized'; revision: number; generation?: string; stateChangedAt?: number; staging?: Stage; retired?: string; cleanupRequired?: boolean }
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
    (value.cleanupRequired !== undefined && (value.cleanupRequired !== true || value.mode !== 'legacy' || (!value.staging && !value.retired))) ||
    (value.mode === 'normalized' && !/^[a-f0-9]{64}$/.test(value.generation ?? '')) ||
    (value.retired !== undefined && (!/^[a-f0-9]{64}$/.test(value.retired) || value.mode !== 'legacy' || value.staging))) fail();
  if (value.staging) {
    const s = value.staging;
    if (value.mode !== 'legacy' || !/^[a-f0-9]{64}$/.test(s.generation) || !/^[a-f0-9]{64}$/.test(s.sourceHash) || typeof s.sourceVersion !== 'string' ||
      !Number.isSafeInteger(s.copied) || !Number.isSafeInteger(s.total) || s.copied < 0 || s.copied > s.total || s.total > MAX_RECORDS ||
      !Number.isFinite(s.startedAt) || typeof s.verified !== 'boolean' || (s.discarding !== undefined && typeof s.discarding !== 'boolean')) fail();
  }
  return value;
}
function source(doc: DocumentSnapshot, validate: Validate) {
  if (!doc.exists || !doc.updateTime) fail('Initialize and verify the legacy PLG store before migration.');
  const state = JSON.parse(doc.get('payload')) as PlgState;
  const snapshot = image(state, validate);
  return { ...snapshot, version: `${doc.updateTime!.seconds}:${doc.updateTime!.nanoseconds}` };
}
const generationPath = (generation: string) => `${GENERATIONS}/${generation}`;
const recordPath = (generation: string, id: string) => `${generationPath(generation)}/${RECORDS}/${id}`;
function boundWrites(values: unknown[], count = values.length) {
  if (count > MAX_WRITES || Buffer.byteLength(JSON.stringify(values)) > MAX_WRITE_BYTES)
    fail('PLG atomic storage change exceeds its safe budget; no partial update was applied.');
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
    return { state: clean(doc.exists ? JSON.parse(doc.get('payload')) : initialPlgState(), this.validate), entities: new Map<string, Entity>() };
  }
  async read() {
    return this.db.runTransaction(async tx => {
      const control = authority(await tx.get(this.db.doc(PLG_STORAGE_AUTHORITY)));
      return (await this.readState(tx, control)).state;
    }, { readOnly: true });
  }
  async transaction<T>(fn: (state: PlgState) => T): Promise<T> {
    const outcome = await this.db.runTransaction(async tx => {
      const control = authority(await tx.get(this.db.doc(PLG_STORAGE_AUTHORITY)));
      const before = await this.readState(tx, control);
      if (control.cleanupRequired) {
        await discardInactive(this.db, tx, control, 100);
        return { held: true as const };
      }
      const draft = structuredClone(before.state), result = fn(draft), state = clean(draft, this.validate);
      const erasure = before.state.contacts.some(contact => !state.contacts.some(current => current.id === contact.id)) ||
        (state.erasedAccountHashes ?? []).some(hash => !before.state.erasedAccountHashes?.includes(hash));
      if (erasure && (control.staging || control.retired)) {
        // Keep the source erase unacknowledged until *every* inactive copy is gone.
        // The committed cursor is retryable; no private account state is partially erased.
        await discardInactive(this.db, tx, control, 100);
        return { held: true as const };
      }
      const next = { ...control, revision: control.revision + 1, stateChangedAt: this.now() };
      if (!Number.isSafeInteger(next.revision)) fail();
      if (control.mode === 'legacy') {
        boundWrites([state, next], 2);
        tx.set(this.db.doc(PLG_LEGACY_PATH), { payload: JSON.stringify(state), updatedAt: new Date(this.now()).toISOString() });
      } else {
        const after = image(state, this.validate);
        const removed = [...before.entities].filter(([id]) => !after.entities.has(id));
        const changed = [...after.entities].filter(([id, value]) => canonical(before.entities.get(id)) !== canonical(value));
        // Deleted documents and their old contents also consume the request budget.
        boundWrites([after.meta, next, ...removed, ...changed], removed.length + changed.length + 2);
        for (const [id] of removed) tx.delete(this.db.doc(recordPath(control.generation!, id)));
        for (const [id, value] of changed) tx.set(this.db.doc(recordPath(control.generation!, id)), { ...value });
        tx.set(this.db.doc(generationPath(control.generation!)), { ...after.meta });
      }
      tx.set(this.db.doc(PLG_STORAGE_AUTHORITY), next);
      return { held: false as const, result };
    });
    if ('result' in outcome) return outcome.result;
    return fail('Inactive-copy cleanup is pending; the authoritative mutation was not applied. Retry after cleanup.');
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
      const snapshot = source(await tx.get(this.db.doc(PLG_LEGACY_PATH)), this.validate);
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
      const snapshot = source(await tx.get(this.db.doc(PLG_LEGACY_PATH)), this.validate);
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
      const snapshot = source(await tx.get(this.db.doc(PLG_LEGACY_PATH)), this.validate);
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
      this.attest(attestation);
      const control = authority(await tx.get(this.db.doc(PLG_STORAGE_AUTHORITY)));
      const snapshot = source(await tx.get(this.db.doc(PLG_LEGACY_PATH)), this.validate);
      const stage = this.match(control, snapshot, expected);
      if (!stage.verified || stage.copied !== stage.total || this.now() - stage.startedAt < DRAIN_MS) fail('Verify parity and drain writers for five minutes before cutover.');
      this.quiescent(snapshot.state);
      const rebuilt = await readGeneration(this.db, tx, stage.generation, this.validate);
      if (canonical(rebuilt.state) !== canonical(snapshot.state)) fail();
      const next: Authority = { protocol: 1, mode: 'normalized', revision: control.revision + 1,
        generation: stage.generation, stateChangedAt: this.now() };
      // Existing v1 writers validate this document inside their transaction.
      // A concurrent old write retries against this fence, never its stale copy.
      tx.set(this.db.doc(PLG_LEGACY_PATH), { payload: JSON.stringify({ version: 2, authority: PLG_STORAGE_AUTHORITY }),
        updatedAt: new Date(this.now()).toISOString() });
      tx.set(this.db.doc(PLG_STORAGE_AUTHORITY), next);
      return { generation: stage.generation, stateHash: rebuilt.meta.stateHash, records: rebuilt.meta.records };
    });
  }
  async rollback(attestation: PlgStorageAttestation) {
    return this.db.runTransaction(async tx => {
      this.attest(attestation);
      const control = authority(await tx.get(this.db.doc(PLG_STORAGE_AUTHORITY)));
      if (control.mode !== 'normalized' || !control.stateChangedAt || this.now() - control.stateChangedAt < DRAIN_MS)
        fail('Quiesce normalized writers for five minutes before storage rollback.');
      const current = await readGeneration(this.db, tx, control.generation!, this.validate);
      this.quiescent(current.state);
      const next: Authority = { protocol: 1, mode: 'legacy', revision: control.revision + 1, stateChangedAt: this.now(), retired: control.generation! };
      boundWrites([current.state, next], 2);
      tx.set(this.db.doc(PLG_LEGACY_PATH), { payload: JSON.stringify(current.state), updatedAt: new Date(this.now()).toISOString() });
      tx.set(this.db.doc(PLG_STORAGE_AUTHORITY), next);
      return { stateHash: current.meta.stateHash, records: current.meta.records };
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
      const state = clean(legacy.exists ? JSON.parse(legacy.get('payload')) : initialPlgState(), this.validate);
      this.quiescent(state);
      return discardInactive(this.db, tx, control, batchSize);
    });
  }
}
