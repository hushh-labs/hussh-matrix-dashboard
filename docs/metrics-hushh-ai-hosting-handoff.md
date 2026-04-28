# Hosted `metrics.hushh.ai` Handoff

This document is the operational handoff for running the Hushh Matrix
Dashboard as the public aggregate metrics site at `https://metrics.hushh.ai`.

## Current Hosting State

Last verified: 2026-04-28.

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
| Current deployed image tag | `hushh-matrix-dashboard:5c849ac` |
| Public access | Enabled, aggregate-only |

## Public Data Contract

The hosted dashboard reads from `/api/analytics/all`. The endpoint must return
aggregate metrics only. Do not expose raw user rows, emails, tokens, stack
traces, setup errors, or provider diagnostics in the visible UI.

Current platform sources:

| Platform | Source | Hosted behavior |
| --- | --- | --- |
| Hushh AI | Cloud Run Monitoring | Last 7 days request count, error count, error rate, p95 latency, instance count, and daily request series |
| Hushh AI | Supabase Management API | Top aggregate database metrics plus date-range daily status for new users, active users, sessions, exit signals, product usage, and analytics events |
| Hushh AI | Search Console BigQuery export | Search metrics appear when export tables are present in `hushh-pda.searchconsole_searchconsole_hushh_ai` |
| Hushh AI | Live refresh layer | API responses are no-store, the UI auto-refreshes every 30 seconds, and source freshness labels distinguish request-time, near-live, delayed, and pending sources |
| Kai | BigQuery public feed | UAT dashboard metrics, funnel, usage, engagement, geo, and instrumentation health |
| Kai | GA4 BigQuery export | UAT GA4 aggregates from `hushh-pda-uat.analytics_533362555` |
| Kai | Production feed | Status-only until the production GA4 export dataset materializes |
| HushhTech | Public summary endpoint | `GET /api/metrics/summary?window_days=7` from the HushhTech Cloud Run service |

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
- Hushh AI Supabase top metrics show aggregate counts only.
- No OTP rows, emails, raw setup messages, stack traces, or secrets are visible.
- Cloud Run revision logs show no IAM, BigQuery, Monitoring, Secret Manager, or
  Supabase token failures.

## Current Known Gaps

These gaps should not block the hosted shell from going live, but they explain
why some sections may show neutral empty states:

| Area | Gap | Required action |
| --- | --- | --- |
| Kai production | `hushh-pda.analytics_526603671` is not materialized | Enable or repair the production GA4 BigQuery export |
| Kai production | Hosted frontend still needs production web tag redeploy | Redeploy Kai with the production measurement ID already configured in secrets |
| HushhTech GA4 | Numeric GA4 property ID is not configured | Add the numeric property ID, not only the `G-...` measurement ID |
| HushhTech Search Console | Runtime service account still needs property access | Grant the Cloud Run runtime identity access to the correct Search Console property |
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

Rotate the Supabase management token:

```bash
printf '%s' "$HUSHH_AI_SUPABASE_ACCESS_TOKEN" | \
  gcloud secrets versions add hushh-ai-supabase-access-token \
  --project=hushh-ai-prod \
  --data-file=-
```

The Cloud Run service consumes `hushh-ai-supabase-access-token:latest`, so a new
secret version is picked up by the next instance start or revision deploy.

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
