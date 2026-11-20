import {describe,it,expect,vi} from 'vitest';
import request from 'supertest';
import {createApp,signCookie} from '../server';
const sessionSecret='test-only-session-secret-with-at-least-thirty-two-characters';
const provider = vi.hoisted(() => ({ send: vi.fn().mockRejectedValue(new Error('Unexpected provider call')) }));
vi.mock('../src/server/android-reporting', async (load) => ({ ...await load<typeof import('../src/server/android-reporting')>(),
  googleReader: () => provider.send,
}));
const appConfig = {requireAuth:true,allowPublicDashboard:false,isProduction:false,sessionSecret};
const app=createApp(appConfig);
const cookie=(email='i-neelesh@hushh.ai',expired=false)=>`hussh_matrix_session=${encodeURIComponent(signCookie(JSON.stringify({email,name:'Test',exp:Math.floor(Date.now()/1000)+(expired?-1:3600)}),sessionSecret))}`;
describe('Android reporting authorization and scope',()=>{
  it('requires the existing authenticated session',async()=>{
    expect((await request(app).get('/api/analytics/one/android?start_date=2026-09-28&end_date=2026-10-05')).status).toBe(401);
    expect((await request(app).get('/api/analytics/one/android').set('Cookie',cookie('i-neelesh@hushh.ai',true))).status).toBe(401);
    expect((await request(app).get('/api/analytics/one/android').set('Cookie',cookie()+'tampered')).status).toBe(401);
  });
  it.each(['start_date=2026-02-30&end_date=2026-03-01','start_date=2026-01-01&end_date=2026-10-05','start_date=2026-10-05&end_date=2026-09-28','start_date=2099-01-01&end_date=2099-01-02','start_date=2026-09-28&end_date=2026-10-05&environment=uat'])('rejects invalid or unsupported reporting scope %s',async(query)=>{
    expect((await request(app).get(`/api/analytics/one/android?${query}`).set('Cookie',cookie())).status).toBe(400);
  });
  it('uses only the company package and returns explicit missing configuration without credentials',async()=>{
    const response=await request(app).get('/api/analytics/one/android?start_date=2026-09-28&end_date=2026-10-05').set('Cookie',cookie());
    expect(response.status).toBe(200);expect(response.body.packageId).toBe('com.hussh.app');
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.body.history.state).toBe('not_configured');expect(response.body.vitals.state).toBe('not_configured');
    expect(JSON.stringify(response.body)).not.toMatch(/access_token|private_key|user_pseudo_id/);
  });
  it('preserves the configured Android publication boundary on a miss and explicit refresh', async () => {
    vi.stubEnv('ONE_GA4_IMPERSONATE_SERVICE_ACCOUNT', 'fixture-reader@example.invalid');
    try {
      const configured = createApp(appConfig);
      const response = await request(configured).get('/api/analytics/one/android?start_date=2026-09-28&end_date=2026-10-05')
        .set('Cookie', cookie()).set('X-Metrics-Refresh', '1');
      expect(response.status).toBe(503);
      expect(provider.send).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });
});
