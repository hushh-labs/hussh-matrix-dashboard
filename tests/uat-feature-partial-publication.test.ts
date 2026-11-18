import { expect, it, vi } from 'vitest';
import { digest, reportKey } from '../src/server/reports/contracts';
import { reportPath } from '../src/server/reports/store';
import { UatFeaturePartialPublisher } from '../src/server/reports/uat-feature-partial-publication';
import { UatFeaturePartialReader } from '../src/server/reports/uat-feature-partial-reader';
import { MemoryReportStore } from './helpers/metrics-report-memory-store';
import { UatFeatureLifecycle } from '../src/server/reports/uat-feature-lifecycle';
import { uatFeatureManifest } from '../src/server/reports/uat-feature-manifest';
const now=Date.parse('2026-11-19T12:00:00Z');
function fixture() {
 const store=new MemoryReportStore(), control={enabled:true,revision:1,sourceGeneration:'a'.repeat(64),scopeDigest:'b'.repeat(64),definitionVersion:'1',freshnessMs:1000,staleMs:2000};
 const job={id:'c'.repeat(64),key:'d'.repeat(64),status:'running',fence:1,workerHash:'e'.repeat(64),leaseUntil:now+60000,expiresAt:now+120000,acceptedAt:now-1000,sourceStarted:true,control,
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

it('reads only an authorized, scope-matching private subset with unknown freshness',async()=>{
 const f=fixture(), access={subjectHash:'9'.repeat(64),scopeDigest:f.job.control.scopeDigest};
 await f.publisher.publish(f.job,new AbortController().signal);
 const authorize=vi.fn(async()=>true), reader=new UatFeaturePartialReader(f.store,f.saga,authorize,()=>now,true);
 const result=await reader.read(f.job,access);expect(result).toMatchObject({state:'partial',freshness:'unknown',computedAt:now});
 expect(result.detail.rows.find(r=>r.key==='sms_safety')).toMatchObject({state:'unavailable',counts:null});
 expect(JSON.stringify(result)).not.toContain('nativeId');expect(authorize).toHaveBeenCalledTimes(2);
 expect(f.store.data.get(reportPath('heads','legacy-sentinel'))).toEqual({publication:'unchanged'});
});
it('fails closed on disabled, wrong scope, stale publication, proof drift or revoked authority',async()=>{
 for(const mode of ['disabled','scope','stale','proof','revoked']) {
  const f=fixture(), access={subjectHash:'9'.repeat(64),scopeDigest:f.job.control.scopeDigest};
  await f.publisher.publish(f.job,new AbortController().signal);
  const authorize=vi.fn(async()=>true); if(mode==='revoked') authorize.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  if(mode==='proof') f.store.data.set(reportPath('uatDetailNativeProofs',f.job.id),{...f.proof,binding:'4'.repeat(64)});
  const reader=new UatFeaturePartialReader(f.store,f.saga,authorize,()=>mode==='stale'?now+3000:now,mode!=='disabled');
  await expect(reader.read(f.job,mode==='scope'?{...access,scopeDigest:'8'.repeat(64)}:access)).rejects.toThrow();
  expect(f.store.data.get(reportPath('heads','legacy-sentinel'))).toEqual({publication:'unchanged'});
 }
});

it('completes a proof-bound partial report once and reads it under quota after lease expiry',async()=>{
 const f=fixture(), access={subjectHash:'9'.repeat(64),scopeDigest:f.job.control.scopeDigest};
 const config={project:'hushh-pda-uat',dataset:'analytics_533362555',webHost:'uat.one.hushh.ai',timezone:'UTC',startDate:'2026-11-18',endDate:'2026-11-18',maxPeriodDays:7};
 const {manifest,manifestDigest}=uatFeatureManifest(config);
 f.job.lane='custom'; f.job.requesterHash='8'.repeat(64);
 f.job.key=reportKey(f.job.request,f.job.control);
 f.source.queryHash=manifest.queryHash; f.proof.queryHash=manifest.queryHash; f.proof.policyDigest=digest(f.source);
 f.store.data.set(reportPath('jobs',f.job.id),f.job); f.store.data.set(reportPath('policy','one-agent-detail-bq'),f.source);
 f.store.data.set(reportPath('uatDetailNativeProofs',f.job.id),f.proof);
 f.store.data.set(reportPath('uatDetailIntents',f.job.id),{state:'complete',jobId:f.job.id,binding:f.proof.binding,policyDigest:f.proof.policyDigest});
 f.store.data.set(reportPath('policy','one-agent-detail-manifest'),{approved:true,enabled:true,config,manifestDigest});
 f.store.data.set(reportPath('heads',f.job.key),{sequence:1,activeJob:f.job.id,publication:null});
 f.store.data.set(reportPath('capacity','custom'),{active:1});
 f.store.data.set(reportPath('subjectCapacity',digest(['custom',f.job.requesterHash])),{active:1});
 await f.publisher.publish(f.job,new AbortController().signal);
 const lifecycle=new UatFeatureLifecycle(f.store,f.saga,f.auth,()=>now,true);
 f.store.data.set(reportPath('uatDetailNativeProofs',f.job.id),{...f.proof,binding:'4'.repeat(64)});
 await expect(lifecycle.complete(f.job,access)).rejects.toThrow();
 f.store.data.set(reportPath('uatDetailNativeProofs',f.job.id),f.proof);
 f.store.data.set(reportPath('policy','one-agent-detail-bq'),{...f.source,queryHash:'4'.repeat(64)});
 await expect(lifecycle.complete(f.job,access)).rejects.toThrow();
 f.store.data.set(reportPath('policy','one-agent-detail-bq'),f.source);
 await expect(lifecycle.complete(f.job,access)).resolves.toMatchObject({state:'partial'});
 expect(f.store.data.get(reportPath('capacity','custom'))).toEqual({active:0});
 await expect(lifecycle.complete(f.job,access)).rejects.toThrow();
 expect(f.store.data.get(reportPath('capacity','custom'))).toEqual({active:0});
 await expect(lifecycle.read(f.job,access)).resolves.toMatchObject({state:'partial',freshness:'unknown'});
 await expect(lifecycle.readCurrent(f.job.request,access)).resolves.toMatchObject({state:'partial',freshness:'unknown'});
 await expect(lifecycle.readCurrent({...f.job.request,reportId:'one.adoption'},access)).rejects.toThrow();
 f.store.data.set(reportPath('uatDetailNativeProofs',f.job.id),{...f.proof,queryHash:'4'.repeat(64)});
 await expect(lifecycle.read(f.job,access)).rejects.toThrow();
 f.store.data.set(reportPath('uatDetailNativeProofs',f.job.id),f.proof);
 f.store.data.set(reportPath('policy','one-agent-detail-manifest'),{approved:true,enabled:true,config,manifestDigest:'0'.repeat(64)});
 await expect(lifecycle.read(f.job,access)).rejects.toThrow();
 f.store.data.set(reportPath('policy','one-agent-detail-manifest'),{approved:true,enabled:true,config,manifestDigest});
 const lateReader=new UatFeatureLifecycle(f.store,f.saga,f.auth,()=>now+2001,true);
 await expect(lateReader.read(f.job,access)).rejects.toThrow();
 const quotaKey=digest([access.subjectHash,'read',Math.floor(now/60000)]);
 f.store.data.set(reportPath('quotas',quotaKey),{count:10,windowEndsAt:now+60000});
 await expect(lifecycle.read(f.job,access)).rejects.toThrow('quota');
 f.store.data.set(reportPath('quotas',quotaKey),{count:0,windowEndsAt:now+60000});
 const denied=new UatFeatureLifecycle(f.store,f.saga,async()=>false,()=>now,true);
 await expect(denied.read(f.job,access)).rejects.toThrow('unauthorized');
 f.store.data.set(reportPath('controls',f.job.request.reportId),{...f.job.control,enabled:false});
 await expect(lifecycle.read(f.job,access)).rejects.toThrow();
 expect(f.store.data.get(reportPath('heads','legacy-sentinel'))).toEqual({publication:'unchanged'});
});
