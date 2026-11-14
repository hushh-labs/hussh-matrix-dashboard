import { describe, expect, it } from 'vitest';
import type { Firestore } from '@google-cloud/firestore';
import { LegacyContinuation } from '../src/server/legacy-continuation';
import { measurementHashDigest } from '../src/server/closed-measurement';
import { ClosedJobMissingError, restorationPlanDigest, restorationReportDigest, withLegacyReportScope, type LegacyRestoration } from '../src/server/legacy-restoration';

class Database {
  values = new Map<string, any>(); private tail = Promise.resolve();
  doc(path: string): any { return { path, get: async () => this.snapshot(path), collection: (name: string) => ({ doc: (id: string) => this.doc(`${path}/${name}/${id}`) }) }; }
  snapshot(path: string) { return { exists: this.values.has(path), data: () => this.values.get(path) }; }
  async runTransaction<T>(run: (tx: any) => Promise<T>) {
    const prior = this.tail; let unlock!: () => void; this.tail = new Promise<void>(r => { unlock = r; }); await prior;
    const writes = new Map<string, any>();
    try {
      const result = await run({ get: async (ref: any) => this.snapshot(ref.path),
        update: (ref: any, value: any) => writes.set(ref.path, { ...(writes.get(ref.path) ?? this.values.get(ref.path)), ...value }),
        create: (ref: any, value: any) => { if (this.values.has(ref.path)) throw new Error('exists'); writes.set(ref.path, value); } });
      for (const [key, value] of writes) this.values.set(key, value); return result;
    } finally { unlock(); }
  }
  native() { return this as unknown as Pick<Firestore, 'doc' | 'runTransaction'>; }
}
const start = Date.parse('2026-11-15T00:01:00Z'), unit = 1024 ** 2;
const originalId = 'restore_1111111111111111', producerId = 'restore_2222222222222222', id = 'restore_3333333333333333';
const originalSource = 'a'.repeat(40), producerSource = 'b'.repeat(40), source = 'c'.repeat(40), measurementSource = 'd'.repeat(40);
const report = '/api/analytics/founder?day=2026-11-14', measurementId = 'measure_4444444444444444';
function fixture() {
  const db = new Database(); let now = start;
  const original = { source: originalSource, phase: 'closed', createdAt: start - 3600000, expiresAt: start - 3000000,
    asOf: new Date(start - 3600000).toISOString(), maxBytes: 100 * unit, maxJobs: 80, plans: {}, reservedBytes: 10 * unit, reservedJobs: 1,
    approvedPlanDigest: restorationPlanDigest({}) };
  const knownPlans = { ['e'.repeat(64)]: 20 * unit }, fixedReports = [report], reportDigest = restorationReportDigest(fixedReports);
  const parent = { phase: 'closed', asOf: new Date(start - 1800000).toISOString(), plans: knownPlans,
    approvedPlanDigest: restorationPlanDigest(knownPlans), approvedReportDigest: reportDigest, fixedReports, approvedBytes: 200 * unit,
    reservedBytes: 20 * unit, reservedJobs: 1 };
  db.values.set(`metricsRestorationPermits/${originalId}`, original);
  const producerMethods = { closedJob: async (_request: unknown): Promise<any> => { throw new ClosedJobMissingError('a'.repeat(64), undefined); }, verifiedClosedIn: async () => {
    if (parent.phase !== 'closed') throw new Error('parent not closed');
    return { p: parent, id: producerId, source: producerSource, original: { id: originalId, source: originalSource } };
  } };
  const producer = producerMethods as unknown as LegacyRestoration;
  const hashes = ['f'.repeat(64)], allowedDigest = measurementHashDigest(hashes), measurementDigest = '1'.repeat(64);
  const doc = { source, phase: 'open', createdAt: start, expiresAt: start + 600000, dataAsOf: parent.asOf,
    producerId, producerSource, producerPlanDigest: parent.approvedPlanDigest, producerReportDigest: reportDigest,
    producerReservedBytes: parent.reservedBytes, producerReservedJobs: parent.reservedJobs, originalId, originalSource,
    originalPlanDigest: original.approvedPlanDigest, originalReservedBytes: original.reservedBytes, originalReservedJobs: original.reservedJobs,
    measurementId, measurementSource, measurementAllowedDigest: allowedDigest, measurementDigest, measurementCount: 1, measurementBoundBytes: 10 * unit,
    knownPlans, knownPlanDigest: restorationPlanDigest(knownPlans), knownPlanBoundBytes: 20 * unit, fixedReports, reportDigest, witnessReport: report,
    maxBytes: 100 * unit, maxJobs: 2, maxPerJobBytes: 64 * unit, maxTotalBytes: original.reservedBytes + parent.approvedBytes,
    reservedBytes: 0, reservedJobs: 0 };
  db.values.set(`metricsRestorationContinuations/${id}`, doc);
  db.values.set(`metricsRestorationContinuationClaims/${producerId}`, { ...doc, continuationId: id });
  db.values.set(`metricsRestorationContinuationApprovals/${id}`, { ...doc, continuationId: id });
  db.values.set(`metricsRestorationMeasurements/${measurementId}`, { phase: 'closed', source: measurementSource, producerId, producerSource,
    producerAsOf: parent.asOf, producerPlanDigest: parent.approvedPlanDigest, producerReportDigest: reportDigest,
    allowedHashes: hashes, allowedDigest, reports: fixedReports, reportDigest, witnessReport: report, attempted: 1, maxDryRuns: 1 });
  db.values.set(`metricsRestorationMeasurementSeals/${measurementId}`, { phase: 'sealed', measurementId, source: measurementSource,
    producerId, producerSource, reportDigest, allowedDigest, measurementDigest, measuredCount: 1, measuredBoundBytes: 10 * unit });
  const store = new LegacyContinuation(db.native(), id, source, producer, () => now);
  const scope = <T>(fn: () => Promise<T>) => withLegacyReportScope(`:${report}`, fn);
  return { db, doc, parent, original, producerMethods, store, scope, time: (n: number) => { now = n; } };
}
describe('cumulative continuation', () => {
  it('freezes the original clock and reserves one stable job across concurrent attempts and UTC rollover', async () => {
    const f = fixture(); const query = await f.scope(() => f.store.prepare({ query: 'SELECT CURRENT_DATE()' }));
    expect(query.query).toContain('2026-11-14');
    const grant = await f.scope(() => f.store.admit(query, 1));
    await Promise.all(Array.from({ length: 8 }, () => f.store.reserve(grant)));
    expect(f.doc).toMatchObject({ reservedBytes: 0, reservedJobs: 0 });
    expect(f.db.values.get(`metricsRestorationContinuations/${id}`)).toMatchObject({ reservedBytes: grant.bytes, reservedJobs: 1 });
    expect(f.original.reservedBytes).toBe(10 * unit); expect(f.parent.reservedBytes).toBe(20 * unit);
    expect([...f.db.values.keys()].filter(key => key.includes('/reservations/'))).toHaveLength(1);
  });
  it('fails closed when parent, measurement, approval or time changes before reservation', async () => {
    for (const mutate of [
      (f: ReturnType<typeof fixture>) => { f.parent.phase = 'open'; },
      (f: ReturnType<typeof fixture>) => { f.db.values.get(`metricsRestorationMeasurementSeals/${measurementId}`).measuredCount++; },
      (f: ReturnType<typeof fixture>) => { f.db.values.get(`metricsRestorationContinuationApprovals/${id}`).maxBytes++; },
      (f: ReturnType<typeof fixture>) => { f.time(start + 600000); },
    ]) {
      const f = fixture(); const grant = await f.scope(() => f.store.admit({ query: 'SELECT 1' }, 1)); mutate(f);
      await expect(f.store.reserve(grant)).rejects.toThrow();
      expect(f.db.values.get(`metricsRestorationContinuations/${id}`).reservedJobs).toBe(0);
    }
  });
  it('rejects modified hashes and refuses admission without an authorized report scope', async () => {
    const f = fixture(); await expect(f.store.prepare({ query: 'SELECT 1' })).rejects.toThrow();
    f.db.values.get(`metricsRestorationMeasurements/${measurementId}`).allowedHashes[0] = '2'.repeat(64);
    await expect(f.scope(() => f.store.admit({ query: 'SELECT 1' }, 1))).rejects.toThrow();
  });
  it('enforces the continuation hard job and byte caps even if all approvals match', async () => {
    for (const [field, value] of [['maxJobs', 201], ['maxBytes', 500 * 1024 ** 3 + 1]] as const) {
      const f = fixture();
      f.parent.approvedBytes = 1024 ** 4;
      for (const path of [`metricsRestorationContinuations/${id}`, `metricsRestorationContinuationClaims/${producerId}`,
        `metricsRestorationContinuationApprovals/${id}`]) {
        f.db.values.get(path).maxTotalBytes = f.original.reservedBytes + f.parent.approvedBytes;
        f.db.values.get(path)[field] = value;
      }
      await expect(f.store.isPreparing()).rejects.toThrow();
    }
  });
  it('admits only an absent prior reservation as a candidate for new work', async () => {
    const f = fixture();
    expect(await f.scope(() => f.store.existing({ query: 'SELECT 1' }))).toBeUndefined();
    f.producerMethods.closedJob = async () => { throw new Error('conflicting prior reservation'); };
    await expect(f.scope(() => f.store.existing({ query: 'SELECT 1' }))).rejects.toThrow('conflicting prior reservation');
    expect(f.db.values.get(`metricsRestorationContinuations/${id}`).reservedJobs).toBe(0);
  });
  it('retains original period and mixed job times in a write-once publication', async () => {
    const f = fixture(), first = `metrics_${originalId}_${'a'.repeat(64)}`, second = `metrics_${id}_${'b'.repeat(64)}`;
    const jobs = [{ id: first, endedAt: start - 120000 }, { id: second, endedAt: start - 1000 }];
    const body = { status: 200, body: { count: 7 } };
    await f.store.save(report, `:${report}`, body, jobs);
    await expect(f.store.save(report, `:${report}`, body, jobs)).rejects.toMatchObject({ status: 409 });
    expect(await f.store.read(report, null)).toBeNull();
    f.doc.phase = 'closed';
    expect(await f.store.read(report, null)).toMatchObject({ value: body, at: Date.parse(f.parent.asOf), computedAt: start,
      warehouseFrom: start - 120000, warehouseThrough: start - 1000 });
  });
  it('rejects unsafe publication payloads and missing job evidence', async () => {
    const f = fixture();
    await expect(f.store.save(report, `:${report}`, { status: 200, body: { count: 1 } }, [])).rejects.toThrow();
    await expect(f.store.save(report, `:${report}`, { status: 200, body: { data: 'x'.repeat(800000) } },
      [{ id: `metrics_${id}_${'b'.repeat(64)}`, endedAt: start - 1 }])).rejects.toThrow();
  });
});
