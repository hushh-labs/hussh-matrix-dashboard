#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_PROJECT = 'hushh-ai-prod';
const DEFAULT_REGION = 'us-central1';
const DEFAULT_SERVICE = 'hushh-matrix-dashboard';
const DEFAULT_BASE_URL = 'https://metrics.hussh.ai';
const SECRET_NAME = 'hushh-gemini-api-key';
const RUNTIME_SERVICE_ACCOUNT = 'metrics-dashboard-runtime@hushh-ai-prod.iam.gserviceaccount.com';

function parseArgs(argv) {
  const options = {
    project: process.env.GCP_PROJECT || DEFAULT_PROJECT,
    region: process.env.GCP_REGION || DEFAULT_REGION,
    service: process.env.CLOUD_RUN_SERVICE || DEFAULT_SERVICE,
    baseUrl: process.env.METRICS_DASHBOARD_URL || DEFAULT_BASE_URL,
    timeoutMs: 20_000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--project' && argv[index + 1]) {
      options.project = argv[index + 1];
      index += 1;
    } else if (arg === '--region' && argv[index + 1]) {
      options.region = argv[index + 1];
      index += 1;
    } else if (arg === '--service' && argv[index + 1]) {
      options.service = argv[index + 1];
      index += 1;
    } else if (arg === '--base-url' && argv[index + 1]) {
      options.baseUrl = argv[index + 1];
      index += 1;
    } else if (arg === '--timeout-ms' && argv[index + 1]) {
      const parsed = Number(argv[index + 1]);
      if (Number.isFinite(parsed) && parsed > 0) options.timeoutMs = parsed;
      index += 1;
    }
  }

  return options;
}

function assert(condition, message, details = undefined) {
  if (!condition) throw new Error(details ? `${message}: ${details}` : message);
}

async function gcloudJson(args) {
  const { stdout } = await execFileAsync('gcloud', ['--quiet', ...args, '--format=json'], {
    timeout: 60_000,
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, CLOUDSDK_CORE_DISABLE_PROMPTS: '1' },
  });
  return JSON.parse(stdout);
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      cache: 'no-store',
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function findEnv(env, name) {
  return env.find((item) => item.name === name);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const results = [];

  const secret = await gcloudJson(['secrets', 'describe', SECRET_NAME, '--project', options.project]);
  assert(secret.name?.endsWith(`/secrets/${SECRET_NAME}`), 'Gemini Secret Manager secret missing');
  results.push({ check: 'secret-exists', status: 'ok', detail: SECRET_NAME });

  const versions = await gcloudJson(['secrets', 'versions', 'list', SECRET_NAME, '--project', options.project, '--limit', '5']);
  assert(Array.isArray(versions) && versions.some((version) => version.state === 'ENABLED'), 'Gemini secret has no enabled version');
  results.push({ check: 'secret-version', status: 'ok', detail: 'enabled version present' });

  const policy = await gcloudJson(['secrets', 'get-iam-policy', SECRET_NAME, '--project', options.project]);
  const accessors = (policy.bindings ?? [])
    .filter((binding) => binding.role === 'roles/secretmanager.secretAccessor')
    .flatMap((binding) => binding.members ?? []);
  const expectedMember = `serviceAccount:${RUNTIME_SERVICE_ACCOUNT}`;
  assert(accessors.includes(expectedMember), 'runtime service account cannot access Gemini secret');
  const unexpectedAccessors = accessors.filter((member) => member !== expectedMember);
  assert(unexpectedAccessors.length === 0, 'unexpected secret-level Gemini secret accessors', unexpectedAccessors.join(', '));
  results.push({ check: 'secret-iam', status: 'ok', detail: expectedMember });

  const service = await gcloudJson([
    'run',
    'services',
    'describe',
    options.service,
    '--project',
    options.project,
    '--region',
    options.region,
  ]);
  const container = service.spec?.template?.spec?.containers?.[0] ?? {};
  const env = container.env ?? [];
  const geminiKey = findEnv(env, 'GEMINI_API_KEY');
  assert(geminiKey?.valueFrom?.secretKeyRef?.name === SECRET_NAME, 'GEMINI_API_KEY is not wired to the expected secret');
  assert(geminiKey?.valueFrom?.secretKeyRef?.key === 'latest', 'GEMINI_API_KEY does not read the latest secret version');
  assert(!geminiKey.value, 'GEMINI_API_KEY is configured as a plain value');
  assert(!findEnv(env, 'OPENAI_API_KEY'), 'OPENAI_API_KEY should not be configured');
  assert(!findEnv(env, 'OPENAI_METRICS_CHAT_MODEL'), 'OPENAI_METRICS_CHAT_MODEL should not be configured');
  const geminiModel = findEnv(env, 'GEMINI_METRICS_CHAT_MODEL');
  assert(!geminiModel || geminiModel.value === 'gemini-2.5-flash', 'GEMINI_METRICS_CHAT_MODEL default mismatch');
  assert(findEnv(env, 'METRICS_CHAT_RATE_LIMIT_HOURLY')?.value === '60', 'hourly chat rate limit mismatch');
  assert(findEnv(env, 'METRICS_CHAT_RATE_LIMIT_DAILY')?.value === '300', 'daily chat rate limit mismatch');
  results.push({
    check: 'cloud-run-env',
    status: 'ok',
    detail: service.status?.latestReadyRevisionName ?? 'revision unknown',
  });

  const healthResponse = await fetchWithTimeout(`${options.baseUrl.replace(/\/$/, '')}/api/health`, options.timeoutMs);
  assert(healthResponse.ok, `/api/health returned HTTP ${healthResponse.status}`);
  const healthText = await healthResponse.text();
  assert(!/OPENAI_API_KEY|GEMINI_API_KEY|metrics-dashboard-openai-api-key|hushh-gemini-api-key|sk-[A-Za-z0-9_-]+|AIza[A-Za-z0-9_-]{30,}/i.test(healthText), '/api/health exposes chat secret configuration');
  results.push({ check: 'health-redaction', status: 'ok', detail: '/api/health does not expose chat config' });

  console.log(JSON.stringify({
    ok: true,
    checkedAt: new Date().toISOString(),
    project: options.project,
    service: options.service,
    results,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    checkedAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exit(1);
});
