import { describe, expect, it } from 'vitest';
import { digest, reportKey, type ReportJob } from '../src/server/reports/contracts';
import { collectionFixture } from './helpers/metrics-collection-fixture';

describe('new One adoption computation bounds', () => {
  it.each([[7, true], [8, false]] as const)('admits %s calendar days only when supported', async (days, allowed) => {
    const f = collectionFixture(); await f.initialize();
    const input = { ...f.request, startDate: days === 7 ? '2026-11-06' : '2026-11-05' };
    if (allowed) {
      expect(await f.reports.request(input, f.access)).toMatchObject({ state: 'accepted' });
      expect(await f.get('capacity', 'custom')).toEqual({ active: 1 });
    } else {
      await expect(f.reports.request(input, f.access)).rejects.toMatchObject({ code: 'invalid' });
      expect(await f.get('capacity', 'custom')).toBeNull();
      expect(await f.get('heads', reportKey(input, f.control))).toBeNull();
      expect(await f.get('sourceCircuits', f.control.sourceGeneration)).toBeNull();
      expect(await f.get('sourceReadBudgets', 'one-adoption-uat-2026-11-13')).toBeNull();
    }
  });

  it('still reads and reuses a valid historical publication beyond seven days', async () => {
    const f = collectionFixture(); await f.initialize();
    const input = { ...f.request, startDate: '2026-11-05' }, key = reportKey(input, f.control), id = digest('prior-publication');
    const result = f.result({ request: input, control: f.control } as ReportJob), now = f.clock();
    await f.put('snapshots', id, { id, key, request: input, control: f.control, result, computedAt: now, publishedAt: now });
    await f.put('heads', key, { sequence: 1, activeJob: null, publication: id });
    expect((await f.reports.read(input, f.access)).report?.id).toBe(id);
    expect(await f.reports.request(input, f.access)).toMatchObject({ state: 'completed', reportId: id, jobId: null });
    expect(await f.get('capacity', 'custom')).toBeNull();
  });

  it('coalesces already-admitted historical work without creating a replacement', async () => {
    const f = collectionFixture(); await f.initialize();
    const original = await f.reports.request(f.request, f.access), job = (await f.get<ReportJob>('jobs', original.jobId!))!;
    const input = { ...f.request, startDate: '2026-11-05' }, key = reportKey(input, f.control);
    await f.put('jobs', job.id, { ...job, request: input, key });
    await f.put('heads', key, { sequence: 1, activeJob: job.id, publication: null });
    expect(await f.reports.request(input, f.access)).toMatchObject({ state: 'accepted', jobId: job.id });
    expect(await f.get('capacity', 'custom')).toEqual({ active: 1 });
  });

  it('retains tightened periodic limits after an invalid range and later policy increase', async () => {
    const f = collectionFixture(); await f.initialize();
    const schedule = { approved: true, enabled: true, revision: 1, slots: [0, 600], windowMs: 60_000,
      maxDailyJobs: 2, entries: [{ id: 'one', reportId: 'one.adoption', timezone: 'UTC', periodDays: 2, endLagDays: 1 }] };
    const access = { subjectHash: digest('periodic-dispatcher'), scopeDigest: f.access.scopeDigest };
    await f.put('policy', 'periodic', schedule);
    const first = await f.reports.requestPeriodic('one', access), job = (await f.get<ReportJob>('jobs', first.jobId!))!;
    await f.put('jobs', first.jobId!, { ...job, status: 'completed' }); await f.put('capacity', 'scheduled', { active: 0 });
    f.advance(600 * 60_000);
    await f.put('policy', 'periodic', { ...schedule, revision: 2, maxDailyJobs: 1, entries: [{ ...schedule.entries[0], periodDays: 8 }] });
    await expect(f.reports.requestPeriodic('one', access)).rejects.toMatchObject({ code: 'invalid' });
    expect(await f.get('periodicDays', '2026-11-13')).toMatchObject({ used: 1, limit: 1 });
    expect(await f.get('sourceCircuits', f.control.sourceGeneration)).toBeNull();
    expect(await f.get('sourceReadBudgets', 'one-adoption-uat-2026-11-13')).toBeNull();
    await f.put('policy', 'periodic', { ...schedule, revision: 3 });
    await expect(f.reports.requestPeriodic('one', access)).rejects.toMatchObject({ code: 'capacity' });
    expect([...f.store.data.keys()].filter(key => key.includes('/jobs/'))).toHaveLength(1);
  });
});
