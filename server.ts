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
const KAI_GA4_PROJECT = process.env.KAI_GA4_PROJECT || BQ_UAT_PROJECT;
const KAI_GA4_DATASET = process.env.KAI_GA4_DATASET || 'analytics_533362555';
const KAI_GA4_WINDOW_DAYS = parseInt(process.env.KAI_GA4_WINDOW_DAYS || '14', 10);
const HUSHH_AI_GCP_PROJECT = process.env.HUSHH_AI_GCP_PROJECT || 'hushh-ai-prod';
const HUSHH_AI_CLOUD_RUN_SERVICE = process.env.HUSHH_AI_CLOUD_RUN_SERVICE || 'hushh-ai-website';
const HUSHH_AI_METRICS_WINDOW_DAYS = parseInt(process.env.HUSHH_AI_METRICS_WINDOW_DAYS || '7', 10);
const HUSHH_AI_SEARCH_PROJECT = process.env.HUSHH_AI_SEARCH_PROJECT || BQ_PROD_PROJECT;
const HUSHH_AI_SEARCH_DATASET =
  process.env.HUSHH_AI_SEARCH_DATASET || 'searchconsole_searchconsole_hushh_ai';

// ---------------------------------------------------------------------------
// BigQuery helper — uses Application Default Credentials (ADC)
// ---------------------------------------------------------------------------

interface BigQueryFeedResult {
  rows: Record<string, unknown>[];
  error: string | null;
}

interface DataResult<T> {
  data: T | null;
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

async function queryBigQuerySqlWithCli(
  queryJobProject: string,
  query: string,
): Promise<Record<string, unknown>[]> {
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

async function queryBigQuerySql(queryJobProject: string, query: string): Promise<BigQueryFeedResult> {
  try {
    const { BigQuery } = await import('@google-cloud/bigquery');
    const bq = new BigQuery({ projectId: queryJobProject });
    const [rows] = await bq.query({ query, location: 'US' });
    return { rows: rows as Record<string, unknown>[], error: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('BigQuery SQL query failed:', message);
    if (BQ_CLI_FALLBACK) {
      try {
        const rows = await queryBigQuerySqlWithCli(queryJobProject, query);
        return { rows, error: null };
      } catch (cliErr: unknown) {
        const cliMessage = cliErr instanceof Error ? cliErr.message : String(cliErr);
        console.error('bq CLI SQL fallback failed:', cliMessage);
        return { rows: [], error: `${message}; bq CLI fallback failed: ${cliMessage}` };
      }
    }
    return { rows: [], error: message };
  }
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
// Kai GA4 raw export summary
// ---------------------------------------------------------------------------

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function fetchKaiGa4Summary(): Promise<DataResult<Record<string, unknown>>> {
  const windowDays = Number.isFinite(KAI_GA4_WINDOW_DAYS) ? KAI_GA4_WINDOW_DAYS : 14;
  const table = `\`${KAI_GA4_PROJECT}.${KAI_GA4_DATASET}.events_*\``;
  const suffixStart = `FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL ${windowDays} DAY))`;
  const suffixEnd = `FORMAT_DATE('%Y%m%d', CURRENT_DATE())`;
  const dateFilter = `_TABLE_SUFFIX BETWEEN ${suffixStart} AND ${suffixEnd}`;

  const dailyQuery = `
    SELECT
      CAST(DATE(TIMESTAMP_MICROS(event_timestamp)) AS STRING) AS eventDate,
      COUNT(*) AS events,
      COUNT(DISTINCT user_pseudo_id) AS users,
      COUNT(DISTINCT (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id')) AS sessions
    FROM ${table}
    WHERE ${dateFilter}
    GROUP BY eventDate
    ORDER BY eventDate DESC
    LIMIT 30
  `;
  const eventsQuery = `
    SELECT
      event_name AS eventName,
      COUNT(*) AS events,
      COUNT(DISTINCT user_pseudo_id) AS users
    FROM ${table}
    WHERE ${dateFilter}
    GROUP BY eventName
    ORDER BY events DESC
    LIMIT 20
  `;
  const geoQuery = `
    SELECT
      platform,
      device.category AS deviceCategory,
      geo.country AS country,
      COUNT(*) AS events,
      COUNT(DISTINCT user_pseudo_id) AS users
    FROM ${table}
    WHERE ${dateFilter}
    GROUP BY platform, deviceCategory, country
    ORDER BY events DESC
    LIMIT 20
  `;

  const queryProject = BQ_JOB_PROJECT || KAI_GA4_PROJECT;
  const [daily, topEvents, geo] = await Promise.all([
    queryBigQuerySql(queryProject, dailyQuery),
    queryBigQuerySql(queryProject, eventsQuery),
    queryBigQuerySql(queryProject, geoQuery),
  ]);
  const errors = [daily.error, topEvents.error, geo.error].filter(Boolean);

  if (daily.rows.length === 0 && topEvents.rows.length === 0 && geo.rows.length === 0 && errors.length > 0) {
    return { data: null, error: errors.join('; ') };
  }

  return {
    data: {
      sourceProjectId: KAI_GA4_PROJECT,
      sourceDataset: KAI_GA4_DATASET,
      windowDays,
      daily: daily.rows.map((row) => ({
        eventDate: row.eventDate,
        events: toNumber(row.events),
        users: toNumber(row.users),
        sessions: toNumber(row.sessions),
      })),
      topEvents: topEvents.rows.map((row) => ({
        eventName: row.eventName,
        events: toNumber(row.events),
        users: toNumber(row.users),
      })),
      geo: geo.rows.map((row) => ({
        platform: row.platform,
        deviceCategory: row.deviceCategory,
        country: row.country,
        events: toNumber(row.events),
        users: toNumber(row.users),
      })),
    },
    error: errors.length > 0 ? errors.join('; ') : null,
  };
}

// ---------------------------------------------------------------------------
// Hush AI GCP and Search Console summaries
// ---------------------------------------------------------------------------

function monitoringPointValue(point: Record<string, unknown> | undefined): number {
  const value = point?.value as Record<string, unknown> | undefined;
  return toNumber(value?.int64Value ?? value?.doubleValue);
}

async function fetchMonitoringSeries(
  projectId: string,
  serviceName: string,
  metricType: string,
  perSeriesAligner: string,
  crossSeriesReducer: string,
  alignmentSeconds: number,
  extraFilter = '',
): Promise<Array<Record<string, unknown>>> {
  const end = new Date();
  const start = new Date(end.getTime() - HUSHH_AI_METRICS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const url = new URL(`https://monitoring.googleapis.com/v3/projects/${projectId}/timeSeries`);
  url.searchParams.set(
    'filter',
    [
      `metric.type="${metricType}"`,
      'resource.type="cloud_run_revision"',
      `resource.labels.service_name="${serviceName}"`,
      extraFilter,
    ].filter(Boolean).join(' AND '),
  );
  url.searchParams.set('interval.startTime', start.toISOString());
  url.searchParams.set('interval.endTime', end.toISOString());
  url.searchParams.set('aggregation.alignmentPeriod', `${alignmentSeconds}s`);
  url.searchParams.set('aggregation.perSeriesAligner', perSeriesAligner);
  url.searchParams.set('aggregation.crossSeriesReducer', crossSeriesReducer);
  url.searchParams.append('aggregation.groupByFields', 'resource.labels.service_name');

  try {
    const { GoogleAuth } = await import('google-auth-library');
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const client = await auth.getClient();
    const res = await (client as any).request({ url: url.toString() });
    return (res.data?.timeSeries ?? []) as Array<Record<string, unknown>>;
  } catch (err: unknown) {
    if (!BQ_CLI_FALLBACK) throw err;
    const { stdout } = await execFileAsync('gcloud', ['auth', 'print-access-token'], { timeout: 30_000 });
    const token = stdout.trim();
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new Error(`Monitoring API returned ${res.status}`);
    }
    const data = await res.json() as { timeSeries?: Array<Record<string, unknown>> };
    return data.timeSeries ?? [];
  }
}

async function fetchHushhAiCloudRun(): Promise<DataResult<Record<string, unknown>>> {
  try {
    const serviceName = HUSHH_AI_CLOUD_RUN_SERVICE;
    const projectId = HUSHH_AI_GCP_PROJECT;
    const windowSeconds = HUSHH_AI_METRICS_WINDOW_DAYS * 24 * 60 * 60;
    const [requests, errors, latency, instances, dailyRequests] = await Promise.all([
      fetchMonitoringSeries(projectId, serviceName, 'run.googleapis.com/request_count', 'ALIGN_DELTA', 'REDUCE_SUM', windowSeconds),
      fetchMonitoringSeries(projectId, serviceName, 'run.googleapis.com/request_count', 'ALIGN_DELTA', 'REDUCE_SUM', windowSeconds, 'metric.labels.response_code_class="5xx"'),
      fetchMonitoringSeries(projectId, serviceName, 'run.googleapis.com/request_latencies', 'ALIGN_PERCENTILE_95', 'REDUCE_PERCENTILE_95', windowSeconds),
      fetchMonitoringSeries(projectId, serviceName, 'run.googleapis.com/container/instance_count', 'ALIGN_MAX', 'REDUCE_MAX', windowSeconds),
      fetchMonitoringSeries(projectId, serviceName, 'run.googleapis.com/request_count', 'ALIGN_DELTA', 'REDUCE_SUM', 86_400),
    ]);
    const requestCount = monitoringPointValue((requests[0]?.points as Record<string, unknown>[] | undefined)?.[0]);
    const errorCount = monitoringPointValue((errors[0]?.points as Record<string, unknown>[] | undefined)?.[0]);
    const p95LatencyMs = monitoringPointValue((latency[0]?.points as Record<string, unknown>[] | undefined)?.[0]);
    const instanceCount = monitoringPointValue((instances[0]?.points as Record<string, unknown>[] | undefined)?.[0]);
    const series = ((dailyRequests[0]?.points as Record<string, unknown>[] | undefined) ?? [])
      .map((point) => {
        const interval = point.interval as Record<string, string> | undefined;
        return {
          label: (interval?.endTime ?? '').slice(5, 10),
          value: monitoringPointValue(point),
        };
      })
      .reverse();

    return {
      data: {
        sourceProjectId: projectId,
        serviceName,
        windowDays: HUSHH_AI_METRICS_WINDOW_DAYS,
        requestCount,
        errorCount,
        errorRate: requestCount > 0 ? errorCount / requestCount : null,
        p95LatencyMs,
        instanceCount,
        series,
      },
      error: null,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Hush AI Cloud Run metrics failed:', message);
    return { data: null, error: message };
  }
}

async function fetchHushhAiSearchConsole(): Promise<DataResult<Record<string, unknown>>> {
  const queryProject = BQ_JOB_PROJECT || HUSHH_AI_SEARCH_PROJECT;
  const datasetRef = `\`${HUSHH_AI_SEARCH_PROJECT}.${HUSHH_AI_SEARCH_DATASET}\``;
  const tableRows = await queryBigQuerySql(queryProject, `
    SELECT table_name AS tableName
    FROM ${datasetRef}.INFORMATION_SCHEMA.TABLES
    WHERE table_name IN ('searchdata_site_impression', 'searchdata_url_impression')
  `);

  if (tableRows.error) return { data: null, error: tableRows.error };

  const tableNames = new Set(tableRows.rows.map((row) => String(row.tableName)));
  if (!tableNames.has('searchdata_site_impression')) {
    return {
      data: {
        sourceProjectId: HUSHH_AI_SEARCH_PROJECT,
        sourceDataset: HUSHH_AI_SEARCH_DATASET,
        available: false,
        clicks: 0,
        impressions: 0,
        ctr: null,
        averagePosition: null,
        queries: [],
        pages: [],
        countries: [],
      },
      error: null,
    };
  }

  const siteTable = `${datasetRef}.searchdata_site_impression`;
  const urlTable = `${datasetRef}.searchdata_url_impression`;
  const aggregateQuery = `
    SELECT
      SUM(clicks) AS clicks,
      SUM(impressions) AS impressions,
      SAFE_DIVIDE(SUM(clicks), SUM(impressions)) AS ctr,
      SAFE_DIVIDE(SUM(sum_top_position), SUM(impressions)) + 1 AS averagePosition
    FROM ${siteTable}
    WHERE data_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 28 DAY)
  `;
  const queryRowsQuery = `
    SELECT
      query,
      SUM(clicks) AS clicks,
      SUM(impressions) AS impressions,
      SAFE_DIVIDE(SUM(clicks), SUM(impressions)) AS ctr,
      SAFE_DIVIDE(SUM(sum_top_position), SUM(impressions)) + 1 AS averagePosition
    FROM ${siteTable}
    WHERE data_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 28 DAY)
    GROUP BY query
    ORDER BY impressions DESC
    LIMIT 10
  `;
  const countryRowsQuery = `
    SELECT
      country,
      SUM(clicks) AS clicks,
      SUM(impressions) AS impressions,
      SAFE_DIVIDE(SUM(clicks), SUM(impressions)) AS ctr,
      SAFE_DIVIDE(SUM(sum_top_position), SUM(impressions)) + 1 AS averagePosition
    FROM ${siteTable}
    WHERE data_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 28 DAY)
    GROUP BY country
    ORDER BY impressions DESC
    LIMIT 10
  `;
  const pageRowsQuery = tableNames.has('searchdata_url_impression') ? `
    SELECT
      url AS pageUrl,
      SUM(clicks) AS clicks,
      SUM(impressions) AS impressions,
      SAFE_DIVIDE(SUM(clicks), SUM(impressions)) AS ctr,
      SAFE_DIVIDE(SUM(sum_top_position), SUM(impressions)) + 1 AS averagePosition
    FROM ${urlTable}
    WHERE data_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 28 DAY)
    GROUP BY pageUrl
    ORDER BY impressions DESC
    LIMIT 10
  ` : null;

  const [aggregate, queries, countries, pages] = await Promise.all([
    queryBigQuerySql(queryProject, aggregateQuery),
    queryBigQuerySql(queryProject, queryRowsQuery),
    queryBigQuerySql(queryProject, countryRowsQuery),
    pageRowsQuery ? queryBigQuerySql(queryProject, pageRowsQuery) : Promise.resolve({ rows: [], error: null }),
  ]);
  const errors = [aggregate.error, queries.error, countries.error, pages.error].filter(Boolean);
  if (aggregate.rows.length === 0 && errors.length > 0) return { data: null, error: errors.join('; ') };

  const overview = aggregate.rows[0] ?? {};
  return {
    data: {
      sourceProjectId: HUSHH_AI_SEARCH_PROJECT,
      sourceDataset: HUSHH_AI_SEARCH_DATASET,
      available: toNumber(overview.impressions) > 0,
      clicks: toNumber(overview.clicks),
      impressions: toNumber(overview.impressions),
      ctr: overview.ctr == null ? null : toNumber(overview.ctr),
      averagePosition: overview.averagePosition == null ? null : toNumber(overview.averagePosition),
      queries: queries.rows,
      pages: pages.rows,
      countries: countries.rows,
    },
    error: errors.length > 0 ? errors.join('; ') : null,
  };
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

app.get('/api/analytics/kai/ga4', async (_req, res) => {
  const result = await fetchKaiGa4Summary();
  res.status(result.error && !result.data ? 502 : 200).json({
    platform: 'kai.hushh.ai',
    data: result.data,
    error: result.error,
    fetchedAt: new Date().toISOString(),
  });
});

app.get('/api/analytics/hushhai', async (_req, res) => {
  const [gcp, searchConsole] = await Promise.all([
    fetchHushhAiCloudRun(),
    fetchHushhAiSearchConsole(),
  ]);
  const error = [gcp.error, searchConsole.error].filter(Boolean).join('; ') || null;
  res.status(error && !gcp.data && !searchConsole.data ? 502 : 200).json({
    platform: 'hushh.ai',
    data: {
      gcp: gcp.data,
      searchConsole: searchConsole.data,
    },
    error,
    fetchedAt: new Date().toISOString(),
  });
});

app.get('/api/analytics/all', async (_req, res) => {
  const [uat, production, kaiGa4, hushhAiGcp, hushhAiSearchConsole, hushhTech] = await Promise.all([
    queryBigQuery(BQ_UAT_PROJECT, BQ_UAT_DATASET, BQ_UAT_VIEW),
    queryBigQuery(BQ_PROD_PROJECT, BQ_PROD_DATASET, BQ_PROD_VIEW),
    fetchKaiGa4Summary(),
    fetchHushhAiCloudRun(),
    fetchHushhAiSearchConsole(),
    fetchHushhTechAnalytics(),
  ]);
  res.json({
    kai: {
      uat: { environment: 'uat', rows: uat.rows, error: uat.error },
      production: { environment: 'production', rows: production.rows, error: production.error },
      ga4: { platform: 'kai.hushh.ai', data: kaiGa4.data, error: kaiGa4.error },
    },
    hushhAi: {
      platform: 'hushh.ai',
      data: { gcp: hushhAiGcp.data, searchConsole: hushhAiSearchConsole.data },
      error: [hushhAiGcp.error, hushhAiSearchConsole.error].filter(Boolean).join('; ') || null,
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
      kaiGa4: `${KAI_GA4_PROJECT}.${KAI_GA4_DATASET}`,
      hushhAiCloudRun: `${HUSHH_AI_GCP_PROJECT}/${HUSHH_AI_CLOUD_RUN_SERVICE}`,
      hushhAiSearchConsole: `${HUSHH_AI_SEARCH_PROJECT}.${HUSHH_AI_SEARCH_DATASET}`,
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
  console.log(`  Kai GA4:       ${KAI_GA4_PROJECT}.${KAI_GA4_DATASET}`);
  console.log(`  Hush AI GCP:   ${HUSHH_AI_GCP_PROJECT}/${HUSHH_AI_CLOUD_RUN_SERVICE}`);
  console.log(`  hushhtech.com: ${buildHushhTechUrl()}`);
});
