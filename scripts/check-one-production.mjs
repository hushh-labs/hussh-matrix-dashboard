#!/usr/bin/env node
import { oneAccountSummaryIssues } from "../src/server/one-account-scope.mjs";
import { resolve4, resolveCname } from 'node:dns/promises';

const DEFAULT_DASHBOARD_URL = 'https://metrics.hussh.ai';
const DEFAULT_PRODUCT_URL = 'https://one.hushh.ai';
const DEFAULT_TIMEOUT_MS = 20_000;
const HOST_ALIASES = new Map([
  ['prod.one.hushh.ai', 'one.hushh.ai'],
]);

function parseArgs(argv) {
  const options = {
    dashboardUrl: process.env.METRICS_DASHBOARD_URL || DEFAULT_DASHBOARD_URL,
    productUrl: process.env.ONE_PRODUCTION_URL || DEFAULT_PRODUCT_URL,
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

function assertPublicSafePayload(body, label) {
  const text = JSON.stringify(body);
  const unsafePattern = /sourceDataset|sourceProjectId|sourceProjectRef|sourceTable|analytics_\d+|searchconsole_|_search_console_api|hushh-ai-prod|hushh-pda|ibsisfnjxeowvdtvgzff/i;
  assert(!unsafePattern.test(text), `${label} exposes unsafe source identifiers`);
}

function assertCardMetricPresent(card, key) {
  assert(card, `source card missing for ${key}`);
  assert(card.metrics?.some((metric) => metric.key === key), `${card.key} missing metric ${key}`);
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
  assert(productDns.cnames.length || productDns.addresses.length, 'One production domain does not resolve', product.canonicalHost);
  results.push({
    check: 'product-domain-dns',
    status: 'ok',
    detail: `${product.canonicalHost} ${productDns.cnames.join(', ') || productDns.addresses.join(', ')}`,
  });

  const productRoot = await fetchWithTimeout(`${product.url}/`, options.timeoutMs, 'text/html');
  assert(productRoot.ok, `One production root returned HTTP ${productRoot.status}`);
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

  const oneResponse = await checkJsonEndpoint(dashboard.url, '/api/analytics/one?window_days=7', options.timeoutMs);
  const cacheControl = oneResponse.response.headers.get('cache-control') || '';
  assert(cacheControl.includes('no-store'), 'One analytics endpoint is cacheable', cacheControl);
  assert(oneResponse.body?.platform === 'one.hushh.ai', 'One analytics platform mismatch');
  assert(Array.isArray(oneResponse.body?.data?.freshness?.sources), 'One freshness sources missing');
  assert(oneResponse.body?.data?.gcp, 'One production Cloud Run metrics missing');
  assertPublicSafePayload(oneResponse.body, 'One analytics');
  const data = oneResponse.body?.data || {};
  const productionFreshnessKeys = data.freshness.sources.map((source) => source.key);
  assert(!productionFreshnessKeys.includes('uat_validation'), 'One production freshness mixes UAT validation into production sources');
  const search = data.searchConsole;
  assert(search, 'One Search Console block missing');
  assert(Number.isFinite(Number(search.clicks)), 'One Search Console clicks not numeric');
  assert(Number.isFinite(Number(search.impressions)), 'One Search Console impressions not numeric');
  assert(Array.isArray(search.daily), 'One Search Console daily timeline missing');
  const searchCard = data.sourceCards?.find((card) => card.key === 'search_console');
  const ga4Card = data.sourceCards?.find((card) => card.key === 'ga4');
  const eventsCard = data.sourceCards?.find((card) => card.key === 'product_events');
  const uatSearchCard = data.uatSourceCards?.find((card) => card.key === 'search_console');
  const uatGa4Card = data.uatSourceCards?.find((card) => card.key === 'ga4');
  const uatEventsCard = data.uatSourceCards?.find((card) => card.key === 'product_events');
  assertSourceSections(searchCard, 'One Search Console', ['last_24_hours', 'last_7_days', 'selected_total']);
  assert(Array.isArray(ga4Card?.sections) && ga4Card.sections.length >= 4, 'One GA4 sections missing');
  assertSourceSections(ga4Card, 'One GA4', ['realtime', 'last_24_hours', 'last_7_days', 'selected_total']);
  for (const key of ['users', 'sessions', 'events']) assertCardMetricPresent(ga4Card, key);
  for (const key of ['dau', 'wau', 'sessions', 'events']) assertCardMetricPresent(eventsCard, key);
  assertSourceSections(uatSearchCard, 'One UAT Search Console', ['last_24_hours', 'last_7_days', 'selected_total']);
  assertSourceSections(uatGa4Card, 'One UAT GA4', ['realtime', 'last_24_hours', 'last_7_days', 'selected_total']);
  for (const key of ['dau', 'wau', 'sessions', 'events']) assertCardMetricPresent(uatEventsCard, key);
  results.push({
    check: 'one-analytics',
    status: 'ok',
    detail: `freshness=${oneResponse.body.data.freshness.sources.map((source) => `${source.key}:${source.state}`).join(',')}`,
  });

  const oneApp = await checkJsonEndpoint(dashboard.url, '/api/analytics/one/app?one_window_days=7', options.timeoutMs);
  assertPublicSafePayload(oneApp.body, 'One app analytics');
  for (const environment of ['production', 'uat']) {
    const summary = oneApp.body?.data?.[environment];
    assert(summary?.rangeTotals, `One app ${environment} range totals missing`);
    assert(summary?.activeUsers, `One app ${environment} active users missing`);
    assert(summary?.identifiedUsers, `One app ${environment} identified users missing`);
    assert(oneAccountSummaryIssues(summary.registeredAccounts, environment).length === 0, `One app ${environment} account source contract invalid`);
    const selectedUsers = summary?.identifiedUsers?.selectedRange;
    assert(selectedUsers?.available === true, `One app ${environment} selected-range unique users unavailable`);
    assert(Number(selectedUsers.newUsers) + Number(selectedUsers.returningUsers) === Number(selectedUsers.totalUsers),
      `One app ${environment} unique-user partition is inconsistent`);
    for (const key of ['users', 'sessions', 'events']) {
      assert(Number.isFinite(Number(summary.rangeTotals[key])), `One app ${environment} ${key} not numeric`);
    }
    for (const key of ['dau', 'wau', 'mau']) {
      assert(Number.isFinite(Number(summary.activeUsers[key])), `One app ${environment} ${key} not numeric`);
      assert(Number.isFinite(Number(summary.identifiedUsers[key])), `One app ${environment} identified ${key} not numeric`);
      const coverage = summary.identifiedUsers?.deviceCoverage?.[key];
      assert(coverage === null || (Number(coverage) >= 0 && Number(coverage) <= 1), `One app ${environment} ${key} identity coverage invalid`);
    }
  }
  results.push({
    check: 'one-app-analytics',
    status: 'ok',
    detail: 'authoritative registered users, device windows and cross-device identified-user windows are present',
  });

  const productionOnly = await checkJsonEndpoint(dashboard.url, '/api/analytics/one/app?environment=production&one_window_days=7', options.timeoutMs);
  assertPublicSafePayload(productionOnly.body, 'PLG production app analytics');
  assert(productionOnly.body?.environment === 'production', 'PLG app response lacks explicit production scope');
  assert(productionOnly.body?.data?.uat === null, 'PLG app response unexpectedly contains UAT');
  assert(productionOnly.body?.data?.production?.reportingEnvironment === 'production', 'PLG app response is not production evidence');
  results.push({ check: 'plg-production-app-scope', status: 'ok', detail: 'production-only response; no UAT payload or fallback' });

  const all = await checkJsonEndpoint(dashboard.url, '/api/analytics/all?window_days=7', options.timeoutMs);
  assert(all.body?.kai?.productionProduct?.data?.freshness, 'aggregate analytics missing One production freshness block');
  const aggregateOne = all.body.kai.productionProduct.data;
  assert(Array.isArray(aggregateOne.uatSourceCards) && aggregateOne.uatSourceCards.length >= 3, 'aggregate analytics missing One UAT source cards');
  results.push({ check: 'aggregate-analytics', status: 'ok', detail: 'contains One production freshness and UAT source cards' });

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
