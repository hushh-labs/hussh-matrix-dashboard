<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Hussh Matrix Dashboard

Unified engagement dashboard for **kai.hushh.ai**, **hushhtech.com**, and **hushh.ai** powered by Hussh.

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
  - Production: `hushh-pda.analytics_public.kai_public_dashboard_feed` (status-only until GA4 export materializes)
  - hushh.ai: Cloud Run Monitoring and Search Console export readiness only
  - kai.hushh.ai: public BigQuery feed plus raw GA4 export aggregates
  - hushhtech.com: Supabase database aggregates, canonical production summary endpoint for business/GA4, metrics.hushh.ai-owned Cloud Run Monitoring, and GCP-backed Search Console coverage

## Product Boundaries

| Product | Canonical metrics source |
| --- | --- |
| `kai.hushh.ai` | BigQuery public dashboard feeds, GA4 export aggregates, and Cloud Run Monitoring |
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

## Production Checks

Run the Hushh AI production probe instead of manually clicking through the hosted dashboard:

```bash
npm run test:prod:hushh-ai
npm run test:prod:hushhtech
npm run test:prod:kai
```

The probes verify DNS, product roots, the dashboard health endpoint, product analytics endpoints, `/api/analytics/all`, no-store API cache headers, and product freshness payloads. If a dictated alias such as `matrix.hush.ai` or `kai.hush.ai` is provided, the checks report the literal DNS status and verify the canonical deployment.

## Data Flow

The dashboard fetches from `/api/analytics/all` which returns:
- **Kai UAT feed**: DAU, WAU, MAU, sessions, events, investor/RIA funnels, platform mix
- **Kai raw GA4 export**: top events, users, sessions, country, device, and platform aggregates from `analytics_533362555`
- **Kai Production feed**: Status-only with `production_ready=false` until `analytics_526603671` materializes
- **Kai Production Cloud Run**: `kai.hushh.ai` requests, non-2xx, p95 latency, instance count, and daily reliability from `hushh-pda/hushh-webapp`
- **hushh.ai**: Cloud Run request, latency, instance, and Search Console export-table status. No Supabase database is attached to this product.
- **hushhtech.com**: Supabase database aggregates, public-safe summary from `GET https://hushhtech.com/api/metrics/summary?window_days=7` for business funnel and GA4 traffic, plus direct Cloud Run Monitoring and GCP-backed Search Console metrics fetched by `metrics.hushh.ai`. Search Console clicks, impressions, CTR, queries, pages, countries, and devices must not come from Supabase.

When a provider is not fully configured, the dashboard keeps raw diagnostic text out of the visible UI and shows neutral empty or syncing states instead of synthetic metrics.

## Remaining Blockers

| Platform | Blocker | Action |
| --- | --- | --- |
| kai.hushh.ai (prod) | GA4 export dataset not materialized | Resolve `hushh-pda.analytics_526603671` materialization |
| kai.hushh.ai (prod) | Web tag not deployed | Redeploy frontend with `G-2PCECPSKCR` |
| hushhtech.com | Official Search Console bulk export has not produced `searchdata_site_impression` / `searchdata_url_impression` yet | Use the GCP-only fallback dataset `hushh-ai-prod.hushhtech_search_console_api`; the ingestion job still requires a Search Console owner/full-user OAuth credential in Secret Manager |
