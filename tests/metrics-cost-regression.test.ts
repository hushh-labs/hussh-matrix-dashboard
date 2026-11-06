import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { clearMetricsCache, readMetrics } from '../src/lib/metrics-resource';

afterEach(() => { clearMetricsCache(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('reuses an aged browser snapshot until explicit refresh, with no timed network work', async () => {
  clearMetricsCache(); vi.useFakeTimers();
  const fetcher = vi.fn(async () => Response.json({ value: 7 })); vi.stubGlobal('fetch', fetcher);
  await readMetrics('/api/analytics/all?view=one');
  await vi.advanceTimersByTimeAsync(20 * 60_000);
  await readMetrics('/api/analytics/all?view=one');
  expect(fetcher).toHaveBeenCalledTimes(1);
  await readMetrics('/api/analytics/all?view=one', { refresh: true });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('keeps native BigQuery and uncapped CLI execution out of dashboard runtime paths', () => {
  const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(join(directory, entry.name)) : /\.[cm]?[jt]s$/.test(entry.name) ? [join(directory, entry.name)] : []);
  for (const file of ['server.ts', ...walk('src/server')]) {
    if (file.endsWith('bigquery-cost-control.ts')) continue;
    const code = readFileSync(file, 'utf8');
    expect(code, file).not.toMatch(/new BigQuery\s*\(|(?:import|require)\s*\(['"]@google-cloud\/bigquery|execFileAsync\(\s*['"]bq['"]/);
  }
  const server = readFileSync('server.ts', 'utf8');
  expect(server).not.toMatch(/setInterval\(|snapshots\.(?:warm|refreshActive)\(|queryBigQuery\w*WithCli/);
  expect(readFileSync('src/lib/use-metrics-resource.ts', 'utf8')).not.toMatch(/setInterval|setTimeout|prefetch/);
});
it('defaults both deployment environments to a closed incident hold', () => {
  const workflow = readFileSync('.github/workflows/deploy-main.yml', 'utf8');
  expect(workflow.match(/if: \$\{\{ vars\.METRICS_DEPLOYMENT_HOLD == 'false'/g)).toHaveLength(2);
});
