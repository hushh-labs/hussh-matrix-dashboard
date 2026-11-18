import { expect, it, vi } from 'vitest';
import { digest } from '../src/server/reports/contracts';
import { reportPath } from '../src/server/reports/store';
import { uatTwoSourceManifest } from '../src/server/reports/uat-two-source-manifest';
import { UatTwoSourceReservations } from '../src/server/reports/uat-two-source-reservations';
import { MemoryReportStore } from './helpers/metrics-report-memory-store';
import type { QueryBudgetReservation } from '../src/server/bigquery-cost-control';
const now=Date.parse('2026-11-19T00:00:00Z'), config={project:'hushh-pda-uat',dataset:'analytics_533362555',webHost:'uat.one.hushh.ai',timezone:'UTC',startDate:'2026-11-18',endDate:'2026-11-18',maxPeriodDays:7};
function fixture() {
 const store=new MemoryReportStore(), scopeDigest='a'.repeat(64),sourceGeneration='b'.repeat(64), {manifest,manifestDigest}=uatTwoSourceManifest(config,scopeDigest,sourceGeneration);
 const control={enabled:true,scopeDigest,sourceGeneration},job={id:'c'.repeat(64),key:'d'.repeat(64),status:'running',fence:1,workerHash:'e'.repeat(64),leaseUntil:now+1000,expiresAt:now+2000,sourceStarted:true,control,request:{reportId:'one.agent-detail-uat',startDate:config.startDate,endDate:config.endDate,timezone:'UTC'}} as any;
 const base={approved:true,enabled:true,environment:'uat',project:'hushh-ai-prod',location:'US',referenceDigest:'f'.repeat(64),scopeDigest,sourceGeneration,startDate:config.startDate,endDate:config.endDate,timezone:'UTC',expiresAt:now+1000,maxBytes:1000};
 const policy={approved:true,enabled:true,config,scopeDigest,sourceGeneration,manifestDigest,feature:{...base,queryHash:manifest.featureQueryHash},location:{...base,queryHash:manifest.locationQueryHash}};
 const estimate=(queryHash:string)=>({queryHash,project:'hushh-ai-prod',location:'US',statementType:'SELECT',referenceDigest:base.referenceDigest,accuracy:'PRECISE',processed:10,referencedFloor:20,bound:20});
 const estimates={feature:estimate(manifest.featureQueryHash),location:estimate(manifest.locationQueryHash)};
 store.data.set(reportPath('jobs',job.id),job);store.data.set(reportPath('controls',job.request.reportId),control);store.data.set(reportPath('policy','one-agent-detail-two-source'),policy);
 store.data.set(reportPath('policy','current'),{approved:true,computeEnabled:true,quotaWindowMs:60000,readRequests:10,statusRequests:10,computeRequests:10,customCapacity:2,scheduledCapacity:0,customPerSubjectCapacity:1,maxPeriodDays:90,leaseMs:1000,jobLifetimeMs:2000,maxSnapshotBytes:900000});
 const budget={reserve:vi.fn(async(_r:QueryBudgetReservation)=>{}),confirmBound:vi.fn(async(_r:QueryBudgetReservation)=>{})};
 return {store,job,estimates,budget,runner:new UatTwoSourceReservations(store,budget,()=>now,true)};
}
it('reserves two distinct bound IDs once and fails closed on replay',async()=>{
 const f=fixture(); expect(await f.runner.reserve(f.job,f.estimates)).toEqual({state:'reservations_observed'});
 expect(f.budget.reserve).toHaveBeenCalledTimes(2); const [a,b]=f.budget.reserve.mock.calls.map(x=>x[0] as any);
 expect(a.id).not.toBe(b.id);expect(a.binding).not.toBe(b.binding);expect(a.id).toMatch(/^metrics_/);
 expect(await f.runner.reserve(f.job,f.estimates)).toEqual({state:'uncertain'});expect(f.budget.reserve).toHaveBeenCalledTimes(2);
 expect(await f.runner.confirm(f.job)).toEqual({state:'confirmed'});expect(f.budget.confirmBound).toHaveBeenCalledTimes(4);
});
it('never confirms durable state if either canonical lookup is uncertain or policy changes after lookup',async()=>{
 const f=fixture(); await f.runner.reserve(f.job,f.estimates); f.budget.confirmBound.mockRejectedValueOnce(new Error('unknown'));
 expect(await f.runner.confirm(f.job)).toEqual({state:'uncertain'});
 expect((await f.store.transaction(tx=>tx.get<any>(reportPath('uatTwoSourceIntents',f.job.id))))?.state).toBe('reserving');
 f.budget.confirmBound.mockImplementationOnce(async()=>{ const k=reportPath('policy','current');f.store.data.set(k,{...(f.store.data.get(k) as any),computeEnabled:false}); });
 await expect(f.runner.confirm(f.job)).rejects.toThrow();
 expect((await f.store.transaction(tx=>tx.get<any>(reportPath('uatTwoSourceIntents',f.job.id))))?.state).toBe('reserving');
});
it('retains the intent after a failed or unknown grant and never dispatches or retries it',async()=>{
 const f=fixture(); f.budget.reserve.mockRejectedValueOnce(new Error('budget exhausted or acknowledgement lost'));
 expect(await f.runner.reserve(f.job,f.estimates)).toEqual({state:'uncertain'});
 expect(await f.runner.reserve(f.job,f.estimates)).toEqual({state:'uncertain'});expect(f.budget.reserve).toHaveBeenCalledOnce();
 expect(await f.store.transaction(tx=>tx.get(reportPath('uatTwoSourceIntents',f.job.id)))).not.toBeNull();
 expect(digest(f.estimates.feature)).not.toBe(digest(f.estimates.location));
});
it('stops before the second reservation if policy is revoked between grants',async()=>{
 const f=fixture(); f.budget.confirmBound.mockImplementationOnce(async()=>{
  const key=reportPath('policy','current'); const current=f.store.data.get(key) as any;
  f.store.data.set(key,{...current,computeEnabled:false});
 });
 expect(await f.runner.reserve(f.job,f.estimates)).toEqual({state:'uncertain'});
 expect(f.budget.reserve).toHaveBeenCalledOnce();
});
