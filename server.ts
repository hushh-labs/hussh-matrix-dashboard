/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Express server for the Hussh Matrix Dashboard.
 * Proxies BigQuery public feed queries and the hushhtech.com analytics endpoint
 * so the React SPA can consume real metrics without exposing credentials.
 */

import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

// ---------------------------------------------------------------------------
// Config from environment
// ---------------------------------------------------------------------------

const BQ_UAT_PROJECT = process.env.BQ_UAT_PROJECT || 'hushh-pda-uat';
const BQ_UAT_DATASET = process.env.BQ_UAT_DATASET || 'analytics_public';
const BQ_UAT_VIEW = process.env.BQ_UAT_VIEW || 'kai_public_dashboard_feed';

const BQ_PROD_PROJECT = process.env.BQ_PROD_PROJECT || 'hushh-pda';
const BQ_PROD_DATASET = process.env.BQ_PROD_DATASET || 'analytics_public';
const BQ_PROD_VIEW = process.env.BQ_PROD_VIEW || 'kai_public_dashboard_feed';

const BQ_JOB_PROJECT = process.env.BQ_JOB_PROJECT || '';
const HUSHHTECH_ENDPOINT = process.env.HUSHHTECH_ANALYTICS_ENDPOINT || '';

// ---------------------------------------------------------------------------
// BigQuery helper — uses Application Default Credentials (ADC)
// ---------------------------------------------------------------------------

interface BigQueryFeedResult {
  rows: Record<string, unknown>[];
  error: string | null;
}

async function queryBigQuery(
  projectId: string,
  dataset: string,
  view: string,
): Promise<BigQueryFeedResult> {
  try {
    const { BigQuery } = await import('@google-cloud/bigquery');
    const bq = new BigQuery({ projectId: BQ_JOB_PROJECT || projectId });
    const query = `
      SELECT *
      FROM \`${projectId}.${dataset}.${view}\`
      ORDER BY metric_group, metric_name, metric_date
    `;
    const [rows] = await bq.query({ query, location: 'US' });
    return { rows: rows as Record<string, unknown>[], error: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`BigQuery query failed for ${projectId}.${dataset}.${view}:`, message);
    return { rows: [], error: message };
  }
}

// ---------------------------------------------------------------------------
// hushhtech.com analytics proxy
// ---------------------------------------------------------------------------

async function fetchHushhTechAnalytics(): Promise<Record<string, unknown> | null> {
  if (!HUSHHTECH_ENDPOINT) return null;
  try {
    const res = await fetch(HUSHHTECH_ENDPOINT, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(`hushhtech.com endpoint returned ${res.status}`);
      return { trafficAvailable: false, stateAvailable: false, searchConsoleAvailable: false };
    }
    return (await res.json()) as Record<string, unknown>;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('hushhtech.com fetch failed:', message);
    return { trafficAvailable: false, stateAvailable: false, searchConsoleAvailable: false };
  }
}

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

app.get('/api/analytics/kai/uat', async (_req, res) => {
  const result = await queryBigQuery(BQ_UAT_PROJECT, BQ_UAT_DATASET, BQ_UAT_VIEW);
  res.status(result.error ? 502 : 200).json({
    environment: 'uat',
    rows: result.rows,
    error: result.error,
    fetchedAt: new Date().toISOString(),
  });
});

app.get('/api/analytics/kai/production', async (_req, res) => {
  const result = await queryBigQuery(BQ_PROD_PROJECT, BQ_PROD_DATASET, BQ_PROD_VIEW);
  res.status(result.error ? 502 : 200).json({
    environment: 'production',
    rows: result.rows,
    error: result.error,
    fetchedAt: new Date().toISOString(),
  });
});

app.get('/api/analytics/hushhtech', async (_req, res) => {
  const data = await fetchHushhTechAnalytics();
  res.json({ platform: 'hushhtech.com', data, fetchedAt: new Date().toISOString() });
});

app.get('/api/analytics/all', async (_req, res) => {
  const [uat, production, hushhTech] = await Promise.all([
    queryBigQuery(BQ_UAT_PROJECT, BQ_UAT_DATASET, BQ_UAT_VIEW),
    queryBigQuery(BQ_PROD_PROJECT, BQ_PROD_DATASET, BQ_PROD_VIEW),
    fetchHushhTechAnalytics(),
  ]);
  res.json({
    kai: {
      uat: { environment: 'uat', rows: uat.rows, error: uat.error },
      production: { environment: 'production', rows: production.rows, error: production.error },
    },
    hushhTech: { platform: 'hushhtech.com', data: hushhTech },
    fetchedAt: new Date().toISOString(),
  });
});

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    config: {
      bqUat: `${BQ_UAT_PROJECT}.${BQ_UAT_DATASET}.${BQ_UAT_VIEW}`,
      bqProd: `${BQ_PROD_PROJECT}.${BQ_PROD_DATASET}.${BQ_PROD_VIEW}`,
      bqJobProject: BQ_JOB_PROJECT || '(feed project)',
      hushhTechEndpoint: HUSHHTECH_ENDPOINT || '(not configured)',
    },
  });
});

// ---------------------------------------------------------------------------
// Serve static Vite build in production
// ---------------------------------------------------------------------------

const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));
app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Hussh Matrix Dashboard server listening on http://localhost:${PORT}`);
  console.log(`  BigQuery UAT:  ${BQ_UAT_PROJECT}.${BQ_UAT_DATASET}.${BQ_UAT_VIEW}`);
  console.log(`  BigQuery Prod: ${BQ_PROD_PROJECT}.${BQ_PROD_DATASET}.${BQ_PROD_VIEW}`);
  console.log(`  hushhtech.com: ${HUSHHTECH_ENDPOINT || '(not configured)'}`);
});
