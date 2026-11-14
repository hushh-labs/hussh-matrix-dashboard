import { digest, ReportError, validateRequest, type AggregateResult, type MetricValue, type ReportJob } from './contracts';
import { metricsMonitoringScope } from './bindings';
import { JournaledSource, type AggregateFetch, type SourcePolicy } from './sources';
import { SourceRequestFailure } from './source-errors';
import { reportPath, type ReportStore, type ReportTransaction } from './store';

const HOUR = 3_600_000;
export function metricsMonitoringUrl(job: ReportJob) {
  const request = validateRequest(job.request, 7);
  if (request.reportId !== 'metrics.reliability' || request.timezone !== 'UTC') throw new ReportError('invalid');
  const url = new URL(`https://monitoring.googleapis.com/v3/projects/${metricsMonitoringScope.projectId}/timeSeries`);
  url.searchParams.set('filter', `metric.type="run.googleapis.com/request_count" AND resource.type="cloud_run_revision" AND resource.labels.project_id="${metricsMonitoringScope.projectId}" AND resource.labels.service_name="${metricsMonitoringScope.serviceName}" AND resource.labels.location="${metricsMonitoringScope.region}"`);
  url.searchParams.set('interval.startTime', new Date(request.startDate).toISOString());
  url.searchParams.set('interval.endTime', new Date(Date.parse(request.endDate) + 86_400_000).toISOString());
  url.searchParams.set('aggregation.alignmentPeriod', '3600s');
  url.searchParams.set('aggregation.perSeriesAligner', 'ALIGN_SUM');
  url.searchParams.set('pageSize', '1000');
  url.searchParams.set('view', 'FULL');
  return url.toString();
}

function invalid(): never { throw new SourceRequestFailure('configuration'); }
function nativeTime(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.0{1,9})?Z$/.test(value)) return invalid();
  const time = Date.parse(value);
  if (!Number.isSafeInteger(time) || new Date(time).toISOString().slice(0, 19) !== value.slice(0, 19)) return invalid();
  return time;
}
/** Sum only observed, validated native DELTA buckets. Missing data stays unknown. */
export function metricsMonitoringAggregate(data: any, job: ReportJob, checkedAt: number): AggregateResult {
  const start = Date.parse(job.request.startDate), end = Date.parse(job.request.endDate) + 86_400_000;
  metricsMonitoringUrl(job); // closed report/period/timezone validation
  if (!Number.isSafeInteger(checkedAt) || end > checkedAt || !data || typeof data !== 'object' || Array.isArray(data)
    || Object.keys(data).some(key => !['timeSeries', 'unit', 'nextPageToken', 'executionErrors', 'unreachable'].includes(key))
    || data.unit !== undefined && data.unit !== '1'
    || data.nextPageToken !== undefined && (typeof data.nextPageToken !== 'string' || data.nextPageToken !== '')
    || ['executionErrors', 'unreachable'].some(key => data[key] !== undefined && (!Array.isArray(data[key]) || data[key].length !== 0))
    || data.timeSeries !== undefined && !Array.isArray(data.timeSeries)) return invalid();
  const series = data.timeSeries ?? [];
  if (series.length > 1000) return invalid();
  const identities = new Set<string>();
  let requests = 0, errors = 0, points = 0, errorPoints = 0;
  for (const row of series) {
    const labels = row?.resource?.labels, metric = row?.metric;
    if (row?.resource?.type !== 'cloud_run_revision' || labels?.project_id !== metricsMonitoringScope.projectId
      || labels?.service_name !== metricsMonitoringScope.serviceName || labels?.location !== metricsMonitoringScope.region
      || typeof labels?.revision_name !== 'string' || !labels.revision_name.startsWith(metricsMonitoringScope.serviceName + '-')
      || labels?.configuration_name !== metricsMonitoringScope.serviceName
      || metric?.type !== 'run.googleapis.com/request_count' || row.metricKind !== 'DELTA' || row.valueType !== 'INT64'
      || typeof metric?.labels?.response_code_class !== 'string' || !/^[1-5]xx$/.test(metric.labels.response_code_class)
      || metric?.labels?.response_code !== undefined && (!/^[1-5]\d\d$/.test(metric.labels.response_code)
        || metric.labels.response_code[0] !== metric.labels.response_code_class[0])
      || !Array.isArray(row.points) || row.points.length === 0) return invalid();
    const identity = digest([row.resource, metric]);
    if (identities.has(identity)) return invalid();
    identities.add(identity);
    const intervals: Array<[number, number]> = [];
    for (const point of row.points) {
      if (++points > 5000) return invalid();
      const first = nativeTime(point?.interval?.startTime), last = nativeTime(point?.interval?.endTime);
      const value = point?.value?.int64Value;
      if (first < start || last > end || last <= first || last - first !== HOUR || first % HOUR !== 0
        || typeof value !== 'string' || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) return invalid();
      intervals.push([first, last]);
      requests += Number(value);
      if (metric.labels.response_code_class === '5xx') { errors += Number(value); errorPoints++; }
      if (!Number.isSafeInteger(requests) || !Number.isSafeInteger(errors)) return invalid();
    }
    intervals.sort((a, b) => a[0] - b[0]);
    if (intervals.some((interval, index) => index > 0 && interval[0] < intervals[index - 1][1])) return invalid();
  }
  const count = (value: number | null): MetricValue => ({ value, unit: 'request', basis: 'provider_defined', coverage: value === null ? 'unavailable' : 'partial' });
  // Presence of buckets cannot establish completeness of omitted revisions or
  // status series. Do not calculate a service rate from that unknown denominator.
  return { metrics: {
    requestCount: count(points ? requests : null), serverErrorCount: count(errorPoints ? errors : null),
    serverErrorRatio: { value: null, unit: 'ratio', basis: 'provider_defined', coverage: 'unavailable' },
    p95LatencyMs: { value: null, unit: 'millisecond', basis: 'provider_defined', coverage: 'untracked' },
  }, sourceCheckedAt: checkedAt, sourceWatermark: null, sourceGeneration: job.control.sourceGeneration,
    scopeDigest: job.control.scopeDigest, definitionVersion: job.control.definitionVersion,
    period: { startDate: job.request.startDate, endDate: job.request.endDate, timezone: job.request.timezone }, reconciled: true };
}

export class MetricsMonitoringSource extends JournaledSource {
  constructor(store: ReportStore, policy: SourcePolicy, private fetch: AggregateFetch, now?: () => number) { super(store, policy, now); }
  protected binding(job: ReportJob) { return digest([job.key, metricsMonitoringScope, this.policy.sourceGeneration]); }
  protected async sourceBudget(tx: ReportTransaction) {
    const policy = await tx.get<{ approved: boolean; dailyQueries: number }>(reportPath('policy', 'monitoring-read-budget'));
    if (!policy || Object.keys(policy).sort().join() !== 'approved,dailyQueries' || policy.approved !== true
      || !Number.isSafeInteger(policy.dailyQueries) || policy.dailyQueries < 1 || policy.dailyQueries > 1000) return invalid();
    const now = this.now(), day = new Date(now).toISOString().slice(0, 10);
    const ref = reportPath('sourceReadBudgets', `monitoring-${digest(metricsMonitoringScope)}-${day}`);
    const budget = await tx.get<{ used: number; limit: number }>(ref);
    if (budget && (Object.keys(budget).sort().join() !== 'limit,used' || !Number.isSafeInteger(budget.used)
      || !Number.isSafeInteger(budget.limit) || budget.limit < 1 || budget.used < 0)) return invalid();
    const used = budget?.used ?? 0, limit = Math.min(budget?.limit ?? policy.dailyQueries, policy.dailyQueries);
    if (used >= limit) return Object.assign(() => tx.set(ref, { used, limit }),
      { rejection: new SourceRequestFailure('quota', Date.parse(day) + 86_400_000 - now) });
    return () => tx.set(ref, { used: used + 1, limit });
  }
  protected async collect(job: ReportJob) {
    const url = metricsMonitoringUrl(job), signal = AbortSignal.timeout(this.policy.timeoutMs);
    if (Date.parse(job.request.endDate) + 86_400_000 > this.now()) throw new ReportError('invalid');
    return metricsMonitoringAggregate(await this.boundedJson(await this.fetch(url, { body: null, signal }), signal), job, this.now());
  }
}
