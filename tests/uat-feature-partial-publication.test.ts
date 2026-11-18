import { expect, it, vi } from 'vitest';
import { digest } from '../src/server/reports/contracts';
import { reportPath } from '../src/server/reports/store';
import { UatFeaturePartialPublisher } from '../src/server/reports/uat-feature-partial-publication';
import { MemoryReportStore } from './helpers/metrics-report-memory-store';
const now=Date.parse('2026-11-19T12:00:00Z');
function fixture() {
 const store=new MemoryReportStore(), control={enabled:true,revision:1,sourceGeneration:'a'.repeat(64),scopeDigest:'b'.repeat(64),definitionVersion:'1',freshnessMs:1000,staleMs:2000};
 const job={id:'c'.repeat(64),key:'d'.repeat(64),status:'running',fence:1,workerHash:'e'.repeat(64),leaseUntil:now+60000,expiresAt:now+120000,sourceStarted:true,control,
  request:{reportId:'one.agent-detail-uat',startDate:'2026-11-18',endDate:'2026-11-18',timezone:'UTC'}} as any;
 const global={approved:true,computeEnabled:true,quotaWindowMs:60000,readRequests:10,statusRequests:10,computeRequests:10,customCapacity:2,scheduledCapacity:0,customPerSubjectCapacity:1,maxPeriodDays:90,leaseMs:60000,jobLifetimeMs:120000,maxSnapshotBytes:900000};
 const source={approved:true,enabled:true,environment:'uat',project:'hushh-ai-prod',location:'US',queryHash:'1'.repeat(64),referenceDigest:'2'.repeat(64),
  sourceGeneration:control.sourceGeneration,scopeDigest:control.scopeDigest,startDate:'2026-11-18',endDate:'2026-11-18',timezone:'UTC',expiresAt:now+60000,maxBytes:1000};
 const proof={binding:'3'.repeat(64),policyDigest:digest(source),scopeDigest:control.scopeDigest,sourceGeneration:control.sourceGeneration,queryHash:source.queryHash};
 const intent={state:'complete',jobId:job.id,binding:proof.binding,policyDigest:proof.policyDigest};
 store.data.set(reportPath('jobs',job.id),job);store.data.set(reportPath('controls',job.request.reportId),control);store.data.set(reportPath('policy','current'),global);
 store.data.set(reportPath('policy','one-agent-detail-bq'),source);store.data.set(reportPath('uatDetailIntents',job.id),intent);store.data.set(reportPath('uatDetailNativeProofs',job.id),proof);
 store.data.set(reportPath('heads','legacy-sentinel'),{publication:'unchanged'});
 const rows=[{featureKey:'daily_signin',accounts:2,devices:3,signals:4,successes:1,expectedErrors:0,failures:1,outcomeSignals:2,
  eventBreakdown:[{eventName:'auth_completed',signals:4,successes:1,expectedErrors:0,failures:1}]}];
 const saga={readProof:vi.fn(async()=>proof)} as any, native={readVerifiedRows:vi.fn(async()=>rows)} as any, auth=vi.fn(async()=>true);
 return {store,job,source,proof,saga,native,auth, publisher:new UatFeaturePartialPublisher(store,saga,native,auth,()=>now,true)};
}
it('is disabled by default without source or authority calls',async()=>{
 const f=fixture(), publisher=new UatFeaturePartialPublisher(f.store,f.saga,f.native,f.auth,()=>now);
 await expect(publisher.publish(f.job,new AbortController().signal)).rejects.toThrow();expect(f.auth).not.toHaveBeenCalled();expect(f.native.readVerifiedRows).not.toHaveBeenCalled();
});
it('writes an immutable private partial subset and leaves legacy heads untouched',async()=>{
 const f=fixture();await expect(f.publisher.publish(f.job,new AbortController().signal)).resolves.toEqual({state:'partial',id:f.job.id});
 const snapshot=f.store.data.get(reportPath('uatDetailPartialSnapshots',f.job.id)) as any;
 expect(snapshot).toMatchObject({kind:'uat-feature-subset',coverage:'partial',detail:{environment:'uat',source:{checkedAt:null,watermark:null}}});
 expect(snapshot.detail.rows.find((r:any)=>r.key==='sms_safety')).toMatchObject({state:'unavailable',counts:null});
 expect(f.store.data.get(reportPath('heads','legacy-sentinel'))).toEqual({publication:'unchanged'});
 await expect(f.publisher.publish(f.job,new AbortController().signal)).resolves.toEqual({state:'partial',id:f.job.id});
});
it('rejects revoked policy, stale worker, mismatched proof and conflicting snapshot',async()=>{
 for(const mode of ['policy','worker','proof','existing']) {
  const f=fixture();f.native.readVerifiedRows.mockImplementation(async()=>{
   if(mode==='policy') f.store.data.set(reportPath('policy','one-agent-detail-bq'),{...f.source,enabled:false});
   if(mode==='worker') f.store.data.set(reportPath('jobs',f.job.id),{...f.job,fence:2});
   if(mode==='proof') f.store.data.set(reportPath('uatDetailNativeProofs',f.job.id),{...f.proof,binding:'4'.repeat(64)});
   if(mode==='existing') f.store.data.set(reportPath('uatDetailPartialSnapshots',f.job.id),{schema:1,kind:'other'});
   return [];
  });
  await expect(f.publisher.publish(f.job,new AbortController().signal)).rejects.toThrow();
  if(mode!=='existing') expect(f.store.data.has(reportPath('uatDetailPartialSnapshots',f.job.id))).toBe(false);
  expect(f.store.data.get(reportPath('heads','legacy-sentinel'))).toEqual({publication:'unchanged'});
 }
});

it('withholds a response if authority changes after commit; private snapshot is not a public report',async()=>{
 const f=fixture(); f.auth.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
 await expect(f.publisher.publish(f.job,new AbortController().signal)).rejects.toThrow();
 expect(f.store.data.has(reportPath('uatDetailPartialSnapshots',f.job.id))).toBe(true);
 expect(f.store.data.get(reportPath('heads','legacy-sentinel'))).toEqual({publication:'unchanged'});
});
