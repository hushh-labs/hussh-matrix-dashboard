import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { digest } from '../src/server/reports/contracts';
import { MetricsReportWebClient } from '../src/server/reports/web-client';
import { MetricsReportDispatch } from '../src/server/reports/dispatch';
import { MetricsCollection } from '../src/server/reports/lifecycle';
import { OneAdoptionSource } from '../src/server/reports/sources';
import { reportingRuntimeConfig } from '../src/server/reports/worker-runtime';
import { reportingWorkerServer, type ReportingWorkerRuntime } from '../src/server/reports/worker-http';
import { collectionFixture } from './helpers/metrics-collection-fixture';
import { withinDeadline } from '../src/server/reports/deadline';
import { boundedText } from '../src/server/reports/transports';

describe('private reporting flow integration', () => {
  it('coalesces manual refreshes for a closed One adoption day and reuses one partial publication', async () => {
    const f = collectionFixture(); await f.initialize();
    const request = { ...f.request, startDate: f.request.endDate };
    const secondStaff = { ...f.access, subjectHash: digest('another-staff-member') };
    await f.put('policy', 'current', { ...f.policy, scheduledCapacity: 0 });
    await f.put('policy', 'one-read-budget', { approved: true, dailyQueries: 1 });
    await f.put('policy', 'dispatch', { approved: true, enabled: true, leaseMs: 1000, lookupDelayMs: 1000, maxLookups: 2 });
    let taskCreates = 0, sourceCalls = 0;
    let markSourceStarted!: () => void;
    let releaseSource!: () => void;
    const sourceStarted = new Promise<void>(resolve => { markSourceStarted = resolve; });
    const sourceReply = new Promise<void>(resolve => { releaseSource = resolve; });
    const dispatch = new MetricsReportDispatch(f.store, { taskName: id => `fixture/tasks/${id}`,
      create: async () => { taskCreates++; return 'accepted'; }, lookup: async () => 'present' }, f.clock);
    const collector = new MetricsCollection(f.store, async job => new OneAdoptionSource(f.store, {
      sourceGeneration: f.binding.sourceGeneration, timeoutMs: 1000, maxResponseBytes: 20_000,
    }, 'uat', async (_url, { signal }) => {
      sourceCalls++;
      markSourceStarted();
      await withinDeadline(sourceReply, signal);
      const result = f.result(job);
      result.metrics.activeAccounts.coverage = 'partial';
      result.metrics.confirmedOutcomes.coverage = 'partial';
      return Response.json(result);
    }, f.clock), f.clock);
    const config = reportingRuntimeConfig({ projectId: 'demo-metrics', databaseId: 'metrics-reports', scopeDigest: f.access.scopeDigest,
      workerAudience: 'https://metrics-report-example.run.app', webInvokerEmail: 'metrics-report-web@demo-metrics.iam.gserviceaccount.com',
      taskInvokerEmail: 'metrics-report-task-invoker@demo-metrics.iam.gserviceaccount.com', dispatcherInvokerEmail: 'metrics-report-dispatcher@demo-metrics.iam.gserviceaccount.com',
      queueParent: 'projects/demo-metrics/locations/us-central1/queues/metrics-reporting-fixture', collectionEnabled: true,
      rpcTimeoutMs: 2000, maxResponseBytes: 20_000, maxRequestBytes: 2048, bodyCacheEntries: 2, bodyCacheBytes: 40_000 });
    const runtime = {
      read: f.reports.read.bind(f.reports), status: f.reports.status.bind(f.reports),
      request: async (input: unknown, access: typeof f.access) => {
        const accepted = await f.reports.request(input, access);
        if (accepted.jobId) await dispatch.deliver(accepted.jobId, digest('dispatcher'));
        return accepted;
      }, collect: (id: string) => collector.collect(id, digest('collector')),
    } as ReportingWorkerRuntime;
    const server = reportingWorkerServer(config, runtime, async token => ({ email: token === 'web' ? config.webInvokerEmail : config.taskInvokerEmail, emailVerified: true }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      // Test-only loopback transport. Production client still accepts only a
      // fixed private HTTPS run.app audience and native signed identity.
      const client = new MetricsReportWebClient({ audience: config.workerAudience, timeoutMs: 2000, maxResponseBytes: 20_000 },
        async () => ({ Authorization: 'Bearer web' }), (url, init) => fetch(String(url).replace(config.workerAudience, origin), init), f.clock);
      expect((await client.read(request, f.access)).state).toBe('unavailable'); expect(taskCreates).toBe(0); expect(sourceCalls).toBe(0);
      await expect(f.reports.requestScheduled(request, f.access)).rejects.toMatchObject({ code: 'capacity' });
      const accepted = await client.request(request, f.access); expect(taskCreates).toBe(1); expect(sourceCalls).toBe(0);
      expect((await client.status(accepted.jobId!, f.access)).state).toBe('accepted');
      const deliver = () => fetch(origin + '/internal/metrics/collect', { method: 'POST', headers: { Authorization: 'Bearer task', 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId: accepted.jobId }) });
      const delivery = deliver();
      // Capture early connection errors even if the local source has not started.
      void delivery.catch(() => undefined);
      await withinDeadline(sourceStarted, AbortSignal.timeout(2000));
      expect((await client.status(accepted.jobId!, secondStaff)).state).toBe('running');
      expect(await client.request(request, secondStaff)).toMatchObject({ state: 'running', jobId: accepted.jobId });
      expect((await client.read(request, secondStaff)).state).toBe('unavailable');
      expect([taskCreates, sourceCalls]).toEqual([1, 1]);
      releaseSource();
      const delivered = await delivery;
      expect(delivered.status).toBe(200); expect(await delivered.json()).toMatchObject({ state: 'completed' });
      const duplicateDelivery = await deliver();
      expect(duplicateDelivery.status).toBe(200);
      expect(await duplicateDelivery.json()).toMatchObject({ state: 'completed' });
      for (const access of [f.access, secondStaff]) {
        expect((await client.read(request, access)).report).toMatchObject({
          id: accepted.jobId,
          result: { period: { startDate: request.startDate, endDate: request.endDate, timezone: request.timezone },
            metrics: { activeAccounts: { value: 2, coverage: 'partial' }, confirmedOutcomes: { value: 3, coverage: 'partial' } } },
        });
      }
      expect(await client.request(request, secondStaff)).toMatchObject({ state: 'completed', reportId: accepted.jobId, jobId: null });
      expect((await client.status(accepted.jobId!, f.access)).retryAfterMs).toBe(0);
      expect(await f.get('sourceReadBudgets', 'one-adoption-uat-2026-11-13')).toEqual({ used: 1, limit: 1 });
      expect([taskCreates, sourceCalls]).toEqual([1, 1]);
    } finally {
      releaseSource();
      await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
    }
  });
  it('bounds pending identity SDK and response-stream waits by the same explicit deadline', async () => {
    const signal = new AbortController(); const pending = withinDeadline(new Promise<never>(() => {}), signal.signal);
    signal.abort(new Error('Synthetic deadline'));
    await expect(pending).rejects.toThrow('Synthetic deadline');
    const streamSignal = new AbortController(); let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    const reading = boundedText(new Response(stream), 100, streamSignal.signal);
    streamSignal.abort(new Error('Synthetic stream deadline'));
    await expect(reading).rejects.toThrow('Synthetic stream deadline'); expect(cancelled).toBe(true);
  });
});
