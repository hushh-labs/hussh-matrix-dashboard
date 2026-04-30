# Deploy `metrics.hushh.ai`

This runbook deploys the Hussh Matrix Dashboard to Cloud Run as
`https://metrics.hushh.ai`.

For the hosted-site operating handoff, current go-live state, and post-DNS
verification checklist, see
[Hosted `metrics.hushh.ai` Handoff](./metrics-hushh-ai-hosting-handoff.md).

## Target

- Google Cloud project: `hushh-ai-prod`
- Region: `us-central1`
- Cloud Run service: `hushh-matrix-dashboard`
- Runtime service account: `metrics-dashboard-runtime@hushh-ai-prod.iam.gserviceaccount.com`
- Artifact Registry repository: `us-central1-docker.pkg.dev/hushh-ai-prod/website-images`
- Custom domain: `metrics.hushh.ai`
- DNS provider: Namecheap BasicDNS for `hushh.ai`

Useful links:

- [Cloud Run services](https://console.cloud.google.com/run?project=hushh-ai-prod)
- [Cloud Run domain mappings](https://console.cloud.google.com/run/domains?project=hushh-ai-prod)
- [Secret Manager](https://console.cloud.google.com/security/secret-manager?project=hushh-ai-prod)
- [Namecheap Advanced DNS for hushh.ai](https://ap.www.namecheap.com/domains/domaincontrolpanel/hushh.ai/advancedns)
- [Cloud Run deploy from source](https://cloud.google.com/run/docs/deploying-source-code)
- [Cloud Run custom domains](https://cloud.google.com/run/docs/mapping-custom-domains)
- [Cloud Run secrets](https://cloud.google.com/run/docs/configuring/services/secrets)
- [Namecheap CNAME guide](https://www.namecheap.com/support/knowledgebase/article.aspx/9646/2237/how-to-create-a-cname-record-for-your-domain/)

## Variables

```bash
PROJECT=hushh-ai-prod
REGION=us-central1
SERVICE=hushh-matrix-dashboard
DOMAIN=metrics.hushh.ai
SA_NAME=metrics-dashboard-runtime
SA_EMAIL="$SA_NAME@$PROJECT.iam.gserviceaccount.com"
IMAGE="us-central1-docker.pkg.dev/$PROJECT/website-images/$SERVICE:$(git rev-parse --short HEAD)"
HUSHHTECH_SEARCH_FALLBACK_DATASET=hushhtech_search_console_api
HUSHHTECH_SEARCH_INGEST_JOB=hushhtech-search-console-ingest
HUSHHTECH_SEARCH_INGEST_SA="hushhtech-gsc-ingest@$PROJECT.iam.gserviceaccount.com"
HUSHHTECH_SEARCH_SCHEDULER_SA="hushhtech-gsc-scheduler@$PROJECT.iam.gserviceaccount.com"
HUSHHTECH_SEARCH_OAUTH_SECRET=hushhtech-search-console-oauth
SEARCH_CONSOLE_OAUTH_SECRET=metrics-dashboard-search-console-oauth
GEMINI_API_KEY_SECRET=hushh-gemini-api-key
HUSHH_AI_SEARCH_FALLBACK_DATASET=hushh_ai_search_console_api
HUSHH_AI_SEARCH_INGEST_JOB=hushh-ai-search-console-ingest
HUSHH_AI_SEARCH_INGEST_SA="hushh-ai-gsc-ingest@$PROJECT.iam.gserviceaccount.com"
HUSHH_AI_SEARCH_SCHEDULER_SA="hushh-ai-gsc-scheduler@$PROJECT.iam.gserviceaccount.com"
KAI_SEARCH_FALLBACK_DATASET=kai_search_console_api
KAI_SEARCH_INGEST_JOB=kai-search-console-ingest
KAI_SEARCH_INGEST_SA="kai-gsc-ingest@$PROJECT.iam.gserviceaccount.com"
KAI_SEARCH_SCHEDULER_SA="kai-gsc-scheduler@$PROJECT.iam.gserviceaccount.com"
```

## Preflight

```bash
npm run lint
npm run build
rg "sbp_|SUPABASE_ACCESS_TOKEN=.+" . --glob '!node_modules/**' --glob '!dist/**' --glob '!package-lock.json'
```

## Deploy On Main

Production redeploys automatically from GitHub Actions on every push to
`main`.

- Workflow: `.github/workflows/deploy-main.yml`
- Trigger: `push` to `main`, plus `workflow_dispatch`
- GCP deploy service account:
  `github-actions-deployer@hushh-ai-prod.iam.gserviceaccount.com`
- Workload Identity provider:
  `projects/1072839345524/locations/global/workloadIdentityPools/github-actions/providers/github-hussh-matrix-dashboard`
- Provider condition: only `hushh-labs/hussh-matrix-dashboard` on
  `refs/heads/main`
- Runtime service account remains:
  `metrics-dashboard-runtime@hushh-ai-prod.iam.gserviceaccount.com`

The workflow gates deployment with `npm ci`, `npm run lint`,
`npm run build`, `git diff --check`, and a tracked-file secret pattern scan.
It builds a commit-SHA-tagged image, deploys `hushh-matrix-dashboard`, verifies
runtime env vars are Secret Manager-backed, then runs:

```bash
npm run test:prod:metrics-flow -- --dashboard-url https://metrics.hushh.ai --timeout-ms 120000
npm run test:prod:hushh-ai -- --base-url https://metrics.hushh.ai --timeout-ms 120000
npm run test:prod:kai -- --dashboard-url https://metrics.hushh.ai --timeout-ms 120000
```

GCP IAM required by the workflow:

```bash
gcloud projects add-iam-policy-binding hushh-ai-prod \
  --member="serviceAccount:github-actions-deployer@hushh-ai-prod.iam.gserviceaccount.com" \
  --role="roles/run.admin"

gcloud artifacts repositories add-iam-policy-binding website-images \
  --project=hushh-ai-prod \
  --location=us-central1 \
  --member="serviceAccount:github-actions-deployer@hushh-ai-prod.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.reader"

gcloud projects add-iam-policy-binding hushh-ai-prod \
  --member="serviceAccount:github-actions-deployer@hushh-ai-prod.iam.gserviceaccount.com" \
  --role="roles/bigquery.jobUser"

gcloud projects add-iam-policy-binding hushh-ai-prod \
  --member="serviceAccount:github-actions-deployer@hushh-ai-prod.iam.gserviceaccount.com" \
  --role="roles/bigquery.dataViewer"

gcloud projects add-iam-policy-binding hushh-ai-prod \
  --member="serviceAccount:github-actions-deployer@hushh-ai-prod.iam.gserviceaccount.com" \
  --role="roles/cloudscheduler.viewer"

gcloud iam service-accounts add-iam-policy-binding \
  metrics-dashboard-runtime@hushh-ai-prod.iam.gserviceaccount.com \
  --project=hushh-ai-prod \
  --member="serviceAccount:github-actions-deployer@hushh-ai-prod.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"

gcloud iam service-accounts add-iam-policy-binding \
  github-actions-deployer@hushh-ai-prod.iam.gserviceaccount.com \
  --project=hushh-ai-prod \
  --member="principalSet://iam.googleapis.com/projects/1072839345524/locations/global/workloadIdentityPools/github-actions/attribute.repository/hushh-labs/hussh-matrix-dashboard" \
  --role="roles/iam.workloadIdentityUser"
```

## Runtime Identity

```bash
gcloud iam service-accounts create "$SA_NAME" \
  --project="$PROJECT" \
  --display-name="Metrics Dashboard Runtime"
```

Grant access needed by the server-side aggregate fetches:

```bash
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/bigquery.jobUser"

gcloud projects add-iam-policy-binding hushh-ai-prod \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/monitoring.viewer"

bq add-iam-policy-binding hushh-pda-uat:analytics_public \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/bigquery.dataViewer"

bq add-iam-policy-binding hushh-pda-uat:analytics_533362555 \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/bigquery.dataViewer"

bq add-iam-policy-binding hushh-pda:analytics_public \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/bigquery.dataViewer"

bq add-iam-policy-binding hushh-pda:searchconsole_searchconsole_hushh_ai \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/bigquery.dataViewer"
```

The HushhTech Search Console fallback tables are created by the ingestion script
below. Grant the dashboard read access through project-level BigQuery viewer
because dataset-level IAM is not enabled in this project:

```bash
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/bigquery.dataViewer"
```

## Secret Manager

Store all Cloud Run runtime config in Secret Manager. The Supabase management
token is the sensitive value; the other entries are deployment config kept in
Secret Manager so future revisions do not reintroduce plain environment values.

Create or rotate the config secrets:

```bash
create_or_update_secret() {
  local name="$1"
  local value="$2"
  if gcloud secrets describe "$name" --project="$PROJECT" >/dev/null 2>&1; then
    printf '%s' "$value" | gcloud secrets versions add "$name" \
      --project="$PROJECT" \
      --data-file=-
  else
    printf '%s' "$value" | gcloud secrets create "$name" \
      --project="$PROJECT" \
      --replication-policy="automatic" \
      --data-file=-
  fi

  gcloud secrets add-iam-policy-binding "$name" \
    --project="$PROJECT" \
    --member="serviceAccount:$SA_EMAIL" \
    --role="roles/secretmanager.secretAccessor"
}

create_or_update_secret metrics-dashboard-node-env production
create_or_update_secret metrics-dashboard-app-url https://metrics.hushh.ai
create_or_update_secret metrics-dashboard-bq-job-project hushh-ai-prod
create_or_update_secret metrics-dashboard-bq-cli-fallback false
create_or_update_secret "$GEMINI_API_KEY_SECRET" "$GEMINI_API_KEY"
create_or_update_secret metrics-dashboard-hushhtech-endpoint https://hushhtech.com/api/metrics/summary
create_or_update_secret metrics-dashboard-hushhtech-window-days 7
create_or_update_secret metrics-dashboard-hushhtech-gcp-project hushh-tech-prod
create_or_update_secret metrics-dashboard-hushhtech-cloud-run-service hushh-tech-website
create_or_update_secret metrics-dashboard-hushhtech-cloud-run-region us-central1
create_or_update_secret metrics-dashboard-hushhtech-search-project hushh-ai-prod
create_or_update_secret metrics-dashboard-hushhtech-search-dataset searchconsole_hushhtech_com
create_or_update_secret metrics-dashboard-hushhtech-search-fallback-project hushh-ai-prod
create_or_update_secret metrics-dashboard-hushhtech-search-fallback-dataset hushhtech_search_console_api
create_or_update_secret metrics-dashboard-hushhtech-search-console-site-url sc-domain:hushhtech.com
create_or_update_secret metrics-dashboard-hushhtech-search-console-type web
create_or_update_secret metrics-dashboard-hushhtech-search-console-data-state all
create_or_update_secret metrics-dashboard-hushhtech-search-console-row-limit 10
create_or_update_secret metrics-dashboard-hushhtech-supabase-project-ref ibsisfnjxeowvdtvgzff
create_or_update_secret metrics-dashboard-kai-ga4-window-days 14
create_or_update_secret metrics-dashboard-kai-prod-ga4-project hushh-pda
create_or_update_secret metrics-dashboard-kai-prod-ga4-dataset analytics_526603671
create_or_update_secret metrics-dashboard-kai-prod-gcp-project hushh-pda
create_or_update_secret metrics-dashboard-kai-prod-cloud-run-service hushh-webapp
create_or_update_secret metrics-dashboard-kai-prod-window-days 7
create_or_update_secret metrics-dashboard-hushh-ai-gcp-project hushh-ai-prod
create_or_update_secret metrics-dashboard-hushh-ai-cloud-run-service hushh-ai-website
create_or_update_secret metrics-dashboard-hushh-ai-window-days 7
create_or_update_secret metrics-dashboard-hushh-ai-search-project hushh-pda
create_or_update_secret metrics-dashboard-hushh-ai-search-dataset searchconsole_searchconsole_hushh_ai
create_or_update_secret metrics-dashboard-hushh-ai-search-fallback-project hushh-ai-prod
create_or_update_secret metrics-dashboard-hushh-ai-search-fallback-dataset hushh_ai_search_console_api
create_or_update_secret metrics-dashboard-hushh-ai-search-console-site-url sc-domain:hushh.ai
create_or_update_secret metrics-dashboard-hushh-ai-search-console-page-filter-regex '^https://(www\.)?hushh\.ai(/|$)'
create_or_update_secret metrics-dashboard-hushh-ai-search-console-type web
create_or_update_secret metrics-dashboard-hushh-ai-search-console-data-state all
create_or_update_secret metrics-dashboard-hushh-ai-search-console-row-limit 10
create_or_update_secret metrics-dashboard-hushh-ai-ga4-measurement-id G-PPEF1CSJ5H
create_or_update_secret metrics-dashboard-hushh-ai-ga4-property-id 458078330
create_or_update_secret metrics-dashboard-hushh-ai-ga4-impersonate-service-account 646258530541-compute@developer.gserviceaccount.com
create_or_update_secret metrics-dashboard-hushh-ai-live-refresh-seconds 30
create_or_update_secret metrics-dashboard-kai-search-project hushh-pda
create_or_update_secret metrics-dashboard-kai-search-dataset searchconsole_searchconsole_hushh_ai
create_or_update_secret metrics-dashboard-kai-search-fallback-project hushh-ai-prod
create_or_update_secret metrics-dashboard-kai-search-fallback-dataset kai_search_console_api
create_or_update_secret metrics-dashboard-kai-search-console-site-url sc-domain:hushh.ai
create_or_update_secret metrics-dashboard-kai-search-console-page-filter-regex '^https://(uat\.)?kai\.hushh\.ai(/|$)'
create_or_update_secret metrics-dashboard-kai-search-console-type web
create_or_update_secret metrics-dashboard-kai-search-console-data-state all
create_or_update_secret metrics-dashboard-kai-search-console-row-limit 10
```

Create or rotate the Gemini API key through an environment variable or hidden
stdin only. Do not paste the raw key into docs, source files, shell history, or
deployment logs. The runtime env var is `GEMINI_API_KEY`; the Cloud Run binding
must reference `hushh-gemini-api-key:latest`.

Create or rotate the HushhTech Supabase management token secret. Do not print
or commit the token. `Hush AI` is the Supabase database name for
`hushhtech.com`; do not wire this secret into `hushh.ai` metrics.

```bash
create_or_update_secret hushhtech-supabase-access-token "$HUSHHTECH_SUPABASE_ACCESS_TOKEN"
```

Create or rotate the HushhTech Search Console OAuth credential secret for the
Cloud Run Job. The value must be an OAuth authorized-user JSON object from a
Search Console owner/full user for `sc-domain:hushhtech.com`; do not use
Supabase for Search Console metrics.

```bash
create_or_update_secret "$HUSHHTECH_SEARCH_OAUTH_SECRET" "$HUSHHTECH_SEARCH_CONSOLE_OAUTH_JSON"
```

### Hushh AI GA4 Data API Access

The GA4 Data API does not read from the web measurement ID directly. For
`G-PPEF1CSJ5H`, metrics.hushh.ai must call the numeric GA4 property
`458078330` as `properties/458078330`.

Production is configured to run Cloud Run as
`metrics-dashboard-runtime@hushh-ai-prod.iam.gserviceaccount.com` and then
impersonate the GA-authorized service account
`646258530541-compute@developer.gserviceaccount.com`. Keep both grants in
place:

- Google Cloud IAM:
  `metrics-dashboard-runtime@hushh-ai-prod.iam.gserviceaccount.com` has
  `roles/iam.serviceAccountTokenCreator` on
  `646258530541-compute@developer.gserviceaccount.com`.
- Google Analytics Admin for property `458078330`:
  `646258530541-compute@developer.gserviceaccount.com` has Viewer or Analyst
  access.

If the dashboard shows `GA4 Data API source is configured for G-PPEF1CSJ5H,
but GA4 Data API request was rejected before JSON report data was returned`,
verify the two grants above and run the focused aggregate-only probe:

```bash
npm run test:ga4:hushh-ai
```

That probe validates `runReport` and `runRealtimeReport` without printing raw
GA4 provider payloads.

The reusable Hushh AI and Kai Search Console ingestion jobs use
`metrics-dashboard-search-console-oauth`. Seed or rotate it from an owner/full
Search Console authorized-user JSON for `sc-domain:hushh.ai`:

```bash
create_or_update_secret "$SEARCH_CONSOLE_OAUTH_SECRET" "$SEARCH_CONSOLE_OAUTH_JSON"
```

Grant the ingestion job service account access only to the OAuth secret:

```bash
gcloud iam service-accounts create hushhtech-gsc-ingest \
  --project="$PROJECT" \
  --display-name="HushhTech Search Console Ingest"

gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$HUSHHTECH_SEARCH_INGEST_SA" \
  --role="roles/bigquery.jobUser"

gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$HUSHHTECH_SEARCH_INGEST_SA" \
  --role="roles/bigquery.dataEditor"

gcloud secrets add-iam-policy-binding "$HUSHHTECH_SEARCH_OAUTH_SECRET" \
  --project="$PROJECT" \
  --member="serviceAccount:$HUSHHTECH_SEARCH_INGEST_SA" \
  --role="roles/secretmanager.secretAccessor"
```

## HushhTech Search Console Fallback

The official Search Console bulk export remains the preferred source. The
fallback uses the Search Console API only to populate aggregate tables in
BigQuery while the official export is waiting:

```bash
HUSHHTECH_SEARCH_FALLBACK_PROJECT="$PROJECT" \
HUSHHTECH_SEARCH_FALLBACK_DATASET="$HUSHHTECH_SEARCH_FALLBACK_DATASET" \
HUSHHTECH_SEARCH_CONSOLE_SITE_URL="sc-domain:hushhtech.com" \
npm run ingest:hushhtech-search-console -- --ensure-only
```

Deploy the same dashboard image as a Cloud Run Job:

```bash
gcloud run jobs deploy "$HUSHHTECH_SEARCH_INGEST_JOB" \
  --project="$PROJECT" \
  --region="$REGION" \
  --image="$IMAGE" \
  --service-account="$HUSHHTECH_SEARCH_INGEST_SA" \
  --memory=1Gi \
  --cpu=1 \
  --max-retries=1 \
  --task-timeout=1800s \
  --command=node \
  --args=scripts/ingest-hushhtech-search-console.mjs,--days,16 \
  --set-env-vars="HUSHHTECH_SEARCH_FALLBACK_PROJECT=$PROJECT,HUSHHTECH_SEARCH_FALLBACK_DATASET=$HUSHHTECH_SEARCH_FALLBACK_DATASET,HUSHHTECH_SEARCH_CONSOLE_SITE_URL=sc-domain:hushhtech.com,HUSHHTECH_SEARCH_CONSOLE_TYPE=web,HUSHHTECH_SEARCH_CONSOLE_DATA_STATE=all" \
  --set-secrets="HUSHHTECH_SEARCH_CONSOLE_OAUTH_JSON=$HUSHHTECH_SEARCH_OAUTH_SECRET:latest"
```

Run the one-time 90-day backfill after the OAuth secret is valid:

```bash
gcloud run jobs execute "$HUSHHTECH_SEARCH_INGEST_JOB" \
  --project="$PROJECT" \
  --region="$REGION" \
  --args=scripts/ingest-hushhtech-search-console.mjs,--days,90 \
  --wait
```

Schedule the recurring 16-day backfill. Search Console is still a daily
aggregate source, but running the fallback every six hours lets metrics.hushh.ai
pick up Google's newly published daily rows without waiting for the next
single daily run:

```bash
gcloud iam service-accounts create hushhtech-gsc-scheduler \
  --project="$PROJECT" \
  --display-name="HushhTech Search Console Scheduler"

gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$HUSHHTECH_SEARCH_SCHEDULER_SA" \
  --role="roles/run.developer"

gcloud iam service-accounts add-iam-policy-binding "$HUSHHTECH_SEARCH_INGEST_SA" \
  --project="$PROJECT" \
  --member="serviceAccount:$HUSHHTECH_SEARCH_SCHEDULER_SA" \
  --role="roles/iam.serviceAccountUser"

gcloud scheduler jobs create http hushhtech-search-console-ingest-daily \
  --project="$PROJECT" \
  --location="$REGION" \
  --schedule="20 */6 * * *" \
  --time-zone="Etc/UTC" \
  --uri="https://run.googleapis.com/v2/projects/$PROJECT/locations/$REGION/jobs/${HUSHHTECH_SEARCH_INGEST_JOB}:run" \
  --http-method=POST \
  --oauth-service-account-email="$HUSHHTECH_SEARCH_SCHEDULER_SA" \
  --oauth-token-scope="https://www.googleapis.com/auth/cloud-platform" \
  --headers="Content-Type=application/json" \
  --message-body='{"overrides":{"containerOverrides":[{"args":["scripts/ingest-hushhtech-search-console.mjs","--days","16"]}]}}'
```

If the OAuth secret exists but has no enabled version yet, keep the scheduler
paused until the 90-day backfill succeeds:

```bash
gcloud scheduler jobs pause hushhtech-search-console-ingest-daily \
  --project="$PROJECT" \
  --location="$REGION"
```

## Hushh AI and Kai Search Console Fallbacks

Use the same aggregate-only ingestion script for Hushh AI and Kai. Both read
from the `sc-domain:hushh.ai` domain property and separate products through
page URL regex filters:

```bash
SEARCH_CONSOLE_FALLBACK_PROJECT="$PROJECT" \
SEARCH_CONSOLE_FALLBACK_DATASET="$HUSHH_AI_SEARCH_FALLBACK_DATASET" \
SEARCH_CONSOLE_SITE_URL="sc-domain:hushh.ai" \
SEARCH_CONSOLE_PAGE_FILTER_REGEX='^https://(www\.)?hushh\.ai(/|$)' \
npm run ingest:search-console -- --ensure-only

SEARCH_CONSOLE_FALLBACK_PROJECT="$PROJECT" \
SEARCH_CONSOLE_FALLBACK_DATASET="$KAI_SEARCH_FALLBACK_DATASET" \
SEARCH_CONSOLE_SITE_URL="sc-domain:hushh.ai" \
SEARCH_CONSOLE_PAGE_FILTER_REGEX='^https://(uat\.)?kai\.hushh\.ai(/|$)' \
npm run ingest:search-console -- --ensure-only
```

Deploy the jobs from the same dashboard image. Use
`metrics-dashboard-search-console-oauth` as `SEARCH_CONSOLE_OAUTH_JSON`, and set
`SEARCH_CONSOLE_QUOTA_PROJECT=hushh-ai-prod`:

```bash
gcloud run jobs deploy "$HUSHH_AI_SEARCH_INGEST_JOB" \
  --project="$PROJECT" \
  --region="$REGION" \
  --image="$IMAGE" \
  --service-account="$HUSHH_AI_SEARCH_INGEST_SA" \
  --memory=1Gi \
  --cpu=1 \
  --max-retries=1 \
  --task-timeout=1800s \
  --command=node \
  --args=scripts/ingest-hushhtech-search-console.mjs,--days,16 \
  --set-env-vars="SEARCH_CONSOLE_QUOTA_PROJECT=$PROJECT,SEARCH_CONSOLE_FALLBACK_PROJECT=$PROJECT,SEARCH_CONSOLE_FALLBACK_DATASET=$HUSHH_AI_SEARCH_FALLBACK_DATASET,SEARCH_CONSOLE_SITE_URL=sc-domain:hushh.ai,SEARCH_CONSOLE_PAGE_FILTER_REGEX=^https://(www\\.)?hushh\\.ai(/|$),SEARCH_CONSOLE_TYPE=web,SEARCH_CONSOLE_DATA_STATE=all" \
  --set-secrets="SEARCH_CONSOLE_OAUTH_JSON=$SEARCH_CONSOLE_OAUTH_SECRET:latest"

gcloud run jobs deploy "$KAI_SEARCH_INGEST_JOB" \
  --project="$PROJECT" \
  --region="$REGION" \
  --image="$IMAGE" \
  --service-account="$KAI_SEARCH_INGEST_SA" \
  --memory=1Gi \
  --cpu=1 \
  --max-retries=1 \
  --task-timeout=1800s \
  --command=node \
  --args=scripts/ingest-hushhtech-search-console.mjs,--days,16 \
  --set-env-vars="SEARCH_CONSOLE_QUOTA_PROJECT=$PROJECT,SEARCH_CONSOLE_FALLBACK_PROJECT=$PROJECT,SEARCH_CONSOLE_FALLBACK_DATASET=$KAI_SEARCH_FALLBACK_DATASET,SEARCH_CONSOLE_SITE_URL=sc-domain:hushh.ai,SEARCH_CONSOLE_PAGE_FILTER_REGEX=^https://(uat\\.)?kai\\.hushh\\.ai(/|$),SEARCH_CONSOLE_TYPE=web,SEARCH_CONSOLE_DATA_STATE=all" \
  --set-secrets="SEARCH_CONSOLE_OAUTH_JSON=$SEARCH_CONSOLE_OAUTH_SECRET:latest"
```

Run the one-time 90-day backfill once per job, then schedule the recurring
six-hour 16-day refresh through Cloud Scheduler:

```bash
gcloud run jobs execute "$HUSHH_AI_SEARCH_INGEST_JOB" --project="$PROJECT" --region="$REGION" --args=scripts/ingest-hushhtech-search-console.mjs,--days,90 --wait
gcloud run jobs execute "$KAI_SEARCH_INGEST_JOB" --project="$PROJECT" --region="$REGION" --args=scripts/ingest-hushhtech-search-console.mjs,--days,90 --wait

gcloud scheduler jobs update http hushh-ai-search-console-ingest-daily \
  --project="$PROJECT" \
  --location="$REGION" \
  --schedule="30 */6 * * *" \
  --time-zone="Etc/UTC"

gcloud scheduler jobs update http kai-search-console-ingest-daily \
  --project="$PROJECT" \
  --location="$REGION" \
  --schedule="40 */6 * * *" \
  --time-zone="Etc/UTC"
```

## Build And Deploy

```bash
gcloud builds submit \
  --project="$PROJECT" \
  --tag="$IMAGE" .

gcloud run deploy "$SERVICE" \
  --project="$PROJECT" \
  --region="$REGION" \
  --image="$IMAGE" \
  --service-account="$SA_EMAIL" \
  --allow-unauthenticated \
  --port=8080 \
  --memory=1Gi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=3 \
  --clear-env-vars \
  --set-env-vars="GEMINI_METRICS_CHAT_MODEL=gemini-2.5-flash,METRICS_CHAT_RATE_LIMIT_HOURLY=60,METRICS_CHAT_RATE_LIMIT_DAILY=300,METRICS_CHAT_REQUEST_TIMEOUT_MS=45000,METRICS_CHAT_CONTEXT_CACHE_SECONDS=30" \
  --set-secrets="NODE_ENV=metrics-dashboard-node-env:latest,APP_URL=metrics-dashboard-app-url:latest,BQ_JOB_PROJECT=metrics-dashboard-bq-job-project:latest,BQ_CLI_FALLBACK=metrics-dashboard-bq-cli-fallback:latest,GEMINI_API_KEY=hushh-gemini-api-key:latest,HUSHHTECH_ANALYTICS_ENDPOINT=metrics-dashboard-hushhtech-endpoint:latest,HUSHHTECH_METRICS_WINDOW_DAYS=metrics-dashboard-hushhtech-window-days:latest,HUSHHTECH_GCP_PROJECT=metrics-dashboard-hushhtech-gcp-project:latest,HUSHHTECH_CLOUD_RUN_SERVICE=metrics-dashboard-hushhtech-cloud-run-service:latest,HUSHHTECH_CLOUD_RUN_REGION=metrics-dashboard-hushhtech-cloud-run-region:latest,HUSHHTECH_SEARCH_PROJECT=metrics-dashboard-hushhtech-search-project:latest,HUSHHTECH_SEARCH_DATASET=metrics-dashboard-hushhtech-search-dataset:latest,HUSHHTECH_SEARCH_FALLBACK_PROJECT=metrics-dashboard-hushhtech-search-fallback-project:latest,HUSHHTECH_SEARCH_FALLBACK_DATASET=metrics-dashboard-hushhtech-search-fallback-dataset:latest,HUSHHTECH_SEARCH_CONSOLE_SITE_URL=metrics-dashboard-hushhtech-search-console-site-url:latest,HUSHHTECH_SEARCH_CONSOLE_TYPE=metrics-dashboard-hushhtech-search-console-type:latest,HUSHHTECH_SEARCH_CONSOLE_DATA_STATE=metrics-dashboard-hushhtech-search-console-data-state:latest,HUSHHTECH_SEARCH_CONSOLE_ROW_LIMIT=metrics-dashboard-hushhtech-search-console-row-limit:latest,HUSHHTECH_SUPABASE_PROJECT_REF=metrics-dashboard-hushhtech-supabase-project-ref:latest,HUSHHTECH_SUPABASE_ACCESS_TOKEN=hushhtech-supabase-access-token:latest,KAI_GA4_WINDOW_DAYS=metrics-dashboard-kai-ga4-window-days:latest,KAI_PROD_GA4_PROJECT=metrics-dashboard-kai-prod-ga4-project:latest,KAI_PROD_GA4_DATASET=metrics-dashboard-kai-prod-ga4-dataset:latest,KAI_PROD_GCP_PROJECT=metrics-dashboard-kai-prod-gcp-project:latest,KAI_PROD_CLOUD_RUN_SERVICE=metrics-dashboard-kai-prod-cloud-run-service:latest,KAI_PROD_METRICS_WINDOW_DAYS=metrics-dashboard-kai-prod-window-days:latest,KAI_SEARCH_PROJECT=metrics-dashboard-kai-search-project:latest,KAI_SEARCH_DATASET=metrics-dashboard-kai-search-dataset:latest,KAI_SEARCH_FALLBACK_PROJECT=metrics-dashboard-kai-search-fallback-project:latest,KAI_SEARCH_FALLBACK_DATASET=metrics-dashboard-kai-search-fallback-dataset:latest,KAI_SEARCH_CONSOLE_SITE_URL=metrics-dashboard-kai-search-console-site-url:latest,KAI_SEARCH_CONSOLE_PAGE_FILTER_REGEX=metrics-dashboard-kai-search-console-page-filter-regex:latest,KAI_SEARCH_CONSOLE_TYPE=metrics-dashboard-kai-search-console-type:latest,KAI_SEARCH_CONSOLE_DATA_STATE=metrics-dashboard-kai-search-console-data-state:latest,KAI_SEARCH_CONSOLE_ROW_LIMIT=metrics-dashboard-kai-search-console-row-limit:latest,HUSHH_AI_GCP_PROJECT=metrics-dashboard-hushh-ai-gcp-project:latest,HUSHH_AI_CLOUD_RUN_SERVICE=metrics-dashboard-hushh-ai-cloud-run-service:latest,HUSHH_AI_METRICS_WINDOW_DAYS=metrics-dashboard-hushh-ai-window-days:latest,HUSHH_AI_SEARCH_PROJECT=metrics-dashboard-hushh-ai-search-project:latest,HUSHH_AI_SEARCH_DATASET=metrics-dashboard-hushh-ai-search-dataset:latest,HUSHH_AI_SEARCH_FALLBACK_PROJECT=metrics-dashboard-hushh-ai-search-fallback-project:latest,HUSHH_AI_SEARCH_FALLBACK_DATASET=metrics-dashboard-hushh-ai-search-fallback-dataset:latest,HUSHH_AI_SEARCH_CONSOLE_SITE_URL=metrics-dashboard-hushh-ai-search-console-site-url:latest,HUSHH_AI_SEARCH_CONSOLE_PAGE_FILTER_REGEX=metrics-dashboard-hushh-ai-search-console-page-filter-regex:latest,HUSHH_AI_SEARCH_CONSOLE_TYPE=metrics-dashboard-hushh-ai-search-console-type:latest,HUSHH_AI_SEARCH_CONSOLE_DATA_STATE=metrics-dashboard-hushh-ai-search-console-data-state:latest,HUSHH_AI_SEARCH_CONSOLE_ROW_LIMIT=metrics-dashboard-hushh-ai-search-console-row-limit:latest,HUSHH_AI_GA4_MEASUREMENT_ID=metrics-dashboard-hushh-ai-ga4-measurement-id:latest,HUSHH_AI_GA4_PROPERTY_ID=metrics-dashboard-hushh-ai-ga4-property-id:latest,HUSHH_AI_GA4_IMPERSONATE_SERVICE_ACCOUNT=metrics-dashboard-hushh-ai-ga4-impersonate-service-account:latest,HUSHH_AI_LIVE_REFRESH_SECONDS=metrics-dashboard-hushh-ai-live-refresh-seconds:latest"
```

## Domain Mapping

```bash
gcloud beta run domain-mappings create \
  --project=hushh-ai-prod \
  --region=us-central1 \
  --service=hushh-matrix-dashboard \
  --domain=metrics.hushh.ai
```

Get the DNS record Google expects:

```bash
gcloud beta run domain-mappings describe \
  --project=hushh-ai-prod \
  --region=us-central1 \
  --domain=metrics.hushh.ai \
  --format="yaml(status.resourceRecords)"
```

Expected Namecheap host record:

| Type | Host | Value | TTL |
| --- | --- | --- | --- |
| CNAME Record | `metrics` | `ghs.googlehosted.com` | Automatic |

Namecheap remains authoritative for `hushh.ai`; the `metrics` CNAME points
Google's frontend at the Cloud Run domain mapping. Google then provisions the
managed HTTPS certificate. Certificate provisioning usually takes minutes but
can take up to 24 hours.

## Verification

After Cloud Run deploy:

```bash
RUN_URL="$(gcloud run services describe hushh-matrix-dashboard --project=hushh-ai-prod --region=us-central1 --format='value(status.url)')"

curl -fsS "$RUN_URL/api/health"
curl -fsS "$RUN_URL/api/analytics/all"
bq ls "$PROJECT:$HUSHHTECH_SEARCH_FALLBACK_DATASET"
```

After DNS:

```bash
dig +short CNAME metrics.hushh.ai
curl -I https://metrics.hushh.ai
curl -fsS https://metrics.hushh.ai/api/health
```

Acceptance checks:

- `https://metrics.hushh.ai` loads the dashboard.
- `/api/analytics/all` returns HTTP 200.
- Supabase top 10 database metrics show aggregate counts only.
- HushhTech Search Console metrics come from the official GCP export or
  `hushh-ai-prod.hushhtech_search_console_api`, never Supabase.
- `/api/analytics/all` returns a normalized three-source matrix for Hushh AI,
  Kai, and HushhTech with `search_console`, `ga4`, and `product_events` cards.
- OTP rows, emails, raw diagnostics, and tokens are not visible.
- Cloud Run revision logs show no auth or IAM failures.
