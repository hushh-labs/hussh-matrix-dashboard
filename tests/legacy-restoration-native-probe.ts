import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import type { Firestore } from '@google-cloud/firestore';
import type { CustomerCohort } from '../src/server/one-customer-cohort';
import { LegacyRestoration, restorationPlanDigest, restorationReportDigest, restorationReuseDigest, withLegacyReportScope } from '../src/server/legacy-restoration';

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

  const recoveryId = 'restore_' + randomUUID().replaceAll('-', '').slice(0, 16), recoverySource = 'e'.repeat(40);
  const recoveryRef = db.doc(`metricsRestorationPermits/${recoveryId}`);
  const previousReservedBytes = (await ref.get()).data()!.reservedBytes;
  const recovery = { source: recoverySource, phase: 'planning', createdAt: now, expiresAt: now + 600_000,
    asOf: new Date(now).toISOString(), maxBytes: 64 * 1024 ** 2, maxJobs: 2, plans: {}, reservedBytes: 0, reservedJobs: 0,
    previousPermitId: id, previousSource: source, previousReservedBytes };
  await db.doc(`metricsRestorationRecoveryClaims/${id}`).create({ previousPermitId: id, previousSource: source,
    previousReservedBytes, recoveryPermitId: recoveryId, recoverySource, maxBytes: recovery.maxBytes,
    maxJobs: recovery.maxJobs, createdAt: recovery.createdAt, expiresAt: recovery.expiresAt });
  await recoveryRef.create(recovery);
  const newer = [new LegacyRestoration(db, recoveryId, recoverySource, () => now, { id, source }),
    new LegacyRestoration(db, recoveryId, recoverySource, () => now, { id, source })];
  const diagnostic = new LegacyRestoration(db, recoveryId, recoverySource, () => now, { id, source }, true);
  await assert.rejects(scoped(() => diagnostic.admit({ query: 'SELECT 4' }, 5 * 1024 ** 3)), /Diagnostic estimate recorded/);
  assert.equal(Object.keys((await recoveryRef.get()).data()!.observations).length, 1);
  assert.equal((await recoveryRef.get()).data()!.reservedJobs, 0);
  await assert.rejects(scoped(() => newer[0].admit({ query: 'SELECT 3' }, 1)), /recorded/);
  const newPlans = (await recoveryRef.get()).data()!.plans;
  await recoveryRef.update({ phase: 'open', approvedPlanDigest: restorationPlanDigest(newPlans) });
  const nextGrant = (await scoped(() => newer[0].admit({ query: 'SELECT 3' }, 1)))!;
  await Promise.all(Array.from({ length: 6 }, (_, i) => newer[i % 2].reserve(nextGrant)));
  assert.equal((await recoveryRef.get()).data()!.reservedJobs, 1);
  assert.equal((await ref.get()).data()!.reservedBytes, previousReservedBytes);
  assert.deepEqual(await stores[1].readSnapshot('cohort-A:report'), { at: start, value });
  await db.doc(`metricsRestorationRecoveryClaims/${id}`).update({ maxBytes: recovery.maxBytes + 1 });
  await assert.rejects(newer[0].reserve(nextGrant), /held/);

  const rootId = 'restore_' + randomUUID().replaceAll('-', '').slice(0, 16), rootSource = 'd'.repeat(40);
  const abandonedId = 'restore_' + randomUUID().replaceAll('-', '').slice(0, 16), abandonedSource = 'c'.repeat(40);
  const expandedId = 'restore_' + randomUUID().replaceAll('-', '').slice(0, 16), expandedSource = 'b'.repeat(40);
  const rootRef = db.doc(`metricsRestorationPermits/${rootId}`), abandonedRef = db.doc(`metricsRestorationPermits/${abandonedId}`), expandedRef = db.doc(`metricsRestorationPermits/${expandedId}`);
  const common = { createdAt: now, expiresAt: now + 600_000, asOf: new Date(now).toISOString(), plans: {}, reservedBytes: 0, reservedJobs: 0 };
  const digest = (value: string) => createHash('sha256').update(value).digest('hex');
  const oldQuery = 'SELECT 7', cohortScope = 'a'.repeat(64);
  const oldHash = digest(JSON.stringify({ schema: 1, source: rootSource, cohortScope, project: 'hushh-ai-prod', location: 'US', asOf: common.asOf, query: oldQuery }));
  const oldBytes = 20 * 1024 ** 2, rootPlans = { [oldHash]: oldBytes };
  await rootRef.create({ ...common, source: rootSource, phase: 'closed', maxBytes: 64 * 1024 ** 2, maxJobs: 2,
    plans: rootPlans, reservedBytes: oldBytes, reservedJobs: 1, approvedPlanDigest: restorationPlanDigest(rootPlans) });
  await rootRef.collection('reservations').doc(oldHash).create({ bytes: oldBytes, jobId: `metrics_${rootId}_${oldHash}` });
  const prior = { ...common, source: abandonedSource, phase: 'closed', maxBytes: 64 * 1024 ** 2, maxJobs: 2,
    previousPermitId: rootId, previousSource: rootSource, previousReservedBytes: oldBytes, approvedPlanDigest: restorationPlanDigest({}) };
  await abandonedRef.create(prior);
  await db.doc(`metricsRestorationRecoveryClaims/${rootId}`).create({ previousPermitId: rootId, previousSource: rootSource, previousReservedBytes: oldBytes,
    recoveryPermitId: abandonedId, recoverySource: abandonedSource, maxBytes: prior.maxBytes, maxJobs: prior.maxJobs, createdAt: now, expiresAt: prior.expiresAt });
  const fixedReports = ['/api/analytics/founder?start_date=2026-11-05&end_date=2026-11-05'], approvedReportDigest = restorationReportDigest(fixedReports);
  const reuseKey = digest(JSON.stringify([digest(oldQuery), cohortScope])), reusePlans = { [reuseKey]: oldHash };
  const expansion = { ...common, source: expandedSource, phase: 'open', maxBytes: 128 * 1024 ** 2, maxJobs: 4,
    previousPermitId: rootId, previousSource: rootSource, previousReservedBytes: oldBytes, abandonedPermitId: abandonedId, abandonedSource,
    maxTotalBytes: 148 * 1024 ** 2, maxPerJobBytes: 64 * 1024 ** 2, fixedReports, approvedReportDigest, reusePlans, approvedReuseDigest: restorationReuseDigest(reusePlans), approvedPlanDigest: restorationPlanDigest({}), approvedBytes: 128 * 1024 ** 2, approvedJobs: 4 };
  await expandedRef.create(expansion);
  await db.doc(`metricsRestorationExecutionApprovals/${expandedId}`).create({ source: expandedSource,
    approvedPlanDigest: expansion.approvedPlanDigest, approvedReportDigest, approvedReuseDigest: expansion.approvedReuseDigest,
    approvedBytes: expansion.approvedBytes, approvedJobs: expansion.approvedJobs, createdAt: now, expiresAt: expansion.expiresAt });
  await db.doc(`metricsRestorationExpansionClaims/${rootId}`).create({ previousPermitId: rootId, previousSource: rootSource, previousReservedBytes: oldBytes,
    abandonedPermitId: abandonedId, abandonedSource, recoveryPermitId: expandedId, recoverySource: expandedSource,
    maxBytes: expansion.maxBytes, maxJobs: expansion.maxJobs, maxTotalBytes: expansion.maxTotalBytes, maxPerJobBytes: expansion.maxPerJobBytes,
    approvedReportDigest, approvedReuseDigest: expansion.approvedReuseDigest, createdAt: now, expiresAt: expansion.expiresAt });
  const expanded = [new LegacyRestoration(db, expandedId, expandedSource, () => now, { id: rootId, source: rootSource }, false, { id: abandonedId, source: abandonedSource }),
    new LegacyRestoration(db, expandedId, expandedSource, () => now, { id: rootId, source: rootSource }, false, { id: abandonedId, source: abandonedSource })];
  const expandedGrant = (await scoped(() => expanded[0].admit({ query: 'SELECT 5' }, 1)))!;
  await Promise.all(Array.from({ length: 6 }, (_, i) => expanded[i % 2].reserve(expandedGrant)));
  assert.equal((await expandedRef.get()).data()!.reservedJobs, 1);
  assert.equal((await rootRef.get()).data()!.reservedBytes, oldBytes);
  const reused = (await scoped(() => expanded[0].admit({ query: oldQuery }, 1)))!;
  assert.equal(reused.reuse?.priorPlanHash, oldHash); await expanded[1].reserve(reused);
  assert.equal((await expandedRef.get()).data()!.reservedJobs, 1);
  assert.equal((await rootRef.get()).data()!.reservedBytes, oldBytes);
  await assert.rejects(withLegacyReportScope('a'.repeat(64) + ':/api/analytics/founder?start_date=other', () => expanded[0].admit({ query: 'SELECT 6' }, 1)), /held/);
  const revision = 'a'.repeat(64), cutoff = new Date(Date.now() - 2_000).toISOString();
  const rows = [{ analyticsUserId: '1'.repeat(32), registeredAt: '2026-10-01T00:00:00.000Z' }];
  const cohort: CustomerCohort = { policyRevision: revision, asOf: cutoff, expiresAt: Date.now() + 60_000, rows,
    cacheKey: digest(JSON.stringify([revision, rows])) };
  const report = fixedReports[0], snapshotValue = { status: 200, body: { count: 1 } };
  await expanded[0].saveSnapshot(`${cohort.cacheKey}:${report}`, snapshotValue, now, { reportUrl: report, cohort });
  await expandedRef.update({ phase: 'closed' });
  const laterRows = [...rows, { analyticsUserId: '2'.repeat(32), registeredAt: new Date(Date.parse(cutoff) + 1_000).toISOString() }];
  const later: CustomerCohort = { ...cohort, asOf: new Date().toISOString(), rows: laterRows, cacheKey: digest(JSON.stringify([revision, laterRows])) };
  assert.deepEqual(await expanded[1].readCompatibleSnapshot(report, later), { at: now, value: snapshotValue, cohortAsOf: cutoff });
  const removed: CustomerCohort = { ...later, rows: [], cacheKey: digest(JSON.stringify([revision, []])) };
  assert.equal(await expanded[1].readCompatibleSnapshot(report, removed), null);
}
