import { expect,it,vi } from 'vitest';
import { UatDetailWebClient } from '../src/server/reports/uat-detail-web-client';
const access={subjectHash:'a'.repeat(64),scopeDigest:'b'.repeat(64)},config={audience:'https://detail-worker.run.app',timeoutMs:1000,maxResponseBytes:1024};
it('uses the fixed private route and sends scoped access without cookies',async()=>{
 const fetcher=vi.fn(async(_url:any,init:any)=>{expect(init.headers.Cookie).toBeUndefined();expect(JSON.parse(init.body)).toEqual({request:{reportId:'one.agent-detail-uat'},access});return Response.json({state:'accepted',jobId:'c'.repeat(64),reportId:null});});
 const c=new UatDetailWebClient(config,async()=>({Authorization:'Bearer signed'}),fetcher as any);
 expect((await c.request({reportId:'one.agent-detail-uat'},access)).state).toBe('accepted');
 expect(fetcher.mock.calls[0][0]).toBe('https://detail-worker.run.app/internal/metrics/uat-detail/request');
});
it('rejects oversized and malformed replies',async()=>{
 for(const body of [{state:'completed',jobId:'c'.repeat(64),reportId:null},{padding:'x'.repeat(1100)}]){
  const c=new UatDetailWebClient(config,async()=>({}),async()=>Response.json(body));await expect(c.request({},access)).rejects.toThrow();
 }
});

it('does not invoke the worker when the caller cancels during identity acquisition',async()=>{
 let finish!:(value:Record<string,string>)=>void;const identity=()=>new Promise<Record<string,string>>(resolve=>{finish=resolve;});
 const fetcher=vi.fn();const controller=new AbortController(),client=new UatDetailWebClient(config,identity,fetcher as any);
 const result=client.request({},access,controller.signal);controller.abort();await expect(result).rejects.toThrow();finish({Authorization:'Bearer late'});expect(fetcher).not.toHaveBeenCalled();
});
