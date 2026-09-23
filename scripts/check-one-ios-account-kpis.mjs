#!/usr/bin/env node
/** Read-only, aggregate-only reconciliation of the One iOS account KPIs. */
import { BigQuery } from '@google-cloud/bigquery';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const yesterday = new Date(Date.now() - 86_400_000);
const endDate = option('--end', yesterday.toISOString().slice(0, 10));
const startDate = option('--start', new Date(Date.parse(`${endDate}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10));
if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate) {
  throw new Error('Use a valid --start and --end date in YYYY-MM-DD format.');
}
const end = endDate.replaceAll('-', '');
const project = option('--project', process.env.ONE_APP_GA4_PROJECT || 'hushh-pda');
const dataset = option('--dataset', process.env.ONE_APP_GA4_DATASET || 'analytics_526603671');
const jobProject = option('--job-project', process.env.BQ_JOB_PROJECT || 'hushh-ai-prod');
const dashboardUrl = option('--dashboard-url', process.env.METRICS_DASHBOARD_URL || 'https://metrics.hushh.ai');
const table = `\`${project}.${dataset}.events_*\``;
const tables = `\`${project}.${dataset}.INFORMATION_SCHEMA.TABLES\``;
const ignored = [
  'api_request_completed', 'warmup_completed', 'startup_readiness_warmup_completed',
  'cache_resource_resolved', 'route_readiness_completed', 'route_refresh_completed',
  'web_vital', 'session_start', 'first_visit', 'first_open', 'user_engagement',
  'notification_receive', 'notification_dismiss', 'notification_foreground',
  'app_update', 'os_update', 'one_location_foreground_retry',
].map((event) => `'${event}'`).join(',');

const query = `
  -- A finalized GA4 daily partition supersedes its intraday counterpart.
  -- Counting both during their overlap can invent extra active accounts.
  WITH finalized_dates AS (
    SELECT REGEXP_REPLACE(table_name, r'^events_', '') AS day_suffix
    FROM ${tables}
    WHERE STARTS_WITH(table_name, 'events_')
      AND NOT STARTS_WITH(table_name, 'events_intraday_')
  ), canonical_events AS (
    SELECT user_id AS account_id, PARSE_DATE('%Y%m%d', event_date) AS day
    FROM ${table}
    WHERE REGEXP_CONTAINS(_TABLE_SUFFIX, r'^(intraday_)?[0-9]{8}$')
      AND REGEXP_REPLACE(_TABLE_SUFFIX, r'^intraday_', '') <= '${end}'
      AND (NOT STARTS_WITH(_TABLE_SUFFIX, 'intraday_')
        OR REGEXP_REPLACE(_TABLE_SUFFIX, r'^intraday_', '') NOT IN (SELECT day_suffix FROM finalized_dates))
      AND platform = 'IOS' AND app_info.id = 'com.hushh.app'
      AND event_name NOT IN (${ignored})
      AND user_id IS NOT NULL AND user_id != ''
  ), history AS (
    SELECT account_id, MIN(day) AS first_seen
    FROM canonical_events
    GROUP BY account_id
  ),
  in_range AS (
    SELECT DISTINCT account_id
    FROM canonical_events
    WHERE day BETWEEN DATE '${startDate}' AND DATE '${endDate}'
  )
  SELECT COUNT(*) AS total_users,
    COUNTIF(first_seen BETWEEN DATE '${startDate}' AND DATE '${endDate}') AS first_observed_users,
    COUNTIF(first_seen < DATE '${startDate}') AS previously_observed_users,
    COUNTIF(NOT REGEXP_CONTAINS(account_id, r'^[0-9a-f]{32}$')) AS malformed_account_ids
  FROM in_range JOIN history USING (account_id)
`;

const bigquery = new BigQuery({ projectId: jobProject });
const [rows] = await bigquery.query({ query, useLegacySql: false, maximumBytesBilled: '5000000000' });
const expected = rows[0];
if (Number(expected.malformed_account_ids) !== 0) {
  throw new Error('One iOS export contains account IDs outside the salted-digest contract.');
}
const url = new URL('/api/analytics/one/app', dashboardUrl);
url.searchParams.set('one_start_date', startDate);
url.searchParams.set('one_end_date', endDate);
const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
if (!response.ok) throw new Error(`Dashboard returned HTTP ${response.status}`);
const payload = await response.json();
const actual = payload?.data?.production?.iosIdentifiedUsers;
if (!actual || actual.bundleId !== 'com.hushh.app' || actual.countingUnit !== 'account') {
  throw new Error('Dashboard iOS account KPI is unavailable or incorrectly scoped.');
}
if (Number(expected.total_users) === 0) {
  if (actual.available || actual.totalUsers !== null || actual.firstObservedUsers !== null || actual.previouslyObservedUsers !== null) {
    throw new Error('Dashboard presents anonymous iOS activity as a measured zero-account audience.');
  }
  console.log(JSON.stringify({ status: 'passed', range: { startDate, endDate }, iOS: { available: false } }));
  process.exit(0);
}
if (!actual.available) throw new Error('Dashboard iOS account KPI unexpectedly unavailable.');
for (const [actualKey, expectedKey] of [
  ['totalUsers', 'total_users'],
  ['firstObservedUsers', 'first_observed_users'],
  ['previouslyObservedUsers', 'previously_observed_users'],
]) {
  if (Number(actual[actualKey]) !== Number(expected[expectedKey])) {
    throw new Error(`${actualKey} mismatch: dashboard ${actual[actualKey]}, independent export ${expected[expectedKey]}`);
  }
}
if (Number(actual.firstObservedUsers) + Number(actual.previouslyObservedUsers) !== Number(actual.totalUsers)) {
  throw new Error('iOS first-observed and previously-observed counts do not partition total accounts.');
}
console.log(JSON.stringify({
  status: 'passed',
  range: { startDate, endDate },
  iOS: { totalUsers: actual.totalUsers, firstObservedUsers: actual.firstObservedUsers, previouslyObservedUsers: actual.previouslyObservedUsers },
}));
