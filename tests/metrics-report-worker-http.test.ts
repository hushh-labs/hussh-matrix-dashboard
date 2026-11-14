import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { digest } from '../src/server/reports/contracts';
import { reportingRuntimeConfig, reportingRuntimeConfigFromEnv } from '../src/server/reports/worker-runtime';
import { reportingWorkerServer, type ReportingWorkerRuntime } from '../src/server/reports/worker-http';

export const workerConfigFixture = () => reportingRuntimeConfig({ projectId: 'demo-metrics', databaseId: 'metrics-reports', scopeDigest: digest('scope'),
  workerAudience: 'https://metrics-reports-example.run.app', webInvokerEmail: 'metrics-report-web@demo-metrics.iam.gserviceaccount.com',
  taskInvokerEmail: 'metrics-report-task-invoker@demo-metrics.iam.gserviceaccount.com', dispatcherInvokerEmail: 'metrics-report-dispatcher@demo-metrics.iam.gserviceaccount.com',
  queueParent: 'projects/demo-metrics/locations/us-central1/queues/metrics-reporting-test', collectionEnabled: false,
  rpcTimeoutMs: 2000, maxResponseBytes: 20_000, maxRequestBytes: 2048, bodyCacheEntries: 2, bodyCacheBytes: 40_000 });

describe('private Metrics worker HTTP boundary', () => {
  const servers: ReturnType<typeof reportingWorkerServer>[] = [];
  afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();
  }))); });
  async function fixture() {
    const config = workerConfigFixture();
    const runtime = { read: vi.fn(async () => ({ state: 'unavailable', report: null })), status: vi.fn(async () => ({})),
      request: vi.fn(async () => ({ state: 'accepted', jobId: digest('job'), reportId: null })),
      collect: vi.fn(async () => ({ state: 'delayed', needsAttention: false, retryAfterMs: 1500 })),
      dispatch: vi.fn(async () => ({ state: 'queued' })), close: vi.fn() };
    const verify = vi.fn(async (token: string) => ({ email: token === 'web' ? config.webInvokerEmail : token === 'task' ? config.taskInvokerEmail : config.dispatcherInvokerEmail, emailVerified: token !== 'unverified' }));
    const server = reportingWorkerServer(config, runtime as unknown as ReportingWorkerRuntime, verify); servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const send = (path: string, token: string | null, body: unknown) => fetch(origin + '/internal/metrics/' + path, { method: 'POST',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { config, runtime, verify, send, origin };
  }
  it('provides a bounded health path outside Cloud Run reserved URLs without consulting authority or sources', async () => {
    const f = await fixture();
    for (const path of ['/health', '/healthz']) {
      const response = await fetch(f.origin + path);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(await response.json()).toEqual({ status: 'ok' });
    }
    expect(f.verify).not.toHaveBeenCalled();
    for (const operation of Object.values(f.runtime)) expect(operation).not.toHaveBeenCalled();
    expect((await fetch(f.origin + '/health', { method: 'POST' })).status).toBe(404);
    expect((await fetch(f.origin + '/health/')).status).toBe(404);
  });
  it('authenticates before parsing input and rejects cross-role invocation', async () => {
    const f = await fixture();
    expect((await f.send('read', null, { bad: true })).status).toBe(401);
    expect((await f.send('collect', 'web', { jobId: digest('job') })).status).toBe(401);
    expect((await f.send('dispatch', 'task', { jobId: digest('job') })).status).toBe(401);
    expect((await f.send('read', 'unverified', {})).status).toBe(401);
    expect(f.runtime.collect).not.toHaveBeenCalled(); expect(f.runtime.read).not.toHaveBeenCalled();
  });
  it('reads only through the web role, binds scope and never starts collection on read', async () => {
    const f = await fixture(), access = { subjectHash: digest('staff'), scopeDigest: f.config.scopeDigest };
    const response = await f.send('read', 'web', { access, request: { reportId: 'one.adoption' } });
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ state: 'unavailable', report: null });
    expect(f.runtime.read).toHaveBeenCalledOnce(); expect(f.runtime.request).not.toHaveBeenCalled(); expect(f.runtime.collect).not.toHaveBeenCalled();
    expect((await f.send('read', 'web', { access: { ...access, scopeDigest: digest('other') }, request: {} })).status).toBe(401);
    expect((await f.send('read', 'web', { access: { ...access, email: 'private@example.invalid' }, request: {} })).status).toBe(400);
  });
  it('rejects oversized or authority-bearing task bodies', async () => {
    const f = await fixture();
    expect((await f.send('collect', 'task', { jobId: digest('job'), source: 'override' })).status).toBe(400);
    expect((await f.send('collect', 'task', { jobId: 'x'.repeat(3000) })).status).toBe(400);
    expect(f.runtime.collect).not.toHaveBeenCalled();
  });
  it('keeps task retries bounded by progress and acknowledges attention without pretending success', async () => {
    const f = await fixture();
    let response = await f.send('collect', 'task', { jobId: digest('job') });
    expect(response.status).toBe(503); expect(response.headers.get('retry-after')).toBe('2');
    f.runtime.collect.mockResolvedValueOnce({ state: 'delayed', needsAttention: true, retryAfterMs: 0 });
    response = await f.send('collect', 'task', { jobId: digest('job') });
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ state: 'delayed', needsAttention: true });
    f.runtime.collect.mockRejectedValueOnce(new Error('secret-value-should-not-leak'));
    response = await f.send('collect', 'task', { jobId: digest('job') });
    expect(await response.text()).toBe('{"state":"unavailable"}');
  });
  it('does not initialize native clients or source calls to validate held configuration', () => {
    const config = workerConfigFixture();
    expect(reportingRuntimeConfigFromEnv({ METRICS_WORKER_RUNTIME: 'reporting', METRICS_BIGQUERY_ENABLED: 'false', METRICS_COLLECTOR_CONFIG: JSON.stringify(config) })).toEqual(config);
    for (const env of [{}, { METRICS_WORKER_RUNTIME: 'reporting', METRICS_BIGQUERY_ENABLED: 'true', METRICS_COLLECTOR_CONFIG: JSON.stringify(config) }]) {
      expect(() => reportingRuntimeConfigFromEnv(env)).toThrow();
    }
    for (const bad of [{ ...config, workerAudience: 'https://example.invalid' }, { ...config, databaseId: '(default)' },
      { ...config, taskInvokerEmail: config.webInvokerEmail }, { ...config, queueParent: config.queueParent.replace('demo-metrics', 'other-project') }]) {
      expect(() => reportingRuntimeConfig(bad)).toThrow();
    }
  });
});
