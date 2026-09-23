import assert from 'node:assert/strict';
import { formatTrafficTargets } from './capture-cloud-run-traffic.mjs';

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
console.log(JSON.stringify({ ok: true, checks: ['single-revision', 'canary-split', 'invalid-state'] }));
