import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { DailyOneRefresh } from '../src/server/daily-one-refresh';
const hash = (s:string) => createHash('sha256').update(s).digest('hex');
it('returns verified snapshot scope bindings internally and withholds mismatched snapshot scope', async () => {
  const id='refresh_20261118_'+'a'.repeat(16), source='b'.repeat(40), start=Date.parse('2026-11-18T10:00:00Z');
  const report='/api/analytics/all?view=one&environment=uat&one_start_date=2026-11-18&one_end_date=2026-11-18';
  const scopes={ [hash(report)]:'c'.repeat(64) }, scopeDigest=hash(JSON.stringify(Object.entries(scopes).sort(([a],[b])=>a.localeCompare(b))));
  const run={phase:'closed',reports:[report],measurementScopes:scopes,scopeDigest,measurementId:'measurement',measurementSource:source,
    measurementDigest:'d'.repeat(64),logicalAsOf:new Date(start).toISOString(),createdAt:start};
  const one={reportingEnvironment:'uat',reportingScopeVersion:'one-environment-v1',range:{startDate:'2026-11-18',endDate:'2026-11-18',days:1},
    activeUsers:{countingUnit:'device'},identifiedUsers:{countingUnit:'account',selectedRange:{startDate:'2026-11-18',endDate:'2026-11-18'}}};
  const row={schema:1,state:'verified',source,measurementId:run.measurementId,measurementSource:source,measurementDigest:run.measurementDigest,
    scopeDigest,runId:id,reportHash:hash(report),dataAsOf:run.logicalAsOf,sourceCoverage:'intraday-or-unknown',nonWarehouseFreshness:'unknown',
    computedAt:start+1000,json:JSON.stringify({status:200,body:{one:{error:null,data:{production:null,uat:one}}}}),
    jobs:[{id:`metrics_${id}_${'e'.repeat(64)}`,endedAt:start+900}]};
  const db={doc:()=>({collection:()=>({doc:()=>({get:async()=>({data:()=>row})})})})} as any;
  const store=new DailyOneRefresh(db,id,source,()=>start+2000);
  vi.spyOn(store as any,'permit').mockResolvedValue({run}); // Isolate the already-verified read return; not a cohort verification test.
  const result=await store.read(report,null,false);
  expect(result?.scopeProvenance).toEqual({manifestScopeDigest:scopeDigest,reportScopeDigest:'c'.repeat(64)});
  row.scopeDigest='f'.repeat(64); expect(await store.read(report,null,false)).toBeNull();
});
