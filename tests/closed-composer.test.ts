import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { Firestore } from '@google-cloud/firestore';
import { ClosedComposer } from '../src/server/closed-composer';
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
const source = 'a'.repeat(40), producerSource = 'b'.repeat(40), producerId = 'restore_1234567890abcdef', id = 'composer_1234567890abcdef';
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
  db.values.set(`metricsRestorationComposers/${id}`, doc);
  const store = { closedDescriptor: vi.fn(async () => producer), capturedWitness: vi.fn() } as unknown as LegacyRestoration;
  return { db, doc, parent, composer: new ClosedComposer(db.native(), id, source, store, now) };
}
const jobs = ['metrics_restore_1234567890abcdef_' + 'e'.repeat(64)];

describe('closed-job composition publications', () => {
  it('rejects a duplicate after a lost acknowledgement and reads the original only after close', async () => {
    const f = fixture(), value = { status: 200, body: { value: 7 } };
    await f.composer.save(report, `:${report}`, value, jobs);
    await expect(f.composer.save(report, `:${report}`, { status: 200, body: { value: 99 } }, jobs)).rejects.toMatchObject({ status: 409 });
    expect(await f.composer.read(report, null)).toBeNull(); f.doc.phase = 'closed';
    expect((await f.composer.read(report, null))?.value).toEqual(value);
    await expect(f.composer.save(report, `:${report}`, value, jobs)).rejects.toThrow('unavailable');
    expect(JSON.stringify([...f.db.values.values()])).toContain(producerSource);
    expect(JSON.stringify([...f.db.values.values()])).toContain('\"nonWarehouseFreshness\":\"unknown\"');
  });
  it('fails closed on scope, provenance, incomplete jobs and reopened producer', async () => {
    const f = fixture(), value = { status: 200, body: { value: 7 } };
    await expect(f.composer.save('/api/analytics/all?view=other', ':x', value, jobs)).rejects.toThrow('unavailable');
    await expect(f.composer.save(report, `:${report}`, value, [])).rejects.toThrow('unavailable');
    f.doc.producerSource = 'f'.repeat(40); await expect(f.composer.requireOpen(report)).rejects.toThrow('unavailable');
    f.doc.producerSource = producerSource; f.parent.phase = 'open';
    await expect(f.composer.save(report, `:${report}`, value, jobs)).rejects.toThrow('unavailable');
  });
  it('retains a witnessed cohort only for currently eligible members plus later additions', async () => {
    const f = fixture(), revision = 'f'.repeat(64), cutoff = new Date(start).toISOString();
    const make = (rows: CustomerCohort['rows'], asOf = cutoff): CustomerCohort => ({ policyRevision: revision, asOf,
      expiresAt: Date.now() + 60_000, rows, cacheKey: digest(JSON.stringify([revision, rows])) });
    const original = make([{ analyticsUserId: '1'.repeat(32), registeredAt: '2026-10-01T00:00:00.000Z' }]);
    await f.composer.save(other, `${original.cacheKey}:${other}`, { status: 200, body: { value: 7 } }, jobs, original);
    f.doc.phase = 'closed';
    const added = make([...original.rows, { analyticsUserId: '2'.repeat(32), registeredAt: '2026-11-15T00:00:00.000Z' }], '2026-11-16T00:00:00.000Z');
    expect(await f.composer.read(other, added)).not.toBeNull();
    expect(await f.composer.read(other, make([], '2026-11-16T00:00:00.000Z'))).toBeNull();
    const unknown = make([{ analyticsUserId: '1'.repeat(32), registeredAt: null }], '2026-11-16T00:00:00.000Z');
    expect(await f.composer.read(other, unknown)).toBeNull();
    expect(JSON.stringify([...f.db.values.values()])).not.toContain('1'.repeat(32));
  });
});
