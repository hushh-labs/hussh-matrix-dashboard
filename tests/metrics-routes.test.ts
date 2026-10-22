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
vi.mock('@google-cloud/bigquery', () => ({ BigQuery: class { query = query; } }));
const secret = 'test-only-cache-session-secret-with-thirty-two-characters';
const app = createApp({ requireAuth: true, allowPublicDashboard: false, isProduction: false, sessionSecret: secret });
const cookie = `hussh_matrix_session=${encodeURIComponent(signCookie(JSON.stringify({ email: 'metrics-qa@hushh.ai', exp: Math.floor(Date.now()/1000) + 3600 }), secret))}`;
describe('authenticated aggregate snapshots', () => {
  it('serves explicit UAT from its own loader when production membership fails, while production and all fail closed', async () => {
    membership.mockClear(); query.mockClear();
    const uat = await request(app).get('/api/analytics/one/app?environment=uat').set('Cookie', cookie);
    expect(uat.status).toBe(200);
    expect(uat.body.environment).toBe('uat');
    expect(uat.body.data.production).toBeNull();
    expect(uat.body.data.uat).toBeTruthy();
    expect(membership).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalled();
    for (const [options] of query.mock.calls) expect(options.query).not.toContain('hushh-pda.analytics_');
    for (const environment of ['production', 'all']) {
      const denied = await request(app).get(`/api/analytics/one/app?environment=${environment}`).set('Cookie', cookie);
      expect(denied.status).toBe(503);
      expect(denied.headers['x-metrics-cache']).toBeUndefined();
    }
    expect(membership).toHaveBeenCalledTimes(2);
  });
  it('keeps cache hits private and checks authorization before returning a warmed snapshot', async () => {
    const first = await request(app).get('/api/analytics/one/android?start_date=2026-09-28&end_date=2026-10-05').set('Cookie', cookie);
    const next = await request(app).get('/api/analytics/one/android?end_date=2026-10-05&start_date=2026-09-28').set('Cookie', cookie);
    expect(first.status).toBe(200); expect(next.status).toBe(200);
    expect(next.headers['x-metrics-cache']).toBe('HIT');
    expect(next.headers['x-metrics-updated-at']).toBe(first.headers['x-metrics-updated-at']);
    expect(next.headers['cache-control']).toContain('no-store');
    expect(JSON.stringify(next.body)).not.toMatch(/"email"|"user_pseudo_id"|access_token|private_key/);
    const denied = await request(app).get('/api/analytics/one/android?end_date=2026-10-05&start_date=2026-09-28');
    expect(denied.status).toBe(401); expect(denied.headers['x-metrics-cache']).toBeUndefined();
  });
  it('returns the existing dated snapshot while an explicit refresh runs', async () => {
    const url = '/api/analytics/one/android?start_date=2026-09-27&end_date=2026-10-04';
    const first = await request(app).get(url).set('Cookie', cookie);
    const next = await request(app).get(url).set('Cookie', cookie).set('X-Metrics-Refresh', '1');
    expect(next.status).toBe(200); expect(next.headers['x-metrics-refreshing']).toBe('1');
    expect(next.headers['x-metrics-updated-at']).toBe(first.headers['x-metrics-updated-at']);
  });
  it('rejects unsupported scope without caching a client error', async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await request(app).get('/api/analytics/all?view=unknown').set('Cookie', cookie);
      expect(response.status).toBe(400); expect(response.headers['x-metrics-cache']).toBeUndefined();
    }
  });
});
