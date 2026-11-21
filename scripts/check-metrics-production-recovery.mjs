import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatTrafficTargets } from './capture-cloud-run-traffic.mjs';
import { retainedNames } from './lib/metrics-retained-report-settings.mjs';

// Read-only preflight for recovering the existing candidate. Standard release
// checks still qualify the deployed revision, OAuth and signed dashboard APIs.
const uatFlags = new Map([
  ['PLG_UAT_VIEW_ENABLED', 'true'],
  ['PLG_UAT_AUDIENCE_ENABLED', 'true'],
  ['PLG_UAT_EVIDENCE_ENABLED', 'true'],
  ['PLG_UAT_IDENTITY_MODE', 'live-signed'],
]);
const uatSecrets = new Map([
  ['PLG_UAT_SOURCE_SECRET', 'metrics-one-plg-uat-source-secret'],
  ['PLG_UAT_AUDIENCE_SECRET', 'metrics-one-plg-uat-audience-secret'],
]);

function envMap(containers, label) {
  assert(Array.isArray(containers) && containers.length === 1, `${label} must have one dashboard container.`);
  const entries = containers[0].env ?? [];
  assert(Array.isArray(entries), `${label} has no readable runtime environment.`);
  const byName = new Map(entries.map(entry => [entry?.name, entry]));
  assert.equal(byName.size, entries.length, `${label} has duplicate runtime bindings.`);
  assert(entries.every(entry => typeof entry?.name === 'string'), `${label} has an invalid runtime binding.`);
  return byName;
}

function secretRef(entry) {
  if (entry?.value !== undefined) return null;
  const ref = entry?.valueFrom?.secretKeyRef;
  return typeof ref?.name === 'string' && ref.name.length && typeof ref.key === 'string' && ref.key.length ? ref : null;
}

function check({ service, candidate, expectedImage, expectedTraffic }) {
  assert(service?.metadata?.name === 'hushh-matrix-dashboard', 'Unexpected Cloud Run service.');
  assert(typeof expectedImage === 'string' && /^us-central1-docker\.pkg\.dev\/hushh-ai-prod\/website-images\/hushh-matrix-dashboard@sha256:[a-f0-9]{64}$/.test(expectedImage),
    'Expected the reviewed dashboard image by digest.');
  const traffic = formatTrafficTargets(service);
  assert(typeof expectedTraffic === 'string' && traffic === expectedTraffic, 'Serving traffic differs from the captured rollback allocation.');
  const candidates = service.status.traffic.filter(entry => entry.tag === 'release-candidate');
  assert(candidates.length === 1, 'Expected one release-candidate traffic tag.');
  const [tag] = candidates;
  const revision = candidate?.metadata?.name;
  assert(typeof revision === 'string' && revision.startsWith('hushh-matrix-dashboard-')
    && tag.revisionName === revision && service.status.latestReadyRevisionName === revision,
  'Expected the exact tagged, latest ready candidate revision.');
  assert(service.status.traffic.every(entry => entry.revisionName !== revision || Number(entry.percent ?? 0) === 0),
    'Candidate must be at zero traffic.');
  assert(candidate.status?.conditions?.some(condition => condition.type === 'Ready' && condition.status === 'True'), 'Candidate is not ready.');

  const template = service.spec?.template?.spec;
  const env = envMap(candidate.spec?.containers, 'Candidate');
  const templateEnv = envMap(template?.containers, 'Service template');
  assert(candidate.spec.containers[0].image === expectedImage && template.containers[0].image === expectedImage,
    'Candidate and service template must use the reviewed image digest.');
  assert(candidate.spec.serviceAccountName === 'metrics-dashboard-runtime@hushh-ai-prod.iam.gserviceaccount.com'
    && template.serviceAccountName === candidate.spec.serviceAccountName, 'Unexpected runtime identity.');

  const failures = [];
  for (const [label, config] of [['candidate', env], ['service template', templateEnv]]) {
    const bigquery = config.get('METRICS_BIGQUERY_ENABLED');
    if (bigquery?.value !== 'false' || bigquery.valueFrom) failures.push(`${label}: BigQuery must be explicitly off`);
    const retained = retainedNames.filter(name => !secretRef(config.get(name)));
    if (retained.length) failures.push(`${label}: missing Secret Manager references for ${retained.join(', ')}`);
    for (const [name, expected] of uatFlags) {
      if (config.get(name)?.value !== expected || config.get(name)?.valueFrom) failures.push(`${label}: ${name} differs from serving UAT settings`);
    }
    for (const [name, expected] of uatSecrets) {
      if (secretRef(config.get(name))?.name !== expected) failures.push(`${label}: ${name} must reference the existing UAT read key`);
    }
  }
  for (const name of [...retainedNames, ...uatSecrets.keys()]) {
    const actual = secretRef(env.get(name));
    const intended = secretRef(templateEnv.get(name));
    if (actual && intended && (actual.name !== intended.name || actual.key !== intended.key)) failures.push(`${name}: candidate and template references differ`);
  }
  return { ok: failures.length === 0, revision, traffic, retainedSettings: retainedNames.length, failures };
}

try {
  const result = check(JSON.parse(readFileSync(0, 'utf8')));
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof SyntaxError ? 'Invalid JSON input.' : error.message);
  process.exitCode = 1;
}
