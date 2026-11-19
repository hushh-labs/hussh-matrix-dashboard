import { expect,it,vi } from 'vitest';
import { reconcileUatTask } from '../src/server/reports/uat-reconcile-client';
const config={reportingProject:'hushh-ai-prod',reportingDatabase:'metrics-reports',workerAudience:'https://detail-worker.run.app',
 taskInvoker:'metrics-report-task-invoker@hushh-ai-prod.iam.gserviceaccount.com',webInvoker:'metrics-report-web@hushh-ai-prod.iam.gserviceaccount.com',
 queueParent:'projects/hushh-ai-prod/locations/us-central1/queues/metrics-uat-detail-manual',rpcTimeoutMs:1000,maxResponseBytes:10000};
const env=()=>({METRICS_UAT_OPERATOR_RECONCILE_ENABLED:'true',METRICS_UAT_SERVICE_CONFIG:JSON.stringify(config)});
it('is default off and rejects unsafe configuration before identity or network',async()=>{
 const identity=vi.fn(),fetcher=vi.fn();await expect(reconcileUatTask('a'.repeat(64),{},identity,fetcher)).rejects.toThrow();
 await expect(reconcileUatTask('a'.repeat(64),{...env(),METRICS_UAT_SERVICE_CONFIG:JSON.stringify({...config,workerAudience:'https://evil.test'})},identity,fetcher)).rejects.toThrow();
 expect(identity).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
});
it('issues one fixed authenticated lookup-only request and returns sanitized state',async()=>{
 const identity=vi.fn(async()=>({authorization:'Bearer synthetic'}));const fetcher=vi.fn<typeof fetch>(async()=>Response.json({state:'delayed'}));
 expect(await reconcileUatTask('a'.repeat(64),env(),identity,fetcher)).toEqual({state:'delayed'});
 expect(identity).toHaveBeenCalledOnce();expect(fetcher).toHaveBeenCalledOnce();
 expect(fetcher.mock.calls[0][0]).toBe(config.workerAudience+'/internal/metrics/uat-detail/dispatch');
 expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({jobId:'a'.repeat(64)});expect(fetcher.mock.calls[0][1]?.redirect).toBe('error');
});
it('fails closed on oversized or unexpected responses and never retries',async()=>{
 const identity=vi.fn(async()=>({authorization:'Bearer synthetic'}));
 for(const payload of [{state:'queued'},{state:'delayed',extra:'private'},{state:'x'.repeat(1200)}]){
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json(payload));await expect(reconcileUatTask('a'.repeat(64),env(),identity,fetcher)).rejects.toThrow();expect(fetcher).toHaveBeenCalledOnce();
 }
});
it('does not dispatch if flag closes while identity is pending',async()=>{
 const configEnv=env(),fetcher=vi.fn();const identity=vi.fn(async()=>{configEnv.METRICS_UAT_OPERATOR_RECONCILE_ENABLED='false';return {authorization:'Bearer synthetic'};});
 await expect(reconcileUatTask('a'.repeat(64),configEnv,identity,fetcher)).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
});
it('bounds a nonresponsive fetch without retrying',async()=>{
 const configEnv=env();configEnv.METRICS_UAT_SERVICE_CONFIG=JSON.stringify({...config,rpcTimeoutMs:20});
 const fetcher=vi.fn<typeof fetch>(async()=>new Promise<Response>(()=>{}));const identity=vi.fn(async()=>({authorization:'Bearer synthetic'}));
 await expect(reconcileUatTask('a'.repeat(64),configEnv,identity,fetcher)).rejects.toThrow();expect(fetcher).toHaveBeenCalledOnce();
});
