import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { digest, reportDefinitions } from '../src/server/reports/contracts';
import { sourceBindingGeneration, validateSourceBinding, websiteSourceOrigins } from '../src/server/reports/bindings';
import { WebsiteActivitySource, type AggregateFetch } from '../src/server/reports/sources';
import { MetricsCollection } from '../src/server/reports/lifecycle';
import { readAggregateSecret, readWebsiteAggregateSecret, signedWebsiteAggregateFetch } from '../src/server/reports/transports';
import { collectionFixture } from './helpers/metrics-collection-fixture';

async function fixture() {
  const f = collectionFixture(); await f.initialize();
  const { environment: _environment, secretVersion: _secret, ...common } = f.binding as typeof f.binding & { environment: string; secretVersion: string };
  const content = { ...common, kind: 'website' as const, reportId: 'hushhai.activity' as const, environment: 'production' as const,
    captureGeneration: digest('source-capture-fixture'), coverageThrough: '2026-11-07', coverageFrom: '2026-11-01', maxEventsPerDay: 10,
    secretVersion: 'projects/hushh-ai-prod/secrets/metrics-website-aggregate-source-production/versions/1' };
  const binding = { ...content, sourceGeneration: sourceBindingGeneration(content) };
  const control = { ...f.control, sourceGeneration: binding.sourceGeneration };
  await f.put('controls', binding.reportId, control); await f.put('sources', binding.reportId, binding);
  await f.put('policy', 'website-read-budget', { approved: true, dailyReadUnits: 13 });
  await f.put('sourcePolicies', binding.sourceGeneration, { approved: true, failureThreshold: 2,
    baseBackoffMs: 1000, maxBackoffMs: 8000, probeLeaseMs: 1000 });
  const request = { ...f.request, reportId: binding.reportId, startDate: '2026-11-05', endDate: '2026-11-05' };
  const id = (await f.reports.request(request, f.access)).jobId!;
  const result = () => ({ ...f.result({ request, control } as never), sourceGeneration: binding.sourceGeneration,
    sourceWatermark: null, metrics: Object.fromEntries(reportDefinitions[binding.reportId].metrics.map((name, index) =>
      [name, { value: index === 0 ? 2 : 1, unit: 'event' as const, basis: 'source_recorded' as const, coverage: 'partial' as const }])) });
  return { ...f, request, binding, control, id, result };
}

describe('warehouse-free source-owned website records', () => {
  it('keeps source events separate from GA4 identity, sessions and confirmed business outcomes', async () => {
    const f = await fixture(), fetcher = vi.fn<AggregateFetch>(async () => Response.json(f.result()));
    const source = () => new WebsiteActivitySource(f.store, { sourceGeneration: f.binding.sourceGeneration,
      timeoutMs: 1000, maxResponseBytes: 20_000 }, 'production', f.binding.captureGeneration, f.binding.maxEventsPerDay, fetcher, f.clock);
    const collection = new MetricsCollection(f.store, async () => source(), f.clock);
    expect((await collection.collect(f.id, digest('website-worker'))).state).toBe('completed');
    expect((await collection.collect(f.id, digest('redelivery'))).state).toBe('completed');
    for (let i = 0; i < 10; i++) {
      const read = await f.reports.read(f.request, f.access);
      expect(read.state).toBe('unknown_freshness');
      expect(read.report?.result.metrics.pageViews).toMatchObject({ value: 2, basis: 'source_recorded', unit: 'event' });
      expect(read.report?.result.metrics).not.toHaveProperty('sessions');
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe(`${websiteSourceOrigins.production}/api/metrics/website/activity`);
    expect(fetcher.mock.calls[0][1].body).toEqual({ period: { startDate: '2026-11-05', endDate: '2026-11-05', timezone: 'UTC' },
      definitionVersion: '1', scopeDigest: f.access.scopeDigest, sourceGeneration: f.binding.sourceGeneration,
      captureGeneration: f.binding.captureGeneration, maxEventsPerDay: 10 });
    expect(await f.get('sourceReadBudgets', 'website-production-2026-11-13')).toEqual({ used: 13, limit: 13 });
  });
  it('requires production authority, exact purpose key, capture generation and reviewed bounded period', async () => {
    const f = await fixture(), job = (await f.worker.claim(f.id, digest('worker')))!.job;
    expect(validateSourceBinding(f.binding, job)).toEqual(f.binding);
    for (const change of [{ environment: 'uat' }, { secretVersion: 'projects/hushh-ai-prod/secrets/plg/versions/1' },
      { captureGeneration: '' }, { coverageThrough: '2026-11-04' }, { coverageFrom: '2026-11-06' },
      { reportId: 'hushhai.acquisition' }]) {
      const bad = { ...f.binding, ...change }; bad.sourceGeneration = sourceBindingGeneration(bad);
      expect(() => validateSourceBinding(bad, { ...job, control: { ...job.control, sourceGeneration: bad.sourceGeneration } })).toThrow();
    }
  });
  it('rejects GA4 or falsely complete event output without publishing invented totals', async () => {
    for (const alteration of ['provider_defined', 'available'] as const) {
      const f = await fixture(), result = f.result();
      if (alteration === 'provider_defined') Object.values(result.metrics).forEach(metric => Object.assign(metric, { basis: alteration }));
      else Object.values(result.metrics).forEach(metric => Object.assign(metric, { coverage: alteration }));
      const source = new WebsiteActivitySource(f.store, { sourceGeneration: f.binding.sourceGeneration,
        timeoutMs: 1000, maxResponseBytes: 20_000 }, 'production', f.binding.captureGeneration, f.binding.maxEventsPerDay, async () => Response.json(result), f.clock);
      const job = (await f.worker.claim(f.id, digest('worker')))!.job;
      await expect(source.submit(job)).rejects.toMatchObject({ code: 'invalid' });
      expect((await f.reports.read(f.request, f.access)).report).toBeNull();
    }
  });
  it('refuses missing or exhausted read budgets before source I/O and never resets retained usage', async () => {
    const f = await fixture(), fetcher = vi.fn<AggregateFetch>(async () => Response.json(f.result()));
    const job = (await f.worker.claim(f.id, digest('worker')))!.job;
    const source = new WebsiteActivitySource(f.store, { sourceGeneration: f.binding.sourceGeneration,
      timeoutMs: 1000, maxResponseBytes: 20_000 }, 'production', f.binding.captureGeneration, 10, fetcher, f.clock);
    await f.put('policy', 'website-read-budget', { approved: false, dailyReadUnits: 100 });
    await expect(source.submit(job)).rejects.toMatchObject({ kind: 'configuration' });
    await f.put('policy', 'website-read-budget', { approved: true, dailyReadUnits: 100 });
    await f.put('sourceReadBudgets', 'website-production-2026-11-13', { used: 13, limit: 13 });
    await expect(source.submit(job)).rejects.toMatchObject({ kind: 'quota', retryAfterMs: 86_400_000 });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await f.get('sourceReadBudgets', 'website-production-2026-11-13')).toEqual({ used: 13, limit: 13 });
  });
  it('retains read reservation after an unknown acknowledgement and never submits again', async () => {
    const f = await fixture(), fetcher = vi.fn<AggregateFetch>(async () => { throw new Error('Synthetic lost acknowledgement'); });
    const job = (await f.worker.claim(f.id, digest('worker')))!.job;
    const source = new WebsiteActivitySource(f.store, { sourceGeneration: f.binding.sourceGeneration,
      timeoutMs: 1000, maxResponseBytes: 20_000 }, 'production', f.binding.captureGeneration, 10, fetcher, f.clock);
    await expect(source.submit(job)).rejects.toThrow('Synthetic lost acknowledgement');
    for (let i = 0; i < 3; i++) expect(await source.recover(job)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await f.get('sourceReadBudgets', 'website-production-2026-11-13')).toEqual({ used: 13, limit: 13 });
  });
  it('uses a distinct HMAC and rejects all endpoint overrides before transport', async () => {
    const f = await fixture(), key = Buffer.alloc(32, 7), fetcher = vi.fn<typeof fetch>(async () => Response.json({}));
    const transport = signedWebsiteAggregateFetch('production', key, fetcher, f.clock);
    const request = { body: { captureGeneration: f.binding.captureGeneration }, signal: AbortSignal.timeout(1000) };
    await transport(`${websiteSourceOrigins.production}/api/metrics/website/activity`, request);
    const init = fetcher.mock.calls[0][1]!, stamp = String(f.clock()), body = JSON.stringify(request.body);
    expect(init.redirect).toBe('error');
    expect(init.headers).toMatchObject({ 'X-Metrics-Signature': createHmac('sha256', key)
      .update(`metrics-website-aggregate-v1:${stamp}:${body}`).digest('hex') });
    for (const url of [`${websiteSourceOrigins.uat}/api/metrics/website/activity`, 'https://api.hushh.ai/api/one/metrics/adoption',
      `${websiteSourceOrigins.production}/api/analytics/event`, 'http://127.0.0.1/api/metrics/website/activity']) {
      await expect(transport(url, request)).rejects.toMatchObject({ code: 'invalid' });
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('cannot use website credentials through the One source reader or mix project/environment keys', async () => {
    const f = await fixture(), signal = AbortSignal.timeout(1000), credentials = vi.fn(), fetcher = vi.fn();
    await expect(readAggregateSecret(f.binding.secretVersion, signal, credentials, fetcher)).rejects.toMatchObject({ code: 'invalid' });
    await expect(readWebsiteAggregateSecret('projects/hushh-ai-uat/secrets/metrics-website-aggregate-source-production/versions/1', signal,
      credentials, fetcher)).rejects.toMatchObject({ code: 'invalid' });
    expect(credentials).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
});
