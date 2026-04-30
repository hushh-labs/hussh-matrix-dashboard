#!/usr/bin/env node
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Local integration test for Hussh Insights AI.
 * Tests the /api/chat endpoint against a locally running Express server.
 * Does NOT require a Gemini key — tests input validation, rate limiting,
 * security, and response structure independently.
 *
 * Usage:
 *   npm start &                          # start Express on :3001
 *   node scripts/check-insights-agent-local.mjs
 *   node scripts/check-insights-agent-local.mjs --base-url http://localhost:3001
 */

const DEFAULT_BASE_URL = 'http://localhost:3001';
const DEFAULT_TIMEOUT_MS = 10_000;

function parseArgs(argv) {
  const options = {
    baseUrl: process.env.LOCAL_DASHBOARD_URL || DEFAULT_BASE_URL,
    timeoutMs: DEFAULT_TIMEOUT_MS,
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
    }
  }

  return options;
}

let passed = 0;
let failed = 0;
let skipped = 0;
const results = [];

function assert(condition, message, details = undefined) {
  if (!condition) throw new Error(details ? `${message}: ${details}` : message);
}

function log(status, name, detail = '') {
  const icon = status === 'ok' ? '\x1b[32m✓\x1b[0m' : status === 'fail' ? '\x1b[31m✗\x1b[0m' : '\x1b[33m○\x1b[0m';
  console.log(`  ${icon} ${name}${detail ? ` — ${detail}` : ''}`);
  results.push({ check: name, status, detail });
  if (status === 'ok') passed++;
  else if (status === 'fail') failed++;
  else skipped++;
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
    try { body = JSON.parse(text); } catch { /* ignore */ }
    return { response, body, text };
  } finally {
    clearTimeout(timeout);
  }
}

async function test(name, fn) {
  try {
    await fn();
    log('ok', name);
  } catch (err) {
    log('fail', name, err.message);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const base = options.baseUrl.replace(/\/$/, '');

  console.log(`\n\x1b[1mHussh Insights AI — Local Integration Tests\x1b[0m`);
  console.log(`  Target: ${base}\n`);

  // -------------------------------------------------------------------------
  // Server connectivity
  // -------------------------------------------------------------------------
  let serverUp = false;
  try {
    const ping = await fetchJson(`${base}/api/health`, { timeoutMs: 5_000 });
    serverUp = ping.response.ok;
  } catch { /* server not running */ }

  if (!serverUp) {
    console.log('\x1b[31m  Server is not running at ' + base + '\x1b[0m');
    console.log('  Start the server first: npm start\n');
    process.exit(1);
  }

  console.log('\x1b[2m  Input Validation\x1b[0m');

  // -------------------------------------------------------------------------
  // Input validation tests
  // -------------------------------------------------------------------------
  await test('rejects empty POST body', async () => {
    const result = await fetchJson(`${base}/api/chat`, { method: 'POST', body: {}, timeoutMs: options.timeoutMs });
    assert(result.response.status === 400, `expected 400, got ${result.response.status}`);
    assert(result.body?.error, 'missing error field');
  });

  await test('rejects empty message string', async () => {
    const result = await fetchJson(`${base}/api/chat`, { method: 'POST', body: { message: '' }, timeoutMs: options.timeoutMs });
    assert(result.response.status === 400, `expected 400, got ${result.response.status}`);
  });

  await test('rejects whitespace-only message', async () => {
    const result = await fetchJson(`${base}/api/chat`, { method: 'POST', body: { message: '   \n\t  ' }, timeoutMs: options.timeoutMs });
    assert(result.response.status === 400, `expected 400, got ${result.response.status}`);
  });

  await test('rejects message over 2000 chars', async () => {
    const result = await fetchJson(`${base}/api/chat`, { method: 'POST', body: { message: 'a'.repeat(2001) }, timeoutMs: options.timeoutMs });
    assert(result.response.status === 400, `expected 400, got ${result.response.status}`);
    assert(result.body?.error?.toLowerCase().includes('too long'), 'error should mention too long');
  });

  await test('accepts message at exactly 2000 chars', async () => {
    const result = await fetchJson(`${base}/api/chat`, { method: 'POST', body: { message: 'a'.repeat(2000) }, timeoutMs: options.timeoutMs });
    // Should not be 400 — may be 503 (no key) or 200 (working)
    assert(result.response.status !== 400, `expected non-400, got ${result.response.status}`);
  });

  await test('rejects non-string message', async () => {
    const result = await fetchJson(`${base}/api/chat`, { method: 'POST', body: { message: 12345 }, timeoutMs: options.timeoutMs });
    assert(result.response.status === 400, `expected 400, got ${result.response.status}`);
  });

  await test('rejects null message', async () => {
    const result = await fetchJson(`${base}/api/chat`, { method: 'POST', body: { message: null }, timeoutMs: options.timeoutMs });
    assert(result.response.status === 400, `expected 400, got ${result.response.status}`);
  });

  await test('accepts message with history array', async () => {
    const result = await fetchJson(`${base}/api/chat`, {
      method: 'POST',
      body: {
        message: 'test',
        history: [
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: 'hi' },
        ],
      },
      timeoutMs: options.timeoutMs,
    });
    assert(result.response.status !== 400, `expected non-400, got ${result.response.status}`);
  });

  await test('accepts message with empty history', async () => {
    const result = await fetchJson(`${base}/api/chat`, {
      method: 'POST',
      body: { message: 'test', history: [] },
      timeoutMs: options.timeoutMs,
    });
    assert(result.response.status !== 400, `expected non-400, got ${result.response.status}`);
  });

  await test('accepts message without history field', async () => {
    const result = await fetchJson(`${base}/api/chat`, {
      method: 'POST',
      body: { message: 'test' },
      timeoutMs: options.timeoutMs,
    });
    assert(result.response.status !== 400, `expected non-400, got ${result.response.status}`);
  });

  // -------------------------------------------------------------------------
  // Security tests
  // -------------------------------------------------------------------------
  console.log('\n\x1b[2m  Security\x1b[0m');

  await test('cache-control is no-store on /api/chat', async () => {
    const result = await fetchJson(`${base}/api/chat`, { method: 'POST', body: { message: 'test' }, timeoutMs: options.timeoutMs });
    const cc = result.response.headers.get('cache-control') || '';
    assert(cc.includes('no-store'), `expected no-store, got "${cc}"`);
  });

  await test('/api/health does not expose chat keys', async () => {
    const result = await fetchJson(`${base}/api/health`, { timeoutMs: options.timeoutMs });
    assert(result.response.ok, `/api/health returned ${result.response.status}`);
    assert(!/sk-[A-Za-z0-9_-]{20,}/i.test(result.text), 'health endpoint exposes API key');
    assert(!/AIza[A-Za-z0-9_-]{30,}/i.test(result.text), 'health endpoint exposes Gemini API key');
    assert(!/OPENAI_API_KEY/i.test(result.text), 'health endpoint exposes OPENAI_API_KEY env name');
    assert(!/GEMINI_API_KEY/i.test(result.text), 'health endpoint exposes GEMINI_API_KEY env name');
    assert(!/metrics-dashboard-openai-api-key/i.test(result.text), 'health endpoint exposes secret name');
    assert(!/hushh-gemini-api-key/i.test(result.text), 'health endpoint exposes Gemini secret name');
  });

  await test('chat response does not expose internal project IDs', async () => {
    const result = await fetchJson(`${base}/api/chat`, { method: 'POST', body: { message: 'test' }, timeoutMs: options.timeoutMs });
    if (result.text) {
      assert(!/hushh-pda-uat|hushh-pda(?!\.)|hushh-ai-prod|ibsisfnjxeowvdtvgzff/i.test(result.text),
        'chat response exposes internal GCP project/Supabase IDs');
    }
  });

  await test('GET /api/chat returns 404 or 405', async () => {
    const result = await fetchJson(`${base}/api/chat`, { method: 'GET', timeoutMs: options.timeoutMs });
    // Express will return 404 for unmatched GET on a POST route (caught by wildcard)
    assert([404, 405].includes(result.response.status) || result.response.headers.get('content-type')?.includes('text/html'),
      `expected 404/405 or HTML fallback, got ${result.response.status}`);
  });

  // -------------------------------------------------------------------------
  // Response structure (if agent is configured)
  // -------------------------------------------------------------------------
  console.log('\n\x1b[2m  Response Structure\x1b[0m');

  const probe = await fetchJson(`${base}/api/chat`, { method: 'POST', body: { message: 'hello' }, timeoutMs: options.timeoutMs });
  const isConfigured = probe.response.status !== 503;

  if (isConfigured && probe.response.ok) {
    await test('response has reply string', async () => {
      assert(typeof probe.body.reply === 'string', `reply is ${typeof probe.body.reply}`);
      assert(probe.body.reply.length > 0, 'reply is empty');
    });

    await test('response has model string', async () => {
      assert(typeof probe.body.model === 'string', `model is ${typeof probe.body.model}`);
      assert(probe.body.model.length > 0, 'model is empty');
    });

    await test('response has usage object or null', async () => {
      assert(
        probe.body.usage === null || typeof probe.body.usage === 'object',
        `usage is ${typeof probe.body.usage}`,
      );
    });

    await test('response has analyst metadata', async () => {
      assert(Array.isArray(probe.body.claims), 'claims is not an array');
      assert(Array.isArray(probe.body.sources), 'sources is not an array');
      assert(Array.isArray(probe.body.warnings), 'warnings is not an array');
      assert(['high', 'medium', 'low'].includes(probe.body.confidence), `unexpected confidence ${probe.body.confidence}`);
    });

    if (probe.body.usage) {
      await test('usage contains token counts', async () => {
        assert(typeof probe.body.usage.prompt_tokens === 'number', 'prompt_tokens not a number');
        assert(typeof probe.body.usage.completion_tokens === 'number', 'completion_tokens not a number');
        assert(probe.body.usage.prompt_tokens > 0, 'prompt_tokens is zero');
      });
    }
  } else if (!isConfigured) {
    await test('503 response includes helpful error', async () => {
      assert(probe.response.status === 503, `expected 503, got ${probe.response.status}`);
      assert(probe.body?.error, 'missing error field');
      assert(probe.body.error.toLowerCase().includes('gemini') || probe.body.error.toLowerCase().includes('not configured'),
        'error should mention configuration');
    });
    log('skip', 'response-structure-full', 'GEMINI_API_KEY not set');
  }

  // -------------------------------------------------------------------------
  // Agent grounding (live queries if configured)
  // -------------------------------------------------------------------------
  if (isConfigured && probe.response.ok) {
    console.log('\n\x1b[2m  Agent Grounding\x1b[0m');

    await test('answers a metrics question with numbers', async () => {
      const result = await fetchJson(`${base}/api/chat`, {
        method: 'POST',
        body: { message: 'How many Cloud Run requests did hushh.ai receive? Give the exact number.' },
        timeoutMs: 45_000,
      });
      assert(result.response.ok, `returned ${result.response.status}`);
      assert(result.body?.reply, 'no reply');
      assert(/\d/.test(result.body.reply), 'reply contains no numbers');
      assert(Array.isArray(result.body.claims) && result.body.claims.length > 0, 'metrics answer has no structured claims');
    });

    await test('answers cross-product user question with user sources, not Cloud Run traffic', async () => {
      const result = await fetchJson(`${base}/api/chat`, {
        method: 'POST',
        body: { message: 'How many users does Hushh have across all products?' },
        timeoutMs: 45_000,
      });
      assert(result.response.ok, `returned ${result.response.status}`);
      assert(result.body?.reply?.length > 20, 'reply too short');
      assert(!/cloud run requests/i.test(result.body.reply), 'reply should not use Cloud Run requests as users');
      assert(/de-duplicated|different aggregate|product-account/i.test(result.body.reply), 'reply should explain user source definitions');
    });

    await test('understands hushhtech.com business funnel', async () => {
      const result = await fetchJson(`${base}/api/chat`, {
        method: 'POST',
        body: { message: 'What are the hushhtech.com signup numbers for the last 7 days?' },
        timeoutMs: 45_000,
      });
      assert(result.response.ok, `returned ${result.response.status}`);
      assert(result.body?.reply?.length > 20, 'reply too short');
    });

    await test('answers a last 24-hour report request', async () => {
      const result = await fetchJson(`${base}/api/chat`, {
        method: 'POST',
        body: { message: 'What happened in the last 24 hours across all products? Give me a report.' },
        timeoutMs: 45_000,
      });
      assert(result.response.ok, `returned ${result.response.status}`);
      assert(result.body?.reply?.length > 40, 'reply too short');
      assert(/24-hour|24 hours|last 24/i.test(result.body.reply), 'reply should name the 24-hour window');
      assert(Array.isArray(result.body.claims) && result.body.claims.length > 0, '24-hour report has no structured claims');
    });

    await test('handles unknown metric gracefully', async () => {
      const result = await fetchJson(`${base}/api/chat`, {
        method: 'POST',
        body: { message: 'What is the Mars colony user count for hushh.ai?' },
        timeoutMs: 45_000,
      });
      assert(result.response.ok, `returned ${result.response.status}`);
      assert(result.body?.reply, 'no reply');
      assert(!/\d/.test(result.body.reply), 'unknown metric reply should not hallucinate a number');
      assert(Array.isArray(result.body.claims) && result.body.claims.length === 0, 'unknown metric should not return numeric claims');
    });

    await test('maintains conversation context with history', async () => {
      const first = await fetchJson(`${base}/api/chat`, {
        method: 'POST',
        body: { message: 'Tell me about hushh.ai Cloud Run metrics.' },
        timeoutMs: 45_000,
      });
      assert(first.response.ok, `first msg returned ${first.response.status}`);

      const second = await fetchJson(`${base}/api/chat`, {
        method: 'POST',
        body: {
          message: 'And what about the error rate specifically?',
          history: [
            { role: 'user', content: 'Tell me about hushh.ai Cloud Run metrics.' },
            { role: 'assistant', content: first.body.reply },
          ],
        },
        timeoutMs: 45_000,
      });
      assert(second.response.ok, `second msg returned ${second.response.status}`);
      assert(second.body?.reply?.length > 10, 'follow-up reply too short');
      // The reply should reference error rate or percentages
      const mentionsRate = /rate|error|%|percent/i.test(second.body.reply);
      assert(mentionsRate, 'follow-up should mention error rate');
    });
  } else {
    console.log('\n\x1b[2m  Agent Grounding (skipped — not configured)\x1b[0m');
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log(`\n\x1b[1m  Summary: \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m, \x1b[33m${skipped} skipped\x1b[0m\n`);

  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(`\n\x1b[31m  Fatal: ${error.message}\x1b[0m\n`);
  process.exit(1);
});
