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
});

it('verifies authenticated health and explicitly unavailable warehouse data with bounded API calls', async () => {
  const paths: string[] = [];
  let available = false;
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
    if (url.pathname === '/api/analytics/all' && url.searchParams.get('view') === 'one') {
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
    expect(paths).toEqual(['/api/health', '/api/analytics/all']);
    available = true;
    await expect(run()).rejects.toMatchObject({ code: 1, stdout: expect.stringContaining('Expected explicit unavailable warehouse summaries') });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
