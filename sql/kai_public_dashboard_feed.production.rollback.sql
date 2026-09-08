-- Captured 2026-09-07 before replacing the stub (see #28).
-- This is the ORIGINAL hardcoded view: it reads no event table and always
-- reports production_ready = FALSE. Kept only so the change is reversible.
-- Restore with:
--   bq mk --use_legacy_sql=false --view_file=... --project_id=hushh-pda \n--        --force analytics_public.kai_public_dashboard_feed

WITH all_metric_rows AS (
  SELECT
    'status' AS metric_group,
    metric.metric_name,
    CAST(NULL AS DATE) AS metric_date,
    CAST(NULL AS STRING) AS dimension_name,
    CAST(NULL AS STRING) AS dimension_value,
    metric.metric_value,
    metric.metric_count,
    metric.metric_string_value,
    metric.metric_timestamp
  FROM UNNEST([
    STRUCT('source_environment' AS metric_name, CAST(NULL AS FLOAT64) AS metric_value, CAST(NULL AS INT64) AS metric_count, 'production' AS metric_string_value, CAST(NULL AS TIMESTAMP) AS metric_timestamp),
    STRUCT('source_project_id' AS metric_name, CAST(NULL AS FLOAT64) AS metric_value, CAST(NULL AS INT64) AS metric_count, 'hushh-pda' AS metric_string_value, CAST(NULL AS TIMESTAMP) AS metric_timestamp),
    STRUCT('source_dataset' AS metric_name, CAST(NULL AS FLOAT64) AS metric_value, CAST(NULL AS INT64) AS metric_count, 'analytics_526603671' AS metric_string_value, CAST(NULL AS TIMESTAMP) AS metric_timestamp),
    STRUCT('production_ready' AS metric_name, 0.0 AS metric_value, CAST(NULL AS INT64) AS metric_count, 'false' AS metric_string_value, CAST(NULL AS TIMESTAMP) AS metric_timestamp),
    STRUCT('known_blockers' AS metric_name, CAST(NULL AS FLOAT64) AS metric_value, CAST(NULL AS INT64) AS metric_count, "Production GA4 export dataset hushh-pda.analytics_526603671 is not visible/materialized yet." AS metric_string_value, CAST(NULL AS TIMESTAMP) AS metric_timestamp),
    STRUCT('latest_event_at' AS metric_name, CAST(NULL AS FLOAT64) AS metric_value, CAST(NULL AS INT64) AS metric_count, CAST(NULL AS STRING) AS metric_string_value, CAST(NULL AS TIMESTAMP) AS metric_timestamp),
    STRUCT('freshness_lag_minutes' AS metric_name, CAST(NULL AS FLOAT64) AS metric_value, CAST(NULL AS INT64) AS metric_count, CAST(NULL AS STRING) AS metric_string_value, CAST(NULL AS TIMESTAMP) AS metric_timestamp),
    STRUCT('source_event_rows' AS metric_name, 0.0 AS metric_value, 0 AS metric_count, CAST(NULL AS STRING) AS metric_string_value, CAST(NULL AS TIMESTAMP) AS metric_timestamp)
  ]) AS metric
)
SELECT
  CURRENT_TIMESTAMP() AS as_of_timestamp,
  'production' AS source_environment,
  'hushh-pda' AS source_project_id,
  'analytics_526603671' AS source_dataset,
  FALSE AS production_ready,
  "Production GA4 export dataset hushh-pda.analytics_526603671 is not visible/materialized yet." AS known_blockers,
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
