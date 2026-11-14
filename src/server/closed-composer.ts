import { createHash } from 'node:crypto';
import type { Firestore } from '@google-cloud/firestore';
import { cohortMatchesSnapshotWitness, cohortSnapshotWitness, type CustomerCohort, type CohortSnapshotWitness } from './one-customer-cohort';
import { legacyRestoration, nativeDatabase, RESTORATION_LIMITS, restorationReportDigest, type LegacyRestoration } from './legacy-restoration';

type Database = Pick<Firestore, 'doc' | 'runTransaction'>;
type CompositionDocument = { source: string; producerId: string; producerSource: string; producerAsOf: string;
  producerPlanDigest: string; producerReportDigest: string; reports: string[]; reportDigest: string; witnessReport: string;
  createdAt: number; expiresAt: number; phase: 'open' | 'closed' };
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const fail = () => new Error('Closed-job composition is unavailable.');

/** Separately named write-once results; no permission to submit or reserve jobs. */
export class ClosedComposer {
  constructor(private db: Database, private id: string, private source: string, private producer: LegacyRestoration, private now = Date.now) {
    if (!/^composer_[a-f0-9]{16}$/.test(id) || !/^[a-f0-9]{40}$/.test(source)) throw fail();
  }
  private ref() { return this.db.doc(`metricsRestorationComposers/${this.id}`); }
  async descriptor() {
    const producer = await this.producer.closedDescriptor();
    const doc = (await this.ref().get()).data() as CompositionDocument;
    if (!doc || doc.source !== this.source || doc.producerId !== producer.id || doc.producerSource !== producer.source
      || doc.producerAsOf !== producer.asOf || doc.producerPlanDigest !== producer.approvedPlanDigest
      || doc.producerReportDigest !== producer.approvedReportDigest || !['open', 'closed'].includes(doc.phase)
      || !Number.isSafeInteger(doc.createdAt) || !Number.isSafeInteger(doc.expiresAt) || doc.createdAt > this.now() + 10_000
      || doc.expiresAt <= doc.createdAt || doc.expiresAt - doc.createdAt > 60 * 60_000
      || !Array.isArray(doc.reports) || doc.reports.length < 1 || doc.reports.length > RESTORATION_LIMITS.snapshots
      || new Set(doc.reports).size !== doc.reports.length || doc.reports.some(report => !producer.fixedReports.includes(report))
      || doc.reportDigest !== restorationReportDigest(doc.reports) || !producer.fixedReports.includes(doc.witnessReport)) throw fail();
    return { doc, producer };
  }
  async requireOpen(report: string) {
    const d = await this.descriptor();
    if (d.doc.phase !== 'open' || d.doc.expiresAt <= this.now() || !d.doc.reports.includes(report)) throw fail();
    return d;
  }
  async witness() { const { doc } = await this.descriptor(); return this.producer.capturedWitness(doc.witnessReport); }
  async save(report: string, key: string, value: { status: number; body: unknown }, jobs: string[], cohort?: CustomerCohort) {
    const { doc, producer } = await this.requireOpen(report), json = JSON.stringify(value), computedAt = this.now();
    if (value.status !== 200 || !value.body || Buffer.byteLength(json) > RESTORATION_LIMITS.snapshotBytes
      || !Array.isArray(jobs) || jobs.length < 1 || jobs.length > 500 || new Set(jobs).size !== jobs.length
      || jobs.some(id => !/^metrics_restore_[a-f0-9]{16}_[a-f0-9]{64}$/.test(id))) throw fail();
    const witness = cohort ? cohortSnapshotWitness(cohort) : null;
    if (cohort && (!witness || key !== `${cohort.cacheKey}:${report}`)) throw fail();
    if (!cohort && key !== `:${report}`) throw fail();
    const reportHash = hash(report), keyHash = hash(key), ref = this.ref(), target = ref.collection('snapshots').doc(keyHash);
    const indexRef = ref.collection('snapshotIndex').doc(reportHash), producerRef = this.db.doc(`metricsRestorationPermits/${producer.id}`);
    await this.db.runTransaction(async tx => {
      const live = (await tx.get(ref)).data() as CompositionDocument, producerRow = (await tx.get(producerRef)).data();
      const existing = await tx.get(target), index = await tx.get(indexRef);
      if (!live || live.phase !== 'open' || live.expiresAt <= this.now() || live.source !== doc.source
        || live.reportDigest !== doc.reportDigest || live.producerAsOf !== doc.producerAsOf
        || producerRow?.phase !== 'closed' || producerRow.source !== producer.source || producerRow.asOf !== producer.asOf
        || producerRow.approvedPlanDigest !== producer.approvedPlanDigest || producerRow.approvedReportDigest !== producer.approvedReportDigest) throw fail();
      if (existing.exists) throw { status: 409, body: { error: 'A composed publication already exists.' } };
      const previous = index.exists ? index.data() : null, keys = previous?.keys ?? [];
      if (!Array.isArray(keys) || keys.length >= RESTORATION_LIMITS.snapshots
        || (previous && (previous.source !== this.source || previous.reportHash !== reportHash))) throw fail();
      tx.create(target, { schema: 1, source: this.source, producerId: producer.id, producerSource: producer.source,
        producerAsOf: producer.asOf, reportHash, keyHash, computedAt, nonWarehouseFreshness: 'unknown', json, jobs, ...(witness ? { witness } : {}) });
      const next = { source: this.source, reportHash, keys: [...keys, keyHash] };
      if (index.exists) tx.update(indexRef, next); else tx.create(indexRef, next);
    });
    return computedAt;
  }
  async read(report: string, cohort: CustomerCohort | null) {
    const { doc, producer } = await this.descriptor(); if (doc.phase !== 'closed' || !doc.reports.includes(report)) return null;
    const reportHash = hash(report), index = (await this.ref().collection('snapshotIndex').doc(reportHash).get()).data();
    if (!index || index.source !== this.source || index.reportHash !== reportHash || !Array.isArray(index.keys)
      || index.keys.length > RESTORATION_LIMITS.snapshots) return null;
    for (const keyHash of [...index.keys].reverse()) {
      if (typeof keyHash !== 'string' || !/^[a-f0-9]{64}$/.test(keyHash)) return null;
      const row = (await this.ref().collection('snapshots').doc(keyHash).get()).data();
      if (!row || row.schema !== 1 || row.source !== this.source || row.producerId !== producer.id || row.producerSource !== producer.source
        || row.producerAsOf !== producer.asOf || row.nonWarehouseFreshness !== 'unknown' || row.reportHash !== reportHash || row.keyHash !== keyHash
        || !Number.isSafeInteger(row.computedAt) || row.computedAt < doc.createdAt || row.computedAt > this.now()
        || this.now() - producer.createdAt > RESTORATION_LIMITS.snapshotMs || typeof row.json !== 'string'
        || Buffer.byteLength(row.json) > RESTORATION_LIMITS.snapshotBytes) continue;
      if (cohort ? !row.witness || !cohortMatchesSnapshotWitness(cohort, row.witness as CohortSnapshotWitness)
        : row.witness || keyHash !== hash(`:${report}`)) continue;
      const value = JSON.parse(row.json); if (value?.status !== 200 || !value.body) continue;
      return { value, at: producer.createdAt, computedAt: row.computedAt, ...(row.witness ? { cohortAsOf: row.witness.asOf as string } : {}) };
    }
    return null;
  }
}

let cached: { key: string; promise: Promise<ClosedComposer> } | undefined;
export async function closedComposer(): Promise<ClosedComposer | null> {
  const id = process.env.METRICS_COMPOSER_ID, source = process.env.METRICS_COMPOSER_SOURCE;
  if (!id && !source) return null;
  if (!/^composer_[a-f0-9]{16}$/.test(id ?? '') || !/^[a-f0-9]{40}$/.test(source ?? '')) throw fail();
  const producer = await legacyRestoration(); if (!producer) throw fail();
  const key = `${id}:${source}`;
  if (cached?.key !== key) cached = { key, promise: nativeDatabase().then(db => new ClosedComposer(db, id!, source!, producer)) };
  return cached.promise;
}
