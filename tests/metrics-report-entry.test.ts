import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { digest } from '../src/server/reports/contracts';

describe('held Metrics collector entrypoint', () => {
  it('validates explicit held config without requiring ADC, emulator or provider access', async () => {
    const config = { projectId: 'demo-metrics', databaseId: 'metrics-reports', scopeDigest: digest('entry-scope'),
      workerAudience: 'https://metrics-report-example.run.app', webInvokerEmail: 'metrics-report-web@demo-metrics.iam.gserviceaccount.com',
      taskInvokerEmail: 'metrics-report-task-invoker@demo-metrics.iam.gserviceaccount.com', dispatcherInvokerEmail: 'metrics-report-dispatcher@demo-metrics.iam.gserviceaccount.com',
      queueParent: 'projects/demo-metrics/locations/us-central1/queues/metrics-reporting-fixture', collectionEnabled: false,
      rpcTimeoutMs: 2000, maxResponseBytes: 20_000, maxRequestBytes: 2048, bodyCacheEntries: 2, bodyCacheBytes: 40_000 };
    const env = { ...process.env, METRICS_WORKER_RUNTIME: 'reporting', METRICS_BIGQUERY_ENABLED: 'false',
      METRICS_COLLECTOR_CONFIG: JSON.stringify(config), FIRESTORE_EMULATOR_HOST: '', GOOGLE_APPLICATION_CREDENTIALS: 'not-an-existing-credential-file' };
    const result = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/metrics-collector.ts', '--check-config'], { env, timeout: 20_000 });
    expect(JSON.parse(result.stdout)).toEqual({ ok: true, target: 'metrics-reporting-worker', collectionEnabled: false }); expect(result.stderr).toBe('');
    await expect(promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/metrics-collector.ts', '--check-config'], {
      env: { ...env, METRICS_BIGQUERY_ENABLED: 'true' }, timeout: 20_000,
    })).rejects.toMatchObject({ code: 1, stderr: '{"ok":false,"target":"metrics-reporting-worker","state":"unavailable"}\n' });
  }, 45_000);
});
