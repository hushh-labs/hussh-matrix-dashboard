<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Hussh Matrix Dashboard

Unified engagement dashboard for **kai.hushh.ai**, **hushhtech.com**, and **hushh.ai** powered by Hussh.

## Architecture

```
React SPA (Vite)  →  Express Server  →  BigQuery (kai_public_dashboard_feed)
                                     →  hushhtech.com public metrics endpoint
                                     →  Supabase Management API (aggregate counts)
                                     →  Gemini API (AI insights)
```

- **Frontend**: Vite + React 19 + TypeScript + Tailwind CSS v4 + Recharts + Motion
- **Backend**: Express server proxying BigQuery and hushhtech.com analytics
- **Data sources**:
  - UAT: `hushh-pda-uat.analytics_public.kai_public_dashboard_feed` (live, full data)
  - Production: `hushh-pda.analytics_public.kai_public_dashboard_feed` (status-only until GA4 export materializes)
  - hushh.ai: Cloud Run Monitoring, Search Console export readiness, Supabase aggregate database counts, and date-range daily status metrics
  - kai.hushh.ai: public BigQuery feed plus raw GA4 export aggregates
  - hushhtech.com: public Cloud Run summary endpoint with Supabase business funnel, first-party activity, Search Console shape, GA4 traffic shape, and GCP Cloud Run Monitoring

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
npm run test:prod:kai
```

The probes verify DNS, product roots, the dashboard health endpoint, product analytics endpoints, `/api/analytics/all`, no-store API cache headers, and product freshness payloads. If a dictated alias such as `matrix.hush.ai` or `kai.hush.ai` is provided, the checks report the literal DNS status and verify the canonical deployment.

## Data Flow

The dashboard fetches from `/api/analytics/all` which returns:
- **Kai UAT feed**: DAU, WAU, MAU, sessions, events, investor/RIA funnels, platform mix
- **Kai raw GA4 export**: top events, users, sessions, country, device, and platform aggregates from `analytics_533362555`
- **Kai Production feed**: Status-only with `production_ready=false` until `analytics_526603671` materializes
- **Kai Production Cloud Run**: `kai.hushh.ai` requests, non-2xx, p95 latency, instance count, and daily reliability from `hushh-pda/hushh-webapp`
- **hushh.ai**: Cloud Run request, latency, instance, Search Console export-table status, top Supabase aggregate counts, and date-range daily status from Auth users, Auth sessions, delete requests, product usage, and analytics events
- **hushhtech.com**: Public-safe summary from `GET /api/metrics/summary?window_days=7`, including audience, search, business funnel, activity, traffic, Search Console shape, GCP Monitoring, system health, and data coverage.

When a provider is not fully configured, the dashboard keeps raw diagnostic text out of the visible UI and shows neutral empty or syncing states instead of synthetic metrics.

## Remaining Blockers

| Platform | Blocker | Action |
| --- | --- | --- |
| kai.hushh.ai (prod) | GA4 export dataset not materialized | Resolve `hushh-pda.analytics_526603671` materialization |
| kai.hushh.ai (prod) | Web tag not deployed | Redeploy frontend with `G-2PCECPSKCR` |
| hushhtech.com | Numeric GA4 property ID missing | Provide the property ID (not measurement ID `G-R58S9WWPM0`) |
| hushhtech.com | Search Console access | Add `175298245599-compute@developer.gserviceaccount.com` to `sc-domain:hushhtech.com` |
