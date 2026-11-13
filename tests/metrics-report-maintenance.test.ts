import { describe, expect, it, vi } from 'vitest';
import { digest } from '../src/server/reports/contracts';
import { MetricsReportMaintenance } from '../src/server/reports/maintenance';
import { reportPath } from '../src/server/reports/store';
import { collectionFixture } from './helpers/metrics-collection-fixture';

describe('scheduled and custom report capacity', () => {
  it('reserves separate scheduler capacity and prevents one staff account monopolizing custom work', async () => {
    const f = collectionFixture(); await f.initialize();
    await f.put('policy', 'current', { ...f.policy, customCapacity: 2, customPerSubjectCapacity: 1, scheduledCapacity: 1 });
    const first = await f.reports.request(f.request, f.access);
    await expect(f.reports.request({ ...f.request, startDate: '2026-11-10' }, f.access)).rejects.toMatchObject({ code: 'capacity' });
    const other = { ...f.access, subjectHash: digest('other-staff') };
    const second = await f.reports.request({ ...f.request, startDate: '2026-11-10' }, other);
    const scheduled = await f.reports.requestScheduled({ ...f.request, startDate: '2026-11-09' }, { ...f.access, subjectHash: digest('scheduler') });
    expect(scheduled.state).toBe('accepted');
    expect((await f.reports.requestScheduled(f.request, other)).jobId).toBe(first.jobId); // coalesce across lanes
    for (const id of [first.jobId, second.jobId, scheduled.jobId]) {
      const job = (await f.worker.claim(id!, digest('worker')))!.job; await f.worker.publish(job, f.result(job));
    }
    expect(await f.get('capacity', 'custom')).toEqual({ active: 0 }); expect(await f.get('capacity', 'scheduled')).toEqual({ active: 0 });
    expect((await f.reports.request({ ...f.request, startDate: '2026-11-08' }, f.access)).state).toBe('accepted');
  });
  it('keeps the scheduled lane closed at zero while custom collection can be approved separately', async () => {
    const f = collectionFixture(); await f.initialize(); await f.put('policy', 'current', { ...f.policy, scheduledCapacity: 0 });
    await expect(f.reports.requestScheduled(f.request, f.access)).rejects.toMatchObject({ code: 'capacity' });
    expect((await f.reports.request(f.request, f.access)).state).toBe('accepted');
  });
});

describe('bounded reference-aware report maintenance', () => {
  const maintenancePolicy = { approved: true, enabled: true, batchSize: 2, leaseMs: 2000, retentionMs: 1000 };
  it('is default closed without scanning or recovering any job', async () => {
    const f = collectionFixture(); const scan = vi.spyOn(f.store, 'scan'), recover = vi.fn();
    await expect(new MetricsReportMaintenance(f.store, recover, f.clock).run(digest('owner'))).rejects.toMatchObject({ code: 'unavailable' });
    expect(scan).not.toHaveBeenCalled(); expect(recover).not.toHaveBeenCalled();
  });
  it('reconciles a lost enqueue intent in bounded pages without a startup timer', async () => {
    const f = collectionFixture(); await f.initialize(); await f.put('policy', 'maintenance', maintenancePolicy);
    for (const day of ['11', '10', '09']) await f.reports.request({ ...f.request, startDate: `2026-11-${day}` }, f.access);
    const seen: string[] = [];
    const m = new MetricsReportMaintenance(f.store, async job => { seen.push(job.id); }, f.clock);
    const first = await m.run(digest('one')); expect(first.recovered).toBe(2);
    const second = await m.run(digest('two')); expect(second.recovered).toBe(1);
    expect(new Set(seen).size).toBe(3); expect(await f.get('capacity', 'custom')).toEqual({ active: 3 });
  });
  it('protects active publications, unresolved reservations and permanent head sequences', async () => {
    const f = collectionFixture(); await f.initialize(); await f.put('policy', 'maintenance', { ...maintenancePolicy, batchSize: 100 });
    const first = (await f.worker.claim((await f.reports.request(f.request, f.access)).jobId!, digest('first')))!.job;
    await f.worker.publish(first, f.result(first));
    const reserved = (await f.worker.claim((await f.reports.request({ ...f.request, startDate: '2026-11-10' }, f.access)).jobId!, digest('uncertain')))!.job;
    await f.put('sourceReceipts', reserved.id, { state: 'reserved' }); await f.worker.uncertain(reserved);
    const recover = vi.fn(); const m = new MetricsReportMaintenance(f.store, recover, f.clock);
    f.advance(f.control.freshnessMs + 1);
    await m.run(digest('one'));
    expect(await f.worker.inspect(first.id)).not.toBeNull(); expect(await f.worker.inspect(reserved.id)).not.toBeNull();
    expect(await f.get('sourceReceipts', reserved.id)).toEqual({ state: 'reserved' });
    const second = (await f.worker.claim((await f.reports.request(f.request, f.access)).jobId!, digest('second')))!.job;
    await f.worker.publish(second, f.result(second)); f.advance(1001);
    const cleanup = await m.run(digest('two'));
    expect(cleanup.deleted).toBeGreaterThanOrEqual(4); expect(await f.worker.inspect(first.id)).toBeNull();
    expect(await f.get('snapshots', first.id)).toBeNull(); expect(await f.get('snapshots', second.id)).not.toBeNull();
    expect(await f.get('heads', first.key)).toMatchObject({ sequence: 2, publication: second.id });
    expect(await f.get('capacity', 'custom')).toEqual({ active: 1 });
  });
  it('serializes competing maintenance and does not delete after its lease or policy changes', async () => {
    const f = collectionFixture(); await f.initialize(); await f.put('policy', 'maintenance', maintenancePolicy);
    const id = (await f.reports.request(f.request, f.access)).jobId!;
    let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
    const m = new MetricsReportMaintenance(f.store, async () => pending, f.clock);
    const first = m.run(digest('one'));
    // Wait for recovery to enter using a deterministic store turn, not wall-clock sleeps.
    for (let i = 0; i < 20 && !(await f.get('maintenance', 'cursor')); i++) await Promise.resolve();
    expect((await new MetricsReportMaintenance(f.store, vi.fn(), f.clock).run(digest('two'))).state).toBe('busy');
    f.advance(maintenancePolicy.leaseMs + 1); release(); await first;
    expect(await f.worker.inspect(id)).not.toBeNull();
    await f.put('policy', 'maintenance', { ...maintenancePolicy, enabled: false });
    await expect(m.run(digest('later'))).rejects.toThrow();
  });
  it('deletes only expired quota buckets in reviewed bounded pages', async () => {
    const f = collectionFixture(); await f.initialize(); await f.put('policy', 'maintenance', maintenancePolicy);
    for (let i = 0; i < 3; i++) await f.put('quotas', digest(`old-${i}`), { count: 5, windowEndsAt: f.clock() - 2000 });
    const currentId = digest('current'); await f.put('quotas', currentId, { count: 5, windowEndsAt: f.clock() + 5000 });
    const scan = vi.spyOn(f.store, 'scan'); const m = new MetricsReportMaintenance(f.store, vi.fn(), f.clock);
    await m.run(digest('one')); await m.run(digest('two')); await m.run(digest('three'));
    expect(await f.get('quotas', currentId)).not.toBeNull();
    expect([...f.store.data.keys()].filter(k => k.startsWith(reportPath('quotas', '')))).toHaveLength(1);
    expect(scan.mock.calls.every(([, , limit]) => limit === maintenancePolicy.batchSize)).toBe(true);
  });
});
