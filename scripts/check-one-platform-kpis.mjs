#!/usr/bin/env node
/** Independently reconcile selected-range One web/iOS/Android aggregate cards. */
import { BigQuery } from '@google-cloud/bigquery';
import { oneSurfaceSql } from '../src/server/one-scope.mjs';

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
const environment = option('--environment', 'production');
if (!['production', 'uat'].includes(environment)) throw new Error('Use production or uat for --environment.');
const project = option('--project', environment === 'uat' ? 'hushh-pda-uat' : (process.env.ONE_APP_GA4_PROJECT || 'hushh-pda'));
const dataset = option('--dataset', environment === 'uat' ? 'analytics_533362555' : (process.env.ONE_APP_GA4_DATASET || 'analytics_526603671'));
const webHost = environment === 'uat' ? 'uat.one.hushh.ai' : 'one.hushh.ai';
const jobProject = option('--job-project', process.env.BQ_JOB_PROJECT || 'hushh-ai-prod');
const dashboardUrl = option('--dashboard-url', process.env.METRICS_DASHBOARD_URL || 'https://metrics.hushh.ai');
const excluded = [
  'api_request_completed', 'warmup_completed', 'startup_readiness_warmup_completed',
  'cache_resource_resolved', 'route_readiness_completed', 'route_refresh_completed',
  'web_vital', 'session_start', 'first_visit', 'first_open', 'user_engagement',
  'notification_receive', 'notification_dismiss', 'notification_foreground',
  'app_update', 'os_update', 'one_location_foreground_retry',
].map((name) => `'${name}'`).join(',');
const startSuffix = startDate.replaceAll('-', '');
const endSuffix = endDate.replaceAll('-', '');

const query = `
  WITH finalized_dates AS (
    SELECT REGEXP_REPLACE(table_name, r'^events_', '') AS suffix
    FROM \`${project}.${dataset}.INFORMATION_SCHEMA.TABLES\`
    WHERE STARTS_WITH(table_name, 'events_') AND NOT STARTS_WITH(table_name, 'events_intraday_')
  ), scoped AS (
    SELECT platform, user_pseudo_id, NULLIF(user_id, '') AS account_id, event_name,
      NULLIF((SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'route_id'), '') AS route_id
    FROM \`${project}.${dataset}.events_*\`
    WHERE REGEXP_REPLACE(_TABLE_SUFFIX, r'^intraday_', '') BETWEEN '${startSuffix}' AND '${endSuffix}'
      AND (NOT STARTS_WITH(_TABLE_SUFFIX, 'intraday_')
        OR REGEXP_REPLACE(_TABLE_SUFFIX, r'^intraday_', '') NOT IN (SELECT suffix FROM finalized_dates))
      AND ${oneSurfaceSql(webHost, environment)}
  ), valid_routes AS (
    SELECT platform, route_id FROM scoped
    WHERE event_name = 'page_view' AND REGEXP_CONTAINS(route_id, r'^[a-z][a-z0-9_]{0,60}$')
      AND NOT REGEXP_CONTAINS(route_id, r'(^unknown$|^logout$|oauth_return$|_legacy_redirect$|^oauth_authorize$)')
  ), route_counts AS (
    SELECT platform, route_id, COUNT(*) AS visits FROM valid_routes GROUP BY platform, route_id
  ), route_summary AS (
    SELECT platform, SUM(visits) AS named_route_visits, COUNT(*) AS distinct_screens,
      ARRAY_AGG(STRUCT(route_id, visits) ORDER BY visits DESC, route_id LIMIT 5) AS top_screens
    FROM route_counts GROUP BY platform
  ), activity AS (
    SELECT platform, COUNT(DISTINCT user_pseudo_id) AS all_ids, COUNT(*) AS events,
      COUNT(DISTINCT IF(event_name NOT IN (${excluded}), user_pseudo_id, NULL)) AS active_ids,
      COUNT(DISTINCT IF(event_name NOT IN (${excluded}), account_id, NULL)) AS accounts,
      COUNTIF(event_name = 'page_view') AS route_visits
    FROM scoped GROUP BY platform
  )
  SELECT activity.*, COALESCE(route_summary.named_route_visits, 0) AS named_route_visits,
    COALESCE(route_summary.distinct_screens, 0) AS distinct_screens, route_summary.top_screens
  FROM activity LEFT JOIN route_summary USING (platform)
  ORDER BY platform
`;

try {
  const bigquery = new BigQuery({ projectId: jobProject });
  const [rows] = await bigquery.query({ query, useLegacySql: false, maximumBytesBilled: '5000000000' });
  const endpoint = new URL('/api/analytics/one/app', dashboardUrl);
  endpoint.searchParams.set('one_start_date', startDate);
  endpoint.searchParams.set('one_end_date', endDate);
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`Dashboard returned HTTP ${response.status}`);
  const payload = await response.json();
  const summary = payload?.data?.[environment];
  if (!summary || summary.platformsAvailable !== true || !Array.isArray(summary.platforms)) {
    throw new Error(`${environment} platform aggregates are unavailable.`);
  }
  if (summary.platforms.length !== rows.length) throw new Error('Platform row count differs from the export.');
  const actual = new Map(summary.platforms.map((row) => [row.platform, row]));
  for (const expected of rows) {
    const found = actual.get(expected.platform);
    if (!found) throw new Error(`Missing ${expected.platform} platform row.`);
    for (const [key, source] of [
      ['users', 'all_ids'], ['events', 'events'], ['activeDeviceIds', 'active_ids'],
      ['activeAccounts', 'accounts'], ['routeVisits', 'route_visits'],
      ['namedRouteVisits', 'named_route_visits'],
    ]) {
      if (Number(found[key]) !== Number(expected[source])) {
        throw new Error(`${expected.platform}.${key} differs from GA4 export.`);
      }
    }
    const distinctScreens = Number(expected.named_route_visits) > 0 ? Number(expected.distinct_screens) : null;
    if (found.distinctScreens !== distinctScreens) throw new Error(`${expected.platform} distinct screen count differs.`);
    const topScreens = expected.top_screens ?? [];
    if (found.topProductScreens?.length !== topScreens.length) throw new Error(`${expected.platform} top screen count differs.`);
    for (let i = 0; i < topScreens.length; i += 1) {
      if (found.topProductScreens[i]?.routeId !== topScreens[i].route_id
        || Number(found.topProductScreens[i]?.visits) !== Number(topScreens[i].visits)) {
        throw new Error(`${expected.platform} top screen ranking differs.`);
      }
    }
  }
  console.log(JSON.stringify({ status: 'passed', environment, range: { startDate, endDate }, platforms: rows.map((row) => ({
    platform: row.platform, activeAccountIds: Number(row.accounts), activeBrowserOrAppIds: Number(row.active_ids),
    namedRouteVisits: Number(row.named_route_visits), distinctScreens: Number(row.distinct_screens),
  })) }));
} catch (error) {
  console.error(JSON.stringify({ status: 'failed', reason: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
}
