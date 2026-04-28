# Deploy `metrics.hushh.ai`

This runbook deploys the Hussh Matrix Dashboard to Cloud Run as
`https://metrics.hushh.ai`.

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

Store the Supabase management token only in Secret Manager. Do not commit it.

```bash
printf '%s' "$HUSHH_AI_SUPABASE_ACCESS_TOKEN" | \
  gcloud secrets create hushh-ai-supabase-access-token \
  --project="$PROJECT" \
  --data-file=-

gcloud secrets add-iam-policy-binding hushh-ai-supabase-access-token \
  --project="$PROJECT" \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/secretmanager.secretAccessor"
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
  --set-env-vars="NODE_ENV=production,APP_URL=https://metrics.hushh.ai,BQ_JOB_PROJECT=hushh-ai-prod,BQ_CLI_FALLBACK=false,HUSHHTECH_METRICS_WINDOW_DAYS=7,KAI_GA4_WINDOW_DAYS=14,HUSHH_AI_GCP_PROJECT=hushh-ai-prod,HUSHH_AI_CLOUD_RUN_SERVICE=hushh-ai-website,HUSHH_AI_METRICS_WINDOW_DAYS=7,HUSHH_AI_SEARCH_PROJECT=hushh-pda,HUSHH_AI_SEARCH_DATASET=searchconsole_searchconsole_hushh_ai,HUSHH_AI_SUPABASE_PROJECT_REF=ibsisfnjxeowvdtvgzff" \
  --set-secrets="HUSHH_AI_SUPABASE_ACCESS_TOKEN=hushh-ai-supabase-access-token:latest"
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
