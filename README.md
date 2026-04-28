<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Hussh Matrix Dashboard

Unified engagement dashboard for **kai.hushh.ai**, **hushhtech.com**, and **hushh.ai** powered by Hussh.

## Architecture

```
React SPA (Vite)  →  Express Server  →  BigQuery (kai_public_dashboard_feed)
                                     →  hushhtech.com Cloud Run endpoint
                                     →  Gemini API (AI insights)
```

- **Frontend**: Vite + React 19 + TypeScript + Tailwind CSS v4 + Recharts + Motion
- **Backend**: Express server proxying BigQuery and hushhtech.com analytics
- **Data sources**:
  - UAT: `hushh-pda-uat.analytics_public.kai_public_dashboard_feed` (live, full data)
  - Production: `hushh-pda.analytics_public.kai_public_dashboard_feed` (status-only until GA4 export materializes)
  - hushhtech.com: Cloud Run analytics endpoint (blocked — needs numeric GA4 property ID)

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

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment:
   ```bash
   cp .env.example .env.local
   # Edit .env.local — set GEMINI_API_KEY and optionally HUSHHTECH_ANALYTICS_ENDPOINT
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

## Data Flow

The dashboard fetches from `/api/analytics/all` which returns:
- **Kai UAT feed**: DAU, WAU, MAU, sessions, events, investor/RIA funnels, platform mix
- **Kai Production feed**: Status-only with `production_ready=false` until `analytics_526603671` materializes
- **hushhtech.com**: Traffic, sessions, bounce rate, Search Console metrics (when available)

When the API server is not running, the dashboard falls back to demo data and shows a banner indicating the data source.

## Remaining Blockers

| Platform | Blocker | Action |
| --- | --- | --- |
| kai.hushh.ai (prod) | GA4 export dataset not materialized | Resolve `hushh-pda.analytics_526603671` materialization |
| kai.hushh.ai (prod) | Web tag not deployed | Redeploy frontend with `G-2PCECPSKCR` |
| hushhtech.com | Numeric GA4 property ID missing | Provide the property ID (not measurement ID `G-R58S9WWPM0`) |
| hushhtech.com | Search Console access | Add `175298245599-compute@developer.gserviceaccount.com` to `sc-domain:hushhtech.com` |
