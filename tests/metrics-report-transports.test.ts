import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { boundedText, cloudTasksRequest, googleAggregateFetch, readAggregateSecret, signedOneAggregateFetch } from '../src/server/reports/transports';
import { providerRetryAfter } from '../src/server/reports/source-errors';
import { collectorSourceFactory } from '../src/server/reports/source-factory';
import { collectionFixture } from './helpers/metrics-collection-fixture';
import { digest } from '../src/server/reports/contracts';

describe('collector-only bounded native transports', () => {
  const signal = () => AbortSignal.timeout(1000);
  it('rejects endpoint changes before looking up credentials and never follows redirects', async () => {
    const credentials = vi.fn(async (_audience: 'analytics' | 'cloud', _signal: AbortSignal) => ({ Authorization: 'Bearer synthetic' })), fetcher = vi.fn<typeof fetch>(async () => Response.json({}));
    const endpoint = 'https://analyticsdata.googleapis.com/v1beta/properties/123456:runReport';
    const transport = googleAggregateFetch(endpoint, credentials, fetcher);
    await expect(transport('https://example.invalid/', { body: {}, signal: signal() })).rejects.toMatchObject({ code: 'invalid' });
    expect(credentials).not.toHaveBeenCalled();
    await transport(endpoint, { body: { metrics: [] }, signal: signal() });
    expect(credentials.mock.calls[0][0]).toBe('analytics'); expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error', method: 'POST' });
  });
  it('reads only a purpose-pinned numbered secret and bounds its decoded size', async () => {
    const credentials = vi.fn(async (_audience: 'analytics' | 'cloud', _signal: AbortSignal) => ({ Authorization: 'Bearer synthetic' }));
    const version = 'projects/demo-metrics/secrets/metrics-one-aggregate-source-uat/versions/1';
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ payload: { data: Buffer.alloc(32, 7).toString('base64') } }));
    const key = await readAggregateSecret(version, signal(), credentials, fetcher); expect(key).toEqual(Buffer.alloc(32, 7));
    expect(fetcher.mock.calls[0][0]).toBe(`https://secretmanager.googleapis.com/v1/${version}:access`);
    for (const bad of [version.replace('/1', '/latest'), version.replace('metrics-one-aggregate-source-uat', 'plg-export'), version + '?x=1']) {
      await expect(readAggregateSecret(bad, signal(), credentials, fetcher)).rejects.toMatchObject({ code: 'invalid' });
    }
    expect(credentials).toHaveBeenCalledTimes(1);
    await expect(readAggregateSecret(version, signal(), credentials, async () => Response.json({ payload: { data: 'x' } }))).rejects.toMatchObject({ kind: 'configuration' });
  });
  it('signs the exact One environment/body/purpose without sending the key or staff identity', async () => {
    const key = Buffer.alloc(32, 9), fetcher = vi.fn<typeof fetch>(async () => Response.json({}));
    const transport = signedOneAggregateFetch('uat', key, fetcher, () => 123456);
    const body = { period: { startDate: '2026-11-01', endDate: '2026-11-02', timezone: 'UTC' } };
    await expect(transport('https://api.hushh.ai/api/one/metrics/adoption', { body, signal: signal() })).rejects.toThrow();
    await transport('https://api.uat.hushh.ai/api/one/metrics/adoption', { body, signal: signal() });
    const options = fetcher.mock.calls[0][1] as RequestInit;
    const headers = options.headers as Record<string, string>;
    expect(headers['X-Metrics-Signature']).toBe(createHmac('sha256', key).update(`metrics-one-aggregate-v1:123456:${JSON.stringify(body)}`).digest('hex'));
    expect(options.redirect).toBe('error'); expect(headers).not.toHaveProperty('Authorization');
    expect(JSON.stringify(options)).not.toContain(key.toString('base64'));
  });
  it('limits streamed response bytes even when the source omits content length', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(20)); }, cancel() { cancelled = true; } });
    await expect(boundedText(new Response(body), 10, signal())).rejects.toMatchObject({ kind: 'configuration' }); expect(cancelled).toBe(true);
    await expect(boundedText(new Response('x', { headers: { 'Content-Length': '100' } }), 10, signal())).rejects.toThrow();
    expect(await boundedText(new Response('small'), 10, signal())).toBe('small');
  });
  it('pins task API resources and withholds credentials on invalid paths', async () => {
    const credentials = vi.fn(async (_audience: 'analytics' | 'cloud', _signal: AbortSignal) => ({ Authorization: 'Bearer synthetic' })), fetcher = vi.fn<typeof fetch>(async () => Response.json({ name: 'fixed' }));
    const request = cloudTasksRequest(1000, credentials, fetcher);
    await expect(request('https://cloudtasks.googleapis.com/v2/projects/demo-metrics/locations/us-central1/queues/other/tasks', { method: 'POST', signal: signal() })).rejects.toThrow();
    expect(credentials).not.toHaveBeenCalled();
    expect(await request('https://cloudtasks.googleapis.com/v2/projects/demo-metrics/locations/us-central1/queues/metrics-reporting-test/tasks', { method: 'POST', signal: signal(), body: {} })).toEqual({ status: 200, name: 'fixed' });
    expect(credentials.mock.calls[0][0]).toBe('cloud'); expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
  });
  it('parses provider cooldowns without accepting invalid or negative values', () => {
    const now = Date.parse('2026-11-13T00:00:00Z');
    expect(providerRetryAfter('90', now)).toBe(90_000); expect(providerRetryAfter(new Date(now + 30_000).toUTCString(), now)).toBe(30_000);
    expect(providerRetryAfter('-1', now)).toBe(0); expect(providerRetryAfter('not a time', now)).toBe(0);
  });
  it('does not access a One signing key until source admission, and zeroes it after the fetch', async () => {
    const f = collectionFixture(); await f.initialize(); const id = (await f.reports.request(f.request, f.access)).jobId!;
    const job = (await f.worker.claim(id, digest('worker')))!.job;
    const key = Buffer.alloc(32, 8), secret = vi.fn(async () => key);
    const one = vi.fn(() => async () => Response.json(f.result(job)));
    const source = await collectorSourceFactory(f.store, { secret, one, now: f.clock })(job, f.binding, signal());
    expect(secret).not.toHaveBeenCalled();
    await source.submit(job); expect(secret).toHaveBeenCalledTimes(1); expect(key.every(v => v === 0)).toBe(true);
    await source.recover(job); expect(secret).toHaveBeenCalledTimes(1);
  });
});
