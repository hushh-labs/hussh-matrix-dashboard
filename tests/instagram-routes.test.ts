import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp, getSessionUserFromReq, signCookie, type AppConfig } from '../server';
import { BigQueryInstagramStore } from '../src/server/instagram/store';

const config: AppConfig = {
  requireAuth: false, allowPublicDashboard: true, clientId: '', clientSecret: '', redirectUri: '',
  sessionSecret: 'a-test-session-secret-at-least-32-characters', allowedDomains: [], allowedEmails: [], isProduction: false,
};

function cookie(email: string) {
  const session = { email, name: 'Test', picture: '', exp: Math.floor(Date.now() / 1000) + 3600 };
  return `hussh_matrix_session=${encodeURIComponent(signCookie(JSON.stringify(session), config.sessionSecret))}`;
}

describe('Instagram route boundaries', () => {
  it('keeps Instagram private when the aggregate dashboard is public', async () => {
    const app = createApp(config);
    expect((await request(app).get('/api/analytics/instagram')).status).toBe(401);
    expect((await request(app).post('/api/instagram/sync')).status).toBe(401);
    expect((await request(app).post('/api/analytics/instagram/initial-publication').set('X-Metrics-Instagram-Initial', '1')).status).toBe(403);
    expect((await request(app).post('/api/analytics/instagram/initial-publication').set('Cookie', cookie('viewer@hushh.ai')).set('X-Metrics-Instagram-Initial', '1')).status).toBe(403);
    expect((await request(app).post('/api/analytics/instagram/initial-publication').set('Cookie', cookie('metrics-release-probe@hushh.ai'))).status).toBe(403);
  });
  it('reports not configured without contacting Meta or BigQuery', async () => {
    const app = createApp(config);
    expect(getSessionUserFromReq({ headers: { cookie: cookie('viewer@hushh.ai') } } as any, config.sessionSecret)).not.toBeNull();
    const result = await request(app).get('/api/analytics/instagram').set('Cookie', cookie('viewer@hushh.ai'));
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ state: 'not_configured', reach: null, canSync: false });
  });
  it('requires the operator allowlist for manual sync', async () => {
    const app = createApp(config);
    const result = await request(app).post('/api/instagram/sync').set('Cookie', cookie('viewer@hushh.ai')).set('Origin', 'http://localhost:3001');
    expect(result.status).toBe(403);
  });
  it('keeps unpublished Instagram reads passive for both operators and viewers', async () => {
    const prior = {
      enabled: process.env.INSTAGRAM_ANALYTICS_ENABLED,
      token: process.env.INSTAGRAM_ACCESS_TOKEN,
      admins: process.env.INSTAGRAM_ANALYTICS_ADMIN_EMAILS,
      account: process.env.INSTAGRAM_USER_ID,
    };
    process.env.INSTAGRAM_ANALYTICS_ENABLED = 'true';
    process.env.INSTAGRAM_ACCESS_TOKEN = 'test-only-token';
    process.env.INSTAGRAM_ANALYTICS_ADMIN_EMAILS = 'operator@hushh.ai';
    process.env.INSTAGRAM_USER_ID = '17841436775785807';
    const stub = vi.spyOn(BigQueryInstagramStore.prototype, 'summary').mockResolvedValue({ state: 'empty', username: null, reach: null, lastSuccessfulSync: null, lastAttempt: null });
    try {
      const app = createApp(config);
      const operator = await request(app).get('/api/analytics/instagram').set('Cookie', cookie('operator@hushh.ai'));
      const viewer = await request(app).get('/api/analytics/instagram').set('Cookie', cookie('viewer@hushh.ai'));
      for (const result of [operator, viewer]) {
        expect(result.status).toBe(503);
        expect(result.body).toEqual({ error: 'Instagram publication is unavailable.', canSync: false });
        expect(result.headers['cache-control']).toContain('no-store');
      }
      expect(stub).not.toHaveBeenCalled();
    } finally {
      stub.mockRestore();
      for (const [name, value] of Object.entries({ INSTAGRAM_ANALYTICS_ENABLED: prior.enabled, INSTAGRAM_ACCESS_TOKEN: prior.token, INSTAGRAM_ANALYTICS_ADMIN_EMAILS: prior.admins, INSTAGRAM_USER_ID: prior.account })) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
    }
  });
});
