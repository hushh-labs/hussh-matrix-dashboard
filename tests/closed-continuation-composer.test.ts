import { expect, it } from 'vitest';
import type { Firestore } from '@google-cloud/firestore';
import { ClosedContinuationComposer } from '../src/server/closed-continuation-composer';
import type { LegacyContinuation } from '../src/server/legacy-continuation';
import { restorationReportDigest } from '../src/server/legacy-restoration';

class Database {
  values = new Map<string, any>();
  doc(path: string): any { return { path, get: async () => this.snapshot(path), collection: (name: string) => ({ doc: (id: string) => this.doc(`${path}/${name}/${id}`) }) }; }
  snapshot(path: string) { return { exists: this.values.has(path), data: () => this.values.get(path) }; }
  async runTransaction<T>(load: (tx: any) => Promise<T>) {
    const writes = new Map<string, any>();
    const value = await load({ get: async (ref: any) => this.snapshot(ref.path),
      create: (ref: any, row: any) => { if (this.values.has(ref.path)) throw new Error('exists'); writes.set(ref.path, row); },
      update: (ref: any, row: any) => writes.set(ref.path, { ...this.values.get(ref.path), ...row }) });
    for (const [path, row] of writes) this.values.set(path, row); return value;
  }
  native() { return this as unknown as Pick<Firestore, 'doc' | 'runTransaction'>; }
}
const now = Date.parse('2026-11-15T00:00:00Z'), source = 'a'.repeat(40), id = 'composer_1234567890abcdef';
const report = '/api/analytics/all?view=overview', path = `metricsClosedContinuationComposers/${id}`;
function fixture() {
  const db = new Database(), producer = { id: 'restore_1111111111111111', source: 'b'.repeat(40), asOf: '2026-11-14T21:34:55.606Z',
    createdAt: Date.parse('2026-11-14T21:34:55.606Z'), approvedPlanDigest: 'c'.repeat(64), approvedReportDigest: 'd'.repeat(64),
    fixedReports: [report], witnessReport: '/api/analytics/all?view=one', continuationId: 'restore_2222222222222222', continuationSource: 'e'.repeat(40) };
  let phase = 'closed';
  const continuation = { closedDescriptor: async () => { if (phase !== 'closed') throw new Error('open'); return producer; },
    verifiedClosedIn: async () => { if (phase !== 'closed') throw new Error('open'); return { doc: { source: producer.continuationSource, producerId: producer.id } }; },
    capturedWitness: async () => null } as unknown as LegacyContinuation;
  const doc = { source, continuationId: producer.continuationId, continuationSource: producer.continuationSource,
    producerId: producer.id, producerSource: producer.source, producerAsOf: producer.asOf, producerPlanDigest: producer.approvedPlanDigest,
    producerReportDigest: producer.approvedReportDigest, reports: [report], reportDigest: restorationReportDigest([report]),
    witnessReport: producer.witnessReport, createdAt: now, expiresAt: now + 600000, phase: 'open' };
  db.values.set(path, doc);
  return { db, doc, producer, composer: new ClosedContinuationComposer(db.native(), id, source, continuation, () => now),
    setPhase: (value: string) => { phase = value; } };
}
it('writes once from a closed lineage and retains original period and actual mixed job completion times', async () => {
  const f = fixture(), jobs = [{ id: `metrics_${f.producer.continuationId}_${'f'.repeat(64)}`, endedAt: now - 1 }], value = { status: 200, body: { count: 7 } };
  await f.composer.save(report, `:${report}`, value, jobs);
  await expect(f.composer.save(report, `:${report}`, value, jobs)).rejects.toMatchObject({ status: 409 });
  expect(await f.composer.read(report, null)).toBeNull(); f.doc.phase = 'closed';
  expect(await f.composer.read(report, null)).toMatchObject({ value, at: f.producer.createdAt, computedAt: now, warehouseFrom: now - 1, warehouseThrough: now - 1 });
  f.setPhase('open'); await expect(f.composer.read(report, null)).rejects.toThrow();
});
it('rejects wrong manifests, missing jobs and oversized publications', async () => {
  const f = fixture(); await expect(f.composer.requireOpen('/api/analytics/other')).rejects.toThrow();
  await expect(f.composer.save(report, `:${report}`, { status: 200, body: {} }, [])).rejects.toThrow();
  await expect(f.composer.save(report, `:${report}`, { status: 200, body: { x: 'a'.repeat(800000) } },
    [{ id: `metrics_${f.producer.continuationId}_${'f'.repeat(64)}`, endedAt: now - 1 }])).rejects.toThrow();
});
