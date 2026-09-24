#!/usr/bin/env node
/** Read-only, aggregate-only inventory of One agent event signals in GA4. */
import { BigQuery } from '@google-cloud/bigquery';

const project = process.env.ONE_APP_GA4_PROJECT || 'hushh-pda';
const dataset = process.env.ONE_APP_GA4_DATASET || 'analytics_526603671';
const jobProject = process.env.BQ_JOB_PROJECT || project;
const webHost = process.env.ONE_APP_WEB_HOST || 'one.hushh.ai';
if (![project, dataset, jobProject].every((part) => /^[A-Za-z0-9_-]+$/.test(part))) {
  throw new Error('Invalid BigQuery project or dataset name');
}

const eventNames = [
  'gmail_connect_started', 'gmail_connect_result', 'gmail_sync_requested',
  'gmail_sync_result', 'hushh_mail_signin_screen_view', 'one_gmail_inbox_viewed',
  'portfolio_viewed', 'recommendation_viewed', 'analysis_stream_started',
  'import_parse_completed', 'import_save_completed', 'one_memory_action',
  'one_wallet_action', 'one_calendar_action', 'one_kyc_action', 'one_crm_action',
];
const end = new Date();
end.setUTCDate(end.getUTCDate() - 1);
const start = new Date(end);
start.setUTCDate(start.getUTCDate() - 29);
const suffix = (date) => date.toISOString().slice(0, 10).replaceAll('-', '');
const window = { start: suffix(start), end: suffix(end) };
const query = `
  WITH source AS (
    SELECT event_name,
      platform,
      user_pseudo_id,
      (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'action') AS action,
      (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'result') AS result
    FROM \`${project}.${dataset}.events_*\`
    WHERE _TABLE_SUFFIX BETWEEN @start AND @end
      AND (
        (platform IN ('IOS', 'ANDROID') AND app_info.id = 'com.hushh.app')
        OR (platform = 'WEB' AND NET.HOST((SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location')) = @webHost)
      )
      AND event_name IN UNNEST(@eventNames)
  )
  SELECT event_name AS eventName,
    CASE
      WHEN event_name = 'gmail_connect_result' AND action = 'complete' AND result = 'success' THEN 'oauth_completed'
      WHEN event_name = 'gmail_connect_result' AND action = 'complete' AND result = 'error' THEN 'oauth_failed'
      WHEN event_name = 'gmail_connect_result' AND action = 'start' AND result = 'success' THEN 'oauth_started'
      WHEN event_name = 'gmail_sync_result' AND action = 'queue' AND result = 'success' THEN 'sync_queued'
      WHEN event_name IN ('import_parse_completed', 'import_save_completed') AND result = 'success' THEN 'import_succeeded'
      ELSE 'other_signal'
    END AS stage,
    COUNT(*) AS signals,
    COUNT(DISTINCT CONCAT(COALESCE(platform, 'UNKNOWN'), ':', user_pseudo_id)) AS devices
  FROM source
  GROUP BY eventName, stage ORDER BY signals DESC
`;
const bq = new BigQuery({ projectId: jobProject });
const [rows] = await bq.query({ query, params: { ...window, webHost, eventNames } });
console.log(JSON.stringify({
  ok: true,
  checkedAt: new Date().toISOString(),
  target: `${project}.${dataset}`,
  window,
  note: 'Aggregate event and device counts; absence is not proof of zero customer use. Native app events may carry env=uat in this GA4 property.',
  events: rows.map((row) => ({ eventName: row.eventName, stage: row.stage, signals: Number(row.signals), devices: Number(row.devices) })),
}, null, 2));
