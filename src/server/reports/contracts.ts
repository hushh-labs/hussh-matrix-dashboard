import { createHash } from 'node:crypto';

export const reportDefinitions = {
  'one.adoption': { version: '1', product: 'one', metrics: ['activeAccounts', 'confirmedOutcomes'] },
  'hushhai.acquisition': { version: '1', product: 'hushhai', metrics: ['sessions', 'activeUsers', 'engagedSessions', 'keyEvents'] },
  'hushhai.activity': { version: '1', product: 'hushhai', maxPeriodDays: 7, metrics: ['pageViews', 'searchSubmissions', 'searchCompletions', 'searchFailures', 'ctaClicks'] },
} as const;
export type ReportId = keyof typeof reportDefinitions;
export type ReportPeriod = { startDate: string; endDate: string; timezone: string };
export type ReportRequest = ReportPeriod & { reportId: ReportId };
export type ReportAccess = { subjectHash: string; scopeDigest: string };
export type ReportControl = { enabled: boolean; revision: number; sourceGeneration: string;
  scopeDigest: string; definitionVersion: string; freshnessMs: number; staleMs: number };
export type ReportingPolicy = { approved: boolean; computeEnabled: boolean; quotaWindowMs: number;
  readRequests: number; statusRequests: number; computeRequests: number; customCapacity: number;
  scheduledCapacity: number; customPerSubjectCapacity: number;
  maxPeriodDays: number; leaseMs: number; jobLifetimeMs: number; maxSnapshotBytes: number };
export type JobStatus = 'accepted' | 'running' | 'completed' | 'delayed' | 'failed' | 'invalidated';
export type ReportJob = { id: string; key: string; request: ReportRequest; control: ReportControl;
  lane: 'custom' | 'scheduled'; requesterHash: string;
  status: JobStatus; acceptedAt: number; startedAt: number | null; completedAt: number | null;
  expiresAt: number; fence: number; leaseUntil: number;
  nextAttemptAt: number; needsAttention: boolean;
  workerHash: string | null; providerJobId: string; dispatchIntent: true; sourceStarted: boolean };
export type MetricValue = { value: number | null; coverage: 'available' | 'partial' | 'provisional' | 'untracked' | 'unavailable';
  unit: 'account' | 'outcome' | 'session' | 'provider_user' | 'key_event' | 'event'; basis: 'exact' | 'provider_defined' | 'source_recorded' };
export type AggregateResult = { metrics: Record<string, MetricValue>; sourceCheckedAt: number;
  sourceWatermark: number | null; sourceGeneration: string; scopeDigest: string; definitionVersion: string;
  period: ReportPeriod; reconciled: boolean };
export type PublishedReport = { id: string; key: string; request: ReportRequest; control: ReportControl;
  result: AggregateResult; computedAt: number; publishedAt: number };

export class ReportError extends Error {
  constructor(public code: 'invalid' | 'unauthorized' | 'unavailable' | 'quota' | 'capacity' | 'stale_worker') {
    super(`Metrics report ${code}.`);
  }
}
export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value, (_key, v) =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map(key => [key, v[key]])) : v)).digest('hex');
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function validateAccess(access: ReportAccess) {
  if (!access || !hash(access.subjectHash) || !hash(access.scopeDigest)) throw new ReportError('unauthorized');
}
export function validatePolicy(value: ReportingPolicy | null): ReportingPolicy {
  if (!value || value.approved !== true || typeof value.computeEnabled !== 'boolean'
    || Object.keys(value).sort().join() !== ['approved', 'computeEnabled', 'quotaWindowMs', 'readRequests',
      'statusRequests', 'computeRequests', 'customCapacity', 'scheduledCapacity', 'customPerSubjectCapacity', 'maxPeriodDays', 'leaseMs', 'jobLifetimeMs', 'maxSnapshotBytes'].sort().join()
    || Object.entries(value).some(([key, v]) => !['approved', 'computeEnabled'].includes(key)
      && (!Number.isSafeInteger(v) || (key === 'scheduledCapacity' ? Number(v) < 0 : Number(v) <= 0)))
    || value.leaseMs > value.jobLifetimeMs || value.maxSnapshotBytes > 900_000) throw new ReportError('unavailable');
  return value;
}
export function validateControl(value: ReportControl | null, request: ReportRequest, access: ReportAccess) {
  if (!value || Object.keys(value).sort().join() !== 'definitionVersion,enabled,freshnessMs,revision,scopeDigest,sourceGeneration,staleMs'
    || value.enabled !== true || !Number.isSafeInteger(value.revision) || value.revision < 1
    || !hash(value.scopeDigest) || !hash(value.sourceGeneration) || value.scopeDigest !== access.scopeDigest
    || value.definitionVersion !== reportDefinitions[request.reportId].version
    || !Number.isSafeInteger(value.freshnessMs) || value.freshnessMs <= 0
    || !Number.isSafeInteger(value.staleMs) || value.staleMs < value.freshnessMs) throw new ReportError('unavailable');
  return value;
}
export function validateRequest(value: unknown, maxDays: number): ReportRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ReportError('invalid');
  const r = value as ReportRequest;
  if (Object.keys(r).sort().join() !== ['reportId', 'startDate', 'endDate', 'timezone'].sort().join()
    || !Object.hasOwn(reportDefinitions, r.reportId)) throw new ReportError('invalid');
  for (const day of [r.startDate, r.endDate]) {
    if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)
      || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day) throw new ReportError('invalid');
  }
  const days = (Date.parse(r.endDate) - Date.parse(r.startDate)) / 86_400_000 + 1;
  const definition = reportDefinitions[r.reportId];
  if (days <= 0 || days > Math.min(maxDays, 'maxPeriodDays' in definition ? definition.maxPeriodDays : maxDays)) throw new ReportError('invalid');
  return { reportId: r.reportId, startDate: r.startDate, endDate: r.endDate, timezone: reportingTimezone(r.timezone) };
}
export function reportingTimezone(value: string) {
  if (typeof value !== 'string' || value.length > 64 || !value) throw new ReportError('invalid');
  try { return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone; }
  catch { throw new ReportError('invalid'); }
}
export const reportKey = (request: ReportRequest, control: ReportControl) => digest([
  request.reportId, request.startDate, request.endDate, request.timezone,
  control.definitionVersion, control.sourceGeneration, control.scopeDigest, control.revision,
]);
export function validateAggregate(result: AggregateResult, job: ReportJob, now: number, maxBytes: number) {
  const request = job.request;
  if (!result || Object.keys(result).sort().join() !== ['metrics', 'sourceCheckedAt', 'sourceWatermark',
    'sourceGeneration', 'scopeDigest', 'definitionVersion', 'period', 'reconciled'].sort().join()
    || result.reconciled !== true || result.sourceGeneration !== job.control.sourceGeneration
    || result.scopeDigest !== job.control.scopeDigest || result.definitionVersion !== job.control.definitionVersion
    || !result.period || Object.keys(result.period).sort().join() !== 'endDate,startDate,timezone'
    || result.period.startDate !== request.startDate || result.period.endDate !== request.endDate
    || result.period.timezone !== request.timezone || !Number.isSafeInteger(result.sourceCheckedAt)
    || result.sourceCheckedAt < job.acceptedAt || result.sourceCheckedAt > now
    || (result.sourceWatermark !== null && (!Number.isSafeInteger(result.sourceWatermark)
      || result.sourceWatermark < 0 || result.sourceWatermark > result.sourceCheckedAt))) throw new ReportError('invalid');
  const expected = reportDefinitions[request.reportId].metrics;
  if (!result.metrics || Object.keys(result.metrics).sort().join() !== [...expected].sort().join()) throw new ReportError('invalid');
  const units: Record<string, MetricValue['unit']> = { activeAccounts: 'account', confirmedOutcomes: 'outcome',
    sessions: 'session', activeUsers: 'provider_user', engagedSessions: 'session', keyEvents: 'key_event',
    pageViews: 'event', searchSubmissions: 'event', searchCompletions: 'event', searchFailures: 'event', ctaClicks: 'event' };
  const basis = request.reportId === 'one.adoption' ? 'exact' : request.reportId === 'hushhai.activity' ? 'source_recorded' : 'provider_defined';
  for (const [name, metric] of Object.entries(result.metrics)) {
    if (!metric || Object.keys(metric).sort().join() !== 'basis,coverage,unit,value'
      || metric.unit !== units[name] || metric.basis !== basis
      || !['available', 'partial', 'provisional', 'untracked', 'unavailable'].includes(metric.coverage)
      || (['unavailable', 'untracked'].includes(metric.coverage) ? metric.value !== null
        : !Number.isSafeInteger(metric.value) || Number(metric.value) < 0)
      || (metric.value !== null && result.sourceWatermark === null
        && (!['provider_defined', 'source_recorded'].includes(metric.basis) || !['partial', 'provisional'].includes(metric.coverage)))) throw new ReportError('invalid');
  }
  if (Buffer.byteLength(JSON.stringify(result)) > maxBytes) throw new ReportError('invalid');
}
