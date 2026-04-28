#!/usr/bin/env node
import { resolve4, resolveCname } from 'node:dns/promises';

const DEFAULT_DASHBOARD_URL = 'https://metrics.hushh.ai';
const DEFAULT_PRODUCT_URL = 'https://kai.hushh.ai';
const DEFAULT_TIMEOUT_MS = 20_000;
const HOST_ALIASES = new Map([
  ['kai.hush.ai', 'kai.hushh.ai'],
  ['prod.kai.hushh.ai', 'kai.hushh.ai'],
]);

function parseArgs(argv) {
  const options = {
    dashboardUrl: process.env.METRICS_DASHBOARD_URL || DEFAULT_DASHBOARD_URL,
    productUrl: process.env.KAI_PRODUCTION_URL || DEFAULT_PRODUCT_URL,
    timeoutMs: DEFAULT_TIMEOUT_MS,
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

  const productDns = await checkDns(product.canonicalHost);
  assert(productDns.cnames.length || productDns.addresses.length, 'Kai production domain does not resolve', product.canonicalHost);
  results.push({
    check: 'product-domain-dns',
    status: 'ok',
    detail: `${product.canonicalHost} ${productDns.cnames.join(', ') || productDns.addresses.join(', ')}`,
  });

  const productRoot = await fetchWithTimeout(`${product.url}/`, options.timeoutMs, 'text/html');
  assert(productRoot.ok, `Kai production root returned HTTP ${productRoot.status}`);
  results.push({ check: 'product-root', status: 'ok', detail: String(productRoot.status) });

  const dashboardDns = await checkDns(dashboard.canonicalHost);
  assert(dashboardDns.cnames.length || dashboardDns.addresses.length, 'metrics dashboard domain does not resolve', dashboard.canonicalHost);
  results.push({
    check: 'dashboard-domain-dns',
    status: 'ok',
    detail: `${dashboard.canonicalHost} ${dashboardDns.cnames.join(', ') || dashboardDns.addresses.join(', ')}`,
  });

  const health = await checkJsonEndpoint(dashboard.url, '/api/health', options.timeoutMs);
  assert(health.body?.status === 'ok', 'dashboard health endpoint did not return status ok', JSON.stringify(health.body));
  results.push({ check: 'dashboard-health', status: 'ok', detail: health.body.status });

  const kai = await checkJsonEndpoint(dashboard.url, '/api/analytics/kai?window_days=7', options.timeoutMs);
  const cacheControl = kai.response.headers.get('cache-control') || '';
  assert(cacheControl.includes('no-store'), 'Kai analytics endpoint is cacheable', cacheControl);
  assert(kai.body?.platform === 'kai.hushh.ai', 'Kai analytics platform mismatch');
  assert(Array.isArray(kai.body?.data?.freshness?.sources), 'Kai freshness sources missing');
  assert(kai.body?.data?.gcp, 'Kai production Cloud Run metrics missing');
  results.push({
    check: 'kai-analytics',
    status: 'ok',
    detail: `freshness=${kai.body.data.freshness.sources.map((source) => `${source.key}:${source.state}`).join(',')}`,
  });

  const all = await checkJsonEndpoint(dashboard.url, '/api/analytics/all?window_days=7', options.timeoutMs);
  assert(all.body?.kai?.productionProduct?.data?.freshness, 'aggregate analytics missing Kai production freshness block');
  results.push({ check: 'aggregate-analytics', status: 'ok', detail: 'contains Kai production freshness' });

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
