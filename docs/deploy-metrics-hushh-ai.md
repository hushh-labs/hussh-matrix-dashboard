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
```

## Preflight

```bash
npm run lint
npm run build
rg "sbp_|SUPABASE_ACCESS_TOKEN=.+" . --glob '!node_modules/**' --glob '!dist/**' --glob '!package-lock.json'
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
create_or_update_secret metrics-dashboard-hushhtech-window-days 7
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
create_or_update_secret metrics-dashboard-hushh-ai-supabase-project-ref ibsisfnjxeowvdtvgzff
create_or_update_secret metrics-dashboard-hushh-ai-live-refresh-seconds 30
```

Create or rotate the Supabase management token secret. Do not print or commit
the token.

```bash
create_or_update_secret hushh-ai-supabase-access-token "$HUSHH_AI_SUPABASE_ACCESS_TOKEN"
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
  --set-secrets="NODE_ENV=metrics-dashboard-node-env:latest,APP_URL=metrics-dashboard-app-url:latest,BQ_JOB_PROJECT=metrics-dashboard-bq-job-project:latest,BQ_CLI_FALLBACK=metrics-dashboard-bq-cli-fallback:latest,HUSHHTECH_METRICS_WINDOW_DAYS=metrics-dashboard-hushhtech-window-days:latest,KAI_GA4_WINDOW_DAYS=metrics-dashboard-kai-ga4-window-days:latest,KAI_PROD_GA4_PROJECT=metrics-dashboard-kai-prod-ga4-project:latest,KAI_PROD_GA4_DATASET=metrics-dashboard-kai-prod-ga4-dataset:latest,KAI_PROD_GCP_PROJECT=metrics-dashboard-kai-prod-gcp-project:latest,KAI_PROD_CLOUD_RUN_SERVICE=metrics-dashboard-kai-prod-cloud-run-service:latest,KAI_PROD_METRICS_WINDOW_DAYS=metrics-dashboard-kai-prod-window-days:latest,HUSHH_AI_GCP_PROJECT=metrics-dashboard-hushh-ai-gcp-project:latest,HUSHH_AI_CLOUD_RUN_SERVICE=metrics-dashboard-hushh-ai-cloud-run-service:latest,HUSHH_AI_METRICS_WINDOW_DAYS=metrics-dashboard-hushh-ai-window-days:latest,HUSHH_AI_SEARCH_PROJECT=metrics-dashboard-hushh-ai-search-project:latest,HUSHH_AI_SEARCH_DATASET=metrics-dashboard-hushh-ai-search-dataset:latest,HUSHH_AI_SUPABASE_PROJECT_REF=metrics-dashboard-hushh-ai-supabase-project-ref:latest,HUSHH_AI_LIVE_REFRESH_SECONDS=metrics-dashboard-hushh-ai-live-refresh-seconds:latest,HUSHH_AI_SUPABASE_ACCESS_TOKEN=hushh-ai-supabase-access-token:latest"
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
- OTP rows, emails, raw diagnostics, and tokens are not visible.
- Cloud Run revision logs show no auth or IAM failures.
