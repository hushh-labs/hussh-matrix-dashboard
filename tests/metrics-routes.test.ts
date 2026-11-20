import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp, signCookie } from '../server';
const { membership, query } = vi.hoisted(() => ({
  membership: vi.fn().mockRejectedValue(new Error('Production customer membership unavailable')),
  query: vi.fn().mockResolvedValue([[]]),
}));
vi.mock('../src/server/one-customer-cohort', async (original) => ({
  ...await original<typeof import('../src/server/one-customer-cohort')>(),
  readCustomerCohort: membership,
}));
vi.mock('../src/server/bigquery-cost-control', () => ({
  guardedBigQuery: (_project: string, options: unknown) => query(options),
  guardedBigQueryDryRun: vi.fn(async () => { throw new Error('no estimate'); }),
}));
vi.mock('google-auth-library', () => ({ GoogleAuth: class {
  async getClient() { return { request: async () => ({ data: { users: [] } }) }; }
} }));
const secret = 'test-only-cache-session-secret-with-thirty-two-characters';
const app = createApp({ requireAuth: true, allowPublicDashboard: false, isProduction: false, sessionSecret: secret });
const cookie = `hussh_matrix_session=${encodeURIComponent(signCookie(JSON.stringify({ email: 'metrics-qa@hushh.ai', exp: Math.floor(Date.now()/1000) + 3600 }), secret))}`;
describe('authenticated aggregate snapshots', () => {
  it('returns an opaque reload session binding that changes with account or session expiry', async () => {
    const expiry=Math.floor(Date.now()/1000)+3600;
    const session=(email:string,exp:number)=>`hussh_matrix_session=${encodeURIComponent(signCookie(JSON.stringify({email,exp}),secret))}`;
    const one=await request(app).get('/api/auth/me').set('Cookie',session('staff@hushh.ai',expiry));
    const same=await request(app).get('/api/auth/me').set('Cookie',session('staff@hushh.ai',expiry));
    const other=await request(app).get('/api/auth/me').set('Cookie',session('other@hushh.ai',expiry));
    const renewed=await request(app).get('/api/auth/me').set('Cookie',session('staff@hushh.ai',expiry+1));
    expect(one.body.user.reloadSubject).toMatch(/^[a-f0-9]{64}$/);expect(one.body.user.reloadSubject).toBe(same.body.user.reloadSubject);
    expect(one.body.user.reloadSubject).not.toBe(other.body.user.reloadSubject);expect(one.body.user.reloadSubject).not.toBe(renewed.body.user.reloadSubject);
    expect(one.headers['cache-control']).toContain('no-store');
  });
  it('keeps ordinary reads passive even when refresh is requested', async () => {
    query.mockClear();
    for (const [url, status] of [
      ['/api/analytics/one/app?environment=uat', 503],
      ['/api/analytics/one/android?start_date=2026-09-27&end_date=2026-10-04', 200],
    ] as const) {
      for (const headers of [{}, {'X-Metrics-Refresh':'1'}, {'X-Metrics-Passive-Read':'0'}]) {
        const result = await request(app).get(url).set('Cookie', cookie).set(headers);
        expect(result.status).toBe(status); expect(query).not.toHaveBeenCalled();
        if (status === 200) expect(result.body.history.state).toBe('not_configured');
      }
      expect((await request(app).get(url)).status).toBe(401);
    }
  });
  it('rejects unsupported scope without caching a client error', async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await request(app).get('/api/analytics/all?view=unknown').set('Cookie', cookie);
      expect(response.status).toBe(400); expect(response.headers['x-metrics-cache']).toBeUndefined();
    }
  });
});

it('mounts the optional legacy detail bridge before application parsing and fails closed without its target',async()=>{
 vi.stubEnv('METRICS_UAT_LEGACY_BRIDGE_ENABLED','true');vi.stubEnv('METRICS_UAT_LEGACY_FORWARDING_CONFIG','');
 const mounted=createApp({requireAuth:true,allowPublicDashboard:false,isProduction:false,sessionSecret:secret});query.mockClear();
 const response=await request(mounted).post('/api/uat-detail-refresh').send({startDate:'2026-11-18',endDate:'2026-11-18'});
 expect(response.status).toBe(503);expect(query).not.toHaveBeenCalled();vi.unstubAllEnvs();
});
