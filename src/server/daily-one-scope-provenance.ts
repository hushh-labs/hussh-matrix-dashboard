import { createHash } from 'node:crypto';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
/** Internal provenance only. This is a manifest binding, not a GA4 watermark,
 * a cohort itself, or a substitute for an authorized verified snapshot read. */
export function dailyOneScopeProvenance(run: { reports:string[]; scopeDigest:string; measurementScopes:Record<string,string> }, report: string) {
  if (!run || !Array.isArray(run.reports) || !run.reports.includes(report)
    || !run.measurementScopes || typeof run.measurementScopes !== 'object' || Array.isArray(run.measurementScopes)) throw new Error('One scope unavailable');
  const entries = Object.entries(run.measurementScopes).sort(([a],[b]) => a.localeCompare(b));
  if (entries.length !== run.reports.length || new Set(run.reports).size !== run.reports.length
    || entries.some(([k,v]) => !/^[a-f0-9]{64}$/.test(k) || typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v))
    || run.scopeDigest !== hash(JSON.stringify(entries)) || run.reports.some(r => !Object.hasOwn(run.measurementScopes, hash(r)))) throw new Error('One scope unavailable');
  return { manifestScopeDigest: run.scopeDigest, reportScopeDigest: run.measurementScopes[hash(report)] };
}
