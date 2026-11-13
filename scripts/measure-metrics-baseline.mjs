/** Offline source baseline. Do not import server.ts or initialize cloud SDKs. */
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const paths = ['server.ts', 'src/Dashboard.tsx', 'src/server/aggregate-cache.ts',
  'src/server/bigquery-cost-control.ts', 'src/lib/metrics-resource.ts', 'package-lock.json'];
const files = await Promise.all(paths.map(async file => {
  const body = await readFile(path.join(root, file), 'utf8');
  return { path: file, bytes: (await stat(path.join(root, file))).size,
    lines: body.split(/\r?\n/).length };
}));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
console.log(JSON.stringify({ ok: true, checkedAt: new Date().toISOString(),
  target: 'local-source-only', sourceCalls: 0, measurements: { files,
    directDependencies: Object.keys(pkg.dependencies ?? {}).length,
    directDevelopmentDependencies: Object.keys(pkg.devDependencies ?? {}).length },
  limitations: ['No live workload, latency, freshness, billed-work or cost measurement.'] }, null, 2));
