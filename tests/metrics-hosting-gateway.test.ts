import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { forwardMetricsReportWeb, metricsHostingGateway } from '../src/server/reports/hosting-gateway';
import { retainedMetricsOrigin } from '../src/server/reports/compatibility';
import type { ReportingIdentityHeaders } from '../src/server/reports/web-client';

const c = { approved: true, webNativeOrigin: 'https://metrics-report-web-demo-uc.a.run.app',
  publicOrigin: 'https://metrics.hussh.ai', timeoutMs: 1000, maxRequestBytes: 4096, maxResponseBytes: 8192 };
const identity = () => vi.fn<ReportingIdentityHeaders>(async () => ({ authorization: 'Bearer synthetic-native-identity' }));
const req = (path: string, init?: RequestInit) => new Request(c.publicOrigin + path, init);
function app(env: Record<string, string | undefined>, fetcher: typeof fetch) {
  const server = express(), local = vi.fn(), auth = identity();
  server.use(metricsHostingGateway(env, auth, fetcher));
  server.use(express.json());
  server.use((incoming, response) => { local(incoming.originalUrl); response.status(209).json({ retained: true }); });
  return { server, local, auth };
}
const enabled = { METRICS_REPORT_WEB_FORWARDING_CONFIG: JSON.stringify(c), METRICS_BIGQUERY_ENABLED: 'false' };
afterEach(() => vi.useRealTimers());

describe('held hosting handoff to the source-free Metrics web application', () => {
  it('leaves existing hosting untouched and does no identity/network work without configuration', async () => {
    const fetcher = vi.fn(), f = app({}, fetcher);
    expect((await request(f.server).get('/')).status).toBe(209);
    expect(f.local).toHaveBeenCalledTimes(1); expect(f.auth).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('forwards HTML, RSC, report JSON, status and assets only to the fixed native web audience', async () => {
    const auth = identity(), fetcher = vi.fn<typeof fetch>(async () => new Response('synthetic private report', {
      headers: { 'content-type': 'text/x-component', 'cache-control': 'public,max-age=600' },
    }));
    for (const path of ['/', '/?report=one.adoption&_rsc=synthetic', '/api/reports/one.adoption?timezone=UTC',
      '/api/report-jobs/' + 'a'.repeat(64), '/_next/static/chunks/app/page-synthetic.js']) {
      const response = await forwardMetricsReportWeb(req(path), c, auth, fetcher);
      expect(response.status).toBe(200); expect(await response.text()).toBe('synthetic private report');
      expect(response.headers.get('cache-control')).toContain('private, no-store');
      expect(fetcher.mock.calls.at(-1)![0]).toBe(c.webNativeOrigin + path);
      expect(auth.mock.calls.at(-1)![0]).toBe(c.webNativeOrigin);
    }
  });
  it('preserves explicit raw job admission and browser identity while discarding spoofed infrastructure credentials', async () => {
    const raw = '{ "reportId": "one.adoption" }';
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ state: 'accepted' }, { status: 202 }));
    const f = app(enabled, fetcher);
    const response = await request(f.server).post('/api/report-jobs').set({ 'content-type': 'application/json',
      origin: c.publicOrigin, cookie: 'hussh_matrix_session=synthetic', authorization: 'Bearer forged',
      'x-forwarded-host': 'evil.invalid', 'x-goog-authenticated-user-email': 'forged' }).send(raw);
    expect(response.status).toBe(202); expect(f.local).not.toHaveBeenCalled();
    const [, init] = fetcher.mock.calls[0], headers = new Headers(init?.headers);
    expect(new TextDecoder().decode(init?.body as Uint8Array)).toBe(raw);
    expect(headers.get('origin')).toBe(c.publicOrigin); expect(headers.get('cookie')).toBe('hussh_matrix_session=synthetic');
    expect(headers.get('authorization')).toBe('Bearer synthetic-native-identity');
    expect(headers.has('x-forwarded-host')).toBe(false); expect(headers.has('x-goog-authenticated-user-email')).toBe(false);
    expect(init?.redirect).toBe('manual'); expect(init?.cache).toBe('no-store');
    expect(f.auth).toHaveBeenCalledTimes(1);
  });
  it.each(['/api/analytics/all', '/api/analytics/one', '/api/chat', '/api/instagram/sync', '/unknown', '/_next/image?url=https://evil.invalid'])
  ('does not fall back to legacy provider work for %s', async path => {
    const fetcher = vi.fn(), f = app(enabled, fetcher);
    expect((await request(f.server).get(path)).status).toBe(404);
    expect(f.local).not.toHaveBeenCalled(); expect(f.auth).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('keeps OAuth, PLG, signed callbacks, legacy assets and health on their existing handlers', async () => {
    const fetcher = vi.fn(), f = app(enabled, fetcher);
    for (const path of ['/api/auth/google', '/auth/callback?code=synthetic', '/api/auth/me', '/plg/uat/workspace',
      '/api/plg/uat/users', '/integrations/plg/unsubscribe/synthetic', '/assets/plg-synthetic.js', '/api/health']) {
      expect((await request(f.server).get(path)).status).toBe(209);
    }
    expect((await request(f.server).post('/integrations/plg/sync').send({ synthetic: true })).status).toBe(209);
    expect(f.local).toHaveBeenCalledTimes(9); expect(fetcher).not.toHaveBeenCalled();
  });
  it('refuses incomplete configuration and a warehouse-enabled handoff without breaking operational handlers', async () => {
    const fetcher = vi.fn();
    for (const env of [{ ...enabled, METRICS_BIGQUERY_ENABLED: 'true' },
      { ...enabled, METRICS_REPORT_WEB_FORWARDING_CONFIG: 'invalid' },
      { ...enabled, METRICS_REPORT_WEB_FORWARDING_CONFIG: JSON.stringify({ ...c, webNativeOrigin: retainedMetricsOrigin }) }]) {
      const f = app(env, fetcher);
      expect((await request(f.server).get('/')).status).toBe(503);
      expect((await request(f.server).get('/api/auth/me')).status).toBe(209);
      expect(f.local).toHaveBeenCalledTimes(1); expect(f.auth).not.toHaveBeenCalled();
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('preserves native authorization failures and never converts a failed report hop into a legacy read', async () => {
    for (const status of [401, 403, 429, 503]) {
      const fetcher = vi.fn<typeof fetch>(async () => Response.json({ state: 'unavailable' }, { status }));
      const f = app(enabled, fetcher), response = await request(f.server).get('/api/reports/one.adoption');
      expect(response.status).toBe(status); expect(response.headers['cache-control']).toContain('no-store');
      expect(f.local).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it('rejects method expansion, oversized admission and noncanonical origin before network', async () => {
    const auth = identity(), fetcher = vi.fn();
    expect((await forwardMetricsReportWeb(req('/api/report-jobs'), c, auth, fetcher)).status).toBe(405);
    expect((await forwardMetricsReportWeb(req('/api/reports/one.adoption', { method: 'POST' }), c, auth, fetcher)).status).toBe(405);
    expect((await forwardMetricsReportWeb(new Request('https://evil.invalid/'), c, auth, fetcher)).status).toBe(404);
    expect(auth).not.toHaveBeenCalled();
    expect((await forwardMetricsReportWeb(req('/api/report-jobs', { method: 'POST', body: 'x'.repeat(4097) }), c, auth, fetcher)).status).toBe(503);
    expect(auth).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('refuses arbitrary redirects, cookie domain changes and oversized response bodies', async () => {
    for (const response of [new Response(null, { status: 302, headers: { location: '//evil.invalid/' } }),
      new Response('synthetic', { headers: { 'set-cookie': 'fixture=synthetic; Domain=hussh.ai' } }), new Response('x'.repeat(8193))]) {
      expect((await forwardMetricsReportWeb(req('/'), c, identity(), async () => response)).status).toBe(503);
    }
    const approved = await forwardMetricsReportWeb(req('/'), c, identity(), async () => new Response(null,
      { status: 302, headers: { location: '/login?returnTo=%2F' } }));
    expect(approved.status).toBe(302); expect(approved.headers.get('location')).toBe('/login?returnTo=%2F');
  });
  it('bounds a stalled native response without a retry or legacy fallback', async () => {
    vi.useFakeTimers(); const fetcher = vi.fn<typeof fetch>(async () => new Promise<Response>(() => {}));
    const pending = forwardMetricsReportWeb(req('/'), c, identity(), fetcher);
    await vi.advanceTimersByTimeAsync(1001);
    expect((await pending).status).toBe(503); expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
