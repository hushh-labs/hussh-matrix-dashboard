import { describe, expect, it, vi } from 'vitest';
import { digest } from '../src/server/reports/contracts';
import { sourceBindingGeneration, validateSourceBinding } from '../src/server/reports/bindings';
import { MetricsCollection } from '../src/server/reports/lifecycle';
import { Ga4AcquisitionSource, type AggregateFetch } from '../src/server/reports/sources';
import { collectionFixture } from './helpers/metrics-collection-fixture';

const header = { metadata: { timeZone: 'UTC' }, metricHeaders: ['sessions', 'activeUsers', 'engagedSessions', 'keyEvents'].map(name => ({ name })) };
const website = { streamId: '987654321', hostnames: ['hushh.ai', 'www.hushh.ai'] };
async function gaFixture(data: unknown) {
  const f = collectionFixture(); await f.initialize(); await f.put('controls', 'hushhai.acquisition', f.control);
  const request = { ...f.request, reportId: 'hushhai.acquisition' }, id = (await f.reports.request(request, f.access)).jobId!;
  const job = (await f.worker.claim(id, digest('ga-worker')))!.job;
  const fetch = vi.fn<AggregateFetch>(async () => Response.json(data));
  const source = new Ga4AcquisitionSource(f.store, { sourceGeneration: f.control.sourceGeneration, timeoutMs: 1000, maxResponseBytes: 20_000 },
    { ...website, propertyId: '123456', timezone: 'UTC', informationWatermark: null }, fetch, f.clock);
  return { ...f, request, job, source, fetch };
}
describe('GA4 report values and honest freshness', () => {
  it('requires a reviewed GA4 coverage window instead of admitting dates after unknown collection', async () => {
    const f = await gaFixture({ ...header, rowCount: 0 });
    const { environment: _environment, secretVersion: _key, ...common } = f.binding as typeof f.binding & { environment: string; secretVersion: string };
    const legacy = { ...common, reportId: 'hushhai.acquisition', kind: 'ga4', propertyId: '123456', timezone: 'UTC',
      readerServiceAccount: 'analytics-reader@demo-metrics.iam.gserviceaccount.com', ...website };
    legacy.sourceGeneration = sourceBindingGeneration(legacy);
    const jobFor = (binding: { sourceGeneration: string }) => ({ ...f.job, control: { ...f.job.control, sourceGeneration: binding.sourceGeneration } });
    expect(() => validateSourceBinding(legacy, jobFor(legacy))).toThrow();
    const closed = { ...legacy, coverageThrough: f.request.endDate };
    closed.sourceGeneration = sourceBindingGeneration(closed);
    expect(validateSourceBinding(closed, jobFor(closed))).toEqual(closed);
    for (const coverageThrough of [undefined, null, '', '2026-02-30', '2026-11-12T23:59:59Z', '2026-10-31', '2026-11-11']) {
      const bad = { ...closed, coverageThrough }; bad.sourceGeneration = sourceBindingGeneration(bad);
      expect(() => validateSourceBinding(bad, jobFor(bad))).toThrow();
    }
    expect(() => validateSourceBinding(closed, { ...jobFor(closed), request: { ...f.job.request, endDate: '2026-11-13' } })).toThrow();
    const extended = { ...closed, coverageThrough: '2026-11-13' };
    extended.sourceGeneration = sourceBindingGeneration(extended);
    expect(extended.sourceGeneration).not.toBe(closed.sourceGeneration);
    expect(() => validateSourceBinding(extended, jobFor(closed))).toThrow();
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it('stops an out-of-window GA4 job before credentials or provider work', async () => {
    const f = collectionFixture(); await f.initialize();
    const { environment: _environment, secretVersion: _key, ...common } = f.binding as typeof f.binding & { environment: string; secretVersion: string };
    const content = { ...common, reportId: 'hushhai.acquisition', kind: 'ga4', propertyId: '123456', timezone: 'UTC',
      coverageThrough: '2026-11-10', readerServiceAccount: 'analytics-reader@demo-metrics.iam.gserviceaccount.com', ...website };
    const binding = { ...content, sourceGeneration: sourceBindingGeneration(content) };
    await f.put('controls', content.reportId, { ...f.control, sourceGeneration: binding.sourceGeneration });
    await f.put('sources', content.reportId, binding);
    const id = (await f.reports.request({ ...f.request, reportId: content.reportId }, f.access)).jobId!;
    const factory = vi.fn();
    expect(await new MetricsCollection(f.store, factory, f.clock).collect(id, digest('outside-window')))
      .toMatchObject({ state: 'delayed', needsAttention: true, retryAfterMs: 0 });
    expect(factory).not.toHaveBeenCalled();
    expect(await f.get('sourceReceipts', id)).toBeNull();
  });
  it('counts only the approved website stream and hosts in a mixed app/web property', async () => {
    const f = await gaFixture({ ...header, rowCount: 0 });
    await f.source.submit(f.job); await f.source.recover(f.job);
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.fetch.mock.calls[0][1].body).toMatchObject({
      dimensionFilter: { andGroup: { expressions: [
        { filter: { fieldName: 'streamId', stringFilter: { matchType: 'EXACT', value: website.streamId, caseSensitive: true } } },
        { filter: { fieldName: 'platform', stringFilter: { matchType: 'EXACT', value: 'web', caseSensitive: true } } },
        { filter: { fieldName: 'hostName', inListFilter: { values: website.hostnames, caseSensitive: false } } },
      ] } },
    });
    expect(f.fetch.mock.calls[0][1].body).not.toHaveProperty('dimensions');
  });
  it('rejects property-wide and off-site scopes before a source call', () => {
    const f = collectionFixture(), fetch = vi.fn<AggregateFetch>();
    const config = { ...website, propertyId: '123456', timezone: 'UTC', informationWatermark: null };
    for (const bad of [
      { ...config, streamId: undefined }, { ...config, streamId: 'G-MEASUREMENT' },
      { ...config, hostnames: undefined }, { ...config, hostnames: [] },
      { ...config, hostnames: ['uat.hushh.ai'] }, { ...config, hostnames: ['hushh.ai.evil.invalid'] },
      { ...config, hostnames: ['https://hushh.ai/'] }, { ...config, hostnames: ['hushh.ai', 'hushh.ai'] },
      { ...config, hostnames: ['www.hushh.ai', 'hushh.ai'] },
      { ...config, hostnames: ['www.hussh.si.evil.invalid'] }, { ...config, hostnames: ['*.hussh.si'] },
      { ...config, hostnames: ['www.hussh.si', 'www.hussh.si'] },
    ]) expect(() => new Ga4AcquisitionSource(f.store,
      { sourceGeneration: f.control.sourceGeneration, timeoutMs: 1000, maxResponseBytes: 20_000 },
      bad as typeof config, fetch, f.clock)).toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses one whole-period provider total across the original and redirected website domains', async () => {
    const f = await gaFixture({ ...header, rowCount: 0 });
    const hostnames = ['hushh.ai', 'hussh.si', 'www.hushh.ai', 'www.hussh.si'];
    const fetch = vi.fn<AggregateFetch>(async () => Response.json({ ...header, rowCount: 1,
      rows: [{ metricValues: ['7', '4', '5', '1'].map(value => ({ value })) }] }));
    const source = new Ga4AcquisitionSource(f.store, { sourceGeneration: f.control.sourceGeneration, timeoutMs: 1000, maxResponseBytes: 20_000 },
      { ...website, hostnames, propertyId: '123456', timezone: 'UTC', informationWatermark: null }, fetch, f.clock);
    const result = (await source.submit(f.job))!; await source.recover(f.job);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.metrics.activeUsers.value).toBe(4); expect(result.metrics.sessions.value).toBe(7);
    expect(fetch.mock.calls[0][1].body).toMatchObject({
      dateRanges: [{ startDate: f.request.startDate, endDate: f.request.endDate }],
      dimensionFilter: { andGroup: { expressions: [
        { filter: { fieldName: 'streamId', stringFilter: { value: website.streamId } } },
        { filter: { fieldName: 'platform', stringFilter: { value: 'web' } } },
        { filter: { fieldName: 'hostName', inListFilter: { values: hostnames } } },
      ] } },
    });
    expect(fetch.mock.calls[0][1].body).not.toHaveProperty('dimensions');
  });
  it('binds a reviewed combined-domain scope to a new source generation without relabelling old reports', async () => {
    const f = await gaFixture({ ...header, rowCount: 0 });
    const { environment: _environment, secretVersion: _key, ...common } = f.binding as typeof f.binding & { environment: string; secretVersion: string };
    const old = { ...common, reportId: 'hushhai.acquisition', kind: 'ga4', propertyId: '123456', timezone: 'UTC', coverageThrough: f.request.endDate,
      readerServiceAccount: 'analytics-reader@demo-metrics.iam.gserviceaccount.com', ...website };
    old.sourceGeneration = sourceBindingGeneration(old);
    const combined = { ...old, hostnames: ['hushh.ai', 'hussh.si', 'www.hushh.ai', 'www.hussh.si'] };
    combined.sourceGeneration = sourceBindingGeneration(combined);
    const oldJob = { ...f.job, control: { ...f.job.control, sourceGeneration: old.sourceGeneration } };
    expect(validateSourceBinding(old, oldJob)).toEqual(old);
    expect(combined.sourceGeneration).not.toBe(old.sourceGeneration);
    expect(() => validateSourceBinding(combined, oldJob)).toThrow();
    expect(validateSourceBinding(combined, { ...oldJob, control: { ...oldJob.control, sourceGeneration: combined.sourceGeneration } })).toEqual(combined);
  });
  it('requires reviewed website scope in the binding and invalidates changed scope', async () => {
    const f = await gaFixture({ ...header, rowCount: 0 });
    const { environment: _environment, secretVersion: _key, kind: _kind, ...common } = f.binding as
      typeof f.binding & { environment: string; secretVersion: string };
    const content = { ...common, reportId: 'hushhai.acquisition', kind: 'ga4', propertyId: '123456', timezone: 'UTC', coverageThrough: f.request.endDate,
      readerServiceAccount: 'analytics-reader@demo-metrics.iam.gserviceaccount.com', ...website };
    const binding = { ...content, sourceGeneration: sourceBindingGeneration(content) };
    const job = { ...f.job, control: { ...f.job.control, sourceGeneration: binding.sourceGeneration } };
    expect(validateSourceBinding(binding, job)).toEqual(binding);
    for (const bad of [{ ...binding, streamId: '987654322' }, { ...binding, hostnames: ['www.hushh.ai'] },
      { ...binding, readerServiceAccount: 'another-reader@demo-metrics.iam.gserviceaccount.com' }]) {
      expect(sourceBindingGeneration(bad)).not.toBe(binding.sourceGeneration);
      expect(() => validateSourceBinding(bad, job)).toThrow();
    }
    const { streamId: _stream, hostnames: _hosts, ...unscoped } = binding;
    const legacy = { ...unscoped, sourceGeneration: sourceBindingGeneration(unscoped) };
    expect(() => validateSourceBinding(legacy, { ...job, control: { ...job.control, sourceGeneration: legacy.sourceGeneration } })).toThrow();
    for (const readerServiceAccount of [undefined, 'staff@example.invalid', 'https://credentials.example.invalid/',
      'analytics-reader@demo-metrics.iam.gserviceaccount.com\n']) {
      const bad = { ...binding, readerServiceAccount }; bad.sourceGeneration = sourceBindingGeneration(bad);
      expect(() => validateSourceBinding(bad, { ...job, control: { ...job.control, sourceGeneration: bad.sourceGeneration } })).toThrow();
    }
  });
  it('preserves actual counts without inventing a completeness watermark and reuses publication', async () => {
    const f = await gaFixture({ ...header, rowCount: 1, rows: [{ metricValues: ['5', '3', '4', '1'].map(value => ({ value })) }] });
    const result = (await f.source.submit(f.job))!; await f.worker.publish(f.job, result);
    expect(result.metrics.sessions).toEqual({ value: 5, coverage: 'partial', basis: 'provider_defined', unit: 'session' });
    expect(result.sourceWatermark).toBeNull(); expect((await f.reports.read(f.request, f.access)).state).toBe('unknown_freshness');
    expect((await f.reports.request(f.request, f.access)).jobId).toBeNull();
    f.advance(f.control.staleMs + 1); expect((await f.reports.read(f.request, f.access)).report).toBeNull();
  });
  it.each([
    // Without the runReport kind this is not the native ProtoJSON empty report.
    { metadata: { timeZone: 'Etc/GMT', currencyCode: 'USD' }, propertyQuota: { tokensPerDay: { consumed: 1 } } },
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
  it('decodes a native ProtoJSON empty report without claiming complete traffic capture', async () => {
    const f = await gaFixture({ kind: 'analyticsData#runReport', metadata: { timeZone: 'Etc/GMT', currencyCode: 'USD' },
      propertyQuota: { tokensPerDay: { consumed: 1 } } });
    const result = (await f.source.submit(f.job))!;
    await f.worker.publish(f.job, result); await f.source.recover(f.job);
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(Object.values(result.metrics).map(metric => metric.value)).toEqual([0, 0, 0, 0]);
    expect(Object.values(result.metrics).every(metric => metric.coverage === 'partial')).toBe(true);
    expect(result.sourceWatermark).toBeNull();
    expect((await f.reports.read(f.request, f.access)).state).toBe('unknown_freshness');
  });
  it.each([
    { ...header, rowCount: 0, metadata: { timeZone: 'UTC', subjectToThresholding: true } },
    { ...header, rowCount: 0, metadata: { timeZone: 'UTC', dataLossFromOtherRow: true } },
    { ...header, rowCount: 0, metadata: { timeZone: 'UTC', samplingMetadatas: [{ samplesReadCount: '1', samplingSpaceSize: '10' }] } },
    { ...header, rowCount: 0, metadata: { timeZone: 'UTC', emptyReason: 'No permission for this source' } },
    { kind: 'analyticsData#runReport', metadata: { timeZone: 'UTC' }, propertyQuota: {} },
    { kind: 'analyticsData#runReport', metadata: { timeZone: 'UTC' }, propertyQuota: { tokensPerDay: { consumed: 1 } }, rowCount: 1 },
    { kind: 'analyticsData#runReport', metadata: { timeZone: 'UTC' }, propertyQuota: { tokensPerDay: { consumed: 1 } }, rows: null },
  ])('keeps suppressed, incomplete or malformed empty results unavailable', async data => {
    const f = await gaFixture(data); await expect(f.source.submit(f.job)).rejects.toMatchObject({ kind: 'configuration' });
    expect((await f.reports.read(f.request, f.access)).report).toBeNull();
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
