import { describe, expect, it, vi } from 'vitest';
import { collectionFixture } from './helpers/metrics-collection-fixture';
import { digest, reportDefinitions, type AggregateResult } from '../src/server/reports/contracts';
import { OneAdoptionSource, WebsiteActivitySource, type AggregateFetch } from '../src/server/reports/sources';
import { MetricsCollection } from '../src/server/reports/lifecycle';
import { sourceBindingGeneration } from '../src/server/reports/bindings';
import { forwardMetricsCompatibility, retainedMetricsOrigin } from '../src/server/reports/compatibility';

async function interrupted(known: boolean) {
  const f = collectionFixture(); await f.initialize();
  await f.put('policy', 'current', { ...f.policy, customCapacity: 1, customPerSubjectCapacity: 1 });
  const id = (await f.reports.request(f.request, f.access)).jobId!;
  const claimed = (await f.worker.claim(id, digest('first-worker')))!;
  const fetcher = vi.fn<AggregateFetch>(async () => {
    if (!known) throw new Error('Synthetic lost acknowledgement');
    return Response.json(f.result(claimed.job));
  });
  const source = new OneAdoptionSource(f.store, { sourceGeneration: f.control.sourceGeneration,
    timeoutMs: 1000, maxResponseBytes: 20_000 }, 'uat', fetcher, f.clock);
  if (known) await source.submit(claimed.job);
  else await expect(source.submit(claimed.job)).rejects.toThrow('Synthetic');
  f.advance(f.policy.leaseMs + 1);
  const factory = vi.fn(async () => source);
  return { ...f, id, claimed, source, fetcher, factory, collection: new MetricsCollection(f.store, factory, f.clock) };
}

describe('Kushal review: interrupted source version recovery', () => {
  it.each(['revision', 'generation'])('settles completed source work after a %s change without publishing or submitting again', async change => {
    const f = await interrupted(true);
    await f.put('controls', f.request.reportId, { ...f.control, revision: 2,
      ...(change === 'generation' ? { sourceGeneration: digest('next-source-generation') } : {}) });
    expect((await f.collection.collect(f.id, digest('recovery'))).state).toBe('invalidated');
    expect(await f.worker.inspect(f.id)).toMatchObject({ status: 'invalidated', needsAttention: false, leaseUntil: 0 });
    expect(await f.get('capacity', 'custom')).toEqual({ active: 0 });
    expect(await f.get('subjectCapacity', digest(['custom', f.access.subjectHash]))).toEqual({ active: 0 });
    expect(await f.get('heads', f.claimed.job.key)).toMatchObject({ activeJob: null, publication: null });
    expect(await f.get('snapshots', f.id)).toBeNull();
    expect(await f.get('sourceReceipts', f.id)).toMatchObject({ state: 'completed' });
    expect(f.fetcher).toHaveBeenCalledTimes(1); expect(f.factory).not.toHaveBeenCalled();
    expect((await f.reports.request(f.request, f.access)).state).toBe('accepted');
  });
  it('same-version recovery still publishes the stored outcome once and releases capacity', async () => {
    const f = await interrupted(true);
    expect((await f.collection.collect(f.id, digest('recovery'))).state).toBe('completed');
    expect(await f.get('capacity', 'custom')).toEqual({ active: 0 });
    expect(await f.get('snapshots', f.id)).toBeTruthy();
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['generation', 'period', 'reconciliation', 'binding'])('does not release capacity for a malformed completed %s receipt', async change => {
    const f = await interrupted(true);
    const receipt = (await f.get<{ binding: string; state: string; result: AggregateResult }>('sourceReceipts', f.id))!;
    if (change === 'generation') receipt.result.sourceGeneration = digest('wrong-generation');
    else if (change === 'period') receipt.result.period.endDate = '2026-11-11';
    else if (change === 'reconciliation') receipt.result.reconciled = false;
    else receipt.binding = 'invalid';
    await f.put('sourceReceipts', f.id, receipt); await f.put('controls', f.request.reportId, { ...f.control, revision: 2 });
    expect((await f.collection.collect(f.id, digest('recovery'))).needsAttention).toBe(true);
    expect(await f.get('capacity', 'custom')).toEqual({ active: 1 });
    expect(await f.get('sourceReceipts', f.id)).toEqual(receipt);
    expect(await f.get('snapshots', f.id)).toBeNull();
    expect(f.fetcher).toHaveBeenCalledTimes(1); expect(f.factory).not.toHaveBeenCalled();
  });
  it('retains genuinely uncertain old work and records attention instead of silently leaking running capacity', async () => {
    const f = await interrupted(false), receipt = await f.get('sourceReceipts', f.id);
    await f.put('controls', f.request.reportId, { ...f.control, revision: 2 });
    expect((await f.collection.collect(f.id, digest('recovery'))).needsAttention).toBe(true);
    expect(await f.worker.inspect(f.id)).toMatchObject({ status: 'delayed', needsAttention: true, leaseUntil: 0 });
    expect(await f.get('capacity', 'custom')).toEqual({ active: 1 });
    expect(await f.get('sourceReceipts', f.id)).toEqual(receipt);
    expect(await f.get('snapshots', f.id)).toBeNull();
    await expect(f.reports.request(f.request, f.access)).rejects.toMatchObject({ code: 'capacity' });
    expect(f.fetcher).toHaveBeenCalledTimes(1); expect(f.factory).not.toHaveBeenCalled();
  });
  it('can settle a late known outcome after attention/max claims, fencing two recovery callers', async () => {
    const f = collectionFixture(); await f.initialize();
    await f.put('policy', 'collection', { approved: true, enabled: true, maxClaims: 1, retryDelayMs: 500 });
    const id = (await f.reports.request(f.request, f.access)).jobId!, claim = (await f.worker.claim(id, digest('first')))!;
    let enter!: () => void, resolve!: (response: Response) => void;
    const entered = new Promise<void>(done => { enter = done; });
    const outcome = new Promise<Response>(done => { resolve = done; });
    const fetcher = vi.fn<AggregateFetch>(async () => { enter(); return outcome; });
    const source = new OneAdoptionSource(f.store, { sourceGeneration: f.control.sourceGeneration, timeoutMs: 1000, maxResponseBytes: 20_000 }, 'uat', fetcher, f.clock);
    const pending = source.submit(claim.job); await entered;
    f.advance(f.policy.leaseMs + 1); await f.put('controls', f.request.reportId, { ...f.control, revision: 2 });
    const factory = vi.fn(async () => source), collection = new MetricsCollection(f.store, factory, f.clock);
    await collection.collect(id, digest('uncertain-recovery'));
    expect(await f.get('capacity', 'custom')).toEqual({ active: 1 });
    resolve(Response.json(f.result(claim.job))); await pending;
    await Promise.all([collection.collect(id, digest('settler-one')), collection.collect(id, digest('settler-two'))]);
    expect(await f.worker.inspect(id)).toMatchObject({ status: 'invalidated', needsAttention: false });
    expect(await f.get('capacity', 'custom')).toEqual({ active: 0 });
    expect(await f.get('snapshots', id)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1); expect(factory).not.toHaveBeenCalled();
    await expect(f.worker.publish(claim.job, f.result(claim.job))).rejects.toMatchObject({ code: 'stale_worker' });
  });
});

async function website(exhausted: boolean) {
  const f = collectionFixture(); await f.initialize(); f.advance(86_399_000);
  const { environment: _environment, secretVersion: _secret, ...common } = f.binding as typeof f.binding & { environment: string; secretVersion: string };
  const raw = { ...common, kind: 'website' as const, reportId: 'hushhai.activity' as const, environment: 'production' as const,
    captureGeneration: digest('capture'), coverageFrom: '2026-11-01', coverageThrough: '2026-11-07', maxEventsPerDay: 10,
    secretVersion: 'projects/hushh-ai-prod/secrets/metrics-website-aggregate-source-production/versions/1' };
  const binding = { ...raw, sourceGeneration: sourceBindingGeneration(raw) }, control = { ...f.control, sourceGeneration: binding.sourceGeneration };
  await f.put('sources', binding.reportId, binding); await f.put('controls', binding.reportId, control);
  await f.put('policy', 'website-read-budget', { approved: true, dailyReadUnits: 13 });
  await f.put('sourcePolicies', binding.sourceGeneration, { approved: true, failureThreshold: 2, baseBackoffMs: 1000, maxBackoffMs: 8000, probeLeaseMs: 1000 });
  if (exhausted) await f.put('sourceReadBudgets', 'website-production-2026-11-13', { used: 13, limit: 13 });
  const request = { ...f.request, reportId: binding.reportId, startDate: '2026-11-05', endDate: '2026-11-05' };
  const fetcher = vi.fn<AggregateFetch>(async (_url, options) => Response.json({ ...f.result({ request: {
    ...request, ...(options.body as { period: { startDate: string; endDate: string; timezone: string } }).period }, control } as never), sourceGeneration: binding.sourceGeneration,
    sourceWatermark: null, metrics: Object.fromEntries(reportDefinitions[binding.reportId].metrics.map(name =>
      [name, { value: 1, unit: 'event', basis: 'source_recorded', coverage: 'partial' }])) }));
  const collection = new MetricsCollection(f.store, async () => new WebsiteActivitySource(f.store,
    { sourceGeneration: binding.sourceGeneration, timeoutMs: 1000, maxResponseBytes: 20_000 }, 'production', binding.captureGeneration, 10, fetcher, f.clock), f.clock);
  const id = (await f.reports.request(request, f.access)).jobId!;
  return { ...f, request, binding, id, fetcher, collection };
}

describe('Kushal review: daily allowance reset', () => {
  it('delays exhaustion until UTC reset, then admits once without refunding the prior day or blocking the source', async () => {
    const f = await website(true);
    const delayed = await f.collection.collect(f.id, digest('before-reset'));
    expect(delayed).toMatchObject({ state: 'delayed', needsAttention: false, retryAfterMs: 1000 });
    expect(await f.worker.inspect(f.id)).toMatchObject({ nextAttemptAt: Date.parse('2026-11-14T00:00:00Z'), needsAttention: false });
    expect(f.fetcher).not.toHaveBeenCalled();
    f.advance(500); await f.collection.collect(f.id, digest('still-before-reset')); expect(f.fetcher).not.toHaveBeenCalled();
    f.advance(501);
    expect((await f.collection.collect(f.id, digest('after-reset'))).state).toBe('completed');
    expect((await f.collection.collect(f.id, digest('redelivery'))).state).toBe('completed');
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(await f.get('sourceReadBudgets', 'website-production-2026-11-13')).toEqual({ used: 13, limit: 13 });
    expect(await f.get('sourceReadBudgets', 'website-production-2026-11-14')).toEqual({ used: 13, limit: 13 });
    expect(await f.get('capacity', 'custom')).toEqual({ active: 0 });
  });
  it('retains the successful next-day comparison when the previous day was not exhausted', async () => {
    const f = await website(false); f.advance(1001);
    expect((await f.collection.collect(f.id, digest('next-day-control'))).state).toBe('completed');
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });
  it('admits a distinct valid report after reset without bypassing the new day cap', async () => {
    const f = await website(true); await f.collection.collect(f.id, digest('exhausted'));
    f.advance(1001);
    const fresh = (await f.reports.request({ ...f.request, startDate: '2026-11-06', endDate: '2026-11-06' }, f.access)).jobId!;
    expect(fresh).not.toBe(f.id);
    expect((await f.collection.collect(fresh, digest('fresh'))).state).toBe('completed');
    await f.collection.collect(f.id, digest('old-job-recovery'));
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(await f.get('sourceReadBudgets', 'website-production-2026-11-13')).toEqual({ used: 13, limit: 13 });
    expect(await f.get('sourceReadBudgets', 'website-production-2026-11-14')).toEqual({ used: 13, limit: 13 });
  });
});

const config = { approved: true, legacyOrigin: retainedMetricsOrigin, webNativeOrigin: 'https://metrics-report-web-demo-uc.a.run.app',
  publicOrigin: 'https://metrics.hussh.ai', timeoutMs: 1000, maxRequestBytes: 4096, maxResponseBytes: 4096 };
describe('Kushal review: One preference link compatibility', () => {
  it.each([
    ['/integrations/plg/unsubscribe/synthetic-token', 'https://one.hussh.ai/email/unsubscribe/synthetic-token'],
    ['/integrations/plg/preferences/synthetic-token', 'https://one.hussh.ai/one/profile/account#email-updates'],
  ])('preserves the approved destination for %s', async (path, destination) => {
    const response = await forwardMetricsCompatibility(new Request(config.publicOrigin + path), config,
      async () => new Response(null, { status: 303, headers: { location: destination } }));
    expect(response.status).toBe(303); expect(response.headers.get('location')).toBe(destination);
    expect(response.headers.get('cache-control')).toContain('private, no-store');
  });
  it.each([
    ['/plg', 'https://one.hussh.ai/email/unsubscribe/synthetic-token'],
    ['/integrations/plg/unsubscribe/synthetic-token', 'https://one.hussh.ai/email/unsubscribe/other-token'],
    ['/integrations/plg/unsubscribe/synthetic-token', 'https://one.hussh.ai/email/unsubscribe/synthetic-token?returnTo=https://evil.invalid'],
    ['/integrations/plg/preferences/synthetic-token', 'https://one.hussh.ai/one/profile/account#other-section'],
    ['/integrations/plg/preferences/synthetic-token', 'https://one.hussh.ai.evil.invalid/one/profile/account#email-updates'],
  ])('refuses unrelated or expanded authority for %s -> %s', async (path, destination) => {
    const response = await forwardMetricsCompatibility(new Request(config.publicOrigin + path), config,
      async () => new Response(null, { status: 303, headers: { location: destination } }));
    expect(response.status).toBe(503);
  });
  it('does not grant One redirects to a POST preference mutation', async () => {
    const response = await forwardMetricsCompatibility(new Request(config.publicOrigin + '/integrations/plg/preferences/synthetic-token',
      { method: 'POST', body: 'frequency=weekly' }), config, async () => new Response(null,
      { status: 303, headers: { location: 'https://one.hussh.ai/one/profile/account#email-updates' } }));
    expect(response.status).toBe(503);
  });
});
