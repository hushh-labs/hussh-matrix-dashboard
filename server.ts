/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Express server for the Hussh Matrix Dashboard.
 * Proxies BigQuery public feed queries and the hushhtech.com analytics endpoint
 * so the React SPA can consume real metrics without exposing credentials.
 */

import 'dotenv/config';
import { execFile } from 'node:child_process';
import express from 'express';
import path from 'path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execFileAsync = promisify(execFile);

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
const BQ_CLI_FALLBACK = process.env.BQ_CLI_FALLBACK !== 'false';
const DEFAULT_HUSHHTECH_ENDPOINT =
  'https://hushh-tech-website-bmrh3cdxwa-uc.a.run.app/api/metrics/summary';
const HUSHHTECH_ENDPOINT = process.env.HUSHHTECH_ANALYTICS_ENDPOINT || DEFAULT_HUSHHTECH_ENDPOINT;
const HUSHHTECH_WINDOW_DAYS = process.env.HUSHHTECH_METRICS_WINDOW_DAYS || '7';

// ---------------------------------------------------------------------------
// BigQuery helper — uses Application Default Credentials (ADC)
// ---------------------------------------------------------------------------

interface BigQueryFeedResult {
  rows: Record<string, unknown>[];
  error: string | null;
}

async function queryBigQueryWithCli(
  projectId: string,
  dataset: string,
  view: string,
): Promise<Record<string, unknown>[]> {
  const queryJobProject = BQ_JOB_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || projectId;
  const query = `
    SELECT *
    FROM \`${projectId}.${dataset}.${view}\`
    ORDER BY metric_group, metric_name, metric_date
  `;
  const { stdout } = await execFileAsync(
    'bq',
    [
      `--project_id=${queryJobProject}`,
      'query',
      '--use_legacy_sql=false',
      '--format=json',
      '--max_rows=10000',
      query,
    ],
    { timeout: 60_000, maxBuffer: 20 * 1024 * 1024 },
  );
  return JSON.parse(stdout) as Record<string, unknown>[];
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
    if (BQ_CLI_FALLBACK) {
      try {
        const rows = await queryBigQueryWithCli(projectId, dataset, view);
        return { rows, error: null };
      } catch (cliErr: unknown) {
        const cliMessage = cliErr instanceof Error ? cliErr.message : String(cliErr);
        console.error(`bq CLI fallback failed for ${projectId}.${dataset}.${view}:`, cliMessage);
        return { rows: [], error: `${message}; bq CLI fallback failed: ${cliMessage}` };
      }
    }
    return { rows: [], error: message };
  }
}

// ---------------------------------------------------------------------------
// hushhtech.com analytics proxy
// ---------------------------------------------------------------------------

function buildHushhTechUrl(): string {
  const url = new URL(HUSHHTECH_ENDPOINT);
  if (!url.searchParams.has('window_days')) {
    url.searchParams.set('window_days', HUSHHTECH_WINDOW_DAYS);
  }
  return url.toString();
}

async function fetchHushhTechAnalytics(): Promise<{ data: Record<string, unknown> | null; error: string | null }> {
  try {
    const res = await fetch(buildHushhTechUrl(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const message = `hushhtech.com endpoint returned ${res.status}`;
      console.error(message);
      return { data: null, error: message };
    }
    return { data: (await res.json()) as Record<string, unknown>, error: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('hushhtech.com fetch failed:', message);
    return { data: null, error: message };
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
  const result = await fetchHushhTechAnalytics();
  res.status(result.error ? 502 : 200).json({
    platform: 'hushhtech.com',
    data: result.data,
    error: result.error,
    fetchedAt: new Date().toISOString(),
  });
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
    hushhTech: { platform: 'hushhtech.com', data: hushhTech.data, error: hushhTech.error },
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
      hushhTechEndpoint: buildHushhTechUrl(),
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
  console.log(`  hushhtech.com: ${buildHushhTechUrl()}`);
});
