import { describe, expect, it, vi } from 'vitest';
import { refreshReport } from '../src/lib/report-refresh';

const request = { reportId: 'one.adoption' as const, startDate: '2026-11-12', endDate: '2026-11-12', timezone: 'UTC' };
const id = 'a'.repeat(64);
const accepted = () => Response.json({ state: 'accepted', jobId: id, reportId: null }, { status: 202 });

describe('explicit bounded report refresh', () => {
  it('reuses a published result through the existing admission path without polling', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ state: 'completed', jobId: null, reportId: id })), pause = vi.fn();
    expect(await refreshReport(request, new AbortController().signal, { fetcher, pause })).toBe('completed');
    expect(fetcher).toHaveBeenCalledTimes(1); expect(pause).not.toHaveBeenCalled();
    expect(fetcher.mock.calls[0]).toEqual(['/api/report-jobs', expect.objectContaining({ method: 'POST',
      credentials: 'same-origin', cache: 'no-store', body: JSON.stringify(request) })]);
  });
  it('honors bounded server backoff and stops as soon as the matching job finishes', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(Response.json({ state: 'delayed', jobId: id, retryAfterMs: 90_000 }))
      .mockResolvedValueOnce(Response.json({ state: 'completed', jobId: id }));
    const pause = vi.fn<(ms: number, signal: AbortSignal) => Promise<void>>(async () => {});
    expect(await refreshReport(request, new AbortController().signal, { fetcher, pause, now: () => 0 })).toBe('completed');
    expect(pause.mock.calls.map(call => call[0])).toEqual([1000, 30_000]);
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(['/api/report-jobs', `/api/report-jobs/${id}`, `/api/report-jobs/${id}`]);
  });
  it.each([401, 403, 429, 503])('does not retry an HTTP %s response', async status => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({}, { status }));
    expect(await refreshReport(request, new AbortController().signal, { fetcher })).toBe(status < 429 ? 'unauthorized' : 'unavailable');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('stops for attention and does not create another job', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(Response.json({ state: 'delayed', jobId: id, needsAttention: true }));
    expect(await refreshReport(request, new AbortController().signal, { fetcher, pause: async () => {} })).toBe('attention');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('navigation abort stops pending polling without cancelling shared server work', async () => {
    const controller = new AbortController(), fetcher = vi.fn<typeof fetch>(async () => accepted());
    const work = refreshReport(request, controller.signal, { fetcher, pause: async () => controller.abort(new Error('Navigation')) });
    await expect(work).rejects.toThrow('Navigation');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('caps an indefinitely running job at twenty status requests', async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => init?.method === 'POST' ? accepted()
      : Response.json({ state: 'running', jobId: id, retryAfterMs: 0 }));
    expect(await refreshReport(request, new AbortController().signal, { fetcher, pause: async () => {}, now: () => 0 })).toBe('pending');
    expect(fetcher).toHaveBeenCalledTimes(21);
  });
  it('stops at the elapsed-time bound before another status request', async () => {
    let clock = 0; const fetcher = vi.fn<typeof fetch>(async () => accepted());
    expect(await refreshReport(request, new AbortController().signal, { fetcher, pause: async () => { clock = 120_001; }, now: () => clock })).toBe('pending');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects late results for a different job and oversized response bodies', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(Response.json({ state: 'completed', jobId: 'b'.repeat(64) }));
    expect(await refreshReport(request, new AbortController().signal, { fetcher, pause: async () => {} })).toBe('unavailable');
    const oversized = vi.fn<typeof fetch>(async () => new Response('x'.repeat(8193)));
    expect(await refreshReport(request, new AbortController().signal, { fetcher: oversized })).toBe('unavailable');
  });
  it.each(['fetch', 'body'])('bounds an uncooperative %s wait and stops without another request', async stage => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn<typeof fetch>(async () => stage === 'fetch' ? new Promise<Response>(() => {})
        : new Response(new ReadableStream({ pull: () => new Promise(() => {}) })));
      const work = refreshReport(request, new AbortController().signal, { fetcher });
      await vi.advanceTimersByTimeAsync(10_001);
      expect(await work).toBe('unavailable');
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
});
