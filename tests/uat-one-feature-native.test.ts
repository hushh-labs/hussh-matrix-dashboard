import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { UatFeatureNative } from '../src/server/uat-one-feature-native';
import { StagedUatDetailQuery } from '../src/server/reports/staged-uat-detail-query';
import { buildUatFeaturePlan } from '../src/server/uat-one-feature-plan';
import { digest } from '../src/server/reports/contracts';
import { reportPath } from '../src/server/reports/store';
import { MemoryReportStore } from './helpers/metrics-report-memory-store';
const sha=(s:string)=>createHash('sha256').update(s).digest('hex'), now=Date.parse('2026-11-19T12:00:00Z');
const config={project:'hushh-pda-uat',dataset:'analytics_533362555',webHost:'uat.one.hushh.ai',timezone:'UTC',startDate:'2026-11-18',endDate:'2026-11-18',maxPeriodDays:7};
const plan=buildUatFeaturePlan(config), project='hushh-ai-prod';
const refs=[{projectId:config.project,datasetId:config.dataset,tableId:'events_*'},{projectId:config.project,datasetId:config.dataset,tableId:'INFORMATION_SCHEMA.TABLES'}].sort((a,b)=>a.tableId.localeCompare(b.tableId));
const catalogue=[{id:'events_20261118',type:'TABLE'}], referenceDigest=sha(JSON.stringify({refs,catalog:catalogue}));
const globalPolicy={approved:true,computeEnabled:true,quotaWindowMs:60000,readRequests:10,statusRequests:10,computeRequests:10,customCapacity:2,scheduledCapacity:0,customPerSubjectCapacity:1,maxPeriodDays:90,leaseMs:60000,jobLifetimeMs:120000,maxSnapshotBytes:900000};
function setup() {
 let time=now, tables=[{id:'events_20261118',metadata:{type:'TABLE'}}];
 const dry={jobReference:{projectId:project,location:'US'},configuration:{query:{query:plan.query,useLegacySql:false,useQueryCache:true}},statistics:{totalBytesProcessed:'0',query:{statementType:'SELECT',totalBytesProcessedAccuracy:'PRECISE',referencedTables:refs}}};
 const create=vi.fn(async (request:any)=> request.dryRun ? [{metadata:dry}] : [{}]);
 const client={createQueryJob:create,dataset:vi.fn(()=>({getTables:vi.fn(async()=>[tables,null])})),job:vi.fn()};
 const factory=vi.fn(()=>client as any), budget={confirmBound:vi.fn(async()=>{})}, store=new MemoryReportStore();
 const control={enabled:true,revision:1,sourceGeneration:'a'.repeat(64),scopeDigest:'b'.repeat(64),definitionVersion:'1',freshnessMs:1000,staleMs:2000};
 const job={id:'c'.repeat(64),key:'d'.repeat(64),status:'running',fence:1,workerHash:'e'.repeat(64),leaseUntil:now+60000,expiresAt:now+120000,control,
  request:{reportId:'one.agent-detail-uat',startDate:config.startDate,endDate:config.endDate,timezone:config.timezone}} as any;
 const policy={approved:true,enabled:true,environment:'uat',project,location:'US',queryHash:plan.queryHash,referenceDigest,sourceGeneration:control.sourceGeneration,
  scopeDigest:control.scopeDigest,startDate:config.startDate,endDate:config.endDate,timezone:config.timezone,expiresAt:now+60000,maxBytes:30*1024**2};
 const bytes=20*1024**2, policyDigest=digest(policy), day='2026-11-19';
 const binding=digest([job.id,job.key,job.request,job.control,policy.environment,policy.project,policy.location,policy.queryHash,policyDigest,day,bytes]);
 const nativeId='metrics_detail_'+sha(binding);
 const intent={state:'started',jobId:job.id,fence:job.fence,workerHash:job.workerHash,day,binding,nativeId,queryHash:plan.queryHash,project,bytes,policyDigest,startedAt:now};
 store.data.set(reportPath('jobs',job.id),job);store.data.set(reportPath('controls',job.request.reportId),control);
 store.data.set(reportPath('policy','current'),globalPolicy);store.data.set(reportPath('policy','one-agent-detail-bq'),policy);store.data.set(reportPath('uatDetailIntents',job.id),intent);
 const auth=vi.fn(async()=>true), adapter=new UatFeatureNative(config,plan.queryHash,referenceDigest,budget as any,store,auth,()=>time,factory as any);
 const request={sql:plan.query,id:nativeId,jobId:job.id,day,binding,project,location:'US' as const,queryHash:plan.queryHash,useLegacySql:false as const,maximumBytesBilled:bytes,signal:new AbortController().signal};
 return {adapter,client,create,factory,budget,store,job,policy,dry,request,auth,setTables:(value:any)=>{tables=value;},setTime:(value:number)=>{time=value;}};
}
it('uses no SDK retry and requires an exact canonical reservation before the one paid create',async()=>{
 const f=setup();const e=await f.adapter.estimate(plan.query,new AbortController().signal);expect(e.bound).toBe(20*1024**2);
 expect(f.factory).toHaveBeenCalledWith({projectId:project,autoRetry:false,maxRetries:0});
 f.budget.confirmBound.mockRejectedValueOnce(Error('unavailable'));await expect(f.adapter.submit(f.request)).rejects.toThrow();expect(f.create).toHaveBeenCalledTimes(1);
 await f.adapter.submit(f.request);expect(f.create).toHaveBeenCalledTimes(2);
 expect(f.create.mock.calls[1][0]).toMatchObject({query:plan.query,jobId:f.request.id,location:'US',useLegacySql:false,maximumBytesBilled:String(e.bound)});
});
it('rejects wrong source table and imprecise/non-SELECT metadata before paid work',async()=>{
 for(const change of ['table','accuracy','statement']) {const f=setup();
  if(change==='table') f.dry.statistics.query.referencedTables=[{projectId:'hushh-ai-prod',datasetId:config.dataset,tableId:'events_*'}];
  if(change==='accuracy') f.dry.statistics.query.totalBytesProcessedAccuracy='UNKNOWN';
  if(change==='statement') f.dry.statistics.query.statementType='SCRIPT';
  await expect(f.adapter.estimate(plan.query,new AbortController().signal)).rejects.toThrow();expect(f.create).toHaveBeenCalledTimes(1);
 }
});
it('holds on table catalog drift or worker expiry before create',async()=>{
 const f=setup();await f.adapter.estimate(plan.query,new AbortController().signal);f.setTables([{id:'events_20261118',metadata:{type:'TABLE'}},{id:'events_intraday_20261118',metadata:{type:'TABLE'}}]);
 await expect(f.adapter.submit(f.request)).rejects.toThrow();expect(f.create).toHaveBeenCalledTimes(1);
 const g=setup();await g.adapter.estimate(plan.query,new AbortController().signal);g.setTime(now+60001);await expect(g.adapter.submit(g.request)).rejects.toThrow();expect(g.create).toHaveBeenCalledTimes(1);
});

it('integrates the staged saga and native adapter without replay on missing native metadata',async()=>{
 const f=setup(); f.store.data.delete(reportPath('uatDetailIntents',f.job.id));
 let reserved:any; const ledger={reserve:vi.fn(async(r:any)=>{reserved=structuredClone(r);}),
   confirmBound:vi.fn(async(r:any)=>{if(JSON.stringify(r)!==JSON.stringify(reserved)) throw Error('mismatch');})};
 f.client.job.mockReturnValue({getMetadata:vi.fn(async()=>{throw Object.assign(new Error('missing'),{code:404});})});
 const native=new UatFeatureNative(config,plan.queryHash,referenceDigest,ledger as any,f.store,f.auth,()=>now,f.factory as any);
 const saga=new StagedUatDetailQuery(f.store,ledger,native,f.auth,()=>now);
 await saga.prepare(f.job,plan.query,new AbortController().signal); await saga.reserve(f.job);
 await saga.submit(f.job,plan.query,new AbortController().signal);
 expect((f.store.data.get(reportPath('uatDetailIntents',f.job.id)) as any).state).toBe('dispatching');
 await expect(saga.recover(f.job)).resolves.toEqual({state:'uncertain'});
 await expect(saga.submit(f.job,plan.query,new AbortController().signal)).rejects.toThrow();
 expect(f.create).toHaveBeenCalledTimes(2); expect(ledger.reserve).toHaveBeenCalledOnce();
});

it('holds an incomplete or cycling catalog and never submits a paid job',async()=>{
 const f=setup(); f.client.dataset.mockReturnValue({getTables:vi.fn(async()=>[[{id:'events_20261118',metadata:{type:'TABLE'}}],{pageToken:'same'}])} as any);
 await expect(f.adapter.estimate(plan.query,new AbortController().signal)).rejects.toThrow(); expect(f.create).toHaveBeenCalledTimes(1);
});
it('recovery validates exact native query and returns null for 404 without creating',async()=>{
 const f=setup(), id=f.request.id;
 f.client.job.mockReturnValueOnce({getMetadata:vi.fn(async()=>{throw Object.assign(new Error('missing'),{code:404});})});
 await expect(f.adapter.lookup(id)).resolves.toBeNull();
 f.client.job.mockReturnValueOnce({getMetadata:vi.fn(async()=>[{jobReference:{jobId:id,projectId:project,location:'US'},
  configuration:{query:{query:'SELECT 2',useLegacySql:false,useQueryCache:true,maximumBytesBilled:'100'}},
  status:{state:'DONE'},statistics:{endTime:String(now),query:{statementType:'SELECT',totalBytesBilled:'1'}}}])});
 await expect(f.adapter.lookup(id)).rejects.toThrow(); expect(f.create).not.toHaveBeenCalled();
});
