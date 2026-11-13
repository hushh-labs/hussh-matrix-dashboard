import { beforeEach, describe, expect, it } from 'vitest';
import { digest, type ReportControl, type ReportingPolicy } from '../src/server/reports/contracts';
import { MetricsReports } from '../src/server/reports/service';
import { reportPath as path } from '../src/server/reports/store';
import { CloudReportTaskQueue, MetricsReportDispatch, type DispatchPolicy, type ReportTaskQueue } from '../src/server/reports/dispatch';
import { MemoryReportStore } from './helpers/metrics-report-memory-store';

const access = { subjectHash: digest('dispatch-fixture-staff'), scopeDigest: digest('dispatch-fixture-scope') };
const request = { reportId: 'one.adoption' as const, startDate: '2026-11-11', endDate: '2026-11-12', timezone: 'UTC' };
const control: ReportControl = { enabled: true, revision: 1, sourceGeneration: digest('dispatch-source'), scopeDigest: access.scopeDigest,
  definitionVersion: '1', freshnessMs: 1000, staleMs: 2000 };
// Test-only policies; no production activation values are supplied.
const reporting: ReportingPolicy = { approved: true, computeEnabled: true, quotaWindowMs: 60_000,
  readRequests: 10, computeRequests: 10, statusRequests: 10, customCapacity: 2,
  maxPeriodDays: 30, leaseMs: 1000, jobLifetimeMs: 30_000, maxSnapshotBytes: 20_000 };
const dispatchPolicy: DispatchPolicy = { approved: true, enabled: true, leaseMs: 100, lookupDelayMs: 200, maxLookups: 2 };

describe('durable report dispatch', () => {
  let store: MemoryReportStore, now: number, jobId: string, created: number, lookedUp: number;
  let create: ReportTaskQueue['create'], lookup: ReportTaskQueue['lookup'], queue: ReportTaskQueue;
  beforeEach(async () => {
    store = new MemoryReportStore(); now = Date.parse('2026-11-13T00:00:00Z'); created = 0; lookedUp = 0;
    store.data.set(path('policy', 'current'), reporting); store.data.set(path('policy', 'dispatch'), dispatchPolicy);
    store.data.set(path('controls', request.reportId), control);
    jobId = (await new MetricsReports(store, () => now).request(request, access)).jobId!;
    create = async () => 'accepted'; lookup = async () => 'present';
    queue = { taskName: id => `fixture/tasks/${id}`, create: async id => { created++; return create(id); },
      lookup: async id => { lookedUp++; return lookup(id); } };
  });
  const owner = digest('dispatcher-one');
  it('requires independently approved dispatch policy before any queue I/O', async () => {
    store.data.delete(path('policy', 'dispatch'));
    await expect(new MetricsReportDispatch(store, queue, () => now).deliver(jobId, owner)).rejects.toMatchObject({ code: 'unavailable' });
    expect(created).toBe(0); expect(lookedUp).toBe(0);
  });
  it('coalesces dispatchers while one enqueue is in flight', async () => {
    let resolve!: (value: 'accepted') => void, started!: () => void;
    const start = new Promise<void>(r => { started = r; });
    create = async () => { started(); return new Promise(r => { resolve = r; }); };
    const first = new MetricsReportDispatch(store, queue, () => now).deliver(jobId, owner);
    await start;
    expect((await new MetricsReportDispatch(store, queue, () => now).deliver(jobId, digest('dispatcher-two'))).state).toBe('delayed');
    resolve('accepted'); expect((await first).state).toBe('queued'); expect(created).toBe(1);
  });
  it('recovers a lost enqueue acknowledgement only by native task lookup', async () => {
    create = async () => { throw new Error('Acknowledgement lost'); };
    const dispatcher = new MetricsReportDispatch(store, queue, () => now);
    expect((await dispatcher.deliver(jobId, owner)).state).toBe('delayed');
    expect((await dispatcher.deliver(jobId, owner)).state).toBe('delayed'); expect(lookedUp).toBe(0);
    now += dispatchPolicy.lookupDelayMs;
    expect((await new MetricsReportDispatch(store, queue, () => now).deliver(jobId, owner)).state).toBe('queued');
    expect([created, lookedUp]).toEqual([1, 1]);
  });
  it('does not treat a missing task as permission to enqueue another one', async () => {
    create = async () => { throw new Error('Acknowledgement lost'); }; lookup = async () => 'missing';
    const dispatcher = new MetricsReportDispatch(store, queue, () => now);
    await dispatcher.deliver(jobId, owner);
    for (let i = 0; i < 3; i++) { now += dispatchPolicy.lookupDelayMs; await dispatcher.deliver(jobId, owner); }
    expect([created, lookedUp]).toEqual([1, 2]);
    expect((await dispatcher.deliver(jobId, owner)).state).toBe('blocked');
    expect(store.data.get(path('capacity', 'custom'))).toEqual({ active: 1 });
    const progress = await new MetricsReports(store, () => now).status(jobId, access);
    expect(progress.state).toBe('delayed'); expect(progress.needsAttention).toBe(true); expect(progress.retryAfterMs).toBe(0);
    expect(progress.queueWaitMs).toBe(now - Date.parse('2026-11-13T00:00:00Z'));
    expect(progress.executionMs).toBe(0);
  });
  it('stops retrying credential/configuration failures', async () => {
    create = async () => 'rejected'; const dispatcher = new MetricsReportDispatch(store, queue, () => now);
    expect((await dispatcher.deliver(jobId, owner)).state).toBe('blocked');
    now += dispatchPolicy.lookupDelayMs * 4;
    expect((await dispatcher.deliver(jobId, owner)).state).toBe('blocked'); expect([created, lookedUp]).toEqual([1, 0]);
  });
  it('does not enqueue revoked or expired work', async () => {
    store.data.set(path('controls', request.reportId), { ...control, revision: 2 });
    expect((await new MetricsReportDispatch(store, queue, () => now).deliver(jobId, owner)).state).toBe('skipped');
    store.data.set(path('controls', request.reportId), control); now += reporting.jobLifetimeMs;
    expect((await new MetricsReportDispatch(store, queue, () => now).deliver(jobId, owner)).state).toBe('skipped');
    expect(created).toBe(0);
  });
  it('settles a completed job without another queue call', async () => {
    create = async () => { throw new Error('Lost ack'); }; const dispatcher = new MetricsReportDispatch(store, queue, () => now);
    await dispatcher.deliver(jobId, owner);
    const job = store.data.get(path('jobs', jobId)) as object;
    store.data.set(path('jobs', jobId), { ...job, status: 'completed' });
    expect((await dispatcher.deliver(jobId, owner)).state).toBe('settled'); expect([created, lookedUp]).toEqual([1, 0]);
  });
  it('reconciles a disappeared queued task without creating a replacement', async () => {
    const dispatcher = new MetricsReportDispatch(store, queue, () => now);
    await dispatcher.deliver(jobId, owner); now += dispatchPolicy.lookupDelayMs;
    lookup = async () => 'missing';
    expect((await dispatcher.deliver(jobId, owner)).state).toBe('delayed'); expect([created, lookedUp]).toEqual([1, 1]);
  });
});

describe('Cloud Tasks reporting binding', () => {
  const config = { parent: 'projects/metrics-fixture/locations/us-central1/queues/metrics-reporting-fixture',
    workerUrl: 'https://metrics-worker-fixture.a.run.app/internal/metrics/collect',
    invokerEmail: 'metrics-report-task-invoker@metrics-fixture.iam.gserviceaccount.com', rpcTimeoutMs: 1000 };
  it('uses a deterministic native name, pinned audience and job-only body', async () => {
    const jobId = digest('job'); let sent: unknown;
    const queue = new CloudReportTaskQueue(config, async (url, request) => {
      expect(url).toBe(`https://cloudtasks.googleapis.com/v2/${config.parent}/tasks`); sent = request.body;
      return { status: 200, name: `${config.parent}/tasks/${jobId}` };
    });
    expect(await queue.create(jobId)).toBe('accepted');
    const task = (sent as { task: { httpRequest: { body: string; oidcToken: { audience: string } } } }).task;
    expect(JSON.parse(Buffer.from(task.httpRequest.body, 'base64').toString())).toEqual({ jobId });
    expect(task.httpRequest.oidcToken.audience).toBe('https://metrics-worker-fixture.a.run.app');
  });
  it('preserves already-existing tasks and distinguishes missing lookup from rejection', async () => {
    const queue = new CloudReportTaskQueue(config, async (_url, request) => ({ status: request.method === 'POST' ? 409 : 404 }));
    expect(await queue.create(digest('job'))).toBe('accepted'); expect(await queue.lookup(digest('job'))).toBe('missing');
    const denied = new CloudReportTaskQueue(config, async () => ({ status: 403 }));
    expect(await denied.create(digest('job'))).toBe('rejected');
  });
  it('rejects unrelated queues, identities and target URLs', () => {
    for (const altered of [{ ...config, parent: config.parent.replace('metrics-reporting-fixture', 'one-plg') },
      { ...config, invokerEmail: 'other@metrics-fixture.iam.gserviceaccount.com' },
      { ...config, workerUrl: 'http://localhost/internal/metrics/collect' },
      { ...config, workerUrl: config.workerUrl + '?token=x' },
      { ...config, workerUrl: config.workerUrl.replace('.run.app', '.run.app.evil.invalid') }]) {
      expect(() => new CloudReportTaskQueue(altered, async () => ({ status: 200 }))).toThrow();
    }
  });
});
