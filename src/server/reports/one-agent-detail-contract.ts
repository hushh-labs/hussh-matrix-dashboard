import { AGENT_MEASUREMENTS } from '../../lib/agent-measurement-contract.mjs';
import { digest, reportingTimezone, ReportError } from './contracts';

/** Proposal only. This is a feature-record contract, not the complete legacy One
 * dashboard response and not the separately defined one.adoption report. */
export const ONE_AGENT_DETAIL_VERSION = '1';
export const ONE_AGENT_DETAIL_MANIFEST = AGENT_MEASUREMENTS.map(({ agent, key }) => ({ agent, key }));
export const ONE_AGENT_DETAIL_MANIFEST_DIGEST = digest(ONE_AGENT_DETAIL_MANIFEST);
type Environment = 'production' | 'uat';
type Counts = { accounts: number | null; devices: number | null; signals: number | null; successes: number | null; expectedErrors: number | null; failures: number | null; outcomeSignals: number | null };
type EventCount = { eventName:string; signals:number; successes:number; expectedErrors:number; failures:number };
type Row = { agent: string; key: string; state: 'measured' | 'unavailable' | 'not_tracked'; counts: Counts | null; eventBreakdown:EventCount[] | null };
export type OneAgentDetailV1 = { version: '1'; environment: Environment; scopeDigest: string; manifestDigest: string;
  period: { startDate: string; endDate: string; timezone: string }; source: { kind: 'ga4_export'; coverage: 'intraday_or_unknown'; watermark: string | null; checkedAt: string | null };
  rows: Row[] };
const fields = ['accounts', 'devices', 'signals', 'successes', 'expectedErrors', 'failures', 'outcomeSignals'];
const keys = (value: unknown, names: string[]) => !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join() === [...names].sort().join();
const canonicalDay = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
const timestamp = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,19) === value.slice(0,19);

/** Caller binds the expected environment, scoped cohort and selected range from
 * an independently authorized job. This checks shape only: the producer and
 * source watermark still need independent verification; no completeness is inferred.
 * Missing rows are unknown, never zero. */
export function validateOneAgentDetail(value: unknown, expected: { environment: Environment; scopeDigest: string;
  period: { startDate: string; endDate: string; timezone: string } }): OneAgentDetailV1 {
  const bad = () => { throw new ReportError('invalid'); };
  if (!keys(value, ['version','environment','scopeDigest','manifestDigest','period','source','rows'])) return bad();
  const p = value as OneAgentDetailV1;
  if (!expected || !['production','uat'].includes(expected.environment) || !/^[a-f0-9]{64}$/.test(expected.scopeDigest)
    || p.version !== ONE_AGENT_DETAIL_VERSION || p.environment !== expected.environment || p.scopeDigest !== expected.scopeDigest
    || p.manifestDigest !== ONE_AGENT_DETAIL_MANIFEST_DIGEST || !keys(p.period,['startDate','endDate','timezone'])
    || !canonicalDay(p.period.startDate) || !canonicalDay(p.period.endDate) || p.period.startDate > p.period.endDate
    || p.period.startDate !== expected.period?.startDate || p.period.endDate !== expected.period?.endDate
    || p.period.timezone !== expected.period?.timezone || reportingTimezone(p.period.timezone) !== p.period.timezone
    || !keys(p.source,['kind','coverage','watermark','checkedAt']) || p.source.kind !== 'ga4_export'
    || p.source.coverage !== 'intraday_or_unknown' || (p.source.checkedAt !== null && !timestamp(p.source.checkedAt))
    || (p.source.watermark !== null && (!timestamp(p.source.watermark) || p.source.checkedAt === null || Date.parse(p.source.watermark) > Date.parse(p.source.checkedAt)))
    || !Array.isArray(p.rows) || p.rows.length !== ONE_AGENT_DETAIL_MANIFEST.length) return bad();
  const expectedKeys = new Set(ONE_AGENT_DETAIL_MANIFEST.map(({ agent, key }) => `${agent}:${key}`)), seen = new Set<string>();
  for (const row of p.rows) {
    if (!keys(row,['agent','key','state','counts','eventBreakdown'])) return bad();
    const id = `${row.agent}:${row.key}`;
    if (!expectedKeys.has(id) || seen.has(id) || !['measured','unavailable','not_tracked'].includes(row.state)) return bad();
    seen.add(id);
    if (row.state !== 'measured') { if (row.counts !== null || row.eventBreakdown !== null) return bad(); continue; }
    if (!keys(row.counts, fields) || Object.values(row.counts!).some(n => n !== null && (!Number.isSafeInteger(n) || n < 0)) || Object.values(row.counts!).every(n => n === null)) return bad();
    if (row.eventBreakdown !== null) {
      if (!Array.isArray(row.eventBreakdown) || row.eventBreakdown.length>256) return bad();
      const seenEvents=new Set<string>(), sums={signals:0,successes:0,expectedErrors:0,failures:0};
      for (const event of row.eventBreakdown) {
        if (!keys(event,['eventName','signals','successes','expectedErrors','failures'])
          || typeof event.eventName !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(event.eventName)
          || seenEvents.has(event.eventName)) return bad();
        seenEvents.add(event.eventName);
        for (const name of ['signals','successes','expectedErrors','failures'] as const) {
          if (!Number.isSafeInteger(event[name]) || event[name]<0) return bad(); sums[name]+=event[name];
          if (!Number.isSafeInteger(sums[name])) return bad();
        }
      }
      for (const name of ['signals','successes','expectedErrors','failures'] as const)
        if (row.counts![name] !== null && row.counts![name] !== sums[name]) return bad();
    }
  }
  return p;
}
