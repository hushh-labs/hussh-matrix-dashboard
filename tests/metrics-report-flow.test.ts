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
  it('connects authorized read/admit, durable dispatch, collection, publication and subsequent reuse', async () => {
    const f = collectionFixture(); await f.initialize();
    await f.put('policy', 'dispatch', { approved: true, enabled: true, leaseMs: 1000, lookupDelayMs: 1000, maxLookups: 2 });
    let taskCreates = 0, sourceCalls = 0;
    const dispatch = new MetricsReportDispatch(f.store, { taskName: id => `fixture/tasks/${id}`,
      create: async () => { taskCreates++; return 'accepted'; }, lookup: async () => 'present' }, f.clock);
    const collector = new MetricsCollection(f.store, async job => new OneAdoptionSource(f.store, {
      sourceGeneration: f.binding.sourceGeneration, timeoutMs: 1000, maxResponseBytes: 20_000,
    }, 'uat', async () => { sourceCalls++; return Response.json(f.result(job)); }, f.clock), f.clock);
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
      expect((await client.read(f.request, f.access)).state).toBe('unavailable'); expect(taskCreates).toBe(0); expect(sourceCalls).toBe(0);
      const accepted = await client.request(f.request, f.access); expect(taskCreates).toBe(1); expect(sourceCalls).toBe(0);
      expect((await client.status(accepted.jobId!, f.access)).state).toBe('accepted');
      const delivered = await fetch(origin + '/internal/metrics/collect', { method: 'POST', headers: { Authorization: 'Bearer task', 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId: accepted.jobId }) });
      expect(delivered.status).toBe(200); expect(await delivered.json()).toMatchObject({ state: 'completed' });
      for (let i = 0; i < 10; i++) expect((await client.read(f.request, f.access)).report?.result.metrics.activeAccounts.value).toBe(2);
      expect((await client.request(f.request, f.access)).state).toBe('completed');
      expect((await client.status(accepted.jobId!, f.access)).retryAfterMs).toBe(0);
      expect([taskCreates, sourceCalls]).toEqual([1, 1]);
    } finally {
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
