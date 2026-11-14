import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Firestore } from '@google-cloud/firestore';
import { LegacyRestoration, restorationPlanDigest, withLegacyReportScope } from '../src/server/legacy-restoration';

export async function verifyNativeLegacyRestoration(db: Firestore) {
  const id = 'restore_' + randomUUID().replaceAll('-', '').slice(0, 16);
  const source = 'f'.repeat(40), start = Date.parse('2026-11-14T23:59:00Z');
  let now = start;
  const ref = db.doc(`metricsRestorationPermits/${id}`);
  await ref.create({ source, phase: 'planning', createdAt: start, expiresAt: start + 600_000,
    asOf: new Date(start).toISOString(), maxBytes: 64 * 1024 ** 2, maxJobs: 2,
    plans: {}, reservedBytes: 0, reservedJobs: 0 });
  const stores = [new LegacyRestoration(db, id, source, () => now), new LegacyRestoration(db, id, source, () => now)];
  const scoped = <T>(load: () => Promise<T>) => withLegacyReportScope('a'.repeat(64) + ':/api/analytics/founder?start_date=2026-11-05&end_date=2026-11-05', load);
  for (const query of ['SELECT 1', 'SELECT 2']) await assert.rejects(scoped(() => stores[0].admit({ query }, 1)), /recorded/);
  const plans = (await ref.get()).data()!.plans;
  await ref.update({ phase: 'open', approvedPlanDigest: restorationPlanDigest(plans) });
  const grants = await Promise.all(['SELECT 1', 'SELECT 2'].map(query => scoped(() => stores[0].admit({ query }, 1))));
  await Promise.all(Array.from({ length: 6 }, (_, i) => stores[i % 2].reserve(grants[i % 2]!)));
  const reserved = (await ref.get()).data()!;
  assert.equal(reserved.reservedJobs, 2);
  assert.equal(reserved.reservedBytes, grants.reduce((sum, item) => sum + item!.bytes, 0));
  assert.equal((await ref.collection('reservations').get()).size, 2);
  now = start + 120_000; // UTC rollover must not create another allowance.
  await new LegacyRestoration(db, id, source, () => now).reserve(grants[0]!);
  assert.equal((await ref.get()).data()!.reservedJobs, 2);
  const value = { status: 200, body: { period: '2026-11-05', sourceAvailable: true, unavailableMetric: null } };
  await stores[0].saveSnapshot('cohort-A:report', value, now);
  await ref.update({ phase: 'closed' }); now = start + 700_000;
  assert.deepEqual(await stores[1].readSnapshot('cohort-A:report'), { at: start, value });
  assert.equal(await stores[1].readSnapshot('cohort-B:report'), null);
  await assert.rejects(stores[1].reserve(grants[0]!), /held/);
  assert.equal((await ref.collection('reservations').get()).size, 2);
}
