import assert from 'node:assert/strict';
import { formatTrafficTargets, candidateNeedsRollback } from './capture-cloud-run-traffic.mjs';

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
const changedByOperator = service([{ revisionName: 'metrics-safe', percent: 100 }, { revisionName: 'metrics-candidate', tag: 'release-candidate' }]);
assert.equal(candidateNeedsRollback(changedByOperator, 'metrics-unsafe=100', 'metrics-candidate'), false);
assert.equal(candidateNeedsRollback(service([{ revisionName: 'metrics-unsafe', percent: 100 }]), 'metrics-unsafe=100', 'metrics-candidate'), false);
assert.equal(candidateNeedsRollback(service([{ revisionName: 'metrics-candidate', percent: 100 }]), 'metrics-safe=100', 'metrics-candidate'), true);
assert.equal(candidateNeedsRollback(service([{ revisionName: 'metrics-safe', percent: 80 }, { revisionName: 'metrics-candidate', percent: 20 }]), 'metrics-safe=100', 'metrics-candidate'), true);
assert.equal(candidateNeedsRollback(changedByOperator, 'metrics-unsafe=100', undefined), false);
assert.throws(() => candidateNeedsRollback(service([{ revisionName: 'metrics-candidate', percent: 20 }]), 'metrics-safe=100', 'metrics-candidate'));
console.log(JSON.stringify({ ok: true, checks: ['single-revision', 'canary-split', 'invalid-state', 'preserve-operator-rollback', 'restore-serving-failed-candidate'] }));
