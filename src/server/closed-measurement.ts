import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import type { Firestore } from '@google-cloud/firestore';
import { legacyRestoration, nativeDatabase, restorationReportDigest, type LegacyRestoration } from './legacy-restoration';

type Database = Pick<Firestore, 'doc' | 'runTransaction'>;
type MeasurementDocument = { source: string; producerId: string; producerSource: string; producerAsOf: string;
  producerPlanDigest: string; producerReportDigest: string; reports: string[]; reportDigest: string; witnessReport: string;
  allowedHashes: string[]; allowedDigest: string; maxDryRuns: number; attempted: number; createdAt: number; expiresAt: number; phase: 'open' | 'closed' };
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export const measurementHashDigest = (hashes: string[]) => hash(JSON.stringify([...hashes].sort()));
const fail = () => new Error('Closed-job measurement is unavailable.');
const context = new AsyncLocalStorage<{ measurement: ClosedMeasurement; report: string }>();
export const currentClosedMeasurement = () => context.getStore();
export const withClosedMeasurement = <T>(measurement: ClosedMeasurement, report: string, load: () => Promise<T>) => context.run({ measurement, report }, load);

/** Bounded dry-run intents only. This record never authorizes a paid query. */
export class ClosedMeasurement {
  constructor(private db: Database, private id: string, private source: string, private producer: LegacyRestoration, private now = Date.now) {
    if (!/^measure_[a-f0-9]{16}$/.test(id) || !/^[a-f0-9]{40}$/.test(source)) throw fail();
  }
  private ref() { return this.db.doc(`metricsRestorationMeasurements/${this.id}`); }
  async descriptor() {
    const producer = await this.producer.closedDescriptor();
    const doc = (await this.ref().get()).data() as MeasurementDocument;
    if (!doc || doc.source !== this.source || doc.producerId !== producer.id || doc.producerSource !== producer.source
      || doc.producerAsOf !== producer.asOf || doc.producerPlanDigest !== producer.approvedPlanDigest
      || doc.producerReportDigest !== producer.approvedReportDigest || !['open', 'closed'].includes(doc.phase)
      || !Number.isSafeInteger(doc.createdAt) || !Number.isSafeInteger(doc.expiresAt) || doc.createdAt > this.now() + 10_000
      || doc.expiresAt <= doc.createdAt || doc.expiresAt - doc.createdAt > 60 * 60_000
      || !Array.isArray(doc.reports) || !doc.reports.length || doc.reports.length > 32
      || new Set(doc.reports).size !== doc.reports.length || doc.reports.some(report => !producer.fixedReports.includes(report))
      || doc.reportDigest !== restorationReportDigest(doc.reports) || !producer.fixedReports.includes(doc.witnessReport)
      || !Array.isArray(doc.allowedHashes) || !doc.allowedHashes.length || doc.allowedHashes.length > 200
      || new Set(doc.allowedHashes).size !== doc.allowedHashes.length || doc.allowedHashes.some(value => !/^[a-f0-9]{64}$/.test(value))
      || doc.allowedDigest !== measurementHashDigest(doc.allowedHashes) || !Number.isSafeInteger(doc.maxDryRuns)
      || doc.maxDryRuns < 1 || doc.maxDryRuns > doc.allowedHashes.length || !Number.isSafeInteger(doc.attempted)
      || doc.attempted < 0 || doc.attempted > doc.maxDryRuns) throw fail();
    return { doc, producer };
  }
  async requireOpen(report: string) {
    const d = await this.descriptor();
    if (d.doc.phase !== 'open' || d.doc.expiresAt <= this.now() || !d.doc.reports.includes(report)) throw fail();
    return d;
  }
  async witness() { const { doc } = await this.descriptor(); return this.producer.capturedWitness(doc.witnessReport); }
  async claim(report: string, planHash: string) {
    const { doc, producer } = await this.requireOpen(report);
    if (!doc.allowedHashes.includes(planHash)) throw fail();
    const ref = this.ref(), attempt = ref.collection('attempts').doc(planHash), producerRef = this.db.doc(`metricsRestorationPermits/${producer.id}`);
    return this.db.runTransaction(async tx => {
      const live = (await tx.get(ref)).data() as MeasurementDocument, prior = await tx.get(attempt), parent = (await tx.get(producerRef)).data();
      if (!live || live.phase !== 'open' || live.expiresAt <= this.now() || live.source !== doc.source
        || live.allowedDigest !== doc.allowedDigest || live.reportDigest !== doc.reportDigest || !live.allowedHashes.includes(planHash)
        || !live.reports.includes(report) || parent?.phase !== 'closed' || parent.source !== producer.source
        || parent.asOf !== producer.asOf || parent.approvedPlanDigest !== producer.approvedPlanDigest) throw fail();
      // An uncertain intent is never replayed. A finished estimate can be reused.
      if (prior.exists) return false;
      if (!Number.isSafeInteger(live.attempted) || live.attempted >= live.maxDryRuns) throw fail();
      tx.update(ref, { attempted: live.attempted + 1 });
      tx.create(attempt, { state: 'pending', planHash, startedAt: this.now() });
      return true;
    });
  }
  async finish(planHash: string, outcome: { processed: number; bound: number; referenceDigest: string; minimumUnits: number } | null) {
    const ref = this.ref(), attempt = ref.collection('attempts').doc(planHash);
    await this.db.runTransaction(async tx => {
      const doc = (await tx.get(ref)).data() as MeasurementDocument, snapshot = await tx.get(attempt), row = snapshot.data();
      if (!doc || doc.phase !== 'open' || doc.expiresAt <= this.now() || doc.source !== this.source || !snapshot.exists
        || row.state !== 'pending' || row.planHash !== planHash) throw fail();
      if (outcome && (!Number.isSafeInteger(outcome.processed) || outcome.processed < 0 || !Number.isSafeInteger(outcome.bound)
        || outcome.bound < 1 || !/^[a-f0-9]{64}$/.test(outcome.referenceDigest) || !Number.isSafeInteger(outcome.minimumUnits)
        || outcome.minimumUnits < 0 || outcome.minimumUnits > 10_000)) throw fail();
      tx.update(attempt, { state: outcome ? 'measured' : 'failed', finishedAt: this.now(), ...(outcome ?? {}) });
    });
  }
}
let cached: { key: string; promise: Promise<ClosedMeasurement> } | undefined;
export async function closedMeasurement(): Promise<ClosedMeasurement | null> {
  const id = process.env.METRICS_MEASUREMENT_ID, source = process.env.METRICS_MEASUREMENT_SOURCE;
  if (!id && !source) return null;
  if (!/^measure_[a-f0-9]{16}$/.test(id ?? '') || !/^[a-f0-9]{40}$/.test(source ?? '')) throw fail();
  const producer = await legacyRestoration(); if (!producer) throw fail();
  const key = `${id}:${source}`;
  if (cached?.key !== key) cached = { key, promise: nativeDatabase().then(db => new ClosedMeasurement(db, id!, source!, producer)) };
  return cached.promise;
}
