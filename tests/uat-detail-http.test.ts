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
import { createConnection } from 'node:net';
import type { AddressInfo } from 'node:net';
it('returns unavailable for an incomplete body and never invokes the worker after deadline',async()=>{
 const execute=vi.fn(),deliver=vi.fn();
 const server=uatDetailServer({enabled:true,maxRequestBytes:1024,maxResponseBytes:1024,timeoutMs:50},{execute} as any,{deliver} as any);
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const socket=createConnection((server.address() as AddressInfo).port,'127.0.0.1');
 try {
  let text='';const response=new Promise<void>((resolve,reject)=>{socket.on('data',chunk=>{text+=chunk.toString();if(text.includes('{"state":"unavailable"}'))resolve();});socket.on('error',reject);});
  await new Promise<void>(resolve=>socket.once('connect',resolve));
  socket.write('POST /internal/metrics/uat-detail/collect HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer token\r\nContent-Type: application/json\r\nContent-Length: 76\r\n\r\n{"jobId":"');
  await Promise.race([response,new Promise<never>((_,reject)=>setTimeout(()=>reject(Error('deadline response missing')),2000))]);
  expect(text).toContain('503');expect(execute).not.toHaveBeenCalled();expect(deliver).not.toHaveBeenCalled();
  socket.write('a'.repeat(64)+'"}');await new Promise(resolve=>setTimeout(resolve,50));expect(execute).not.toHaveBeenCalled();
 } finally {socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

it('bounded shutdown aborts in-flight work and closes a noncooperative connection',async()=>{
 const {shutdownUatDetailServer}=await import('../src/server/reports/uat-detail-http');
 let entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});let observed:AbortSignal|undefined;
 const execute=vi.fn(async(_token:string,_id:string,signal:AbortSignal)=>{observed=signal;entered();await new Promise(()=>{});});
 const server=uatDetailServer({enabled:true,maxRequestBytes:1024,maxResponseBytes:1024,timeoutMs:5000},{execute} as any,{deliver:vi.fn()} as any);
 const call=request(server).post('/internal/metrics/uat-detail/collect').set('Authorization','Bearer token').send({jobId:'a'.repeat(64)}).then(()=>{},()=>{});
 await started;await shutdownUatDetailServer(server,30);expect(observed?.aborted).toBe(true);await call;
});
