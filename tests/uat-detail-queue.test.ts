import { expect, it, vi } from 'vitest';
import { UatDetailTaskQueue } from '../src/server/reports/uat-detail-queue';
const config={enabled:true,parent:'projects/project-test/locations/us-central1/queues/metrics-uat-detail-manual',
 workerUrl:'https://detail-worker.run.app/internal/metrics/uat-detail/collect',invokerEmail:'metrics-report-task-invoker@project-test.iam.gserviceaccount.com',rpcTimeoutMs:1000};
it('requires a separate fixed target, matching project identity and explicit enablement',()=>{
 const request=vi.fn();
 for(const change of [{enabled:false},{workerUrl:'https://detail-worker.run.app/internal/metrics/collect'},
  {parent:'projects/project-test/locations/us-central1/queues/metrics-reporting-default'},
  {invokerEmail:'metrics-report-task-invoker@other-project.iam.gserviceaccount.com'}])
  expect(()=>new UatDetailTaskQueue({...config,...change},request)).toThrow();
 expect(request).not.toHaveBeenCalled();
});
it('pins task identity and treats missing lookup as uncertainty',async()=>{
 const request=vi.fn(async(_url:string,req:any)=>req.method==='POST'?{status:200,name:req.body.task.name}:{status:404});
 const mutable={...config}, queue=new UatDetailTaskQueue(mutable,request), id='a'.repeat(64);
 mutable.workerUrl='https://evil.run.app/internal/metrics/uat-detail/collect'; mutable.invokerEmail='evil@example.com';
 expect(await queue.create(id)).toBe('accepted'); const body=request.mock.calls[0][1].body;
 expect(body.task.name).toBe(queue.taskName(id)); expect(body.task.httpRequest.oidcToken).toEqual({serviceAccountEmail:config.invokerEmail,audience:'https://detail-worker.run.app'});
 expect(JSON.parse(Buffer.from(body.task.httpRequest.body,'base64').toString())).toEqual({jobId:id});
 expect(await queue.lookup(id)).toBe('missing'); expect(request).toHaveBeenCalledTimes(2);
 const conflict=new UatDetailTaskQueue(config,vi.fn(async()=>({status:409})));
 await expect(conflict.create(id)).rejects.toThrow();
});
