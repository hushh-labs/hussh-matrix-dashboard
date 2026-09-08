#!/usr/bin/env node
/**
 * Read-only reconciliation probe for One adoption metrics.
 *
 * Re-runs the checks behind docs/metrics/one-source-coverage-inventory.md so the
 * findings there stay honest as the data moves. Every query is a SELECT over the
 * GA4 export and every output is an aggregate; the probe never writes and never
 * prints a user identifier.
 *
 * Exit code is non-zero when a check that should hold does not, so this can run
 * in CI. Checks that are *expected* to fail today (the agent-invocation gap, web
 * User-ID) are reported as known gaps and do not fail the run unless
 * --strict-gaps is passed -- otherwise the probe is red from birth and nobody
 * reads it.
 */
import { BigQuery } from '@google-cloud/bigquery';

const DEFAULT_PROJECT = process.env.ONE_APP_GA4_PROJECT || process.env.KAI_PROD_GA4_PROJECT || 'hushh-pda';
const DEFAULT_DATASET = process.env.ONE_APP_GA4_DATASET || process.env.KAI_PROD_GA4_DATASET || 'analytics_526603671';
const DEFAULT_WEB_HOST = process.env.ONE_APP_WEB_HOST || 'one.hushh.ai';

function parseArgs(argv) {
  const options = {
    project: DEFAULT_PROJECT,
    dataset: DEFAULT_DATASET,
    webHost: DEFAULT_WEB_HOST,
    jobProject: process.env.BQ_JOB_PROJECT || '',
    days: 30,
    // GA4's daily export lands a day or more after the day closes. Asserting
    // "latest table == yesterday" is red on a perfectly healthy pipeline.
    freshnessToleranceDays: 2,
    strictGaps: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--project' && argv[i + 1]) { options.project = argv[++i]; }
    else if (arg === '--dataset' && argv[i + 1]) { options.dataset = argv[++i]; }
    else if (arg === '--web-host' && argv[i + 1]) { options.webHost = argv[++i]; }
    else if (arg === '--job-project' && argv[i + 1]) { options.jobProject = argv[++i]; }
    else if (arg === '--days' && argv[i + 1]) {
      const parsed = Number(argv[++i]);
      if (Number.isFinite(parsed) && parsed > 0) options.days = Math.floor(parsed);
    }
    else if (arg === '--freshness-tolerance-days' && argv[i + 1]) {
      const parsed = Number(argv[++i]);
      if (Number.isFinite(parsed) && parsed >= 0) options.freshnessToleranceDays = Math.floor(parsed);
    }
    else if (arg === '--strict-gaps') { options.strictGaps = true; }
    else if (arg === '--json') { options.json = true; }
  }
  return options;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const utcSuffix = (date) => date.toISOString().slice(0, 10).replace(/-/g, '');
const suffixToIso = (suffix) => `${suffix.slice(0, 4)}-${suffix.slice(4, 6)}-${suffix.slice(6, 8)}`;

/** Last N *complete* UTC days. The current UTC day is excluded: it is still accumulating. */
function completeUtcWindow(days) {
  const end = new Date(Date.now() - DAY_MS);
  const start = new Date(end.getTime() - (days - 1) * DAY_MS);
  return { start: utcSuffix(start), end: utcSuffix(end) };
}

function surfaceFilter(webHost) {
  const literal = `'${String(webHost).replace(/'/g, "\\'")}'`;
  return `(platform IN ('IOS','ANDROID') OR NET.HOST((SELECT value.string_value FROM UNNEST(event_params) WHERE key='page_location')) = ${literal})`;
}

const BACKGROUND_EVENTS = [
  'api_request_completed', 'warmup_completed', 'startup_readiness_warmup_completed',
  'cache_resource_resolved', 'route_readiness_completed', 'route_refresh_completed',
  'web_vital', 'session_start', 'first_visit', 'first_open', 'user_engagement',
  'notification_receive', 'notification_dismiss', 'notification_foreground',
  'app_update', 'os_update', 'one_location_foreground_retry',
];

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const window = completeUtcWindow(options.days);
  const table = `\`${options.project}.${options.dataset}.events_*\``;
  const dateFilter = `_TABLE_SUFFIX BETWEEN '${window.start}' AND '${window.end}'`;
  const oneFilter = `${dateFilter} AND ${surfaceFilter(options.webHost)}`;
  const excluded = BACKGROUND_EVENTS.map((name) => `'${name}'`).join(',');

  const bigquery = new BigQuery({ projectId: options.jobProject || options.project });
  const run = async (sql) => {
    const [rows] = await bigquery.query({ query: sql, useLegacySql: false });
    return rows;
  };

  const checks = [];
  const record = (name, ok, detail, known = false) => {
    checks.push({ name, ok, known_gap: known && !ok, detail });
  };

  // 1. Export freshness. A stale export makes every number below a historical artifact.
  const [freshness] = await run(`
    SELECT MAX(PARSE_DATE('%Y%m%d', event_date)) AS latest_day, COUNT(*) AS events
    FROM ${table} WHERE ${dateFilter}`);
  const latestDay = String(freshness?.latest_day?.value ?? freshness?.latest_day ?? '');
  const oldestAcceptable = utcSuffix(new Date(Date.parse(`${suffixToIso(window.end)}T00:00:00Z`) - options.freshnessToleranceDays * DAY_MS));
  record('export_fresh', Boolean(latestDay) && latestDay.replace(/-/g, '') >= oldestAcceptable,
    `latest exported day ${latestDay || 'none'} (tolerance ${options.freshnessToleranceDays}d, oldest acceptable ${suffixToIso(oldestAcceptable)}), ` +
    `${Number(freshness?.events ?? 0)} events in window`);

  // Report DAU on the latest day that actually exported, not on a day the
  // export has not reached -- otherwise a healthy pipeline reports DAU 0.
  const latestSuffix = latestDay ? latestDay.replace(/-/g, '') : window.end;

  // 2. Deduplication: summing daily uniques must never be used for MAU.
  const [dedup] = await run(`
    WITH one_app AS (SELECT PARSE_DATE('%Y%m%d', event_date) AS d, user_pseudo_id FROM ${table} WHERE ${oneFilter}),
         daily AS (SELECT d, COUNT(DISTINCT user_pseudo_id) AS dau FROM one_app GROUP BY d)
    SELECT SUM(dau) AS sum_daily, (SELECT COUNT(DISTINCT user_pseudo_id) FROM one_app) AS true_unique FROM daily`);
  const sumDaily = Number(dedup?.sum_daily ?? 0);
  const trueUnique = Number(dedup?.true_unique ?? 0);
  record('dedup_gap_documented', trueUnique > 0 && sumDaily >= trueUnique,
    `sum of daily uniques ${sumDaily} vs true ${options.days}-day unique ${trueUnique}` +
    (trueUnique > 0 ? ` (naive sum overstates by ${(((sumDaily / trueUnique) - 1) * 100).toFixed(1)}%)` : ''));

  // 3. Identity coverage per platform. Web User-ID is the known blocker.
  const identity = await run(`
    SELECT platform, COUNT(DISTINCT user_pseudo_id) AS devices, COUNT(DISTINCT user_id) AS keyed
    FROM ${table} WHERE ${oneFilter} GROUP BY platform ORDER BY devices DESC`);
  const web = identity.find((r) => String(r.platform).toUpperCase() === 'WEB');
  record('web_user_id_bound', Boolean(web && Number(web.keyed) > 0),
    identity.map((r) => `${r.platform}: ${Number(r.devices)} devices / ${Number(r.keyed)} user_id`).join('; ') || 'no rows',
    true);

  // 4. Active users under both bases, so the definition note stays truthful.
  const [active] = await run(`
    SELECT
      COUNT(DISTINCT user_pseudo_id) AS mau_all,
      COUNT(DISTINCT IF(event_name NOT IN (${excluded}), user_pseudo_id, NULL)) AS mau_meaningful,
      COUNT(DISTINCT IF(event_date = '${latestSuffix}', user_pseudo_id, NULL)) AS dau_all
    FROM ${table} WHERE ${oneFilter}`);
  record('active_users_reported', Number(active?.mau_all ?? 0) > 0,
    `MAU-${options.days} all=${Number(active?.mau_all ?? 0)} meaningful=${Number(active?.mau_meaningful ?? 0)}, DAU(${suffixToIso(latestSuffix)})=${Number(active?.dau_all ?? 0)}`);

  // 5. Agents used. An agent invocation event is the missing emitter; until it
  //    exists "agent chat" usage is a PKM diagnostic wearing a product label.
  const [agentUse] = await run(`
    SELECT
      COUNTIF(event_name LIKE 'agent_%' AND event_name NOT LIKE 'agent_pkm_%') AS invocation_events,
      COUNTIF(event_name LIKE 'agent_pkm_%') AS pkm_diagnostic_events
    FROM ${table} WHERE ${oneFilter}`);
  record('agent_invocation_event_exists', Number(agentUse?.invocation_events ?? 0) > 0,
    `non-PKM agent events ${Number(agentUse?.invocation_events ?? 0)}, agent_pkm_* diagnostics ${Number(agentUse?.pkm_diagnostic_events ?? 0)}`,
    true);

  // 6. Background noise must not be sold as usage.
  const [consent] = await run(`
    SELECT
      COUNTIF((SELECT value.string_value FROM UNNEST(event_params) WHERE key='load_surface') = 'screen') AS screen_events,
      COUNTIF((SELECT value.string_value FROM UNNEST(event_params) WHERE key='load_surface') = 'warm') AS warm_events,
      COUNTIF((SELECT value.string_value FROM UNNEST(event_params) WHERE key='load_surface') IS NULL) AS unlabelled_events
    FROM ${table} WHERE ${oneFilter} AND event_name = 'consent_pending_loaded'`);
  record('consent_prefetch_separable', Number(consent?.screen_events ?? 0) > 0,
    `consent_pending_loaded screen=${Number(consent?.screen_events ?? 0)} warm=${Number(consent?.warm_events ?? 0)} unlabelled=${Number(consent?.unlabelled_events ?? 0)}`);

  // 7. Production/UAT bleed. UAT hosts inside the production property mean any
  //    unfiltered query over this dataset publishes UAT activity as a prod KPI.
  const uatHost = process.env.ONE_APP_UAT_WEB_HOST || 'uat.hushh.ai';
  const [bleed] = await run(`
    SELECT COUNT(*) AS events, COUNT(DISTINCT user_pseudo_id) AS devices
    FROM ${table} WHERE ${dateFilter}
      AND NET.HOST((SELECT value.string_value FROM UNNEST(event_params) WHERE key='page_location')) = '${uatHost.replace(/'/g, "\\'")}'`);
  record('no_uat_in_production_property', Number(bleed?.events ?? 0) === 0,
    `${uatHost} in ${options.project}.${options.dataset}: ${Number(bleed?.events ?? 0)} events / ${Number(bleed?.devices ?? 0)} devices`,
    true);

  // 8. hushh.ai website traffic present in the product property and reportable today.
  const [site] = await run(`
    SELECT COUNT(*) AS events, COUNT(DISTINCT user_pseudo_id) AS devices,
           COUNTIF(event_name = 'page_view') AS page_views
    FROM ${table} WHERE ${dateFilter}
      AND NET.HOST((SELECT value.string_value FROM UNNEST(event_params) WHERE key='page_location')) IN ('hushh.ai','www.hushh.ai')`);
  record('hushh_ai_site_traffic_measurable', Number(site?.events ?? 0) > 0,
    `hushh.ai hosts: ${Number(site?.events ?? 0)} events / ${Number(site?.devices ?? 0)} devices, page_view=${Number(site?.page_views ?? 0)}`);
  record('hushh_ai_page_view_present', Number(site?.page_views ?? 0) > 0,
    `page_view on hushh.ai hosts: ${Number(site?.page_views ?? 0)}`, true);

  const failures = checks.filter((c) => !c.ok && (options.strictGaps || !c.known_gap));
  const knownGaps = checks.filter((c) => c.known_gap && !options.strictGaps);

  if (options.json) {
    console.log(JSON.stringify({ window, project: options.project, dataset: options.dataset, checks, failed: failures.length }, null, 2));
  } else {
    console.log(`One metrics reconciliation — ${options.project}.${options.dataset}`);
    console.log(`Window: ${window.start} → ${window.end} UTC (${options.days} complete days)\n`);
    for (const check of checks) {
      const mark = check.ok ? 'PASS' : check.known_gap ? 'GAP ' : 'FAIL';
      console.log(`  [${mark}] ${check.name}\n         ${check.detail}`);
    }
    console.log('');
    if (knownGaps.length) {
      console.log(`${knownGaps.length} known gap(s) reported, not failing the run. Pass --strict-gaps to enforce them.`);
    }
    console.log(failures.length ? `${failures.length} check(s) failed.` : 'All enforced checks passed.');
  }

  process.exit(failures.length ? 1 : 0);
}

main().catch((error) => {
  console.error(`one-metrics-reconciliation failed: ${error?.message || error}`);
  process.exit(2);
});
