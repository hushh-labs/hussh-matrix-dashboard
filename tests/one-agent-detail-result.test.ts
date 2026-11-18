import { expect, it } from 'vitest';
import { ONE_AGENT_DETAIL_MANIFEST, ONE_AGENT_DETAIL_MANIFEST_DIGEST } from '../src/server/reports/one-agent-detail-contract';
import { validateProposedOneDetailResult } from '../src/server/reports/one-agent-detail-result';
const period={startDate:'2026-11-18',endDate:'2026-11-18',timezone:'UTC'};
const job={environment:'uat' as const,reportScopeDigest:'a'.repeat(64),manifestScopeDigest:'b'.repeat(64),sourceGeneration:'c'.repeat(64),definitionVersion:'1' as const,acceptedAt:100,period};
const result=()=>({definitionVersion:'1',sourceGeneration:job.sourceGeneration,manifestScopeDigest:job.manifestScopeDigest,computedAt:150,
 detail:{version:'1',environment:'uat',scopeDigest:job.reportScopeDigest,manifestDigest:ONE_AGENT_DETAIL_MANIFEST_DIGEST,period,
 source:{kind:'ga4_export',coverage:'intraday_or_unknown',checkedAt:null,watermark:null},
 rows:ONE_AGENT_DETAIL_MANIFEST.map(({agent,key})=>({agent,key,state:'unavailable',counts:null}))}});
it('accepts a bounded, scope-bound incomplete result without claiming source freshness', () => {
 const value=result(); expect(validateProposedOneDetailResult(value,job,200,900_000)).toBe(value);
});
it('rejects cross-lane, mismatched source, false watermark and oversize result', () => {
 expect(()=>validateProposedOneDetailResult(result(),{...job,environment:'production'},200,900_000)).toThrow();
 expect(()=>validateProposedOneDetailResult(result(),{...job,sourceGeneration:'d'.repeat(64)},200,900_000)).toThrow();
 const p=result(); p.detail.source.watermark='2026-11-18T11:00:00Z' as any; expect(()=>validateProposedOneDetailResult(p,job,200,900_000)).toThrow();
 expect(()=>validateProposedOneDetailResult(result(),job,200,100)).toThrow();
});
it('rejects invalid computed time and missing catalog entries', () => {
 const p=result(); p.computedAt=99; expect(()=>validateProposedOneDetailResult(p,job,200,900_000)).toThrow();
 const q=result(); q.detail.rows.pop(); expect(()=>validateProposedOneDetailResult(q,job,200,900_000)).toThrow();
});
