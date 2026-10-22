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
const phaseScript = readFileSync(new URL('./run-release-api-phase.sh', import.meta.url), 'utf8');
let previousPhase = -1;
for (const invocation of ['bash scripts/run-release-api-phase.sh core', 'bash scripts/run-release-api-phase.sh customers', 'bash scripts/run-release-api-phase.sh contracts', 'node scripts/check-one-metrics-reconciliation.mjs --skip-dashboard']) {
  const at = workflow.indexOf(invocation);
  assert.ok(at > previousPhase, 'All verification phases must remain in order');
  const authAt = workflow.lastIndexOf('uses: google-github-actions/auth@v2', at);
  assert.ok(authAt > previousPhase, 'Each verification phase needs renewed cloud authority');
  const authBlock = workflow.slice(authAt, at);
  assert.match(authBlock, /workload_identity_provider: \$\{\{ env\.WORKLOAD_IDENTITY_PROVIDER \}\}/);
  assert.match(authBlock, /service_account: \$\{\{ env\.DEPLOY_SERVICE_ACCOUNT \}\}/);
  previousPhase = at;
}
const actualProbes = [...phaseScript.matchAll(/^\s+node scripts\/(\S+)/gm)].map(match => match[1]).sort();
assert.deepEqual(actualProbes, [
  'check-metrics-flow.mjs', 'check-hushh-ai-production.mjs', 'check-one-production.mjs', 'check-one-location-analytics-contract.mjs',
  'check-one-metrics-reconciliation.mjs', 'check-one-ios-account-kpis.mjs', 'check-one-ios-usage-kpis.mjs', 'check-one-platform-kpis.mjs',
  'check-one-registered-accounts-reconciliation.mjs', 'check-dashboard-kpi-invariants.mjs', 'check-public-analytics-contract.mjs',
  'check-founder-briefing-contract.mjs', 'check-founder-briefing-contract.mjs', 'check-founder-briefing-contract.mjs',
].sort());
assert.match(phaseScript, /--days 30 --require-global/);
assert.match(phaseScript, /--start-date 2026-08-01 --end-date 2026-08-31/);
assert.match(phaseScript, /--start-date 2026-06-24 --end-date 2026-09-21/);
assert.match(phaseScript, /set -euo pipefail/);
assert.doesNotMatch(phaseScript, /--skip-gcp|\|\| true|>>[^\n]*GITHUB_ENV/);
assert.doesNotMatch(workflow, /access_token_lifetime:|credentials_json:/);
console.log(JSON.stringify({ ok: true, checks: ['single-revision', 'canary-split', 'invalid-state', 'zero-traffic-workflow-never-overwrites-operator-allocation', 'renewed-same-identity-per-verification-phase', 'all-14-protected-probes-retained'] }));
