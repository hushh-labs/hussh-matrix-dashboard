import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { FirestoreQueryBudgetStore } from '../src/server/bigquery-cost-control';
import { StagedUatDetailQuery } from '../src/server/reports/staged-uat-detail-query';
import { reportPath } from '../src/server/reports/store';
import { MemoryReportStore } from './helpers/metrics-report-memory-store';
const hash=(v:string)=>createHash('sha256').update(v).digest('hex'), sql='SELECT 1', now=Date.parse('2026-11-19T12:00:00Z');
class DB { values=new Map<string,any>(); doc(path:string):any{return {path,collection:(n:string)=>({doc:(id:string)=>this.doc(`${path}/${n}/${id}`)})};}
 async runTransaction<T>(fn:(tx:any)=>Promise<T>){const next=new Map(this.values);const tx={getAll:async(...refs:any[])=>refs.map(r=>({exists:next.has(r.path),data:()=>next.get(r.path)})),
 set:(r:any,v:any)=>next.set(r.path,v),create:(r:any,v:any)=>{if(next.has(r.path))throw Error('duplicate');next.set(r.path,v);}};const out=await fn(tx);this.values=next;return out;} }
function fixture() {
 let time=now; const store=new MemoryReportStore(), db=new DB(), canonical=new FirestoreQueryBudgetStore(db as any);
 const policy={approved:true,computeEnabled:true,quotaWindowMs:60000,readRequests:10,statusRequests:10,computeRequests:10,customCapacity:2,scheduledCapacity:0,customPerSubjectCapacity:1,maxPeriodDays:90,leaseMs:60000,jobLifetimeMs:120000,maxSnapshotBytes:900000};
 const control={enabled:true,revision:1,sourceGeneration:'a'.repeat(64),scopeDigest:'b'.repeat(64),definitionVersion:'1',freshnessMs:1000,staleMs:2000};
 const job={id:'c'.repeat(64),key:'d'.repeat(64),status:'running',fence:1,workerHash:'e'.repeat(64),leaseUntil:now+60000,expiresAt:now+120000,sourceStarted:true,control,
  request:{reportId:'one.agent-detail-uat',startDate:'2026-11-18',endDate:'2026-11-18',timezone:'UTC'}} as any;
 const approved={approved:true,enabled:true,environment:'uat',project:'hushh-ai-prod',location:'US',queryHash:hash(sql),referenceDigest:'f'.repeat(64),sourceGeneration:control.sourceGeneration,scopeDigest:control.scopeDigest,startDate:'2026-11-18',endDate:'2026-11-18',timezone:'UTC',expiresAt:now+60000,maxBytes:1000};
 store.data.set(reportPath('policy','current'),policy);store.data.set(reportPath('policy','one-agent-detail-bq'),approved);
 store.data.set(reportPath('jobs',job.id),job);store.data.set(reportPath('controls',job.request.reportId),control);
 const native={estimate:vi.fn(async()=>({queryHash:hash(sql),project:'hushh-ai-prod',location:'US',statementType:'SELECT',referenceDigest:'f'.repeat(64),accuracy:'PRECISE',processed:70,referencedFloor:100,bound:100})),
  submit:vi.fn(async(_request:{id:string})=>{}),lookup:vi.fn(async()=>null as any)};
 const saga=new StagedUatDetailQuery(store,canonical,native,async()=>true,()=>time);return {store,db,canonical,job,policy,approved,native,saga,time:(v:number)=>{time=v;}};
}
describe('isolated staged UAT detail query prototype',()=>{
 it('fails closed without explicit policy or compute permission before native work',async()=>{
  const f=fixture();f.store.data.delete(reportPath('policy','one-agent-detail-bq'));
  const auth=vi.fn(async()=>true), saga=new StagedUatDetailQuery(f.store,f.canonical,f.native,auth,()=>now);
  await expect(saga.prepare(f.job,sql,new AbortController().signal)).rejects.toThrow();expect(auth).not.toHaveBeenCalled();
  expect(f.native.estimate).not.toHaveBeenCalled();expect(f.native.submit).not.toHaveBeenCalled();
 });
 it('reserves the canonical ledger before a single submission and never resubmits on 404',async()=>{
  const f=fixture();await f.saga.prepare(f.job,sql,new AbortController().signal);await expect(f.saga.reserve(f.job)).resolves.toEqual({state:'reserved'});
  await f.saga.submit(f.job,sql,new AbortController().signal);expect(f.native.submit).toHaveBeenCalledOnce();
  expect(f.native.submit).toHaveBeenCalledWith({id:expect.stringMatching(/^metrics_detail_/),jobId:f.job.id,day:'2026-11-19',binding:expect.stringMatching(/^[a-f0-9]{64}$/),project:'hushh-ai-prod',location:'US',queryHash:hash(sql),useLegacySql:false,maximumBytesBilled:100,signal:expect.any(AbortSignal)});
  await expect(f.saga.recover(f.job)).resolves.toEqual({state:'uncertain'});expect(f.native.submit).toHaveBeenCalledOnce();
  await expect(f.saga.submit(f.job,sql,new AbortController().signal)).rejects.toThrow();
  expect(f.db.values.get('metricsQueryBudgetDays/2026-11-19')).toMatchObject({bytes:100,statements:1});
 });
 it('rejects a non-SELECT plan or changed referenced-table digest',async()=>{
  for(const change of [{statementType:'SCRIPT'}, {referenceDigest:'9'.repeat(64)}]) {
    const f=fixture();f.native.estimate.mockResolvedValueOnce({queryHash:hash(sql),project:'hushh-ai-prod',location:'US',
      statementType:'SELECT',referenceDigest:'f'.repeat(64),accuracy:'PRECISE',processed:70,referencedFloor:100,bound:100,...change});
    await expect(f.saga.prepare(f.job,sql,new AbortController().signal)).rejects.toThrow();expect(f.native.submit).not.toHaveBeenCalled();
  }
 });
 it('retains a started intent after submission acknowledgement is lost',async()=>{
  const f=fixture();await f.saga.prepare(f.job,sql,new AbortController().signal);await f.saga.reserve(f.job);
  f.native.submit.mockRejectedValueOnce(new Error('lost ack'));await expect(f.saga.submit(f.job,sql,new AbortController().signal)).rejects.toThrow();
  await expect(f.saga.recover(f.job)).resolves.toEqual({state:'uncertain'});expect(f.native.submit).toHaveBeenCalledOnce();
 });
 it('rejects a policy period mismatch before estimating',async()=>{
  const f=fixture(); f.store.data.set(reportPath('policy','one-agent-detail-bq'),{...f.approved,startDate:'2026-11-17'});
  await expect(f.saga.prepare(f.job,sql,new AbortController().signal)).rejects.toThrow(); expect(f.native.estimate).not.toHaveBeenCalled();
 });
 it.each(['lease','midnight','policy'])('holds an already-started reservation if %s changes during authority wait',async(mode)=>{
  const f=fixture(); let calls=0, armed=false, currentTime=now;
  const authority=async()=>{ if (armed && ++calls===2) {
    if(mode==='lease') currentTime=now+60001;
    if(mode==='midnight') currentTime=Date.parse('2026-11-20T00:00:00Z');
    if(mode==='policy') f.store.data.set(reportPath('policy','one-agent-detail-bq'),{...f.approved,enabled:false});
   } return true; };
  const saga=new StagedUatDetailQuery(f.store,f.canonical,f.native,authority,()=>currentTime);
  await saga.prepare(f.job,sql,new AbortController().signal);await saga.reserve(f.job);
  // Activate the simulated change only for submit's second authority check.
  armed=true;
  await expect(saga.submit(f.job,sql,new AbortController().signal)).rejects.toThrow();
  expect(f.native.submit).not.toHaveBeenCalled();
  expect((f.store.data.get(reportPath('uatDetailIntents',f.job.id)) as any).state).toBe('started');
 });
 it('samples the worker clock after delayed transaction reads',async()=>{
  const f=fixture(); let armed=false, clock=now;
  const delayed={transaction:<T>(fn:(tx:any)=>Promise<T>)=>f.store.transaction(tx=>fn({...tx,get:async(path:string)=>{
    const value=await tx.get(path); if(armed && path===reportPath('policy','current')) clock=now+60001; return value;
  }}))};
  const saga=new StagedUatDetailQuery(delayed,f.canonical,f.native,async()=>true,()=>clock);
  await saga.prepare(f.job,sql,new AbortController().signal);await saga.reserve(f.job);armed=true;
  await expect(saga.submit(f.job,sql,new AbortController().signal)).rejects.toThrow();expect(f.native.submit).not.toHaveBeenCalled();
 });
 it('holds a lost reservation acknowledgment until an exact read-only confirmation',async()=>{
  const f=fixture(); const budget={reserve:vi.fn(async(r:any)=>{await f.canonical.reserve(r);throw Error('lost ack');}),confirmBound:vi.fn((r:any)=>f.canonical.confirmBound(r))};
  const saga=new StagedUatDetailQuery(f.store,budget,f.native,async()=>true,()=>now);await saga.prepare(f.job,sql,new AbortController().signal);
  await expect(saga.reserve(f.job)).resolves.toEqual({state:'uncertain'});expect(f.native.submit).not.toHaveBeenCalled();
  await expect(saga.confirm(f.job)).resolves.toEqual({state:'reserved'});expect(budget.reserve).toHaveBeenCalledOnce();
 });
 it('rejects mismatched plans, insufficient floor and expired fence before submission',async()=>{
  const f=fixture();await expect(f.saga.prepare(f.job,'SELECT 2',new AbortController().signal)).rejects.toThrow();expect(f.native.estimate).not.toHaveBeenCalled();
  f.native.estimate.mockResolvedValueOnce({queryHash:hash(sql),project:'hushh-ai-prod',location:'US',statementType:'SELECT',referenceDigest:'f'.repeat(64),accuracy:'PRECISE',processed:70,referencedFloor:101,bound:100});
  await expect(f.saga.prepare(f.job,sql,new AbortController().signal)).rejects.toThrow();
  await f.saga.prepare(f.job,sql,new AbortController().signal);await f.saga.reserve(f.job);f.time(now+60001);
  await expect(f.saga.submit(f.job,sql,new AbortController().signal)).rejects.toThrow();expect(f.native.submit).not.toHaveBeenCalled();
 });
 it('allows only one submit across concurrent instances and holds mismatched intent',async()=>{
  const f=fixture();await f.saga.prepare(f.job,sql,new AbortController().signal);await f.saga.reserve(f.job);
  const second=new StagedUatDetailQuery(f.store,f.canonical,f.native,async()=>true,()=>now);
  const attempts=await Promise.allSettled([f.saga.submit(f.job,sql,new AbortController().signal),second.submit(f.job,sql,new AbortController().signal)]);
  expect(attempts.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(f.native.submit).toHaveBeenCalledOnce();
 });
 it('does not dispatch after an unconfirmed canonical reservation',async()=>{
  const f=fixture();const budget={reserve:vi.fn(async()=>{throw Error('unknown');}),confirmBound:vi.fn(async()=>{throw Error('missing');})};
  const saga=new StagedUatDetailQuery(f.store,budget,f.native,async()=>true,()=>now);
  await saga.prepare(f.job,sql,new AbortController().signal);await expect(saga.reserve(f.job)).resolves.toEqual({state:'uncertain'});
  await expect(saga.confirm(f.job)).resolves.toEqual({state:'uncertain'});await expect(saga.submit(f.job,sql,new AbortController().signal)).rejects.toThrow();
  expect(budget.reserve).toHaveBeenCalledOnce();expect(f.native.submit).not.toHaveBeenCalled();
 });
 it('rejects a tampered reserved intent before dispatch',async()=>{
  const f=fixture();await f.saga.prepare(f.job,sql,new AbortController().signal);await f.saga.reserve(f.job);
  const path=reportPath('uatDetailIntents',f.job.id), intent=f.store.data.get(path) as any;
  f.store.data.set(path,{...intent,bytes:99});await expect(f.saga.submit(f.job,sql,new AbortController().signal)).rejects.toThrow();
  expect(f.native.submit).not.toHaveBeenCalled();
 });
 it('allows a newly fenced worker to reconcile after midnight without another submission or refund',async()=>{
  const f=fixture();await f.saga.prepare(f.job,sql,new AbortController().signal);await f.saga.reserve(f.job);await f.saga.submit(f.job,sql,new AbortController().signal);
  const id=f.native.submit.mock.calls[0][0].id, later=Date.parse('2026-11-20T00:01:00Z'); f.time(later);
  const renewed={...f.job,fence:2,workerHash:'f'.repeat(64),leaseUntil:later+60000}; f.store.data.set(reportPath('jobs',f.job.id),renewed);
  f.native.lookup.mockResolvedValueOnce(null); await expect(f.saga.recover(renewed)).resolves.toEqual({state:'uncertain'});
  f.native.lookup.mockResolvedValueOnce({id,queryHash:hash(sql),project:'hushh-ai-prod',location:'US',useLegacySql:false,maximumBytesBilled:100,state:'DONE',error:false,billed:80,endedAt:now+1000});
  await expect(f.saga.recover(renewed)).resolves.toEqual({state:'complete',billed:80,endedAt:now+1000});
  expect(f.native.submit).toHaveBeenCalledOnce();expect(f.db.values.get('metricsQueryBudgetDays/2026-11-19')).toMatchObject({bytes:100,statements:1});
  const proof=await f.saga.readProof(renewed);expect(proof).toMatchObject({nativeId:id,billed:80,bytes:100});
  const path=reportPath('uatDetailNativeProofs',renewed.id); f.store.data.set(path,{...proof,billed:101});
  await expect(f.saga.readProof(renewed)).rejects.toThrow();
 });
 it('does not recover with a stale or unauthorized worker fence',async()=>{
  const f=fixture();await f.saga.prepare(f.job,sql,new AbortController().signal);await f.saga.reserve(f.job);await f.saga.submit(f.job,sql,new AbortController().signal);
  f.store.data.set(reportPath('jobs',f.job.id),{...f.job,fence:2,workerHash:'f'.repeat(64)});
  await expect(f.saga.recover(f.job)).rejects.toThrow(); expect(f.native.lookup).not.toHaveBeenCalled();
 });
 it('reconciles only exact DONE metadata within the per-job billed bound',async()=>{
  const f=fixture();await f.saga.prepare(f.job,sql,new AbortController().signal);await f.saga.reserve(f.job);await f.saga.submit(f.job,sql,new AbortController().signal);
  const id=f.native.submit.mock.calls[0][0].id, good={id,queryHash:hash(sql),project:'hushh-ai-prod',location:'US',useLegacySql:false,maximumBytesBilled:100,state:'DONE',error:false,billed:101,endedAt:now};
  f.native.lookup.mockResolvedValueOnce(good);await expect(f.saga.recover(f.job)).resolves.toEqual({state:'uncertain'});
  f.native.lookup.mockResolvedValueOnce({...good,billed:80});await expect(f.saga.recover(f.job)).resolves.toEqual({state:'complete',billed:80,endedAt:now});
 });
});
