import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearMetricsCache, invalidateMetricsSession, peekMetrics, readMetrics } from '../src/lib/metrics-resource';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { MetricsSkeleton, MetricsUpdateStatus } from '../src/components/MetricsLoading';
beforeEach(() => clearMetricsCache());
afterEach(() => vi.unstubAllGlobals());
const reply = (value: number, refreshing = false) => new Response(JSON.stringify({ value }), { headers: { 'X-Metrics-Updated-At': '2026-10-07T20:00:00Z', 'X-Metrics-Refreshing': refreshing ? '1' : '0' } });
describe('session metrics resources', () => {
  it('revalidates exact periods, deduplicates in-flight requests, and never aliases another period', async () => {
    const fetcher = vi.fn(async () => reply(7)); vi.stubGlobal('fetch', fetcher);
    await Promise.all([readMetrics('/one?days=7'), readMetrics('/one?days=7')]);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(peekMetrics('/one?days=30')).toBeNull();
    await readMetrics('/one?days=7'); expect(fetcher).toHaveBeenCalledTimes(1);
    await readMetrics('/one?days=30'); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('manual refresh bypasses browser cache and reports the real snapshot timestamp', async () => {
    const fetcher = vi.fn(async () => reply(7, true)); vi.stubGlobal('fetch', fetcher);
    await readMetrics('/one'); const value = await readMetrics('/one', { refresh: true });
    expect(fetcher).toHaveBeenCalledTimes(2); expect(fetcher).toHaveBeenLastCalledWith('/one', expect.objectContaining({ headers: expect.objectContaining({ 'X-Metrics-Refresh': '1' }) }));
    expect(value).toMatchObject({ refreshing: true, updatedAt: '2026-10-07T20:00:00Z' });
  });
  it('rechecks a previously loaded One selection and clears it on revoked access', async () => {
    const url = '/api/analytics/all?view=one';
    const fetcher = vi.fn().mockResolvedValueOnce(reply(7)).mockResolvedValueOnce(new Response('{}', { status: 403 }));
    vi.stubGlobal('fetch', fetcher);
    await readMetrics(url);
    await expect(readMetrics(url)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenLastCalledWith(url, expect.objectContaining({ headers: expect.objectContaining({ 'X-Metrics-Passive-Read': '1' }) }));
    expect(peekMetrics(url)).toBeNull();
  });
  it('logout prevents an in-flight response from repopulating a new session cache', async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal('fetch', () => new Promise<Response>(yes => { resolve = yes; }));
    const old = readMetrics('/one'); clearMetricsCache(); resolve(reply(7));
    await expect(old).rejects.toThrow('Session changed'); expect(peekMetrics('/one')).toBeNull();
  });
  it('authorization failure clears other cached resources', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(reply(7)).mockResolvedValueOnce(new Response('{}', { status: 401 })));
    await readMetrics('/one'); await expect(readMetrics('/growth')).rejects.toThrow(); expect(peekMetrics('/one')).toBeNull();
  });
  it('signals reauthentication only for same-origin analytics 401 responses', async () => {
    const target = new EventTarget(), listener = vi.fn(); target.addEventListener('metrics:session-required', listener);
    vi.stubGlobal('window', Object.assign(target, { location: { origin: 'https://metrics.example.invalid' } }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{}', { status: 403 })).mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 401 })));
    await expect(readMetrics('/api/analytics/all')).rejects.toThrow(); expect(listener).toHaveBeenCalledTimes(1);
    await expect(readMetrics('/api/analytics/all')).rejects.toThrow();
    await expect(readMetrics('/api/analytics/all')).rejects.toThrow();
    await expect(readMetrics('https://other.example.invalid/api/analytics/all')).rejects.toThrow();
    expect(listener).toHaveBeenCalledTimes(1);
  });
  it('does not invalidate a newer session when an old request later returns 401', async () => {
    const target = new EventTarget(), listener = vi.fn(); target.addEventListener('metrics:session-required', listener);
    vi.stubGlobal('window', Object.assign(target, { location: { origin: 'https://metrics.example.invalid' } }));
    let resolve!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(() => new Promise<Response>(yes => { resolve = yes; })).mockResolvedValueOnce(reply(9)));
    const old = readMetrics('/api/analytics/all?old=1'); invalidateMetricsSession();
    await readMetrics('/api/analytics/all?new=1'); resolve(new Response('{}', { status: 401 }));
    await expect(old).rejects.toThrow('Session changed'); expect(listener).not.toHaveBeenCalled();
    expect(peekMetrics('/api/analytics/all?new=1')).toMatchObject({ data: { value: 9 } });
  });
  it('does not let an unrelated 403 suppress a same-session analytics 401', async () => {
    const target = new EventTarget(), listener = vi.fn(); target.addEventListener('metrics:session-required', listener);
    vi.stubGlobal('window', Object.assign(target, { location: { origin: 'https://metrics.example.invalid' } }));
    let resolve!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(() => new Promise<Response>(yes => { resolve = yes; }))
      .mockResolvedValueOnce(new Response('{}', { status: 403 })));
    const pending = readMetrics('/api/analytics/all'); await expect(readMetrics('/api/analytics/instagram')).rejects.toThrow();
    resolve(new Response('{}', { status: 401 })); await expect(pending).rejects.toThrow(); expect(listener).toHaveBeenCalledOnce();
  });
  it('loading UI has accessible skeletons and never claims unavailable data is a successful update', () => {
    expect(renderToStaticMarkup(createElement(MetricsSkeleton))).toContain('aria-busy="true"');
    const pending = renderToStaticMarkup(createElement(MetricsUpdateStatus, { period: 'Oct 1 to Oct 7', loading: true }));
    expect(pending).toContain('Loading Oct 1 to Oct 7'); expect(pending).not.toContain('Showing');
    const failed = renderToStaticMarkup(createElement(MetricsUpdateStatus, { error: true }));
    expect(failed).toContain('Metrics unavailable'); expect(failed).not.toContain('last successful');
  });
});
