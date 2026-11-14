import { digest, type AggregateResult, type ReportingPolicy, type ReportJob, type ReportRequest } from '../../src/server/reports/contracts';
import { sourceBindingGeneration, type ReportSourceBinding } from '../../src/server/reports/bindings';
import { MetricsReports, MetricsReportWorker } from '../../src/server/reports/service';
import { reportPath } from '../../src/server/reports/store';
import { MemoryReportStore } from './metrics-report-memory-store';

/** Deliberately explicit synthetic policy; never used as an activation default. */
export function collectionFixture() {
  let now = Date.parse('2026-11-13T00:00:00Z');
  const clock = () => now, advance = (ms: number) => { now += ms; };
  const store = new MemoryReportStore();
  const access = { subjectHash: digest('collection-staff'), scopeDigest: digest('collection-scope') };
  const request: ReportRequest = { reportId: 'one.adoption', startDate: '2026-11-11', endDate: '2026-11-12', timezone: 'UTC' };
  const policy: ReportingPolicy = { approved: true, computeEnabled: true, quotaWindowMs: 60_000, readRequests: 100,
    statusRequests: 100, computeRequests: 100, customCapacity: 4, customPerSubjectCapacity: 3, scheduledCapacity: 1,
    maxPeriodDays: 30, leaseMs: 2000, jobLifetimeMs: 60_000, maxSnapshotBytes: 20_000 };
  const rawBinding = { approved: true, enabled: true, reportId: request.reportId, revision: 1, scopeDigest: access.scopeDigest,
    reconciliationDigest: digest('independent-reconciliation-fixture'), coverageFrom: '2026-11-01', timeoutMs: 1000, maxResponseBytes: 20_000,
    kind: 'one', environment: 'uat', secretVersion: 'projects/demo-metrics/secrets/metrics-one-aggregate-source-uat/versions/1' };
  const binding = { ...rawBinding, sourceGeneration: sourceBindingGeneration(rawBinding) } as ReportSourceBinding;
  const control = { enabled: true, revision: 1, sourceGeneration: binding.sourceGeneration, scopeDigest: access.scopeDigest,
    definitionVersion: '1', freshnessMs: 10_000, staleMs: 20_000 };
  const put = (collection: string, id: string, value: unknown) => store.transaction(async tx => tx.set(reportPath(collection, id), value));
  const get = <T>(collection: string, id: string) => store.transaction(tx => tx.get<T>(reportPath(collection, id)));
  const reports = new MetricsReports(store, clock), worker = new MetricsReportWorker(store, clock);
  const result = (job: ReportJob): AggregateResult => ({ metrics: {
    activeAccounts: { value: 2, coverage: 'available', unit: 'account', basis: 'exact' },
    confirmedOutcomes: { value: 3, coverage: 'available', unit: 'outcome', basis: 'exact' },
  }, period: { startDate: job.request.startDate, endDate: job.request.endDate, timezone: job.request.timezone },
    sourceCheckedAt: now, sourceWatermark: now, sourceGeneration: job.control.sourceGeneration, scopeDigest: access.scopeDigest,
    definitionVersion: '1', reconciled: true });
  const initialize = async () => {
    await put('policy', 'current', policy); await put('controls', request.reportId, control); await put('sources', request.reportId, binding);
    await put('policy', 'one-read-budget', { approved: true, dailyQueries: 100 });
    await put('policy', 'ga4-read-budget', { approved: true, dailyQueries: 100 });
    await put('policy', 'collection', { approved: true, enabled: true, maxClaims: 3, retryDelayMs: 500 });
    await put('sourcePolicies', binding.sourceGeneration, { approved: true, failureThreshold: 2, baseBackoffMs: 1000, maxBackoffMs: 8000, probeLeaseMs: 1000 });
  };
  return { store, clock, advance, access, request, policy, control, binding, put, get, reports, worker, result, initialize };
}
