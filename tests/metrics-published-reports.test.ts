import { randomUUID } from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { digest, reportKey, validateRequest, type AggregateResult, type ReportAccess, type ReportControl,
  type ReportingPolicy, type ReportJob, type ReportRequest } from '../src/server/reports/contracts';
import { MetricsReports, MetricsReportWorker } from '../src/server/reports/service';
import { FirestoreReportStore, reportPath as path, type ReportStore } from '../src/server/reports/store';
import { collectReport } from '../src/server/reports/collector';
import { ReportBodyCache } from '../src/server/reports/body-cache';
import { Ga4AcquisitionSource, OneAdoptionSource } from '../src/server/reports/sources';
import { MemoryReportStore as MemoryStore } from './helpers/metrics-report-memory-store';

const access: ReportAccess = { subjectHash: digest('staff-fixture'), scopeDigest: digest('authorized-scope-fixture') };
const request: ReportRequest = { reportId: 'one.adoption', startDate: '2026-11-10', endDate: '2026-11-11', timezone: 'UTC' };
const control: ReportControl = { enabled: true, revision: 1, sourceGeneration: digest('source-fixture'),
  scopeDigest: access.scopeDigest, definitionVersion: '1', freshnessMs: 10_000, staleMs: 20_000 };
// Explicit test policy; these numbers are not activation defaults.
const policy: ReportingPolicy = { approved: true, computeEnabled: true, quotaWindowMs: 60_000,
  readRequests: 100, statusRequests: 20, computeRequests: 10, customCapacity: 2, customPerSubjectCapacity: 2, scheduledCapacity: 1,
  maxPeriodDays: 30, leaseMs: 1000, jobLifetimeMs: 60_000, maxSnapshotBytes: 20_000 };
function aggregate(job: ReportJob, now: number): AggregateResult {
  return { metrics: {
    activeAccounts: { value: 2, coverage: 'available', unit: 'account', basis: 'exact' },
    confirmedOutcomes: { value: 3, coverage: 'available', unit: 'outcome', basis: 'exact' },
  }, sourceCheckedAt: now, sourceWatermark: now, sourceGeneration: job.control.sourceGeneration,
  scopeDigest: job.control.scopeDigest, definitionVersion: '1', reconciled: true,
  period: { startDate: job.request.startDate, endDate: job.request.endDate, timezone: job.request.timezone } };
}
const emulator = process.env.METRICS_REPORTS_EMULATOR_TESTS === 'true';
if (emulator && !/^127\.0\.0\.1:\d{2,5}$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) {
  throw new Error('Metrics integration requires a localhost emulator.');
}
for (const mode of ['memory', ...(emulator ? ['firestore'] : [])]) {
  describe(`published Metrics ${mode}`, () => {
    let store: ReportStore, reader: MetricsReports, worker: MetricsReportWorker, now: number;
    const databases: Firestore[] = [];
    async function put(collection: string, id: string, value: unknown) {
      await store.transaction(async tx => { tx.set(path(collection, id), value); });
    }
    beforeEach(async () => {
      now = Date.parse('2026-11-12T00:00:00Z');
      if (mode === 'firestore') {
        const db = new Firestore({ projectId: 'demo-plg-storage', databaseId: `demo-report-${randomUUID().slice(0, 8)}` });
        databases.push(db); store = new FirestoreReportStore(db);
      } else store = new MemoryStore();
      reader = new MetricsReports(store, () => now); worker = new MetricsReportWorker(store, () => now);
      await put('policy', 'current', policy); await put('controls', request.reportId, control);
      await put('policy', 'one-read-budget', { approved: true, dailyQueries: 100 });
      await put('policy', 'ga4-read-budget', { approved: true, dailyQueries: 100 });
    });
    afterAll(async () => { await Promise.all(databases.map(db => db.terminate())); });
    async function claim() {
      const intent = await reader.request(request, access);
      return (await worker.claim(intent.jobId!, digest('worker-one')))!;
    }
    it('reads an absent publication without creating work', async () => {
      expect(await reader.read(request, access)).toEqual({ state: 'unavailable', report: null });
      const capacity = await store.transaction(tx => tx.get(path('capacity', 'custom')));
      expect(capacity).toBeNull();
    });
    it('coalesces competing instances, atomically publishes and reuses the immutable snapshot', async () => {
      const second = new MetricsReports(store, () => now);
      const intents = await Promise.all([reader.request(request, access), second.request(request, access)]);
      expect(intents[0].jobId).toBe(intents[1].jobId);
      const c = (await worker.claim(intents[0].jobId!, digest('worker-one')))!;
      expect(await worker.claim(c.job.id, digest('worker-two'))).toBeNull();
      const result = aggregate(c.job, now);
      await worker.publish(c.job, result);
      expect(await worker.publish(c.job, result)).toBe(c.job.id); // acknowledged retry
      for (let i = 0; i < 12; i++) expect((await second.read(request, access)).report?.id).toBe(c.job.id);
      expect((await reader.request(request, access)).state).toBe('completed');
      expect(await store.transaction(tx => tx.get(path('capacity', 'custom')))).toEqual({ active: 0 });
    });
    it('recovers the original provider identity after timeout and fences the old worker', async () => {
      const first = await claim(); now += policy.leaseMs + 1;
      const recovered = (await new MetricsReportWorker(store, () => now).claim(first.job.id, digest('worker-two')))!;
      expect(recovered.recoverOnly).toBe(true);
      expect(recovered.job.providerJobId).toBe(first.job.providerJobId);
      await expect(worker.publish(first.job, aggregate(first.job, now))).rejects.toMatchObject({ code: 'stale_worker' });
      await worker.publish(recovered.job, aggregate(recovered.job, now));
    });
    it('retains capacity and original provider identity for uncertain results', async () => {
      const first = await claim(); await worker.uncertain(first.job);
      expect(await store.transaction(tx => tx.get(path('capacity', 'custom')))).toEqual({ active: 1 });
      const next = (await worker.claim(first.job.id, digest('recovery')))!;
      expect(next.recoverOnly).toBe(true); expect(next.job.providerJobId).toBe(first.job.providerJobId);
    });
    it('keeps queue wait separate from worker elapsed time and stops terminal polling', async () => {
      const intent = await reader.request(request, access);
      now += 300;
      const c = (await worker.claim(intent.jobId!, digest('timed-worker')))!;
      now += 200;
      await worker.publish(c.job, aggregate(c.job, now));
      let progress = await reader.status(c.job.id, access);
      expect(progress.queueWaitMs).toBe(300); expect(progress.executionMs).toBe(200); expect(progress.retryAfterMs).toBe(0);
      now += 5000; progress = await reader.status(c.job.id, access);
      expect(progress.queueWaitMs).toBe(300); expect(progress.executionMs).toBe(200);
    });
    it('does not resubmit provider work after lost acknowledgement', async () => {
      const intent = await reader.request(request, access); let submits = 0, recoveries = 0;
      const source = {
        submit: async () => { submits++; throw new Error('Lost acknowledgement'); },
        recover: async (job: ReportJob) => { recoveries++; return aggregate(job, now); },
      };
      await expect(collectReport(worker, intent.jobId!, digest('first'), source)).rejects.toThrow('Lost acknowledgement');
      expect((await collectReport(worker, intent.jobId!, digest('second'), source)).state).toBe('completed');
      expect([submits, recoveries]).toEqual([1, 1]);
    });
    it('checks current authorization and pointer before body-cache reuse', async () => {
      const c = await claim(); await worker.publish(c.job, aggregate(c.job, now));
      const cache = new ReportBodyCache(2, 30_000);
      const cached = new MetricsReports(store, () => now, cache);
      expect((await cached.read(request, access)).report?.id).toBe(c.job.id);
      expect(cache.usage.entries).toBe(1);
      await put('controls', request.reportId, { ...control, enabled: false });
      await expect(cached.read(request, access)).rejects.toMatchObject({ code: 'unavailable' });
    });
    it('does not dispatch expired unstarted work', async () => {
      const intent = await reader.request(request, access); now += policy.jobLifetimeMs;
      expect(await worker.claim(intent.jobId!, digest('worker'))).toBeNull();
      expect((await reader.status(intent.jobId!, access)).state).toBe('invalidated');
      expect(await store.transaction(tx => tx.get(path('capacity', 'custom')))).toEqual({ active: 0 });
    });
    it('charges cached and coalesced requests across instances', async () => {
      await put('policy', 'current', { ...policy, computeRequests: 2, readRequests: 1 });
      await reader.request(request, access); await new MetricsReports(store, () => now).request(request, access);
      await expect(reader.request(request, access)).rejects.toMatchObject({ code: 'quota' });
      await reader.read(request, access);
      await expect(new MetricsReports(store, () => now).read(request, access)).rejects.toMatchObject({ code: 'quota' });
    });
    it('limits distinct work independently of request coalescing', async () => {
      await put('policy', 'current', { ...policy, customCapacity: 1 });
      await reader.request(request, access);
      await expect(reader.request({ ...request, startDate: '2026-11-09' }, access)).rejects.toMatchObject({ code: 'capacity' });
    });
    it('rejects stale publication after scope, deletion-policy or source generation change', async () => {
      const c = await claim();
      await put('controls', request.reportId, { ...control, revision: 2, sourceGeneration: digest('corrected-source') });
      await expect(worker.publish(c.job, aggregate(c.job, now))).rejects.toMatchObject({ code: 'stale_worker' });
      expect((await reader.status(c.job.id, access)).state).toBe('invalidated');
      expect((await reader.read(request, access)).report).toBeNull();
      await expect(reader.read(request, { ...access, scopeDigest: digest('other-scope') })).rejects.toMatchObject({ code: 'unavailable' });
    });
    it('keeps original source watermark and reports staleness honestly', async () => {
      const c = await claim(); await worker.publish(c.job, aggregate(c.job, now));
      now += control.freshnessMs + 1;
      const stale = await reader.read(request, access);
      expect(stale.state).toBe('stale'); expect(stale.report?.result.sourceWatermark).toBe(now - control.freshnessMs - 1);
      now += control.staleMs;
      expect((await reader.read(request, access)).state).toBe('unavailable');
    });
    it('rejects partial/mixed/private payloads without changing the publication', async () => {
      const c = await claim(); const good = aggregate(c.job, now);
      for (const bad of [{ ...good, email: 'private@example.invalid' }, { ...good, reconciled: false },
        { ...good, period: { ...good.period, endDate: '2026-11-10' } },
        { ...good, sourceGeneration: digest('another') },
        { ...good, metrics: { ...good.metrics, activeAccounts: { ...good.metrics.activeAccounts, coverage: 'unavailable' } } }]) {
        await expect(worker.publish(c.job, bad as AggregateResult)).rejects.toMatchObject({ code: 'invalid' });
      }
      expect((await reader.read(request, access)).report).toBeNull();
      await worker.publish(c.job, good);
    });
    it('requires approved policy and explicit admission enablement', async () => {
      await put('policy', 'current', { ...policy, computeEnabled: false });
      expect((await reader.read(request, access)).state).toBe('unavailable');
      await expect(reader.request(request, access)).rejects.toMatchObject({ code: 'unavailable' });
      await put('policy', 'current', { ...policy, approved: false });
      await expect(reader.read(request, access)).rejects.toMatchObject({ code: 'unavailable' });
    });
    it('collects an aggregate-only One source once and recovers the durable receipt', async () => {
      let calls = 0; const c = await claim();
      const source = new OneAdoptionSource(store, { sourceGeneration: control.sourceGeneration,
        timeoutMs: 1000, maxResponseBytes: 20_000 }, 'uat', async (url, options) => {
        calls++; expect(url).toBe('https://api.uat.hushh.ai/api/one/metrics/adoption');
        expect(JSON.stringify(options.body)).not.toMatch(/staff|email|owner|audience/);
        return Response.json(aggregate(c.job, now));
      }, () => now);
      const result = (await source.submit(c.job))!;
      await worker.publish(c.job, result);
      expect(await source.recover(c.job)).toEqual(result);
      expect(calls).toBe(1);
    });
    it('does not replay an unacknowledged source call or persist private source fields', async () => {
      const c = await claim(); let calls = 0;
      const source = new OneAdoptionSource(store, { sourceGeneration: control.sourceGeneration,
        timeoutMs: 1000, maxResponseBytes: 20_000 }, 'uat', async () => {
        calls++; return Response.json({ ...aggregate(c.job, now), email: 'private@example.invalid' });
      }, () => now);
      await expect(source.submit(c.job)).rejects.toMatchObject({ code: 'invalid' });
      expect(await source.recover(c.job)).toBeNull(); expect(await source.submit(c.job)).toBeNull();
      const receipt = await store.transaction(tx => tx.get(path('sourceReceipts', c.job.id)));
      expect(JSON.stringify(receipt)).not.toContain('private@example.invalid'); expect(calls).toBe(1);
    });
    it('fences an expired or revoked worker before any source call', async () => {
      const c = await claim(); let calls = 0;
      const source = new OneAdoptionSource(store, { sourceGeneration: control.sourceGeneration,
        timeoutMs: 1000, maxResponseBytes: 20_000 }, 'uat', async () => { calls++; return Response.json(aggregate(c.job, now)); }, () => now);
      now += policy.leaseMs + 1;
      await expect(source.submit(c.job)).rejects.toMatchObject({ code: 'stale_worker' });
      expect(calls).toBe(0);
    });
    it('resumes an interruption before source admission exactly once', async () => {
      const first = await claim(); let calls = 0;
      now += policy.leaseMs + 1;
      const recovery = (await worker.claim(first.job.id, digest('recover-before-source')))!;
      const source = new OneAdoptionSource(store, { sourceGeneration: control.sourceGeneration,
        timeoutMs: 1000, maxResponseBytes: 20_000 }, 'uat', async () => {
        calls++; return Response.json(aggregate(recovery.job, now));
      }, () => now);
      const result = await source.recover(recovery.job);
      expect(result?.metrics.activeAccounts.value).toBe(2);
      await expect(source.submit(first.job)).rejects.toMatchObject({ code: 'stale_worker' });
      expect(await source.recover(recovery.job)).toEqual(result);
      expect(calls).toBe(1);
    });
    it('preserves GA4 whole-period semantics, property timezone and thresholding coverage', async () => {
      await put('controls', 'hushhai.acquisition', control);
      const gaRequest = { ...request, reportId: 'hushhai.acquisition', timezone: 'America/Los_Angeles' };
      const intent = await reader.request(gaRequest, access);
      const c = (await worker.claim(intent.jobId!, digest('ga-worker')))!; let calls = 0;
      const source = new Ga4AcquisitionSource(store, { sourceGeneration: control.sourceGeneration,
        timeoutMs: 1000, maxResponseBytes: 20_000 }, { propertyId: '123456', timezone: gaRequest.timezone,
          streamId: '987654321', hostnames: ['www.hushh.ai'], informationWatermark: now },
      async (url, options) => {
        calls++; expect(url).toBe('https://analyticsdata.googleapis.com/v1beta/properties/123456:runReport');
        expect(options.body).not.toHaveProperty('dimensions');
        return Response.json({ metadata: { timeZone: gaRequest.timezone, subjectToThresholding: true },
          metricHeaders: ['sessions', 'activeUsers', 'engagedSessions', 'keyEvents'].map(name => ({ name })),
          rowCount: 1, rows: [{ metricValues: ['5', '3', '4', '1'].map(value => ({ value })) }] });
      }, () => now);
      const result = (await source.submit(c.job))!; await worker.publish(c.job, result);
      expect(result.metrics.activeUsers).toEqual({ value: 3, unit: 'provider_user', coverage: 'partial', basis: 'provider_defined' });
      await source.recover(c.job); expect(calls).toBe(1);
      expect((await reader.read(gaRequest, access)).report?.result.metrics.sessions.value).toBe(5);
    });
  });
}
describe('report request identity', () => {
  it('rejects extra authority fields, invalid dates, long ranges and unknown reports', () => {
    for (const invalid of [{ ...request, scopeDigest: 'override' }, { ...request, startDate: '2026-02-30' },
      { ...request, endDate: '2027-01-01' }, { ...request, timezone: 'invalid' }, { ...request, reportId: '__proto__' }]) {
      expect(() => validateRequest(invalid, 30)).toThrow();
    }
    expect(reportKey(request, control)).not.toBe(reportKey(request, { ...control, revision: 2 }));
    expect(validateRequest({ ...request, timezone: 'Etc/UTC' }, 30)).toEqual(request);
  });
});
describe('bounded immutable body cache', () => {
  it('evicts by byte and entry bounds and does not share mutable returned objects', () => {
    const cache = new ReportBodyCache(2, 40);
    cache.put('a', { value: 1 }); cache.put('b', { value: 2 });
    const copy = cache.get<{ value: number }>('a')!; copy.value = 99;
    expect(cache.get('a')).toEqual({ value: 1 });
    cache.put('c', { value: 3 }); expect(cache.get('b')).toBeNull();
    cache.put('large', { value: 'x'.repeat(50) });
    expect(cache.usage.entries).toBe(2); expect(cache.usage.bytes).toBeLessThanOrEqual(40);
  });
});
