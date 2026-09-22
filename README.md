<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Hussh Matrix Dashboard

Unified engagement dashboard for **one.hushh.ai**, **hushhtech.com**, and **hushh.ai** powered by Hussh.

## Architecture

```
React SPA (Vite)  →  Express Server  →  BigQuery (kai_public_dashboard_feed)
                                     →  hushhtech.com summary endpoint + GCP provider APIs
                                     →  Supabase Management API (aggregate counts)
                                     →  Gemini API (AI insights)
```

- **Frontend**: Vite + React 19 + TypeScript + Tailwind CSS v4 + Recharts + Motion
- **Backend**: Express server proxying BigQuery and hushhtech.com analytics
- **Data sources**:
  - UAT: `hushh-pda-uat.analytics_public.kai_public_dashboard_feed` (live, full data)
  - Production: `hushh-pda.analytics_public.kai_public_dashboard_feed` (live; the view aggregates `hushh-pda.analytics_526603671`, scoped to the One app surface)
  - hushh.ai: Cloud Run Monitoring and Search Console export readiness only
  - one.hushh.ai: public BigQuery feed plus raw GA4 export aggregates
  - hushhtech.com: Supabase database aggregates, canonical production summary endpoint for business/GA4, metrics.hushh.ai-owned Cloud Run Monitoring, and GCP-backed Search Console coverage

## Product Boundaries

| Product | Canonical metrics source |
| --- | --- |
| `one.hushh.ai` | BigQuery public dashboard feeds, GA4 export aggregates, and Cloud Run Monitoring |
| `hushh.ai` | Analytics only: Cloud Run Monitoring and Search Console export readiness. No Supabase database is attached to this product. |
| `hushhtech.com` | Supabase database aggregates plus HushhTech business/GA4 summary, Cloud Run Monitoring, and Search Console metrics from GCP. The dashboard prefers the official bulk export in `hushh-ai-prod.searchconsole_hushhtech_com`, then falls back to aggregate-only API-ingested tables in `hushh-ai-prod.hushhtech_search_console_api`. The Supabase database is named `Hush AI`; that name belongs to the `hushhtech.com` data source in this dashboard. |

## Run Locally

**Prerequisites:** Node.js 20+, `gcloud auth application-default login` for BigQuery access.

The ADC identity needs:
- `bigquery.jobs.create` on the BigQuery job project
- read access to the configured public dashboard feed views

If job creation is not granted on the feed projects directly, set `BQ_JOB_PROJECT` to a project where the ADC identity can create BigQuery jobs.

If the BigQuery CLI works but the Express server returns `bigquery.jobs.create` errors, refresh ADC with the same Google identity used by `bq`:

```bash
gcloud auth application-default login
```

For local developer runs, the Express proxy can also fall back to the authenticated `bq` CLI when ADC and `gcloud` CLI auth differ. Set `BQ_CLI_FALLBACK=false` to disable that fallback.

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment:
   ```bash
   cp .env.example .env.local
   # Edit .env.local — set GEMINI_API_KEY and server-side provider tokens only as needed
   ```

3. Run the dashboard (dev mode with API proxy):
   ```bash
   # Terminal 1: Start the Express API server
   npm start

   # Terminal 2: Start the Vite dev server (proxies /api to :3001)
   npm run dev
   ```

4. Or build and serve production:
   ```bash
   npm run build
   npm start
   # Dashboard available at http://localhost:3001
   ```

## Shareable One Location routes

The One Location detail view has stable, refresh-safe URLs. The environment stays isolated in
the path and each analytics section can be linked directly:

- `/location-analytics` and `/location-analytics/production` — Production overview
- `/location-analytics/uat` — UAT/Test overview
- `/location-analytics/{production|uat}/features`
- `/location-analytics/{production|uat}/circles`
- `/location-analytics/{production|uat}/journey`

Run `npm run test:routes:one-location` to verify the route parser and canonical URL contract.

## Production Checks

Run the Hushh AI production probe instead of manually clicking through the hosted dashboard:

```bash
npm run test:prod:hushh-ai
npm run test:prod:hushhtech
npm run test:prod:hushhtech-flow
npm run test:prod:kai
```

The probes verify DNS, product roots, the dashboard health endpoint, product analytics endpoints, `/api/analytics/all`, no-store API cache headers, and product freshness payloads. If a dictated alias such as `matrix.hush.ai` or `kai.hush.ai` is provided, the checks report the literal DNS status and verify the canonical deployment.
The HushhTech flow probe additionally verifies that `hushhtech.com` GA4 summary data, GCP Search Console fallback tables, the Cloud Run ingestion job, the Scheduler trigger, and `metrics.hushh.ai` are connected end to end.

## Data Flow

The dashboard fetches from `/api/analytics/all` which returns:
- **One UAT feed**: DAU, WAU, MAU, sessions, events, investor/RIA funnels, platform mix
- **One raw GA4 export**: top events, users, sessions, country, device, and platform aggregates from `analytics_533362555`
- **One Production feed**: Live. `production_ready=true`, aggregated from `analytics_526603671` over the One app surface (native plus `one.hushh.ai`), excluding `hushh.ai` marketing pages and `uat.hushh.ai`. Counts are device-scoped; see `docs/metrics/one-source-coverage-inventory.md`
- **One Production Cloud Run**: `one.hushh.ai` requests, non-2xx, p95 latency, instance count, and daily reliability from `hushh-pda/hushh-webapp`
- **hushh.ai**: Cloud Run request, latency, instance, and Search Console export-table status. No Supabase database is attached to this product.
- **hushhtech.com**: Supabase database aggregates, public-safe summary from `GET https://hushhtech.com/api/metrics/summary?window_days=7` for business funnel and GA4 traffic, plus direct Cloud Run Monitoring and GCP-backed Search Console metrics fetched by `metrics.hushh.ai`. Search Console clicks, impressions, CTR, queries, pages, countries, and devices must not come from Supabase.

When a provider is not fully configured, the dashboard keeps raw diagnostic text out of the visible UI and shows neutral empty or syncing states instead of synthetic metrics.

## Metrics Documentation

`docs/metrics/one-source-coverage-inventory.md` is the metric dictionary and source-coverage
inventory for One adoption, agent usage and hushh.ai: what each metric means, which event or
business record backs it, and what is still missing. `npm run test:metrics:one-reconciliation`
re-verifies every figure in it against live data.

`sql/kai_public_dashboard_feed.production.sql` is the deployed definition of the production
feed view, with `.rollback.sql` alongside it.

## Remaining Blockers

| Platform | Blocker | Action |
| --- | --- | --- |
| One / one.hushh.ai | Historical GA4 coverage is primarily device/browser scoped; the stable signed-in identity fix is in `hushh-research` PR #6960 and needs a web/mobile release before new coverage improves | Release the identity fix, then monitor the signed-in coverage KPI; never add web/app device counts together |
| One GA4 realtime | The metrics runtime identity can read BigQuery exports but does not yet have GA4 Data API access to properties `526603671` and `533362555` | Grant Viewer or Analyst in GA Admin to the configured metrics GA4 service account |
| One (prod) | No agent invocation event exists, so "agents used" is not measurable | Add an agent turn event in `hushh-research`; see §1.5 |
| One (prod) | No agent claim event or queryable pod registry, so "agents claimed" is not measurable | Decide the authoritative record; see §1.4 |
| hushh.ai | `HUSHH_AI_GA4_PROPERTY_ID` unset, so the GA4 card reads `not_configured` | Set it (candidate `458078330`); see §5 |
| Production property | `uat.hushh.ai` traffic lands in the production GA4 property | Resolve at the source; see §4 |
| hushhtech.com | Official Search Console bulk export has not produced `searchdata_site_impression` / `searchdata_url_impression` yet | The GCP-only fallback dataset `hushh-ai-prod.hushhtech_search_console_api` is active until Google's official export tables appear |
