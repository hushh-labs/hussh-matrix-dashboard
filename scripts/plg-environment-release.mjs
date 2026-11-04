import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const targets = {
  dev: { project: 'hushh-pda-dev', number: '621416509462' },
  uat: { project: 'hushh-pda-uat', number: '745506018753' },
};
const service = 'hushh-matrix-dashboard';
const region = 'us-central1';
const requiredJobs = ['verify', 'verify-plg-storage', 'verify-plg-infrastructure'];
const secretNames = {
  GOOGLE_CLIENT_SECRET: 'metrics-dashboard-google-client-secret',
  SESSION_SECRET: 'metrics-dashboard-session-secret',
  ALLOWED_EMAILS: 'metrics-dashboard-allowed-emails',
};

export function environmentTarget(environment) {
  assert(Object.hasOwn(targets, environment), 'Only Dev/UAT are admitted by this release owner.');
  const target = targets[environment];
  return { ...target, environment, service, region,
    origin: `https://${service}-${target.number}.${region}.run.app`,
    runtime: `matrix-runtime@${target.project}.iam.gserviceaccount.com`,
    deployer: `matrix-deployer@${target.project}.iam.gserviceaccount.com` };
}

export function assertSourceCi(run, jobs, sha) {
  assert(/^[a-f0-9]{40}$/.test(sha), 'Exact source SHA required.');
  assert(run.repository?.full_name === 'hushh-labs/hussh-matrix-dashboard' &&
    run.path === '.github/workflows/responsive-ui.yml' && run.event === 'pull_request' &&
    run.head_sha === sha && run.status === 'completed' && run.conclusion === 'success',
  'Current-source canonical PR CI must have passed.');
  assert(jobs.total_count === jobs.jobs?.length, 'Incomplete CI job listing.');
  for (const name of requiredJobs) {
    const matches = jobs.jobs.filter(job => job.name === name);
    assert(matches.length === 1 && matches[0].status === 'completed' && matches[0].conclusion === 'success',
      `Required CI job not accepted: ${name}`);
  }
}

export function devRuntimeImage(run, receipt, source, runId) {
  assert(/^[a-f0-9]{40}$/.test(source) && /^[0-9]+$/.test(String(runId)), 'Exact Dev source/run required.');
  assert(run.repository?.full_name === 'hushh-labs/hussh-matrix-dashboard' &&
    run.path === '.github/workflows/deploy-main.yml' && run.event === 'workflow_dispatch' &&
    run.head_branch === 'main' && run.status === 'completed' && run.conclusion === 'success' &&
    String(run.id) === String(runId), 'Canonical Dev run has not passed.');
  assert(receipt.environment === 'dev' && receipt.project === 'hushh-pda-dev' && receipt.source === source &&
    receipt.runtimeVerified === true && String(receipt.workflowRun) === String(runId) &&
    receipt.origin === environmentTarget('dev').origin, 'Dev runtime receipt does not bind this source/run.');
  assert(/^us-central1-docker\.pkg\.dev\/hushh-pda-dev\/matrix-images\/hushh-matrix-dashboard@sha256:[a-f0-9]{64}$/.test(receipt.image),
    'Dev image digest is missing.');
  return receipt.image;
}

/** Produces references only. OAuth setup and secret versions must already exist. */
export function environmentService({ environment, source, image, clientId, versions, readEnabled = false }) {
  const target = environmentTarget(environment), prefix = `PLG_${environment.toUpperCase()}`;
  assert(/^[a-f0-9]{40}$/.test(source), 'Exact source SHA required.');
  assert(/^us-central1-docker\.pkg\.dev\/hushh-pda-dev\/matrix-images\/hushh-matrix-dashboard@sha256:[a-f0-9]{64}$/.test(image),
    'Promote the immutable Dev-built image; tags and other registries are refused.');
  assert(/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(clientId), 'Verified OAuth client ID required.');
  assert(typeof readEnabled === 'boolean', 'Read activation must be explicit.');
  const names = { ...secretNames, [`${prefix}_SOURCE_SECRET`]: 'metrics-one-plg-owner-source-secret',
    [`${prefix}_OWNER_EMAIL_HASHES`]: 'metrics-one-plg-owner-email-hashes' };
  assert(versions && Object.keys(versions).length === Object.keys(names).length &&
    Object.keys(versions).every(key => Object.values(names).includes(key)), 'Exact secret-version map required.');
  /** @type {Array<{name: string, value?: string, valueFrom?: {secretKeyRef: {name: string, key: string}}}>} */
  const env = Object.entries(names).map(([name, secret]) => {
    assert(/^[1-9][0-9]*$/.test(String(versions[secret])), `Pin an enabled numeric version for ${secret}.`);
    return { name, valueFrom: { secretKeyRef: { name: secret, key: String(versions[secret]) } } };
  });
  const plain = { GOOGLE_CLOUD_PROJECT: target.project, GOOGLE_CLIENT_ID: clientId,
    GOOGLE_REDIRECT_URI: `${target.origin}/auth/callback`, REQUIRE_AUTH: 'true', ALLOW_PUBLIC_DASHBOARD: 'false',
    ALLOWED_EMAIL_DOMAINS: 'hushh.ai', [`${prefix}_RUNTIME`]: environment,
    [`${prefix}_IDENTITY_MODE`]: 'live-signed', [`${prefix}_EVIDENCE_ENABLED`]: String(readEnabled),
    PLG_ENABLED: 'false', PLG_DELIVERY_ENABLED: 'false', PLG_ATTEMPT_EMAIL_ENABLED: 'false',
    PLG_GOOGLE_MAIL_ENABLED: 'false', PLG_GOOGLE_MAIL_CAMPAIGNS_ENABLED: 'false', INSTAGRAM_ANALYTICS_ENABLED: 'false' };
  env.push(...Object.entries(plain).map(([name, value]) => ({ name, value })));
  return { apiVersion: 'serving.knative.dev/v1', kind: 'Service', metadata: { name: service,
    labels: { 'plg-environment': environment, 'source-sha': source } }, spec: {
    template: { metadata: { labels: { 'plg-environment': environment, 'source-sha': source },
      annotations: { 'autoscaling.knative.dev/maxScale': '2' } }, spec: { serviceAccountName: target.runtime,
      containers: [{ image, ports: [{ containerPort: 8080 }], env,
        resources: { limits: { cpu: '1', memory: '1Gi' } } }] } },
    traffic: [{ latestRevision: true, percent: 100 }],
  } };
}

export function assertEnvironmentRevision(revision, expected) {
  assert(revision.status?.conditions?.some(c => c.type === 'Ready' && c.status === 'True'), 'Revision is not Ready.');
  const actual = revision.spec, wanted = expected.spec.template.spec;
  assert(actual?.serviceAccountName === wanted.serviceAccountName, 'Runtime identity mismatch.');
  assert(revision.metadata?.labels?.['source-sha'] === expected.metadata.labels['source-sha'], 'Source label mismatch.');
  assert(revision.metadata?.labels?.['plg-environment'] === expected.metadata.labels['plg-environment'], 'Environment mismatch.');
  assert(actual.containers?.length === 1 && actual.containers[0].image === wanted.containers[0].image, 'Image digest mismatch.');
  const entries = actual.containers[0].env ?? [];
  assert(entries.length === wanted.containers[0].env.length, 'Unexpected runtime configuration.');
  for (const entry of wanted.containers[0].env) {
    const found = entries.filter(item => item.name === entry.name);
    assert(found.length === 1, `Missing or duplicate runtime setting: ${entry.name}`);
    assert.deepEqual(found[0], entry, `Runtime setting mismatch: ${entry.name}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, ...args] = process.argv.slice(2);
  const json = path => JSON.parse(readFileSync(path, 'utf8'));
  if (mode === 'ci') assertSourceCi(json(args[0]), json(args[1]), args[2]);
  else if (mode === 'service') writeFileSync(args[1], JSON.stringify(environmentService(json(args[0])), null, 2));
  else if (mode === 'revision') assertEnvironmentRevision(json(args[0]), json(args[1]));
  else if (mode === 'target') process.stdout.write(JSON.stringify(environmentTarget(args[0])));
  else throw new Error('Unknown release command.');
}
