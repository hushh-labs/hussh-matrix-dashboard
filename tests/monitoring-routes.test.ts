import { expect, it } from 'vitest';
import request from 'supertest';
import { createApp, signCookie } from '../server';
const secret = 'monitoring-route-test-secret-at-least-32-characters';
const cookie = (email: string) => `hussh_matrix_session=${encodeURIComponent(signCookie(JSON.stringify({ email, exp: Math.floor(Date.now()/1000)+3600 }), secret))}`;
it('keeps Monitoring publication private, production-only, and operator-claimed', async () => {
 const app = createApp({ requireAuth: false, allowPublicDashboard: true, isProduction: false, sessionSecret: secret });
 expect((await request(app).get('/api/analytics/one/monitoring-publication?environment=production&start_date=2026-11-14&end_date=2026-11-14')).status).toBe(401);
 expect((await request(app).get('/api/analytics/one/monitoring-publication?environment=uat&start_date=2026-11-14&end_date=2026-11-14').set('Cookie',cookie('viewer@hushh.ai'))).status).toBe(400);
 expect((await request(app).post('/api/analytics/one/monitoring-initial-publication').set('X-Metrics-Monitoring-Initial','1')).status).toBe(403);
 expect((await request(app).post('/api/analytics/one/monitoring-initial-publication').set('Cookie',cookie('viewer@hushh.ai')).set('X-Metrics-Monitoring-Initial','1')).status).toBe(403);
 expect((await request(app).post('/api/analytics/one/monitoring-initial-publication').set('Cookie',cookie('metrics-release-probe@hushh.ai'))).status).toBe(403);
});
