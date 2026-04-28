# metrics.hushh.ai Production Context

## Service

| Setting | Value |
| --- | --- |
| Project | `hushh-ai-prod` |
| Region | `us-central1` |
| Service | `hushh-matrix-dashboard` |
| Runtime identity | `metrics-dashboard-runtime@hushh-ai-prod.iam.gserviceaccount.com` |
| Artifact Registry | `us-central1-docker.pkg.dev/hushh-ai-prod/website-images` |
| Domain | `metrics.hushh.ai` |
| DNS provider | Namecheap BasicDNS for `hushh.ai` |

## Build And Deploy

```bash
PROJECT=hushh-ai-prod
REGION=us-central1
SERVICE=hushh-matrix-dashboard
SA_EMAIL=metrics-dashboard-runtime@hushh-ai-prod.iam.gserviceaccount.com
IMAGE="us-central1-docker.pkg.dev/$PROJECT/website-images/$SERVICE:$(git rev-parse --short HEAD)"

npm run lint
npm run build
git diff --check
rg "sbp_|SUPABASE_ACCESS_TOKEN=.+|PRIVATE KEY|BEGIN [A-Z ]+PRIVATE KEY" . \
  --glob '!node_modules/**' \
  --glob '!dist/**' \
  --glob '!package-lock.json'

gcloud builds submit --project="$PROJECT" --tag="$IMAGE" .

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
  --max-instances=3
```

When changing runtime env vars, use Secret Manager-backed `--set-secrets` or `--update-secrets`; do not pass raw secret values.

## Domain Mapping

Cloud Run mapping:

```bash
gcloud beta run domain-mappings describe \
  --project=hushh-ai-prod \
  --region=us-central1 \
  --domain=metrics.hushh.ai \
  --format="yaml(status.conditions,status.resourceRecords)"
```

If the mapping needs to be recreated:

```bash
gcloud beta run domain-mappings create \
  --project=hushh-ai-prod \
  --region=us-central1 \
  --service=hushh-matrix-dashboard \
  --domain=metrics.hushh.ai
```

Namecheap Advanced DNS for `hushh.ai`:

| Type | Host | Value | TTL |
| --- | --- | --- | --- |
| CNAME Record | `metrics` | `ghs.googlehosted.com` | Automatic |

Google-managed certificate readiness requires:

- `DomainRoutable=True`
- `CertificateProvisioned=True`
- `Ready=True`

## Verification

```bash
dig +short CNAME metrics.hushh.ai
curl -I https://metrics.hushh.ai
curl -fsS https://metrics.hushh.ai/api/health
curl -fsS https://metrics.hushh.ai/api/analytics/all
npm run test:prod:hushh-ai
npm run test:prod:kai
```

Cloud Run source of truth:

```bash
gcloud run services describe hushh-matrix-dashboard \
  --project=hushh-ai-prod \
  --region=us-central1 \
  --format='yaml(status.latestReadyRevisionName,status.url,spec.template.spec.containers[0].image,spec.template.spec.containers[0].env)'
```

Every sensitive runtime value should appear as `valueFrom.secretKeyRef`.
