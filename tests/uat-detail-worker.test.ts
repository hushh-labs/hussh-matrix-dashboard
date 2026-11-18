import { expect, it, vi } from 'vitest';
import { UatDetailWorker } from '../src/server/reports/uat-detail-worker';
const config={project:'hushh-pda-uat',dataset:'analytics_533362555',webHost:'uat.one.hushh.ai',timezone:'UTC',startDate:'2026-11-18',endDate:'2026-11-18',maxPeriodDays:7};
const job={} as any, signal=new AbortController().signal;
function mock(state:string) { return {inspect:vi.fn(async()=>state),prepare:vi.fn(async()=>{}),reserve:vi.fn(async()=>({state:'reserved'})),
 confirm:vi.fn(async()=>({state:'uncertain'})),submit:vi.fn(async()=>({state:'started'})),recover:vi.fn(async()=>({state:'uncertain'})),readProof:vi.fn(async()=>({proof:'synthetic'}))} as any; }
it('is disabled by default without inspecting or invoking a source',async()=>{
 const saga=mock('new'), worker=new UatDetailWorker(saga,config);
 await expect(worker.advance(job,signal)).rejects.toThrow();expect(saga.inspect).not.toHaveBeenCalled();expect(saga.prepare).not.toHaveBeenCalled();
});
it('reclaimed jobs never start or reserve work from a missing or pre-dispatch journal',async()=>{
 for(const state of ['new','prepared','reserving','reserved']) {
  const saga=mock(state), worker=new UatDetailWorker(saga,config,true);
  await expect(worker.advance(job,signal,true)).rejects.toThrow();
  for(const name of ['prepare','reserve','confirm','submit','recover','readProof']) expect(saga[name]).not.toHaveBeenCalled();
 }
 for(const state of ['started','dispatching']) { const saga=mock(state); await new UatDetailWorker(saga,config,true).advance(job,signal,true); expect(saga.recover).toHaveBeenCalledOnce(); }
});
it('performs one explicit operation and never resubmits uncertain work',async()=>{
 for (const [state,method] of [['new','prepare'],['prepared','reserve'],['reserving','confirm'],['reserved','submit'],['started','recover'],['dispatching','recover'],['complete','readProof']] as const) {
  const saga=mock(state), worker=new UatDetailWorker(saga,config,true);await worker.advance(job,signal);
  expect(saga[method]).toHaveBeenCalledOnce();
  for(const other of ['prepare','reserve','confirm','submit','recover','readProof']) if(other!==method) expect(saga[other]).not.toHaveBeenCalled();
 }
});
