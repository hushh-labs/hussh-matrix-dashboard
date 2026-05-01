#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_DASHBOARD_URL = 'https://metrics.hushh.ai';
const DEFAULT_PRODUCT_URL = 'https://hushhtech.com';
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_PROJECT = 'hushh-ai-prod';
const DEFAULT_REGION = 'us-central1';
const DEFAULT_FALLBACK_DATASET = 'hushhtech_search_console_api';
const DEFAULT_OFFICIAL_DATASET = 'searchconsole_hushhtech_com';
const DEFAULT_SITE_URL = 'sc-domain:hushhtech.com';
const DEFAULT_JOB = 'hushhtech-search-console-ingest';
const DEFAULT_SCHEDULER = 'hushhtech-search-console-ingest-daily';
const DEFAULT_WINDOW_DAYS = 7;
const DEFAULT_MAX_GENERATED_AGE_MINUTES = 30;
const DEFAULT_MAX_SEARCH_LAG_DAYS = 3;
const DEFAULT_MAX_EXECUTION_AGE_HOURS = 36;
const DEFAULT_MIN_SEARCH_IMPRESSIONS = 1;

const FALLBACK_TABLES = ['site_daily', 'query_daily', 'page_daily', 'country_daily', 'device_daily'];

function parseArgs(argv) {
  const options = {
    dashboardUrl: process.env.METRICS_DASHBOARD_URL || DEFAULT_DASHBOARD_URL,
    productUrl: process.env.HUSHHTECH_PRODUCTION_URL || DEFAULT_PRODUCT_URL,
    timeoutMs: numberFromEnv('HUSHHTECH_FLOW_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
    project: process.env.METRICS_DASHBOARD_GCP_PROJECT || DEFAULT_PROJECT,
    region: process.env.METRICS_DASHBOARD_CLOUD_RUN_REGION || DEFAULT_REGION,
    fallbackDataset: process.env.HUSHHTECH_SEARCH_FALLBACK_DATASET || DEFAULT_FALLBACK_DATASET,
    officialDataset: process.env.HUSHHTECH_SEARCH_DATASET || DEFAULT_OFFICIAL_DATASET,
    siteUrl: process.env.HUSHHTECH_SEARCH_CONSOLE_SITE_URL || DEFAULT_SITE_URL,
    job: process.env.HUSHHTECH_SEARCH_INGEST_JOB || DEFAULT_JOB,
    scheduler: process.env.HUSHHTECH_SEARCH_SCHEDULER_JOB || DEFAULT_SCHEDULER,
    windowDays: numberFromEnv('HUSHHTECH_FLOW_WINDOW_DAYS', DEFAULT_WINDOW_DAYS),
    maxGeneratedAgeMinutes: numberFromEnv('HUSHHTECH_FLOW_MAX_GENERATED_AGE_MINUTES', DEFAULT_MAX_GENERATED_AGE_MINUTES),
    maxSearchLagDays: numberFromEnv('HUSHHTECH_FLOW_MAX_SEARCH_LAG_DAYS', DEFAULT_MAX_SEARCH_LAG_DAYS),
    maxExecutionAgeHours: numberFromEnv('HUSHHTECH_FLOW_MAX_EXECUTION_AGE_HOURS', DEFAULT_MAX_EXECUTION_AGE_HOURS),
    minSearchImpressions: numberFromEnv('HUSHHTECH_FLOW_MIN_SEARCH_IMPRESSIONS', DEFAULT_MIN_SEARCH_IMPRESSIONS),
    skipGcp: process.env.HUSHHTECH_FLOW_SKIP_GCP === 'true',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dashboard-url' && argv[index + 1]) {
      options.dashboardUrl = argv[index + 1];
      index += 1;
    } else if (arg === '--product-url' && argv[index + 1]) {
      options.productUrl = argv[index + 1];
      index += 1;
    } else if (arg === '--window-days' && argv[index + 1]) {
      options.windowDays = parsePositiveInt(argv[index + 1], options.windowDays);
      index += 1;
    } else if (arg === '--max-search-lag-days' && argv[index + 1]) {
      options.maxSearchLagDays = parsePositiveInt(argv[index + 1], options.maxSearchLagDays);
      index += 1;
    } else if (arg === '--min-search-impressions' && argv[index + 1]) {
      options.minSearchImpressions = parsePositiveInt(argv[index + 1], options.minSearchImpressions);
      index += 1;
    } else if (arg === '--skip-gcp') {
      options.skipGcp = true;
    }
  }

  options.dashboardUrl = normalizeOrigin(options.dashboardUrl);
  options.productUrl = normalizeOrigin(options.productUrl);
  return options;
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

function toNumber(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function trafficSignalsAreAllZero(overview) {
  return ['active1DayUsers', 'active7DayUsers', 'sessions', 'screenPageViews', 'newUsers']
    .map((key) => toNumber(overview?.[key]))
    .every((value) => value === 0);
}

function ageMinutes(isoDate) {
  const time = Date.parse(isoDate);
  if (!Number.isFinite(time)) return Number.POSITIVE_INFINITY;
  return (Date.now() - time) / 60_000;
}

function ageHours(isoDate) {
  return ageMinutes(isoDate) / 60;
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
  ];
  const matched = patterns.find((pattern) => pattern.test(text));
  assert(!matched, `${label} payload appears to contain a raw secret`);
}

function assertPublicSafePayload(body, label) {
  const text = JSON.stringify(body);
  const unsafePattern = /sourceDataset|sourceProjectId|sourceProjectRef|sourceTable|analytics_\d+|searchconsole_|_search_console_api|hushh-ai-prod|hushh-pda|ibsisfnjxeowvdtvgzff/i;
  assert(!unsafePattern.test(text), `${label} exposes unsafe source identifiers`);
}

function metricFromCard(card, key) {
  return card?.metrics?.find((metric) => metric.key === key);
}

function assertCardMetricEquals(card, key, expected) {
  const metric = metricFromCard(card, key);
  assert(metric, `${card?.key || 'source card'} missing ${key}`);
  assert(toNumber(metric.value) === toNumber(expected), `${card.key} ${key} does not match source value`, `${metric.value} !== ${expected}`);
}

function assertSourceSections(card, label, requiredKeys) {
  assert(card, `${label} source card missing`);
  const sections = Array.isArray(card.sections) ? card.sections : [];
  for (const key of requiredKeys) {
    const section = sections.find((item) => item.key === key);
    assert(section, `${label} missing ${key} section`);
    assert(Array.isArray(section.metrics) && section.metrics.length > 0, `${label} ${key} section has no metrics`);
  }
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
  return JSON.parse(stdout || 'null');
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

function result(check, status, detail, extra = undefined) {
  return extra == null ? { check, status, detail } : { check, status, detail, ...extra };
}

async function checkProductSummary(options) {
  const results = [];
  const summary = await fetchJson(`${options.productUrl}/api/metrics/summary?window_days=${options.windowDays}`, options.timeoutMs);
  assert(hasNoStore(summary.response), 'HushhTech summary endpoint is cacheable', summary.response.headers.get('cache-control') || '');
  assert(summary.body?.generatedAt, 'HushhTech summary missing generatedAt');
  assert(ageMinutes(summary.body.generatedAt) <= options.maxGeneratedAgeMinutes, 'HushhTech summary is stale', summary.body.generatedAt);
  assert(summary.body?.businessFunnel?.overview, 'HushhTech summary missing business funnel overview');
  assert(summary.body?.traffic?.source === 'ga4-data-api', 'HushhTech summary is not reading GA4 Data API', String(summary.body?.traffic?.source || 'missing'));
  assert(summary.body?.traffic?.available === true, 'HushhTech GA4 traffic block is not available');
  assertNoSensitivePayload(summary.body, 'HushhTech summary');

  const trafficOverview = summary.body.traffic?.overview || {};
  const allTrafficZero = trafficSignalsAreAllZero(trafficOverview);

  results.push(result(
    'product-summary-ga4',
    'ok',
    `generatedAt=${summary.body.generatedAt}, traffic=${summary.body.traffic.source}`,
  ));
  if (allTrafficZero) {
    results.push(result(
      'product-ga4-traffic-volume',
      'warn',
      'GA4 Data API is reachable but traffic metrics are all zero for this window',
    ));
  } else {
    results.push(result(
      'product-ga4-traffic-volume',
      'ok',
      `sessions=${trafficOverview.sessions ?? 0}, active7DayUsers=${trafficOverview.active7DayUsers ?? 0}`,
    ));
  }

  return { results, summary: summary.body };
}

async function checkDashboardFlow(options) {
  const results = [];
  const health = await fetchJson(`${options.dashboardUrl}/api/health`, options.timeoutMs);
  assert(health.body?.status === 'ok', 'metrics dashboard health is not ok');
  assert(health.body?.config?.hushhTechSearchConsoleFallback, 'dashboard health missing fallback config');
  assertPublicSafePayload(health.body, 'dashboard health');
  results.push(result('dashboard-health-config', 'ok', `fallback=${health.body.config.hushhTechSearchConsoleFallback}`));

  const analytics = await fetchJson(`${options.dashboardUrl}/api/analytics/hushhtech?window_days=${options.windowDays}`, options.timeoutMs);
  assert(hasNoStore(analytics.response), 'dashboard HushhTech analytics endpoint is cacheable', analytics.response.headers.get('cache-control') || '');
  assert(analytics.body?.platform === 'hushhtech.com', 'dashboard HushhTech platform mismatch');
  assertNoSensitivePayload(analytics.body, 'dashboard HushhTech analytics');
  assertPublicSafePayload(analytics.body, 'dashboard HushhTech analytics');

  const data = analytics.body?.data || {};
  const search = data.searchPerformance || {};
  assert(search.available === true, 'dashboard Search Console block is not available', search.note || 'missing note');
  assert(['metrics-hushh-ai-search-console-gcp-fallback', 'metrics-hushh-ai-search-console-bigquery'].includes(search.source), 'unexpected Search Console source', String(search.source || 'missing'));
  assert(search.metadata?.siteUrl === options.siteUrl, 'Search Console site URL mismatch', String(search.metadata?.siteUrl || 'missing'));
  assert(toNumber(search.overview?.impressions) >= options.minSearchImpressions, 'Search Console impressions are below the configured minimum', String(search.overview?.impressions ?? 0));
  assert(search.overview.clicks >= 0, 'Search Console clicks must be numeric');
  assert(search.overview.ctr == null || (search.overview.ctr >= 0 && search.overview.ctr <= 1), 'Search Console CTR out of range');
  assert(search.overview.averagePosition == null || search.overview.averagePosition >= 1, 'Search Console average position invalid');
  assert(Array.isArray(search.daily) && search.daily.length > 0, 'Search Console daily timeline rows are missing');
  assert(Array.isArray(search.queries) && search.queries.length > 0, 'Search Console query rows are missing');
  assert(Array.isArray(search.pages) && search.pages.length > 0, 'Search Console page rows are missing');
  assert(Array.isArray(search.countries) && search.countries.length > 0, 'Search Console country rows are missing');
  assert(Array.isArray(search.devices) && search.devices.length > 0, 'Search Console device rows are missing');

  const coverage = data.dataCoverage || {};
  assert(coverage.ga4Available === true, 'dashboard coverage says GA4 is unavailable');
  assert(coverage.gcpAvailable === true, 'dashboard coverage says GCP monitoring is unavailable');
  assert(coverage.searchConsoleAvailable === true, 'dashboard coverage says Search Console is unavailable');
  assert(coverage.supabaseAvailable === true, 'dashboard coverage says HushhTech database metrics are unavailable');

  const cards = data.sourceCards || [];
  const searchCard = cards.find((card) => card.key === 'search_console');
  const ga4Card = cards.find((card) => card.key === 'ga4');
  const eventsCard = cards.find((card) => card.key === 'product_events');
  assertCardMetricEquals(searchCard, 'clicks', search.overview.clicks);
  assertCardMetricEquals(searchCard, 'impressions', search.overview.impressions);
  assertSourceSections(searchCard, 'HushhTech Search Console', ['last_24_hours', 'last_7_days', 'selected_total']);
  const ga4ProcessedTrafficAllZero = trafficSignalsAreAllZero(data.traffic?.overview);
  if (ga4ProcessedTrafficAllZero) {
    assert(ga4Card?.status === 'waiting', 'HushhTech GA4 card should be waiting when processed traffic is unverified', String(ga4Card?.status || 'missing'));
    assert(
      /processed traffic is all zero/i.test(String(ga4Card?.blocker || '')),
      'HushhTech GA4 card is missing the unverified processed traffic caveat',
      String(ga4Card?.blocker || ''),
    );
  } else {
    assertCardMetricEquals(ga4Card, 'sessions', data.traffic?.overview?.sessions);
  }
  assert(Array.isArray(ga4Card?.sections) && ga4Card.sections.length >= 4, 'HushhTech GA4 sections missing');
  assertSourceSections(ga4Card, 'HushhTech GA4', ['realtime', 'last_24_hours', 'last_7_days', 'selected_total']);
  assertCardMetricEquals(eventsCard, 'total_users', data.supabase?.rangeTotals?.totalUsers);
  assertCardMetricEquals(eventsCard, 'analytics_events', data.supabase?.rangeTotals?.analyticsEvents);

  results.push(result(
    'dashboard-search-console',
    'ok',
    `source=${search.source}, clicks=${search.overview?.clicks ?? 0}, impressions=${search.overview?.impressions ?? 0}`,
  ));
  results.push(result('dashboard-coverage', 'ok', `ga4=${coverage.ga4Available}, gcp=${coverage.gcpAvailable}, search=${coverage.searchConsoleAvailable}, db=${coverage.supabaseAvailable}`));

  const aggregate = await fetchJson(`${options.dashboardUrl}/api/analytics/all?window_days=${options.windowDays}`, options.timeoutMs);
  assertNoSensitivePayload(aggregate.body?.hushhTech, 'aggregate HushhTech analytics');
  assertPublicSafePayload(aggregate.body, 'aggregate analytics');
  assert(aggregate.body?.hushhTech?.data?.searchPerformance?.available === true, 'aggregate endpoint is missing HushhTech Search Console data');
  assert(!aggregate.body?.hushhAi?.data?.supabase, 'aggregate endpoint incorrectly attaches Supabase to hushh.ai');
  results.push(result('aggregate-metrics-flow', 'ok', 'HushhTech Search Console is present and hushh.ai has no Supabase block'));

  return { results, analytics: analytics.body, aggregate: aggregate.body };
}

async function checkGcpFlow(options) {
  if (options.skipGcp) {
    return { results: [result('gcp-metrics-flow', 'warn', 'skipped by --skip-gcp')] };
  }

  const results = [];
  const tableSql = `
    SELECT table_name, row_count, max_date, DATE_DIFF(CURRENT_DATE(), max_date, DAY) AS max_lag_days
    FROM (
      SELECT 'site_daily' AS table_name, COUNT(*) AS row_count, MAX(data_date) AS max_date FROM \`${options.project}.${options.fallbackDataset}.site_daily\`
      UNION ALL SELECT 'query_daily', COUNT(*), MAX(data_date) FROM \`${options.project}.${options.fallbackDataset}.query_daily\`
      UNION ALL SELECT 'page_daily', COUNT(*), MAX(data_date) FROM \`${options.project}.${options.fallbackDataset}.page_daily\`
      UNION ALL SELECT 'country_daily', COUNT(*), MAX(data_date) FROM \`${options.project}.${options.fallbackDataset}.country_daily\`
      UNION ALL SELECT 'device_daily', COUNT(*), MAX(data_date) FROM \`${options.project}.${options.fallbackDataset}.device_daily\`
    )
    ORDER BY table_name
  `;
  const fallbackRows = await queryBigQuery(options.project, tableSql, options.timeoutMs);
  const byTable = new Map(fallbackRows.map((row) => [String(row.table_name), row]));
  for (const tableName of FALLBACK_TABLES) {
    const row = byTable.get(tableName);
    assert(row, `fallback table ${tableName} is missing from row count query`);
    assert(toNumber(row.row_count) > 0, `fallback table ${tableName} is empty`);
    assert(toNumber(row.max_lag_days) <= options.maxSearchLagDays, `fallback table ${tableName} is stale`, `max_date=${row.max_date}, lag_days=${row.max_lag_days}`);
  }
  results.push(result(
    'fallback-bigquery-freshness',
    'ok',
    fallbackRows.map((row) => `${row.table_name}:${row.row_count}@${row.max_date}`).join(', '),
  ));

  const officialRows = await queryBigQuery(options.project, `
    SELECT table_name
    FROM \`${options.project}.${options.officialDataset}.INFORMATION_SCHEMA.TABLES\`
    WHERE table_name IN ('searchdata_site_impression', 'searchdata_url_impression')
    ORDER BY table_name
  `, options.timeoutMs);
  results.push(result(
    'official-search-console-export',
    officialRows.length >= 2 ? 'ok' : 'waiting',
    officialRows.length >= 2
      ? 'official Search Console bulk export tables are present'
      : `official export still waiting; using fallback ${options.project}.${options.fallbackDataset}`,
  ));

  const job = await execJson('gcloud', [
    'run',
    'jobs',
    'describe',
    options.job,
    `--project=${options.project}`,
    `--region=${options.region}`,
    '--format=json',
  ], options.timeoutMs);
  const ready = (job.status?.conditions || []).find((condition) => condition.type === 'Ready');
  assert(ready?.status === 'True', 'Search Console ingest Cloud Run Job is not Ready', ready?.message || JSON.stringify(job.status || {}));
  const jobSecret = job.spec?.template?.spec?.template?.spec?.containers?.[0]?.env?.find((entry) => entry.name === 'HUSHHTECH_SEARCH_CONSOLE_OAUTH_JSON');
  assert(jobSecret?.valueFrom?.secretKeyRef?.name === 'hushhtech-search-console-oauth', 'Search Console OAuth secret is not wired to the job');
  results.push(result('cloud-run-job-ready', 'ok', `${options.job} Ready=True`));

  const executions = await execJson('gcloud', [
    'run',
    'jobs',
    'executions',
    'list',
    `--job=${options.job}`,
    `--project=${options.project}`,
    `--region=${options.region}`,
    '--format=json',
    '--limit=5',
  ], options.timeoutMs);
  const latestCompleted = executions.find((execution) => {
    const completed = (execution.status?.conditions || []).find((condition) => condition.type === 'Completed');
    return completed?.status === 'True';
  });
  assert(latestCompleted, 'no completed Search Console ingest execution found');
  assert(ageHours(latestCompleted.status?.completionTime) <= options.maxExecutionAgeHours, 'latest Search Console ingest execution is stale', latestCompleted.status?.completionTime || 'missing completionTime');
  results.push(result('cloud-run-job-execution', 'ok', `${latestCompleted.metadata?.name} completed at ${latestCompleted.status?.completionTime}`));

  const scheduler = await execJson('gcloud', [
    'scheduler',
    'jobs',
    'describe',
    options.scheduler,
    `--project=${options.project}`,
    `--location=${options.region}`,
    '--format=json',
  ], options.timeoutMs);
  assert(scheduler.state === 'ENABLED', 'Search Console Scheduler is not enabled', String(scheduler.state || 'missing'));
  const expectedUri = `https://run.googleapis.com/v2/projects/${options.project}/locations/${options.region}/jobs/${options.job}:run`;
  assert(scheduler.httpTarget?.uri === expectedUri, 'Search Console Scheduler target URI mismatch', String(scheduler.httpTarget?.uri || 'missing'));
  assert(!scheduler.status?.code, 'Search Console Scheduler last attempt failed', JSON.stringify(scheduler.status));
  results.push(result('cloud-scheduler', 'ok', `${options.scheduler} ${scheduler.schedule}`));

  const secrets = await execJson('gcloud', [
    'secrets',
    'versions',
    'list',
    'hushhtech-search-console-oauth',
    `--project=${options.project}`,
    '--format=json',
  ], options.timeoutMs);
  assert(secrets.some((secret) => String(secret.state).toLowerCase() === 'enabled'), 'Search Console OAuth secret has no enabled version');
  results.push(result('search-console-oauth-secret', 'ok', 'hushhtech-search-console-oauth has an enabled version'));

  return { results };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const allResults = [];

  const product = await checkProductSummary(options);
  allResults.push(...product.results);

  const dashboard = await checkDashboardFlow(options);
  allResults.push(...dashboard.results);

  const gcp = await checkGcpFlow(options);
  allResults.push(...gcp.results);

  const failed = allResults.find((entry) => entry.status === 'fail');
  if (failed) assert(false, `${failed.check} failed`, failed.detail);

  console.log(JSON.stringify({
    ok: true,
    product: 'hushhtech.com',
    dashboard: 'metrics.hushh.ai',
    checkedAt: new Date().toISOString(),
    config: {
      windowDays: options.windowDays,
      fallbackDataset: `${options.project}.${options.fallbackDataset}`,
      officialDataset: `${options.project}.${options.officialDataset}`,
      maxSearchLagDays: options.maxSearchLagDays,
      maxExecutionAgeHours: options.maxExecutionAgeHours,
    },
    results: allResults,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    product: 'hushhtech.com',
    checkedAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exit(1);
});
