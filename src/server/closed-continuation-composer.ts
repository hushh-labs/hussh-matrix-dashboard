import { createHash } from 'node:crypto';
import type { Firestore } from '@google-cloud/firestore';
import { cohortMatchesSnapshotWitness, cohortSnapshotWitness, type CustomerCohort, type CohortSnapshotWitness } from './one-customer-cohort';
import { legacyContinuation, type LegacyContinuation } from './legacy-continuation';
import { nativeDatabase, RESTORATION_LIMITS, restorationReportDigest } from './legacy-restoration';

type Database = Pick<Firestore, 'doc' | 'runTransaction'>;
type JobProof = { id: string; endedAt: number };
type ComposerDocument = { source: string; continuationId: string; continuationSource: string; producerId: string;
  producerSource: string; producerAsOf: string; producerPlanDigest: string; producerReportDigest: string;
  reports: string[]; reportDigest: string; witnessReport: string; createdAt: number; expiresAt: number; phase: 'open' | 'closed' };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const fail = () => new Error('Closed continuation composition is unavailable.');

/** Independent write-once publications from exact completed jobs; never admits new work. */
export class ClosedContinuationComposer {
  constructor(private db: Database, private id: string, private source: string, private continuation: LegacyContinuation, private now = Date.now) {
    if (!/^composer_[a-f0-9]{16}$/.test(id) || !/^[a-f0-9]{40}$/.test(source)) throw fail();
  }
  private ref() { return this.db.doc(`metricsClosedContinuationComposers/${this.id}`); }
  async descriptor() {
    const producer = await this.continuation.closedDescriptor(), doc = (await this.ref().get()).data() as ComposerDocument;
    if (!doc || doc.source !== this.source || doc.continuationId !== producer.continuationId || doc.continuationSource !== producer.continuationSource
      || doc.producerId !== producer.id || doc.producerSource !== producer.source || doc.producerAsOf !== producer.asOf
      || doc.producerPlanDigest !== producer.approvedPlanDigest || doc.producerReportDigest !== producer.approvedReportDigest
      || !['open', 'closed'].includes(doc.phase) || !Number.isSafeInteger(doc.createdAt) || !Number.isSafeInteger(doc.expiresAt)
      || doc.createdAt > this.now() + 10_000 || doc.expiresAt <= doc.createdAt || doc.expiresAt - doc.createdAt > RESTORATION_LIMITS.windowMs
      || !Array.isArray(doc.reports) || !doc.reports.length || doc.reports.length > RESTORATION_LIMITS.snapshots
      || new Set(doc.reports).size !== doc.reports.length || doc.reports.some(report => !producer.fixedReports.includes(report))
      || doc.reportDigest !== restorationReportDigest(doc.reports) || doc.witnessReport !== producer.witnessReport) throw fail();
    return { doc, producer };
  }
  async requireOpen(report: string) {
    const value = await this.descriptor();
    if (value.doc.phase !== 'open' || value.doc.expiresAt <= this.now() || !value.doc.reports.includes(report)) throw fail();
    return value;
  }
  async witness() { const { doc } = await this.descriptor(); return this.continuation.capturedWitness(doc.witnessReport); }
  async save(report: string, key: string, value: { status: number; body: unknown }, jobs: JobProof[], cohort?: CustomerCohort) {
    const { doc, producer } = await this.requireOpen(report), json = JSON.stringify(value), computedAt = this.now();
    if (value.status !== 200 || !value.body || Buffer.byteLength(json) > RESTORATION_LIMITS.snapshotBytes || !jobs.length || jobs.length > 500
      || new Set(jobs.map(job => job.id)).size !== jobs.length || jobs.some(job => !/^metrics_restore_[a-f0-9]{16}_[a-f0-9]{64}$/.test(job.id)
        || !Number.isSafeInteger(job.endedAt) || job.endedAt <= 0 || job.endedAt > computedAt + 10_000)) throw fail();
    const witness = cohort ? cohortSnapshotWitness(cohort) : null;
    if (cohort ? !witness || key !== `${cohort.cacheKey}:${report}` : key !== `:${report}`) throw fail();
    const reportHash = hash(report), keyHash = hash(key), ref = this.ref(), target = ref.collection('snapshots').doc(keyHash), indexRef = ref.collection('snapshotIndex').doc(reportHash);
    await this.db.runTransaction(async tx => {
      const lineage = await this.continuation.verifiedClosedIn(ref => tx.get(ref));
      const live = (await tx.get(ref)).data() as ComposerDocument, existing = await tx.get(target), index = await tx.get(indexRef);
      if (!live || live.phase !== 'open' || live.expiresAt <= this.now() || live.source !== doc.source || live.reportDigest !== doc.reportDigest
        || lineage.doc.source !== producer.continuationSource || lineage.doc.producerId !== producer.id
        || live.continuationId !== producer.continuationId || live.continuationSource !== producer.continuationSource
        || live.producerId !== producer.id || live.producerSource !== producer.source || live.producerAsOf !== producer.asOf
        || live.producerPlanDigest !== producer.approvedPlanDigest || live.producerReportDigest !== producer.approvedReportDigest
        || live.witnessReport !== doc.witnessReport || live.createdAt !== doc.createdAt || live.expiresAt !== doc.expiresAt
        || !Array.isArray(live.reports) || restorationReportDigest(live.reports) !== doc.reportDigest || !live.reports.includes(report)) throw fail();
      if (existing.exists) throw { status: 409, body: { error: 'A composed publication already exists.' } };
      const previous = index.exists ? index.data() : null, keys = previous?.keys ?? [];
      if (!Array.isArray(keys) || keys.length >= RESTORATION_LIMITS.snapshots || (previous && (previous.source !== this.source || previous.reportHash !== reportHash))) throw fail();
      tx.create(target, { schema: 1, source: this.source, continuationId: producer.continuationId, continuationSource: producer.continuationSource,
        producerId: producer.id, producerSource: producer.source, producerAsOf: producer.asOf, reportHash, keyHash, computedAt,
        nonWarehouseFreshness: 'unknown', jobs, json, ...(witness ? { witness } : {}) });
      const next = { source: this.source, reportHash, keys: [...keys, keyHash] }; if (index.exists) tx.update(indexRef, next); else tx.create(indexRef, next);
    });
    return computedAt;
  }
  async read(report: string, cohort: CustomerCohort | null) {
    const { doc, producer } = await this.descriptor(); if (doc.phase !== 'closed' || !doc.reports.includes(report)) return null;
    const reportHash = hash(report), index = (await this.ref().collection('snapshotIndex').doc(reportHash).get()).data();
    if (!index || index.source !== this.source || index.reportHash !== reportHash || !Array.isArray(index.keys) || index.keys.length > RESTORATION_LIMITS.snapshots) return null;
    for (const keyHash of [...index.keys].reverse()) {
      if (typeof keyHash !== 'string' || !/^[a-f0-9]{64}$/.test(keyHash)) return null;
      const row = (await this.ref().collection('snapshots').doc(keyHash).get()).data();
      if (!row || row.schema !== 1 || row.source !== this.source || row.continuationId !== producer.continuationId || row.continuationSource !== producer.continuationSource
        || row.producerId !== producer.id || row.producerSource !== producer.source || row.producerAsOf !== producer.asOf || row.nonWarehouseFreshness !== 'unknown'
        || row.reportHash !== reportHash || row.keyHash !== keyHash || !Number.isSafeInteger(row.computedAt) || row.computedAt < doc.createdAt
        || row.computedAt > this.now() || this.now() - producer.createdAt > RESTORATION_LIMITS.snapshotMs || typeof row.json !== 'string'
        || Buffer.byteLength(row.json) > RESTORATION_LIMITS.snapshotBytes || !Array.isArray(row.jobs) || !row.jobs.length || row.jobs.length > 500
        || new Set(row.jobs.map((job: JobProof) => job.id)).size !== row.jobs.length || row.jobs.some((job: JobProof) => !/^metrics_restore_[a-f0-9]{16}_[a-f0-9]{64}$/.test(job.id)
          || !Number.isSafeInteger(job.endedAt) || job.endedAt <= 0 || job.endedAt > row.computedAt + 10_000)) continue;
      if (cohort ? !row.witness || !cohortMatchesSnapshotWitness(cohort, row.witness as CohortSnapshotWitness) : row.witness || keyHash !== hash(`:${report}`)) continue;
      const value = JSON.parse(row.json); if (value?.status !== 200 || !value.body) continue;
      const times = row.jobs.map((job: JobProof) => job.endedAt);
      return { value, at: producer.createdAt, computedAt: row.computedAt, warehouseFrom: Math.min(...times), warehouseThrough: Math.max(...times),
        ...(row.witness ? { cohortAsOf: row.witness.asOf as string } : {}) };
    }
    return null;
  }
}
let cached: { key: string; promise: Promise<ClosedContinuationComposer> } | undefined;
export async function closedContinuationComposer(): Promise<ClosedContinuationComposer | null> {
  const id = process.env.METRICS_CLOSED_CONTINUATION_COMPOSER_ID, source = process.env.METRICS_CLOSED_CONTINUATION_COMPOSER_SOURCE;
  if (!id && !source) return null;
  if (!/^composer_[a-f0-9]{16}$/.test(id ?? '') || !/^[a-f0-9]{40}$/.test(source ?? '')) throw fail();
  const continuation = await legacyContinuation(); if (!continuation) throw fail();
  const key = `${id}:${source}`;
  if (cached?.key !== key) cached = { key, promise: nativeDatabase().then(db => new ClosedContinuationComposer(db, id!, source!, continuation)) };
  return cached.promise;
}
