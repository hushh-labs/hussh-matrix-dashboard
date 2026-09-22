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
    dashboardUrl: process.env.METRICS_DASHBOARD_URL || 'https://metrics.hushh.ai',
    days: 30,
    // GA4's daily export lands a day or more after the day closes. Asserting
    // "latest table == yesterday" is red on a perfectly healthy pipeline.
    freshnessToleranceDays: 2,
    strictGaps: false,
    skipDashboard: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--project' && argv[i + 1]) { options.project = argv[++i]; }
    else if (arg === '--dataset' && argv[i + 1]) { options.dataset = argv[++i]; }
    else if (arg === '--web-host' && argv[i + 1]) { options.webHost = argv[++i]; }
    else if (arg === '--job-project' && argv[i + 1]) { options.jobProject = argv[++i]; }
    else if (arg === '--dashboard-url' && argv[i + 1]) { options.dashboardUrl = argv[++i]; }
    else if (arg === '--days' && argv[i + 1]) {
      const parsed = Number(argv[++i]);
      if (Number.isFinite(parsed) && parsed > 0) options.days = Math.floor(parsed);
    }
    else if (arg === '--freshness-tolerance-days' && argv[i + 1]) {
      const parsed = Number(argv[++i]);
      if (Number.isFinite(parsed) && parsed >= 0) options.freshnessToleranceDays = Math.floor(parsed);
    }
    else if (arg === '--strict-gaps') { options.strictGaps = true; }
    else if (arg === '--skip-dashboard') { options.skipDashboard = true; }
    else if (arg === '--json') { options.json = true; }
  }
  return options;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const utcSuffix = (date) => date.toISOString().slice(0, 10).replace(/-/g, '');
const suffixToIso = (suffix) => `${suffix.slice(0, 4)}-${suffix.slice(4, 6)}-${suffix.slice(6, 8)}`;
const addSuffixDays = (suffix, days) => utcSuffix(new Date(Date.parse(`${suffixToIso(suffix)}T00:00:00Z`) + days * DAY_MS));

function sameNumbers(actual, expected, keys) {
  return keys.every((key) => Number(actual?.[key] ?? 0) === Number(expected?.[key] ?? 0));
}

async function fetchJson(url, timeoutMs = 120_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    const text = await response.text();
    if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${url} returned invalid JSON`);
    }
  } finally {
    clearTimeout(timer);
  }
}

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

  // 3. Identity coverage per platform. A single observed User-ID is not proof
  // of cross-device deduplication: every device in the reporting population
  // must carry a stable account key before a unique-human claim is supportable.
  const identity = await run(`
    SELECT
      platform,
      COUNT(DISTINCT user_pseudo_id) AS devices,
      COUNT(DISTINCT IF(user_id IS NOT NULL AND user_id != '', user_pseudo_id, NULL)) AS keyed_devices,
      COUNT(DISTINCT IF(user_id IS NOT NULL AND user_id != '', user_id, NULL)) AS accounts
    FROM ${table} WHERE ${oneFilter} GROUP BY platform ORDER BY devices DESC`);
  const totalIdentityDevices = identity.reduce((sum, row) => sum + Number(row.devices ?? 0), 0);
  const totalKeyedDevices = identity.reduce((sum, row) => sum + Number(row.keyed_devices ?? 0), 0);
  const identityCoverage = totalIdentityDevices > 0 ? totalKeyedDevices / totalIdentityDevices : 0;
  record('cross_device_identity_coverage', totalIdentityDevices > 0 && totalKeyedDevices === totalIdentityDevices,
    `${totalKeyedDevices}/${totalIdentityDevices} devices carry stable user_id (${(identityCoverage * 100).toFixed(1)}%); ` +
    (identity.map((r) => `${r.platform}: ${Number(r.devices)} devices / ${Number(r.keyed_devices)} keyed devices / ${Number(r.accounts)} accounts`).join('; ') || 'no rows'),
    true);

  const [multiplicity] = await run(`
    WITH bindings AS (
      SELECT DISTINCT user_id, user_pseudo_id
      FROM ${table}
      WHERE ${oneFilter} AND user_id IS NOT NULL AND user_id != ''
    ), per_account AS (
      SELECT user_id, COUNT(DISTINCT user_pseudo_id) AS devices
      FROM bindings GROUP BY user_id
    )
    SELECT
      COUNT(*) AS accounts,
      COUNTIF(devices > 1) AS multi_device_accounts,
      SUM(GREATEST(devices - 1, 0)) AS duplicate_device_excess,
      MAX(devices) AS max_devices_per_account
    FROM per_account`);
  record('account_device_multiplicity_reported', true,
    `${Number(multiplicity?.accounts ?? 0)} distinct stable accounts; ` +
    `${Number(multiplicity?.multi_device_accounts ?? 0)} appear on multiple devices; ` +
    `${Number(multiplicity?.duplicate_device_excess ?? 0)} extra device bindings; ` +
    `maximum ${Number(multiplicity?.max_devices_per_account ?? 0)} devices/account. ` +
    'Account metrics use COUNT(DISTINCT user_id); device metrics intentionally do not claim unique people.');

  // A GA4 app-instance identifier belongs to a stream/platform namespace. A
  // coincidental value collision between web and native must never silently
  // collapse two devices into one. The production query currently counts the
  // raw identifier, so this enforced assertion protects that equivalence. If
  // it ever fails, the dashboard query must switch to the namespaced key.
  const [namespace] = await run(`
    WITH devices AS (
      SELECT
        COALESCE(platform, 'UNKNOWN') AS platform,
        user_pseudo_id
      FROM ${table}
      WHERE ${oneFilter} AND user_pseudo_id IS NOT NULL AND user_pseudo_id != ''
    ), pseudo_platforms AS (
      SELECT user_pseudo_id, COUNT(DISTINCT platform) AS platforms
      FROM devices GROUP BY user_pseudo_id
    )
    SELECT
      (SELECT COUNT(DISTINCT user_pseudo_id) FROM devices) AS raw_devices,
      (SELECT COUNT(DISTINCT CONCAT(platform, ':', user_pseudo_id)) FROM devices) AS namespaced_devices,
      (SELECT COUNTIF(platforms > 1) FROM pseudo_platforms) AS cross_platform_collisions`);
  const rawDevices = Number(namespace?.raw_devices ?? 0);
  const namespacedDevices = Number(namespace?.namespaced_devices ?? 0);
  const crossPlatformCollisions = Number(namespace?.cross_platform_collisions ?? 0);
  record('device_identifier_namespace_safe',
    rawDevices === namespacedDevices && crossPlatformCollisions === 0,
    `${rawDevices} raw device ids vs ${namespacedDevices} platform-namespaced device ids; ` +
    `${crossPlatformCollisions} identifiers collide across platforms`);

  // Stable account IDs are expected to be the 32-character salted digest
  // emitted by the One clients. Only aggregate validation leaves this probe;
  // a malformed or raw identifier is counted but never printed.
  const [identityShape] = await run(`
    WITH scoped AS (
      SELECT
        COALESCE(platform, 'UNKNOWN') AS platform,
        user_pseudo_id,
        NULLIF(user_id, '') AS user_id
      FROM ${table}
      WHERE ${oneFilter}
    ), device_accounts AS (
      SELECT platform, user_pseudo_id, COUNT(DISTINCT user_id) AS accounts
      FROM scoped
      WHERE user_pseudo_id IS NOT NULL AND user_id IS NOT NULL
      GROUP BY platform, user_pseudo_id
    ), account_platforms AS (
      SELECT user_id, COUNT(DISTINCT platform) AS platforms
      FROM scoped WHERE user_id IS NOT NULL GROUP BY user_id
    )
    SELECT
      COUNT(DISTINCT IF(user_id IS NOT NULL, user_id, NULL)) AS global_accounts,
      COUNT(DISTINCT IF(user_id IS NOT NULL AND NOT REGEXP_CONTAINS(user_id, r'^[0-9a-f]{32}$'), user_id, NULL)) AS malformed_account_ids,
      (SELECT COUNTIF(accounts > 1) FROM device_accounts) AS multi_account_devices,
      (SELECT MAX(accounts) FROM device_accounts) AS max_accounts_per_device,
      (SELECT COUNTIF(platforms > 1) FROM account_platforms) AS cross_platform_accounts
    FROM scoped`);
  record('stable_account_id_shape_valid', Number(identityShape?.malformed_account_ids ?? 0) === 0,
    `${Number(identityShape?.global_accounts ?? 0)} distinct account ids; ` +
    `${Number(identityShape?.malformed_account_ids ?? 0)} do not match the salted 32-hex contract`);
  record('device_account_reuse_reported', true,
    `${Number(identityShape?.multi_account_devices ?? 0)} devices carried more than one account id; ` +
    `maximum ${Number(identityShape?.max_accounts_per_device ?? 0)} accounts/device; ` +
    `${Number(identityShape?.cross_platform_accounts ?? 0)} accounts were observed on multiple platforms. ` +
    'This does not duplicate COUNT(DISTINCT user_id), but proves a device is not interchangeable with a person.');

  // 4. Active users under both bases, so the definition note stays truthful.
  const [active] = await run(`
    SELECT
      COUNT(DISTINCT user_pseudo_id) AS mau_all,
      COUNT(DISTINCT IF(event_name NOT IN (${excluded}), user_pseudo_id, NULL)) AS mau_meaningful,
      COUNT(DISTINCT IF(event_date = '${latestSuffix}', user_pseudo_id, NULL)) AS dau_all
    FROM ${table} WHERE ${oneFilter}`);
  record('active_users_reported', Number(active?.mau_all ?? 0) > 0,
    `MAU-${options.days} all=${Number(active?.mau_all ?? 0)} meaningful=${Number(active?.mau_meaningful ?? 0)}, DAU(${suffixToIso(latestSuffix)})=${Number(active?.dau_all ?? 0)}`);

  // Reconcile the public dashboard against a stable, finalized 30-day slice.
  // This is intentionally not the current intraday table: a streaming table
  // can receive another event between the API request and the oracle query,
  // producing a false mismatch even when both are correct.
  if (!options.skipDashboard && latestDay) {
    const stableEnd = latestSuffix;
    const stableStart = addSuffixDays(stableEnd, -(options.days - 1));
    const stableActiveStart = addSuffixDays(stableEnd, -33);
    const stableDateFilter = `_TABLE_SUFFIX BETWEEN '${stableStart}' AND '${stableEnd}'`;
    const stableActiveDateFilter = `_TABLE_SUFFIX BETWEEN '${stableActiveStart}' AND '${stableEnd}'`;
    const stableOneFilter = `${stableDateFilter} AND ${surfaceFilter(options.webHost)}`;
    const stableActiveOneFilter = `${stableActiveDateFilter} AND ${surfaceFilter(options.webHost)}`;

    const [stableTotals, stableActive, stablePlatforms, stableIdentifiedRange] = await Promise.all([
      run(`
        SELECT
          COUNT(*) AS events,
          COUNT(DISTINCT CONCAT(COALESCE(platform, 'UNKNOWN'), ':', user_pseudo_id)) AS users,
          COUNT(DISTINCT CONCAT(
            COALESCE(platform, 'UNKNOWN'), ':', user_pseudo_id, ':',
            CAST((SELECT value.int_value FROM UNNEST(event_params) WHERE key='ga_session_id') AS STRING)
          )) AS sessions
        FROM ${table} WHERE ${stableOneFilter}`),
      run(`
        WITH days AS (
          SELECT
            CONCAT(COALESCE(platform, 'UNKNOWN'), ':', user_pseudo_id) AS deviceKey,
            NULLIF(user_id, '') AS accountId,
            PARSE_DATE('%Y%m%d', event_date) AS day
          FROM ${table}
          WHERE ${stableActiveOneFilter} AND event_name NOT IN (${excluded})
        ), anchor AS (SELECT MAX(day) AS latest FROM days)
        SELECT
          CAST((SELECT latest FROM anchor) AS STRING) AS asOf,
          COUNT(DISTINCT IF(day = (SELECT latest FROM anchor), deviceKey, NULL)) AS dau,
          COUNT(DISTINCT IF(day BETWEEN DATE_SUB((SELECT latest FROM anchor), INTERVAL 6 DAY)
            AND (SELECT latest FROM anchor), deviceKey, NULL)) AS wau,
          COUNT(DISTINCT IF(day BETWEEN DATE_SUB((SELECT latest FROM anchor), INTERVAL 29 DAY)
            AND (SELECT latest FROM anchor), deviceKey, NULL)) AS mau,
          COUNT(DISTINCT IF(day = (SELECT latest FROM anchor), accountId, NULL)) AS dauAccounts,
          COUNT(DISTINCT IF(day BETWEEN DATE_SUB((SELECT latest FROM anchor), INTERVAL 6 DAY)
            AND (SELECT latest FROM anchor), accountId, NULL)) AS wauAccounts,
          COUNT(DISTINCT IF(day BETWEEN DATE_SUB((SELECT latest FROM anchor), INTERVAL 29 DAY)
            AND (SELECT latest FROM anchor), accountId, NULL)) AS mauAccounts,
          COUNT(DISTINCT IF(day = (SELECT latest FROM anchor) AND accountId IS NOT NULL, deviceKey, NULL)) AS dauIdentifiedDevices,
          COUNT(DISTINCT IF(day BETWEEN DATE_SUB((SELECT latest FROM anchor), INTERVAL 6 DAY)
            AND (SELECT latest FROM anchor) AND accountId IS NOT NULL, deviceKey, NULL)) AS wauIdentifiedDevices,
          COUNT(DISTINCT IF(day BETWEEN DATE_SUB((SELECT latest FROM anchor), INTERVAL 29 DAY)
            AND (SELECT latest FROM anchor) AND accountId IS NOT NULL, deviceKey, NULL)) AS mauIdentifiedDevices
        FROM days`),
      run(`
        WITH days AS (
          SELECT
            COALESCE(platform, 'UNKNOWN') AS platform,
            CONCAT(COALESCE(platform, 'UNKNOWN'), ':', user_pseudo_id) AS deviceKey,
            NULLIF(user_id, '') AS accountId,
            PARSE_DATE('%Y%m%d', event_date) AS day
          FROM ${table}
          WHERE ${stableActiveOneFilter} AND event_name NOT IN (${excluded})
        ), anchor AS (SELECT MAX(day) AS latest FROM days)
        SELECT
          platform,
          COUNT(DISTINCT IF(day = (SELECT latest FROM anchor), deviceKey, NULL)) AS dauDevices,
          COUNT(DISTINCT IF(day BETWEEN DATE_SUB((SELECT latest FROM anchor), INTERVAL 6 DAY)
            AND (SELECT latest FROM anchor), deviceKey, NULL)) AS wauDevices,
          COUNT(DISTINCT IF(day BETWEEN DATE_SUB((SELECT latest FROM anchor), INTERVAL 29 DAY)
            AND (SELECT latest FROM anchor), deviceKey, NULL)) AS mauDevices,
          COUNT(DISTINCT IF(day = (SELECT latest FROM anchor), accountId, NULL)) AS dauAccounts,
          COUNT(DISTINCT IF(day BETWEEN DATE_SUB((SELECT latest FROM anchor), INTERVAL 6 DAY)
            AND (SELECT latest FROM anchor), accountId, NULL)) AS wauAccounts,
          COUNT(DISTINCT IF(day BETWEEN DATE_SUB((SELECT latest FROM anchor), INTERVAL 29 DAY)
            AND (SELECT latest FROM anchor), accountId, NULL)) AS mauAccounts,
          COUNT(DISTINCT IF(day = (SELECT latest FROM anchor) AND accountId IS NOT NULL, deviceKey, NULL)) AS dauIdentifiedDevices,
          COUNT(DISTINCT IF(day BETWEEN DATE_SUB((SELECT latest FROM anchor), INTERVAL 6 DAY)
            AND (SELECT latest FROM anchor) AND accountId IS NOT NULL, deviceKey, NULL)) AS wauIdentifiedDevices,
          COUNT(DISTINCT IF(day BETWEEN DATE_SUB((SELECT latest FROM anchor), INTERVAL 29 DAY)
            AND (SELECT latest FROM anchor) AND accountId IS NOT NULL, deviceKey, NULL)) AS mauIdentifiedDevices
        FROM days GROUP BY platform`),
      run(`
        WITH account_history AS (
          SELECT
            NULLIF(user_id, '') AS accountId,
            MIN(PARSE_DATE('%Y%m%d', event_date)) AS firstSeen
          FROM ${table}
          WHERE REGEXP_CONTAINS(_TABLE_SUFFIX, r'^[0-9]{8}$')
            AND _TABLE_SUFFIX <= '${stableEnd}'
            AND ${surfaceFilter(options.webHost)}
            AND event_name NOT IN (${excluded})
            AND NULLIF(user_id, '') IS NOT NULL
          GROUP BY accountId
        ),
        range_accounts AS (
          SELECT DISTINCT NULLIF(user_id, '') AS accountId
          FROM ${table}
          WHERE ${stableOneFilter}
            AND event_name NOT IN (${excluded})
            AND NULLIF(user_id, '') IS NOT NULL
        )
        SELECT
          COUNT(*) AS totalUsers,
          COUNTIF(firstSeen BETWEEN PARSE_DATE('%Y%m%d', '${stableStart}') AND PARSE_DATE('%Y%m%d', '${stableEnd}')) AS newUsers,
          COUNTIF(firstSeen < PARSE_DATE('%Y%m%d', '${stableStart}')) AS returningUsers
        FROM range_accounts JOIN account_history USING (accountId)`),
    ]);

    const endpoint = new URL('/api/analytics/one/app', `${options.dashboardUrl.replace(/\/$/, '')}/`);
    endpoint.searchParams.set('one_start_date', suffixToIso(stableStart));
    endpoint.searchParams.set('one_end_date', suffixToIso(stableEnd));
    const payload = await fetchJson(endpoint.toString());
    const production = payload?.data?.production;
    const expectedTotals = stableTotals[0] ?? {};
    const expectedActive = stableActive[0] ?? {};
    const actualTotals = production?.rangeTotals;
    const actualActive = production?.activeUsers;
    const actualIdentified = production?.identifiedUsers;
    const expectedIdentifiedRange = stableIdentifiedRange[0] ?? {};

    record('dashboard_range_totals_match_bigquery',
      sameNumbers(actualTotals, expectedTotals, ['users', 'sessions', 'events']),
      `stable ${suffixToIso(stableStart)} to ${suffixToIso(stableEnd)}: ` +
      `API users/sessions/events ${Number(actualTotals?.users ?? 0)}/${Number(actualTotals?.sessions ?? 0)}/${Number(actualTotals?.events ?? 0)}; ` +
      `BigQuery ${Number(expectedTotals?.users ?? 0)}/${Number(expectedTotals?.sessions ?? 0)}/${Number(expectedTotals?.events ?? 0)}`);
    record('dashboard_active_devices_match_bigquery',
      sameNumbers(actualActive, expectedActive, ['dau', 'wau', 'mau']) && String(actualActive?.asOf ?? '') === String(expectedActive?.asOf ?? ''),
      `API DAU/WAU/MAU ${Number(actualActive?.dau ?? 0)}/${Number(actualActive?.wau ?? 0)}/${Number(actualActive?.mau ?? 0)} as of ${String(actualActive?.asOf ?? 'none')}; ` +
      `BigQuery ${Number(expectedActive?.dau ?? 0)}/${Number(expectedActive?.wau ?? 0)}/${Number(expectedActive?.mau ?? 0)} as of ${String(expectedActive?.asOf ?? 'none')}`);
    record('dashboard_identified_users_match_bigquery',
      sameNumbers(actualIdentified, {
        dau: expectedActive.dauAccounts,
        wau: expectedActive.wauAccounts,
        mau: expectedActive.mauAccounts,
      }, ['dau', 'wau', 'mau'])
        && sameNumbers(actualIdentified?.identifiedDevices, {
          dau: expectedActive.dauIdentifiedDevices,
          wau: expectedActive.wauIdentifiedDevices,
          mau: expectedActive.mauIdentifiedDevices,
        }, ['dau', 'wau', 'mau'])
        && String(actualIdentified?.asOf ?? '') === String(expectedActive?.asOf ?? ''),
      `API user DAU/WAU/MAU ${Number(actualIdentified?.dau ?? 0)}/${Number(actualIdentified?.wau ?? 0)}/${Number(actualIdentified?.mau ?? 0)}; ` +
      `BigQuery ${Number(expectedActive?.dauAccounts ?? 0)}/${Number(expectedActive?.wauAccounts ?? 0)}/${Number(expectedActive?.mauAccounts ?? 0)}`);
    record('dashboard_unique_user_growth_matches_bigquery',
      sameNumbers(actualIdentified?.selectedRange, expectedIdentifiedRange, ['totalUsers', 'newUsers', 'returningUsers'])
        && Number(actualIdentified?.selectedRange?.newUsers ?? 0)
          + Number(actualIdentified?.selectedRange?.returningUsers ?? 0)
          === Number(actualIdentified?.selectedRange?.totalUsers ?? 0),
      `API total/new/returning ${Number(actualIdentified?.selectedRange?.totalUsers ?? 0)}/${Number(actualIdentified?.selectedRange?.newUsers ?? 0)}/${Number(actualIdentified?.selectedRange?.returningUsers ?? 0)}; ` +
      `BigQuery ${Number(expectedIdentifiedRange?.totalUsers ?? 0)}/${Number(expectedIdentifiedRange?.newUsers ?? 0)}/${Number(expectedIdentifiedRange?.returningUsers ?? 0)}`);

    // The normal dashboard range ends today. Its active KPI must still anchor
    // to the finalized daily export, never the partially accumulated intraday
    // table. This catches the "DAU=2 at midnight" regression that a historical
    // stable-window comparison cannot see.
    const defaultEndpoint = new URL('/api/analytics/one/app', `${options.dashboardUrl.replace(/\/$/, '')}/`);
    const defaultPayload = await fetchJson(defaultEndpoint.toString());
    const defaultActive = defaultPayload?.data?.production?.activeUsers;
    record('dashboard_active_devices_use_finalized_day',
      sameNumbers(defaultActive, expectedActive, ['dau', 'wau', 'mau'])
        && String(defaultActive?.asOf ?? '') === String(expectedActive?.asOf ?? ''),
      `default API DAU/WAU/MAU ${Number(defaultActive?.dau ?? 0)}/${Number(defaultActive?.wau ?? 0)}/${Number(defaultActive?.mau ?? 0)} ` +
      `as of ${String(defaultActive?.asOf ?? 'none')}; finalized BigQuery day ${String(expectedActive?.asOf ?? 'none')}`);

    const actualPlatformMap = new Map((production?.activeByPlatform ?? []).map((row) => [String(row.platform), row]));
    const platformMismatches = stablePlatforms.filter((expected) => {
      const actual = actualPlatformMap.get(String(expected.platform));
      const expectedAccounts = Number(expected.mauIdentifiedDevices ?? 0) > 0 ? Number(expected.mauAccounts ?? 0) : null;
      return !actual
        || !sameNumbers(actual, expected, ['dauDevices', 'wauDevices', 'mauDevices'])
        || (actual.accounts ?? null) !== expectedAccounts
        || (actual.dauAccounts ?? null) !== (Number(expected.dauIdentifiedDevices ?? 0) > 0 ? Number(expected.dauAccounts ?? 0) : null)
        || (actual.wauAccounts ?? null) !== (Number(expected.wauIdentifiedDevices ?? 0) > 0 ? Number(expected.wauAccounts ?? 0) : null)
        || (actual.mauAccounts ?? null) !== expectedAccounts;
    });
    record('dashboard_platform_rows_match_bigquery', platformMismatches.length === 0,
      `${stablePlatforms.length} BigQuery platform rows checked; ${platformMismatches.length} mismatch(es)`);
  }

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
  const uatHost = process.env.ONE_APP_UAT_WEB_HOST || 'uat.one.hushh.ai';
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
