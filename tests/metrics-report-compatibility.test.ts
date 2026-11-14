import { describe, expect, it, vi } from 'vitest';
import { compatibilityConfig, forwardMetricsCompatibility, retainedMetricsOrigin } from '../src/server/reports/compatibility';

const config = { approved: true, legacyOrigin: retainedMetricsOrigin, webNativeOrigin: 'https://metrics-report-web-demo-uc.a.run.app',
  publicOrigin: 'https://metrics.hussh.ai', timeoutMs: 1000, maxRequestBytes: 4096, maxResponseBytes: 4096 };
const request = (path: string, init?: RequestInit) => new Request(config.publicOrigin + path, init);

describe('held Metrics operational compatibility boundary', () => {
  it('refuses report/provider/unknown paths before network or configuration', async () => {
    const fetcher = vi.fn();
    for (const path of ['/api/analytics/all', '/api/reports/one.adoption', '/api/report-jobs', '/api/instagram/sync',
      '/unknown', '/auth/unknown', '/api/auth/unknown', '/plg%2f..%2fapi/analytics/all']) {
      expect((await forwardMetricsCompatibility(request(path), config, fetcher)).status).toBe(404);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('pins distinct reviewed origins, approval and finite bounds without a fallback', async () => {
    const fetcher = vi.fn();
    for (const bad of [null, { ...config, approved: false }, { ...config, legacyOrigin: 'https://evil.invalid' },
      { ...config, webNativeOrigin: config.legacyOrigin }, { ...config, maxResponseBytes: 9_000_000 }, { ...config, timeoutMs: 0 }]) {
      expect(() => compatibilityConfig(bad)).toThrow();
      expect((await forwardMetricsCompatibility(request('/plg/uat/workspace'), bad, fetcher)).status).toBe(503);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('preserves signed raw callback bytes and origin while stripping spoofed infrastructure headers', async () => {
    const raw = '{ "fixture": "synthetic signed bytes" }';
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ accepted: true }));
    const response = await forwardMetricsCompatibility(request('/integrations/plg/sync', { method: 'POST', body: raw,
      headers: { cookie: 'fixture=session', origin: config.publicOrigin, 'content-type': 'application/json',
        'x-plg-signature': 'synthetic-signature', 'x-plg-timestamp': '123', 'x-forwarded-host': 'evil.invalid', 'x-goog-authenticated-user-email': 'forged' } }), config, fetcher);
    expect(response.status).toBe(200);
    const [target, init] = fetcher.mock.calls[0];
    expect(target).toBe(retainedMetricsOrigin + '/integrations/plg/sync');
    expect(new TextDecoder().decode(init?.body as Uint8Array)).toBe(raw);
    const headers = new Headers(init?.headers);
    expect(headers.get('x-plg-signature')).toBe('synthetic-signature'); expect(headers.get('origin')).toBe(config.publicOrigin);
    expect(headers.has('x-forwarded-host')).toBe(false); expect(headers.has('x-goog-authenticated-user-email')).toBe(false);
    expect(init?.redirect).toBe('manual'); expect(init?.cache).toBe('no-store');
    expect(response.headers.get('cache-control')).toContain('private, no-store');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive');
  });
  it('preserves separate OAuth/state/session cookies and approved redirect without following it', async () => {
    const headers = new Headers({ location: 'https://accounts.google.com/o/oauth2/v2/auth?fixture=1', 'cache-control': 'public,max-age=3600' });
    headers.append('set-cookie', 'fixture_state=one; Path=/; HttpOnly; Secure; SameSite=Lax');
    headers.append('set-cookie', 'fixture_session=two; Path=/; HttpOnly; Secure; SameSite=Lax');
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 302, headers }));
    const response = await forwardMetricsCompatibility(request('/api/auth/google?returnTo=%2Fplg%2Fuat%2Fworkspace'), config, fetcher);
    expect(response.status).toBe(302); expect(response.headers.getSetCookie()).toHaveLength(2);
    expect(response.headers.get('location')).toBe(headers.get('location')); expect(response.headers.get('cache-control')).toContain('no-store');
    expect(fetcher.mock.calls[0][0]).toContain('?returnTo=%2Fplg%2Fuat%2Fworkspace');
  });
  it('preserves authoritative denial and unsubscribe status instead of inventing success', async () => {
    for (const status of [401, 403, 404]) {
      const response = await forwardMetricsCompatibility(request('/integrations/plg/unsubscribe/synthetic-token'), config,
        async () => Response.json({ state: 'denied' }, { status }));
      expect(response.status).toBe(status); expect(await response.json()).toEqual({ state: 'denied' });
    }
    const fetcher = vi.fn();
    expect((await forwardMetricsCompatibility(request('/api/auth/logout'), config, fetcher)).status).toBe(405);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('refuses oversized bodies, unsafe redirects and domain-changing cookies', async () => {
    const fetcher = vi.fn();
    expect((await forwardMetricsCompatibility(request('/api/plg/workspace/query', { method: 'POST', body: 'x'.repeat(4097) }), config, fetcher)).status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
    for (const headers of [{ location: '//evil.invalid/' }, { 'set-cookie': 'fixture=secret; Domain=hussh.ai' }]) {
      expect((await forwardMetricsCompatibility(request('/auth/callback'), config,
        async () => new Response(null, { status: 302, headers }))).status).toBe(503);
    }
    expect((await forwardMetricsCompatibility(request('/plg'), config, async () => new Response('x'.repeat(4097)))).status).toBe(503);
  });
  it('bounds stalled fetches without retry or leaking errors', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn<typeof fetch>(async () => new Promise<Response>(() => {}));
      const pending = forwardMetricsCompatibility(request('/plg'), config, fetcher);
      await vi.advanceTimersByTimeAsync(1001);
      const response = await pending;
      expect(response.status).toBe(503); expect(fetcher).toHaveBeenCalledTimes(1);
      expect(await response.json()).toEqual({ message: 'This service is currently unavailable.' });
    } finally { vi.useRealTimers(); }
  });
});
