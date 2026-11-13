import { describe, expect, it } from 'vitest';
import { digest } from '../src/server/reports/contracts';
import { Ga4AcquisitionSource } from '../src/server/reports/sources';
import { collectionFixture } from './helpers/metrics-collection-fixture';

const header = { metadata: { timeZone: 'UTC' }, metricHeaders: ['sessions', 'activeUsers', 'engagedSessions', 'keyEvents'].map(name => ({ name })) };
async function gaFixture(data: unknown) {
  const f = collectionFixture(); await f.initialize(); await f.put('controls', 'hushhai.acquisition', f.control);
  const request = { ...f.request, reportId: 'hushhai.acquisition' }, id = (await f.reports.request(request, f.access)).jobId!;
  const job = (await f.worker.claim(id, digest('ga-worker')))!.job;
  const source = new Ga4AcquisitionSource(f.store, { sourceGeneration: f.control.sourceGeneration, timeoutMs: 1000, maxResponseBytes: 20_000 },
    { propertyId: '123456', timezone: 'UTC', informationWatermark: null }, async () => Response.json(data), f.clock);
  return { ...f, request, job, source };
}
describe('GA4 report values and honest freshness', () => {
  it('preserves actual counts without inventing a completeness watermark and reuses publication', async () => {
    const f = await gaFixture({ ...header, rowCount: 1, rows: [{ metricValues: ['5', '3', '4', '1'].map(value => ({ value })) }] });
    const result = (await f.source.submit(f.job))!; await f.worker.publish(f.job, result);
    expect(result.metrics.sessions).toEqual({ value: 5, coverage: 'partial', basis: 'provider_defined', unit: 'session' });
    expect(result.sourceWatermark).toBeNull(); expect((await f.reports.read(f.request, f.access)).state).toBe('unknown_freshness');
    expect((await f.reports.request(f.request, f.access)).jobId).toBeNull();
    f.advance(f.control.staleMs + 1); expect((await f.reports.read(f.request, f.access)).report).toBeNull();
  });
  it.each([
    { ...header, rowCount: 1 }, { ...header, rows: [{ metricValues: [{ value: '5' }] }] },
    { ...header, rowCount: -1 }, { ...header, rowCount: 0, rows: [{ metricValues: [] }] },
    { ...header, rows: [{ metricValues: [{ value: '5' }, {}, {}, {}] }] },
    { ...header, metadata: { timeZone: 'America/Los_Angeles' } },
  ])('rejects malformed/inconsistent provider output instead of fabricating zero', async data => {
    const f = await gaFixture(data); await expect(f.source.submit(f.job)).rejects.toMatchObject({ kind: 'configuration' });
    expect((await f.reports.read(f.request, f.access)).report).toBeNull();
  });
  it('distinguishes an explicitly empty valid provider report from an unavailable response', async () => {
    const f = await gaFixture({ ...header, rowCount: 0 }); const result = (await f.source.submit(f.job))!;
    expect(result.metrics.activeUsers.value).toBe(0); expect(result.metrics.activeUsers.coverage).toBe('partial');
  });
  it('accepts equivalent provider timezone aliases without treating export days as UTC', async () => {
    const f = await gaFixture({ ...header, metadata: { timeZone: 'Etc/UTC' }, rowCount: 0 });
    expect((await f.source.submit(f.job))?.period.timezone).toBe('UTC');
  });
  it('never admits unknown-freshness exact One counts', async () => {
    const f = collectionFixture(); await f.initialize(); const job = (await f.worker.claim((await f.reports.request(f.request, f.access)).jobId!, digest('one')))!.job;
    await expect(f.worker.publish(job, { ...f.result(job), sourceWatermark: null })).rejects.toMatchObject({ code: 'invalid' });
  });
});
