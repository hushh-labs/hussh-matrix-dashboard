import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { dailyOneScopeProvenance } from '../src/server/daily-one-scope-provenance';
const hash = (s:string) => createHash('sha256').update(s).digest('hex');
const reports=['/api/analytics/all?view=one&environment=production','/api/analytics/all?view=one&environment=uat'];
const scopes={ [hash(reports[0])]:'a'.repeat(64), [hash(reports[1])]:'b'.repeat(64) };
const run={reports,measurementScopes:scopes,scopeDigest:hash(JSON.stringify(Object.entries(scopes).sort(([a],[b])=>a.localeCompare(b))))};
it('returns distinct report scope bindings under the same verified manifest', () => {
  expect(dailyOneScopeProvenance(run,reports[0])).toEqual({manifestScopeDigest:run.scopeDigest,reportScopeDigest:'a'.repeat(64)});
  expect(dailyOneScopeProvenance(run,reports[1])).toEqual({manifestScopeDigest:run.scopeDigest,reportScopeDigest:'b'.repeat(64)});
});
it('rejects an absent report, tampered scope and incomplete manifest', () => {
  expect(()=>dailyOneScopeProvenance(run,'other')).toThrow();
  expect(()=>dailyOneScopeProvenance({...run,measurementScopes:{...scopes,[hash(reports[1])]:'c'.repeat(64)}},reports[1])).toThrow();
  expect(()=>dailyOneScopeProvenance({...run,reports:[...reports,'other']},reports[0])).toThrow();
});
