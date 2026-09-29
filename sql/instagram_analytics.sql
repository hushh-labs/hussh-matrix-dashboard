-- Validate against an isolated test dataset before applying to production.
-- Apply manually; never run at application startup. Instagram IDs are STRING.
CREATE SCHEMA IF NOT EXISTS `hushh-ai-prod.instagram_analytics` OPTIONS(location='US');

CREATE TABLE IF NOT EXISTS `hushh-ai-prod.instagram_analytics.accounts` (
  account_id STRING NOT NULL, username STRING NOT NULL, api_version STRING NOT NULL,
  verified_at TIMESTAMP NOT NULL, last_success_at TIMESTAMP, last_attempt_at TIMESTAMP,
  connection_state STRING NOT NULL, followers_count INT64, media_count INT64,
  counts_observed_at TIMESTAMP,
  inventory_run_id STRING, inventory_window_since TIMESTAMP,
  inventory_complete BOOL, inventory_count INT64, inventory_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS `hushh-ai-prod.instagram_analytics.account_metrics` (
  observation_key STRING NOT NULL, account_id STRING NOT NULL,
  metric_name STRING NOT NULL, value FLOAT64, value_status STRING NOT NULL,
  period STRING NOT NULL, metric_type STRING NOT NULL, unit STRING NOT NULL,
  requested_since TIMESTAMP NOT NULL, requested_until TIMESTAMP NOT NULL,
  provider_since TIMESTAMP, provider_until TIMESTAMP, breakdowns_json STRING,
  api_version STRING NOT NULL, fetched_at TIMESTAMP NOT NULL, sync_run_id STRING NOT NULL
)
PARTITION BY DATE(requested_until)
CLUSTER BY account_id, metric_name
OPTIONS(partition_expiration_days=730);

-- These additive columns also make an existing reach-only test dataset upgradeable.
ALTER TABLE `hushh-ai-prod.instagram_analytics.accounts` ADD COLUMN IF NOT EXISTS followers_count INT64;
ALTER TABLE `hushh-ai-prod.instagram_analytics.accounts` ADD COLUMN IF NOT EXISTS media_count INT64;
ALTER TABLE `hushh-ai-prod.instagram_analytics.accounts` ADD COLUMN IF NOT EXISTS counts_observed_at TIMESTAMP;
ALTER TABLE `hushh-ai-prod.instagram_analytics.accounts` ADD COLUMN IF NOT EXISTS inventory_run_id STRING;
ALTER TABLE `hushh-ai-prod.instagram_analytics.accounts` ADD COLUMN IF NOT EXISTS inventory_window_since TIMESTAMP;
ALTER TABLE `hushh-ai-prod.instagram_analytics.accounts` ADD COLUMN IF NOT EXISTS inventory_complete BOOL;
ALTER TABLE `hushh-ai-prod.instagram_analytics.accounts` ADD COLUMN IF NOT EXISTS inventory_count INT64;
ALTER TABLE `hushh-ai-prod.instagram_analytics.accounts` ADD COLUMN IF NOT EXISTS inventory_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS `hushh-ai-prod.instagram_analytics.media` (
  account_id STRING NOT NULL, media_id STRING NOT NULL, media_type STRING NOT NULL,
  media_product_type STRING,
  permalink STRING NOT NULL, published_at TIMESTAMP NOT NULL,
  like_count INT64, comments_count INT64, fetched_at TIMESTAMP NOT NULL,
  api_version STRING NOT NULL, sync_run_id STRING NOT NULL
)
PARTITION BY DATE(published_at)
CLUSTER BY account_id, media_id
OPTIONS(partition_expiration_days=730);

ALTER TABLE `hushh-ai-prod.instagram_analytics.media` ADD COLUMN IF NOT EXISTS media_product_type STRING;

CREATE TABLE IF NOT EXISTS `hushh-ai-prod.instagram_analytics.media_metrics` (
  observation_key STRING NOT NULL, account_id STRING NOT NULL, media_id STRING NOT NULL,
  published_at TIMESTAMP NOT NULL,
  metric_name STRING NOT NULL, value FLOAT64, value_status STRING NOT NULL,
  period STRING NOT NULL, metric_type STRING NOT NULL, unit STRING NOT NULL,
  provider_since TIMESTAMP, provider_until TIMESTAMP, breakdowns_json STRING,
  api_version STRING NOT NULL, fetched_at TIMESTAMP NOT NULL, sync_run_id STRING NOT NULL
)
PARTITION BY DATE(published_at)
CLUSTER BY account_id, media_id, metric_name
OPTIONS(partition_expiration_days=730);

CREATE TABLE IF NOT EXISTS `hushh-ai-prod.instagram_analytics.sync_runs` (
  run_id STRING NOT NULL, account_id STRING NOT NULL, started_at TIMESTAMP NOT NULL,
  finished_at TIMESTAMP, status STRING NOT NULL, reach_status STRING NOT NULL,
  error_kind STRING, requested_since TIMESTAMP, requested_until TIMESTAMP,
  metric_results_json STRING
)
PARTITION BY DATE(started_at)
CLUSTER BY account_id
OPTIONS(partition_expiration_days=180);

ALTER TABLE `hushh-ai-prod.instagram_analytics.sync_runs` ADD COLUMN IF NOT EXISTS metric_results_json STRING;

CREATE TABLE IF NOT EXISTS `hushh-ai-prod.instagram_analytics.sync_lock` (
  lock_name STRING NOT NULL, owner STRING, lease_until TIMESTAMP NOT NULL
);

-- Insert this row once during migration. BigQuery primary keys are not
-- enforced, so do not re-run an unconditional INSERT.
MERGE `hushh-ai-prod.instagram_analytics.sync_lock` T
USING (SELECT 'company-instagram' AS lock_name) S
ON T.lock_name = S.lock_name
WHEN NOT MATCHED THEN INSERT (lock_name, owner, lease_until)
VALUES (S.lock_name, NULL, TIMESTAMP '1970-01-01 00:00:00+00');
