import { describe, expect, it, vi } from 'vitest';
import { digest } from '../src/server/reports/contracts';
import { MetricsCollection } from '../src/server/reports/lifecycle';
import { sourceBindingGeneration, validateSourceBinding } from '../src/server/reports/bindings';
import { OneAdoptionSource } from '../src/server/reports/sources';
import { SourceRequestFailure } from '../src/server/reports/source-errors';
import { collectionFixture } from './helpers/metrics-collection-fixture';

describe('collector source binding', () => {
  it('binds exact approval, scope, coverage, source generation and purpose-pinned credentials', async () => {
    const f = collectionFixture(); await f.initialize(); const job = (await f.worker.claim((await f.reports.request(f.request, f.access)).jobId!, digest('w')))!.job;
    expect(validateSourceBinding(f.binding, job)).toEqual(f.binding);
    for (const bad of [{ ...f.binding, approved: false }, { ...f.binding, enabled: false }, { ...f.binding, scopeDigest: digest('other') },
      { ...f.binding, coverageFrom: '2026-11-12' }, { ...f.binding, reconciliationDigest: '' }, { ...f.binding, secretVersion: 'projects/demo-metrics/secrets/plg-export/versions/latest' },
      { ...f.binding, revision: 2 }, { ...f.binding, privateEmail: 'private@example.invalid' }]) {
      await expect(Promise.resolve().then(() => validateSourceBinding(bad, job))).rejects.toMatchObject({ code: 'unavailable' });
    }
    expect(sourceBindingGeneration({ ...f.binding, approved: false })).toBe(f.binding.sourceGeneration);
  });
});

describe('collector lifecycle', () => {
  it('is default closed and makes no provider or factory calls without collection policy', async () => {
    const f = collectionFixture(), factory = vi.fn();
    await expect(new MetricsCollection(f.store, factory, f.clock).collect(digest('job'), digest('worker'))).rejects.toMatchObject({ code: 'unavailable' });
    expect(factory).not.toHaveBeenCalled();
  });
  it('collects and publishes once, coalesces redelivery and keeps reads source-free', async () => {
    const f = collectionFixture(); await f.initialize(); let calls = 0;
    const factory = vi.fn(async () => new OneAdoptionSource(f.store, { sourceGeneration: f.binding.sourceGeneration, timeoutMs: 1000, maxResponseBytes: 20_000 }, 'uat',
      async () => { calls++; const job = await f.worker.inspect(id); return Response.json(f.result(job!)); }, f.clock));
    const id = (await f.reports.request(f.request, f.access)).jobId!;
    const one = new MetricsCollection(f.store, factory, f.clock), two = new MetricsCollection(f.store, factory, f.clock);
    const results = await Promise.all([one.collect(id, digest('one')), two.collect(id, digest('two'))]);
    expect(results.some(r => r.state === 'completed')).toBe(true);
    for (let i = 0; i < 10; i++) expect((await f.reports.read(f.request, f.access)).report?.result.metrics.activeAccounts.value).toBe(2);
    expect((await one.collect(id, digest('redelivery'))).state).toBe('completed');
    expect(calls).toBe(1); expect(factory).toHaveBeenCalledTimes(1);
    expect(await f.get('capacity', 'custom')).toEqual({ active: 0 });
  });
  it('does not read credentials or call a provider for invalid or unreviewed bindings', async () => {
    const f = collectionFixture(); await f.initialize(); await f.put('sources', f.request.reportId, { ...f.binding, approved: false });
    const id = (await f.reports.request(f.request, f.access)).jobId!, factory = vi.fn();
    const result = await new MetricsCollection(f.store, factory, f.clock).collect(id, digest('one'));
    expect(result).toMatchObject({ state: 'delayed', needsAttention: true, retryAfterMs: 0 });
    expect(factory).not.toHaveBeenCalled(); expect(await f.get('capacity', 'custom')).toEqual({ active: 1 });
  });
  it('stops repeated attempts after an uncertain provider submission and preserves its reservation', async () => {
    const f = collectionFixture(); await f.initialize(); let calls = 0;
    const id = (await f.reports.request(f.request, f.access)).jobId!;
    const factory = async () => new OneAdoptionSource(f.store, { sourceGeneration: f.binding.sourceGeneration, timeoutMs: 1000, maxResponseBytes: 20_000 }, 'uat',
      async () => { calls++; throw new Error('Lost acknowledgement'); }, f.clock);
    const collector = new MetricsCollection(f.store, factory, f.clock, () => 1);
    for (let i = 0; i < 4; i++) { await collector.collect(id, digest('worker')); f.advance(2001); }
    const job = (await f.worker.inspect(id))!;
    expect(calls).toBe(1); expect(job).toMatchObject({ needsAttention: true, fence: 3, sourceStarted: true });
    expect((await f.reports.status(id, f.access)).retryAfterMs).toBe(0);
    expect(await f.get('capacity', 'custom')).toEqual({ active: 1 });
    expect(await f.get('sourceCircuits', f.binding.sourceGeneration)).toMatchObject({ failures: 1 });
  });
  it('recovers a durable completed source receipt after publication interruption without provider calls', async () => {
    const f = collectionFixture(); await f.initialize(); const id = (await f.reports.request(f.request, f.access)).jobId!;
    const first = (await f.worker.claim(id, digest('first')))!.job; let calls = 0;
    const factory = async () => new OneAdoptionSource(f.store, { sourceGeneration: f.binding.sourceGeneration, timeoutMs: 1000, maxResponseBytes: 20_000 }, 'uat',
      async () => { calls++; return Response.json(f.result(first)); }, f.clock);
    await (await factory()).submit(first); f.advance(f.policy.leaseMs + 1);
    await f.put('sourcePolicies', f.binding.sourceGeneration, { approved: false }); // recovery is entirely source-free
    expect((await new MetricsCollection(f.store, factory, f.clock).collect(id, digest('recovery'))).state).toBe('completed');
    expect(calls).toBe(1);
  });
  it('blocks a broken credential immediately and honors the shared provider backoff before new requests', async () => {
    const f = collectionFixture(); await f.initialize(); const factory = vi.fn(async () => ({ submit: async () => { throw new SourceRequestFailure('configuration'); }, recover: async () => null }));
    const collector = new MetricsCollection(f.store, factory, f.clock);
    const first = (await f.reports.request(f.request, f.access)).jobId!;
    expect((await collector.collect(first, digest('w'))).needsAttention).toBe(true);
    const second = (await f.reports.request({ ...f.request, startDate: '2026-11-10' }, f.access)).jobId!;
    expect((await collector.collect(second, digest('w'))).needsAttention).toBe(true);
    expect(factory).toHaveBeenCalledTimes(1);
  });
  it('preserves an active last lease when another delivery reaches the claim bound', async () => {
    const f = collectionFixture(); await f.initialize(); await f.put('policy', 'collection', { approved: true, enabled: true, maxClaims: 1, retryDelayMs: 500 });
    const id = (await f.reports.request(f.request, f.access)).jobId!, job = (await f.worker.claim(id, digest('active')))!.job;
    const factory = vi.fn(); const result = await new MetricsCollection(f.store, factory, f.clock).collect(id, digest('contender'));
    expect(result).toMatchObject({ state: 'running', needsAttention: false }); expect(factory).not.toHaveBeenCalled();
    await f.worker.publish(job, f.result(job)); expect((await f.reports.status(id, f.access)).state).toBe('completed');
  });
});
