import { describe, expect, it, vi } from 'vitest';
import { digest, reportKey } from '../src/server/reports/contracts';
import { MetricsReportWebClient } from '../src/server/reports/web-client';
import { collectionFixture } from './helpers/metrics-collection-fixture';

const config = { audience: 'https://metrics-report-example.run.app', timeoutMs: 1000, maxResponseBytes: 20_000 };
describe('source-free Metrics web broker client', () => {
  it('uses only a fixed audience-scoped invocation identity and keeps GET rendering source-free', async () => {
    const f = collectionFixture(), identity = vi.fn(async (_audience: string, _signal: AbortSignal) => ({ Authorization: 'Bearer synthetic-invocation-token' }));
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ state: 'unavailable', report: null }));
    const client = new MetricsReportWebClient(config, identity, fetcher);
    expect(await client.read(f.request, f.access)).toEqual({ state: 'unavailable', report: null });
    expect(fetcher.mock.calls[0][0]).toBe(`${config.audience}/internal/metrics/read`);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'error' });
    expect(identity.mock.calls[0][0]).toBe(config.audience);
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual({ access: f.access, request: f.request });
  });
  it('requires explicit private origin and does not use ambient datastore/source config', () => {
    const identity = vi.fn();
    for (const audience of ['http://example.run.app', 'https://example.run.app/extra', 'https://example.invalid', 'https://example.run.app?source=override']) {
      expect(() => new MetricsReportWebClient({ ...config, audience }, identity)).toThrow();
    }
    expect(identity).not.toHaveBeenCalled();
  });
  it('revalidates aggregate-only response identity and rejects private fields or cross-scope publications', async () => {
    const f = collectionFixture(); await f.initialize(); const job = (await f.worker.claim((await f.reports.request(f.request, f.access)).jobId!, digest('worker')))!.job;
    const report = { id: job.id, key: reportKey(f.request, f.control), request: f.request, control: f.control,
      result: f.result(job), computedAt: f.clock(), publishedAt: f.clock() };
    let value: unknown = { state: 'completed', report };
    const client = new MetricsReportWebClient(config, async () => ({}), async () => Response.json(value), f.clock);
    expect((await client.read(f.request, f.access)).report?.id).toBe(job.id);
    for (const bad of [{ ...report, privateEmail: 'private@example.invalid' }, { ...report, control: { ...report.control, scopeDigest: digest('other') } },
      { ...report, result: { ...report.result, prompt: 'private' } }, { ...report, request: { ...report.request, startDate: '2026-11-01' } }]) {
      value = { state: 'completed', report: bad }; await expect(client.read(f.request, f.access)).rejects.toThrow();
    }
  });
  it('enforces payload bounds and sanitizes provider detail on broker errors', async () => {
    const f = collectionFixture();
    let response = Response.json({ private: 'x'.repeat(30_000) });
    const client = new MetricsReportWebClient(config, async () => ({}), async () => response);
    await expect(client.read(f.request, f.access)).rejects.toMatchObject({ code: 'unavailable' });
    response = new Response('provider token private details', { status: 403 });
    await expect(client.read(f.request, f.access)).rejects.toThrow('Metrics report unavailable.');
  });
  it('validates progress and publication-only reuse without starting another request', async () => {
    const f = collectionFixture(), id = digest('job'); let value: unknown = { state: 'completed', reportId: id, jobId: null };
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(value));
    const client = new MetricsReportWebClient(config, async () => ({}), fetcher);
    expect((await client.request(f.request, f.access)).jobId).toBeNull();
    value = { state: 'delayed', jobId: id, acceptedAt: f.clock(), queueWaitMs: 0, executionMs: 500, retryAfterMs: 0, needsAttention: true };
    expect((await client.status(id, f.access)).needsAttention).toBe(true);
    value = { ...(value as object), retryAfterMs: 10 }; await expect(client.status(id, f.access)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
