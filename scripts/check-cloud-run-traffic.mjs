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
const production = workflow.split('\n  deploy-nonproduction:')[0];
const releaseProbes = [
  'node scripts/check-release-bigquery-off.mjs',
  'gcloud builds submit',
  'gcloud run deploy',
  'node scripts/check-release-bigquery-off.mjs "${IMAGE}"',
  'npm run test:prod:auth',
  'bash scripts/run-release-api-phase.sh bigquery-off',
];
let previous = -1;
for (const invocation of releaseProbes) {
  const at = production.indexOf(invocation, previous + 1);
  assert.ok(at > previous, `Missing or out-of-order verification step: ${invocation}`);
  previous = at;
}
const authAt = production.lastIndexOf('uses: google-github-actions/auth@v2', previous);
assert.ok(authAt > production.indexOf('npm run test:prod:auth'), 'Signed API checks require renewed cloud authority');
const authBlock = production.slice(authAt, previous);
assert.match(authBlock, /workload_identity_provider: \$\{\{ env\.WORKLOAD_IDENTITY_PROVIDER \}\}/);
assert.match(authBlock, /service_account: \$\{\{ env\.DEPLOY_SERVICE_ACCOUNT \}\}/);
assert.deepEqual(phaseScript.match(/^node .*$/gm), [
  'node --import ./scripts/release-auth-fetch.mjs scripts/check-public-analytics-contract.mjs --bigquery-off',
]);
assert.doesNotMatch(production + phaseScript, /\bbq\s+query\b|\bBQ_JOB_PROJECT\b|check-one-.*(?:kpis|reconciliation)\.mjs/);
assert.match(phaseScript, /set -euo pipefail/);
assert.doesNotMatch(phaseScript, /--skip-gcp|\|\| true|>>[^\n]*GITHUB_ENV/);
assert.doesNotMatch(workflow, /access_token_lifetime:|credentials_json:/);
console.log(JSON.stringify({ ok: true, checks: ['single-revision', 'canary-split', 'invalid-state', 'zero-traffic-workflow-never-overwrites-operator-allocation', 'signed-release-probe-renews-cloud-authority', 'bigquery-off-release-probe'] }));
