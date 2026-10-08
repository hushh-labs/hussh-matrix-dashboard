import { describe, it, expect } from 'vitest';
import { AggregateCache, canonicalAnalyticsKey } from '../src/server/aggregate-cache';
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

describe('aggregate snapshot freshness and isolation', () => {
  it('coalesces simultaneous cold requests but keeps date and environment keys separate', async () => {
    const cache = new AggregateCache<number>({ freshMs: 60, maxAgeMs: 600, maxEntries: 4 });
    const job = deferred<number>(); let calls = 0;
    const load = () => { calls++; return job.promise; };
    const first = cache.read('production:7', load), second = cache.read('production:7', load);
    job.resolve(7);
    expect((await first).value).toBe(7); expect((await second).state).toBe('COALESCED'); expect(calls).toBe(1);
    expect((await cache.read('production:30', async () => 30)).value).toBe(30);
    expect((await cache.read('uat:7', async () => 2)).value).toBe(2);
  });
  it('returns a dated snapshot immediately and completes a forced refresh behind it', async () => {
    let now = 100; const cache = new AggregateCache<number>({ freshMs: 60, maxAgeMs: 600, maxEntries: 4, now: () => now });
    await cache.read('7d', async () => 7);
    now = 120; const job = deferred<number>();
    const refreshing = await cache.read('7d', () => job.promise, true);
    expect(refreshing).toMatchObject({ value: 7, at: 100, refreshing: true });
    now = 130; job.resolve(8); await job.promise; await new Promise(resolve => setTimeout(resolve, 0));
    expect(await cache.read('7d', async () => 99)).toMatchObject({ value: 8, at: 130, refreshing: false });
  });
  it('preserves the last success on failure but never presents an expired snapshot as current', async () => {
    let now = 100; const cache = new AggregateCache<number>({ freshMs: 60, maxAgeMs: 600, maxEntries: 4, now: () => now });
    await cache.read('7d', async () => 7);
    now = 200; await cache.read('7d', async () => { throw new Error('source down'); });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(await cache.read('7d', async () => 99)).toMatchObject({ at: 100, refreshError: true });
    now = 800;
    await expect(cache.read('7d', async () => { throw new Error('source down'); })).rejects.toThrow('source down');
  });
  it('refreshes only recently used ranges and bounds snapshot storage', async () => {
    let now = 0, calls = 0; const cache = new AggregateCache<number>({ freshMs: 60, maxAgeMs: 600, maxEntries: 2, now: () => now });
    const load = async () => ++calls;
    await cache.read('old', load); now = 130_000; await cache.read('active', load); now += 70;
    await cache.refreshActive(); expect(calls).toBe(3);
    await cache.read('other', load); expect(cache.size).toBe(2);
  });
  it('canonicalizes query order without combining dates or view scope', () => {
    expect(canonicalAnalyticsKey('/api/analytics/all?view=one&one_start_date=2026-10-01')).toBe(canonicalAnalyticsKey('/api/analytics/all?one_start_date=2026-10-01&view=one'));
    expect(canonicalAnalyticsKey('/api/analytics/all?view=one')).not.toBe(canonicalAnalyticsKey('/api/analytics/all?view=growth'));
    expect(canonicalAnalyticsKey('/api/analytics/all?view=platforms&kai_start_date=2026-10-01')).toBe(canonicalAnalyticsKey('/api/analytics/all?kai_start_date=2026-10-01&view=overview'));
  });
  it('keeps a recently read period when custom ranges fill the cache', async () => {
    const cache = new AggregateCache<number>({ freshMs: 60_000, maxAgeMs: 600_000, maxEntries: 2 });
    await cache.read('a', async () => 1); await cache.read('b', async () => 2);
    await cache.read('a', async () => 9); await cache.read('c', async () => 3);
    expect((await cache.read('a', async () => 9)).value).toBe(1);
    expect((await cache.read('b', async () => 4)).state).toBe('MISS');
  });
});
