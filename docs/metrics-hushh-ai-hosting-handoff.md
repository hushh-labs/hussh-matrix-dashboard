# Hosted `metrics.hushh.ai` Handoff

This document is the operational handoff for running the Hushh Matrix
Dashboard as the public aggregate metrics site at `https://metrics.hushh.ai`.

## Current Hosting State

Last verified: 2026-04-29.

| Area | Status | Evidence |
| --- | --- | --- |
| Cloud Run service | Deployed | `hushh-matrix-dashboard` in `hushh-ai-prod/us-central1` |
| Public runtime URL | Healthy | `https://hushh-matrix-dashboard-yb3ojn3jxa-uc.a.run.app/api/health` returns `200` |
| DNS | Configured | `metrics.hushh.ai` CNAME resolves to `ghs.googlehosted.com` |
| Cloud Run domain mapping | Created | `metrics.hushh.ai` maps to `hushh-matrix-dashboard` |
| HTTPS certificate | Ready | Cloud Run reports `CertificateProvisioned=True`; `https://metrics.hushh.ai` returns `200` |

The custom domain is the primary production URL. The Cloud Run `run.app` URL
remains useful as a fallback verification endpoint if custom-domain routing is
ever being debugged.

## Hosting Model

The public route is:

```text
Namecheap BasicDNS
  -> metrics.hushh.ai CNAME ghs.googlehosted.com
  -> Google frontend
  -> Cloud Run domain mapping for metrics.hushh.ai
  -> Cloud Run service hushh-matrix-dashboard
```

Namecheap remains authoritative for `hushh.ai`. No Cloud DNS migration is
required for this subdomain.

## Production Service

| Setting | Value |
| --- | --- |
| Project | `hushh-ai-prod` |
| Region | `us-central1` |
| Service | `hushh-matrix-dashboard` |
| Runtime identity | `metrics-dashboard-runtime@hushh-ai-prod.iam.gserviceaccount.com` |
| Image repo | `us-central1-docker.pkg.dev/hushh-ai-prod/website-images` |
| Current deployed revision | `hushh-matrix-dashboard-00015-fkk` |
| Current deployed image tag | `hushh-matrix-dashboard:4125b6f-hushhtech-gsc-fallback-20260428232037` |
| Runtime config | Secret Manager-backed env vars only |
| Public access | Enabled, aggregate-only |

## Public Data Contract

The hosted dashboard reads from `/api/analytics/all`. The endpoint must return
aggregate metrics only. Do not expose raw user rows, emails, tokens, stack
traces, setup errors, or provider diagnostics in the visible UI.

Current platform sources:

| Platform | Source | Hosted behavior |
| --- | --- | --- |
| Hushh AI | Cloud Run Monitoring | Last 7 days request count, error count, error rate, p95 latency, instance count, and daily request series |
| Hushh AI | Search Console BigQuery export | Search metrics appear when export tables are present in `hushh-pda.searchconsole_searchconsole_hushh_ai` |
| Hushh AI | Live refresh layer | API responses are no-store, the UI auto-refreshes every 30 seconds, and source freshness labels distinguish near-live, delayed, and pending analytics sources |
| Kai | BigQuery public feed | UAT dashboard metrics, funnel, usage, engagement, geo, and instrumentation health |
| Kai | GA4 BigQuery export | UAT GA4 aggregates from `hushh-pda-uat.analytics_533362555` |
| Kai | Production feed | Status-only until the production GA4 export dataset materializes |
| Kai | Production Cloud Run Monitoring | `kai.hushh.ai` requests, non-2xx, p95 latency, instance count, and daily reliability from `hushh-pda/hushh-webapp` |
| HushhTech | Public summary endpoint | `GET https://hushhtech.com/api/metrics/summary?window_days=7` for business funnel and GA4 traffic |
| HushhTech | Supabase Management API | Top aggregate database metrics plus date-range daily status for new users, active users, sessions, exit signals, product usage, and analytics events |
| HushhTech | Cloud Run Monitoring | `metrics.hushh.ai` reads `hushh-tech-prod/hushh-tech-website` directly through Google Cloud Monitoring |
| HushhTech | Search Console BigQuery export | Preferred source. Search metrics appear when export tables are present in `hushh-ai-prod.searchconsole_hushhtech_com` |
| HushhTech | Search Console API fallback | GCP-only aggregate fallback in `hushh-ai-prod.hushhtech_search_console_api`; populated by Cloud Run Job `hushhtech-search-console-ingest` while the official export is waiting |

## DNS Record

This record must exist in Namecheap Advanced DNS for `hushh.ai`:

| Type | Host | Value | TTL |
| --- | --- | --- | --- |
| CNAME Record | `metrics` | `ghs.googlehosted.com` | Automatic |

Verify DNS:

```bash
dig +short CNAME metrics.hushh.ai
```

Expected output:

```text
ghs.googlehosted.com.
```

## Go-Live Verification

Run these checks before considering the hosted site fully live:

```bash
gcloud beta run domain-mappings describe \
  --project=hushh-ai-prod \
  --region=us-central1 \
  --domain=metrics.hushh.ai \
  --format="yaml(status.conditions,status.resourceRecords)"
```

Required Cloud Run domain states:

- `DomainRoutable=True`
- `CertificateProvisioned=True`
- `Ready=True`

Then verify the custom domain:

```bash
curl -I https://metrics.hushh.ai
curl -fsS https://metrics.hushh.ai/api/health
curl -fsS https://metrics.hushh.ai/api/analytics/all
```

Acceptance checks:

- `https://metrics.hushh.ai` loads the dashboard.
- `/api/health` returns `status: "ok"`.
- `/api/analytics/all` returns HTTP `200`.
- HushhTech Supabase top metrics show aggregate counts only.
- No OTP rows, emails, raw setup messages, stack traces, or secrets are visible.
- Cloud Run revision logs show no IAM, BigQuery, Monitoring, Secret Manager, or
  Supabase token failures.

## Current Known Gaps

These gaps should not block the hosted shell from going live, but they explain
why some sections may show neutral empty states:

| Area | Gap | Required action |
| --- | --- | --- |
| Kai production | `hushh-pda.analytics_526603671` is not materialized | Enable or repair the production GA4 BigQuery export; Cloud Run production metrics are still available |
| Kai production | Hosted frontend still needs production web tag redeploy | Redeploy Kai with the production measurement ID already configured in secrets |
| HushhTech Search Console | Official bulk export tables have not materialized yet | GCP-only fallback is active in `hushh-ai-prod.hushhtech_search_console_api`; daily Scheduler job `hushhtech-search-console-ingest-daily` refreshes the last 16 days |
| Hushh AI Search Console | Export dataset exists, but export tables may not be present yet | Wait for Search Console export tables or repair the export configuration |

## Operational Commands

Get the public Cloud Run URL:

```bash
gcloud run services describe hushh-matrix-dashboard \
  --project=hushh-ai-prod \
  --region=us-central1 \
  --format="value(status.url)"
```

Check recent service logs:

```bash
gcloud run services logs read hushh-matrix-dashboard \
  --project=hushh-ai-prod \
  --region=us-central1 \
  --limit=100
```

Check the custom domain:

```bash
gcloud beta run domain-mappings describe \
  --project=hushh-ai-prod \
  --region=us-central1 \
  --domain=metrics.hushh.ai
```

Rotate the HushhTech Supabase management token:

```bash
printf '%s' "$HUSHHTECH_SUPABASE_ACCESS_TOKEN" | \
  gcloud secrets versions add hushhtech-supabase-access-token \
  --project=hushh-ai-prod \
  --data-file=-
```

The Cloud Run service consumes `hushhtech-supabase-access-token:latest`, so a new
secret version is picked up by the next instance start or revision deploy. The
`Hush AI` Supabase database name is used for `hushhtech.com`; keep this token out
of the `hushh.ai` analytics-only path.

Check HushhTech Search Console fallback tables:

```bash
bq query --project_id=hushh-ai-prod --use_legacy_sql=false '
SELECT "site_daily" AS table_name, COUNT(*) AS rows FROM `hushh-ai-prod.hushhtech_search_console_api.site_daily`
UNION ALL SELECT "query_daily", COUNT(*) FROM `hushh-ai-prod.hushhtech_search_console_api.query_daily`
UNION ALL SELECT "page_daily", COUNT(*) FROM `hushh-ai-prod.hushhtech_search_console_api.page_daily`
UNION ALL SELECT "country_daily", COUNT(*) FROM `hushh-ai-prod.hushhtech_search_console_api.country_daily`
UNION ALL SELECT "device_daily", COUNT(*) FROM `hushh-ai-prod.hushhtech_search_console_api.device_daily`
'
```

Run the Search Console API ingestion job manually:

```bash
gcloud run jobs execute hushhtech-search-console-ingest \
  --project=hushh-ai-prod \
  --region=us-central1 \
  --args=scripts/ingest-hushhtech-search-console.mjs,--days,90 \
  --wait
```

Resume the daily fallback if it has been paused:

```bash
gcloud scheduler jobs resume hushhtech-search-console-ingest-daily \
  --project=hushh-ai-prod \
  --location=us-central1
```

Run the HushhTech metrics-flow probe after changing ingestion, Scheduler, GA4,
or dashboard wiring:

```bash
npm run test:prod:hushhtech-flow
```

This probe checks the public HushhTech summary endpoint, the
`metrics.hushh.ai` HushhTech and aggregate APIs, BigQuery fallback freshness,
Cloud Run Job readiness, the latest completed ingestion execution, the
Scheduler target, and the OAuth secret version without printing secret values.

Check that runtime config is still Secret Manager-backed:

```bash
gcloud run services describe hushh-matrix-dashboard \
  --project=hushh-ai-prod \
  --region=us-central1 \
  --format="yaml(spec.template.spec.containers[0].env)"
```

Every configured variable should use `valueFrom.secretKeyRef`; do not deploy
this service with plain `--set-env-vars`.

## Rollback

If the hosted dashboard needs to be rolled back:

1. Open the Cloud Run service in `hushh-ai-prod/us-central1`.
2. Select the last known good revision.
3. Route 100% traffic to that revision.
4. Verify `/api/health` and `/api/analytics/all`.

Do not delete the Namecheap `metrics` CNAME unless the subdomain should stop
serving entirely.

## Related Links

- [Cloud Run services](https://console.cloud.google.com/run?project=hushh-ai-prod)
- [Cloud Run domain mappings](https://console.cloud.google.com/run/domains?project=hushh-ai-prod)
- [Secret Manager](https://console.cloud.google.com/security/secret-manager?project=hushh-ai-prod)
- [Namecheap Advanced DNS for hushh.ai](https://ap.www.namecheap.com/domains/domaincontrolpanel/hushh.ai/advancedns)
- [Deployment runbook](./deploy-metrics-hushh-ai.md)
