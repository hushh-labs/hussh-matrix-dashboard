import { digest, reportDefinitions, reportingTimezone, ReportError, type ReportId, type ReportJob } from './contracts';

export type Ga4WebsiteScope = { streamId: string; hostnames: string[] };
export function isAnalyticsReader(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && !/\s/.test(value)
    && (/^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,61}[a-z0-9]\.iam\.gserviceaccount\.com$/.test(value)
      || /^[1-9]\d{5,20}-compute@developer\.gserviceaccount\.com$/.test(value));
}
/** One website report covers its original and redirected domains, never app
 * streams, previews or arbitrary hosts. Every subset still needs source review;
 * canonical order makes scope identity stable. No source binding is inferred. */
export function hasGa4WebsiteScope(value: Ga4WebsiteScope) {
  return typeof value.streamId === 'string' && /^\d{3,20}$/.test(value.streamId)
    && Array.isArray(value.hostnames) && value.hostnames.length >= 1 && value.hostnames.length <= 4
    && value.hostnames.every(host => ['hushh.ai', 'hussh.si', 'www.hushh.ai', 'www.hussh.si'].includes(host))
    && new Set(value.hostnames).size === value.hostnames.length
    && value.hostnames.join() === [...value.hostnames].sort().join();
}
type BindingBase = { approved: boolean; enabled: boolean; reportId: ReportId; revision: number; sourceGeneration: string;
  scopeDigest: string; reconciliationDigest: string; coverageFrom: string; timeoutMs: number; maxResponseBytes: number };
export type ReportSourceBinding = BindingBase & (
  { kind: 'ga4'; propertyId: string; timezone: string; readerServiceAccount: string; coverageThrough: string } & Ga4WebsiteScope
  | { kind: 'one'; environment: 'production' | 'uat'; secretVersion: string }
);
export function sourceBindingGeneration(binding: unknown) {
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) throw new ReportError('invalid');
  const { approved: _approved, enabled: _enabled, sourceGeneration: _generation, ...content } = binding as ReportSourceBinding;
  return digest(content);
}
export function validateSourceBinding(value: unknown, job: ReportJob): ReportSourceBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ReportError('unavailable');
  const b = value as ReportSourceBinding;
  const common = ['approved', 'enabled', 'reportId', 'revision', 'sourceGeneration', 'scopeDigest', 'reconciliationDigest',
    'coverageFrom', 'timeoutMs', 'maxResponseBytes', 'kind'];
  if (Object.keys(b).sort().join() !== [...common, ...(b.kind === 'ga4' ? ['propertyId', 'timezone', 'streamId', 'hostnames', 'readerServiceAccount', 'coverageThrough'] : ['environment', 'secretVersion'])].sort().join()
    || b.approved !== true || b.enabled !== true || !Object.hasOwn(reportDefinitions, b.reportId)
    || b.reportId !== job.request.reportId || b.scopeDigest !== job.control.scopeDigest
    || b.sourceGeneration !== job.control.sourceGeneration || b.sourceGeneration !== sourceBindingGeneration(b)
    || !/^[a-f0-9]{64}$/.test(b.reconciliationDigest) || !Number.isSafeInteger(b.revision) || b.revision < 1
    || !Number.isSafeInteger(b.timeoutMs) || b.timeoutMs <= 0 || b.timeoutMs > 0xffff_ffff
    || !Number.isSafeInteger(b.maxResponseBytes) || b.maxResponseBytes <= 0 || b.maxResponseBytes > 900_000
    || typeof b.coverageFrom !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.coverageFrom)
    || !Number.isFinite(Date.parse(b.coverageFrom)) || new Date(b.coverageFrom).toISOString().slice(0, 10) !== b.coverageFrom
    || job.request.startDate < b.coverageFrom) throw new ReportError('unavailable');
  if (b.kind === 'ga4') {
    // A reviewed lower bound is not evidence that collection continued after a
    // provider was paused or its emitter changed. Never extrapolate that range.
    if (b.reportId !== 'hushhai.acquisition' || !/^\d{3,20}$/.test(b.propertyId)
      || typeof b.coverageThrough !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.coverageThrough)
      || !Number.isFinite(Date.parse(b.coverageThrough)) || new Date(b.coverageThrough).toISOString().slice(0, 10) !== b.coverageThrough
      || b.coverageThrough < b.coverageFrom || job.request.endDate > b.coverageThrough
      || !hasGa4WebsiteScope(b) || !isAnalyticsReader(b.readerServiceAccount)
      || reportingTimezone(b.timezone) !== job.request.timezone) throw new ReportError('unavailable');
  } else if (b.kind === 'one') {
    if (b.reportId !== 'one.adoption' || !['production', 'uat'].includes(b.environment)
      || !/^projects\/[a-z][a-z0-9-]{4,61}[a-z0-9]\/secrets\/metrics-one-aggregate-source-(production|uat)\/versions\/[1-9]\d*$/.test(b.secretVersion)
      || !b.secretVersion.includes(`/metrics-one-aggregate-source-${b.environment}/`)) throw new ReportError('unavailable');
  } else throw new ReportError('unavailable');
  return b;
}
