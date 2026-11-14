import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { Firestore } from '@google-cloud/firestore';
import { ClosedMeasurement, measurementHashDigest } from '../src/server/closed-measurement';
import { restorationReportDigest, type LegacyRestoration } from '../src/server/legacy-restoration';
import type { CustomerCohort } from '../src/server/one-customer-cohort';

class Database {
  values = new Map<string, any>();
  doc(path: string): any { return { path, get: async () => this.snapshot(path), collection: (name: string) => ({ doc: (id: string) => this.doc(`${path}/${name}/${id}`) }) }; }
  snapshot(path: string) { return { exists: this.values.has(path), data: () => this.values.get(path) }; }
  async runTransaction<T>(fn: (tx: any) => Promise<T>) {
    const writes = new Map<string, any>();
    const result = await fn({ get: async (ref: any) => this.snapshot(ref.path),
      create: (ref: any, data: any) => { if (this.values.has(ref.path)) throw new Error('exists'); writes.set(ref.path, data); },
      update: (ref: any, data: any) => writes.set(ref.path, { ...this.values.get(ref.path), ...data }) });
    for (const [key, value] of writes) this.values.set(key, value); return result;
  }
  native() { return this as unknown as Pick<Firestore, 'doc' | 'runTransaction'>; }
}
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const source = 'a'.repeat(40), producerSource = 'b'.repeat(40), producerId = 'restore_1234567890abcdef', id = 'measure_1234567890abcdef';
const report = '/api/analytics/all?environment=uat&view=one', other = '/api/analytics/founder?start_date=2026-11-11';
const start = Date.parse('2026-11-14T12:00:00Z'), now = () => start + 30_000;
function fixture() {
  const db = new Database(), reports = [report, other];
  const producer = { id: producerId, source: producerSource, asOf: new Date(start).toISOString(), createdAt: start,
    approvedPlanDigest: 'c'.repeat(64), approvedReportDigest: 'd'.repeat(64), fixedReports: reports };
  const parent = { phase: 'closed', source: producerSource, asOf: producer.asOf,
    approvedPlanDigest: producer.approvedPlanDigest, approvedReportDigest: producer.approvedReportDigest };
  db.values.set(`metricsRestorationPermits/${producerId}`, parent);
  const doc = { source, producerId, producerSource, producerAsOf: producer.asOf, producerPlanDigest: producer.approvedPlanDigest,
    producerReportDigest: producer.approvedReportDigest, reports, reportDigest: restorationReportDigest(reports), witnessReport: other,
    createdAt: start, expiresAt: start + 60_000, phase: 'open' };
  const allowedHashes = ['e'.repeat(64)]; Object.assign(doc, { allowedHashes, allowedDigest: measurementHashDigest(allowedHashes), maxDryRuns: 1, attempted: 0 });
  db.values.set(`metricsRestorationMeasurements/${id}`, doc);
  const store = { closedDescriptor: vi.fn(async () => producer), capturedWitness: vi.fn() } as unknown as LegacyRestoration;
  return { db, doc, parent, composer: new ClosedMeasurement(db.native(), id, source, store, now) };
}
const jobs = ['metrics_restore_1234567890abcdef_' + 'e'.repeat(64)];


describe('closed-job native estimates', () => {
  it('records one bounded dry-run intent and never replays a pending or finished attempt', async () => {
    const f = fixture(), hash = 'e'.repeat(64);
    expect(await f.composer.claim(report, hash)).toBe(true);
    expect(await f.composer.claim(report, hash)).toBe(false);
    await f.composer.finish(hash, { processed: 1, bound: 10 * 1024 ** 2, referenceDigest: 'f'.repeat(64), minimumUnits: 0 });
    expect(await f.composer.claim(report, hash)).toBe(false);
    expect(f.db.values.get(`metricsRestorationMeasurements/${id}`).attempted).toBe(1);
  });
  it('rejects unapproved scope, hashes, tampered bindings and closed producers', async () => {
    const f = fixture(); await expect(f.composer.claim('/api/analytics/all?view=other', 'e'.repeat(64))).rejects.toThrow('unavailable');
    await expect(f.composer.claim(report, 'f'.repeat(64))).rejects.toThrow('unavailable');
    f.doc.producerSource = 'f'.repeat(40); await expect(f.composer.claim(report, 'e'.repeat(64))).rejects.toThrow('unavailable');
    f.doc.producerSource = producerSource; f.parent.phase = 'open'; await expect(f.composer.claim(report, 'e'.repeat(64))).rejects.toThrow('unavailable');
  });
  it('does not finish or replay an intent after closure', async () => {
    const f = fixture(), hash = 'e'.repeat(64); await f.composer.claim(report, hash); f.db.values.get(`metricsRestorationMeasurements/${id}`).phase = 'closed';
    await expect(f.composer.finish(hash, null)).rejects.toThrow('unavailable');
    await expect(f.composer.claim(report, hash)).rejects.toThrow('unavailable');
  });
});
