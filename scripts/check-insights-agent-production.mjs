#!/usr/bin/env node
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Production probe for Hussh Insights AI.
 * Verifies the /api/chat endpoint is live, correctly secured, and returning
 * coherent answers grounded in real metrics data.
 *
 * Usage:
 *   node scripts/check-insights-agent-production.mjs
 *   node scripts/check-insights-agent-production.mjs --base-url https://metrics.hushh.ai
 *   node scripts/check-insights-agent-production.mjs --skip-live-chat
 */

const DEFAULT_BASE_URL = 'https://metrics.hushh.ai';
const DEFAULT_TIMEOUT_MS = 30_000;
const CHAT_TIMEOUT_MS = 45_000;

function parseArgs(argv) {
  const options = {
    baseUrl: process.env.METRICS_DASHBOARD_URL || DEFAULT_BASE_URL,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    skipLiveChat: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--base-url' && argv[index + 1]) {
      options.baseUrl = argv[index + 1];
      index += 1;
    } else if (arg === '--timeout-ms' && argv[index + 1]) {
      const parsed = Number(argv[index + 1]);
      if (Number.isFinite(parsed) && parsed > 0) options.timeoutMs = parsed;
      index += 1;
    } else if (arg === '--skip-live-chat') {
      options.skipLiveChat = true;
    }
  }

  return options;
}

function assert(condition, message, details = undefined) {
  if (!condition) throw new Error(details ? `${message}: ${details}` : message);
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        ...options.headers,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* non-JSON response */ }
    return { response, body, text };
  } finally {
    clearTimeout(timeout);
  }
}

function assertCompleteReply(reply, label) {
  assert(typeof reply === 'string' && reply.length > 20, `${label} reply is too short`);
  assert(/[.!?)]$/.test(reply.trim()), `${label} reply does not end as a complete sentence`, reply.slice(-80));
  assert(!/(^|[\s(])(of|for|with|and|or|to|from|DA|DAU|WAU|MAU)$/i.test(reply.trim()), `${label} reply is truncated`, reply.slice(-120));
}

function numericValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, '').replace(/%/g, '').trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function canonicalMetric(metric) {
  return String(metric ?? '').toLowerCase().replaceAll(' ', '_').replaceAll('-', '_');
}

function findClaim(body, product, metric) {
  return (body?.claims ?? []).find((claim) =>
    claim.product === product && canonicalMetric(claim.metric) === metric
  );
}

function assertClaimMatches(body, product, metric, expected, options = {}) {
  assert(Array.isArray(body?.claims), 'response missing claims array');
  const claim = findClaim(body, product, metric);
  assert(claim, `missing claim ${product}:${metric}`);
  const actual = numericValue(claim.value);
  assert(actual != null, `claim ${product}:${metric} has non-numeric value`);
  const expectedValue = options.percent ? expected * 100 : expected;
  const tolerance = Math.max(options.tolerance ?? 0.02, Math.abs(expectedValue) * 0.005);
  assert(Math.abs(actual - expectedValue) <= tolerance, `claim ${product}:${metric} mismatch`, `expected ${expectedValue}, got ${actual}`);
}

function assertAnalystShape(body, label) {
  assertCompleteReply(body?.reply, label);
  assert(typeof body?.model === 'string' && body.model.length > 0, `${label} response missing model`);
  assert(Array.isArray(body?.claims), `${label} response missing claims array`);
  assert(Array.isArray(body?.sources), `${label} response missing sources array`);
  assert(Array.isArray(body?.warnings), `${label} response missing warnings array`);
  assert(Array.isArray(body?.suggestedQuestions), `${label} response missing suggestedQuestions array`);
  assert(['high', 'medium', 'low'].includes(body?.confidence), `${label} response confidence invalid`);
}

function cloudRunFromAnalytics(all, product) {
  if (product === 'hushh.ai') return all?.hushhAi?.data?.gcp ?? {};
  if (product === 'kai.hushh.ai') return all?.kai?.productionProduct?.data?.gcp ?? {};
  if (product === 'hushhtech.com') return all?.hushhTech?.data?.gcp ?? {};
  return {};
}

function ga4FromAnalytics(all, product) {
  if (product === 'hushh.ai') return all?.hushhAi?.data?.ga4?.rangeTotals ?? {};
  if (product === 'kai.hushh.ai') return all?.kai?.productionProduct?.data?.productionGa4?.rangeTotals ?? {};
  if (product === 'uat.kai.hushh.ai') return all?.kai?.productionProduct?.data?.uatGa4?.rangeTotals ?? {};
  return {};
}

function hushhTechSupabaseFromAnalytics(all) {
  return all?.hushhTech?.data?.supabase?.rangeTotals ?? {};
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const base = options.baseUrl.replace(/\/$/, '');
  const results = [];
  const startedAt = Date.now();
  const analyticsAll = await fetchJson(`${base}/api/analytics/all`, { timeoutMs: options.timeoutMs });
  assert(analyticsAll.response.ok, `/api/analytics/all returned HTTP ${analyticsAll.response.status}`);
  results.push({ check: 'analytics-all-source', status: 'ok', detail: 'live aggregate source available' });

  // -------------------------------------------------------------------------
  // 1. Health endpoint is live
  // -------------------------------------------------------------------------
  const health = await fetchJson(`${base}/api/health`, { timeoutMs: options.timeoutMs });
  assert(health.response.ok, `/api/health returned HTTP ${health.response.status}`);
  assert(health.body?.status === 'ok', 'health endpoint did not return status ok');
  results.push({ check: 'health-endpoint', status: 'ok', detail: health.body.status });

  // -------------------------------------------------------------------------
  // 2. /api/health does NOT expose API keys
  // -------------------------------------------------------------------------
  const healthText = health.text;
  assert(
    !/OPENAI_API_KEY|openai_api_key|sk-[A-Za-z0-9_-]{20,}|GEMINI_API_KEY|gemini_api_key|AIza[A-Za-z0-9_-]{30,}/i.test(healthText),
    '/api/health exposes API secret or key',
  );
  results.push({ check: 'health-no-secret-leak', status: 'ok', detail: 'no API keys in /api/health' });

  // -------------------------------------------------------------------------
  // 3. POST /api/chat — empty body returns 400
  // -------------------------------------------------------------------------
  const emptyChat = await fetchJson(`${base}/api/chat`, {
    method: 'POST',
    body: {},
    timeoutMs: options.timeoutMs,
  });
  assert(emptyChat.response.status === 400, `expected 400 for empty body, got ${emptyChat.response.status}`);
  assert(emptyChat.body?.error, 'empty body should return an error field');
  results.push({ check: 'chat-empty-body-400', status: 'ok', detail: emptyChat.body.error });

  // -------------------------------------------------------------------------
  // 4. POST /api/chat — missing message returns 400
  // -------------------------------------------------------------------------
  const noMessage = await fetchJson(`${base}/api/chat`, {
    method: 'POST',
    body: { message: '' },
    timeoutMs: options.timeoutMs,
  });
  assert(noMessage.response.status === 400, `expected 400 for empty message, got ${noMessage.response.status}`);
  results.push({ check: 'chat-empty-message-400', status: 'ok', detail: 'empty message rejected' });

  // -------------------------------------------------------------------------
  // 5. POST /api/chat — oversized message returns 400
  // -------------------------------------------------------------------------
  const oversized = await fetchJson(`${base}/api/chat`, {
    method: 'POST',
    body: { message: 'x'.repeat(2500) },
    timeoutMs: options.timeoutMs,
  });
  assert(oversized.response.status === 400, `expected 400 for oversized message, got ${oversized.response.status}`);
  results.push({ check: 'chat-oversized-400', status: 'ok', detail: 'oversized message rejected' });

  // -------------------------------------------------------------------------
  // 6. POST /api/chat — cache headers are no-store
  // -------------------------------------------------------------------------
  const cacheProbe = await fetchJson(`${base}/api/chat`, {
    method: 'POST',
    body: { message: 'ping' },
    timeoutMs: CHAT_TIMEOUT_MS,
  });
  // The response might be 503 (no key) or 200 (working) — either is fine for cache header check
  const cacheControl = cacheProbe.response.headers.get('cache-control') || '';
  assert(cacheControl.includes('no-store'), 'chat endpoint is cacheable', cacheControl);
  results.push({ check: 'chat-no-store', status: 'ok', detail: cacheControl });

  // -------------------------------------------------------------------------
  // 7. POST /api/chat — response does NOT leak secrets
  // -------------------------------------------------------------------------
  if (cacheProbe.text) {
    assert(
      !/sk-[A-Za-z0-9_-]{20,}|metrics-dashboard-openai-api-key|OPENAI_API_KEY|AIza[A-Za-z0-9_-]{30,}|GEMINI_API_KEY/i.test(cacheProbe.text),
      'chat response leaks API secret or key reference',
    );
    results.push({ check: 'chat-no-secret-leak', status: 'ok', detail: 'no secrets in chat response' });
  }

  // -------------------------------------------------------------------------
  // 8. POST /api/chat — check if agent is configured (GEMINI_API_KEY set)
  // -------------------------------------------------------------------------
  const isConfigured = cacheProbe.response.status !== 503;
  results.push({
    check: 'chat-agent-configured',
    status: isConfigured ? 'ok' : 'warning',
    detail: isConfigured ? 'GEMINI_API_KEY is set' : 'GEMINI_API_KEY is not configured (503)',
  });

  // -------------------------------------------------------------------------
  // 9. Live chat round-trip — grounded metrics answer
  // -------------------------------------------------------------------------
  if (isConfigured && !options.skipLiveChat) {
    const liveChat = await fetchJson(`${base}/api/chat`, {
      method: 'POST',
      body: {
        message: 'How many total Cloud Run requests did hushh.ai receive in the last 7 days? Give me the exact number.',
      },
      timeoutMs: CHAT_TIMEOUT_MS,
    });
    assert(liveChat.response.ok, `live chat returned HTTP ${liveChat.response.status}`, liveChat.text?.slice(0, 300));
    assertAnalystShape(liveChat.body, 'live chat');
    const liveSource = await fetchJson(`${base}/api/analytics/all`, { timeoutMs: options.timeoutMs });
    const expectedHushhAiRequests = Number(cloudRunFromAnalytics(liveSource.body, 'hushh.ai').requestCount);
    assert(Number.isFinite(expectedHushhAiRequests), 'analytics source missing hushh.ai Cloud Run request count');
    assertClaimMatches(liveChat.body, 'hushh.ai', 'cloud_run.request_count', expectedHushhAiRequests, { tolerance: 100 });
    results.push({
      check: 'chat-live-roundtrip',
      status: 'ok',
      detail: `model=${liveChat.body.model}, request_count=${expectedHushhAiRequests}`,
    });

    // -----------------------------------------------------------------------
    // 10. Regression — user portfolio question must not be answered as traffic
    // -----------------------------------------------------------------------
    const usersQuery = await fetchJson(`${base}/api/chat`, {
      method: 'POST',
      body: {
        message: 'How many users does Hushh have across all products?',
      },
      timeoutMs: CHAT_TIMEOUT_MS,
    });
    assert(usersQuery.response.ok, `users query returned HTTP ${usersQuery.response.status}`);
    assertAnalystShape(usersQuery.body, 'users query');
    assert(!/cloud run requests/i.test(usersQuery.body.reply), 'users query should not answer with Cloud Run request count', usersQuery.body.reply);
    assert(/de-duplicated|different aggregate|user definition|product-account/i.test(usersQuery.body.reply), 'users query should explain source definitions', usersQuery.body.reply);
    const usersSource = await fetchJson(`${base}/api/analytics/all`, { timeoutMs: options.timeoutMs });
    const expectedHushhTechUsers = Number(hushhTechSupabaseFromAnalytics(usersSource.body).totalUsers);
    const expectedHushhAiWebUsers = Number(ga4FromAnalytics(usersSource.body, 'hushh.ai').users);
    assert(Number.isFinite(expectedHushhTechUsers), 'analytics source missing hushhtech.com Supabase totalUsers');
    assert(Number.isFinite(expectedHushhAiWebUsers), 'analytics source missing hushh.ai GA4 users');
    assertClaimMatches(usersQuery.body, 'hushhtech.com', 'supabase.total_users', expectedHushhTechUsers);
    assertClaimMatches(usersQuery.body, 'hushh.ai', 'ga4.users', expectedHushhAiWebUsers);
    results.push({
      check: 'chat-cross-product-users-meaningful',
      status: 'ok',
      detail: `hushhtech_total_users=${expectedHushhTechUsers}, hushh_ai_ga4_users=${expectedHushhAiWebUsers}`,
    });

    // -----------------------------------------------------------------------
    // 11. Conversation history continuity
    // -----------------------------------------------------------------------
    const followUp = await fetchJson(`${base}/api/chat`, {
      method: 'POST',
      body: {
        message: 'And what about kai.hushh.ai?',
        history: [
          { role: 'user', content: 'How many Cloud Run requests did hushh.ai receive?' },
          { role: 'assistant', content: liveChat.body.reply },
        ],
      },
      timeoutMs: CHAT_TIMEOUT_MS,
    });
    assert(followUp.response.ok, `follow-up chat returned HTTP ${followUp.response.status}`);
    assertAnalystShape(followUp.body, 'follow-up chat');
    const followUpSource = await fetchJson(`${base}/api/analytics/all`, { timeoutMs: options.timeoutMs });
    const expectedKaiRequests = Number(cloudRunFromAnalytics(followUpSource.body, 'kai.hushh.ai').requestCount);
    assertClaimMatches(followUp.body, 'kai.hushh.ai', 'cloud_run.request_count', expectedKaiRequests, { tolerance: 100 });
    results.push({
      check: 'chat-conversation-continuity',
      status: 'ok',
      detail: `kai_request_count=${expectedKaiRequests}`,
    });

    // -----------------------------------------------------------------------
    // 12. Regression — Kai production and UAT must stay separated
    // -----------------------------------------------------------------------
    const kaiSplit = await fetchJson(`${base}/api/chat`, {
      method: 'POST',
      body: {
        message: 'Compare kai.hushh.ai production and uat.kai.hushh.ai UAT. Keep them separate.',
      },
      timeoutMs: CHAT_TIMEOUT_MS,
    });
    assert(kaiSplit.response.ok, `Kai split query returned HTTP ${kaiSplit.response.status}`);
    assertAnalystShape(kaiSplit.body, 'Kai split query');
    assert(/production/i.test(kaiSplit.body.reply) && /uat/i.test(kaiSplit.body.reply), 'Kai split should mention both production and UAT', kaiSplit.body.reply);
    const kaiSplitSource = await fetchJson(`${base}/api/analytics/all`, { timeoutMs: options.timeoutMs });
    const expectedKaiUatUsers = Number(ga4FromAnalytics(kaiSplitSource.body, 'uat.kai.hushh.ai').users);
    assert(Number.isFinite(expectedKaiUatUsers), 'analytics source missing Kai UAT GA4 users');
    assertClaimMatches(kaiSplit.body, 'uat.kai.hushh.ai', 'ga4.users', expectedKaiUatUsers);
    assert(kaiSplit.body.sources.some((source) => source.product === 'uat.kai.hushh.ai'), 'Kai split response missing UAT source chip');
    results.push({
      check: 'chat-kai-prod-uat-separated',
      status: 'ok',
      detail: `kai_uat_ga4_users=${expectedKaiUatUsers}`,
    });

    // -----------------------------------------------------------------------
    // 13. Cross-product query
    // -----------------------------------------------------------------------
    const crossProduct = await fetchJson(`${base}/api/chat`, {
      method: 'POST',
      body: {
        message: 'Compare the Cloud Run error rates across all three products. Which one is healthiest?',
      },
      timeoutMs: CHAT_TIMEOUT_MS,
    });
    assert(crossProduct.response.ok, `cross-product chat returned HTTP ${crossProduct.response.status}`);
    assertAnalystShape(crossProduct.body, 'cross-product chat');
    const crossProductSource = await fetchJson(`${base}/api/analytics/all`, { timeoutMs: options.timeoutMs });
    for (const product of ['hushh.ai', 'kai.hushh.ai', 'hushhtech.com']) {
      const expectedErrorRate = Number(cloudRunFromAnalytics(crossProductSource.body, product).errorRate ?? 0);
      assertClaimMatches(crossProduct.body, product, 'cloud_run.error_rate', expectedErrorRate, { percent: true, tolerance: 1 });
    }
    results.push({
      check: 'chat-cross-product-query',
      status: 'ok',
      detail: `reply_length=${crossProduct.body.reply.length}`,
    });

    // -----------------------------------------------------------------------
    // 14. Funnel-specific query
    // -----------------------------------------------------------------------
    const funnelQuery = await fetchJson(`${base}/api/chat`, {
      method: 'POST',
      body: {
        message: 'What is the hushhtech.com signup to persisted user conversion rate?',
      },
      timeoutMs: CHAT_TIMEOUT_MS,
    });
    assert(funnelQuery.response.ok, `funnel query returned HTTP ${funnelQuery.response.status}`);
    assertAnalystShape(funnelQuery.body, 'funnel query');
    const hasPercentage = /%|\bpercent\b/i.test(funnelQuery.body.reply);
    assert(findClaim(funnelQuery.body, 'hushhtech.com', 'funnel.signup_to_persisted_rate'), 'funnel query missing conversion claim');
    results.push({
      check: 'chat-funnel-query',
      status: 'ok',
      detail: `contains_percentage=${hasPercentage}, reply_length=${funnelQuery.body.reply.length}`,
    });

    // -----------------------------------------------------------------------
    // 15. Search Console query
    // -----------------------------------------------------------------------
    const searchQuery = await fetchJson(`${base}/api/chat`, {
      method: 'POST',
      body: {
        message: 'What are the top search queries driving traffic to hushhtech.com?',
      },
      timeoutMs: CHAT_TIMEOUT_MS,
    });
    assert(searchQuery.response.ok, `search query returned HTTP ${searchQuery.response.status}`);
    assertAnalystShape(searchQuery.body, 'search query');
    assert(findClaim(searchQuery.body, 'hushhtech.com', 'search_console.clicks'), 'search query missing Search Console clicks claim');
    results.push({
      check: 'chat-search-console-query',
      status: 'ok',
      detail: `reply_length=${searchQuery.body.reply.length}`,
    });

    // -----------------------------------------------------------------------
    // 16. Regression — top 3 issues must be complete and actionable
    // -----------------------------------------------------------------------
    const topIssues = await fetchJson(`${base}/api/chat`, {
      method: 'POST',
      body: {
        message: 'What are the top 3 issues I should act on today across all products?',
      },
      timeoutMs: CHAT_TIMEOUT_MS,
    });
    assert(topIssues.response.ok, `top issues query returned HTTP ${topIssues.response.status}`);
    assertAnalystShape(topIssues.body, 'top issues');
    const numberedItems = topIssues.body.reply.match(/(^|\n)\s*\d\./g) ?? [];
    assert(numberedItems.length >= 3, 'top issues answer should include at least 3 numbered items', topIssues.body.reply);
    results.push({
      check: 'chat-top-issues-complete',
      status: 'ok',
      detail: `items=${numberedItems.length}, reply_length=${topIssues.body.reply.length}`,
    });

    // -----------------------------------------------------------------------
    // 17. Regression — last 24-hour report must use the 24h report path
    // -----------------------------------------------------------------------
    const last24Report = await fetchJson(`${base}/api/chat`, {
      method: 'POST',
      body: {
        message: 'What happened in the last 24 hours across all products? Give me a report with reliability, traffic, users, and source caveats.',
      },
      timeoutMs: CHAT_TIMEOUT_MS,
    });
    assert(last24Report.response.ok, `last 24-hour report returned HTTP ${last24Report.response.status}`);
    assertAnalystShape(last24Report.body, 'last 24-hour report');
    assert(/24-hour|24 hours|last 24/i.test(last24Report.body.reply), 'last 24-hour report should name the time window', last24Report.body.reply);
    assert(/reliability|cloud run|traffic/i.test(last24Report.body.reply), 'last 24-hour report should include operational sections', last24Report.body.reply);
    assert(findClaim(last24Report.body, 'hushh.ai', 'cloud_run.request_count')
      || findClaim(last24Report.body, 'kai.hushh.ai', 'cloud_run.request_count'),
    'last 24-hour report missing Cloud Run request claim');
    results.push({
      check: 'chat-last-24-hour-report',
      status: 'ok',
      detail: `claims=${last24Report.body.claims.length}, warnings=${last24Report.body.warnings.length}`,
    });

    // -----------------------------------------------------------------------
    // 18. Regression — unknown metric must not hallucinate numbers
    // -----------------------------------------------------------------------
    const unknownMetric = await fetchJson(`${base}/api/chat`, {
      method: 'POST',
      body: {
        message: 'What is the Mars colony user count for hushh.ai?',
      },
      timeoutMs: CHAT_TIMEOUT_MS,
    });
    assert(unknownMetric.response.ok, `unknown metric query returned HTTP ${unknownMetric.response.status}`);
    assertAnalystShape(unknownMetric.body, 'unknown metric');
    assert(!/\d/.test(unknownMetric.body.reply), 'unknown metric answer should not contain a made-up number', unknownMetric.body.reply);
    assert(Array.isArray(unknownMetric.body.claims) && unknownMetric.body.claims.length === 0, 'unknown metric should not return claims');
    results.push({
      check: 'chat-unknown-metric-no-hallucination',
      status: 'ok',
      detail: 'no numeric claims returned',
    });
  } else if (!isConfigured) {
    results.push({
      check: 'chat-live-roundtrip',
      status: 'skipped',
      detail: 'agent not configured (no GEMINI_API_KEY)',
    });
  } else {
    results.push({
      check: 'chat-live-roundtrip',
      status: 'skipped',
      detail: '--skip-live-chat flag',
    });
  }

  // -------------------------------------------------------------------------
  // 14. Response structure validation
  // -------------------------------------------------------------------------
  if (isConfigured) {
    const structCheck = await fetchJson(`${base}/api/chat`, {
      method: 'POST',
      body: { message: 'Say hello' },
      timeoutMs: CHAT_TIMEOUT_MS,
    });
    if (structCheck.response.ok && structCheck.body) {
      assertAnalystShape(structCheck.body, 'schema check');
      assert(structCheck.body.usage === null || typeof structCheck.body.usage === 'object', 'response usage field malformed');
      if (structCheck.body.usage) {
        assert(typeof structCheck.body.usage.prompt_tokens === 'number', 'usage.prompt_tokens not a number');
        assert(typeof structCheck.body.usage.completion_tokens === 'number', 'usage.completion_tokens not a number');
      }
      results.push({ check: 'chat-response-schema', status: 'ok', detail: 'reply, model, usage fields valid' });
    }
  }

  const elapsed = Date.now() - startedAt;
  const okCount = results.filter((r) => r.status === 'ok').length;
  const warnCount = results.filter((r) => r.status === 'warning').length;
  const skipCount = results.filter((r) => r.status === 'skipped').length;

  console.log(JSON.stringify({
    ok: true,
    checkedAt: new Date().toISOString(),
    elapsedMs: elapsed,
    baseUrl: base,
    summary: `${okCount} passed, ${warnCount} warnings, ${skipCount} skipped`,
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
