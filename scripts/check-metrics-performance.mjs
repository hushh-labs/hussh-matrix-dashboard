#!/usr/bin/env node
import assert from 'node:assert/strict';
const base = (process.env.METRICS_DASHBOARD_URL || 'https://metrics.hussh.ai').replace(/\/$/, '');
const budget = Number(process.env.METRICS_PERFORMANCE_BUDGET_MS || 2000);
const date = value => value.toISOString().slice(0, 10);
const range = (days, lag = 0) => { const end = new Date(); end.setUTCHours(0,0,0,0); end.setUTCDate(end.getUTCDate() - lag); return { startDate: date(new Date(end.getTime() - (days-1)*86400000)), endDate: date(end) }; };
const rows = [];
async function request(path, refresh = false) {
  const start = performance.now();
  const response = await fetch(base + path, { cache: 'no-store', headers: { Accept: 'application/json', ...(refresh ? { 'X-Metrics-Refresh': '1' } : {}) }, signal: AbortSignal.timeout(120000) });
  const body = await response.json();
  const ms = Math.round(performance.now() - start);
  assert.equal(response.status, 200, 'Authenticated metrics must be available');
  assert.match(response.headers.get('cache-control') || '', /no-store/);
  assert.ok(response.headers.get('X-Metrics-Updated-At'), 'Snapshot timestamp required');
  assert.doesNotMatch(JSON.stringify(body), /"email"\s*:|"user_id"\s*:|"user_pseudo_id"\s*:|access_token|private_key/);
  return { body, ms, response };
}
try {
  for (const view of ['one', 'growth', 'apps']) for (const days of [7,14,30,90]) {
    const selected = range(days);
    const path = '/api/analytics/all?' + new URLSearchParams({ view, one_start_date: selected.startDate, one_end_date: selected.endDate });
    await request(path); // Prepare any instance newly scaled for the probe; cold timing is measured separately.
    const result = await request(path);
    assert.equal(result.body.one?.data?.production?.range.startDate, selected.startDate);
    assert.equal(result.body.one?.data?.production?.range.endDate, selected.endDate);
    assert.equal(result.body.hushhTech?.data, null, 'Unrelated products must not be loaded');
    if (view === 'apps' && result.body.appStoreConnect?.data?.production?.window) assert.equal(result.body.appStoreConnect.data.production.window.startDate, selected.startDate);
    rows.push({ view, days, ms: result.ms, cache: result.response.headers.get('X-Metrics-Cache'), ok: result.ms <= budget });
    if (view === 'one' && days === 30) {
      const refreshed = await request(path, true);
      rows.push({ view: 'manual-refresh', days, ms: refreshed.ms, ok: refreshed.ms <= budget });
      assert.equal(refreshed.response.headers.get('X-Metrics-Refreshing'), '1');
      const initial = refreshed.response.headers.get('X-Metrics-Updated-At');
      let updated = initial;
      for (let attempt = 0; attempt < 40 && updated === initial; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 1500));
        const next = await request(path); updated = next.response.headers.get('X-Metrics-Updated-At');
      }
      assert.notEqual(updated, initial, 'The background job must complete and advance the snapshot timestamp');
    }
  }
  for (const days of [7,30,90]) {
    const selected = range(days, 3);
    const path = '/api/analytics/founder?' + new URLSearchParams({ start_date: selected.startDate, end_date: selected.endDate });
    await request(path); const result = await request(path);
    assert.equal(result.body.period.startDate, selected.startDate); assert.equal(result.body.period.endDate, selected.endDate);
    rows.push({ view: 'briefing', days, ms: result.ms, cache: result.response.headers.get('X-Metrics-Cache'), ok: result.ms <= budget });
  }
  for (const kaiDays of [7,14,30,90]) for (const hushhDays of [7,14,30,90]) {
    const kai = range(kaiDays), hushh = range(hushhDays);
    const query = new URLSearchParams({ view: 'overview', kai_start_date: kai.startDate, kai_end_date: kai.endDate, hushh_ai_start_date: hushh.startDate, hushh_ai_end_date: hushh.endDate });
    const path = '/api/analytics/all?' + query;
    await request(path); const result = await request(path);
    assert.equal(result.body.one?.data?.production, null, 'Overview must not wait for unused app queries');
    assert.equal(result.body.growth?.data, null); assert.equal(result.body.appStoreConnect?.data, null);
    const source = result.body.hushhAi?.data;
    assert.equal(result.body.kai?.ga4?.data?.range?.startDate, kai.startDate);
    assert.equal(result.body.kai?.ga4?.data?.range?.endDate, kai.endDate);
    assert.equal(source?.gcp?.startDate, hushh.startDate);
    assert.equal(source?.gcp?.endDate, hushh.endDate);
    rows.push({ view: 'overview', kaiDays, hushhDays, ms: result.ms, cache: result.response.headers.get('X-Metrics-Cache'), ok: result.ms <= budget });
    if (kaiDays === 7 && hushhDays === 7) {
      query.set('view', 'platforms'); const platform = await request('/api/analytics/all?' + query);
      rows.push({ view: 'platforms', ms: platform.ms, cache: platform.response.headers.get('X-Metrics-Cache'), ok: platform.ms <= budget });
    }
  }
  console.log(JSON.stringify({ ok: rows.every(row => row.ok), budgetMs: budget, results: rows }, null, 2));
  process.exitCode = rows.every(row => row.ok) ? 0 : 1;
} catch (error) {
  console.log(JSON.stringify({ ok: false, results: rows, error: error.message })); process.exitCode = 1;
}
