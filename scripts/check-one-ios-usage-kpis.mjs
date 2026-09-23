#!/usr/bin/env node
/** Read-only, aggregate-only reconciliation of the iOS app-instance/screen KPIs. */
import { BigQuery } from '@google-cloud/bigquery';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const endDate = option('--end', new Date(Date.now() - 86_400_000).toISOString().slice(0, 10));
const startDate = option('--start', new Date(Date.parse(`${endDate}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10));
if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate) {
  throw new Error('Use valid --start and --end dates in YYYY-MM-DD format.');
}
const project = option('--project', process.env.ONE_APP_GA4_PROJECT || 'hushh-pda');
const dataset = option('--dataset', process.env.ONE_APP_GA4_DATASET || 'analytics_526603671');
const jobProject = option('--job-project', process.env.BQ_JOB_PROJECT || 'hushh-ai-prod');
const dashboardUrl = option('--dashboard-url', process.env.METRICS_DASHBOARD_URL || 'https://metrics.hushh.ai');
const ignored = [
  'api_request_completed', 'warmup_completed', 'startup_readiness_warmup_completed',
  'cache_resource_resolved', 'route_readiness_completed', 'route_refresh_completed',
  'web_vital', 'session_start', 'first_visit', 'first_open', 'user_engagement',
  'notification_receive', 'notification_dismiss', 'notification_foreground',
  'app_update', 'os_update', 'one_location_foreground_retry',
].map((name) => `'${name}'`).join(',');

const query = `
  WITH finalized_dates AS (
    SELECT REGEXP_REPLACE(table_name, r'^events_', '') AS suffix
    FROM \`${project}.${dataset}.INFORMATION_SCHEMA.TABLES\`
    WHERE STARTS_WITH(table_name, 'events_') AND NOT STARTS_WITH(table_name, 'events_intraday_')
  )
  SELECT COUNT(*) AS scoped_events,
    COUNT(DISTINCT IF(event_name NOT IN (${ignored}), user_pseudo_id, NULL)) AS active_install_ids,
    COUNTIF(event_name = 'screen_view') AS screen_views,
    COUNTIF(event_name = 'screen_view' AND NULLIF((SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'firebase_screen'), '') IS NOT NULL) AS named_screen_views,
    COUNT(DISTINCT IF(event_name = 'screen_view', NULLIF((SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'firebase_screen'), ''), NULL)) AS distinct_screen_names
  FROM \`${project}.${dataset}.events_*\`
  WHERE REGEXP_REPLACE(_TABLE_SUFFIX, r'^intraday_', '') BETWEEN '${startDate.replaceAll('-', '')}' AND '${endDate.replaceAll('-', '')}'
    AND (NOT STARTS_WITH(_TABLE_SUFFIX, 'intraday_')
      OR REGEXP_REPLACE(_TABLE_SUFFIX, r'^intraday_', '') NOT IN (SELECT suffix FROM finalized_dates))
    AND platform = 'IOS' AND app_info.id = 'com.hushh.app'
`;

try {
  const bigquery = new BigQuery({ projectId: jobProject });
  const [rows] = await bigquery.query({ query, useLegacySql: false, maximumBytesBilled: '5000000000' });
  const expected = rows[0];
  const url = new URL('/api/analytics/one/app', dashboardUrl);
  url.searchParams.set('one_start_date', startDate);
  url.searchParams.set('one_end_date', endDate);
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`Dashboard returned HTTP ${response.status}`);
  const payload = await response.json();
  const actual = payload?.data?.production?.iosUsage;
  if (!actual || actual.bundleId !== 'com.hushh.app') throw new Error('Dashboard iOS usage KPI is missing or unscoped.');
  if (Number(expected.scoped_events) === 0) {
    if (actual.available || actual.activeInstallIds !== null || actual.screenViews !== null) {
      throw new Error('Dashboard presents missing iOS data as zero.');
    }
  } else {
    if (!actual.available) throw new Error('Dashboard iOS usage KPI unexpectedly unavailable.');
    for (const [actualKey, expectedKey] of [
      ['activeInstallIds', 'active_install_ids'], ['screenViews', 'screen_views'],
      ['namedScreenViews', 'named_screen_views'],
    ]) {
      if (Number(actual[actualKey]) !== Number(expected[expectedKey])) {
        throw new Error(`${actualKey} mismatch: dashboard ${actual[actualKey]}, export ${expected[expectedKey]}`);
      }
    }
    const expectedNames = Number(expected.named_screen_views) > 0 ? Number(expected.distinct_screen_names) : null;
    if (actual.distinctScreenNames !== expectedNames) throw new Error('Distinct screen name count mismatch.');
  }
  console.log(JSON.stringify({ status: 'passed', range: { startDate, endDate }, iOS: actual }));
} catch (error) {
  // Keep GCP credential metadata and request internals out of CI logs.
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
