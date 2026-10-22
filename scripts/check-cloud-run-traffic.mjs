import assert from 'node:assert/strict';
import { formatTrafficTargets } from './capture-cloud-run-traffic.mjs';
import { readFileSync } from 'node:fs';

const service = (traffic) => ({ status: { traffic } });
assert.equal(formatTrafficTargets(service([
  { revisionName: 'metrics-001', percent: 100 },
])), 'metrics-001=100');
assert.equal(formatTrafficTargets(service([
  { revisionName: 'metrics-001', percent: 80 },
  { revisionName: 'metrics-002', percent: 20 },
  { revisionName: 'metrics-older', percent: 0, tag: 'archive' },
])), 'metrics-001=80,metrics-002=20');
assert.throws(() => formatTrafficTargets(service([
  { revisionName: 'metrics-001', percent: 80 },
])));
assert.throws(() => formatTrafficTargets(service([
  { latestRevision: true, percent: 100 },
])));
// A --no-traffic workflow owns no serving allocation. Preserve even an operator
// canary, and prevent a describe/write race by having no traffic write at all.
assert.equal(formatTrafficTargets(service([{ revisionName: 'metrics-safe', percent: 80 }, { revisionName: 'metrics-candidate', percent: 20 }])), 'metrics-safe=80,metrics-candidate=20');
const workflow = readFileSync(new URL('../.github/workflows/deploy-main.yml', import.meta.url), 'utf8');
assert.match(workflow, /--no-traffic/);
assert.doesNotMatch(workflow, /gcloud run services update-traffic|--to-revisions|--to-latest|gcloud run services replace/);
console.log(JSON.stringify({ ok: true, checks: ['single-revision', 'canary-split', 'invalid-state', 'zero-traffic-workflow-never-overwrites-operator-allocation'] }));
