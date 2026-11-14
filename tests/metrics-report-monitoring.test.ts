import { describe, expect, it, vi } from 'vitest';
import { digest, validateAggregate, type ReportJob } from '../src/server/reports/contracts';
import { metricsMonitoringScope, sourceBindingGeneration, validateSourceBinding } from '../src/server/reports/bindings';
import { MetricsMonitoringSource, metricsMonitoringAggregate, metricsMonitoringUrl } from '../src/server/reports/monitoring';
import { MetricsCollection } from '../src/server/reports/lifecycle';
import { collectorSourceFactory } from '../src/server/reports/source-factory';
import { monitoringAggregateFetch, type CredentialHeaders } from '../src/server/reports/transports';
import { type AggregateFetch } from '../src/server/reports/sources';
import { collectionFixture } from './helpers/metrics-collection-fixture';

const START = Date.parse('2026-11-05T00:00:00Z'), HOUR = 3_600_000;
function series(status = '2xx', hours = 24, value = 10, revision = 'old') {
  return { metric: { type: 'run.googleapis.com/request_count', labels: { response_code_class: status } },
    resource: { type: 'cloud_run_revision', labels: { project_id: metricsMonitoringScope.projectId,
      service_name: metricsMonitoringScope.serviceName, location: metricsMonitoringScope.region,
      revision_name: `${metricsMonitoringScope.serviceName}-${revision}`, configuration_name: metricsMonitoringScope.serviceName } },
    metricKind: 'DELTA', valueType: 'INT64', points: Array.from({ length: hours }, (_, hour) => ({
      interval: { startTime: new Date(START + hour * HOUR).toISOString(), endTime: new Date(START + (hour + 1) * HOUR).toISOString() },
      value: { int64Value: String(value) },
    })).reverse() };
}
const response = () => ({ unit: '1', timeSeries: [series(), series('5xx', 24, 1)] });
async function fixture() {
  const f = collectionFixture(); await f.initialize();
  const content = { approved: true, enabled: true, reportId: 'metrics.reliability' as const, revision: 1,
    scopeDigest: f.access.scopeDigest, reconciliationDigest: digest('independent-monitoring-reference'),
    coverageFrom: '2026-11-05', coverageThrough: '2026-11-05', timeoutMs: 1000, maxResponseBytes: 100_000,
    kind: 'monitoring' as const, ...metricsMonitoringScope };
  const binding = { ...content, sourceGeneration: sourceBindingGeneration(content) };
  const control = { ...f.control, sourceGeneration: binding.sourceGeneration };
  const request = { ...f.request, reportId: binding.reportId, startDate: '2026-11-05', endDate: '2026-11-05' };
  await f.put('sources', request.reportId, binding); await f.put('controls', request.reportId, control);
  await f.put('policy', 'monitoring-read-budget', { approved: true, dailyQueries: 2 });
  await f.put('sourcePolicies', binding.sourceGeneration, { approved: true, failureThreshold: 2,
    baseBackoffMs: 1000, maxBackoffMs: 8000, probeLeaseMs: 1000 });
  const id = (await f.reports.request(request, f.access)).jobId!;
  const claim = async () => (await f.worker.claim(id, digest('monitoring-worker')))!.job;
  const source = (fetcher: AggregateFetch) => new MetricsMonitoringSource(f.store, {
    sourceGeneration: binding.sourceGeneration, timeoutMs: 1000, maxResponseBytes: 100_000 }, fetcher, f.clock);
  const budgetId = `monitoring-${digest(metricsMonitoringScope)}-2026-11-13`;
  return { ...f, request, binding, control, id, claim, source, budgetId };
}

describe('warehouse-free Metrics hosting reliability', () => {
  it('sums all revisions/status series and reverse-ordered buckets, with truthful units and unknown source freshness', async () => {
    const f = await fixture(), job = await f.claim(), data = response();
    data.timeSeries.push(series('2xx', 24, 2, 'new'));
    const result = metricsMonitoringAggregate(data, job, f.clock());
    expect(result.metrics.requestCount).toEqual({ value: 312, unit: 'request', basis: 'provider_defined', coverage: 'partial' });
    expect(result.metrics.serverErrorCount.value).toBe(24);
    expect(result.metrics.serverErrorRatio.value).toBeNull();
    expect(result.metrics.p95LatencyMs).toMatchObject({ value: null, unit: 'millisecond', coverage: 'untracked' });
    expect(result.sourceWatermark).toBeNull();
    expect(() => validateAggregate(result, job, f.clock(), 100_000)).not.toThrow();
    expect(JSON.stringify(result)).not.toMatch(/revision_name|configuration_name|uptime|activeAccounts/);
  });
  it('does not turn sparse, absent or empty buckets into zeros or a complete-period error rate', async () => {
    const f = await fixture(), job = await f.claim();
    const sparse = metricsMonitoringAggregate({ timeSeries: [series('2xx', 1, 5), series('5xx', 1, 1)] }, job, f.clock());
    expect(sparse.metrics.requestCount.value).toBe(6); expect(sparse.metrics.serverErrorCount.value).toBe(1);
    expect(sparse.metrics.serverErrorRatio.value).toBeNull();
    const noErrorSeries = metricsMonitoringAggregate({ timeSeries: [series()] }, job, f.clock());
    expect(noErrorSeries.metrics.serverErrorCount).toMatchObject({ value: null, coverage: 'unavailable' });
    for (const data of [{}, { timeSeries: [] }]) {
      const empty = metricsMonitoringAggregate(data, job, f.clock());
      expect(Object.values(empty.metrics).every(metric => metric.value === null)).toBe(true);
    }
    const explicitZero = metricsMonitoringAggregate({ timeSeries: [series('2xx', 24, 0), series('5xx', 24, 0)] }, job, f.clock());
    expect(explicitZero.metrics.requestCount.value).toBe(0); expect(explicitZero.metrics.serverErrorCount.value).toBe(0);
    expect(explicitZero.metrics.serverErrorRatio.value).toBeNull();
    const mismatched = metricsMonitoringAggregate({ timeSeries: [series('2xx', 12), series('5xx', 24, 1)] }, job, f.clock());
    expect(mismatched.metrics.serverErrorRatio.value).toBeNull();
  });
  it.each([
    ['foreign project', (d: any) => { d.timeSeries[0].resource.labels.project_id = 'foreign'; }],
    ['foreign region', (d: any) => { d.timeSeries[0].resource.labels.location = 'europe-west1'; }],
    ['foreign service', (d: any) => { d.timeSeries[0].resource.labels.service_name = 'hushh-tech-website'; }],
    ['foreign revision', (d: any) => { d.timeSeries[0].resource.labels.revision_name = 'unrelated-001'; }],
    ['foreign configuration', (d: any) => { d.timeSeries[0].resource.labels.configuration_name = 'other'; }],
    ['other metric', (d: any) => { d.timeSeries[0].metric.type = 'run.googleapis.com/request_latencies'; }],
    ['gauge', (d: any) => { d.timeSeries[0].metricKind = 'GAUGE'; }],
    ['float type', (d: any) => { d.timeSeries[0].valueType = 'DOUBLE'; }],
    ['bad status', (d: any) => { d.timeSeries[0].metric.labels.response_code_class = '0xx'; }],
    ['array status', (d: any) => { d.timeSeries[0].metric.labels.response_code_class = ['2xx']; }],
    ['mismatched status', (d: any) => { d.timeSeries[0].metric.labels.response_code = '503'; }],
    ['duplicate series', (d: any) => { d.timeSeries.push(structuredClone(d.timeSeries[0])); }],
    ['duplicate point', (d: any) => { d.timeSeries[0].points.push(structuredClone(d.timeSeries[0].points[0])); }],
    ['invalid date', (d: any) => { d.timeSeries[0].points[0].interval.endTime = '2026-11-31T00:00:00Z'; }],
    ['fractional time', (d: any) => { d.timeSeries[0].points[0].interval.endTime = '2026-11-06T00:00:00.001Z'; }],
    ['outside period', (d: any) => { d.timeSeries[0].points[0].interval.endTime = '2026-11-06T01:00:00Z'; }],
    ['negative count', (d: any) => { d.timeSeries[0].points[0].value.int64Value = '-1'; }],
    ['fractional count', (d: any) => { d.timeSeries[0].points[0].value.int64Value = '1.1'; }],
    ['unsafe sum', (d: any) => { d.timeSeries[0].points.forEach((p: any) => { p.value.int64Value = String(Number.MAX_SAFE_INTEGER); }); }],
    ['pagination', (d: any) => { d.nextPageToken = 'unread-points'; }],
    ['malformed continuation', (d: any) => { d.nextPageToken = 0; }],
    ['unreachable region', (d: any) => { d.unreachable = ['us-central1']; }],
    ['malformed unreachable', (d: any) => { d.unreachable = {}; }],
    ['native error', (d: any) => { d.error = { code: 403 }; }],
    ['partial error', (d: any) => { d.executionErrors = [{ code: 13 }]; }],
    ['malformed errors', (d: any) => { d.executionErrors = 'unavailable'; }],
    ['wrong unit', (d: any) => { d.unit = 'ms'; }],
  ])('refuses %s rather than publishing a plausible total', async (_label, mutate) => {
    const f = await fixture(), job = await f.claim(), data = response(); mutate(data);
    expect(() => metricsMonitoringAggregate(data, job, f.clock())).toThrow();
    expect((await f.reports.read(f.request, f.access)).report).toBeNull();
  });
  it('requires the reviewed exact native target, UTC and closed coverage before source I/O', async () => {
    const f = await fixture(), job = await f.claim();
    expect(validateSourceBinding(f.binding, job)).toEqual(f.binding);
    for (const change of [{ projectId: 'other' }, { serviceName: 'other' }, { region: 'other' },
      { environment: 'uat' }, { coverageThrough: '2026-11-04' }, { coverageFrom: '2026-11-06' }]) {
      const bad = { ...f.binding, ...change }; bad.sourceGeneration = sourceBindingGeneration(bad);
      expect(() => validateSourceBinding(bad, { ...job, control: { ...job.control, sourceGeneration: bad.sourceGeneration } })).toThrow();
    }
    expect(() => metricsMonitoringUrl({ ...job, request: { ...job.request, timezone: 'America/Los_Angeles' } })).toThrow();
    expect(() => metricsMonitoringAggregate(response(), job, START)).toThrow();
    const url = new URL(metricsMonitoringUrl(job));
    expect(url.searchParams.get('interval.startTime')).toBe('2026-11-05T00:00:00.000Z');
    expect(url.searchParams.get('interval.endTime')).toBe('2026-11-06T00:00:00.000Z');
    expect(url.searchParams.get('filter')).toContain('resource.labels.location="us-central1"');
    expect(url.searchParams.get('aggregation.perSeriesAligner')).toBe('ALIGN_SUM');
  });
  it('journals one admitted native GET and reuses the publication on task redelivery and repeated reads', async () => {
    const f = await fixture(), fetcher = vi.fn<typeof fetch>(async () => Response.json(response()));
    const credentials = vi.fn<CredentialHeaders>(async () => ({ Authorization: 'Bearer synthetic' }));
    const monitoring = vi.fn((url: string) => monitoringAggregateFetch(url, credentials, fetcher));
    const collection = new MetricsCollection(f.store, collectorSourceFactory(f.store, { monitoring, now: f.clock }), f.clock);
    expect((await collection.collect(f.id, digest('collector'))).state).toBe('completed');
    expect((await collection.collect(f.id, digest('redelivery'))).state).toBe('completed');
    for (let i = 0; i < 10; i++) {
      const read = await f.reports.read(f.request, f.access);
      expect(read.state).toBe('unknown_freshness'); expect(read.report?.result.metrics.requestCount.value).toBe(264);
    }
    expect(fetcher).toHaveBeenCalledTimes(1); expect(credentials).toHaveBeenCalledTimes(1);
    expect(credentials.mock.calls[0][0]).toBe('monitoring');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'GET', redirect: 'error', cache: 'no-store' });
    expect(fetcher.mock.calls[0][1]?.body).toBeUndefined();
    expect(await f.get('sourceReadBudgets', f.budgetId)).toEqual({ used: 1, limit: 2 });
  });
  it('retains an uncertain reservation and never retries the native read', async () => {
    const f = await fixture(), job = await f.claim();
    const fetcher = vi.fn<AggregateFetch>(async () => { throw new Error('Synthetic acknowledgement lost'); });
    const source = f.source(fetcher);
    await expect(source.submit(job)).rejects.toThrow('Synthetic acknowledgement lost');
    for (let i = 0; i < 3; i++) expect(await source.recover(job)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await f.get('sourceReadBudgets', f.budgetId)).toEqual({ used: 1, limit: 2 });
  });
  it('refuses absent approval/exhaustion and never resets prior usage when policy or generation changes', async () => {
    const f = await fixture(), job = await f.claim(), fetcher = vi.fn<AggregateFetch>();
    await f.put('policy', 'monitoring-read-budget', { approved: false, dailyQueries: 2 });
    await expect(f.source(fetcher).submit(job)).rejects.toMatchObject({ kind: 'configuration' });
    await f.put('policy', 'monitoring-read-budget', { approved: true, dailyQueries: 10 });
    await f.put('sourceReadBudgets', f.budgetId, { used: 2, limit: 2 });
    await expect(f.source(fetcher).submit(job)).rejects.toMatchObject({ kind: 'quota', retryAfterMs: 86_400_000 });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await f.get('sourceReadBudgets', f.budgetId)).toEqual({ used: 2, limit: 2 });
  });
  it('rejects transport overrides and incompatible numeric results', async () => {
    const f = await fixture(), job = await f.claim(), url = metricsMonitoringUrl(job), credentials = vi.fn(), fetcher = vi.fn();
    const transport = monitoringAggregateFetch(url, credentials, fetcher), signal = AbortSignal.timeout(1000);
    await expect(transport(url + '&pageToken=unreviewed', { body: null, signal })).rejects.toThrow();
    await expect(transport(url, { body: {}, signal })).rejects.toThrow();
    for (const target of [url.replace('hushh-ai-prod', 'foreign'), url.replace('monitoring.googleapis.com', 'example.invalid'), url + '#fragment']) {
      expect(() => monitoringAggregateFetch(target, credentials, fetcher)).toThrow();
    }
    expect(credentials).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
    for (const change of [{ requestCount: 1.5 }, { serverErrorCount: 1000 }, { serverErrorRatio: 0.9 }, { serverErrorRatio: NaN }]) {
      const result = metricsMonitoringAggregate(response(), job, f.clock());
      for (const [name, value] of Object.entries(change)) result.metrics[name].value = value;
      expect(() => validateAggregate(result, job, f.clock(), 100_000)).toThrow();
    }
  });
  it('persists a lowered same-day ceiling even when historical usage already exhausts it', async () => {
    const f = await fixture(), job = await f.claim(), fetcher = vi.fn<AggregateFetch>();
    await f.put('sourceReadBudgets', f.budgetId, { used: 2, limit: 10 });
    await f.put('policy', 'monitoring-read-budget', { approved: true, dailyQueries: 1 });
    await expect(f.source(fetcher).submit(job)).rejects.toMatchObject({ kind: 'quota' });
    expect(await f.get('sourceReadBudgets', f.budgetId)).toEqual({ used: 2, limit: 1 });
    await f.put('policy', 'monitoring-read-budget', { approved: true, dailyQueries: 10 });
    await expect(f.source(fetcher).submit(job)).rejects.toMatchObject({ kind: 'quota' });
    expect(await f.get('sourceReadBudgets', f.budgetId)).toEqual({ used: 2, limit: 1 });
    expect(fetcher).not.toHaveBeenCalled();
    const changed = { ...f.binding, revision: 2 };
    changed.sourceGeneration = sourceBindingGeneration(changed);
    await f.put('controls', f.request.reportId, { ...f.control, revision: 2, sourceGeneration: changed.sourceGeneration });
    const nextId = (await f.reports.request(f.request, f.access)).jobId!;
    const nextJob = (await f.worker.claim(nextId, digest('new-generation-worker')))!.job;
    const nextSource = new MetricsMonitoringSource(f.store, { sourceGeneration: changed.sourceGeneration,
      timeoutMs: 1000, maxResponseBytes: 100_000 }, fetcher, f.clock);
    await expect(nextSource.submit(nextJob)).rejects.toMatchObject({ kind: 'quota' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await f.get('sourceReadBudgets', f.budgetId)).toEqual({ used: 2, limit: 1 });
    expect(await f.get('sourceReceipts', nextId)).toBeNull();
  });
});
