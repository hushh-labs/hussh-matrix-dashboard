import { execFileSync, execFile } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const image = 'registry.example/metrics@sha256:' + 'a'.repeat(64);

it('only accepts an unset or explicitly disabled BigQuery flag on the serving template and exact candidate', () => {
  const container = { image, env: [] as object[] };
  const run = (candidateImage?: string) => execFileSync(process.execPath, [
    'scripts/check-release-bigquery-off.mjs', ...(candidateImage ? [candidateImage] : []),
  ], {
    input: JSON.stringify(candidateImage
      ? { spec: { containers: [container] } }
      : { spec: { template: { spec: { containers: [container] } } } }),
    stdio: ['pipe', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  expect(run()).toContain('BigQuery disabled');
  container.env = [{ name: 'METRICS_BIGQUERY_ENABLED', value: 'false' }];
  expect(run(image)).toContain('BigQuery disabled');
  expect(() => run(image + '-unexpected')).toThrow('does not match the reviewed digest');
  for (const env of [
    [{ name: 'METRICS_BIGQUERY_ENABLED', value: 'true' }],
    [{ name: 'METRICS_BIGQUERY_ENABLED', valueFrom: { secretKeyRef: { name: 'flag' } } }],
    [...container.env, ...container.env],
  ]) {
    container.env = env;
    expect(() => run()).toThrow('requires BigQuery disabled');
    expect(() => run(image)).toThrow('requires BigQuery disabled');
  }
  container.env = [{ name: 'METRICS_DAILY_ONE_ID', value: 'must-not-log-this-value' }];
  try {
    run();
    throw new Error('Expected the inherited retained report setting to block the build.');
  } catch (error) {
    expect(String(error)).toContain('Bind retained report settings before building: METRICS_DAILY_ONE_ID.');
    expect(String(error)).not.toContain('must-not-log-this-value');
  }
  container.env = [{ name: 'METRICS_DAILY_ONE_ID', valueFrom: { secretKeyRef: { name: 'retained-one-id', key: '1' } } }];
  expect(run()).toContain('BigQuery disabled');
});

it('verifies authenticated health and explicitly unavailable warehouse data with bounded API calls', async () => {
  const paths: string[] = [];
  let available = false;
  let published = false;
  let invalidScope = false;
  let missing: string | null = null;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    paths.push(url.pathname);
    if (request.headers.cookie !== 'hussh_matrix_session=release-test') {
      response.writeHead(401).end();
      return;
    }
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    if (url.pathname === '/api/health') {
      response.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (url.pathname === '/api/auth/plg-publication') {
      response.end(JSON.stringify({ publicationAsOf: published ? '2026-11-14T21:34:55Z' : null }));
      return;
    }
    if (url.pathname === '/api/analytics/all' && url.searchParams.get('view') === 'one') {
      if (request.headers['x-metrics-passive-read'] !== '1') {
        response.writeHead(400).end('{}');
        return;
      }
      if (missing) {
        response.writeHead(503).end(JSON.stringify({ error: missing }));
        return;
      }
      if (published) {
        const environment = url.searchParams.get('environment');
        if (!['production', 'uat'].includes(environment ?? '') || url.searchParams.get('one_start_date') !== '2026-11-08'
          || url.searchParams.get('one_end_date') !== '2026-11-14') {
          response.writeHead(400).end('{}');
          return;
        }
        const host = environment === 'production' || invalidScope ? 'one.hushh.ai' : 'uat.one.hushh.ai';
        response.setHeader('X-Metrics-Cache', 'RESTORED');
        response.setHeader('X-Metrics-Updated-At', '2026-11-14T21:34:55Z');
        response.end(JSON.stringify({ one: { data: { [environment!]: {
          available: true, sourceWebHost: host, surfaceScope: { webHost: host, strictWebHost: true },
          range: { startDate: '2026-11-08', endDate: '2026-11-14' },
          activeUsers: { countingUnit: 'device', identityScope: 'device' },
          registeredAccounts: { environment, countingUnit: 'account', available: false, registryScope: 'unconfigured',
            totalAccounts: null, newAccounts: null, accountsCreatedByRangeEnd: null, disabledAccounts: null, note: 'Unavailable' },
          identifiedUsers: { countingUnit: 'account', identityScope: 'distinct accounts', deviceCoverage: { dau: null, wau: null, mau: null },
            selectedRange: { available: false, totalUsers: null, newUsers: null, returningUsers: null, newUserDefinition: 'first observed' } },
          platformsAvailable: false, activeByPlatformAvailable: false,
        } } } }));
        return;
      }
      response.end(JSON.stringify({ one: { data: { production: { available }, uat: { available: false } } } }));
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const run = () => promisify(execFile)(process.execPath, [
      '--import', './scripts/release-auth-fetch.mjs', 'scripts/check-public-analytics-contract.mjs', '--bigquery-off',
    ], {
      env: {
        ...process.env,
        METRICS_DASHBOARD_URL: `http://127.0.0.1:${port}`,
        METRICS_AUTH_COOKIE: 'hussh_matrix_session=release-test',
      },
      timeout: 5_000,
    });
    expect(JSON.parse((await run()).stdout).ok).toBe(true);
    expect(paths).toEqual(['/api/health', '/api/auth/plg-publication', '/api/analytics/all']);
    available = true;
    await expect(run()).rejects.toMatchObject({ code: 1, stdout: expect.stringContaining('Expected explicit unavailable warehouse summaries') });
    missing = 'No retained report is available for this selection.';
    await expect(run()).rejects.toMatchObject({ code: 1, stdout: expect.stringContaining('returned HTTP 503') });
    missing = null;
    published = true;
    expect(JSON.parse((await run()).stdout).checks).toEqual([
      { endpoint: '/api/health' },
      ...['production', 'uat'].map(environment => ({ endpoint: '/api/analytics/all', startDate: '2026-11-08', endDate: '2026-11-14', environment, state: 'retained' })),
    ]);
    invalidScope = true;
    await expect(run()).rejects.toMatchObject({ code: 1, stdout: expect.stringContaining('retained web host is outside its One environment') });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
