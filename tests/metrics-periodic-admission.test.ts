import { describe, expect, it, vi } from 'vitest';
import { dispatchPeriodic } from '../src/server/reports/worker-runtime';
import { digest, type ReportJob } from '../src/server/reports/contracts';
import { periodicPlan, type PeriodicPolicy } from '../src/server/reports/periodic-policy';
import { MetricsReportDispatch } from '../src/server/reports/dispatch';
import { MetricsCollection } from '../src/server/reports/lifecycle';
import { OneAdoptionSource } from '../src/server/reports/sources';
import { MetricsReportMaintenance } from '../src/server/reports/maintenance';
import { MetricsReports } from '../src/server/reports/service';
import { collectionFixture } from './helpers/metrics-collection-fixture';

const schedule = (): PeriodicPolicy => ({ approved: true, enabled: true, revision: 1, slots: [0, 600], windowMs: 60_000,
  maxDailyJobs: 2, entries: [{ id: 'one', reportId: 'one.adoption', timezone: 'UTC', periodDays: 2, endLagDays: 1 }] });
const access = { subjectHash: digest('periodic-dispatcher'), scopeDigest: digest('collection-scope') };

describe('fixed periodic collector admission', () => {
  it('is disabled without explicit approved policy and accepts no caller-selected report', async () => {
    const f = collectionFixture(); await f.initialize();
    await expect(f.reports.requestPeriodic('one', access)).rejects.toThrow();
    await f.put('policy', 'periodic', { ...schedule(), approved: false });
    await expect(f.reports.requestPeriodic('one', access)).rejects.toThrow();
    await f.put('policy', 'periodic', schedule());
    await expect(f.reports.requestPeriodic('not-in-manifest', access)).rejects.toThrow();
    expect([...f.store.data.keys()].filter(key => key.includes('/jobs/'))).toHaveLength(0);
  });
  it('coalesces concurrent duplicate triggers across instances without another job or provider call', async () => {
    const f = collectionFixture(); await f.initialize(); await f.put('policy', 'periodic', schedule());
    const other = new MetricsReports(f.store, f.clock);
    const [a, b] = await Promise.all([f.reports.requestPeriodic('one', access), other.requestPeriodic('one', access)]);
    expect(a.jobId).toMatch(/^[a-f0-9]{64}$/); expect(b.jobId).toBe(a.jobId);
    expect(await f.get('periodicDays', '2026-11-13')).toEqual({ used: 1, limit: 2, slotLimit: 2, slots: ['2026-11-13:0'] });
    expect([...f.store.data.keys()].filter(key => key.includes('/jobs/'))).toHaveLength(1);
    expect([...f.store.data.keys()].filter(key => key.includes('/sourceReceipts/'))).toHaveLength(0);
  });
  it('replays current completed and invalidated states without creating another job', async () => {
    const f = collectionFixture(); await f.initialize(); await f.put('policy', 'periodic', schedule());
    const first = await f.reports.requestPeriodic('one', access), claim = await f.worker.claim(first.jobId!, digest('worker'));
    expect(claim).not.toBeNull(); await f.worker.publish(claim!.job, f.result(claim!.job));
    expect(await f.reports.requestPeriodic('one', access)).toEqual({ state: 'completed', reportId: first.jobId, jobId: first.jobId });
    const stored = (await f.get<ReportJob>('jobs', first.jobId!))!; await f.put('jobs', first.jobId!, { ...stored, status: 'invalidated' });
    expect(await f.reports.requestPeriodic('one', access)).toEqual({ state: 'invalidated', reportId: null, jobId: first.jobId });
    expect([...f.store.data.keys()].filter(key => key.includes('/jobs/'))).toHaveLength(1);
  });
  it('replays the receipt publication even if the report head later changes', async () => {
    const f = collectionFixture(); await f.initialize(); const manual = await f.reports.request(f.request, f.access);
    const claim = await f.worker.claim(manual.jobId!, digest('worker')); await f.worker.publish(claim!.job, f.result(claim!.job));
    await f.put('policy', 'periodic', schedule()); const first = await f.reports.requestPeriodic('one', access);
    expect(first).toEqual({ state: 'completed', reportId: manual.jobId, jobId: null });
    const head = (await f.get<any>('heads', claim!.job.key))!; await f.put('heads', claim!.job.key, { ...head, publication: null });
    expect(await f.reports.requestPeriodic('one', access)).toEqual(first);
  });
  it('does not reuse a malformed publication as a completed periodic report', async () => {
    const f = collectionFixture(); await f.initialize(); const manual = await f.reports.request(f.request, f.access);
    const claim = await f.worker.claim(manual.jobId!, digest('worker')); await f.worker.publish(claim!.job, f.result(claim!.job));
    const snapshot = (await f.get<any>('snapshots', manual.jobId!))!; snapshot.result.scopeDigest = digest('wrong-scope');
    await f.put('snapshots', manual.jobId!, snapshot); await f.put('policy', 'periodic', schedule());
    await expect(f.reports.requestPeriodic('one', access)).rejects.toThrow();
    expect([...f.store.data.keys()].filter(key => key.includes('/periodicReceipts/'))).toHaveLength(0);
  });
  it('does not redispatch a terminal receipt', async () => {
    const deliver = vi.fn(async () => ({})), id = digest('periodic-job');
    for (const state of ['completed', 'failed', 'invalidated'] as const) await dispatchPeriodic({ state, jobId: id, reportId: state === 'completed' ? id : null }, deliver);
    expect(deliver).not.toHaveBeenCalled(); await dispatchPeriodic({ state: 'accepted', jobId: id, reportId: null }, deliver); expect(deliver).toHaveBeenCalledOnce();
  });
  it('keeps an unresolved cycle fenced even when its policy is disabled', async () => {
    const f = collectionFixture(); await f.initialize(); await f.put('policy', 'periodic', schedule());
    await f.reports.requestPeriodic('one', access); await f.put('policy', 'periodic', { ...schedule(), enabled: false });
    await expect(f.reports.requestScheduled(f.request, access)).rejects.toMatchObject({ code: 'capacity' });
    expect([...f.store.data.keys()].filter(key => key.includes('/jobs/'))).toHaveLength(1);
  });
  it('does not open a later window while an earlier job is unresolved, even across UTC midnight', async () => {
    const f = collectionFixture(); await f.initialize(); await f.put('policy', 'periodic', schedule());
    const first = await f.reports.requestPeriodic('one', access); f.advance(600 * 60_000);
    await expect(f.reports.requestPeriodic('one', access)).rejects.toMatchObject({ code: 'capacity' });
    f.advance(840 * 60_000);
    await expect(f.reports.requestPeriodic('one', access)).rejects.toMatchObject({ code: 'capacity' });
    expect((await f.get<ReportJob>('jobs', first.jobId!))?.status).toBe('accepted');
    expect(await f.get('periodicDays', '2026-11-14')).toBeNull();
  });
  it('retains a tightened daily job limit even after a denial and a later policy increase', async () => {
    const f = collectionFixture(); await f.initialize(); await f.put('policy', 'periodic', schedule());
    const first = await f.reports.requestPeriodic('one', access), job = (await f.get<ReportJob>('jobs', first.jobId!))!;
    await f.put('jobs', first.jobId!, { ...job, status: 'completed' }); await f.put('capacity', 'scheduled', { active: 0 });
    f.advance(600 * 60_000); await f.put('policy', 'periodic', { ...schedule(), revision: 2, maxDailyJobs: 1 });
    await expect(f.reports.requestPeriodic('one', access)).rejects.toMatchObject({ code: 'capacity' });
    expect(await f.get('periodicDays', '2026-11-13')).toMatchObject({ used: 1, limit: 1 });
    await f.put('policy', 'periodic', { ...schedule(), revision: 3 });
    await expect(f.reports.requestPeriodic('one', access)).rejects.toMatchObject({ code: 'capacity' });
    expect([...f.store.data.keys()].filter(key => key.includes('/jobs/'))).toHaveLength(1);
  });
  it('does not add an extra daily slot after a policy is broadened', async () => {
    const f = collectionFixture(); await f.initialize(); await f.put('policy', 'periodic', schedule());
    const settle = async (id: string) => { const job = (await f.get<ReportJob>('jobs', id))!; await f.put('jobs', id, { ...job, status: 'completed' }); await f.put('capacity', 'scheduled', { active: 0 }); };
    const first = await f.reports.requestPeriodic('one', access); await settle(first.jobId!); f.advance(600 * 60_000);
    const second = await f.reports.requestPeriodic('one', access); await settle(second.jobId!); f.advance(600 * 60_000);
    await f.put('policy', 'periodic', { ...schedule(), revision: 2, slots: [0, 600, 1200], maxDailyJobs: 3 });
    await expect(f.reports.requestPeriodic('one', access)).rejects.toMatchObject({ code: 'capacity' });
    expect(await f.get('periodicDays', '2026-11-13')).toMatchObject({ used: 2, limit: 2, slotLimit: 2 });
  });
  it('retains a tighter limit observed on a same-window conflicting replay', async () => {
    const f = collectionFixture(); await f.initialize(); await f.put('policy', 'periodic', schedule());
    await f.reports.requestPeriodic('one', access); await f.put('policy', 'periodic', { ...schedule(), revision: 2, maxDailyJobs: 1 });
    await expect(f.reports.requestPeriodic('one', access)).rejects.toMatchObject({ code: 'unavailable' });
    expect(await f.get('periodicDays', '2026-11-13')).toMatchObject({ used: 1, limit: 1 });
  });
  it('retains a tighter daily bound even when the dispatcher quota is exhausted', async () => {
    const f = collectionFixture(); await f.initialize(); await f.put('policy', 'current', { ...f.policy, computeRequests: 1 });
    await f.put('policy', 'periodic', schedule()); await f.reports.requestPeriodic('one', access);
    await f.put('policy', 'periodic', { ...schedule(), revision: 2, maxDailyJobs: 1 });
    await expect(f.reports.requestPeriodic('one', access)).rejects.toMatchObject({ code: 'quota' });
    expect(await f.get('periodicDays', '2026-11-13')).toMatchObject({ used: 1, limit: 1 });
  });
  it('protects the current cycle from maintenance until another cycle takes ownership', async () => {
    const f = collectionFixture(); await f.initialize(); await f.put('policy', 'periodic', schedule());
    await f.put('policy', 'maintenance', { approved: true, enabled: true, batchSize: 100, leaseMs: 2000, retentionMs: 1000 });
    const first = await f.reports.requestPeriodic('one', access), claim = await f.worker.claim(first.jobId!, digest('worker-one'));
    await f.worker.publish(claim!.job, f.result(claim!.job)); f.advance(10_001);
    const newer = await f.reports.request(f.request, f.access), next = await f.worker.claim(newer.jobId!, digest('worker-two'));
    await f.worker.publish(next!.job, f.result(next!.job)); f.advance(1001);
    const maintenance = new MetricsReportMaintenance(f.store, async () => {}, f.clock);
    await maintenance.run(digest('maintenance-one')); expect(await f.worker.inspect(first.jobId!)).not.toBeNull();
    f.advance(600 * 60_000 - 11_002); await f.reports.requestPeriodic('one', access);
    await maintenance.run(digest('maintenance-two')); expect(await f.worker.inspect(first.jobId!)).toBeNull();
  });
  it('uses the existing durable dispatch and journal once across duplicate triggers and reads', async () => {
    const f = collectionFixture(); await f.initialize(); await f.put('policy', 'periodic', schedule());
    await f.put('policy', 'dispatch', { approved: true, enabled: true, leaseMs: 1000, lookupDelayMs: 1000, maxLookups: 2 });
    let creates = 0, sourceCalls = 0;
    const dispatch = new MetricsReportDispatch(f.store, { taskName: id => `fixture/tasks/${id}`,
      create: async () => { creates++; return 'accepted'; }, lookup: async () => 'present' }, f.clock);
    const collector = new MetricsCollection(f.store, async job => new OneAdoptionSource(f.store,
      { sourceGeneration: f.binding.sourceGeneration, timeoutMs: 1000, maxResponseBytes: 20_000 }, 'uat',
      async () => { sourceCalls++; return Response.json(f.result(job)); }, f.clock), f.clock);
    const invoke = async () => dispatchPeriodic(await f.reports.requestPeriodic('one', access), id => dispatch.deliver(id, digest('dispatcher')));
    const first = await invoke(), duplicate = await invoke(); expect(first.jobId).toBe(duplicate.jobId); expect(creates).toBe(1);
    expect((await collector.collect(first.jobId!, digest('worker'))).state).toBe('completed'); expect(sourceCalls).toBe(1);
    expect((await invoke()).state).toBe('completed'); expect(creates).toBe(1);
    expect((await f.reports.read(f.request, f.access)).state).toBe('completed'); expect(sourceCalls).toBe(1);
  });
  it('shares the existing source-read budget with custom work without claiming a monetary cap', async () => {
    const f = collectionFixture(); await f.initialize(); await f.put('policy', 'periodic', schedule());
    await f.put('policy', 'one-read-budget', { approved: true, dailyQueries: 1 });
    let sourceCalls = 0;
    const collector = new MetricsCollection(f.store, async job => new OneAdoptionSource(f.store,
      { sourceGeneration: f.binding.sourceGeneration, timeoutMs: 1000, maxResponseBytes: 20_000 }, 'uat',
      async () => { sourceCalls++; return Response.json(f.result(job)); }, f.clock), f.clock);
    const custom = await f.reports.request({ ...f.request, startDate: '2026-11-10' }, f.access);
    expect((await collector.collect(custom.jobId!, digest('custom-worker'))).state).toBe('completed'); expect(sourceCalls).toBe(1);
    const periodic = await f.reports.requestPeriodic('one', access);
    expect((await collector.collect(periodic.jobId!, digest('periodic-worker'))).state).toBe('delayed'); expect(sourceCalls).toBe(1);
    expect(await f.get('sourceReadBudgets', 'one-adoption-uat-2026-11-13')).toEqual({ used: 1, limit: 1 });
    await f.reports.read(f.request, f.access); expect(sourceCalls).toBe(1);
  });
  it('does not allow manual scheduled requests to race an enabled periodic policy', async () => {
    const f = collectionFixture(); await f.initialize(); await f.put('policy', 'periodic', schedule());
    await expect(f.reports.requestScheduled(f.request, access)).rejects.toMatchObject({ code: 'unavailable' });
    expect([...f.store.data.keys()].filter(key => key.includes('/jobs/'))).toHaveLength(0);
  });
  it('uses the source calendar and accepts only the configured trigger window', () => {
    const policy = schedule(); policy.entries[0].timezone = 'America/Los_Angeles';
    const midnightUtc = Date.parse('2026-11-13T00:00:00Z');
    expect(periodicPlan(policy, 'one', midnightUtc).request).toEqual({ reportId: 'one.adoption', timezone: 'America/Los_Angeles', startDate: '2026-11-10', endDate: '2026-11-11' });
    expect(() => periodicPlan(policy, 'one', midnightUtc + 60_000)).toThrow();
    expect(() => periodicPlan({ ...policy, slots: [0, 0] }, 'one', midnightUtc)).toThrow();
  });
});
