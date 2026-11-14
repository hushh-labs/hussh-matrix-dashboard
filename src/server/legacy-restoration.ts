import { cohortMatchesSnapshotWitness, cohortSnapshotWitness, type CustomerCohort, type CohortSnapshotWitness } from './one-customer-cohort';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import type { Firestore } from '@google-cloud/firestore';
import type { Query } from '@google-cloud/bigquery';

// An operator-created, exact-source permit is separate from the normal daily
// ledger. It cannot be activated, renewed or enlarged by an HTTP request.
export const RESTORATION_LIMITS = Object.freeze({ bytes: 64 * 1024 ** 3, jobs: 80,
  bytesPerJob: 16 * 1024 ** 3, windowMs: 60 * 60_000, snapshotMs: 24 * 60 * 60_000,
  snapshotBytes: 700_000, snapshots: 32 });
// Hard safety envelope for a separately measured, explicitly claimed expansion.
export const HISTORICAL_LIMITS = Object.freeze({ totalBytes: 2048 * 1024 ** 3, jobs: 500, bytesPerJob: 64 * 1024 ** 3 });
type Phase = 'planning' | 'open' | 'closed';
export interface RestorationPermit {
  source: string; phase: Phase; createdAt: number; expiresAt: number; asOf: string;
  maxBytes: number; maxJobs: number; plans: Record<string, number>;
  reservedBytes: number; reservedJobs: number;
  approvedPlanDigest?: string;
  previousPermitId?: string; previousSource?: string; previousReservedBytes?: number;
  abandonedPermitId?: string; abandonedSource?: string; maxTotalBytes?: number; maxPerJobBytes?: number;
  fixedReports?: string[]; approvedReportDigest?: string;
  reusePlans?: Record<string, string>; approvedReuseDigest?: string;
  approvedBytes?: number; approvedJobs?: number;
  observations?: Record<string, { bytes: number; reports: string[]; queryDigest: string; cohortScope: string }>;
}
export interface RestorationGrant { permitId: string; planHash: string; id: string; bytes: number; report?: string;
  reuse?: { key: string; priorPlanHash: string } }
const scope = new AsyncLocalStorage<{ key: string; failed: boolean }>();
export const withLegacyReportScope = <T>(key: string, load: () => Promise<T>) => scope.run({ key, failed: false }, load);
export function noteLegacyQueryFailure() { const current = scope.getStore(); if (current) current.failed = true; }
export const legacyReportFailed = () => scope.getStore()?.failed ?? true;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const restorationPlanDigest = (plans: Record<string, number>) => hash(JSON.stringify(Object.entries(plans).sort(([a], [b]) => a.localeCompare(b))));
export const restorationReportDigest = (reports: string[]) => hash(JSON.stringify([...reports].sort()));
export const restorationReuseDigest = (plans: Record<string, string>) => hash(JSON.stringify(Object.entries(plans).sort(([a], [b]) => a.localeCompare(b))));
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
  const expanded = p?.abandonedPermitId !== undefined;
  if (expanded && (!Number.isSafeInteger(p.maxTotalBytes) || p.maxTotalBytes! < 1 || p.maxTotalBytes! > HISTORICAL_LIMITS.totalBytes
    || !Number.isSafeInteger(p.maxPerJobBytes) || p.maxPerJobBytes! < 1 || p.maxPerJobBytes! > HISTORICAL_LIMITS.bytesPerJob
    || !/^(restore_)[a-f0-9]{16}$/.test(p.abandonedPermitId ?? '') || !/^[a-f0-9]{40}$/.test(p.abandonedSource ?? '')
    || !Array.isArray(p.fixedReports) || p.fixedReports.length < 1 || p.fixedReports.length > 32
    || new Set(p.fixedReports).size !== p.fixedReports.length || p.fixedReports.some(report => typeof report !== 'string' || !report.startsWith('/api/analytics/') || report.length > 2048)
    || p.approvedReportDigest !== restorationReportDigest(p.fixedReports)
    || !p.reusePlans || Array.isArray(p.reusePlans) || Object.keys(p.reusePlans).length > 500
    || Object.entries(p.reusePlans).some(([key, value]) => !/^[a-f0-9]{64}$/.test(key) || typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    || p.approvedReuseDigest !== restorationReuseDigest(p.reusePlans)
    || ((p.phase === 'open' || (p.phase === 'closed' && p.reservedJobs > 0))
      && (!Number.isSafeInteger(p.approvedBytes) || p.approvedBytes! < p.reservedBytes || p.approvedBytes! > p.maxBytes
        || !Number.isSafeInteger(p.approvedJobs) || p.approvedJobs! < p.reservedJobs || p.approvedJobs! > p.maxJobs)))) throw fail();
  if (!p || p.source !== source || !['planning', 'open', 'closed'].includes(p.phase)
    || !Number.isSafeInteger(p.createdAt) || p.createdAt > now + 10_000
    || !Number.isSafeInteger(p.expiresAt) || p.expiresAt <= p.createdAt
    || p.expiresAt - p.createdAt > RESTORATION_LIMITS.windowMs
    || !Number.isFinite(Date.parse(p.asOf)) || Date.parse(p.asOf) !== p.createdAt
    || !Number.isSafeInteger(p.maxBytes) || p.maxBytes < 1 || p.maxBytes > (expanded ? HISTORICAL_LIMITS.totalBytes : RESTORATION_LIMITS.bytes)
    || !Number.isSafeInteger(p.maxJobs) || p.maxJobs < 1 || p.maxJobs > (expanded ? HISTORICAL_LIMITS.jobs : RESTORATION_LIMITS.jobs)
    || !Number.isSafeInteger(p.reservedBytes) || p.reservedBytes < 0 || p.reservedBytes > p.maxBytes
    || !Number.isSafeInteger(p.reservedJobs) || p.reservedJobs < 0 || p.reservedJobs > p.maxJobs
    || !p.plans || Array.isArray(p.plans) || Object.keys(p.plans).length > p.maxJobs
    || Object.entries(p.plans).some(([key, bytes]) => !/^[a-f0-9]{64}$/.test(key)
      || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > (expanded ? p.maxPerJobBytes! : RESTORATION_LIMITS.bytesPerJob))
    || (p.observations !== undefined && (!p.observations || Array.isArray(p.observations)
      || Object.keys(p.observations).length > 500 || Object.entries(p.observations).some(([key, item]) =>
        !/^[a-f0-9]{64}$/.test(key) || !Number.isSafeInteger(item?.bytes) || item.bytes < 1 || item.bytes > 512 * 1024 ** 3
        || !/^[a-f0-9]{64}$/.test(item.queryDigest ?? '') || !/^(?:[a-f0-9]{64})?$/.test(item.cohortScope ?? '')
        || !Array.isArray(item.reports) || item.reports.length > 32 || item.reports.some(report => typeof report !== 'string' || !report.startsWith('/api/analytics/') || report.length > 2048))))
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
    private previous?: { id: string; source: string }, private diagnostic = false,
    private abandoned?: { id: string; source: string }) {
    if (!/^restore_[a-f0-9]{16}$/.test(id) || !/^[a-f0-9]{40}$/.test(source)) throw fail();
  }
  private ref() { return this.db.doc(`metricsRestorationPermits/${this.id}`); }
  private checkPrevious(p: RestorationPermit, previousValue: unknown, claimValue?: unknown,
    abandonedValue?: unknown, expansionValue?: unknown) {
    if (!this.previous) {
      if (p.previousPermitId !== undefined || p.previousSource !== undefined || p.previousReservedBytes !== undefined || p.abandonedPermitId !== undefined || this.abandoned) throw fail();
      return;
    }
    const previous = validPermit(previousValue, this.previous.source, this.now());
    const claim = claimValue as Record<string, unknown> | undefined;
    if (this.previous.id === this.id || previous.phase !== 'closed' || previous.previousPermitId !== undefined
      || p.previousPermitId !== this.previous.id || p.previousSource !== this.previous.source
      || p.previousReservedBytes !== previous.reservedBytes || !claim
      || claim.previousPermitId !== this.previous.id || claim.previousSource !== this.previous.source
      || claim.previousReservedBytes !== previous.reservedBytes) throw fail();
    if (!this.abandoned) {
      if (p.abandonedPermitId !== undefined || claim.recoveryPermitId !== this.id || claim.recoverySource !== this.source
        || claim.maxBytes !== p.maxBytes || claim.maxJobs !== p.maxJobs || claim.createdAt !== p.createdAt || claim.expiresAt !== p.expiresAt
        || p.maxBytes + previous.reservedBytes > RESTORATION_LIMITS.bytes) throw fail();
      return;
    }
    const abandoned = validPermit(abandonedValue, this.abandoned.source, this.now());
    const expansion = expansionValue as Record<string, unknown> | undefined;
    if (this.diagnostic || this.abandoned.id === this.id || this.abandoned.id === this.previous.id
      || abandoned.phase !== 'closed' || abandoned.reservedBytes !== 0 || abandoned.reservedJobs !== 0
      || abandoned.previousPermitId !== this.previous.id || abandoned.previousSource !== this.previous.source
      || abandoned.previousReservedBytes !== previous.reservedBytes || abandoned.abandonedPermitId !== undefined
      || claim.recoveryPermitId !== this.abandoned.id || claim.recoverySource !== this.abandoned.source
      || claim.maxBytes !== abandoned.maxBytes || claim.maxJobs !== abandoned.maxJobs
      || claim.createdAt !== abandoned.createdAt || claim.expiresAt !== abandoned.expiresAt
      || p.abandonedPermitId !== this.abandoned.id || p.abandonedSource !== this.abandoned.source
      || !expansion || expansion.previousPermitId !== this.previous.id || expansion.previousSource !== this.previous.source
      || expansion.previousReservedBytes !== previous.reservedBytes || expansion.abandonedPermitId !== this.abandoned.id
      || expansion.abandonedSource !== this.abandoned.source || expansion.recoveryPermitId !== this.id
      || expansion.recoverySource !== this.source || expansion.maxBytes !== p.maxBytes || expansion.maxJobs !== p.maxJobs
      || expansion.maxTotalBytes !== p.maxTotalBytes || expansion.maxPerJobBytes !== p.maxPerJobBytes
      || expansion.approvedReportDigest !== p.approvedReportDigest || expansion.approvedReuseDigest !== p.approvedReuseDigest
      || expansion.createdAt !== p.createdAt || expansion.expiresAt !== p.expiresAt
      || p.maxBytes + previous.reservedBytes > p.maxTotalBytes!) throw fail();
  }
  private previousRef() { return this.previous ? this.db.doc(`metricsRestorationPermits/${this.previous.id}`) : null; }
  private claimRef() { return this.previous ? this.db.doc(`metricsRestorationRecoveryClaims/${this.previous.id}`) : null; }
  private abandonedRef() { return this.abandoned ? this.db.doc(`metricsRestorationPermits/${this.abandoned.id}`) : null; }
  private expansionRef() { return this.abandoned && this.previous ? this.db.doc(`metricsRestorationExpansionClaims/${this.previous.id}`) : null; }
  private approvalRef() { return this.abandoned ? this.db.doc(`metricsRestorationExecutionApprovals/${this.id}`) : null; }
  private async checkedPermit(read: (ref: any) => Promise<any>) {
    const snapshot = await read(this.ref()), p = validPermit(snapshot.data(), this.source, this.now());
    const previousRef = this.previousRef(), claimRef = this.claimRef(), abandonedRef = this.abandonedRef(), expansionRef = this.expansionRef(), approvalRef = this.approvalRef();
    const previous = previousRef ? (await read(previousRef)).data() : undefined;
    const claim = claimRef ? (await read(claimRef)).data() : undefined;
    const abandoned = abandonedRef ? (await read(abandonedRef)).data() : undefined;
    const expansion = expansionRef ? (await read(expansionRef)).data() : undefined;
    const approval = approvalRef && (p.phase === 'open' || (p.phase === 'closed' && p.reservedJobs > 0)) ? (await read(approvalRef)).data() : undefined;
    this.checkPrevious(p, previous, claim, abandoned, expansion);
    if (this.abandoned && (p.phase === 'open' || (p.phase === 'closed' && p.reservedJobs > 0))
      && (!approval || approval.source !== this.source || approval.approvedPlanDigest !== p.approvedPlanDigest
        || approval.approvedReportDigest !== p.approvedReportDigest || approval.approvedReuseDigest !== p.approvedReuseDigest
        || approval.approvedBytes !== p.approvedBytes || approval.approvedJobs !== p.approvedJobs
        || approval.createdAt !== p.createdAt || approval.expiresAt !== p.expiresAt)) throw fail();
    return p;
  }
  private async permit() { return this.checkedPermit(ref => ref.get()); }
  async perJobCeiling() { const p = await this.permit(); return p.abandonedPermitId ? p.maxPerJobBytes! : RESTORATION_LIMITS.bytesPerJob; }
  async expandedPreparing() { const p = await this.permit(); return !!p.abandonedPermitId && p.phase !== 'closed' && p.expiresAt > this.now(); }
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
    if (this.diagnostic && (p.phase !== 'planning' || p.expiresAt <= this.now())) throw fail();
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
    if (initial.abandonedPermitId && !initial.fixedReports!.includes(reportScope.slice(separator + 1))) throw fail();
    if (initial.abandonedPermitId && this.previous) {
      const reuseKey = hash(JSON.stringify([hash(request.query), cohortScope]));
      const priorHash = initial.reusePlans![reuseKey];
      if (priorHash) {
        const original = validPermit((await this.previousRef()!.get()).data(), this.previous.source, this.now());
        const expected = hash(JSON.stringify({ schema: 1, source: this.previous.source, cohortScope,
          project: 'hushh-ai-prod', location: 'US', asOf: original.asOf, query: request.query }));
        const reservation = (await this.previousRef()!.collection('reservations').doc(priorHash).get()).data();
        const id = `metrics_${this.previous.id}_${priorHash}`, bytes = original.plans[priorHash];
        if (expected !== priorHash || !Number.isSafeInteger(bytes) || bytes < 1
          || reservation?.jobId !== id || reservation.bytes !== bytes) throw fail();
        return { permitId: this.id, planHash, id, bytes, report: reportScope.slice(separator + 1),
          reuse: { key: reuseKey, priorPlanHash: priorHash } };
      }
    }
    const unit = 10 * 1024 ** 2;
    const bytes = Math.max(unit, Math.ceil(estimated / unit) * unit + unit);
    if (this.diagnostic) {
      if (initial.phase !== 'planning' || bytes > 512 * 1024 ** 3) throw fail();
      const report = reportScope.slice(separator + 1);
      if (report.length > 2048) throw fail();
      await this.db.runTransaction(async tx => {
        const ref = this.ref(), p = await this.checkedPermit(ref => tx.get(ref));
        if (p.phase !== 'planning' || p.expiresAt <= this.now() || p.asOf !== initial.asOf) throw fail();
        const observations = { ...p.observations }, existing = observations[planHash];
        if (!existing && Object.keys(observations).length >= 500) throw fail();
        const reports = [...new Set([...(existing?.reports ?? []), report])].sort();
        if (reports.length > 32) throw fail();
        const queryDigest = hash(request.query as string);
        if (existing && (existing.queryDigest !== queryDigest || existing.cohortScope !== cohortScope)) throw fail();
        observations[planHash] = { bytes: Math.max(bytes, existing?.bytes ?? 0), reports, queryDigest, cohortScope };
        if (Buffer.byteLength(JSON.stringify(observations)) > 700_000) throw fail();
        tx.update(ref, { observations });
      });
      throw new Error('Diagnostic estimate recorded; no query was executed.');
    }
    if (bytes > (initial.abandonedPermitId ? initial.maxPerJobBytes! : RESTORATION_LIMITS.bytesPerJob)) throw fail();
    if (initial.phase === 'planning') {
      await this.db.runTransaction(async tx => {
        const ref = this.ref(); const p = await this.checkedPermit(ref => tx.get(ref));
        if (p.phase !== 'planning' || p.expiresAt <= this.now() || p.asOf !== initial.asOf) throw fail();
        if ((p.plans[planHash] ?? 0) >= bytes) return;
        const plans = { ...p.plans, [planHash]: Math.max(bytes, p.plans[planHash] ?? 0) };
        if (Object.keys(plans).length > p.maxJobs || Object.values(plans).reduce((a, b) => a + b, 0) > p.maxBytes) throw fail();
        tx.update(ref, { plans });
      });
      throw new Error('Initial restoration plan recorded; no query was executed.');
    }
    if (initial.abandonedPermitId) {
      const report = reportScope.slice(separator + 1);
      if (!initial.fixedReports!.includes(report)) throw fail();
      // A sealed report manifest allows source-generated SELECTs on result-dependent
      // branches. The native estimate and durable reservation still bound each job.
      const id = `metrics_${this.id}_${planHash}`;
      const existing = (await this.ref().collection('reservations').doc(planHash).get()).data();
      if (existing && (existing.jobId !== id || !Number.isSafeInteger(existing.bytes) || existing.bytes < bytes
        || existing.bytes > initial.maxPerJobBytes!)) throw fail();
      return { permitId: this.id, planHash, id, bytes: existing?.bytes ?? bytes, report };
    }
    if (!initial.plans[planHash] || bytes > initial.plans[planHash]) throw fail();
    return { permitId: this.id, planHash, id: `metrics_${this.id}_${planHash}`, bytes: initial.plans[planHash] };
  }
  async reserve(grant: RestorationGrant) {
    if (this.diagnostic) throw fail();
    if (grant.reuse) {
      const p = await this.permit();
      if (grant.permitId !== this.id || !/^[a-f0-9]{64}$/.test(grant.planHash) || !this.previous || !p.abandonedPermitId || !['planning', 'open'].includes(p.phase) || p.expiresAt <= this.now()
        || !grant.report || !p.fixedReports!.includes(grant.report) || p.reusePlans![grant.reuse.key] !== grant.reuse.priorPlanHash
        || grant.id !== `metrics_${this.previous.id}_${grant.reuse.priorPlanHash}`) throw fail();
      const original = validPermit((await this.previousRef()!.get()).data(), this.previous.source, this.now());
      const reservation = (await this.previousRef()!.collection('reservations').doc(grant.reuse.priorPlanHash).get()).data();
      if (!Number.isSafeInteger(grant.bytes) || grant.bytes < 1 || original.plans[grant.reuse.priorPlanHash] !== grant.bytes
        || reservation?.jobId !== grant.id || reservation.bytes !== grant.bytes) throw fail();
      return;
    }
    if (!Number.isSafeInteger(grant.bytes) || grant.bytes < 1 || grant.permitId !== this.id || !/^[a-f0-9]{64}$/.test(grant.planHash)
      || grant.id !== `metrics_${this.id}_${grant.planHash}`) throw fail();
    await this.db.runTransaction(async tx => {
      const ref = this.ref(); const reservation = ref.collection('reservations').doc(grant.planHash);
      const p = await this.checkedPermit(ref => tx.get(ref));
      const existing = await tx.get(reservation);
      if (p.phase !== 'open' || p.expiresAt <= this.now()
        || (p.abandonedPermitId ? !grant.report || !p.fixedReports!.includes(grant.report) || grant.bytes > p.maxPerJobBytes!
          : p.plans[grant.planHash] !== grant.bytes)) throw fail();
      if (existing.exists) {
        if (existing.data()?.bytes !== grant.bytes || existing.data()?.jobId !== grant.id) throw fail();
        return;
      }
      const byteLimit = p.abandonedPermitId ? p.approvedBytes! : p.maxBytes;
      const jobLimit = p.abandonedPermitId ? p.approvedJobs! : p.maxJobs;
      if (p.reservedBytes + grant.bytes > byteLimit || p.reservedJobs + 1 > jobLimit) throw fail();
      tx.update(ref, { reservedBytes: p.reservedBytes + grant.bytes, reservedJobs: p.reservedJobs + 1 });
      tx.create(reservation, { bytes: grant.bytes, jobId: grant.id, reservedAt: this.now() });
    });
  }
  private async snapshotRow(keyHash: string, p: RestorationPermit) {
    if (!/^[a-f0-9]{64}$/.test(keyHash)) return null;
    const row = (await this.ref().collection('snapshots').doc(keyHash).get()).data();
    if (!row || row.source !== this.source || row.keyHash !== keyHash || row.schema !== 1
      || !Number.isSafeInteger(row.at) || row.at < p.createdAt || row.at > this.now()
      || this.now() - row.at > RESTORATION_LIMITS.snapshotMs || typeof row.json !== 'string'
      || Buffer.byteLength(row.json) > RESTORATION_LIMITS.snapshotBytes) return null;
    const value = JSON.parse(row.json);
    return value?.status === 200 && value.body ? { at: row.at, value, witness: row.witness as CohortSnapshotWitness | undefined } : null;
  }
  async readSnapshot(key: string): Promise<{ at: number; value: { status: number; body: unknown }; cohortAsOf?: string } | null> {
    const row = await this.snapshotRow(hash(key), await this.permit());
    return row ? { at: row.at, value: row.value, ...(row.witness ? { cohortAsOf: row.witness.asOf } : {}) } : null;
  }
  /** New witnessed snapshots can survive additions after their capture cutoff. */
  async readCompatibleSnapshot(reportUrl: string, cohort: CustomerCohort): Promise<{ at: number; value: { status: number; body: unknown }; cohortAsOf: string } | null> {
    if (!reportUrl.startsWith('/api/analytics/') || reportUrl.length > 2048) return null;
    const p = await this.permit(), reportHash = hash(reportUrl);
    const index = (await this.ref().collection('snapshotIndex').doc(reportHash).get()).data();
    if (!index || index.schema !== 1 || index.source !== this.source || index.reportHash !== reportHash
      || !Array.isArray(index.keys) || index.keys.length > RESTORATION_LIMITS.snapshots) return null;
    for (const keyHash of [...index.keys].reverse()) {
      if (typeof keyHash !== 'string') return null;
      const row = await this.snapshotRow(keyHash, p);
      if (row?.witness && cohortMatchesSnapshotWitness(cohort, row.witness)) return { at: row.at, value: row.value, cohortAsOf: row.witness.asOf };
    }
    return null;
  }
  async saveSnapshot(key: string, value: { status: number; body: unknown }, at: number,
    captured?: { reportUrl: string; cohort: CustomerCohort }) {
    if (this.diagnostic) throw fail();
    const json = JSON.stringify(value);
    if (value.status !== 200 || Buffer.byteLength(json) > RESTORATION_LIMITS.snapshotBytes) return;
    const witness = captured && key === `${captured.cohort.cacheKey}:${captured.reportUrl}`
      && captured.reportUrl.startsWith('/api/analytics/') && captured.reportUrl.length <= 2048
      ? cohortSnapshotWitness(captured.cohort) : null;
    await this.db.runTransaction(async tx => {
      const ref = this.ref(); const snapshot = await tx.get(ref);
      const p = await this.checkedPermit(ref => tx.get(ref));
      if (p.phase !== 'open' || p.expiresAt <= this.now() || at < p.createdAt || at > this.now()) return;
      const keyHash = hash(key); const keys: string[] = Array.isArray(snapshot.data()?.snapshotKeys) ? snapshot.data()!.snapshotKeys : [];
      if (!keys.includes(keyHash) && keys.length >= RESTORATION_LIMITS.snapshots) throw fail();
      const target = ref.collection('snapshots').doc(keyHash), existing = await tx.get(target);
      const reportHash = witness && captured ? hash(captured.reportUrl) : null;
      const indexRef = reportHash ? ref.collection('snapshotIndex').doc(reportHash) : null;
      const index = indexRef ? await tx.get(indexRef) : null;
      if (existing.exists) return;
      const indexData = index?.data(), indexKeys = index?.exists ? indexData?.keys : [];
      if (indexRef && (!Array.isArray(indexKeys) || indexKeys.length >= RESTORATION_LIMITS.snapshots
        || (index?.exists && (indexData?.schema !== 1 || indexData?.source !== this.source || indexData?.reportHash !== reportHash)))) throw fail();
      tx.create(target, { schema: 1, source: this.source, keyHash, at: p.createdAt, computedAt: at, json, ...(witness ? { witness } : {}) });
      if (!keys.includes(keyHash)) tx.update(ref, { snapshotKeys: [...keys, keyHash] });
      if (indexRef && reportHash) {
        const next = { schema: 1, source: this.source, reportHash, keys: [...indexKeys, keyHash] };
        if (index?.exists) tx.update(indexRef, next); else tx.create(indexRef, next);
      }
    });
  }

}
export const legacyDiagnosticOnly = () => process.env.METRICS_LEGACY_DIAGNOSTIC_ONLY === '1';
let current: { key: string; promise: Promise<LegacyRestoration> } | undefined;
let prior: { key: string; promise: Promise<LegacyRestoration> } | undefined;
function abandonedConfig() {
  const id = process.env.METRICS_LEGACY_ABANDONED_ID, source = process.env.METRICS_LEGACY_ABANDONED_SOURCE;
  if (!id && !source) return null;
  if (!/^restore_[a-f0-9]{16}$/.test(id ?? '') || !/^[a-f0-9]{40}$/.test(source ?? '')) throw fail();
  return { id: id!, source: source! };
}
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
  const old = config(), recovery = recoveryConfig(), abandoned = abandonedConfig();
  if ((recovery && !old) || (abandoned && (!old || !recovery))) throw fail();
  const c = recovery ?? old;
  if (!c) return Promise.resolve(null);
  const diagnostic = legacyDiagnosticOnly();
  if (diagnostic && !recovery) throw fail();
  const key = `${c.id}:${c.source}:${recovery ? `${old!.id}:${old!.source}` : ''}:${diagnostic}:${abandoned?.id ?? ''}:${abandoned?.source ?? ''}`;
  if (current?.key !== key) current = { key, promise: nativeDatabase().then(db => new LegacyRestoration(db, c.id, c.source, Date.now, recovery ? old! : undefined, diagnostic, abandoned ?? undefined)) };
  return current.promise;
}
