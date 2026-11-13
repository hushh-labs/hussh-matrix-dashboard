import assert from 'node:assert/strict';
import type { Firestore } from '@google-cloud/firestore';
import { digest, type AggregateResult, type ReportingPolicy, type ReportControl } from '../src/server/reports/contracts';
import { FirestoreReportStore, reportPath } from '../src/server/reports/store';
import { MetricsReports, MetricsReportWorker } from '../src/server/reports/service';
import { MetricsReportDispatch, type DispatchPolicy, type ReportTaskQueue } from '../src/server/reports/dispatch';
import { sourceBindingGeneration } from '../src/server/reports/bindings';
import { MetricsCollection } from '../src/server/reports/lifecycle';
import { Ga4AcquisitionSource } from '../src/server/reports/sources';
import { MetricsSourceCircuit } from '../src/server/reports/circuit';
import { FirestoreReportMaintenanceStore } from '../src/server/reports/maintenance-store';
import { MetricsReportMaintenance } from '../src/server/reports/maintenance';

/** Runs inside the existing localhost-only native budget/storage qualification.
 * Derived reporting must not modify its inherited warehouse reservations. */
export async function verifyNativeReportStorage(db: Firestore) {
  let now = Date.parse('2026-11-13T00:00:00Z');
  const store = new FirestoreReportStore(db), restarted = new FirestoreReportStore(db);
  const access = { subjectHash: digest('native-staff-fixture'), scopeDigest: digest('native-scope-fixture') };
  const request = { reportId: 'one.adoption' as const, startDate: '2026-11-11', endDate: '2026-11-12', timezone: 'UTC' };
  const policy: ReportingPolicy = { approved: true, computeEnabled: true, quotaWindowMs: 60_000,
    readRequests: 20, statusRequests: 20, computeRequests: 20, customCapacity: 2, customPerSubjectCapacity: 2, scheduledCapacity: 1, maxPeriodDays: 30,
    leaseMs: 1000, jobLifetimeMs: 60_000, maxSnapshotBytes: 20_000 };
  const control: ReportControl = { enabled: true, revision: 1, sourceGeneration: digest('native-source'),
    scopeDigest: access.scopeDigest, definitionVersion: '1', freshnessMs: 10_000, staleMs: 20_000 };
  await db.doc(reportPath('policy', 'current')).set(policy);
  await db.doc(reportPath('controls', 'one.adoption')).set(control);
  const readers = [new MetricsReports(store, () => now), new MetricsReports(restarted, () => now)];
  const intents = await Promise.all(readers.map(reader => reader.request(request, access)));
  assert.equal(intents[0].jobId, intents[1].jobId, 'Competing instances must coalesce one job');
  const worker = new MetricsReportWorker(store, () => now);
  const first = (await worker.claim(intents[0].jobId!, digest('native-first-worker')))!;
  assert.equal(await worker.claim(first.job.id, digest('native-contender')), null);
  now += policy.leaseMs + 1;
  const recovery = (await new MetricsReportWorker(restarted, () => now).claim(first.job.id, digest('native-recovery')))!;
  assert.equal(recovery.recoverOnly, true);
  assert.equal(recovery.job.providerJobId, first.job.providerJobId);
  const result: AggregateResult = { metrics: {
    activeAccounts: { value: 2, coverage: 'available', unit: 'account', basis: 'exact' },
    confirmedOutcomes: { value: 3, coverage: 'available', unit: 'outcome', basis: 'exact' },
  }, sourceCheckedAt: now, sourceWatermark: now, sourceGeneration: control.sourceGeneration,
    scopeDigest: access.scopeDigest, definitionVersion: '1', reconciled: true,
    period: { startDate: request.startDate, endDate: request.endDate, timezone: request.timezone } };
  await assert.rejects(worker.publish(first.job, result), { code: 'stale_worker' });
  await worker.publish(recovery.job, result);
  for (const reader of readers) {
    const view = await reader.read(request, access);
    assert.equal(view.state, 'completed');
    assert.equal(view.report?.result.metrics.activeAccounts.value, 2);
  }
  assert.equal((await db.doc(reportPath('capacity', 'custom')).get()).data()?.active, 0);
  await db.doc(reportPath('controls', 'one.adoption')).set({ ...control, revision: 2 });
  assert.equal((await readers[0].read(request, access)).report, null, 'Old generation cannot be read');
  const next = await readers[0].request(request, access);
  const uncertain = (await worker.claim(next.jobId!, digest('native-uncertain')))!;
  await worker.uncertain(uncertain.job);
  assert.equal((await db.doc(reportPath('capacity', 'custom')).get()).data()?.active, 1);
  const dispatchPolicy: DispatchPolicy = { approved: true, enabled: true, leaseMs: 1000, lookupDelayMs: 1000, maxLookups: 2 };
  await db.doc(reportPath('policy', 'dispatch')).set(dispatchPolicy);
  const toQueue = await readers[0].request({ ...request, startDate: '2026-11-10' }, access);
  let creates = 0, lookups = 0;
  const queue: ReportTaskQueue = { taskName: id => `fixture/tasks/${id}`,
    create: async () => { creates++; throw new Error('Synthetic missing acknowledgement'); },
    lookup: async () => { lookups++; return 'present'; } };
  await new MetricsReportDispatch(store, queue, () => now).deliver(toQueue.jobId!, digest('native-dispatch'));
  assert.equal((await readers[0].status(toQueue.jobId!, access)).state, 'delayed');
  now += dispatchPolicy.lookupDelayMs;
  const dispatched = await new MetricsReportDispatch(restarted, queue, () => now).deliver(toQueue.jobId!, digest('native-dispatch-recovery'));
  assert.equal(dispatched.state, 'queued'); assert.equal(creates, 1); assert.equal(lookups, 1);
  // Real native transactions with entirely synthetic source I/O. No GA4, One,
  // Secret Manager, Cloud Tasks or warehouse endpoint is contacted here.
  const gaRequest = { ...request, reportId: 'hushhai.acquisition' as const };
  const content = { approved: true, enabled: true, reportId: gaRequest.reportId, revision: 1, scopeDigest: access.scopeDigest,
    reconciliationDigest: digest('native-reconciliation-fixture'), coverageFrom: '2026-11-01', timeoutMs: 500, maxResponseBytes: 20_000,
    kind: 'ga4', propertyId: '123456', timezone: 'UTC', streamId: '987654321', hostnames: ['www.hushh.ai'],
    readerServiceAccount: 'analytics-reader@demo-metrics.iam.gserviceaccount.com' };
  const binding = { ...content, sourceGeneration: sourceBindingGeneration(content) };
  await db.doc(reportPath('controls', gaRequest.reportId)).set({ ...control, sourceGeneration: binding.sourceGeneration });
  await db.doc(reportPath('sources', gaRequest.reportId)).set(binding);
  await db.doc(reportPath('policy', 'collection')).set({ approved: true, enabled: true, maxClaims: 3, retryDelayMs: 1000 });
  await db.doc(reportPath('sourcePolicies', binding.sourceGeneration)).set({ approved: true, failureThreshold: 2, baseBackoffMs: 1000, maxBackoffMs: 5000, probeLeaseMs: 1000 });
  const scheduled = await readers[0].requestScheduled(gaRequest, access); let sourceCalls = 0;
  const collection = new MetricsCollection(restarted, async () => new Ga4AcquisitionSource(store, {
    sourceGeneration: binding.sourceGeneration, timeoutMs: 500, maxResponseBytes: 20_000,
  }, { propertyId: '123456', timezone: 'UTC', streamId: '987654321', hostnames: ['www.hushh.ai'], informationWatermark: null }, async () => {
    sourceCalls++; return Response.json({ metadata: { timeZone: 'UTC' },
      metricHeaders: ['sessions', 'activeUsers', 'engagedSessions', 'keyEvents'].map(name => ({ name })),
      rowCount: 1, rows: [{ metricValues: ['5', '3', '4', '1'].map(value => ({ value })) }] });
  }, () => now), () => now);
  assert.equal((await collection.collect(scheduled.jobId!, digest('native-collector'))).state, 'completed');
  assert.equal((await collection.collect(scheduled.jobId!, digest('native-duplicate'))).state, 'completed');
  assert.equal((await readers[1].read(gaRequest, access)).state, 'unknown_freshness'); assert.equal(sourceCalls, 1);
  assert.equal((await db.doc(reportPath('capacity', 'scheduled')).get()).data()?.active, 0);
  const circuit = new MetricsSourceCircuit(store, () => now, () => 1);
  await circuit.complete(await circuit.acquire(binding.sourceGeneration, digest('native-broken-key')), 'configuration');
  await assert.rejects(new MetricsSourceCircuit(restarted, () => now).acquire(binding.sourceGeneration, digest('native-stopped')), { needsAttention: true });
  await db.doc(reportPath('policy', 'maintenance')).set({ approved: true, enabled: true, batchSize: 2, leaseMs: 1000, retentionMs: 1000 });
  const oldQuota = digest('native-expired-quota'); await db.doc(reportPath('quotas', oldQuota)).set({ count: 1, windowEndsAt: now - 2000 });
  const maintenance = new MetricsReportMaintenance(new FirestoreReportMaintenanceStore(db), async () => {}, () => now);
  for (let i = 0; i < 4; i++) {
    const pass = await maintenance.run(digest('native-maintenance')); assert.ok(pass.scanned <= 4);
  }
  assert.equal((await db.doc(reportPath('quotas', oldQuota)).get()).exists, false);
  assert.equal((await db.doc(reportPath('jobs', uncertain.job.id)).get()).exists, true);
  assert.equal((await db.doc(reportPath('snapshots', scheduled.jobId!)).get()).exists, true);
}
