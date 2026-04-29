#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { resolve4, resolveCname } from 'node:dns/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_DASHBOARD_URL = 'https://metrics.hushh.ai';
const DEFAULT_PRODUCT_URL = 'https://hushhtech.com';
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_GCP_PROJECT = 'hushh-ai-prod';
const DEFAULT_GCP_REGION = 'us-central1';
const DEFAULT_CLOUD_RUN_SERVICE = 'hushh-matrix-dashboard';
const DEFAULT_DOMAIN_MAPPING = 'metrics.hushh.ai';
const HOST_ALIASES = new Map([
  ['hushh.tech', 'hushhtech.com'],
  ['www.hushhtech.com', 'hushhtech.com'],
  ['hushhtech.ai', 'hushhtech.com'],
]);

const SECRET_BACKED_ENV = new Set([
  'APP_URL',
  'BQ_CLI_FALLBACK',
  'BQ_JOB_PROJECT',
  'HUSHH_AI_CLOUD_RUN_SERVICE',
  'HUSHH_AI_GCP_PROJECT',
  'HUSHH_AI_LIVE_REFRESH_SECONDS',
  'HUSHH_AI_METRICS_WINDOW_DAYS',
  'HUSHH_AI_SEARCH_DATASET',
  'HUSHH_AI_SEARCH_PROJECT',
  'HUSHHTECH_ANALYTICS_ENDPOINT',
  'HUSHHTECH_CLOUD_RUN_REGION',
  'HUSHHTECH_CLOUD_RUN_SERVICE',
  'HUSHHTECH_GCP_PROJECT',
  'HUSHHTECH_METRICS_WINDOW_DAYS',
  'HUSHHTECH_SEARCH_DATASET',
  'HUSHHTECH_SEARCH_FALLBACK_DATASET',
  'HUSHHTECH_SEARCH_FALLBACK_PROJECT',
  'HUSHHTECH_SEARCH_PROJECT',
  'HUSHHTECH_SEARCH_CONSOLE_DATA_STATE',
  'HUSHHTECH_SEARCH_CONSOLE_ROW_LIMIT',
  'HUSHHTECH_SEARCH_CONSOLE_SITE_URL',
  'HUSHHTECH_SEARCH_CONSOLE_TYPE',
  'HUSHHTECH_SUPABASE_ACCESS_TOKEN',
  'HUSHHTECH_SUPABASE_PROJECT_REF',
  'KAI_GA4_WINDOW_DAYS',
  'KAI_PROD_CLOUD_RUN_SERVICE',
  'KAI_PROD_GA4_DATASET',
  'KAI_PROD_GA4_PROJECT',
  'KAI_PROD_GCP_PROJECT',
  'KAI_PROD_METRICS_WINDOW_DAYS',
  'NODE_ENV',
]);

function parseArgs(argv) {
  const options = {
    dashboardUrl: process.env.METRICS_DASHBOARD_URL || DEFAULT_DASHBOARD_URL,
    productUrl: process.env.HUSHHTECH_PRODUCTION_URL || DEFAULT_PRODUCT_URL,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    gcpProject: process.env.METRICS_DASHBOARD_GCP_PROJECT || DEFAULT_GCP_PROJECT,
    gcpRegion: process.env.METRICS_DASHBOARD_CLOUD_RUN_REGION || DEFAULT_GCP_REGION,
    cloudRunService: process.env.METRICS_DASHBOARD_CLOUD_RUN_SERVICE || DEFAULT_CLOUD_RUN_SERVICE,
    domainMapping: process.env.METRICS_DASHBOARD_DOMAIN || DEFAULT_DOMAIN_MAPPING,
    skipGcp: process.env.HUSHHTECH_SKIP_GCP_CHECK === 'true',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dashboard-url' && argv[index + 1]) {
      options.dashboardUrl = argv[index + 1];
      index += 1;
    } else if (arg === '--product-url' && argv[index + 1]) {
      options.productUrl = argv[index + 1];
      index += 1;
    } else if (arg === '--timeout-ms' && argv[index + 1]) {
      const parsed = Number(argv[index + 1]);
      if (Number.isFinite(parsed) && parsed > 0) options.timeoutMs = parsed;
      index += 1;
    } else if (arg === '--gcp-project' && argv[index + 1]) {
      options.gcpProject = argv[index + 1];
      index += 1;
    } else if (arg === '--gcp-region' && argv[index + 1]) {
      options.gcpRegion = argv[index + 1];
      index += 1;
    } else if (arg === '--cloud-run-service' && argv[index + 1]) {
      options.cloudRunService = argv[index + 1];
      index += 1;
    } else if (arg === '--domain-mapping' && argv[index + 1]) {
      options.domainMapping = argv[index + 1];
      index += 1;
    } else if (arg === '--skip-gcp') {
      options.skipGcp = true;
    }
  }

  return options;
}

function normalizeUrl(rawUrl) {
  const url = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);
  const requestedHost = url.hostname.toLowerCase();
  const canonicalHost = HOST_ALIASES.get(requestedHost) || requestedHost;
  if (canonicalHost !== requestedHost) url.hostname = canonicalHost;
  return {
    requestedHost,
    canonicalHost,
    corrected: canonicalHost !== requestedHost,
    url: url.origin,
  };
}

async function checkDns(hostname) {
  const [cnames, addresses] = await Promise.allSettled([resolveCname(hostname), resolve4(hostname)]);
  return {
    cnames: cnames.status === 'fulfilled' ? cnames.value : [],
    addresses: addresses.status === 'fulfilled' ? addresses.value : [],
  };
}

async function fetchWithTimeout(url, timeoutMs, accept = 'application/json') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      cache: 'no-store',
      headers: { Accept: accept, 'Cache-Control': 'no-cache' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function assert(condition, message, details = undefined) {
  if (!condition) throw new Error(details ? `${message}: ${details}` : message);
}

async function checkJsonEndpoint(baseUrl, path, timeoutMs) {
  const response = await fetchWithTimeout(`${baseUrl}${path}`, timeoutMs);
  const text = await response.text();
  assert(response.ok, `${path} returned HTTP ${response.status}`, text.slice(0, 500));
  return { response, body: JSON.parse(text) };
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
    /ghp_[0-9A-Za-z]{20,}/,
  ];
  const matched = patterns.find((pattern) => pattern.test(text));
  assert(!matched, `${label} payload appears to contain a raw secret`);
}

function waitingOrOk(condition, check, okDetail, waitingDetail) {
  return {
    check,
    status: condition ? 'ok' : 'waiting',
    detail: condition ? okDetail : waitingDetail,
  };
}

async function checkCloudRunRuntime(options) {
  if (options.skipGcp) {
    return [{ check: 'cloud-run-runtime', status: 'warn', detail: 'skipped by --skip-gcp' }];
  }

  try {
    const { stdout } = await execFileAsync(
      'gcloud',
      [
        'run',
        'services',
        'describe',
        options.cloudRunService,
        `--project=${options.gcpProject}`,
        `--region=${options.gcpRegion}`,
        '--format=json',
      ],
      { timeout: options.timeoutMs, maxBuffer: 10 * 1024 * 1024 },
    );
    const service = JSON.parse(stdout);
    const container = service.spec?.template?.spec?.containers?.[0] || {};
    const env = container.env || [];
    const envNames = new Set(env.map((entry) => entry.name));
    const requiredHushhTechEnv = [
      'HUSHHTECH_ANALYTICS_ENDPOINT',
      'HUSHHTECH_GCP_PROJECT',
      'HUSHHTECH_CLOUD_RUN_SERVICE',
      'HUSHHTECH_CLOUD_RUN_REGION',
      'HUSHHTECH_SEARCH_PROJECT',
      'HUSHHTECH_SEARCH_DATASET',
      'HUSHHTECH_SEARCH_FALLBACK_PROJECT',
      'HUSHHTECH_SEARCH_FALLBACK_DATASET',
      'HUSHHTECH_SEARCH_CONSOLE_SITE_URL',
      'HUSHHTECH_SUPABASE_PROJECT_REF',
      'HUSHHTECH_SUPABASE_ACCESS_TOKEN',
    ].filter((name) => !envNames.has(name));
    const plainRuntime = env
      .filter((entry) => SECRET_BACKED_ENV.has(entry.name))
      .filter((entry) => !entry.valueFrom)
      .map((entry) => entry.name)
      .sort();

    if (requiredHushhTechEnv.length > 0) {
      return [
        {
          check: 'metrics-cloud-run-runtime',
          status: 'fail',
          detail: `missing HushhTech env: ${requiredHushhTechEnv.join(', ')}`,
        },
      ];
    }

    if (plainRuntime.length > 0) {
      return [
        {
          check: 'metrics-cloud-run-runtime',
          status: 'fail',
          detail: `plain runtime values: ${plainRuntime.join(', ')}`,
        },
      ];
    }

    return [
      {
        check: 'metrics-cloud-run-runtime',
        status: 'ok',
        detail: `${service.status?.latestReadyRevisionName || 'ready'} env uses Secret Manager for runtime config`,
      },
    ];
  } catch (error) {
    return [
      {
        check: 'metrics-cloud-run-runtime',
        status: 'warn',
        detail: error instanceof Error ? error.message : String(error),
      },
    ];
  }
}

async function checkMetricsDomainMapping(options) {
  if (options.skipGcp) {
    return [{ check: 'metrics-domain-mapping', status: 'warn', detail: 'skipped by --skip-gcp' }];
  }

  try {
    const { stdout } = await execFileAsync(
      'gcloud',
      [
        'beta',
        'run',
        'domain-mappings',
        'describe',
        `--project=${options.gcpProject}`,
        `--region=${options.gcpRegion}`,
        `--domain=${options.domainMapping}`,
        '--format=json',
      ],
      { timeout: options.timeoutMs, maxBuffer: 5 * 1024 * 1024 },
    );
    const mapping = JSON.parse(stdout);
    const conditions = mapping.status?.conditions || [];
    const byType = new Map(conditions.map((condition) => [condition.type, condition.status]));
    const ready = byType.get('Ready') === 'True';
    const certificate = byType.get('CertificateProvisioned') === 'True';
    const routable = byType.get('DomainRoutable') === 'True';
    if (!ready || !certificate || !routable) {
      return [
        {
          check: 'metrics-domain-mapping',
          status: 'fail',
          detail: `Ready=${byType.get('Ready')}, CertificateProvisioned=${byType.get('CertificateProvisioned')}, DomainRoutable=${byType.get('DomainRoutable')}`,
        },
      ];
    }
    return [
      {
        check: 'metrics-domain-mapping',
        status: 'ok',
        detail: `${options.domainMapping} maps to ${mapping.spec?.routeName || options.cloudRunService}`,
      },
    ];
  } catch (error) {
    return [
      {
        check: 'metrics-domain-mapping',
        status: 'warn',
        detail: error instanceof Error ? error.message : String(error),
      },
    ];
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const product = normalizeUrl(options.productUrl);
  const dashboard = normalizeUrl(options.dashboardUrl);
  const results = [];

  if (product.corrected) {
    results.push({
      check: 'product-domain-normalization',
      status: 'corrected',
      detail: `${product.requestedHost} -> ${product.canonicalHost}`,
    });
  }

  if (product.requestedHost !== product.canonicalHost) {
    const requestedDns = await checkDns(product.requestedHost);
    results.push({
      check: 'requested-product-domain-dns',
      status: requestedDns.cnames.length || requestedDns.addresses.length ? 'resolves' : 'does-not-resolve',
      detail: product.requestedHost,
    });
  }

  const productDns = await checkDns(product.canonicalHost);
  assert(productDns.cnames.length || productDns.addresses.length, 'HushhTech production domain does not resolve', product.canonicalHost);
  results.push({
    check: 'product-domain-dns',
    status: 'ok',
    detail: `${product.canonicalHost} ${productDns.cnames.join(', ') || productDns.addresses.join(', ')}`,
  });

  const productRoot = await fetchWithTimeout(`${product.url}/`, options.timeoutMs, 'text/html');
  assert(productRoot.ok, `HushhTech production root returned HTTP ${productRoot.status}`);
  const productRootHtml = await productRoot.text();
  results.push({ check: 'product-root', status: 'ok', detail: String(productRoot.status) });
  const visibleGaTags = Array.from(new Set(productRootHtml.match(/G-[A-Z0-9]+/g) || []));
  results.push({
    check: 'product-ga4-tag-html',
    status: visibleGaTags.length > 0 ? 'ok' : 'warn',
    detail: visibleGaTags.length > 0 ? visibleGaTags.join(', ') : 'No GA4 measurement ID found in initial HTML',
  });

  const summary = await checkJsonEndpoint(product.url, '/api/metrics/summary?window_days=7', options.timeoutMs);
  assert(hasNoStore(summary.response), 'HushhTech summary endpoint is cacheable', summary.response.headers.get('cache-control') || '');
  assert(summary.body?.generatedAt, 'HushhTech summary missing generatedAt');
  assert(summary.body?.window?.days, 'HushhTech summary missing window');
  assert(summary.body?.businessFunnel?.overview, 'HushhTech summary missing business funnel');
  assert(summary.body?.traffic?.overview, 'HushhTech summary missing traffic overview');
  assertNoSensitivePayload(summary.body, 'HushhTech summary');
  results.push({
    check: 'product-summary',
    status: 'ok',
    detail: `signups=${summary.body.businessFunnel.overview.signups ?? 0}, traffic=${summary.body.traffic.source}`,
  });
  results.push(waitingOrOk(
    Boolean(summary.body?.traffic?.available),
    'product-ga4-traffic',
    'GA4 traffic block available',
    'GA4 traffic block present but not available',
  ));
  const trafficOverview = summary.body?.traffic?.overview || {};
  const trafficSignals = ['active1DayUsers', 'active7DayUsers', 'sessions', 'screenPageViews', 'newUsers']
    .map((key) => Number(trafficOverview[key] || 0));
  results.push({
    check: 'product-ga4-traffic-volume',
    status: trafficSignals.every((value) => value === 0) ? 'warn' : 'ok',
    detail: trafficSignals.every((value) => value === 0)
      ? 'GA4 Data API is reachable but product traffic is zero for this window'
      : `sessions=${trafficOverview.sessions ?? 0}, active7DayUsers=${trafficOverview.active7DayUsers ?? 0}`,
  });

  const dashboardDns = await checkDns(dashboard.canonicalHost);
  assert(dashboardDns.cnames.length || dashboardDns.addresses.length, 'metrics dashboard domain does not resolve', dashboard.canonicalHost);
  results.push({
    check: 'dashboard-domain-dns',
    status: 'ok',
    detail: `${dashboard.canonicalHost} ${dashboardDns.cnames.join(', ') || dashboardDns.addresses.join(', ')}`,
  });

  const health = await checkJsonEndpoint(dashboard.url, '/api/health', options.timeoutMs);
  assert(health.body?.status === 'ok', 'dashboard health endpoint did not return status ok', JSON.stringify(health.body));
  assert(
    String(health.body?.config?.hushhTechEndpoint || '').includes(product.canonicalHost),
    'dashboard is not using canonical HushhTech production endpoint',
    String(health.body?.config?.hushhTechEndpoint || ''),
  );
  assert(
    String(health.body?.config?.hushhTechCloudRun || '').includes('hushh-tech-website'),
    'dashboard health is missing HushhTech Cloud Run config',
    String(health.body?.config?.hushhTechCloudRun || ''),
  );
  assert(health.body?.config?.hushhTechSearchConsoleFallback, 'dashboard health is missing HushhTech Search Console GCP fallback config');
  results.push({ check: 'dashboard-health', status: 'ok', detail: health.body.status });

  const dashboardHushhTech = await checkJsonEndpoint(dashboard.url, '/api/analytics/hushhtech', options.timeoutMs);
  assert(hasNoStore(dashboardHushhTech.response), 'dashboard HushhTech analytics endpoint is cacheable', dashboardHushhTech.response.headers.get('cache-control') || '');
  assert(dashboardHushhTech.body?.platform === 'hushhtech.com', 'dashboard HushhTech analytics platform mismatch');
  assert(dashboardHushhTech.body?.data?.businessFunnel?.overview, 'dashboard HushhTech analytics missing business funnel');
  assert(dashboardHushhTech.body?.data?.supabase?.metrics, 'dashboard HushhTech analytics missing Supabase database metrics');
  assert(dashboardHushhTech.body?.data?.gcp?.available, 'dashboard HushhTech analytics missing metrics-owned Cloud Run data');
  assert(dashboardHushhTech.body?.data?.dataCoverage, 'dashboard HushhTech analytics missing data coverage');
  assertNoSensitivePayload(dashboardHushhTech.body, 'dashboard HushhTech analytics');
  results.push({
    check: 'dashboard-hushhtech-analytics',
    status: 'ok',
    detail: `signups=${dashboardHushhTech.body.data.businessFunnel.overview.signups ?? 0}, databaseMetrics=${dashboardHushhTech.body.data.supabase.metrics.length}, cloudRunRequests=${dashboardHushhTech.body.data.gcp.requestCount ?? 0}`,
  });
  results.push(waitingOrOk(
    Boolean(dashboardHushhTech.body?.data?.searchPerformance?.available),
    'dashboard-hushhtech-search-console',
    `clicks=${dashboardHushhTech.body.data.searchPerformance?.overview?.clicks ?? 0}`,
    dashboardHushhTech.body?.data?.searchPerformance?.note || 'Search Console coverage is waiting',
  ));

  const all = await checkJsonEndpoint(dashboard.url, '/api/analytics/all?window_days=7', options.timeoutMs);
  assert(all.body?.hushhTech?.data?.businessFunnel?.overview, 'aggregate analytics missing HushhTech business funnel');
  assert(all.body?.hushhTech?.data?.supabase?.metrics, 'aggregate analytics missing HushhTech Supabase database metrics');
  assert(all.body?.hushhTech?.data?.gcp?.available, 'aggregate analytics missing HushhTech Cloud Run data');
  assert(!all.body?.hushhAi?.data?.supabase, 'aggregate analytics incorrectly attaches Supabase data to hushh.ai');
  assertNoSensitivePayload(all.body?.hushhTech, 'aggregate HushhTech analytics');
  results.push({ check: 'aggregate-analytics', status: 'ok', detail: 'contains HushhTech data block' });

  results.push(...await checkCloudRunRuntime(options));
  results.push(...await checkMetricsDomainMapping(options));
  const failed = results.find((result) => result.status === 'fail');
  assert(!failed, `${failed?.check} failed`, failed?.detail);

  console.log(JSON.stringify({
    ok: true,
    productionUp: true,
    productHost: product.canonicalHost,
    dashboardHost: dashboard.canonicalHost,
    checkedAt: new Date().toISOString(),
    results,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    productionUp: false,
    checkedAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exit(1);
});
