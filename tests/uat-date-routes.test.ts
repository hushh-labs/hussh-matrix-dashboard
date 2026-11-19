import {afterEach,expect,it,vi} from 'vitest';
const access=vi.hoisted(()=>vi.fn());
vi.mock('../src/server/reports/web-client',async original=>({...await original<typeof import('../src/server/reports/web-client')>(),reportingIdentityHeaders:()=>async()=>({authorization:'Bearer synthetic'})}));
vi.mock('../src/metrics-web/lib/access',()=>({currentAccess:access}));
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();access.mockReset();});
it.each(['uat-detail-refresh','uat-detail-read'])('date-only %s route rejects wrong origin and missing session without worker requests',async name=>{
 const route=(await import('../src/metrics-web/app/api/'+name+'/route')).POST;
 vi.stubEnv('METRICS_UAT_WEB_ENABLED','true');vi.stubEnv('METRICS_UAT_DATE_WEB_ENABLED','true');vi.stubEnv('METRICS_WEB_ORIGIN','https://metrics.example');
 vi.stubEnv('METRICS_UAT_WEB_CONFIG',JSON.stringify({audience:'https://worker.run.app',timeoutMs:1000,maxResponseBytes:10000}));
 const fetcher=vi.spyOn(globalThis,'fetch');const make=(origin:string)=>new Request('https://metrics.example/api/uat-detail-refresh',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({startDate:'2026-11-18',endDate:'2026-11-18'})});
 expect((await route(make('https://attacker.example'))).status).not.toBe(200);expect(access).not.toHaveBeenCalled();
 access.mockResolvedValue(null);expect((await route(make('https://metrics.example'))).status).not.toBe(200);expect(access).toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
});

it('forwards date-only action using scoped session and infrastructure identity, without cookie',async()=>{
 const route=(await import('../src/metrics-web/app/api/'+'uat-detail-refresh'+'/route')).POST;
 vi.stubEnv('METRICS_UAT_WEB_ENABLED','true');vi.stubEnv('METRICS_UAT_DATE_WEB_ENABLED','true');vi.stubEnv('METRICS_WEB_ORIGIN','https://metrics.example');
 vi.stubEnv('METRICS_UAT_WEB_CONFIG',JSON.stringify({audience:'https://worker.run.app',timeoutMs:1000,maxResponseBytes:10000}));
 const scoped={subjectHash:'a'.repeat(64),scopeDigest:'b'.repeat(64)};access.mockResolvedValue(scoped);
 const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({state:'accepted',jobId:'c'.repeat(64),reportId:null}));
 const response=await route(new Request('https://metrics.example/api/uat-detail-refresh',{method:'POST',headers:{origin:'https://metrics.example','content-type':'application/json',cookie:'private=synthetic'},body:JSON.stringify({startDate:'2026-11-18',endDate:'2026-11-18'})}));
 expect(response.status).toBe(202);expect(access).toHaveBeenCalledTimes(2);expect(fetcher).toHaveBeenCalledOnce();
 const [url,init]=fetcher.mock.calls[0];expect(url).toBe('https://worker.run.app/internal/metrics/uat-detail/request-dates');
 expect(new Headers(init?.headers).has('cookie')).toBe(false);expect(JSON.parse(String(init?.body))).toEqual({access:scoped,request:{startDate:'2026-11-18',endDate:'2026-11-18'}});
});
