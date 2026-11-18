import { expect, it, vi } from 'vitest';
import request from 'supertest';
import { uatDetailServer } from '../src/server/reports/uat-detail-http';
import { ReportError } from '../src/server/reports/contracts';
it('is disabled by default and rejects malformed or unauthorized requests without dispatch',async()=>{
 const execute=vi.fn(async()=>{throw new ReportError('unauthorized');}), deliver=vi.fn(async()=>({state:'queued'}));
 expect(()=>uatDetailServer({enabled:false,maxRequestBytes:1024,maxResponseBytes:1024,timeoutMs:1000},{execute} as any,{deliver} as any)).toThrow();
 const server=uatDetailServer({enabled:true,maxRequestBytes:1024,maxResponseBytes:1024,timeoutMs:1000},{execute} as any,{deliver} as any);
 await request(server).post('/internal/metrics/uat-detail/collect').send({jobId:'a'.repeat(64)}).expect(401);
 await request(server).post('/internal/metrics/uat-detail/collect').set('Authorization','Bearer bad').send({jobId:'a'.repeat(64)}).expect(401);
 await request(server).post('/internal/metrics/uat-detail/dispatch').set('Authorization','Bearer token').send({jobId:'bad'}).expect(400);
 expect(execute).toHaveBeenCalledOnce(); expect(deliver).not.toHaveBeenCalled();
 const response=await request(server).post('/internal/metrics/uat-detail/dispatch').set('Authorization','Bearer token').send({jobId:'a'.repeat(64)}).expect(200);
 expect(response.headers['cache-control']).toContain('no-store'); expect(deliver).toHaveBeenCalledOnce();
});
it('signals an in-flight operation on deadline and returns a sanitized unavailable result',async()=>{
 const execute=vi.fn(async(_token:string,_jobId:string,signal:AbortSignal)=>new Promise((_resolve,reject)=>{
  signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});
 }));
 const server=uatDetailServer({enabled:true,maxRequestBytes:1024,maxResponseBytes:1024,timeoutMs:30},{execute} as any,{deliver:vi.fn()} as any);
 const result=await request(server).post('/internal/metrics/uat-detail/collect').set('Authorization','Bearer token').send({jobId:'a'.repeat(64)}).expect(503);
 expect(result.body).toEqual({state:'unavailable'}); expect(execute).toHaveBeenCalledOnce();
});
it('responds on deadline even if an injected operation ignores cancellation',async()=>{
 let finish!:()=>void; const pending=new Promise<void>(resolve=>{finish=resolve;});
 const execute=vi.fn(async()=>{await pending; return {state:'late'};});
 const server=uatDetailServer({enabled:true,maxRequestBytes:1024,maxResponseBytes:1024,timeoutMs:30},{execute} as any,{deliver:vi.fn()} as any);
 const response=await request(server).post('/internal/metrics/uat-detail/collect').set('Authorization','Bearer token').send({jobId:'a'.repeat(64)}).expect(503);
 expect(response.body).toEqual({state:'unavailable'}); finish();
});

it('fails closed with a sanitized response when a result exceeds the byte bound',async()=>{
 const server=uatDetailServer({enabled:true,maxRequestBytes:1024,maxResponseBytes:64,timeoutMs:1000},
  {execute:vi.fn(async()=>({value:'é'.repeat(40)}))} as any,{deliver:vi.fn()} as any);
 const result=await request(server).post('/internal/metrics/uat-detail/collect').set('Authorization','Bearer token').send({jobId:'a'.repeat(64)}).expect(503);
 expect(result.body).toEqual({state:'unavailable'});
});
