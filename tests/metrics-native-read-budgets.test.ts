import { describe, expect, it, vi } from 'vitest';
import { digest, type ReportJob } from '../src/server/reports/contracts';
import { Ga4AcquisitionSource, OneAdoptionSource, type AggregateFetch } from '../src/server/reports/sources';
import { collectionFixture } from './helpers/metrics-collection-fixture';

async function fixture(kind: 'one' | 'ga4') {
  const f = collectionFixture(); await f.initialize();
  const reportId = kind === 'one' ? 'one.adoption' : 'hushhai.acquisition';
  await f.put('controls', reportId, f.control);
  const payload = (job: ReportJob) => kind === 'one' ? f.result(job) : {
    metadata: { timeZone: 'UTC' }, rowCount: 0,
    metricHeaders: ['sessions', 'activeUsers', 'engagedSessions', 'keyEvents'].map(name => ({ name })),
  };
  const fetcher = vi.fn<AggregateFetch>();
  const source = (scope = { streamId: '987654321', hostnames: ['www.hushh.ai'] }) => kind === 'one' ? new OneAdoptionSource(f.store, {
    sourceGeneration: f.control.sourceGeneration, timeoutMs: 1000, maxResponseBytes: 20_000 }, 'uat', fetcher, f.clock)
    : new Ga4AcquisitionSource(f.store, { sourceGeneration: f.control.sourceGeneration, timeoutMs: 1000, maxResponseBytes: 20_000 },
      { propertyId: '123456', timezone: 'UTC', ...scope, informationWatermark: null }, fetcher, f.clock);
  const claim = async (date = '2026-11-11', staff = 'budget-staff') => {
    const request = { ...f.request, reportId, startDate: date, endDate: date };
    const intent = await f.reports.request(request, { ...f.access, subjectHash: digest(staff) });
    return (await f.worker.claim(intent.jobId!, digest(staff + '-worker')))!.job;
  };
  const ledger = `${kind === 'one' ? 'one-adoption-uat' : 'ga4-123456'}-2026-11-13`;
  return { ...f, reportId, payload, fetcher, source, claim, ledger, policyId: `${kind}-read-budget` };
}

describe.each(['one', 'ga4'] as const)('%s source-wide daily native-read allowance', kind => {
  it('refuses absent or malformed approval before provider I/O', async () => {
    const f = await fixture(kind), job = await f.claim();
    f.fetcher.mockImplementation(async () => Response.json(f.payload(job)));
    for (const policy of [null, { approved: false, dailyQueries: 1 }, { approved: true, dailyQueries: 0 },
      { approved: true, dailyQueries: 1001 }, { approved: true, dailyQueries: 1, extra: true }]) {
      await f.put('policy', f.policyId, policy);
      await expect(f.source().submit(job)).rejects.toMatchObject({ kind: 'configuration' });
    }
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(await f.get('sourceReceipts', job.id)).toBeNull();
  });
  it('shares one atomic daily allowance across concurrent distinct jobs and staff', async () => {
    const f = await fixture(kind);
    await f.put('policy', f.policyId, { approved: true, dailyQueries: 1 });
    const jobs = await Promise.all([f.claim('2026-11-10', 'staff-a'), f.claim('2026-11-11', 'staff-b')]);
    f.fetcher.mockImplementation(async (_url, request) => {
      const body = request.body as any;
      const date = body.period?.startDate ?? body.dateRanges?.[0]?.startDate;
      return Response.json(f.payload(jobs.find(job => job.request.startDate === date)!));
    });
    const outcomes = await Promise.allSettled(jobs.map(job => f.source().submit(job)));
    expect(outcomes.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find(row => row.status === 'rejected')).toMatchObject({ reason: { kind: 'quota' } });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(await f.get('sourceReadBudgets', f.ledger)).toEqual({ used: 1, limit: 1 });
    const known = jobs[outcomes.findIndex(row => row.status === 'fulfilled')];
    expect(await f.source().recover(known)).not.toBeNull();
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });
  it('retains uncertain usage and cannot regain allowance through a new generation or scope', async () => {
    const f = await fixture(kind), job = await f.claim();
    await f.put('policy', f.policyId, { approved: true, dailyQueries: 1 });
    f.fetcher.mockRejectedValue(new Error('Synthetic uncertain response'));
    const original = f.source();
    await expect(original.submit(job)).rejects.toThrow('Synthetic uncertain response');
    expect(await original.recover(job)).toBeNull();
    f.control.sourceGeneration = digest('new-source-generation'); f.control.revision++;
    await f.put('controls', f.reportId, f.control);
    const next = await f.claim('2026-11-12', 'another-staff');
    await expect(f.source({ streamId: '111222333', hostnames: ['www.hussh.si'] }).submit(next)).rejects.toMatchObject({ kind: 'quota' });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(await f.get('sourceReadBudgets', f.ledger)).toEqual({ used: 1, limit: 1 });
    expect(await f.get('sourceReceipts', next.id)).toBeNull();
  });
  it('persists a lower cap after denial and retains prior-day charges across UTC rollover', async () => {
    const f = await fixture(kind), job = await f.claim();
    await f.put('sourceReadBudgets', f.ledger, { used: 2, limit: 10 });
    await f.put('policy', f.policyId, { approved: true, dailyQueries: 1 });
    await expect(f.source().submit(job)).rejects.toMatchObject({ kind: 'quota' });
    await f.put('policy', f.policyId, { approved: true, dailyQueries: 10 });
    await expect(f.source().submit(job)).rejects.toMatchObject({ kind: 'quota' });
    expect(await f.get('sourceReadBudgets', f.ledger)).toEqual({ used: 2, limit: 1 });
    expect(f.fetcher).not.toHaveBeenCalled();
    f.advance(86_400_000);
    const next = await f.claim('2026-11-12');
    f.fetcher.mockImplementation(async () => Response.json(f.payload(next)));
    await f.source().submit(next);
    expect(await f.get('sourceReadBudgets', f.ledger.replace('-2026-11-13', '-2026-11-14'))).toEqual({ used: 1, limit: 10 });
    expect(await f.get('sourceReadBudgets', f.ledger)).toEqual({ used: 2, limit: 1 });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });
});
