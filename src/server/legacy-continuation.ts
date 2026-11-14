import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import type { Firestore } from '@google-cloud/firestore';
import type { Query } from '@google-cloud/bigquery';
import { cohortMatchesSnapshotWitness, cohortSnapshotWitness, type CustomerCohort, type CohortSnapshotWitness } from './one-customer-cohort';
import { measurementHashDigest } from './closed-measurement';
import { ClosedJobMissingError, currentLegacyReportKey, freezeRestorationSql, legacyRestoration, nativeDatabase,
  restorationReportDigest, restorationPlanDigest, RESTORATION_LIMITS, HISTORICAL_LIMITS, validPermit, type LegacyRestoration, type RestorationGrant } from './legacy-restoration';

type Database = Pick<Firestore, 'doc' | 'runTransaction'>;
type ContinuationDocument = {
  source: string; phase: 'open' | 'closed'; createdAt: number; expiresAt: number; dataAsOf: string;
  producerId: string; producerSource: string; producerPlanDigest: string; producerReportDigest: string;
  producerReservedBytes: number; producerReservedJobs: number; originalId: string; originalSource: string;
  originalPlanDigest: string; originalReservedBytes: number; originalReservedJobs: number;
  measurementId: string; measurementSource: string; measurementAllowedDigest: string; measurementDigest: string;
  measurementCount: number; measurementBoundBytes: number; knownPlans: Record<string, number>; knownPlanDigest: string; knownPlanBoundBytes: number;
  fixedReports: string[]; reportDigest: string; witnessReport: string;
  maxBytes: number; maxJobs: number; maxPerJobBytes: number; maxTotalBytes: number;
  reservedBytes: number; reservedJobs: number;
};
type JobProof = { id: string; endedAt: number };
const CONTINUATION_LIMITS = Object.freeze({ bytes: 500 * 1024 ** 3, jobs: 200 });
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const fail = () => new Error('Cumulative report continuation is unavailable.');
const context = new AsyncLocalStorage<{ store: LegacyContinuation; dataAsOf: string; jobs: Map<string, JobProof>;
  observation: { maxRows: number; maxBytes: number; reason: string | null } }>();
export const currentContinuation = () => context.getStore();
export const withContinuation = <T>(store: LegacyContinuation, load: () => Promise<T>, dataAsOf: string) => {
  if (!Number.isFinite(Date.parse(dataAsOf))) throw fail();
  return context.run({ store, dataAsOf, jobs: new Map(), observation: { maxRows: 0, maxBytes: 0, reason: null } },
    async () => ({ value: await load(), jobs: [...context.getStore()!.jobs.values()].sort((a, b) => a.id.localeCompare(b.id)) }));
};

/** Uses the same guarded query/reservation pipeline as the original restoration. */
export class LegacyContinuation {
  constructor(private db: Database, private id: string, private source: string, private producer: LegacyRestoration, private now = Date.now) {
    if (!/^restore_[a-f0-9]{16}$/.test(id) || !/^[a-f0-9]{40}$/.test(source)) throw fail();
  }
  private ref() { return this.db.doc(`metricsRestorationContinuations/${this.id}`); }
  private async checked(read: (ref: any) => Promise<any>) {
    const lineage = await this.producer.verifiedClosedIn(read), parent = lineage.p;
    const original = validPermit((await read(this.db.doc(`metricsRestorationPermits/${lineage.original.id}`))).data(), lineage.original.source, this.now());
    const doc = (await read(this.ref())).data() as ContinuationDocument;
    if (!doc || doc.source !== this.source || !['open', 'closed'].includes(doc.phase)
      || !Number.isSafeInteger(doc.createdAt) || !Number.isSafeInteger(doc.expiresAt) || doc.createdAt > this.now() + 10_000
      || doc.expiresAt <= doc.createdAt || doc.expiresAt - doc.createdAt > RESTORATION_LIMITS.windowMs
      || doc.dataAsOf !== parent.asOf || doc.producerId !== lineage.id || doc.producerSource !== lineage.source
      || doc.producerPlanDigest !== parent.approvedPlanDigest || doc.producerReportDigest !== parent.approvedReportDigest
      || doc.producerReservedBytes !== parent.reservedBytes || doc.producerReservedJobs !== parent.reservedJobs
      || original.phase !== 'closed' || doc.originalId !== lineage.original.id || doc.originalSource !== lineage.original.source
      || doc.originalPlanDigest !== original.approvedPlanDigest || doc.originalReservedBytes !== original.reservedBytes
      || doc.originalReservedJobs !== original.reservedJobs || !/^measure_[a-f0-9]{16}$/.test(doc.measurementId ?? '')
      || !/^[a-f0-9]{40}$/.test(doc.measurementSource ?? '') || !/^[a-f0-9]{64}$/.test(doc.measurementAllowedDigest ?? '')
      || !/^[a-f0-9]{64}$/.test(doc.measurementDigest ?? '') || !Number.isSafeInteger(doc.measurementCount) || doc.measurementCount < 1
      || !Number.isSafeInteger(doc.measurementBoundBytes) || doc.measurementBoundBytes < 1 || !doc.knownPlans || Array.isArray(doc.knownPlans)
      || Object.keys(doc.knownPlans).length > HISTORICAL_LIMITS.jobs || Object.entries(doc.knownPlans).some(([key, bytes]) => !/^[a-f0-9]{64}$/.test(key)
        || !Number.isSafeInteger(bytes) || bytes < 1 || parent.plans[key] !== bytes)
      || doc.knownPlanDigest !== restorationPlanDigest(doc.knownPlans)
      || !Number.isSafeInteger(doc.knownPlanBoundBytes) || doc.knownPlanBoundBytes !== Object.values(doc.knownPlans).reduce((a, b) => a + b, 0)
      || !Array.isArray(doc.fixedReports)
      || !doc.fixedReports.length || doc.fixedReports.length > RESTORATION_LIMITS.snapshots
      || new Set(doc.fixedReports).size !== doc.fixedReports.length || doc.fixedReports.some(report => !parent.fixedReports!.includes(report))
      || doc.reportDigest !== restorationReportDigest(doc.fixedReports) || !parent.fixedReports!.includes(doc.witnessReport)
      || !Number.isSafeInteger(doc.maxBytes) || doc.maxBytes < doc.measurementBoundBytes + doc.knownPlanBoundBytes || doc.maxBytes > CONTINUATION_LIMITS.bytes
      || !Number.isSafeInteger(doc.maxJobs) || doc.maxJobs < 1 || doc.maxJobs > CONTINUATION_LIMITS.jobs
      || !Number.isSafeInteger(doc.maxPerJobBytes) || doc.maxPerJobBytes < 1 || doc.maxPerJobBytes > HISTORICAL_LIMITS.bytesPerJob
      || !Number.isSafeInteger(doc.maxTotalBytes) || doc.maxTotalBytes !== original.reservedBytes + parent.approvedBytes!
      || doc.maxTotalBytes > HISTORICAL_LIMITS.totalBytes || doc.originalReservedBytes + doc.producerReservedBytes + doc.maxBytes > doc.maxTotalBytes
      || !Number.isSafeInteger(doc.reservedBytes) || doc.reservedBytes < 0 || doc.reservedBytes > doc.maxBytes
      || !Number.isSafeInteger(doc.reservedJobs) || doc.reservedJobs < 0 || doc.reservedJobs > doc.maxJobs) throw fail();
    const claim = (await read(this.db.doc(`metricsRestorationContinuationClaims/${lineage.id}`))).data();
    const approval = (await read(this.db.doc(`metricsRestorationContinuationApprovals/${this.id}`))).data();
    const measurement = (await read(this.db.doc(`metricsRestorationMeasurements/${doc.measurementId}`))).data();
    const seal = (await read(this.db.doc(`metricsRestorationMeasurementSeals/${doc.measurementId}`))).data();
    const bound = ['source','createdAt','expiresAt','dataAsOf','producerId','producerSource','producerPlanDigest','producerReportDigest',
      'producerReservedBytes','producerReservedJobs','originalId','originalSource','originalPlanDigest','originalReservedBytes','originalReservedJobs',
      'measurementId','measurementSource','measurementAllowedDigest','measurementDigest','measurementCount','measurementBoundBytes','knownPlanDigest','knownPlanBoundBytes','reportDigest','witnessReport','maxBytes','maxJobs','maxPerJobBytes','maxTotalBytes'] as const;
    if (!claim || claim.continuationId !== this.id || !approval || approval.continuationId !== this.id
      || bound.some(key => claim[key] !== doc[key] || approval[key] !== doc[key])
      || !measurement || measurement.phase !== 'closed' || measurement.source !== doc.measurementSource
      || measurement.producerId !== lineage.id || measurement.producerSource !== lineage.source || measurement.producerAsOf !== parent.asOf
      || measurement.producerPlanDigest !== parent.approvedPlanDigest || measurement.producerReportDigest !== parent.approvedReportDigest
      || measurement.allowedDigest !== doc.measurementAllowedDigest || measurement.reportDigest !== doc.reportDigest
      || !Array.isArray(measurement.allowedHashes) || measurement.allowedHashes.length !== doc.measurementCount
      || new Set(measurement.allowedHashes).size !== measurement.allowedHashes.length
      || measurement.allowedHashes.some((value: unknown) => typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
      || measurementHashDigest(measurement.allowedHashes) !== doc.measurementAllowedDigest
      || !Array.isArray(measurement.reports) || restorationReportDigest(measurement.reports) !== doc.reportDigest
      || measurement.witnessReport !== doc.witnessReport || measurement.attempted !== doc.measurementCount || measurement.maxDryRuns !== doc.measurementCount
      || !seal || seal.phase !== 'sealed' || seal.measurementId !== doc.measurementId || seal.source !== doc.measurementSource
      || seal.allowedDigest !== doc.measurementAllowedDigest || seal.measurementDigest !== doc.measurementDigest
      || seal.producerId !== lineage.id || seal.producerSource !== lineage.source || seal.reportDigest !== doc.reportDigest
      || seal.measuredCount !== doc.measurementCount || seal.measuredBoundBytes !== doc.measurementBoundBytes) throw fail();
    return { doc, lineage, original };
  }
  private permit() { return this.checked(ref => ref.get()); }
  async verifiedClosedIn(read: (ref: any) => Promise<any>) {
    const result = await this.checked(read); if (result.doc.phase !== 'closed') throw fail(); return result;
  }
  async isPreparing() { const { doc } = await this.permit(); return doc.phase === 'open' && doc.expiresAt > this.now(); }
  async expandedPreparing() { return this.isPreparing(); }
  async perJobCeiling() { const { doc } = await this.permit(); return doc.maxPerJobBytes; }
  async requireOpen(report: string) {
    const d = await this.permit(); if (d.doc.phase !== 'open' || d.doc.expiresAt <= this.now() || !d.doc.fixedReports.includes(report)) throw fail(); return d;
  }
  async witness() { const { doc } = await this.permit(); return this.producer.capturedWitness(doc.witnessReport); }
  /** Read-only adapter: a closed continuation can resolve only sealed prior jobs. */
  async closedDescriptor() {
    const { doc } = await this.permit();
    if (doc.phase !== 'closed') throw fail();
    const producer = await this.producer.closedDescriptor();
    return { ...producer, fixedReports: doc.fixedReports, witnessReport: doc.witnessReport, continuationId: this.id, continuationSource: this.source };
  }
  async capturedWitness(report: string) {
    const { doc } = await this.permit();
    if (doc.phase !== 'closed' || report !== doc.witnessReport) throw fail();
    return this.producer.capturedWitness(report);
  }
  async closedJob(request: Query) {
    const { doc } = await this.permit();
    if (doc.phase !== 'closed' || typeof request.query !== 'string' || request.params !== undefined || request.types !== undefined) throw fail();
    const query = freezeRestorationSql(request.query, doc.dataAsOf), prepared = { ...request, query };
    const { planHash } = this.identity(doc, query);
    try { return await this.producer.closedJob(prepared); }
    catch (error) { if (!(error instanceof ClosedJobMissingError)) throw error; }
    const snapshot = await this.ref().collection('reservations').doc(planHash).get();
    if (!snapshot.exists) throw new ClosedJobMissingError(planHash, undefined);
    const row = snapshot.data(), id = `metrics_${this.id}_${planHash}`;
    if (row?.jobId !== id || !Number.isSafeInteger(row.bytes) || row.bytes < 1 || row.bytes > doc.maxPerJobBytes) throw fail();
    return { id, bytes: row.bytes as number, query };
  }
  async prepare(request: Query) {
    const { doc } = await this.permit();
    if (doc.phase !== 'open' || doc.expiresAt <= this.now() || !currentLegacyReportKey() || typeof request.query !== 'string'
      || request.params !== undefined || request.types !== undefined) throw fail();
    return { ...request, query: freezeRestorationSql(request.query, doc.dataAsOf) };
  }
  private identity(doc: ContinuationDocument, query: string) {
    const scope = currentLegacyReportKey(), separator = scope?.indexOf(':') ?? -1;
    const cohortScope = scope?.slice(0, separator) ?? '', report = scope?.slice(separator + 1) ?? '';
    if (separator < 0 || !/^(?:[a-f0-9]{64})?$/.test(cohortScope) || !doc.fixedReports.includes(report)
      || !/^(?:SELECT|WITH)\b/i.test(query.trim())) throw fail();
    const planHash = hash(JSON.stringify({ schema: 1, source: this.source, cohortScope,
      project: 'hushh-ai-prod', location: 'US', asOf: doc.dataAsOf, query }));
    return { planHash, report };
  }
  async existing(request: Query): Promise<RestorationGrant | undefined> {
    const { doc } = await this.permit();
    if (doc.phase !== 'open' || doc.expiresAt <= this.now() || typeof request.query !== 'string') throw fail();
    const { planHash, report } = this.identity(doc, request.query);
    try {
      const old = await this.producer.closedJob(request), parts = /^metrics_(restore_[a-f0-9]{16})_([a-f0-9]{64})$/.exec(old.id);
      if (!parts || old.query !== request.query) throw fail();
      return { permitId: this.id, planHash, id: old.id, bytes: old.bytes, report,
        reuse: { key: '', priorPermitId: parts[1], priorPlanHash: parts[2] } };
    } catch (error) { if (error instanceof ClosedJobMissingError) return undefined; throw error; }
  }
  async admit(request: Query, estimated: number): Promise<RestorationGrant> {
    const { doc } = await this.permit();
    if (doc.phase !== 'open' || doc.expiresAt <= this.now() || typeof request.query !== 'string'
      || request.params !== undefined || request.types !== undefined || !Number.isSafeInteger(estimated) || estimated < 0) throw fail();
    const { planHash, report } = this.identity(doc, request.query), unit = 10 * 1024 ** 2;
    const bytes = Math.max(unit, Math.ceil(estimated / unit) * unit + unit);
    if (!Number.isSafeInteger(bytes) || bytes > doc.maxPerJobBytes) throw fail();
    const id = `metrics_${this.id}_${planHash}`, existing = (await this.ref().collection('reservations').doc(planHash).get()).data();
    if (existing && (existing.jobId !== id || !Number.isSafeInteger(existing.bytes) || existing.bytes < bytes || existing.bytes > doc.maxPerJobBytes)) throw fail();
    return { permitId: this.id, planHash, id, bytes: existing?.bytes ?? bytes, report };
  }
  async reserve(grant: RestorationGrant) {
    if (grant.permitId !== this.id || !/^[a-f0-9]{64}$/.test(grant.planHash) || !grant.report
      || !Number.isSafeInteger(grant.bytes) || grant.bytes < 1) throw fail();
    await this.db.runTransaction(async tx => {
      const { doc, lineage } = await this.checked(ref => tx.get(ref));
      if (doc.phase !== 'open' || doc.expiresAt <= this.now() || !doc.fixedReports.includes(grant.report!) || grant.bytes > doc.maxPerJobBytes) throw fail();
      if (grant.reuse) {
        const priorId = grant.reuse.priorPermitId, priorHash = grant.reuse.priorPlanHash;
        if (![lineage.id, lineage.original.id].includes(priorId ?? '') || !/^[a-f0-9]{64}$/.test(priorHash)
          || grant.id !== `metrics_${priorId}_${priorHash}`) throw fail();
        const old = (await tx.get(this.db.doc(`metricsRestorationPermits/${priorId}/reservations/${priorHash}`))).data();
        if (old?.jobId !== grant.id || old.bytes !== grant.bytes) throw fail();
        return;
      }
      if (grant.id !== `metrics_${this.id}_${grant.planHash}`) throw fail();
      const reservation = this.ref().collection('reservations').doc(grant.planHash), existing = await tx.get(reservation);
      if (existing.exists) { if (existing.data()?.bytes !== grant.bytes || existing.data()?.jobId !== grant.id) throw fail(); return; }
      if (doc.reservedJobs + 1 > doc.maxJobs || doc.reservedBytes + grant.bytes > doc.maxBytes
        || doc.originalReservedBytes + doc.producerReservedBytes + doc.reservedBytes + grant.bytes > doc.maxTotalBytes) throw fail();
      tx.update(this.ref(), { reservedBytes: doc.reservedBytes + grant.bytes, reservedJobs: doc.reservedJobs + 1 });
      tx.create(reservation, { bytes: grant.bytes, jobId: grant.id, reservedAt: this.now() });
    });
  }
  async save(report: string, key: string, value: { status: number; body: unknown }, jobs: JobProof[], cohort?: CustomerCohort) {
    const { doc } = await this.requireOpen(report), json = JSON.stringify(value), computedAt = this.now();
    if (value.status !== 200 || !value.body || Buffer.byteLength(json) > RESTORATION_LIMITS.snapshotBytes || !jobs.length || jobs.length > 500
      || new Set(jobs.map(job => job.id)).size !== jobs.length || jobs.some(job => !/^metrics_restore_[a-f0-9]{16}_[a-f0-9]{64}$/.test(job.id)
        || !Number.isSafeInteger(job.endedAt) || job.endedAt <= 0 || job.endedAt > computedAt + 10_000)) throw fail();
    const witness = cohort ? cohortSnapshotWitness(cohort) : null;
    if (cohort ? !witness || key !== `${cohort.cacheKey}:${report}` : key !== `:${report}`) throw fail();
    const reportHash = hash(report), keyHash = hash(key), target = this.ref().collection('snapshots').doc(keyHash), indexRef = this.ref().collection('snapshotIndex').doc(reportHash);
    await this.db.runTransaction(async tx => {
      const { doc: live } = await this.checked(ref => tx.get(ref)), existing = await tx.get(target), index = await tx.get(indexRef);
      if (live.phase !== 'open' || live.expiresAt <= this.now() || !live.fixedReports.includes(report)) throw fail();
      if (existing.exists) throw { status: 409, body: { error: 'A continuation publication already exists.' } };
      const previous = index.exists ? index.data() : null, keys = previous?.keys ?? [];
      if (!Array.isArray(keys) || keys.length >= RESTORATION_LIMITS.snapshots || (previous && (previous.source !== this.source || previous.reportHash !== reportHash))) throw fail();
      tx.create(target, { schema: 1, source: this.source, producerId: doc.producerId, producerSource: doc.producerSource,
        dataAsOf: doc.dataAsOf, reportHash, keyHash, computedAt, nonWarehouseFreshness: 'unknown', jobs, json, ...(witness ? { witness } : {}) });
      const next = { source: this.source, reportHash, keys: [...keys, keyHash] }; if (index.exists) tx.update(indexRef, next); else tx.create(indexRef, next);
    });
    return computedAt;
  }
  async read(report: string, cohort: CustomerCohort | null) {
    const value = await this.readForComparison(report, cohort); if (!value) return null;
    const { witness: _witness, ...publication } = value; return publication;
  }
  /** Internal-only witness is used to compare two already-authorized publications. */
  async readForComparison(report: string, cohort: CustomerCohort | null) {
    const { doc } = await this.permit(); if (doc.phase !== 'closed' || !doc.fixedReports.includes(report)) return null;
    const reportHash = hash(report), index = (await this.ref().collection('snapshotIndex').doc(reportHash).get()).data();
    if (!index || index.source !== this.source || index.reportHash !== reportHash || !Array.isArray(index.keys) || index.keys.length > RESTORATION_LIMITS.snapshots) return null;
    for (const keyHash of [...index.keys].reverse()) {
      if (typeof keyHash !== 'string' || !/^[a-f0-9]{64}$/.test(keyHash)) return null;
      const row = (await this.ref().collection('snapshots').doc(keyHash).get()).data();
      if (!row || row.schema !== 1 || row.source !== this.source || row.producerId !== doc.producerId || row.producerSource !== doc.producerSource
        || row.dataAsOf !== doc.dataAsOf || row.nonWarehouseFreshness !== 'unknown' || row.reportHash !== reportHash || row.keyHash !== keyHash
        || !Number.isSafeInteger(row.computedAt) || row.computedAt < doc.createdAt || row.computedAt > this.now()
        || this.now() - Date.parse(doc.dataAsOf) > RESTORATION_LIMITS.snapshotMs || typeof row.json !== 'string'
        || Buffer.byteLength(row.json) > RESTORATION_LIMITS.snapshotBytes || !Array.isArray(row.jobs) || !row.jobs.length || row.jobs.length > 500
        || new Set(row.jobs.map((job: JobProof) => job.id)).size !== row.jobs.length
        || row.jobs.some((job: JobProof) => !/^metrics_restore_[a-f0-9]{16}_[a-f0-9]{64}$/.test(job.id)
          || !Number.isSafeInteger(job.endedAt) || job.endedAt <= 0 || job.endedAt > row.computedAt + 10_000)) continue;
      if (cohort ? !row.witness || !cohortMatchesSnapshotWitness(cohort, row.witness as CohortSnapshotWitness) : row.witness || keyHash !== hash(`:${report}`)) continue;
      const value = JSON.parse(row.json); if (value?.status !== 200 || !value.body) continue;
      const times = row.jobs.map((job: JobProof) => job.endedAt as number);
      return { value, at: Date.parse(doc.dataAsOf), computedAt: row.computedAt, warehouseFrom: Math.min(...times), warehouseThrough: Math.max(...times),
        ...(row.witness ? { cohortAsOf: row.witness.asOf as string, witness: row.witness as CohortSnapshotWitness } : {}) };
    }
    return null;
  }
}
let cached: { key: string; promise: Promise<LegacyContinuation> } | undefined;
export async function legacyContinuation(): Promise<LegacyContinuation | null> {
  const id = process.env.METRICS_CONTINUATION_ID, source = process.env.METRICS_CONTINUATION_SOURCE;
  if (!id && !source) return null;
  if (!/^restore_[a-f0-9]{16}$/.test(id ?? '') || !/^[a-f0-9]{40}$/.test(source ?? '')) throw fail();
  const producer = await legacyRestoration(); if (!producer) throw fail();
  const key = `${id}:${source}`;
  if (cached?.key !== key) cached = { key, promise: nativeDatabase().then(db => new LegacyContinuation(db, id!, source!, producer)) };
  return cached.promise;
}
