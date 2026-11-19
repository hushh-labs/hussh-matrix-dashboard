import { afterEach, expect, it, vi } from 'vitest';
import request from 'supertest';
const fake=vi.hoisted(()=>({runtime:vi.fn(),verify:vi.fn()}));
vi.mock('../src/server/bigquery-cost-control',()=>({createServiceOwnedUatRuntime:fake.runtime}));
vi.mock('../src/server/reports/worker-http',()=>({googleWorkerIdentityVerifier:()=>fake.verify}));
import { createUatDetailBootstrap } from '../src/server/reports/uat-detail-bootstrap';
const config={reportingProject:'hushh-ai-prod',reportingDatabase:'metrics-reports',workerAudience:'https://detail-worker.run.app',
 taskInvoker:'metrics-report-task-invoker@hushh-ai-prod.iam.gserviceaccount.com',webInvoker:'metrics-report-web@hushh-ai-prod.iam.gserviceaccount.com',
 queueParent:'projects/hushh-ai-prod/locations/us-central1/queues/metrics-uat-detail-manual',rpcTimeoutMs:1000,maxResponseBytes:10000};
const enabled=()=>({METRICS_UAT_LISTENER_ENABLED:'true',METRICS_UAT_SERVICE_ENABLED:'true',METRICS_UAT_DETAIL_ENABLED:'true',METRICS_UAT_SERVICE_CONFIG:JSON.stringify(config)});
afterEach(()=>vi.clearAllMocks());
it('is disabled by default and a configured boot performs no identity or provider work',()=>{
 expect(()=>createUatDetailBootstrap({})).toThrow();const server=createUatDetailBootstrap(enabled());
 expect(server.listening).toBe(false);expect(fake.verify).not.toHaveBeenCalled();expect(fake.runtime).not.toHaveBeenCalled();
});
it('rejects wrong identity before constructing runtime',async()=>{
 fake.verify.mockResolvedValue({email:'wrong@example.test',emailVerified:true});const server=createUatDetailBootstrap(enabled());
 await request(server).post('/internal/metrics/uat-detail/collect').set('Authorization','Bearer token').send({jobId:'a'.repeat(64)}).expect(401);
 expect(fake.runtime).not.toHaveBeenCalled();
});
it('does not initialize runtime when verification finishes after cancellation',async()=>{
 let finish!:(v:unknown)=>void;fake.verify.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const env=enabled();env.METRICS_UAT_SERVICE_CONFIG=JSON.stringify({...config,rpcTimeoutMs:25});const server=createUatDetailBootstrap(env);
 const response=await request(server).post('/internal/metrics/uat-detail/collect').set('Authorization','Bearer token').send({jobId:'a'.repeat(64)}).expect(503);
 expect(response.body).toEqual({state:'unavailable'});finish({email:config.taskInvoker,emailVerified:true});await new Promise(resolve=>setTimeout(resolve,20));expect(fake.runtime).not.toHaveBeenCalled();
});
it('accepts the fixed web principal and delegates only after verification',async()=>{
 fake.verify.mockResolvedValue({email:config.webInvoker,emailVerified:true});
 const readDatesForWeb=vi.fn(async()=>({request:{reportId:'one.agent-detail-uat',startDate:'2026-11-18',endDate:'2026-11-18',timezone:'UTC'},result:{state:'unavailable'}}));
 fake.runtime.mockResolvedValue({readDatesForWeb,close:vi.fn()});
 const server=createUatDetailBootstrap(enabled());const access={subjectHash:'a'.repeat(64),scopeDigest:'b'.repeat(64)};
 const response=await request(server).post('/internal/metrics/uat-detail/read-dates').set('Authorization','Bearer token').send({access,request:{startDate:'2026-11-18',endDate:'2026-11-18'}}).expect(200);
 expect(response.body.result).toEqual({state:'unavailable'});expect(fake.verify).toHaveBeenCalledWith('token',config.workerAudience);
 expect(fake.runtime).toHaveBeenCalledOnce();expect(readDatesForWeb).toHaveBeenCalledOnce();
});
it('dispatcher route requires the fixed distinct service principal',async()=>{
 const server=createUatDetailBootstrap(enabled()),dispatch=vi.fn(async()=>({state:'delayed'}));fake.runtime.mockResolvedValue({dispatch,close:vi.fn()});
 fake.verify.mockResolvedValue({email:config.taskInvoker,emailVerified:true});
 await request(server).post('/internal/metrics/uat-detail/dispatch').set('Authorization','Bearer token').send({jobId:'a'.repeat(64)}).expect(401);
 expect(fake.runtime).not.toHaveBeenCalled();
 fake.verify.mockResolvedValue({email:'metrics-report-dispatcher@hushh-ai-prod.iam.gserviceaccount.com',emailVerified:true});
 await request(createUatDetailBootstrap(enabled())).post('/internal/metrics/uat-detail/dispatch').set('Authorization','Bearer token').send({jobId:'a'.repeat(64)}).expect(200);
 expect(dispatch).toHaveBeenCalledOnce();
});
