#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_DASHBOARD_URL = 'https://metrics.hushh.ai';
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_PROJECT = 'hushh-ai-prod';
const DEFAULT_REGION = 'us-central1';
const REQUIRED_CARD_KEYS = ['search_console', 'ga4', 'product_events'];
const REQUIRED_FALLBACK_TABLES = ['site_daily', 'query_daily', 'page_daily', 'country_daily', 'device_daily'];

function parseArgs(argv) {
  const options = {
    dashboardUrl: normalizeOrigin(process.env.METRICS_DASHBOARD_URL || DEFAULT_DASHBOARD_URL),
    timeoutMs: numberFromEnv('METRICS_FLOW_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
    project: process.env.METRICS_DASHBOARD_GCP_PROJECT || DEFAULT_PROJECT,
    region: process.env.METRICS_DASHBOARD_CLOUD_RUN_REGION || DEFAULT_REGION,
    skipGcp: process.env.METRICS_FLOW_SKIP_GCP === 'true',
    fallbackDatasets: [
      process.env.HUSHH_AI_SEARCH_FALLBACK_DATASET || 'hushh_ai_search_console_api',
      process.env.KAI_SEARCH_FALLBACK_DATASET || 'kai_search_console_api',
      process.env.HUSHHTECH_SEARCH_FALLBACK_DATASET || 'hushhtech_search_console_api',
    ],
    jobs: [
      process.env.HUSHH_AI_SEARCH_INGEST_JOB || 'hushh-ai-search-console-ingest',
      process.env.KAI_SEARCH_INGEST_JOB || 'kai-search-console-ingest',
      process.env.HUSHHTECH_SEARCH_INGEST_JOB || 'hushhtech-search-console-ingest',
    ],
    schedulers: [
      process.env.HUSHH_AI_SEARCH_SCHEDULER_JOB || 'hushh-ai-search-console-ingest-daily',
      process.env.KAI_SEARCH_SCHEDULER_JOB || 'kai-search-console-ingest-daily',
      process.env.HUSHHTECH_SEARCH_SCHEDULER_JOB || 'hushhtech-search-console-ingest-daily',
    ],
    oauthSecret: process.env.SEARCH_CONSOLE_OAUTH_SECRET || 'metrics-dashboard-search-console-oauth',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dashboard-url' && argv[index + 1]) {
      options.dashboardUrl = normalizeOrigin(argv[index + 1]);
      index += 1;
    } else if (arg === '--timeout-ms' && argv[index + 1]) {
      options.timeoutMs = parsePositiveInt(argv[index + 1], options.timeoutMs);
      index += 1;
    } else if (arg === '--skip-gcp') {
      options.skipGcp = true;
    }
  }

  return options;
}

function isLocalDashboard(origin) {
  const hostname = new URL(origin).hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function numberFromEnv(name, fallback) {
  return parsePositiveInt(process.env[name], fallback);
}

function normalizeOrigin(rawUrl) {
  const url = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);
  return url.origin;
}

function assert(condition, message, details = undefined) {
  if (!condition) throw new Error(details ? `${message}: ${details}` : message);
}

function result(check, status, detail, extra = undefined) {
  return extra == null ? { check, status, detail } : { check, status, detail, ...extra };
}

function hasNoStore(response) {
  const cacheControl = response.headers.get('cache-control') || '';
  return cacheControl.includes('no-store') || cacheControl.includes('no-cache');
}

function assertNoSensitivePayload(body, label) {
  const text = JSON.stringify(body);
  const patterns = [
    /eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/,
    /AIza[0-9A-Za-z_-]{20,}/,
    /sk-[0-9A-Za-z_-]{20,}/,
    /gho_[0-9A-Za-z]{20,}/,
    /ghp_[0-9A-Za-z]{20,}/,
    /refresh_token/i,
    /client_secret/i,
  ];
  const matched = patterns.find((pattern) => pattern.test(text));
  assert(!matched, `${label} payload appears to contain a raw secret`);
}

function assertPublicSafePayload(body, label) {
  const text = JSON.stringify(body);
  const unsafePattern = /sourceDataset|sourceProjectId|sourceProjectRef|sourceTable|analytics_\d+|searchconsole_|hushh_search_console|_search_console_api|hushh-ai-(?:prod|uat)|hushh-pda|ibsisfnjxeowvdtvgzff/i;
  assert(!unsafePattern.test(text), `${label} payload exposes unsafe source identifiers`);
  const rawProviderMarkupPattern = /<\/?(html|head|body|script|style|title|table|font|div|p|h1)\b/i;
  assert(!rawProviderMarkupPattern.test(text), `${label} payload exposes raw provider markup`);
}

function assertSourceCardMetric(card, key) {
  assert(card, `source card missing for metric ${key}`);
  assert(Array.isArray(card.metrics), `${card.key || 'source'} metrics missing`);
  assert(card.metrics.some((metric) => metric.key === key), `${card.key || 'source'} missing metric ${key}`);
}

function assertGa4Sections(card, label) {
  assertSourceSections(card, label, 'GA4', ['realtime', 'last_24_hours', 'last_7_days', 'selected_total']);
}

function assertSearchConsoleSections(card, label) {
  assertSourceSections(card, label, 'Search Console', ['last_24_hours', 'last_7_days', 'selected_total']);
}

function assertSearchConsoleFreshness(card, label) {
  if (!card || card.status === 'waiting' || card.status === 'not_configured') return;
  const sections = Array.isArray(card.sections) ? card.sections : [];
  for (const section of sections) {
    assert(!section.blocker, `${label} Search Console ${section.key} should not show a blocker when data is available`, String(section.blocker || ''));
    assert(Array.isArray(section.metrics) && section.metrics.length >= 4, `${label} Search Console ${section.key} should expose clicks/impressions/CTR/position`);
    assert(section.freshness?.generatedAt, `${label} Search Console ${section.key} missing refresh timestamp`);
    assert(/data date|latest data/.test(String(section.source || '')), `${label} Search Console ${section.key} missing latest data date in source`);
  }
}

function assertSourceSections(card, label, sourceLabel, requiredKeys) {
  assert(card, `${label} ${sourceLabel} source card missing`);
  const sections = Array.isArray(card.sections) ? card.sections : [];
  for (const key of requiredKeys) {
    const section = sections.find((item) => item.key === key);
    assert(section, `${label} ${sourceLabel} missing ${key} section`);
    assert(Array.isArray(section.metrics) && section.metrics.length > 0, `${label} ${sourceLabel} ${key} section has no metrics`);
  }
}

function assertProductEventsLive(card, label) {
  assert(card, `${label} product-events card missing`);
  assert(card.status === 'live', `${label} product-events should be live`, String(card.status || 'missing'));
  for (const key of ['total_events', 'dau', 'product_events', 'chat_events']) {
    assertSourceCardMetric(card, key);
  }
  assertSourceSections(card, label, 'product-events', ['last_24_hours', 'last_7_days', 'selected_total']);
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      signal: controller.signal,
    });
    const text = await response.text();
    assert(response.ok, `${url} returned HTTP ${response.status}`, text.slice(0, 500));
    return { response, body: JSON.parse(text) };
  } finally {
    clearTimeout(timeout);
  }
}

async function execJson(command, args, timeoutMs) {
  const { stdout } = await execFileAsync(command, args, { timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024 });
  return parseJsonOutput(stdout);
}

function parseJsonOutput(stdout) {
  const trimmed = String(stdout || '').trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const jsonStart = trimmed.search(/[\[{]/);
    if (jsonStart > 0) return JSON.parse(trimmed.slice(jsonStart));
    throw error;
  }
}

async function queryBigQuery(project, sql, timeoutMs) {
  return execJson('bq', [
    `--project_id=${project}`,
    'query',
    '--use_legacy_sql=false',
    '--format=json',
    sql,
  ], timeoutMs);
}

function assertSourceCards(cards, label) {
  assert(Array.isArray(cards), `${label} sourceCards missing`);
  const keys = cards.map((card) => card.key).sort();
  assert(keys.length === REQUIRED_CARD_KEYS.length, `${label} should expose exactly three source cards`, keys.join(','));
  for (const key of REQUIRED_CARD_KEYS) {
    assert(keys.includes(key), `${label} missing ${key} source card`, keys.join(','));
  }
  for (const card of cards) {
    assert(typeof card.status === 'string' && card.status.length > 0, `${label} ${card.key} missing status`);
    assert(typeof card.source === 'string' && card.source.length > 0, `${label} ${card.key} missing source`);
    assert(card.freshness?.generatedAt, `${label} ${card.key} missing freshness.generatedAt`);
    assert(Array.isArray(card.metrics), `${label} ${card.key} metrics must be an array`);
  }
}

async function checkApiFlow(options) {
  const results = [];
  const health = await fetchJson(`${options.dashboardUrl}/api/health`, options.timeoutMs);
  assert(health.body?.status === 'ok', 'dashboard health is not ok');
  assert(health.body?.config?.hushhAiSearchConsoleFallback, 'health missing Hushh AI fallback config');
  assert(health.body?.config?.kaiSearchConsoleFallback, 'health missing Kai fallback config');
  assertPublicSafePayload(health.body, 'health');
  results.push(result('health-source-config', 'ok', 'fallback configs present'));

  const [hushhAi, hushhAiUat, kai, hushhTech, all] = await Promise.all([
    fetchJson(`${options.dashboardUrl}/api/analytics/hushhai?window_days=7`, options.timeoutMs),
    fetchJson(`${options.dashboardUrl}/api/analytics/hushhai/uat?window_days=7`, options.timeoutMs),
    fetchJson(`${options.dashboardUrl}/api/analytics/kai?window_days=7`, options.timeoutMs),
    fetchJson(`${options.dashboardUrl}/api/analytics/hushhtech?window_days=7`, options.timeoutMs),
    fetchJson(`${options.dashboardUrl}/api/analytics/all?window_days=7`, options.timeoutMs),
  ]);

  assert(hasNoStore(hushhAi.response), 'Hushh AI analytics endpoint is cacheable');
  assert(hasNoStore(hushhAiUat.response), 'Hushh AI UAT analytics endpoint is cacheable');
  assert(hasNoStore(kai.response), 'Kai analytics endpoint is cacheable');
  assert(hasNoStore(hushhTech.response), 'HushhTech analytics endpoint is cacheable');
  assertNoSensitivePayload(all.body, 'aggregate analytics');
  assertPublicSafePayload(hushhAi.body, 'Hushh AI analytics');
  assertPublicSafePayload(hushhAiUat.body, 'Hushh AI UAT analytics');
  assertPublicSafePayload(kai.body, 'Kai analytics');
  assertPublicSafePayload(hushhTech.body, 'HushhTech analytics');
  assertPublicSafePayload(all.body, 'aggregate analytics');

  assertSourceCards(hushhAi.body?.data?.sourceCards, 'Hushh AI');
  assertSourceCards(hushhAiUat.body?.data?.sourceCards, 'Hushh AI UAT');
  assertSourceCards(kai.body?.data?.sourceCards, 'Kai');
  assertSourceCards(hushhTech.body?.data?.sourceCards, 'HushhTech');
  assertSourceCards(all.body?.hushhAi?.data?.sourceCards, 'aggregate Hushh AI');
  assertSourceCards(all.body?.hushhAiUat?.data?.sourceCards, 'aggregate Hushh AI UAT');
  assertSourceCards(all.body?.kai?.productionProduct?.data?.sourceCards, 'aggregate Kai');
  assertSourceCards(all.body?.hushhTech?.data?.sourceCards, 'aggregate HushhTech');
  assert(!all.body?.hushhAi?.data?.supabase, 'aggregate Hushh AI incorrectly includes Supabase data');

  const kaiCards = kai.body.data.sourceCards;
  const kaiGa4 = kaiCards.find((card) => card.key === 'ga4');
  const kaiEvents = kaiCards.find((card) => card.key === 'product_events');
  assertGa4Sections(kaiGa4, 'Kai');
  for (const key of ['users', 'sessions', 'events']) assertSourceCardMetric(kaiGa4, key);
  for (const key of ['dau', 'wau', 'sessions', 'events']) assertSourceCardMetric(kaiEvents, key);

  for (const [label, body] of [
    ['Hushh AI', hushhAi.body?.data],
    ['Hushh AI UAT', hushhAiUat.body?.data],
    ['Kai', kai.body?.data],
    ['HushhTech', hushhTech.body?.data],
  ]) {
    const searchCard = body?.sourceCards?.find((card) => card.key === 'search_console');
    assert(searchCard, `${label} Search Console card missing`);
    for (const key of ['clicks', 'impressions', 'ctr', 'average_position']) {
      assertSourceCardMetric(searchCard, key);
    }
    assertSearchConsoleSections(searchCard, label);
    assertSearchConsoleFreshness(searchCard, label);
    assertGa4Sections(body?.sourceCards?.find((card) => card.key === 'ga4'), label);
  }

  const hushhAiEvents = hushhAi.body?.data?.sourceCards?.find((card) => card.key === 'product_events');
  const hushhAiUatEvents = hushhAiUat.body?.data?.sourceCards?.find((card) => card.key === 'product_events');
  const aggregateHushhAiEvents = all.body?.hushhAi?.data?.sourceCards?.find((card) => card.key === 'product_events');
  const aggregateHushhAiUatEvents = all.body?.hushhAiUat?.data?.sourceCards?.find((card) => card.key === 'product_events');
  assertProductEventsLive(hushhAiEvents, 'Hushh AI');
  assertProductEventsLive(hushhAiUatEvents, 'Hushh AI UAT');
  assertProductEventsLive(aggregateHushhAiEvents, 'aggregate Hushh AI');
  assertProductEventsLive(aggregateHushhAiUatEvents, 'aggregate Hushh AI UAT');

  const techCards = hushhTech.body.data.sourceCards;
  const techSearch = techCards.find((card) => card.key === 'search_console');
  const techEvents = techCards.find((card) => card.key === 'product_events');
  assert(['delayed', 'waiting'].includes(techSearch?.status), 'HushhTech Search Console status is invalid', String(techSearch?.status || ''));
  if (isLocalDashboard(options.dashboardUrl)) {
    results.push(result(
      'local-hushhtech-product-events',
      techEvents?.status === 'live' ? 'ok' : 'warn',
      `status=${techEvents?.status || 'missing'}; local runs may not have the Supabase token`,
    ));
  } else {
    assert(techEvents?.status === 'live', 'HushhTech product events/Supabase card is not live', String(techEvents?.status || ''));
  }
  for (const key of ['total_users', 'new_users', 'active_users', 'analytics_events']) {
    assertSourceCardMetric(techEvents, key);
  }

  results.push(result('three-source-api-contract', 'ok', 'all products expose search_console, ga4, product_events'));
  results.push(result('source-timeline-contract', 'ok', 'GA4 and Search Console expose required timeline sections'));
  results.push(result('source-boundaries', 'ok', 'Hushh AI has no Supabase; Kai uses UAT primary sources'));
  return results;
}

async function checkFallbackDataset(options, dataset) {
  const tables = await queryBigQuery(options.project, `
    SELECT table_name
    FROM \`${options.project}.${dataset}.INFORMATION_SCHEMA.TABLES\`
    WHERE table_name IN (${REQUIRED_FALLBACK_TABLES.map((name) => `'${name}'`).join(',')})
  `, options.timeoutMs);
  const tableNames = new Set(tables.map((row) => String(row.table_name)));
  for (const table of REQUIRED_FALLBACK_TABLES) {
    assert(tableNames.has(table), `${dataset}.${table} is missing`);
  }

  const rowCounts = await queryBigQuery(options.project, `
    SELECT 'site_daily' AS table_name, COUNT(*) AS row_count FROM \`${options.project}.${dataset}.site_daily\`
    UNION ALL SELECT 'query_daily', COUNT(*) FROM \`${options.project}.${dataset}.query_daily\`
    UNION ALL SELECT 'page_daily', COUNT(*) FROM \`${options.project}.${dataset}.page_daily\`
    UNION ALL SELECT 'country_daily', COUNT(*) FROM \`${options.project}.${dataset}.country_daily\`
    UNION ALL SELECT 'device_daily', COUNT(*) FROM \`${options.project}.${dataset}.device_daily\`
  `, options.timeoutMs);
  const totalRows = rowCounts.reduce((sum, row) => sum + Number(row.row_count || 0), 0);
  return result(
    `fallback-dataset-${dataset}`,
    totalRows > 0 ? 'ok' : 'warn',
    rowCounts.map((row) => `${row.table_name}:${row.row_count}`).join(', '),
  );
}

async function checkGcpFlow(options) {
  if (options.skipGcp) {
    return [result('gcp-flow', 'warn', 'skipped by --skip-gcp')];
  }

  const results = [];
  for (const dataset of options.fallbackDatasets) {
    results.push(await checkFallbackDataset(options, dataset));
  }

  for (const jobName of options.jobs) {
    const job = await execJson('gcloud', [
      'run',
      'jobs',
      'describe',
      jobName,
      `--project=${options.project}`,
      `--region=${options.region}`,
      '--format=json',
    ], options.timeoutMs);
    const ready = (job.status?.conditions || []).find((condition) => condition.type === 'Ready');
    assert(ready?.status === 'True', `${jobName} is not Ready`, ready?.message || JSON.stringify(job.status || {}));
    results.push(result(`cloud-run-job-${jobName}`, 'ok', 'Ready=True'));
  }

  for (const schedulerName of options.schedulers) {
    const scheduler = await execJson('gcloud', [
      'scheduler',
      'jobs',
      'describe',
      schedulerName,
      `--project=${options.project}`,
      `--location=${options.region}`,
      '--format=json',
    ], options.timeoutMs);
    assert(scheduler.state === 'ENABLED', `${schedulerName} is not enabled`, String(scheduler.state || 'missing'));
    assert(String(scheduler.schedule || '').includes('*/6'), `${schedulerName} should refresh Search Console fallback every 6 hours`, String(scheduler.schedule || 'missing'));
    results.push(result(`cloud-scheduler-${schedulerName}`, 'ok', scheduler.schedule));
  }

  const secretVersions = await execJson('gcloud', [
    'secrets',
    'versions',
    'list',
    options.oauthSecret,
    `--project=${options.project}`,
    '--filter=state=ENABLED',
    '--limit=1',
    '--format=json',
  ], options.timeoutMs);
  assert(Array.isArray(secretVersions) && secretVersions.length > 0, `${options.oauthSecret} has no enabled version`);
  results.push(result('search-console-oauth-secret', 'ok', `${options.oauthSecret} has an enabled version`));
  return results;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const results = [];
  results.push(...await checkApiFlow(options));
  results.push(...await checkGcpFlow(options));

  console.log(JSON.stringify({
    ok: true,
    dashboard: options.dashboardUrl,
    checkedAt: new Date().toISOString(),
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
