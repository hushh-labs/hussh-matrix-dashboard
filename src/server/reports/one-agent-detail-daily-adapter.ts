import { adaptRetainedOneAgentDetail } from './one-agent-detail-retained-adapter';

/** Shape adapter for a result already obtained through DailyOneRefresh.read.
 * Caller must independently enforce the verified read, current authority/cohort,
 * expected report scope, and source-calendar timezone. The run scope values
 * are binding digests, not a cohort or a GA4 event-data watermark. */
export function adaptVerifiedDailyOneDetail(snapshot: unknown, expected: {
  environment:'production' | 'uat'; reportScopeDigest:string; manifestScopeDigest:string;
  period:{startDate:string; endDate:string; timezone:string};
}) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new Error('One agent detail unavailable');
  const s = snapshot as any;
  if (!/^[a-f0-9]{64}$/.test(expected.reportScopeDigest) || !/^[a-f0-9]{64}$/.test(expected.manifestScopeDigest)
    || !s.scopeProvenance || s.scopeProvenance.reportScopeDigest !== expected.reportScopeDigest
    || s.scopeProvenance.manifestScopeDigest !== expected.manifestScopeDigest
    || !Number.isSafeInteger(s.computedAt) || s.computedAt < 0 || !Number.isFinite(new Date(s.computedAt).getTime())
    || s.value?.status !== 200 || s.value.body?.one?.error != null) throw new Error('One agent detail unavailable');
  const data = s.value.body?.one?.data;
  if (!data || (expected.environment === 'uat' ? data.production !== null : data.uat !== null)) throw new Error('One agent detail unavailable');
  const summary = expected.environment === 'uat' ? data.uat : data.production;
  const detail = adaptRetainedOneAgentDetail(summary, { environment:expected.environment, scopeDigest:expected.reportScopeDigest,
    period:expected.period, checkedAt:null, watermark:null });
  return { detail, computedAt:s.computedAt, scopeProvenance:s.scopeProvenance };
}
