#!/usr/bin/env node
import { resolve4, resolveCname } from 'node:dns/promises';

const DEFAULT_BASE_URL = 'https://metrics.hushh.ai';
const DEFAULT_TIMEOUT_MS = 60_000;
const HOST_ALIASES = new Map([
  ['matrix.hush.ai', 'metrics.hushh.ai'],
  ['matrix.hushh.ai', 'metrics.hushh.ai'],
  ['metrics.hush.ai', 'metrics.hushh.ai'],
  ['metric.hushh.ai', 'metrics.hushh.ai'],
]);

function parseArgs(argv) {
  const options = {
    baseUrl: process.env.HUSHH_AI_PRODUCTION_URL || DEFAULT_BASE_URL,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--base-url' && argv[index + 1]) {
      options.baseUrl = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--base-url=')) {
      options.baseUrl = arg.slice('--base-url='.length);
    } else if (arg === '--timeout-ms' && argv[index + 1]) {
      const parsed = Number(argv[index + 1]);
      if (Number.isFinite(parsed) && parsed > 0) options.timeoutMs = parsed;
      index += 1;
    } else if (arg.startsWith('--timeout-ms=')) {
      const parsed = Number(arg.slice('--timeout-ms='.length));
      if (Number.isFinite(parsed) && parsed > 0) options.timeoutMs = parsed;
    }
  }

  return options;
}

function normalizeBaseUrl(rawUrl) {
  const url = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);
  const requestedHost = url.hostname.toLowerCase();
  const canonicalHost = HOST_ALIASES.get(requestedHost) || requestedHost;
  if (canonicalHost !== requestedHost) {
    url.hostname = canonicalHost;
  }

  return {
    requestedHost,
    canonicalHost,
    corrected: canonicalHost !== requestedHost,
    url: url.origin,
  };
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
      },
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function checkDns(hostname) {
  const [cnames, addresses] = await Promise.allSettled([resolveCname(hostname), resolve4(hostname)]);
  return {
    cnames: cnames.status === 'fulfilled' ? cnames.value : [],
    addresses: addresses.status === 'fulfilled' ? addresses.value : [],
  };
}

function assert(condition, message, details = undefined) {
  if (!condition) {
    throw new Error(details ? `${message}: ${details}` : message);
  }
}

function assertPublicSafePayload(body, label) {
  const text = JSON.stringify(body);
  const unsafePattern = /sourceDataset|sourceProjectId|sourceProjectRef|sourceTable|analytics_\d+|searchconsole_|hushh_search_console|_search_console_api|hushh-ai-(?:prod|uat)|hushh-pda|ibsisfnjxeowvdtvgzff/i;
  assert(!unsafePattern.test(text), `${label} exposes unsafe source identifiers`);
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
  const body = JSON.parse(text);
  return { response, body };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const target = normalizeBaseUrl(options.baseUrl);
  const results = [];

  if (target.corrected) {
    results.push({
      check: 'domain-normalization',
      status: 'corrected',
      detail: `${target.requestedHost} -> ${target.canonicalHost}`,
    });
  }

  if (target.requestedHost !== target.canonicalHost) {
    const requestedDns = await checkDns(target.requestedHost);
    results.push({
      check: 'requested-domain-dns',
      status: requestedDns.cnames.length || requestedDns.addresses.length ? 'resolves' : 'does-not-resolve',
      detail: target.requestedHost,
    });
  }

  const dns = await checkDns(target.canonicalHost);
  assert(dns.cnames.length || dns.addresses.length, 'canonical domain does not resolve', target.canonicalHost);
  results.push({
    check: 'canonical-domain-dns',
    status: 'ok',
    detail: `${target.canonicalHost} ${dns.cnames.join(', ') || dns.addresses.join(', ')}`,
  });

  const pageResponse = await fetchWithTimeout(`${target.url}/`, options.timeoutMs);
  assert(pageResponse.ok, `dashboard root returned HTTP ${pageResponse.status}`);
  results.push({ check: 'dashboard-root', status: 'ok', detail: String(pageResponse.status) });

  const health = await checkJsonEndpoint(target.url, '/api/health', options.timeoutMs);
  assert(health.body?.status === 'ok', 'health endpoint did not return status ok', JSON.stringify(health.body));
  results.push({ check: 'api-health', status: 'ok', detail: health.body.status });

  const hushhAi = await checkJsonEndpoint(target.url, '/api/analytics/hushhai?window_days=7', options.timeoutMs);
  const cacheControl = hushhAi.response.headers.get('cache-control') || '';
  assert(cacheControl.includes('no-store'), 'Hushh AI analytics endpoint is cacheable', cacheControl);
  assert(hushhAi.body?.platform === 'hushh.ai', 'Hushh AI analytics platform mismatch');
  assert(Array.isArray(hushhAi.body?.data?.freshness?.sources), 'Hushh AI freshness sources missing');
  assertPublicSafePayload(hushhAi.body, 'Hushh AI analytics');
  const search = hushhAi.body?.data?.searchConsole;
  assert(search, 'Hushh AI Search Console block missing');
  assert(typeof search.available === 'boolean', 'Hushh AI Search Console availability missing');
  assert(Number.isFinite(Number(search.clicks)), 'Hushh AI Search Console clicks not numeric');
  assert(Number.isFinite(Number(search.impressions)), 'Hushh AI Search Console impressions not numeric');
  assert(Array.isArray(search.daily), 'Hushh AI Search Console daily timeline missing');
  const searchCard = hushhAi.body?.data?.sourceCards?.find((card) => card.key === 'search_console');
  assertSourceSections(searchCard, 'Hushh AI Search Console', ['last_24_hours', 'last_7_days', 'selected_total']);
  const ga4 = hushhAi.body?.data?.ga4;
  assert(ga4, 'Hushh AI GA4 block missing');
  assert(typeof ga4.available === 'boolean', 'Hushh AI GA4 availability missing');
  assert(Array.isArray(ga4.sections) && ga4.sections.length >= 4, 'Hushh AI GA4 sections missing');
  assert(Array.isArray(ga4.topPages), 'Hushh AI GA4 top pages/screens missing');
  assert(Array.isArray(ga4.topEvents), 'Hushh AI GA4 top events missing');
  assert(Object.prototype.hasOwnProperty.call(ga4.rangeTotals ?? {}, 'engagedSessions'), 'Hushh AI GA4 engaged sessions missing');
  assert(Object.prototype.hasOwnProperty.call(ga4.rangeTotals ?? {}, 'engagementRate'), 'Hushh AI GA4 engagement rate missing');
  assert(Object.prototype.hasOwnProperty.call(ga4.rangeTotals ?? {}, 'averageSessionDuration'), 'Hushh AI GA4 average session duration missing');
  assert(Array.isArray(ga4.acquisition?.sessionChannels), 'Hushh AI GA4 session channel acquisition missing');
  assert(Array.isArray(ga4.acquisition?.sessionSourceMedium), 'Hushh AI GA4 source/medium acquisition missing');
  assert(Array.isArray(ga4.acquisition?.landingPages), 'Hushh AI GA4 landing-page acquisition missing');
  assert(Array.isArray(ga4.sessionTiming?.hourly), 'Hushh AI GA4 hourly session timing missing');
  assert(Array.isArray(ga4.sessionTiming?.topDateHours), 'Hushh AI GA4 top session timing buckets missing');
  assert(Array.isArray(ga4.warnings), 'Hushh AI GA4 caveat warnings missing');
  const configuredGa4Source = String(health.body?.config?.hushhAiGa4 || '');
  if (configuredGa4Source.startsWith('properties/')) {
    assert(
      ga4.available === true,
      'Hushh AI GA4 Data API source is configured but unavailable',
      'Grant GA4 property Viewer or Analyst access to the metrics runtime identity and rerun npm run test:ga4:hushh-ai.',
    );
  }
  const ga4Card = hushhAi.body?.data?.sourceCards?.find((card) => card.key === 'ga4');
  assertSourceSections(ga4Card, 'Hushh AI GA4', ['realtime', 'last_24_hours', 'last_7_days', 'selected_total']);
  const events = hushhAi.body?.data?.productEvents;
  assert(events, 'Hushh AI product-events block missing');
  assert(events.available === true, 'Hushh AI product-events should be available');
  assert(events.status === 'live', 'Hushh AI product-events should be live');
  assert(Number.isFinite(Number(events.rangeTotals?.totalEvents)), 'Hushh AI product-events totalEvents not numeric');
  assert(Number.isFinite(Number(events.rangeTotals?.dau)), 'Hushh AI product-events DAU not numeric');
  assert(Array.isArray(events.daily), 'Hushh AI product-events daily timeline missing');
  const eventsCard = hushhAi.body?.data?.sourceCards?.find((card) => card.key === 'product_events');
  assertSourceSections(eventsCard, 'Hushh AI product-events', ['last_24_hours', 'last_7_days', 'selected_total']);
  results.push({
    check: 'hushh-ai-analytics',
    status: 'ok',
    detail: `freshness=${hushhAi.body.data.freshness.sources.map((source) => `${source.key}:${source.state}`).join(',')}`,
  });

  const hushhAiUat = await checkJsonEndpoint(target.url, '/api/analytics/hushhai/uat?window_days=7', options.timeoutMs);
  const uatCacheControl = hushhAiUat.response.headers.get('cache-control') || '';
  assert(uatCacheControl.includes('no-store'), 'Hushh AI UAT analytics endpoint is cacheable', uatCacheControl);
  assert(hushhAiUat.body?.platform === 'uat.hushh.ai', 'Hushh AI UAT analytics platform mismatch');
  assert(Array.isArray(hushhAiUat.body?.data?.freshness?.sources), 'Hushh AI UAT freshness sources missing');
  assertPublicSafePayload(hushhAiUat.body, 'Hushh AI UAT analytics');
  const uatEvents = hushhAiUat.body?.data?.productEvents;
  assert(uatEvents, 'Hushh AI UAT product-events block missing');
  assert(uatEvents.available === true, 'Hushh AI UAT product-events should be available');
  assert(uatEvents.status === 'live', 'Hushh AI UAT product-events should be live');
  assert(Number.isFinite(Number(uatEvents.rangeTotals?.totalEvents)), 'Hushh AI UAT product-events totalEvents not numeric');
  assert(Number.isFinite(Number(uatEvents.rangeTotals?.dau)), 'Hushh AI UAT product-events DAU not numeric');
  assert(Array.isArray(uatEvents.daily), 'Hushh AI UAT product-events daily timeline missing');
  const uatEventsCard = hushhAiUat.body?.data?.sourceCards?.find((card) => card.key === 'product_events');
  assertSourceSections(uatEventsCard, 'Hushh AI UAT product-events', ['last_24_hours', 'last_7_days', 'selected_total']);
  results.push({
    check: 'hushh-ai-uat-analytics',
    status: 'ok',
    detail: `freshness=${hushhAiUat.body.data.freshness.sources.map((source) => `${source.key}:${source.state}`).join(',')}`,
  });

  const all = await checkJsonEndpoint(target.url, '/api/analytics/all?window_days=7', options.timeoutMs);
  assert(all.body?.hushhAi?.data?.freshness, 'aggregate analytics missing Hushh AI freshness block');
  assert(all.body?.hushhAiUat?.data?.freshness, 'aggregate analytics missing Hushh AI UAT freshness block');
  assertPublicSafePayload(all.body?.hushhAi, 'aggregate Hushh AI analytics');
  assertPublicSafePayload(all.body?.hushhAiUat, 'aggregate Hushh AI UAT analytics');
  results.push({ check: 'aggregate-analytics', status: 'ok', detail: 'contains Hushh AI and Hushh AI UAT freshness' });

  console.log(JSON.stringify({
    ok: true,
    productionUp: true,
    requestedHost: target.requestedHost,
    canonicalHost: target.canonicalHost,
    checkedUrl: target.url,
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
