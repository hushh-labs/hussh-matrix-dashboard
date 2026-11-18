import { ONE_AGENT_DETAIL_MANIFEST, ONE_AGENT_DETAIL_MANIFEST_DIGEST, validateOneAgentDetail } from './one-agent-detail-contract';

/** Adapts only the feature record subset of an independently verified retained
 * One summary. This does not verify source authorization, watermark or cohort,
 * does not run a query, and does not produce a full dashboard publication. */
export function adaptRetainedOneAgentDetail(summary: unknown, context: {
  environment: 'production' | 'uat'; scopeDigest: string;
  period: { startDate: string; endDate: string; timezone: string };
  checkedAt: string; watermark: string | null;
}) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) throw new Error('One agent detail unavailable');
  const s = summary as Record<string, any>;
  const days = (Date.parse(context.period.endDate) - Date.parse(context.period.startDate)) / 86_400_000 + 1;
  if (s.reportingEnvironment !== context.environment || s.reportingScopeVersion !== 'one-environment-v1'
    || s.range?.startDate !== context.period.startDate || s.range?.endDate !== context.period.endDate
    || s.range?.days !== days || s.activeUsers?.countingUnit !== 'device' || s.identifiedUsers?.countingUnit !== 'account'
    || s.identifiedUsers?.selectedRange?.startDate !== context.period.startDate
    || s.identifiedUsers?.selectedRange?.endDate !== context.period.endDate || typeof s.featureUsageAvailable !== 'boolean'
    || typeof s.locationBehaviorAvailable !== 'boolean' || !s.featureUsage || typeof s.featureUsage !== 'object'
    || Array.isArray(s.featureUsage) || !Array.isArray(s.locationAnalytics?.features)) throw new Error('One agent detail unavailable');
  const location = new Map<string, any>();
  for (const row of s.locationAnalytics.features) {
    if (!row || typeof row.key !== 'string' || location.has(row.key)) throw new Error('One agent detail unavailable');
    location.set(row.key, row);
  }
  const numberOrUnknown = (v: unknown) => v === undefined || v === null ? null : v;
  const rows = ONE_AGENT_DETAIL_MANIFEST.map(({ agent, key }) => {
    const source = agent === 'location' ? (s.locationBehaviorAvailable ? location.get(key) : null)
      : (s.featureUsageAvailable ? s.featureUsage[key] : null);
    if (!source || typeof source !== 'object' || Array.isArray(source)) return { agent, key, state:'unavailable', counts:null };
    // The legacy Location producer fills absent aggregate rows with zero.
    // Positive events witness a returned aggregate row; zero does not.
    if (agent === 'location') {
      if (source.events !== null && source.events !== undefined &&
        (!Number.isSafeInteger(source.events) || source.events < 0)) throw new Error('One agent detail unavailable');
      if (!source.events) return { agent, key, state:'unavailable', counts:null };
    }
    const f = s.featureUsageAvailable ? s.featureUsage[key] : null;
    const parts = [source.successes, source.expectedErrors, source.failures];
    const outcomeSignals = agent === 'location'
      ? (parts.every(n => typeof n === 'number') ? parts.reduce((a,b) => a + b, 0) : null)
      : numberOrUnknown(source.outcomeSignals);
    const counts = { accounts:numberOrUnknown(agent === 'location' ? f?.accounts : source.accounts),
      devices:numberOrUnknown(agent === 'location' ? source.users : source.devices),
      signals:numberOrUnknown(agent === 'location' ? source.events : source.signals),
      successes:numberOrUnknown(source.successes), expectedErrors:numberOrUnknown(source.expectedErrors),
      failures:numberOrUnknown(source.failures), outcomeSignals };
    return Object.values(counts).every(v => v === null)
      ? { agent, key, state:'unavailable', counts:null }
      : { agent, key, state:'measured', counts };
  });
  const result = { version:'1', environment:context.environment, scopeDigest:context.scopeDigest,
    manifestDigest:ONE_AGENT_DETAIL_MANIFEST_DIGEST, period:context.period,
    source:{ kind:'ga4_export', coverage:'intraday_or_unknown', checkedAt:context.checkedAt, watermark:context.watermark }, rows };
  return validateOneAgentDetail(result, context);
}
