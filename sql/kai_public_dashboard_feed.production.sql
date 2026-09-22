-- hushh-pda.analytics_public.kai_public_dashboard_feed (production)
--
-- Replaces the hardcoded stub that returned production_ready = FALSE and the
-- string "Production GA4 export dataset hushh-pda.analytics_526603671 is not
-- visible/materialized yet." That dataset has been exporting daily since
-- 2026-05-01. The stub read no event table, so every production number the
-- dashboard rendered from this feed was a constant.
--
-- Contract: one long row per metric, consumed by
-- src/lib/analytics-service.ts (parseStatus / parseUsageSummary / parseFunnel /
-- parseDailyUsage / parsePlatformMix / parseFeatureEngagement /
-- parseInstrumentationHealth / parseActivationMetrics). Group names and metric
-- names below are load-bearing -- the parser looks them up by literal string.
--
-- Aggregate-only by construction: every row is a COUNT or a ratio. No user
-- identifier, page path, query, prompt or free-text value is emitted.
--
-- SCOPE. The property carries three things: the One app (native + one.hushh.ai),
-- hushh.ai marketing pages, and historical test-host traffic. This feed is the *app* surface
-- only. Marketing traffic would more than double the denominator and flatter
-- every conversion rate; UAT traffic is not a production KPI. Both exclusions
-- are reported in the status group rather than being silent.
--
-- IDENTITY. Counts use platform:user_pseudo_id, which is a namespaced
-- device/browser identity, not a person. GA4 User-ID is bound on iOS and not at
-- all on web, so a person-scoped count is not available for the whole surface
-- today. The status group carries the basis and the measured web coverage so
-- the dashboard can label it honestly instead of calling devices "people".
WITH params AS (
  SELECT
    -- The last day the daily export actually produced, not "yesterday". GA4
    -- lands a day or more late; pinning to yesterday reports DAU 0 on a
    -- perfectly healthy pipeline.
    --
    -- The 8-digit suffix test excludes events_intraday_*, which the events_*
    -- wildcard otherwise matches. Without it the newest "day" is the current,
    -- still-accumulating one: DAU would read as a partial count all day and
    -- every morning would look like a collapse.
    (SELECT MAX(PARSE_DATE('%Y%m%d', event_date))
     FROM `hushh-pda.analytics_526603671.events_*`
     WHERE REGEXP_CONTAINS(_TABLE_SUFFIX, r'^[0-9]{8}$')
       AND _TABLE_SUFFIX >= FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE('UTC'), INTERVAL 10 DAY))) AS latest_day
),
scoped AS (
  SELECT
    PARSE_DATE('%Y%m%d', e.event_date) AS d,
    e.user_pseudo_id,
    e.user_id,
    e.event_name,
    e.platform,
    e.stream_id,
    e.event_timestamp,
    CONCAT(COALESCE(e.platform, 'UNKNOWN'), ':', e.user_pseudo_id) AS device_key,
    CONCAT(
      COALESCE(e.platform, 'UNKNOWN'), ':', e.user_pseudo_id, ':',
      CAST((SELECT value.int_value FROM UNNEST(e.event_params) WHERE key = 'ga_session_id') AS STRING)
    ) AS session_key,
    (SELECT value.string_value FROM UNNEST(e.event_params) WHERE key = 'journey') AS journey,
    (SELECT value.string_value FROM UNNEST(e.event_params) WHERE key = 'step') AS step,
    (SELECT value.string_value FROM UNNEST(e.event_params) WHERE key = 'event_category') AS event_category,
    (SELECT value.string_value FROM UNNEST(e.event_params) WHERE key = 'app_version') AS app_version,
    (SELECT value.string_value FROM UNNEST(e.event_params) WHERE key = 'entry_surface') AS entry_surface
  FROM `hushh-pda.analytics_526603671.events_*` e, params p
  WHERE REGEXP_CONTAINS(e._TABLE_SUFFIX, r'^[0-9]{8}$')
    AND PARSE_DATE('%Y%m%d', e.event_date) BETWEEN DATE_SUB(p.latest_day, INTERVAL 89 DAY) AND p.latest_day
    AND (
      e.platform IN ('IOS', 'ANDROID')
      OR NET.HOST((SELECT value.string_value FROM UNNEST(e.event_params) WHERE key = 'page_location')) = 'one.hushh.ai'
    )
),
-- Machine-generated traffic. Kept out of "active user" and feature counts;
-- an HTTP request is not a person and a cache warm is not a use.
background AS (
  SELECT ['api_request_completed','warmup_completed','startup_readiness_warmup_completed',
          'cache_resource_resolved','route_readiness_completed','route_refresh_completed',
          'web_vital','session_start','first_visit','first_open','user_engagement',
          'notification_receive','notification_dismiss','notification_foreground',
          'app_update','os_update','one_location_foreground_retry'] AS names
),
meaningful AS (
  SELECT s.* FROM scoped s, background b WHERE s.event_name NOT IN UNNEST(b.names)
),
daily AS (
  SELECT
    d,
    COUNT(DISTINCT device_key) AS dau,
    COUNT(DISTINCT session_key) AS sessions,
    COUNT(*) AS total_events
  FROM meaningful
  GROUP BY d
),
-- Rolling windows, computed as distinct counts over the window. Never as a sum
-- of the daily figures above: over the verified window that overstated by 38%.
windows AS (
  SELECT
    p.latest_day,
    (SELECT COUNT(DISTINCT device_key) FROM meaningful WHERE d = p.latest_day) AS dau,
    (SELECT COUNT(DISTINCT device_key) FROM meaningful WHERE d BETWEEN DATE_SUB(p.latest_day, INTERVAL 6 DAY) AND p.latest_day) AS wau,
    (SELECT COUNT(DISTINCT device_key) FROM meaningful WHERE d BETWEEN DATE_SUB(p.latest_day, INTERVAL 29 DAY) AND p.latest_day) AS mau,
    (SELECT COUNT(DISTINCT session_key) FROM meaningful WHERE d = p.latest_day) AS sessions,
    (SELECT COUNT(*) FROM meaningful WHERE d = p.latest_day) AS total_events
  FROM params p
),
source_state AS (
  SELECT
    p.latest_day,
    (SELECT COUNT(*) FROM scoped) AS source_event_rows,
    (SELECT MAX(TIMESTAMP_MICROS(event_timestamp)) FROM scoped) AS latest_event_at,
    (SELECT COUNT(DISTINCT device_key) FROM scoped WHERE platform = 'WEB') AS web_devices,
    (SELECT COUNT(DISTINCT user_id) FROM scoped WHERE platform = 'WEB') AS web_keyed
  FROM params p
),
status_rows AS (
  SELECT 'status' AS metric_group, m.metric_name, CAST(NULL AS DATE) AS metric_date,
         CAST(NULL AS STRING) AS dimension_name, CAST(NULL AS STRING) AS dimension_value,
         m.metric_value, m.metric_count, m.metric_string_value, m.metric_timestamp
  FROM source_state ss, UNNEST([
    STRUCT('source_environment' AS metric_name, CAST(NULL AS FLOAT64) AS metric_value, CAST(NULL AS INT64) AS metric_count, 'production' AS metric_string_value, CAST(NULL AS TIMESTAMP) AS metric_timestamp),
    STRUCT('source_project_id', CAST(NULL AS FLOAT64), CAST(NULL AS INT64), 'hushh-pda', CAST(NULL AS TIMESTAMP)),
    STRUCT('source_dataset', CAST(NULL AS FLOAT64), CAST(NULL AS INT64), 'analytics_526603671', CAST(NULL AS TIMESTAMP)),
    STRUCT('production_ready', 1.0, CAST(NULL AS INT64), 'true', CAST(NULL AS TIMESTAMP)),
    STRUCT('known_blockers', CAST(NULL AS FLOAT64), CAST(NULL AS INT64),
      CASE WHEN ss.web_keyed = 0 AND ss.web_devices > 0
        THEN 'Counts are device-scoped (platform:user_pseudo_id). GA4 User-ID is bound on iOS but not on web, so these are devices and browsers, not people, and web and app figures cannot be added together.'
        ELSE NULL END, CAST(NULL AS TIMESTAMP)),
    STRUCT('identity_basis', CAST(NULL AS FLOAT64), CAST(NULL AS INT64), 'platform:user_pseudo_id', CAST(NULL AS TIMESTAMP)),
    STRUCT('surface_scope', CAST(NULL AS FLOAT64), CAST(NULL AS INT64), 'One app only: native iOS/Android plus one.hushh.ai. Excludes hushh.ai marketing pages and test web hosts.', CAST(NULL AS TIMESTAMP)),
    STRUCT('latest_event_at', CAST(NULL AS FLOAT64), CAST(NULL AS INT64), CAST(NULL AS STRING), ss.latest_event_at),
    STRUCT('freshness_lag_minutes', CAST(TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), ss.latest_event_at, MINUTE) AS FLOAT64), CAST(NULL AS INT64), CAST(NULL AS STRING), CAST(NULL AS TIMESTAMP)),
    STRUCT('source_event_rows', CAST(ss.source_event_rows AS FLOAT64), ss.source_event_rows, CAST(NULL AS STRING), CAST(NULL AS TIMESTAMP)),
    STRUCT('web_user_id_coverage_devices', CAST(ss.web_keyed AS FLOAT64), ss.web_keyed, CAST(NULL AS STRING), CAST(NULL AS TIMESTAMP))
  ]) AS m
),
summary_rows AS (
  SELECT 'summary', m.metric_name, CAST(NULL AS DATE), CAST(NULL AS STRING), CAST(NULL AS STRING),
         m.metric_value, m.metric_count, CAST(NULL AS STRING), CAST(NULL AS TIMESTAMP)
  FROM windows w, UNNEST([
    STRUCT('current_dau' AS metric_name, CAST(w.dau AS FLOAT64) AS metric_value, w.dau AS metric_count),
    STRUCT('current_wau', CAST(w.wau AS FLOAT64), w.wau),
    STRUCT('current_mau', CAST(w.mau AS FLOAT64), w.mau),
    STRUCT('current_dau_mau_stickiness', IF(w.mau > 0, w.dau / w.mau, NULL), CAST(NULL AS INT64)),
    STRUCT('current_sessions', CAST(w.sessions AS FLOAT64), w.sessions),
    STRUCT('current_total_events', CAST(w.total_events AS FLOAT64), w.total_events)
  ]) AS m
),
usage_rows AS (
  SELECT 'usage', m.metric_name, d.d, CAST(NULL AS STRING), CAST(NULL AS STRING),
         m.metric_value, m.metric_count, CAST(NULL AS STRING), CAST(NULL AS TIMESTAMP)
  FROM daily d, UNNEST([
    STRUCT('daily_active_users' AS metric_name, CAST(d.dau AS FLOAT64) AS metric_value, d.dau AS metric_count),
    STRUCT('sessions', CAST(d.sessions AS FLOAT64), d.sessions),
    STRUCT('total_events', CAST(d.total_events AS FLOAT64), d.total_events)
  ]) AS m
),
-- Rolling figures repeated on the latest day so parseUsageMetrics, which reads
-- only the newest dated row per group, can show WAU/MAU/stickiness alongside DAU.
usage_rolling_rows AS (
  SELECT 'usage', m.metric_name, w.latest_day, CAST(NULL AS STRING), CAST(NULL AS STRING),
         m.metric_value, m.metric_count, CAST(NULL AS STRING), CAST(NULL AS TIMESTAMP)
  FROM windows w, UNNEST([
    STRUCT('weekly_active_users' AS metric_name, CAST(w.wau AS FLOAT64) AS metric_value, w.wau AS metric_count),
    STRUCT('monthly_active_users', CAST(w.mau AS FLOAT64), w.mau),
    STRUCT('dau_mau_stickiness', IF(w.mau > 0, w.dau / w.mau, NULL), CAST(NULL AS INT64))
  ]) AS m
),
platform_rows AS (
  SELECT 'platform_mix', m.metric_name, w.latest_day, 'platform', pm.platform,
         m.metric_value, m.metric_count, CAST(NULL AS STRING), CAST(NULL AS TIMESTAMP)
  FROM windows w,
    -- Scoped to the same trailing 30 days as MAU. A 90-day mix next to a
    -- 30-day MAU invites the reader to divide one by the other.
    (SELECT COALESCE(m.platform, '(not set)') AS platform,
            COUNT(DISTINCT m.device_key) AS users, COUNT(*) AS events
     FROM meaningful m, params p
     WHERE m.d BETWEEN DATE_SUB(p.latest_day, INTERVAL 29 DAY) AND p.latest_day
     GROUP BY platform) pm,
    UNNEST([
      STRUCT('users' AS metric_name, CAST(pm.users AS FLOAT64) AS metric_value, pm.users AS metric_count),
      STRUCT('events', CAST(pm.events AS FLOAT64), pm.events)
    ]) AS m
),
-- Journey steps are independent distinct-device reach counts over the trailing
-- 30 days, not a nested cohort. Steps with no emitter yet return 0 rather than
-- being absent, so the UI can expose an instrumentation gap without inventing
-- a conversion rate or shifting later steps up one position.
funnel_base AS (
  SELECT journey, step, COUNT(DISTINCT device_key) AS users
  FROM meaningful m, params p
  WHERE m.event_name = 'growth_funnel_step_completed'
    AND m.d BETWEEN DATE_SUB(p.latest_day, INTERVAL 29 DAY) AND p.latest_day
    AND m.journey IS NOT NULL AND m.step IS NOT NULL
  GROUP BY journey, step
  UNION ALL
  SELECT 'investor', 'activated', COUNT(DISTINCT device_key)
  FROM meaningful m, params p
  WHERE m.event_name = 'investor_activation_completed'
    AND m.d BETWEEN DATE_SUB(p.latest_day, INTERVAL 29 DAY) AND p.latest_day
  UNION ALL
  SELECT 'ria', 'activated', COUNT(DISTINCT device_key)
  FROM meaningful m, params p
  WHERE m.event_name = 'ria_activation_completed'
    AND m.d BETWEEN DATE_SUB(p.latest_day, INTERVAL 29 DAY) AND p.latest_day
),
funnel_rows AS (
  SELECT CONCAT(spec.journey, '_funnel'), spec.step, w.latest_day, CAST(NULL AS STRING), CAST(NULL AS STRING),
         CAST(COALESCE(fb.users, 0) AS FLOAT64), COALESCE(fb.users, 0), CAST(NULL AS STRING), CAST(NULL AS TIMESTAMP)
  FROM windows w
  CROSS JOIN UNNEST([
    STRUCT('investor' AS journey, 'entered' AS step), STRUCT('investor', 'auth_completed'),
    STRUCT('investor', 'vault_ready'), STRUCT('investor', 'onboarding_completed'),
    STRUCT('investor', 'portfolio_ready'), STRUCT('investor', 'activated'),
    STRUCT('ria', 'entered'), STRUCT('ria', 'auth_completed'), STRUCT('ria', 'profile_submitted'),
    STRUCT('ria', 'request_created'), STRUCT('ria', 'workspace_ready'), STRUCT('ria', 'activated')
  ]) AS spec
  LEFT JOIN funnel_base fb ON fb.journey = spec.journey AND fb.step = spec.step
),
activation_rows AS (
  SELECT 'activation', m.metric_name, w.latest_day, CAST(NULL AS STRING), CAST(NULL AS STRING),
         m.metric_value, CAST(NULL AS INT64), CAST(NULL AS STRING), CAST(NULL AS TIMESTAMP)
  FROM windows w,
    (SELECT
       (SELECT COALESCE(SUM(users), 0) FROM funnel_base WHERE journey = 'investor' AND step = 'entered') AS inv_entered,
       (SELECT COALESCE(SUM(users), 0) FROM funnel_base WHERE journey = 'investor' AND step = 'activated') AS inv_activated,
       (SELECT COALESCE(SUM(users), 0) FROM funnel_base WHERE journey = 'ria' AND step = 'entered') AS ria_entered,
       (SELECT COALESCE(SUM(users), 0) FROM funnel_base WHERE journey = 'ria' AND step = 'activated') AS ria_activated) a,
    UNNEST([
      STRUCT('investor_activation_rate' AS metric_name, IF(a.inv_entered > 0, a.inv_activated / a.inv_entered, NULL) AS metric_value),
      STRUCT('ria_activation_rate', IF(a.ria_entered > 0, a.ria_activated / a.ria_entered, NULL))
    ]) AS m
),
feature_rows AS (
  SELECT 'feature_engagement', f.event_name, f.d, CAST(NULL AS STRING), CAST(NULL AS STRING),
         CAST(f.users AS FLOAT64), f.users, CAST(NULL AS STRING), CAST(NULL AS TIMESTAMP)
  FROM (
    SELECT m.d, m.event_name, COUNT(DISTINCT m.device_key) AS users
    FROM meaningful m, params p
    WHERE m.d BETWEEN DATE_SUB(p.latest_day, INTERVAL 7 DAY) AND p.latest_day
      AND m.event_category = 'feature'
    GROUP BY m.d, m.event_name
  ) f
),
-- Instrumentation health is about the governed events only: the ones the
-- observability contract requires shared params on. Counting ungoverned GA4
-- automatic events here would report a permanent, meaningless deficit.
health AS (
  SELECT
    COUNTIF(event_category IS NOT NULL) AS governed_events,
    COUNTIF(event_category IS NULL) AS missing_event_category_events,
    COUNTIF(app_version IS NULL AND event_category IS NOT NULL) AS missing_app_version_events,
    COUNTIF(event_name = 'growth_funnel_step_completed' AND journey IS NULL) AS missing_journey_events,
    COUNTIF(event_name = 'growth_funnel_step_completed' AND step IS NULL) AS missing_step_events,
    COUNTIF(event_name = 'growth_funnel_step_completed' AND entry_surface IS NULL) AS missing_entry_surface_events,
    COUNT(DISTINCT platform) AS platforms_seen,
    COUNT(DISTINCT stream_id) AS streams_seen
  FROM meaningful m, params p
  WHERE m.d BETWEEN DATE_SUB(p.latest_day, INTERVAL 6 DAY) AND p.latest_day
),
health_rows AS (
  SELECT 'instrumentation_health', m.metric_name, w.latest_day, CAST(NULL AS STRING), CAST(NULL AS STRING),
         m.metric_value, m.metric_count, CAST(NULL AS STRING), CAST(NULL AS TIMESTAMP)
  FROM windows w, health h, UNNEST([
    STRUCT('governed_events' AS metric_name, CAST(h.governed_events AS FLOAT64) AS metric_value, h.governed_events AS metric_count),
    STRUCT('missing_event_category_events', CAST(h.missing_event_category_events AS FLOAT64), h.missing_event_category_events),
    STRUCT('missing_app_version_events', CAST(h.missing_app_version_events AS FLOAT64), h.missing_app_version_events),
    STRUCT('missing_journey_events', CAST(h.missing_journey_events AS FLOAT64), h.missing_journey_events),
    STRUCT('missing_step_events', CAST(h.missing_step_events AS FLOAT64), h.missing_step_events),
    STRUCT('missing_entry_surface_events', CAST(h.missing_entry_surface_events AS FLOAT64), h.missing_entry_surface_events),
    STRUCT('platforms_seen', CAST(h.platforms_seen AS FLOAT64), h.platforms_seen),
    STRUCT('streams_seen', CAST(h.streams_seen AS FLOAT64), h.streams_seen)
  ]) AS m
),
all_metric_rows AS (
  SELECT * FROM status_rows
  UNION ALL SELECT * FROM summary_rows
  UNION ALL SELECT * FROM usage_rows
  UNION ALL SELECT * FROM usage_rolling_rows
  UNION ALL SELECT * FROM platform_rows
  UNION ALL SELECT * FROM funnel_rows
  UNION ALL SELECT * FROM activation_rows
  UNION ALL SELECT * FROM feature_rows
  UNION ALL SELECT * FROM health_rows
)
SELECT
  CURRENT_TIMESTAMP() AS as_of_timestamp,
  'production' AS source_environment,
  'hushh-pda' AS source_project_id,
  'analytics_526603671' AS source_dataset,
  TRUE AS production_ready,
  (SELECT metric_string_value FROM status_rows WHERE metric_name = 'known_blockers') AS known_blockers,
  metric_group,
  metric_name,
  metric_date,
  dimension_name,
  dimension_value,
  metric_value,
  metric_count,
  metric_string_value,
  metric_timestamp
FROM all_metric_rows
