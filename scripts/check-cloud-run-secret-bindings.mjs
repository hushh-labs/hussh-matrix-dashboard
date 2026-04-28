#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const PROJECT_ID = process.env.PROJECT_ID || process.env.GCP_PROJECT_ID || 'hushh-ai-prod';
const REGION = process.env.REGION || 'us-central1';
const SERVICE = process.env.SERVICE || 'hushh-matrix-dashboard';

function isRunnable(command) {
  try {
    execFileSync(command, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const GCLOUD_BIN = process.env.GCLOUD_BIN || (isRunnable('gcloud') ? 'gcloud' : [
  `${process.env.HOME || ''}/google-cloud-sdk/bin/gcloud`,
  '/opt/homebrew/bin/gcloud',
  '/usr/local/bin/gcloud',
].find((candidate) => existsSync(candidate)) || 'gcloud');

const EXPECTED_SECRET_ENV = [
  'NODE_ENV',
  'APP_URL',
  'BQ_JOB_PROJECT',
  'BQ_CLI_FALLBACK',
  'HUSHHTECH_ANALYTICS_ENDPOINT',
  'HUSHHTECH_CLOUD_RUN_REGION',
  'HUSHHTECH_CLOUD_RUN_SERVICE',
  'HUSHHTECH_GCP_PROJECT',
  'HUSHHTECH_METRICS_WINDOW_DAYS',
  'HUSHHTECH_SEARCH_CONSOLE_DATA_STATE',
  'HUSHHTECH_SEARCH_CONSOLE_ROW_LIMIT',
  'HUSHHTECH_SEARCH_CONSOLE_SITE_URL',
  'HUSHHTECH_SEARCH_CONSOLE_TYPE',
  'HUSHHTECH_SEARCH_DATASET',
  'HUSHHTECH_SEARCH_PROJECT',
  'HUSHHTECH_SUPABASE_ACCESS_TOKEN',
  'HUSHHTECH_SUPABASE_PROJECT_REF',
  'KAI_GA4_WINDOW_DAYS',
  'KAI_PROD_GA4_PROJECT',
  'KAI_PROD_GA4_DATASET',
  'KAI_PROD_GCP_PROJECT',
  'KAI_PROD_CLOUD_RUN_SERVICE',
  'KAI_PROD_METRICS_WINDOW_DAYS',
  'HUSHH_AI_GCP_PROJECT',
  'HUSHH_AI_CLOUD_RUN_SERVICE',
  'HUSHH_AI_METRICS_WINDOW_DAYS',
  'HUSHH_AI_SEARCH_PROJECT',
  'HUSHH_AI_SEARCH_DATASET',
  'HUSHH_AI_LIVE_REFRESH_SECONDS',
];

function readService() {
  const output = execFileSync(
    GCLOUD_BIN,
    ['run', 'services', 'describe', SERVICE, '--project', PROJECT_ID, '--region', REGION, '--format=json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return JSON.parse(output);
}

function serviceContainers(service) {
  return (
    service.spec?.template?.spec?.containers ??
    service.template?.spec?.containers ??
    service.template?.containers ??
    []
  );
}

function secretRefFor(envVar) {
  return envVar?.valueFrom?.secretKeyRef ?? envVar?.valueSource?.secretKeyRef ?? null;
}

function secretRefName(ref) {
  return ref?.name ?? ref?.secret ?? ref?.secretId ?? null;
}

let service;
try {
  service = readService();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    checkedAt: new Date().toISOString(),
    target: `${PROJECT_ID}/${REGION}/${SERVICE}`,
    error: error instanceof Error ? error.message : String(error),
    hint: 'Install gcloud, add it to PATH, or set GCLOUD_BIN to the gcloud executable.',
  }, null, 2));
  process.exit(1);
}
const envVars = serviceContainers(service).flatMap((container) => container.env ?? []);
const envByName = new Map(envVars.map((envVar) => [envVar.name, envVar]));

const results = EXPECTED_SECRET_ENV.map((name) => {
  const envVar = envByName.get(name);
  const ref = secretRefFor(envVar);
  if (!envVar) return { check: name, status: 'fail', detail: 'missing env var' };
  if (!secretRefName(ref)) return { check: name, status: 'fail', detail: 'not backed by Secret Manager' };
  return { check: name, status: 'ok', detail: secretRefName(ref) };
});

const latestReadyRevision =
  service.status?.latestReadyRevisionName ??
  service.status?.latestCreatedRevisionName ??
  service.status?.traffic?.find((entry) => entry.percent === 100)?.revisionName ??
  null;

const summary = {
  ok: results.every((result) => result.status === 'ok'),
  checkedAt: new Date().toISOString(),
  target: `${PROJECT_ID}/${REGION}/${SERVICE}`,
  latestReadyRevision,
  results,
};

console.log(JSON.stringify(summary, null, 2));

if (!summary.ok) process.exit(1);
