import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import type { Firestore } from '@google-cloud/firestore';
import type { Query } from '@google-cloud/bigquery';

// An operator-created, exact-source permit is separate from the normal daily
// ledger. It cannot be activated, renewed or enlarged by an HTTP request.
export const RESTORATION_LIMITS = Object.freeze({ bytes: 64 * 1024 ** 3, jobs: 80,
  bytesPerJob: 16 * 1024 ** 3, windowMs: 60 * 60_000, snapshotMs: 24 * 60 * 60_000,
  snapshotBytes: 700_000, snapshots: 32 });
type Phase = 'planning' | 'open' | 'closed';
export interface RestorationPermit {
  source: string; phase: Phase; createdAt: number; expiresAt: number; asOf: string;
  maxBytes: number; maxJobs: number; plans: Record<string, number>;
  reservedBytes: number; reservedJobs: number;
  approvedPlanDigest?: string;
  previousPermitId?: string; previousSource?: string; previousReservedBytes?: number;
}
export interface RestorationGrant { permitId: string; planHash: string; id: string; bytes: number }
const scope = new AsyncLocalStorage<{ key: string; failed: boolean }>();
export const withLegacyReportScope = <T>(key: string, load: () => Promise<T>) => scope.run({ key, failed: false }, load);
export function noteLegacyQueryFailure() { const current = scope.getStore(); if (current) current.failed = true; }
export const legacyReportFailed = () => scope.getStore()?.failed ?? true;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const restorationPlanDigest = (plans: Record<string, number>) => hash(JSON.stringify(Object.entries(plans).sort(([a], [b]) => a.localeCompare(b))));
const fail = () => new Error('Initial report restoration is held by its finite allowance.');
type Database = Pick<Firestore, 'doc' | 'runTransaction'>;
let database: Promise<Database> | undefined;
async function nativeDatabase() {
  return database ??= import('@google-cloud/firestore').then(({ Firestore }) => new Firestore({
    projectId: 'hushh-ai-prod', databaseId: 'one-plg-production' }));
}
function config() {
  const id = process.env.METRICS_LEGACY_RESTORATION_ID;
  const source = process.env.METRICS_LEGACY_RESTORATION_SOURCE;
  if (!id && !source) return null;
  if (!/^restore_[a-f0-9]{16}$/.test(id ?? '') || !/^[a-f0-9]{40}$/.test(source ?? '')) throw fail();
  return { id: id!, source: source! };
}
export function validPermit(value: unknown, source: string, now: number): RestorationPermit {
  const p = value as RestorationPermit;
  if (!p || p.source !== source || !['planning', 'open', 'closed'].includes(p.phase)
    || !Number.isSafeInteger(p.createdAt) || p.createdAt > now + 10_000
    || !Number.isSafeInteger(p.expiresAt) || p.expiresAt <= p.createdAt
    || p.expiresAt - p.createdAt > RESTORATION_LIMITS.windowMs
    || !Number.isFinite(Date.parse(p.asOf)) || Date.parse(p.asOf) !== p.createdAt
    || !Number.isSafeInteger(p.maxBytes) || p.maxBytes < 1 || p.maxBytes > RESTORATION_LIMITS.bytes
    || !Number.isSafeInteger(p.maxJobs) || p.maxJobs < 1 || p.maxJobs > RESTORATION_LIMITS.jobs
    || !Number.isSafeInteger(p.reservedBytes) || p.reservedBytes < 0 || p.reservedBytes > p.maxBytes
    || !Number.isSafeInteger(p.reservedJobs) || p.reservedJobs < 0 || p.reservedJobs > p.maxJobs
    || !p.plans || Array.isArray(p.plans) || Object.keys(p.plans).length > p.maxJobs
    || Object.entries(p.plans).some(([key, bytes]) => !/^[a-f0-9]{64}$/.test(key)
      || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > RESTORATION_LIMITS.bytesPerJob)
    || (p.phase !== 'planning' && p.approvedPlanDigest !== restorationPlanDigest(p.plans))) throw fail();
  return p;
}

/** Freeze volatile clock functions outside quoted SQL and comments. */
export function freezeRestorationSql(sql: string, asOf: string) {
  if (!Number.isFinite(Date.parse(asOf))) throw fail();
  const timestamp = new Date(asOf).toISOString();
  let out = '';
  for (let i = 0; i < sql.length;) {
    const start = i;
    if (sql.startsWith('--', i) || sql[i] === '#') {
      const end = sql.indexOf('\n', i); i = end < 0 ? sql.length : end;
    } else if (sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i + 2); if (end < 0) throw fail(); i = end + 2;
    } else if (['\'', '"', '`'].includes(sql[i])) {
      const quote = sql[i]; const delimiter = quote !== '`' && sql.startsWith(quote.repeat(3), i) ? quote.repeat(3) : quote;
      i += delimiter.length; let closed = false;
      while (i < sql.length) {
        if (sql[i] === '\\') { i += 2; continue; }
        if (sql.startsWith(delimiter, i)) {
          i += delimiter.length;
          if (delimiter.length === 1 && sql[i] === quote) { i++; continue; }
          closed = true; break;
        }
        i++;
      }
      if (!closed) throw fail();
    } else {
      const match = /^(CURRENT_TIMESTAMP|CURRENT_DATE)\s*\(\s*('[A-Za-z0-9_+:/-]+')?\s*\)/i.exec(sql.slice(i));
      if (match && (i === 0 || !/[a-zA-Z0-9_]/.test(sql[i - 1]))) {
        if (match[1].toUpperCase() === 'CURRENT_TIMESTAMP' && match[2]) throw fail();
        out += match[1].toUpperCase() === 'CURRENT_DATE'
          ? match[2] ? `DATE(TIMESTAMP('${timestamp}'), ${match[2]})` : `DATE('${timestamp.slice(0, 10)}')`
          : `TIMESTAMP('${timestamp}')`;
        i += match[0].length; continue;
      }
      i++;
    }
    out += sql.slice(start, i);
  }
  return out;
}

export class LegacyRestoration {
  constructor(private db: Database, private id: string, private source: string, private now = Date.now,
    private previous?: { id: string; source: string }) {
    if (!/^restore_[a-f0-9]{16}$/.test(id) || !/^[a-f0-9]{40}$/.test(source)) throw fail();
  }
  private ref() { return this.db.doc(`metricsRestorationPermits/${this.id}`); }
  private checkPrevious(p: RestorationPermit, previousValue: unknown, claimValue?: unknown) {
    if (!this.previous) {
      if (p.previousPermitId !== undefined || p.previousSource !== undefined || p.previousReservedBytes !== undefined) throw fail();
      return;
    }
    const previous = validPermit(previousValue, this.previous.source, this.now());
    const claim = claimValue as Record<string, unknown> | undefined;
    if (this.previous.id === this.id || previous.phase !== 'closed' || previous.previousPermitId !== undefined
      || !claim || claim.previousPermitId !== this.previous.id || claim.previousSource !== this.previous.source
      || claim.recoveryPermitId !== this.id || claim.recoverySource !== this.source
      || claim.previousReservedBytes !== previous.reservedBytes || claim.maxBytes !== p.maxBytes
      || claim.maxJobs !== p.maxJobs || claim.createdAt !== p.createdAt || claim.expiresAt !== p.expiresAt
      || p.previousPermitId !== this.previous.id
      || p.previousSource !== this.previous.source || p.previousReservedBytes !== previous.reservedBytes
      || p.maxBytes + previous.reservedBytes > RESTORATION_LIMITS.bytes) throw fail();
  }
  private previousRef() { return this.previous ? this.db.doc(`metricsRestorationPermits/${this.previous.id}`) : null; }
  private claimRef() { return this.previous ? this.db.doc(`metricsRestorationRecoveryClaims/${this.previous.id}`) : null; }
  private async permit() {
    const snapshot = await this.ref().get();
    const p = validPermit(snapshot.data(), this.source, this.now());
    const previousRef = this.previousRef();
    const claimRef = this.claimRef();
    this.checkPrevious(p, previousRef ? (await previousRef.get()).data() : undefined, claimRef ? (await claimRef.get()).data() : undefined);
    return p;
  }
  async publicationAsOf(): Promise<string | null> {
    const snapshot = await this.ref().get();
    const p = await this.permit();
    return p.phase === 'closed' && Array.isArray(snapshot.data()?.snapshotKeys)
      && snapshot.data()!.snapshotKeys.length > 0 && this.now() - p.createdAt <= RESTORATION_LIMITS.snapshotMs
      ? p.asOf : null;
  }
  async isActive() { const p = await this.permit(); return p.phase === 'open' && p.expiresAt > this.now(); }
  async isPreparing() { const p = await this.permit(); return p.phase !== 'closed' && p.expiresAt > this.now(); }
  async prepare(request: Query) {
    const p = await this.permit();
    if (p.phase === 'planning' && p.expiresAt <= this.now()) throw fail();
    if (p.phase === 'closed' || p.expiresAt <= this.now()) return request;
    if (!scope.getStore() || request.params !== undefined || request.types !== undefined || typeof request.query !== 'string') throw fail();
    return { ...request, query: freezeRestorationSql(request.query, p.asOf) };
  }
  async admit(request: Query, estimated: number): Promise<RestorationGrant | undefined> {
    const initial = await this.permit();
    if (initial.phase === 'planning' && initial.expiresAt <= this.now()) throw fail();
    if (initial.phase === 'closed' || initial.expiresAt <= this.now()) return undefined;
    const reportScope = scope.getStore()?.key;
    if (!reportScope || typeof request.query !== 'string' || request.params !== undefined || request.types !== undefined
      || !/^(?:SELECT|WITH)\b/i.test(request.query.trim()) || !Number.isSafeInteger(estimated) || estimated < 0) throw fail();
    // Identical statements can be shared by several reports. Their frozen SQL
    // carries the exact period/environment; the membership namespace must also
    // match. This avoids paying/reserving twice for the same shared statement.
    const separator = reportScope.indexOf(':');
    const cohortScope = reportScope.slice(0, separator);
    if (separator < 0 || !/^(?:[a-f0-9]{64})?$/.test(cohortScope)
      || !reportScope.slice(separator + 1).startsWith('/api/analytics/') || reportScope.length > 8192) throw fail();
    const planHash = hash(JSON.stringify({ schema: 1, source: this.source, cohortScope,
      project: 'hushh-ai-prod', location: 'US', asOf: initial.asOf, query: request.query }));
    const unit = 10 * 1024 ** 2;
    const bytes = Math.max(unit, Math.ceil(estimated / unit) * unit + unit);
    if (bytes > RESTORATION_LIMITS.bytesPerJob) throw fail();
    if (initial.phase === 'planning') {
      await this.db.runTransaction(async tx => {
        const ref = this.ref(); const snapshot = await tx.get(ref);
        const p = validPermit(snapshot.data(), this.source, this.now());
        const previousRef = this.previousRef();
        const claimRef = this.claimRef();
        this.checkPrevious(p, previousRef ? (await tx.get(previousRef)).data() : undefined, claimRef ? (await tx.get(claimRef)).data() : undefined);
        if (p.phase !== 'planning' || p.expiresAt <= this.now() || p.asOf !== initial.asOf) throw fail();
        if ((p.plans[planHash] ?? 0) >= bytes) return;
        const plans = { ...p.plans, [planHash]: Math.max(bytes, p.plans[planHash] ?? 0) };
        if (Object.keys(plans).length > p.maxJobs || Object.values(plans).reduce((a, b) => a + b, 0) > p.maxBytes) throw fail();
        tx.update(ref, { plans });
      });
      throw new Error('Initial restoration plan recorded; no query was executed.');
    }
    if (!initial.plans[planHash] || bytes > initial.plans[planHash]) throw fail();
    return { permitId: this.id, planHash, id: `metrics_${this.id}_${planHash}`, bytes: initial.plans[planHash] };
  }
  async reserve(grant: RestorationGrant) {
    if (grant.permitId !== this.id || !/^[a-f0-9]{64}$/.test(grant.planHash)
      || grant.id !== `metrics_${this.id}_${grant.planHash}`) throw fail();
    await this.db.runTransaction(async tx => {
      const ref = this.ref(); const reservation = ref.collection('reservations').doc(grant.planHash);
      const [snapshot, existing] = await tx.getAll(ref, reservation);
      const p = validPermit(snapshot.data(), this.source, this.now());
      const previousRef = this.previousRef();
      const claimRef = this.claimRef();
      this.checkPrevious(p, previousRef ? (await tx.get(previousRef)).data() : undefined, claimRef ? (await tx.get(claimRef)).data() : undefined);
      if (p.phase !== 'open' || p.expiresAt <= this.now() || p.plans[grant.planHash] !== grant.bytes) throw fail();
      if (existing.exists) {
        if (existing.data()?.bytes !== grant.bytes || existing.data()?.jobId !== grant.id) throw fail();
        return;
      }
      if (p.reservedBytes + grant.bytes > p.maxBytes || p.reservedJobs + 1 > p.maxJobs) throw fail();
      tx.update(ref, { reservedBytes: p.reservedBytes + grant.bytes, reservedJobs: p.reservedJobs + 1 });
      tx.create(reservation, { bytes: grant.bytes, jobId: grant.id, reservedAt: this.now() });
    });
  }
  async readSnapshot(key: string): Promise<{ at: number; value: { status: number; body: unknown } } | null> {
    const p = await this.permit();
    const row = (await this.ref().collection('snapshots').doc(hash(key)).get()).data();
    if (!row || row.source !== this.source || row.keyHash !== hash(key) || row.schema !== 1
      || !Number.isSafeInteger(row.at) || row.at < p.createdAt || row.at > this.now()
      || this.now() - row.at > RESTORATION_LIMITS.snapshotMs || typeof row.json !== 'string'
      || Buffer.byteLength(row.json) > RESTORATION_LIMITS.snapshotBytes) return null;
    const value = JSON.parse(row.json);
    return value?.status === 200 && value.body ? { at: row.at, value } : null;
  }
  async saveSnapshot(key: string, value: { status: number; body: unknown }, at: number) {
    const json = JSON.stringify(value);
    if (value.status !== 200 || Buffer.byteLength(json) > RESTORATION_LIMITS.snapshotBytes) return;
    await this.db.runTransaction(async tx => {
      const ref = this.ref(); const snapshot = await tx.get(ref);
      const p = validPermit(snapshot.data(), this.source, this.now());
      const previousRef = this.previousRef();
      const claimRef = this.claimRef();
      this.checkPrevious(p, previousRef ? (await tx.get(previousRef)).data() : undefined, claimRef ? (await tx.get(claimRef)).data() : undefined);
      if (p.phase !== 'open' || p.expiresAt <= this.now() || at < p.createdAt || at > this.now()) return;
      const keyHash = hash(key); const keys: string[] = Array.isArray(snapshot.data()?.snapshotKeys) ? snapshot.data()!.snapshotKeys : [];
      if (!keys.includes(keyHash) && keys.length >= RESTORATION_LIMITS.snapshots) throw fail();
      // Write-once: a later partial/failed refresh cannot erase the first accepted result.
      const target = ref.collection('snapshots').doc(keyHash); const existing = await tx.get(target);
      if (existing.exists) return;
      tx.create(target, { schema: 1, source: this.source, keyHash, at: p.createdAt, computedAt: at, json });
      if (!keys.includes(keyHash)) tx.update(ref, { snapshotKeys: [...keys, keyHash] });
    });
  }
}
let current: { key: string; promise: Promise<LegacyRestoration> } | undefined;
let prior: { key: string; promise: Promise<LegacyRestoration> } | undefined;
function recoveryConfig() {
  const id = process.env.METRICS_LEGACY_RECOVERY_ID;
  const source = process.env.METRICS_LEGACY_RECOVERY_SOURCE;
  if (!id && !source) return null;
  if (!/^restore_[a-f0-9]{16}$/.test(id ?? '') || !/^[a-f0-9]{40}$/.test(source ?? '')) throw fail();
  return { id: id!, source: source! };
}
/** The original producer-bound snapshots are read-only and retain their source identity. */
export function legacyPreviousRestoration(): Promise<LegacyRestoration | null> {
  const old = config(); if (!old || !recoveryConfig()) return Promise.resolve(null);
  const key = `${old.id}:${old.source}`;
  if (prior?.key !== key) prior = { key, promise: nativeDatabase().then(db => new LegacyRestoration(db, old.id, old.source)) };
  return prior.promise;
}
export function legacyRestoration(): Promise<LegacyRestoration | null> {
  const old = config(), recovery = recoveryConfig();
  if (recovery && !old) throw fail();
  const c = recovery ?? old;
  if (!c) return Promise.resolve(null);
  const key = `${c.id}:${c.source}:${recovery ? `${old!.id}:${old!.source}` : ''}`;
  if (current?.key !== key) current = { key, promise: nativeDatabase().then(db => new LegacyRestoration(db, c.id, c.source, Date.now, recovery ? old! : undefined)) };
  return current.promise;
}
