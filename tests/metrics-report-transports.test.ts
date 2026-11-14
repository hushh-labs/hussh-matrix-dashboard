import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { analyticsReaderCredentialHeaders, boundedText, cloudTasksRequest, googleAggregateFetch, readAggregateSecret, signedOneAggregateFetch,
  type CredentialHeaders } from '../src/server/reports/transports';
import { providerRetryAfter } from '../src/server/reports/source-errors';
import { collectorSourceFactory } from '../src/server/reports/source-factory';
import { collectionFixture } from './helpers/metrics-collection-fixture';
import { digest } from '../src/server/reports/contracts';
import { sourceBindingGeneration } from '../src/server/reports/bindings';

describe('collector-only bounded native transports', () => {
  const signal = () => AbortSignal.timeout(1000);
  it('carries the approved website scope through the factory and reuses its journal', async () => {
    const f = collectionFixture(); await f.initialize();
    const content = { approved: true, enabled: true, reportId: 'hushhai.acquisition' as const, revision: 1,
      scopeDigest: f.access.scopeDigest, reconciliationDigest: digest('website-reconciliation-fixture'),
      coverageFrom: '2026-11-01', coverageThrough: '2026-11-12', timeoutMs: 1000, maxResponseBytes: 20_000,
      kind: 'ga4' as const, propertyId: '123456', timezone: 'UTC', streamId: '987654321', hostnames: ['www.hushh.ai'],
      readerServiceAccount: 'analytics-reader@demo-metrics.iam.gserviceaccount.com' };
    const binding = { ...content, sourceGeneration: sourceBindingGeneration(content) };
    await f.put('controls', content.reportId, { ...f.control, sourceGeneration: binding.sourceGeneration });
    const request = { ...f.request, reportId: content.reportId };
    const job = (await f.worker.claim((await f.reports.request(request, f.access)).jobId!, digest('website-worker')))!.job;
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ metadata: { timeZone: 'UTC' }, rowCount: 0,
      metricHeaders: ['sessions', 'activeUsers', 'engagedSessions', 'keyEvents'].map(name => ({ name })) }));
    const credentials = vi.fn(async () => ({ Authorization: 'Bearer synthetic' }));
    const google = vi.fn((url: string, reader?: CredentialHeaders) => googleAggregateFetch(url, reader ?? credentials, fetcher));
    const analyticsReader = vi.fn((_principal: string) => credentials);
    const source = await collectorSourceFactory(f.store, { google, analyticsReader, now: f.clock })(job, binding, signal());
    expect(credentials).not.toHaveBeenCalled();
    expect(analyticsReader).toHaveBeenCalledExactlyOnceWith(binding.readerServiceAccount);
    await source.submit(job); await source.recover(job);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(credentials).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(body.dimensionFilter.andGroup.expressions).toEqual([
      { filter: { fieldName: 'streamId', stringFilter: { matchType: 'EXACT', value: binding.streamId, caseSensitive: true } } },
      { filter: { fieldName: 'platform', stringFilter: { matchType: 'EXACT', value: 'web', caseSensitive: true } } },
      { filter: { fieldName: 'hostName', inListFilter: { values: ['www.hushh.ai'], caseSensitive: false } } },
    ]);
  });
  it('delegates only to the approved reader lazily and never falls back after denial', async () => {
    const principal = 'analytics-reader@demo-metrics.iam.gserviceaccount.com';
    const headers = vi.fn(async () => new Headers({ authorization: 'Bearer synthetic-reader-token',
      'x-private-source-header': 'must-not-forward' }));
    const create = vi.fn(async (_principal: string) => ({ getRequestHeaders: headers }));
    const credentials = analyticsReaderCredentialHeaders(principal, create);
    expect(create).not.toHaveBeenCalled();
    await expect(credentials('cloud', signal())).rejects.toMatchObject({ code: 'invalid' });
    expect(create).not.toHaveBeenCalled();
    expect(await credentials('analytics', signal())).toEqual({ Authorization: 'Bearer synthetic-reader-token' });
    expect(create).toHaveBeenCalledExactlyOnceWith(principal);
    await credentials('analytics', signal()); expect(create).toHaveBeenCalledTimes(1);
    const fetcher = vi.fn<typeof fetch>();
    const denied = analyticsReaderCredentialHeaders(principal, async () => { throw new Error('Private provider credential detail'); });
    const endpoint = 'https://analyticsdata.googleapis.com/v1beta/properties/123456:runReport';
    await expect(googleAggregateFetch(endpoint, denied, fetcher)(endpoint, { body: {}, signal: signal() }))
      .rejects.toMatchObject({ kind: 'configuration', message: 'Metrics report unavailable.' });
    expect(fetcher).not.toHaveBeenCalled();
    for (const bad of ['staff@example.invalid', principal + '\n', 'https://identity.example.invalid']) {
      expect(() => analyticsReaderCredentialHeaders(bad, create)).toThrow();
    }
    // The existing documented default-compute reader is a native service account.
    expect(() => analyticsReaderCredentialHeaders('123456789012-compute@developer.gserviceaccount.com', create)).not.toThrow();
    expect(create).toHaveBeenCalledTimes(1);
  });
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
