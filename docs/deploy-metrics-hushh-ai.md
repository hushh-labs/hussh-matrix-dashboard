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
HUSHHTECH_SEARCH_OAUTH_SECRET="<hushhtech-search-console-oauth-secret-id>"
```

The current Secret Manager naming convention uses
`hushhtech-search-console-oauth` for the HushhTech Search Console OAuth secret
ID.

## Deploy On Main

The repo includes `.github/workflows/deploy-production.yml` to make `main` the
auditable production path. On every push to `main`, and on manual
`workflow_dispatch`, the workflow installs dependencies, typechecks, builds,
runs a high-severity dependency audit, scans tracked files for leaked secrets,
builds a commit-tagged container image, deploys Cloud Run with Secret
Manager-backed environment variables, verifies the Cloud Run secret bindings,
and runs all production probes:

```bash
npm run test:prod
```

Configure these GitHub environment or repository variables before enabling the
workflow:

| Variable | Value |
| --- | --- |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Workload Identity Federation provider resource for GitHub Actions |
| `GCP_DEPLOY_SERVICE_ACCOUNT` | Deploy service account email used by GitHub OIDC |

The deploy service account needs permission to submit Cloud Build jobs, deploy
the `hushh-matrix-dashboard` Cloud Run service, write to the
`website-images` Artifact Registry repository, and act as
`metrics-dashboard-runtime@hushh-ai-prod.iam.gserviceaccount.com`. Do not use a
long-lived service account JSON key for the workflow.

## Preflight

```bash
npm run lint
npm run build
npm audit --audit-level=high
npm run check:secrets
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
create_or_update_secret metrics-dashboard-hushh-ai-live-refresh-seconds 30
```

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

Schedule the recurring 16-day backfill:

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
  --schedule="20 9 * * *" \
  --time-zone="Etc/UTC" \
  --uri="https://run.googleapis.com/apis/run.googleapis.com/v1/namespaces/$PROJECT/jobs/${HUSHHTECH_SEARCH_INGEST_JOB}:run" \
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
  --set-secrets="NODE_ENV=metrics-dashboard-node-env:latest,APP_URL=metrics-dashboard-app-url:latest,BQ_JOB_PROJECT=metrics-dashboard-bq-job-project:latest,BQ_CLI_FALLBACK=metrics-dashboard-bq-cli-fallback:latest,HUSHHTECH_ANALYTICS_ENDPOINT=metrics-dashboard-hushhtech-endpoint:latest,HUSHHTECH_METRICS_WINDOW_DAYS=metrics-dashboard-hushhtech-window-days:latest,HUSHHTECH_GCP_PROJECT=metrics-dashboard-hushhtech-gcp-project:latest,HUSHHTECH_CLOUD_RUN_SERVICE=metrics-dashboard-hushhtech-cloud-run-service:latest,HUSHHTECH_CLOUD_RUN_REGION=metrics-dashboard-hushhtech-cloud-run-region:latest,HUSHHTECH_SEARCH_PROJECT=metrics-dashboard-hushhtech-search-project:latest,HUSHHTECH_SEARCH_DATASET=metrics-dashboard-hushhtech-search-dataset:latest,HUSHHTECH_SEARCH_FALLBACK_PROJECT=metrics-dashboard-hushhtech-search-fallback-project:latest,HUSHHTECH_SEARCH_FALLBACK_DATASET=metrics-dashboard-hushhtech-search-fallback-dataset:latest,HUSHHTECH_SEARCH_CONSOLE_SITE_URL=metrics-dashboard-hushhtech-search-console-site-url:latest,HUSHHTECH_SEARCH_CONSOLE_TYPE=metrics-dashboard-hushhtech-search-console-type:latest,HUSHHTECH_SEARCH_CONSOLE_DATA_STATE=metrics-dashboard-hushhtech-search-console-data-state:latest,HUSHHTECH_SEARCH_CONSOLE_ROW_LIMIT=metrics-dashboard-hushhtech-search-console-row-limit:latest,HUSHHTECH_SUPABASE_PROJECT_REF=metrics-dashboard-hushhtech-supabase-project-ref:latest,HUSHHTECH_SUPABASE_ACCESS_TOKEN=hushhtech-supabase-access-token:latest,KAI_GA4_WINDOW_DAYS=metrics-dashboard-kai-ga4-window-days:latest,KAI_PROD_GA4_PROJECT=metrics-dashboard-kai-prod-ga4-project:latest,KAI_PROD_GA4_DATASET=metrics-dashboard-kai-prod-ga4-dataset:latest,KAI_PROD_GCP_PROJECT=metrics-dashboard-kai-prod-gcp-project:latest,KAI_PROD_CLOUD_RUN_SERVICE=metrics-dashboard-kai-prod-cloud-run-service:latest,KAI_PROD_METRICS_WINDOW_DAYS=metrics-dashboard-kai-prod-window-days:latest,HUSHH_AI_GCP_PROJECT=metrics-dashboard-hushh-ai-gcp-project:latest,HUSHH_AI_CLOUD_RUN_SERVICE=metrics-dashboard-hushh-ai-cloud-run-service:latest,HUSHH_AI_METRICS_WINDOW_DAYS=metrics-dashboard-hushh-ai-window-days:latest,HUSHH_AI_SEARCH_PROJECT=metrics-dashboard-hushh-ai-search-project:latest,HUSHH_AI_SEARCH_DATASET=metrics-dashboard-hushh-ai-search-dataset:latest,HUSHH_AI_LIVE_REFRESH_SECONDS=metrics-dashboard-hushh-ai-live-refresh-seconds:latest"
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
- OTP rows, emails, raw diagnostics, and tokens are not visible.
- Cloud Run revision logs show no auth or IAM failures.
- Cloud Run runtime config is still backed by Secret Manager:
  `npm run check:cloud-run:secrets`
