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
const HUSHH_AI_SUPABASE_PROJECT_REF =
  process.env.HUSHH_AI_SUPABASE_PROJECT_REF || 'ibsisfnjxeowvdtvgzff';
const HUSHH_AI_SUPABASE_ACCESS_TOKEN =
  process.env.HUSHH_AI_SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_PAT || '';
const MAX_HUSHH_AI_RANGE_DAYS = 90;

interface HushhAiDateRange {
  startDate: string;
  endDate: string;
  days: number;
  startTime: string;
  endTime: string;
  windowSeconds: number;
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseUtcDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return formatUtcDate(date) === value ? date : null;
}

function firstQueryValue(value: unknown): string | undefined {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined;
  return typeof value === 'string' ? value : undefined;
}

function parseHushhAiDateRange(query: Record<string, unknown>): HushhAiDateRange {
  const today = new Date();
  const endDefault = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const configuredDays = Number(firstQueryValue(query.hushh_ai_window_days) ?? firstQueryValue(query.window_days) ?? HUSHH_AI_METRICS_WINDOW_DAYS);
  const defaultDays = Math.min(Math.max(Number.isFinite(configuredDays) ? Math.floor(configuredDays) : HUSHH_AI_METRICS_WINDOW_DAYS, 1), MAX_HUSHH_AI_RANGE_DAYS);
  const explicitStart = parseUtcDate(firstQueryValue(query.hushh_ai_start_date) ?? firstQueryValue(query.start_date));
  const explicitEnd = parseUtcDate(firstQueryValue(query.hushh_ai_end_date) ?? firstQueryValue(query.end_date));

  let end = explicitEnd ?? endDefault;
  let start = explicitStart ?? addUtcDays(end, -(defaultDays - 1));
  if (start > end) [start, end] = [end, start];

  const inclusiveDays = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (inclusiveDays > MAX_HUSHH_AI_RANGE_DAYS) {
    start = addUtcDays(end, -(MAX_HUSHH_AI_RANGE_DAYS - 1));
  }

  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const endExclusive = addUtcDays(end, 1);
  return {
    startDate: formatUtcDate(start),
    endDate: formatUtcDate(end),
    days,
    startTime: start.toISOString(),
    endTime: endExclusive.toISOString(),
    windowSeconds: Math.max(days * 86_400, 60),
  };
}

function dateSpine(range: HushhAiDateRange): string[] {
  const dates: string[] = [];
  let cursor = parseUtcDate(range.startDate) as Date;
  const end = parseUtcDate(range.endDate) as Date;
  while (cursor <= end) {
    dates.push(formatUtcDate(cursor));
    cursor = addUtcDays(cursor, 1);
  }
  return dates;
}

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
  range: HushhAiDateRange,
  extraFilter = '',
): Promise<Array<Record<string, unknown>>> {
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
  url.searchParams.set('interval.startTime', range.startTime);
  url.searchParams.set('interval.endTime', range.endTime);
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

function monitoringDailyMap(
  timeSeries: Array<Record<string, unknown>>,
  range: HushhAiDateRange,
  reducer: 'sum' | 'max' = 'sum',
): Map<string, number> {
  const values = new Map<string, number>();
  for (const series of timeSeries) {
    for (const point of (series.points as Record<string, unknown>[] | undefined) ?? []) {
      const interval = point.interval as Record<string, string> | undefined;
      const date = (interval?.startTime ?? interval?.endTime ?? '').slice(0, 10);
      if (date < range.startDate || date > range.endDate) continue;
      const value = monitoringPointValue(point);
      const current = values.get(date) ?? 0;
      values.set(date, reducer === 'max' ? Math.max(current, value) : current + value);
    }
  }
  return values;
}

async function fetchHushhAiCloudRun(range: HushhAiDateRange): Promise<DataResult<Record<string, unknown>>> {
  try {
    const serviceName = HUSHH_AI_CLOUD_RUN_SERVICE;
    const projectId = HUSHH_AI_GCP_PROJECT;
    const [requests, errors, latency, instances, dailyRequests, dailyErrors, dailyLatency, dailyInstances] = await Promise.all([
      fetchMonitoringSeries(projectId, serviceName, 'run.googleapis.com/request_count', 'ALIGN_DELTA', 'REDUCE_SUM', range.windowSeconds, range),
      fetchMonitoringSeries(projectId, serviceName, 'run.googleapis.com/request_count', 'ALIGN_DELTA', 'REDUCE_SUM', range.windowSeconds, range, 'metric.labels.response_code_class="5xx"'),
      fetchMonitoringSeries(projectId, serviceName, 'run.googleapis.com/request_latencies', 'ALIGN_PERCENTILE_95', 'REDUCE_PERCENTILE_95', range.windowSeconds, range),
      fetchMonitoringSeries(projectId, serviceName, 'run.googleapis.com/container/instance_count', 'ALIGN_MAX', 'REDUCE_MAX', range.windowSeconds, range),
      fetchMonitoringSeries(projectId, serviceName, 'run.googleapis.com/request_count', 'ALIGN_DELTA', 'REDUCE_SUM', 86_400, range),
      fetchMonitoringSeries(projectId, serviceName, 'run.googleapis.com/request_count', 'ALIGN_DELTA', 'REDUCE_SUM', 86_400, range, 'metric.labels.response_code_class="5xx"'),
      fetchMonitoringSeries(projectId, serviceName, 'run.googleapis.com/request_latencies', 'ALIGN_PERCENTILE_95', 'REDUCE_PERCENTILE_95', 86_400, range),
      fetchMonitoringSeries(projectId, serviceName, 'run.googleapis.com/container/instance_count', 'ALIGN_MAX', 'REDUCE_MAX', 86_400, range),
    ]);
    const requestCount = monitoringPointValue((requests[0]?.points as Record<string, unknown>[] | undefined)?.[0]);
    const errorCount = monitoringPointValue((errors[0]?.points as Record<string, unknown>[] | undefined)?.[0]);
    const p95LatencyMs = monitoringPointValue((latency[0]?.points as Record<string, unknown>[] | undefined)?.[0]);
    const instanceCount = monitoringPointValue((instances[0]?.points as Record<string, unknown>[] | undefined)?.[0]);
    const dailyRequestMap = monitoringDailyMap(dailyRequests, range);
    const dailyErrorMap = monitoringDailyMap(dailyErrors, range);
    const dailyLatencyMap = monitoringDailyMap(dailyLatency, range, 'max');
    const dailyInstanceMap = monitoringDailyMap(dailyInstances, range, 'max');
    const daily = dateSpine(range).map((date) => {
      const requestsForDay = dailyRequestMap.get(date) ?? 0;
      const errorsForDay = dailyErrorMap.get(date) ?? 0;
      const p95ForDay = dailyLatencyMap.get(date);
      const instancesForDay = dailyInstanceMap.get(date);
      return {
        date,
        label: date.slice(5),
        requests: requestsForDay,
        errors: errorsForDay,
        errorRate: requestsForDay > 0 ? errorsForDay / requestsForDay : null,
        p95LatencyMs: p95ForDay ?? null,
        instanceCount: instancesForDay ?? null,
      };
    });

    return {
      data: {
        sourceProjectId: projectId,
        serviceName,
        windowDays: range.days,
        startDate: range.startDate,
        endDate: range.endDate,
        requestCount,
        errorCount,
        errorRate: requestCount > 0 ? errorCount / requestCount : null,
        p95LatencyMs,
        instanceCount,
        series: daily.map((point) => ({ label: point.label, value: point.requests })),
        daily,
      },
      error: null,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Hush AI Cloud Run metrics failed:', message);
    return { data: null, error: message };
  }
}

async function fetchHushhAiSearchConsole(range: HushhAiDateRange): Promise<DataResult<Record<string, unknown>>> {
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
        startDate: range.startDate,
        endDate: range.endDate,
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
    WHERE data_date BETWEEN DATE '${range.startDate}' AND DATE '${range.endDate}'
  `;
  const queryRowsQuery = `
    SELECT
      query,
      SUM(clicks) AS clicks,
      SUM(impressions) AS impressions,
      SAFE_DIVIDE(SUM(clicks), SUM(impressions)) AS ctr,
      SAFE_DIVIDE(SUM(sum_top_position), SUM(impressions)) + 1 AS averagePosition
    FROM ${siteTable}
    WHERE data_date BETWEEN DATE '${range.startDate}' AND DATE '${range.endDate}'
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
    WHERE data_date BETWEEN DATE '${range.startDate}' AND DATE '${range.endDate}'
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
    WHERE data_date BETWEEN DATE '${range.startDate}' AND DATE '${range.endDate}'
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
      startDate: range.startDate,
      endDate: range.endDate,
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

function parseJsonField<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

async function fetchHushhAiSupabaseSummary(range: HushhAiDateRange): Promise<DataResult<Record<string, unknown>>> {
  if (!HUSHH_AI_SUPABASE_ACCESS_TOKEN) {
    return { data: null, error: 'HUSHH_AI_SUPABASE_ACCESS_TOKEN is not configured' };
  }

  const query = `
    WITH metrics AS (
      SELECT 1 AS sort_order, 'auth_users' AS metric_key, 'Auth Users' AS label,
        (SELECT COUNT(*) FROM auth.users)::bigint AS value,
        'auth.users' AS source_table,
        'Supabase Authentication users' AS detail
      UNION ALL SELECT 2, 'user_profile_sync', 'User Profile Sync',
        LEAST((SELECT COUNT(*) FROM public.users), (SELECT COUNT(*) FROM public.consumer_profiles))::bigint,
        'public.users + public.consumer_profiles',
        CONCAT((SELECT COUNT(*) FROM public.users), ' users / ', (SELECT COUNT(*) FROM public.consumer_profiles), ' consumer profiles')
      UNION ALL SELECT 3, 'community_registrations', 'Community Registrations',
        (SELECT COUNT(*) FROM public.community_registrations)::bigint,
        'public.community_registrations',
        'community demand capture'
      UNION ALL SELECT 4, 'agent_profiles', 'Agent Profiles',
        (SELECT COUNT(*) FROM public.agent_profiles)::bigint,
        'public.agent_profiles',
        CONCAT((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent_profiles'), ' columns in profile schema')
      UNION ALL SELECT 5, 'agent_catalog', 'Agent Catalog',
        (SELECT COUNT(*) FROM public.kirkland_agents)::bigint,
        'public.kirkland_agents',
        'available Kirkland agent catalog'
      UNION ALL SELECT 6, 'investor_profiles', 'Investor Profiles',
        (SELECT COUNT(*) FROM public.investor_profiles)::bigint,
        'public.investor_profiles',
        'investor profile records'
      UNION ALL SELECT 7, 'onboarding_records', 'Onboarding Records',
        (SELECT COUNT(*) FROM public.onboarding_data)::bigint,
        'public.onboarding_data',
        'submitted onboarding records'
      UNION ALL SELECT 8, 'agent_selections', 'Agent Selections',
        (SELECT COUNT(*) FROM public.user_agent_selections)::bigint,
        'public.user_agent_selections',
        'user-agent selections'
      UNION ALL SELECT 9, 'nda_signatures', 'NDA Signatures',
        (SELECT COUNT(*) FROM public.nda_signatures)::bigint,
        'public.nda_signatures',
        'signed NDA records'
      UNION ALL SELECT 10, 'plaid_transactions', 'Plaid Transactions',
        (SELECT COUNT(*) FROM public.plaid_transactions)::bigint,
        'public.plaid_transactions',
        'synced Plaid transaction rows'
    ),
    params AS (
      SELECT DATE '${range.startDate}' AS start_date, DATE '${range.endDate}' AS end_date
    ),
    days AS (
      SELECT generate_series((SELECT start_date FROM params), (SELECT end_date FROM params), interval '1 day')::date AS day
    ),
    daily AS (
      SELECT
        d.day,
        (SELECT COUNT(*) FROM auth.users u WHERE u.created_at::date <= d.day AND (u.deleted_at IS NULL OR u.deleted_at::date > d.day))::bigint AS total_users,
        (SELECT COUNT(*) FROM auth.users u WHERE u.created_at::date = d.day)::bigint AS new_users,
        (SELECT COUNT(*) FROM auth.users u WHERE COALESCE(u.confirmed_at, u.email_confirmed_at)::date = d.day)::bigint AS confirmed_users,
        (SELECT COUNT(DISTINCT u.id) FROM auth.users u WHERE u.last_sign_in_at::date = d.day)::bigint AS active_users,
        (SELECT COUNT(DISTINCT u.id) FROM auth.users u WHERE u.last_sign_in_at::date = d.day AND u.created_at::date < d.day)::bigint AS returning_users,
        (SELECT COUNT(*) FROM auth.users u WHERE u.deleted_at::date = d.day)::bigint AS deleted_users,
        (SELECT COUNT(*) FROM public.delete_requests dr WHERE dr.requested_at::date = d.day)::bigint AS delete_requests,
        (SELECT COUNT(*) FROM auth.sessions s WHERE s.created_at::date = d.day)::bigint AS sessions_started,
        (SELECT COUNT(DISTINCT s.user_id) FROM auth.sessions s WHERE s.created_at::date = d.day)::bigint AS session_users,
        COALESCE((
          SELECT ROUND((AVG(GREATEST(EXTRACT(EPOCH FROM (COALESCE(s.refreshed_at AT TIME ZONE 'UTC', s.updated_at, s.created_at) - s.created_at)), 0::double precision)) / 60)::numeric, 2)
          FROM auth.sessions s
          WHERE s.created_at::date = d.day
        ), 0)::numeric AS avg_session_minutes,
        (SELECT COUNT(DISTINCT upu.user_id) FROM public.user_product_usage upu WHERE upu.last_used_at::date = d.day)::bigint AS product_active_users,
        (SELECT COUNT(*) FROM public.analytics_events ae WHERE ae.created_at::date = d.day)::bigint AS analytics_events,
        (SELECT COUNT(DISTINCT ae.user_id) FROM public.analytics_events ae WHERE ae.created_at::date = d.day)::bigint AS analytics_event_users
      FROM days d
    ),
    range_totals AS (
      SELECT
        (SELECT COUNT(*) FROM auth.users u WHERE u.created_at::date <= p.end_date AND (u.deleted_at IS NULL OR u.deleted_at::date > p.end_date))::bigint AS total_users,
        (SELECT COUNT(*) FROM auth.users u WHERE u.created_at::date BETWEEN p.start_date AND p.end_date)::bigint AS new_users,
        (SELECT COUNT(*) FROM auth.users u WHERE COALESCE(u.confirmed_at, u.email_confirmed_at)::date BETWEEN p.start_date AND p.end_date)::bigint AS confirmed_users,
        (SELECT COUNT(DISTINCT u.id) FROM auth.users u WHERE u.last_sign_in_at::date BETWEEN p.start_date AND p.end_date)::bigint AS active_users,
        (SELECT COUNT(DISTINCT u.id) FROM auth.users u WHERE u.last_sign_in_at::date BETWEEN p.start_date AND p.end_date AND u.created_at::date < p.start_date)::bigint AS returning_users,
        (SELECT COUNT(*) FROM auth.users u WHERE u.deleted_at::date BETWEEN p.start_date AND p.end_date)::bigint AS deleted_users,
        (SELECT COUNT(*) FROM public.delete_requests dr WHERE dr.requested_at::date BETWEEN p.start_date AND p.end_date)::bigint AS delete_requests,
        (SELECT COUNT(*) FROM auth.sessions s WHERE s.created_at::date BETWEEN p.start_date AND p.end_date)::bigint AS sessions_started,
        (SELECT COUNT(DISTINCT s.user_id) FROM auth.sessions s WHERE s.created_at::date BETWEEN p.start_date AND p.end_date)::bigint AS session_users,
        COALESCE((
          SELECT ROUND((AVG(GREATEST(EXTRACT(EPOCH FROM (COALESCE(s.refreshed_at AT TIME ZONE 'UTC', s.updated_at, s.created_at) - s.created_at)), 0::double precision)) / 60)::numeric, 2)
          FROM auth.sessions s
          WHERE s.created_at::date BETWEEN p.start_date AND p.end_date
        ), 0)::numeric AS avg_session_minutes,
        (SELECT COUNT(DISTINCT upu.user_id) FROM public.user_product_usage upu WHERE upu.last_used_at::date BETWEEN p.start_date AND p.end_date)::bigint AS product_active_users,
        (SELECT COUNT(*) FROM public.analytics_events ae WHERE ae.created_at::date BETWEEN p.start_date AND p.end_date)::bigint AS analytics_events,
        (SELECT COUNT(DISTINCT ae.user_id) FROM public.analytics_events ae WHERE ae.created_at::date BETWEEN p.start_date AND p.end_date)::bigint AS analytics_event_users
      FROM params p
    )
    SELECT
      (SELECT jsonb_agg(jsonb_build_object(
        'metricKey', metric_key,
        'label', label,
        'value', value,
        'sourceTable', source_table,
        'detail', detail
      ) ORDER BY sort_order) FROM metrics) AS metrics,
      (SELECT jsonb_agg(jsonb_build_object(
        'date', day::text,
        'label', to_char(day, 'MM-DD'),
        'totalUsers', total_users,
        'newUsers', new_users,
        'confirmedUsers', confirmed_users,
        'activeUsers', active_users,
        'returningUsers', returning_users,
        'deletedUsers', deleted_users,
        'deleteRequests', delete_requests,
        'sessionsStarted', sessions_started,
        'sessionUsers', session_users,
        'avgSessionMinutes', avg_session_minutes,
        'productActiveUsers', product_active_users,
        'analyticsEvents', analytics_events,
        'analyticsEventUsers', analytics_event_users
      ) ORDER BY day) FROM daily) AS daily,
      (SELECT jsonb_build_object(
        'totalUsers', total_users,
        'newUsers', new_users,
        'confirmedUsers', confirmed_users,
        'activeUsers', active_users,
        'returningUsers', returning_users,
        'deletedUsers', deleted_users,
        'deleteRequests', delete_requests,
        'sessionsStarted', sessions_started,
        'sessionUsers', session_users,
        'avgSessionMinutes', avg_session_minutes,
        'productActiveUsers', product_active_users,
        'analyticsEvents', analytics_events,
        'analyticsEventUsers', analytics_event_users
      ) FROM range_totals) AS range_totals
  `;

  try {
    const res = await fetch(`https://api.supabase.com/v1/projects/${HUSHH_AI_SUPABASE_PROJECT_REF}/database/query`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${HUSHH_AI_SUPABASE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const message = `Hushh AI Supabase metrics returned ${res.status}`;
      console.error(message);
      return { data: null, error: message };
    }

    const rows = await res.json() as Array<Record<string, unknown>>;
    const payload = rows[0] ?? {};
    const metrics = parseJsonField<Array<Record<string, unknown>>>(payload.metrics, []);
    const daily = parseJsonField<Array<Record<string, unknown>>>(payload.daily, []);
    const rangeTotals = parseJsonField<Record<string, unknown>>(payload.range_totals, {});
    return {
      data: {
        sourceProjectRef: HUSHH_AI_SUPABASE_PROJECT_REF,
        sourceProjectName: 'hushh-ai',
        generatedAt: new Date().toISOString(),
        range: {
          startDate: range.startDate,
          endDate: range.endDate,
          days: range.days,
        },
        metrics: metrics.map((row) => ({
          metricKey: row.metricKey,
          label: row.label,
          value: toNumber(row.value),
          sourceTable: row.sourceTable,
          detail: row.detail,
        })),
        daily: daily.map((row) => ({
          date: String(row.date),
          label: String(row.label),
          totalUsers: toNumber(row.totalUsers),
          newUsers: toNumber(row.newUsers),
          confirmedUsers: toNumber(row.confirmedUsers),
          activeUsers: toNumber(row.activeUsers),
          returningUsers: toNumber(row.returningUsers),
          deletedUsers: toNumber(row.deletedUsers),
          deleteRequests: toNumber(row.deleteRequests),
          sessionsStarted: toNumber(row.sessionsStarted),
          sessionUsers: toNumber(row.sessionUsers),
          avgSessionMinutes: toNumber(row.avgSessionMinutes),
          productActiveUsers: toNumber(row.productActiveUsers),
          analyticsEvents: toNumber(row.analyticsEvents),
          analyticsEventUsers: toNumber(row.analyticsEventUsers),
        })),
        rangeTotals: {
          totalUsers: toNumber(rangeTotals.totalUsers),
          newUsers: toNumber(rangeTotals.newUsers),
          confirmedUsers: toNumber(rangeTotals.confirmedUsers),
          activeUsers: toNumber(rangeTotals.activeUsers),
          returningUsers: toNumber(rangeTotals.returningUsers),
          deletedUsers: toNumber(rangeTotals.deletedUsers),
          deleteRequests: toNumber(rangeTotals.deleteRequests),
          sessionsStarted: toNumber(rangeTotals.sessionsStarted),
          sessionUsers: toNumber(rangeTotals.sessionUsers),
          avgSessionMinutes: toNumber(rangeTotals.avgSessionMinutes),
          productActiveUsers: toNumber(rangeTotals.productActiveUsers),
          analyticsEvents: toNumber(rangeTotals.analyticsEvents),
          analyticsEventUsers: toNumber(rangeTotals.analyticsEventUsers),
        },
      },
      error: null,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Hushh AI Supabase metrics failed:', message);
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

app.get('/api/analytics/kai/ga4', async (_req, res) => {
  const result = await fetchKaiGa4Summary();
  res.status(result.error && !result.data ? 502 : 200).json({
    platform: 'kai.hushh.ai',
    data: result.data,
    error: result.error,
    fetchedAt: new Date().toISOString(),
  });
});

app.get('/api/analytics/hushhai', async (req, res) => {
  const hushhAiRange = parseHushhAiDateRange(req.query as Record<string, unknown>);
  const [gcp, searchConsole, supabase] = await Promise.all([
    fetchHushhAiCloudRun(hushhAiRange),
    fetchHushhAiSearchConsole(hushhAiRange),
    fetchHushhAiSupabaseSummary(hushhAiRange),
  ]);
  const error = [gcp.error, searchConsole.error, supabase.error].filter(Boolean).join('; ') || null;
  res.status(error && !gcp.data && !searchConsole.data && !supabase.data ? 502 : 200).json({
    platform: 'hushh.ai',
    data: {
      gcp: gcp.data,
      searchConsole: searchConsole.data,
      supabase: supabase.data,
    },
    error,
    fetchedAt: new Date().toISOString(),
  });
});

app.get('/api/analytics/all', async (req, res) => {
  const hushhAiRange = parseHushhAiDateRange(req.query as Record<string, unknown>);
  const [uat, production, kaiGa4, hushhAiGcp, hushhAiSearchConsole, hushhAiSupabase, hushhTech] = await Promise.all([
    queryBigQuery(BQ_UAT_PROJECT, BQ_UAT_DATASET, BQ_UAT_VIEW),
    queryBigQuery(BQ_PROD_PROJECT, BQ_PROD_DATASET, BQ_PROD_VIEW),
    fetchKaiGa4Summary(),
    fetchHushhAiCloudRun(hushhAiRange),
    fetchHushhAiSearchConsole(hushhAiRange),
    fetchHushhAiSupabaseSummary(hushhAiRange),
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
      data: { gcp: hushhAiGcp.data, searchConsole: hushhAiSearchConsole.data, supabase: hushhAiSupabase.data },
      error: [hushhAiGcp.error, hushhAiSearchConsole.error, hushhAiSupabase.error].filter(Boolean).join('; ') || null,
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
      hushhAiSupabase: HUSHH_AI_SUPABASE_PROJECT_REF,
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
  console.log(`  Hush AI DB:    ${HUSHH_AI_SUPABASE_PROJECT_REF}`);
  console.log(`  hushhtech.com: ${buildHushhTechUrl()}`);
});
