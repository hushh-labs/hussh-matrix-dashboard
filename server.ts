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
  'https://hushhtech.com/api/metrics/summary';
const HUSHHTECH_ENDPOINT = process.env.HUSHHTECH_ANALYTICS_ENDPOINT || DEFAULT_HUSHHTECH_ENDPOINT;
const HUSHHTECH_WINDOW_DAYS = process.env.HUSHHTECH_METRICS_WINDOW_DAYS || '7';
const HUSHHTECH_METRICS_WINDOW_DAYS = parseInt(HUSHHTECH_WINDOW_DAYS, 10);
const HUSHHTECH_GCP_PROJECT = process.env.HUSHHTECH_GCP_PROJECT || 'hushh-tech-prod';
const HUSHHTECH_CLOUD_RUN_SERVICE = process.env.HUSHHTECH_CLOUD_RUN_SERVICE || 'hushh-tech-website';
const HUSHHTECH_CLOUD_RUN_REGION = process.env.HUSHHTECH_CLOUD_RUN_REGION || 'us-central1';
const HUSHHTECH_SEARCH_PROJECT = process.env.HUSHHTECH_SEARCH_PROJECT || 'hushh-ai-prod';
const HUSHHTECH_SEARCH_DATASET = process.env.HUSHHTECH_SEARCH_DATASET || 'searchconsole_hushhtech_com';
const HUSHHTECH_SEARCH_FALLBACK_PROJECT =
  process.env.HUSHHTECH_SEARCH_FALLBACK_PROJECT || HUSHHTECH_SEARCH_PROJECT;
const HUSHHTECH_SEARCH_FALLBACK_DATASET =
  process.env.HUSHHTECH_SEARCH_FALLBACK_DATASET || 'hushhtech_search_console_api';
const HUSHHTECH_SEARCH_CONSOLE_SITE_URL =
  process.env.HUSHHTECH_SEARCH_CONSOLE_SITE_URL || 'sc-domain:hushhtech.com';
const HUSHHTECH_SEARCH_CONSOLE_TYPE = process.env.HUSHHTECH_SEARCH_CONSOLE_TYPE || 'web';
const HUSHHTECH_SEARCH_CONSOLE_DATA_STATE = process.env.HUSHHTECH_SEARCH_CONSOLE_DATA_STATE || 'all';
const HUSHHTECH_SEARCH_CONSOLE_ROW_LIMIT = Math.max(
  1,
  Math.min(parseInt(process.env.HUSHHTECH_SEARCH_CONSOLE_ROW_LIMIT || '10', 10) || 10, 25),
);
const KAI_GA4_PROJECT = process.env.KAI_GA4_PROJECT || BQ_UAT_PROJECT;
const KAI_GA4_DATASET = process.env.KAI_GA4_DATASET || 'analytics_533362555';
const KAI_GA4_WINDOW_DAYS = parseInt(process.env.KAI_GA4_WINDOW_DAYS || '14', 10);
const KAI_PROD_GA4_PROJECT = process.env.KAI_PROD_GA4_PROJECT || BQ_PROD_PROJECT;
const KAI_PROD_GA4_DATASET = process.env.KAI_PROD_GA4_DATASET || 'analytics_526603671';
const KAI_PROD_GCP_PROJECT = process.env.KAI_PROD_GCP_PROJECT || BQ_PROD_PROJECT;
const KAI_PROD_CLOUD_RUN_SERVICE = process.env.KAI_PROD_CLOUD_RUN_SERVICE || 'hushh-webapp';
const KAI_PROD_METRICS_WINDOW_DAYS = parseInt(process.env.KAI_PROD_METRICS_WINDOW_DAYS || '7', 10);
const HUSHH_AI_GCP_PROJECT = process.env.HUSHH_AI_GCP_PROJECT || 'hushh-ai-prod';
const HUSHH_AI_CLOUD_RUN_SERVICE = process.env.HUSHH_AI_CLOUD_RUN_SERVICE || 'hushh-ai-website';
const HUSHH_AI_METRICS_WINDOW_DAYS = parseInt(process.env.HUSHH_AI_METRICS_WINDOW_DAYS || '7', 10);
const HUSHH_AI_SEARCH_PROJECT = process.env.HUSHH_AI_SEARCH_PROJECT || BQ_PROD_PROJECT;
const HUSHH_AI_SEARCH_DATASET =
  process.env.HUSHH_AI_SEARCH_DATASET || 'searchconsole_searchconsole_hushh_ai';
const HUSHH_AI_SEARCH_FALLBACK_PROJECT =
  process.env.HUSHH_AI_SEARCH_FALLBACK_PROJECT || 'hushh-ai-prod';
const HUSHH_AI_SEARCH_FALLBACK_DATASET =
  process.env.HUSHH_AI_SEARCH_FALLBACK_DATASET || 'hushh_ai_search_console_api';
const HUSHH_AI_SEARCH_CONSOLE_SITE_URL =
  process.env.HUSHH_AI_SEARCH_CONSOLE_SITE_URL || 'sc-domain:hushh.ai';
const HUSHH_AI_SEARCH_CONSOLE_PAGE_FILTER_REGEX =
  process.env.HUSHH_AI_SEARCH_CONSOLE_PAGE_FILTER_REGEX || '^https://(www\\.)?hushh\\.ai(/|$)';
const HUSHH_AI_SEARCH_CONSOLE_TYPE = process.env.HUSHH_AI_SEARCH_CONSOLE_TYPE || 'web';
const HUSHH_AI_SEARCH_CONSOLE_DATA_STATE = process.env.HUSHH_AI_SEARCH_CONSOLE_DATA_STATE || 'all';
const HUSHH_AI_SEARCH_CONSOLE_ROW_LIMIT = Math.max(
  1,
  Math.min(parseInt(process.env.HUSHH_AI_SEARCH_CONSOLE_ROW_LIMIT || '10', 10) || 10, 25),
);
const HUSHH_AI_GA4_PROJECT = process.env.HUSHH_AI_GA4_PROJECT || '';
const HUSHH_AI_GA4_DATASET = process.env.HUSHH_AI_GA4_DATASET || '';
const HUSHH_AI_GA4_PROPERTY_ID = process.env.HUSHH_AI_GA4_PROPERTY_ID || '';
const HUSHH_AI_GA4_MEASUREMENT_ID = process.env.HUSHH_AI_GA4_MEASUREMENT_ID || 'G-PPEF1CSJ5H';
const HUSHH_AI_GA4_IMPERSONATE_SERVICE_ACCOUNT =
  process.env.HUSHH_AI_GA4_IMPERSONATE_SERVICE_ACCOUNT || '';
const HUSHH_AI_GA4_WINDOW_DAYS = parseInt(process.env.HUSHH_AI_GA4_WINDOW_DAYS || '7', 10);
const KAI_SEARCH_PROJECT = process.env.KAI_SEARCH_PROJECT || HUSHH_AI_SEARCH_PROJECT;
const KAI_SEARCH_DATASET = process.env.KAI_SEARCH_DATASET || HUSHH_AI_SEARCH_DATASET;
const KAI_SEARCH_FALLBACK_PROJECT =
  process.env.KAI_SEARCH_FALLBACK_PROJECT || 'hushh-ai-prod';
const KAI_SEARCH_FALLBACK_DATASET =
  process.env.KAI_SEARCH_FALLBACK_DATASET || 'kai_search_console_api';
const KAI_SEARCH_CONSOLE_SITE_URL =
  process.env.KAI_SEARCH_CONSOLE_SITE_URL || 'sc-domain:hushh.ai';
const KAI_SEARCH_CONSOLE_PAGE_FILTER_REGEX =
  process.env.KAI_SEARCH_CONSOLE_PAGE_FILTER_REGEX || '^https://(uat\\.)?kai\\.hushh\\.ai(/|$)';
const KAI_SEARCH_CONSOLE_TYPE = process.env.KAI_SEARCH_CONSOLE_TYPE || 'web';
const KAI_SEARCH_CONSOLE_DATA_STATE = process.env.KAI_SEARCH_CONSOLE_DATA_STATE || 'all';
const KAI_SEARCH_CONSOLE_ROW_LIMIT = Math.max(
  1,
  Math.min(parseInt(process.env.KAI_SEARCH_CONSOLE_ROW_LIMIT || '10', 10) || 10, 25),
);
const HUSHHTECH_SUPABASE_PROJECT_REF =
  process.env.HUSHHTECH_SUPABASE_PROJECT_REF || 'ibsisfnjxeowvdtvgzff';
const HUSHHTECH_SUPABASE_ACCESS_TOKEN =
  process.env.HUSHHTECH_SUPABASE_ACCESS_TOKEN || '';
const MAX_HUSHH_AI_RANGE_DAYS = 90;
const HUSHH_AI_LIVE_REFRESH_SECONDS = Math.max(
  10,
  Math.min(parseInt(process.env.HUSHH_AI_LIVE_REFRESH_SECONDS || '30', 10) || 30, 300),
);

app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');
  next();
});

const PUBLIC_OMIT_KEYS = new Set([
  'sourceProjectId',
  'sourceDataset',
  'fallbackProjectId',
  'fallbackDataset',
  'officialExportProjectId',
  'officialExportDataset',
  'sourceProjectRef',
  'sourceProjectName',
  'sourceDatabaseName',
  'sourceTable',
  'pageFilterRegex',
]);
const PUBLIC_UNSAFE_VALUE_PATTERN = /analytics_\d+|searchconsole_|_search_console_api|hushh-ai-prod|hushh-pda(?:-uat)?|ibsisfnjxeowvdtvgzff/i;

function sanitizePublicPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizePublicPayload(item));
  if (typeof value === 'string') {
    return PUBLIC_UNSAFE_VALUE_PATTERN.test(value) ? 'Internal aggregate source' : value;
  }
  if (!value || typeof value !== 'object') return value;

  const sanitized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (PUBLIC_OMIT_KEYS.has(key)) continue;
    sanitized[key] = sanitizePublicPayload(child);
  }
  return sanitized;
}

function publicIntegrationError(sourceLabel: string, err: unknown): string {
  const rawMessage = err instanceof Error ? err.message : String(err);
  const compactMessage = rawMessage.replace(/\s+/g, ' ').trim();
  if (/<\/?(html|head|body|script|style|title|table|font|div|p|h1)\b/i.test(compactMessage)) {
    return `${sourceLabel} request was rejected before JSON report data was returned. Verify the product analytics property access for the metrics runtime identity and retry.`;
  }
  if (/permission|denied|forbidden|unauthorized|insufficient|403|401/i.test(compactMessage)) {
    return `${sourceLabel} access is not working yet. Verify the metrics runtime identity has Viewer or Analyst access to the analytics property.`;
  }
  if (/not\s*found|404/i.test(compactMessage)) {
    return `${sourceLabel} property was not found by the configured analytics reader. Verify the property ID and data source configuration.`;
  }
  const safeDetail = compactMessage.slice(0, 180);
  return safeDetail
    ? `${sourceLabel} request failed before report data was returned: ${safeDetail}`
    : `${sourceLabel} request failed before report data was returned.`;
}

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

function parseProductDateRange(
  query: Record<string, unknown>,
  prefix: string,
  configuredWindowDays: number,
): HushhAiDateRange {
  const today = new Date();
  const endDefault = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const configuredDays = Number(firstQueryValue(query[`${prefix}_window_days`]) ?? firstQueryValue(query.window_days) ?? configuredWindowDays);
  const defaultDays = Math.min(Math.max(Number.isFinite(configuredDays) ? Math.floor(configuredDays) : configuredWindowDays, 1), MAX_HUSHH_AI_RANGE_DAYS);
  const explicitStart = parseUtcDate(firstQueryValue(query[`${prefix}_start_date`]) ?? firstQueryValue(query.start_date));
  const explicitEnd = parseUtcDate(firstQueryValue(query[`${prefix}_end_date`]) ?? firstQueryValue(query.end_date));

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

function parseHushhAiDateRange(query: Record<string, unknown>): HushhAiDateRange {
  return parseProductDateRange(query, 'hushh_ai', HUSHH_AI_METRICS_WINDOW_DAYS);
}

function parseKaiDateRange(query: Record<string, unknown>): HushhAiDateRange {
  return parseProductDateRange(query, 'kai', KAI_PROD_METRICS_WINDOW_DAYS);
}

function parseHushhTechDateRange(query: Record<string, unknown>): HushhAiDateRange {
  return parseProductDateRange(query, 'hushhtech', HUSHHTECH_METRICS_WINDOW_DAYS);
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

function buildHushhTechUrl(range?: HushhAiDateRange): string {
  const url = new URL(HUSHHTECH_ENDPOINT);
  if (!url.searchParams.has('window_days')) {
    url.searchParams.set('window_days', String(range?.days ?? HUSHHTECH_WINDOW_DAYS));
  }
  return url.toString();
}

async function fetchHushhTechPublicAnalytics(range: HushhAiDateRange): Promise<DataResult<Record<string, unknown>>> {
  try {
    const res = await fetch(buildHushhTechUrl(range), {
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

function emptyHushhTechSummary(range: HushhAiDateRange, warning: string): Record<string, unknown> {
  return {
    generatedAt: new Date().toISOString(),
    timezone: 'UTC',
    window: {
      days: range.days,
      startDate: range.startDate,
      endDate: range.endDate,
      dates: dateSpine(range),
    },
    businessFunnel: {
      source: 'unavailable',
      overview: {
        signups: 0,
        persistedUsers: 0,
        onboardingStarted: 0,
        onboardingCompleted: 0,
        profilesCreated: 0,
        profilesConfirmed: 0,
      },
      conversionRates: {
        signupToPersistedUsers: null,
        signupToOnboardingStarted: null,
        onboardingCompletionRate: null,
        profileConfirmationRate: null,
      },
      onboardingStepBreakdown: [],
      series: dateSpine(range).map((date) => ({
        date,
        signups: 0,
        persistedUsers: 0,
        onboardingStarted: 0,
        onboardingCompleted: 0,
        profilesCreated: 0,
        profilesConfirmed: 0,
      })),
    },
    traffic: {
      source: 'unavailable',
      available: false,
      overview: {
        active1DayUsers: 0,
        active7DayUsers: 0,
        active28DayUsers: 0,
        sessions: 0,
        engagedSessions: 0,
        screenPageViews: 0,
        newUsers: 0,
        engagementRate: null,
        averageSessionDuration: null,
        realtimeActiveUsers: null,
      },
      series: dateSpine(range).map((date) => ({
        date,
        activeUsers: 0,
        sessions: 0,
        screenPageViews: 0,
        engagedSessions: 0,
        newUsers: 0,
      })),
      note: warning,
    },
    dataQualityWarnings: [warning],
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function mapCloudRunToHushhTechGcp(gcp: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!gcp) return null;
  const requestCount = toNumber(gcp.requestCount);
  const errorRate = gcp.errorRate == null ? null : toNumber(gcp.errorRate);
  const p95LatencyMs = gcp.p95LatencyMs == null ? null : toNumber(gcp.p95LatencyMs);
  const instanceCount = gcp.instanceCount == null ? null : toNumber(gcp.instanceCount);
  return {
    source: 'metrics-hushh-ai-cloud-monitoring',
    available: true,
    services: [
      {
        name: HUSHHTECH_CLOUD_RUN_SERVICE,
        region: HUSHHTECH_CLOUD_RUN_REGION,
        available: true,
        requestCount,
        errorRate,
        p95LatencyMs,
        instanceCount,
      },
    ],
    requestCount,
    errorRate,
    p50LatencyMs: null,
    p95LatencyMs,
    instanceCount,
    uptimeAvailability: errorRate == null ? null : 1 - errorRate,
    note: 'Read directly by metrics.hushh.ai from Google Cloud Monitoring.',
  };
}

async function fetchHushhTechCloudRun(range: HushhAiDateRange): Promise<DataResult<Record<string, unknown>>> {
  const result = await fetchCloudRunSummary(
    HUSHHTECH_GCP_PROJECT,
    HUSHHTECH_CLOUD_RUN_SERVICE,
    range,
    'HushhTech production',
  );
  return {
    data: mapCloudRunToHushhTechGcp(result.data),
    error: result.error,
  };
}

function unavailableHushhTechSearchConsole(range: HushhAiDateRange, note: string): Record<string, unknown> {
  const overview = {
    clicks: 0,
    impressions: 0,
    ctr: null,
    averagePosition: null,
  };
  return {
    source: 'metrics-hushh-ai-search-console-waiting',
    sourceLabel: 'Search Console waiting',
    available: false,
    realtime: false,
    latestDataDate: null,
    latestIngestedAt: null,
    expectedLagSeconds: 86_400,
    dataState: HUSHHTECH_SEARCH_CONSOLE_DATA_STATE,
    searchType: HUSHHTECH_SEARCH_CONSOLE_TYPE,
    overview,
    range: {
      startDate: range.startDate,
      endDate: range.endDate,
      days: range.days,
    },
    rangeTotals: overview,
    daily: searchConsoleDailySpine(range, []),
    queries: [],
    pages: [],
    countries: [],
    devices: [],
    searchAppearance: [],
    state: {
      source: 'Search Console waiting',
      available: false,
      byRegion: [],
      note,
    },
    metadata: {
      siteUrl: HUSHHTECH_SEARCH_CONSOLE_SITE_URL,
      startDate: range.startDate,
      endDate: range.endDate,
      expectedLagSeconds: 86_400,
    },
    note,
  };
}

function searchConsoleMetric(row: Record<string, unknown> | undefined) {
  const averagePosition = row?.averagePosition ?? row?.average_position ?? row?.position;
  return {
    clicks: row ? toNumber(row.clicks) : 0,
    impressions: row ? toNumber(row.impressions) : 0,
    ctr: row?.ctr == null ? null : toNumber(row.ctr),
    averagePosition: averagePosition == null ? null : toNumber(averagePosition),
  };
}

function latestSearchConsoleDate(rows: Record<string, unknown>[]): string | null {
  return rows
    .map((row) => String(row.date ?? row.dataDate ?? row.data_date ?? ''))
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;
}

function latestSearchConsoleIngestedAt(rows: Record<string, unknown>[]): string | null {
  return rows
    .map((row) => String(row.ingestedAt ?? row.ingested_at ?? ''))
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;
}

function searchConsoleLatestDataDate(data: unknown): string | null {
  const record = asRecord(data);
  return typeof record?.latestDataDate === 'string' ? record.latestDataDate : null;
}

function shouldPreferSearchConsoleFallback(primary: unknown, fallback: unknown): boolean {
  const primaryRecord = asRecord(primary);
  const fallbackRecord = asRecord(fallback);
  if (!fallbackRecord?.available) return false;
  if (!primaryRecord?.available) return true;
  const primaryDate = searchConsoleLatestDataDate(primaryRecord);
  const fallbackDate = searchConsoleLatestDataDate(fallbackRecord);
  return Boolean(primaryDate && fallbackDate && fallbackDate > primaryDate);
}

function publicSearchConsoleSourceLabel(source: unknown): string {
  const value = String(source ?? '');
  if (value.includes('gcp-fallback')) return 'Search Console fallback aggregates';
  if (value.includes('waiting')) return 'Search Console waiting';
  return 'Search Console official export';
}

function publicGa4SourceLabel(source: unknown): string {
  const value = String(source ?? '');
  if (value === 'ga4-data-api' || value.startsWith('properties/')) return 'GA4 Data API';
  if (value.includes('not_configured')) return 'GA4 waiting';
  return 'GA4 export';
}

function publicProductEventsSourceLabel(productLabel: string): string {
  return `${productLabel} DB aggregate events`;
}

function searchConsoleDailySpine(
  range: HushhAiDateRange,
  rows: Record<string, unknown>[],
): Array<Record<string, unknown>> {
  const byDate = new Map(rows.map((row) => [String(row.date ?? row.dataDate ?? row.eventDate), row]));
  return dateSpine(range).map((date) => {
    const metric = searchConsoleMetric(byDate.get(date));
    return {
      date,
      label: date.slice(5),
      ...metric,
    };
  });
}

function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlRawStringLiteral(value: string): string {
  return `r'${value.replace(/'/g, "''")}'`;
}

interface ProductSearchConsoleConfig {
  productLabel: string;
  sourceProjectId: string;
  sourceDataset: string;
  fallbackProjectId: string;
  fallbackDataset: string;
  siteUrl: string;
  searchType: string;
  dataState: string;
  rowLimit: number;
  pageFilterRegex?: string;
}

function unavailableProductSearchConsole(
  config: ProductSearchConsoleConfig,
  range: HushhAiDateRange,
  note: string,
): Record<string, unknown> {
  return {
    source: 'metrics-hushh-ai-search-console-waiting',
    sourceLabel: 'Search Console waiting',
    siteUrl: config.siteUrl,
    generatedAt: new Date().toISOString(),
    latestDataDate: null,
    latestIngestedAt: null,
    realtimeMode: 'delayed_export',
    expectedLagSeconds: 86_400,
    startDate: range.startDate,
    endDate: range.endDate,
    range: {
      startDate: range.startDate,
      endDate: range.endDate,
      days: range.days,
    },
    rangeTotals: {
      clicks: 0,
      impressions: 0,
      ctr: null,
      averagePosition: null,
    },
    available: false,
    clicks: 0,
    impressions: 0,
    ctr: null,
    averagePosition: null,
    daily: searchConsoleDailySpine(range, []),
    queries: [],
    pages: [],
    countries: [],
    devices: [],
    note,
  };
}

function productSearchConsolePayload(
  config: ProductSearchConsoleConfig,
  range: HushhAiDateRange,
  source: string,
  sourceProjectId: string,
  sourceDataset: string,
  aggregateRow: Record<string, unknown> | undefined,
  dailyRows: Record<string, unknown>[],
  queries: Record<string, unknown>[],
  pages: Record<string, unknown>[],
  countries: Record<string, unknown>[],
  devices: Record<string, unknown>[],
  note: string,
): Record<string, unknown> {
  const overview = searchConsoleMetric(aggregateRow);
  const latestDataDate = latestSearchConsoleDate(dailyRows);
  const latestIngestedAt = latestSearchConsoleIngestedAt(dailyRows);
  return {
    source,
    sourceLabel: publicSearchConsoleSourceLabel(source),
    siteUrl: config.siteUrl,
    generatedAt: new Date().toISOString(),
    latestDataDate,
    latestIngestedAt,
    realtimeMode: 'delayed_export',
    expectedLagSeconds: 86_400,
    startDate: range.startDate,
    endDate: range.endDate,
    range: {
      startDate: range.startDate,
      endDate: range.endDate,
      days: range.days,
    },
    rangeTotals: overview,
    available: overview.clicks > 0 || overview.impressions > 0,
    clicks: overview.clicks,
    impressions: overview.impressions,
    ctr: overview.ctr,
    averagePosition: overview.averagePosition,
    daily: searchConsoleDailySpine(range, dailyRows),
    queries: queries.map((row) => ({ query: String(row.query ?? ''), ...searchConsoleMetric(row) })),
    pages: pages.map((row) => ({ pageUrl: String(row.pageUrl ?? ''), ...searchConsoleMetric(row) })),
    countries: countries.map((row) => ({ country: String(row.country ?? ''), ...searchConsoleMetric(row) })),
    devices: devices.map((row) => ({ device: String(row.device ?? ''), ...searchConsoleMetric(row) })),
    note,
  };
}

async function fetchProductSearchConsoleFallback(
  config: ProductSearchConsoleConfig,
  range: HushhAiDateRange,
  officialExportNote: string,
): Promise<DataResult<Record<string, unknown>>> {
  const queryProject = BQ_JOB_PROJECT || config.fallbackProjectId;
  const datasetRef = `\`${config.fallbackProjectId}.${config.fallbackDataset}\``;
  const tableRows = await queryBigQuerySql(queryProject, `
    SELECT table_name AS tableName
    FROM ${datasetRef}.INFORMATION_SCHEMA.TABLES
    WHERE table_name IN ('site_daily', 'query_daily', 'page_daily', 'country_daily', 'device_daily')
  `);

  if (tableRows.error) {
    const note = `${config.productLabel} Search Console fallback aggregates are not queryable yet. ${officialExportNote}`;
    if (/not found|notfound/i.test(tableRows.error)) {
      return { data: unavailableProductSearchConsole(config, range, note), error: null };
    }
    return { data: null, error: tableRows.error };
  }

  const tableNames = new Set(tableRows.rows.map((row) => String(row.tableName)));
  if (!tableNames.has('site_daily')) {
    return {
      data: unavailableProductSearchConsole(
        config,
        range,
        `${config.productLabel} Search Console fallback is configured, but the daily aggregate table has not been created or populated yet. ${officialExportNote}`,
      ),
      error: null,
    };
  }

  const dateFilter = `data_date BETWEEN DATE '${range.startDate}' AND DATE '${range.endDate}'`;
  const searchTypeFilter = `LOWER(search_type) = LOWER(${sqlStringLiteral(config.searchType)})`;
  const siteFilter = `site_url = ${sqlStringLiteral(config.siteUrl)}`;
  const whereClause = `${dateFilter} AND ${searchTypeFilter} AND ${siteFilter}`;
  const weightedPosition = 'SAFE_DIVIDE(SUM(average_position * impressions), SUM(impressions))';
  const aggregateQuery = `
    SELECT
      SUM(clicks) AS clicks,
      SUM(impressions) AS impressions,
      SAFE_DIVIDE(SUM(clicks), SUM(impressions)) AS ctr,
      ${weightedPosition} AS averagePosition
    FROM ${datasetRef}.site_daily
    WHERE ${whereClause}
  `;
  const dailyQuery = `
    SELECT
      CAST(data_date AS STRING) AS date,
      FORMAT_TIMESTAMP('%FT%TZ', MAX(ingested_at)) AS ingestedAt,
      SUM(clicks) AS clicks,
      SUM(impressions) AS impressions,
      SAFE_DIVIDE(SUM(clicks), SUM(impressions)) AS ctr,
      ${weightedPosition} AS averagePosition
    FROM ${datasetRef}.site_daily
    WHERE ${whereClause}
    GROUP BY date
    ORDER BY date
  `;
  const dimensionQuery = (table: string, field: string, alias: string) => tableNames.has(table) ? `
    SELECT
      ${field} AS ${alias},
      SUM(clicks) AS clicks,
      SUM(impressions) AS impressions,
      SAFE_DIVIDE(SUM(clicks), SUM(impressions)) AS ctr,
      ${weightedPosition} AS averagePosition
    FROM ${datasetRef}.${table}
    WHERE ${whereClause}
    GROUP BY ${alias}
    ORDER BY impressions DESC
    LIMIT ${config.rowLimit}
  ` : null;

  const [aggregate, daily, queries, pages, countries, devices] = await Promise.all([
    queryBigQuerySql(queryProject, aggregateQuery),
    queryBigQuerySql(queryProject, dailyQuery),
    dimensionQuery('query_daily', 'query', 'query')
      ? queryBigQuerySql(queryProject, dimensionQuery('query_daily', 'query', 'query') as string)
      : Promise.resolve({ rows: [], error: null }),
    dimensionQuery('page_daily', 'page_url', 'pageUrl')
      ? queryBigQuerySql(queryProject, dimensionQuery('page_daily', 'page_url', 'pageUrl') as string)
      : Promise.resolve({ rows: [], error: null }),
    dimensionQuery('country_daily', 'country', 'country')
      ? queryBigQuerySql(queryProject, dimensionQuery('country_daily', 'country', 'country') as string)
      : Promise.resolve({ rows: [], error: null }),
    dimensionQuery('device_daily', 'device', 'device')
      ? queryBigQuerySql(queryProject, dimensionQuery('device_daily', 'device', 'device') as string)
      : Promise.resolve({ rows: [], error: null }),
  ]);
  const errors = [aggregate.error, daily.error, queries.error, pages.error, countries.error, devices.error].filter(Boolean);
  if (aggregate.rows.length === 0 && errors.length > 0) return { data: null, error: errors.join('; ') };

  const data = productSearchConsolePayload(
    config,
    range,
    'metrics-hushh-ai-search-console-gcp-fallback',
    config.fallbackProjectId,
    config.fallbackDataset,
    aggregate.rows[0],
    daily.rows,
    queries.rows,
    pages.rows,
    countries.rows,
    devices.rows,
    `Read by metrics.hushh.ai from GCP fallback Search Console tables. ${officialExportNote}`,
  );
  return { data, error: errors.length > 0 ? errors.join('; ') : null };
}

async function fetchProductSearchConsole(
  config: ProductSearchConsoleConfig,
  range: HushhAiDateRange,
): Promise<DataResult<Record<string, unknown>>> {
  const queryProject = BQ_JOB_PROJECT || config.sourceProjectId;
  const datasetRef = `\`${config.sourceProjectId}.${config.sourceDataset}\``;
  const tableRows = await queryBigQuerySql(queryProject, `
    SELECT table_name AS tableName
    FROM ${datasetRef}.INFORMATION_SCHEMA.TABLES
    WHERE table_name IN ('searchdata_site_impression', 'searchdata_url_impression')
  `);

  if (tableRows.error) {
    const waitingNote = `${config.productLabel} Search Console bulk export is configured, but it is not queryable yet.`;
    if (/not found|notfound/i.test(tableRows.error)) {
      return fetchProductSearchConsoleFallback(config, range, waitingNote);
    }
    return { data: null, error: tableRows.error };
  }

  const tableNames = new Set(tableRows.rows.map((row) => String(row.tableName)));
  if (!tableNames.has('searchdata_site_impression')) {
    return fetchProductSearchConsoleFallback(
      config,
      range,
      'Official Search Console bulk export is set up; waiting for the site impression table.',
    );
  }
  if (config.pageFilterRegex && !tableNames.has('searchdata_url_impression')) {
    return fetchProductSearchConsoleFallback(
      config,
      range,
      'Official Search Console bulk export exists, but the URL impression table is required for product URL filtering.',
    );
  }

  const siteTable = `${datasetRef}.searchdata_site_impression`;
  const urlTable = `${datasetRef}.searchdata_url_impression`;
  const sourceTable = config.pageFilterRegex ? urlTable : siteTable;
  const positionField = config.pageFilterRegex ? 'sum_position' : 'sum_top_position';
  const urlFilter = config.pageFilterRegex
    ? `AND REGEXP_CONTAINS(url, ${sqlRawStringLiteral(config.pageFilterRegex)})`
    : '';
  const whereClause = `
    data_date BETWEEN DATE '${range.startDate}' AND DATE '${range.endDate}'
    AND LOWER(search_type) = LOWER(${sqlStringLiteral(config.searchType)})
    ${urlFilter}
  `;
  const aggregateQuery = `
    SELECT
      SUM(clicks) AS clicks,
      SUM(impressions) AS impressions,
      SAFE_DIVIDE(SUM(clicks), SUM(impressions)) AS ctr,
      SAFE_DIVIDE(SUM(${positionField}), SUM(impressions)) + 1 AS averagePosition
    FROM ${sourceTable}
    WHERE ${whereClause}
  `;
  const dailyQuery = `
    SELECT
      CAST(data_date AS STRING) AS date,
      SUM(clicks) AS clicks,
      SUM(impressions) AS impressions,
      SAFE_DIVIDE(SUM(clicks), SUM(impressions)) AS ctr,
      SAFE_DIVIDE(SUM(${positionField}), SUM(impressions)) + 1 AS averagePosition
    FROM ${sourceTable}
    WHERE ${whereClause}
    GROUP BY date
    ORDER BY date
  `;
  const dimensionQuery = (field: string, alias: string) => `
    SELECT
      ${field} AS ${alias},
      SUM(clicks) AS clicks,
      SUM(impressions) AS impressions,
      SAFE_DIVIDE(SUM(clicks), SUM(impressions)) AS ctr,
      SAFE_DIVIDE(SUM(${positionField}), SUM(impressions)) + 1 AS averagePosition
    FROM ${sourceTable}
    WHERE ${whereClause}
    GROUP BY ${alias}
    ORDER BY impressions DESC
    LIMIT ${config.rowLimit}
  `;

  const [aggregate, daily, queries, pages, countries, devices] = await Promise.all([
    queryBigQuerySql(queryProject, aggregateQuery),
    queryBigQuerySql(queryProject, dailyQuery),
    queryBigQuerySql(queryProject, dimensionQuery('COALESCE(query, \'(anonymous)\')', 'query')),
    tableNames.has('searchdata_url_impression')
      ? queryBigQuerySql(queryProject, dimensionQuery('url', 'pageUrl'))
      : Promise.resolve({ rows: [], error: null }),
    queryBigQuerySql(queryProject, dimensionQuery('country', 'country')),
    queryBigQuerySql(queryProject, dimensionQuery('device', 'device')),
  ]);
  const errors = [aggregate.error, daily.error, queries.error, pages.error, countries.error, devices.error].filter(Boolean);
  if (aggregate.rows.length === 0 && errors.length > 0) return { data: null, error: errors.join('; ') };

  const data = productSearchConsolePayload(
    config,
    range,
    'metrics-hushh-ai-search-console-bigquery',
    config.sourceProjectId,
    config.sourceDataset,
    aggregate.rows[0],
    daily.rows,
    queries.rows,
    pages.rows,
    countries.rows,
    devices.rows,
    'Read by metrics.hushh.ai from the Search Console BigQuery bulk export.',
  );
  const fallback = await fetchProductSearchConsoleFallback(
    config,
    range,
    'GCP fallback is also checked because the official Search Console export can lag behind the API fallback.',
  );
  if (shouldPreferSearchConsoleFallback(data, fallback.data)) return fallback;
  return { data, error: errors.length > 0 ? errors.join('; ') : null };
}

async function fetchHushhTechSearchConsoleFallback(
  range: HushhAiDateRange,
  officialExportNote: string,
): Promise<DataResult<Record<string, unknown>>> {
  const generatedAt = new Date().toISOString();
  const queryProject = BQ_JOB_PROJECT || HUSHHTECH_SEARCH_FALLBACK_PROJECT;
  const datasetRef = `\`${HUSHHTECH_SEARCH_FALLBACK_PROJECT}.${HUSHHTECH_SEARCH_FALLBACK_DATASET}\``;
  const tableRows = await queryBigQuerySql(queryProject, `
    SELECT table_name AS tableName
    FROM ${datasetRef}.INFORMATION_SCHEMA.TABLES
    WHERE table_name IN ('site_daily', 'query_daily', 'page_daily', 'country_daily', 'device_daily')
  `);

  if (tableRows.error) {
    const note = `Search Console fallback aggregates are not queryable yet. ${officialExportNote}`;
    if (/not found|notfound/i.test(tableRows.error)) {
      return { data: unavailableHushhTechSearchConsole(range, note), error: null };
    }
    return { data: null, error: tableRows.error };
  }

  const tableNames = new Set(tableRows.rows.map((row) => String(row.tableName)));
  if (!tableNames.has('site_daily')) {
    return {
      data: unavailableHushhTechSearchConsole(
        range,
        `Search Console fallback is configured, but the daily aggregate table has not been created or populated yet. ${officialExportNote}`,
      ),
      error: null,
    };
  }

  const rowLimit = HUSHHTECH_SEARCH_CONSOLE_ROW_LIMIT;
  const dateFilter = `data_date BETWEEN DATE '${range.startDate}' AND DATE '${range.endDate}'`;
  const searchTypeFilter = `LOWER(search_type) = LOWER(${sqlStringLiteral(HUSHHTECH_SEARCH_CONSOLE_TYPE)})`;
  const siteFilter = `site_url = ${sqlStringLiteral(HUSHHTECH_SEARCH_CONSOLE_SITE_URL)}`;
  const whereClause = `${dateFilter} AND ${searchTypeFilter} AND ${siteFilter}`;
  const weightedPosition = 'SAFE_DIVIDE(SUM(average_position * impressions), SUM(impressions))';
  const aggregateQuery = `
    SELECT
      SUM(clicks) AS clicks,
      SUM(impressions) AS impressions,
      SAFE_DIVIDE(SUM(clicks), SUM(impressions)) AS ctr,
      ${weightedPosition} AS averagePosition
    FROM ${datasetRef}.site_daily
    WHERE ${whereClause}
  `;
  const dailyQuery = `
    SELECT
      CAST(data_date AS STRING) AS date,
      FORMAT_TIMESTAMP('%FT%TZ', MAX(ingested_at)) AS ingestedAt,
      SUM(clicks) AS clicks,
      SUM(impressions) AS impressions,
      SAFE_DIVIDE(SUM(clicks), SUM(impressions)) AS ctr,
      ${weightedPosition} AS averagePosition
    FROM ${datasetRef}.site_daily
    WHERE ${whereClause}
    GROUP BY date
    ORDER BY date
  `;
  const dimensionQuery = (table: string, field: string, alias: string) => tableNames.has(table) ? `
    SELECT
      ${field} AS ${alias},
      SUM(clicks) AS clicks,
      SUM(impressions) AS impressions,
      SAFE_DIVIDE(SUM(clicks), SUM(impressions)) AS ctr,
      ${weightedPosition} AS averagePosition
    FROM ${datasetRef}.${table}
    WHERE ${whereClause}
    GROUP BY ${alias}
    ORDER BY impressions DESC
    LIMIT ${rowLimit}
  ` : null;

  const queryRowsQuery = dimensionQuery('query_daily', 'query', 'query');
  const pageRowsQuery = dimensionQuery('page_daily', 'page_url', 'pageUrl');
  const countryRowsQuery = dimensionQuery('country_daily', 'country', 'country');
  const deviceRowsQuery = dimensionQuery('device_daily', 'device', 'device');

  const [aggregate, daily, queries, pages, countries, devices] = await Promise.all([
    queryBigQuerySql(queryProject, aggregateQuery),
    queryBigQuerySql(queryProject, dailyQuery),
    queryRowsQuery ? queryBigQuerySql(queryProject, queryRowsQuery) : Promise.resolve({ rows: [], error: null }),
    pageRowsQuery ? queryBigQuerySql(queryProject, pageRowsQuery) : Promise.resolve({ rows: [], error: null }),
    countryRowsQuery ? queryBigQuerySql(queryProject, countryRowsQuery) : Promise.resolve({ rows: [], error: null }),
    deviceRowsQuery ? queryBigQuerySql(queryProject, deviceRowsQuery) : Promise.resolve({ rows: [], error: null }),
  ]);
  const errors = [aggregate.error, daily.error, queries.error, pages.error, countries.error, devices.error].filter(Boolean);
  if (aggregate.rows.length === 0 && errors.length > 0) return { data: null, error: errors.join('; ') };

  const overview = searchConsoleMetric(aggregate.rows[0]);
  const available = overview.clicks > 0 || overview.impressions > 0;
  const latestDataDate = latestSearchConsoleDate(daily.rows);
  const latestIngestedAt = latestSearchConsoleIngestedAt(daily.rows);
  return {
    data: {
      source: 'metrics-hushh-ai-search-console-gcp-fallback',
      sourceLabel: 'Search Console fallback aggregates',
      available,
      realtime: false,
      latestDataDate,
      latestIngestedAt,
      expectedLagSeconds: 86_400,
      dataState: HUSHHTECH_SEARCH_CONSOLE_DATA_STATE,
      searchType: HUSHHTECH_SEARCH_CONSOLE_TYPE,
      overview,
      range: {
        startDate: range.startDate,
        endDate: range.endDate,
        days: range.days,
      },
      rangeTotals: overview,
      daily: searchConsoleDailySpine(range, daily.rows),
      queries: queries.rows.map((row) => ({
        query: String(row.query ?? ''),
        ...searchConsoleMetric(row),
      })),
      pages: pages.rows.map((row) => ({
        pageUrl: String(row.pageUrl ?? ''),
        ...searchConsoleMetric(row),
      })),
      countries: countries.rows.map((row) => ({
        country: String(row.country ?? ''),
        ...searchConsoleMetric(row),
      })),
      devices: devices.rows.map((row) => ({
        device: String(row.device ?? ''),
        ...searchConsoleMetric(row),
      })),
      searchAppearance: [],
      state: {
        source: 'metrics-hushh-ai-search-console-gcp-fallback',
        available: false,
        byRegion: [],
        note: 'Search Console fallback tables do not provide US state-level rows.',
      },
      metadata: {
        siteUrl: HUSHHTECH_SEARCH_CONSOLE_SITE_URL,
        generatedAt,
        startDate: range.startDate,
        endDate: range.endDate,
        expectedLagSeconds: 86_400,
      },
      note: available
        ? 'Read by metrics.hushh.ai from GCP fallback Search Console tables while the official bulk export is warming up.'
        : `Search Console GCP fallback returned no rows for this range. ${officialExportNote}`,
    },
    error: errors.length > 0 ? errors.join('; ') : null,
  };
}

async function fetchHushhTechSearchConsole(range: HushhAiDateRange): Promise<DataResult<Record<string, unknown>>> {
  const generatedAt = new Date().toISOString();
  const queryProject = BQ_JOB_PROJECT || HUSHHTECH_SEARCH_PROJECT;
  const datasetRef = `\`${HUSHHTECH_SEARCH_PROJECT}.${HUSHHTECH_SEARCH_DATASET}\``;
  const tableRows = await queryBigQuerySql(queryProject, `
    SELECT table_name AS tableName
    FROM ${datasetRef}.INFORMATION_SCHEMA.TABLES
    WHERE table_name IN ('searchdata_site_impression', 'searchdata_url_impression')
  `);

  if (tableRows.error) {
    const waitingNote = 'Search Console bulk export for hushhtech.com is configured, but it is not queryable yet.';
    if (/not found|notfound/i.test(tableRows.error)) {
      return fetchHushhTechSearchConsoleFallback(range, waitingNote);
    }
    return { data: null, error: tableRows.error };
  }

  const tableNames = new Set(tableRows.rows.map((row) => String(row.tableName)));
  if (!tableNames.has('searchdata_site_impression')) {
    return fetchHushhTechSearchConsoleFallback(
      range,
      'Official Search Console bulk export is set up; waiting for the site impression table.',
    );
  }

  const siteTable = `${datasetRef}.searchdata_site_impression`;
  const urlTable = `${datasetRef}.searchdata_url_impression`;
  const rowLimit = HUSHHTECH_SEARCH_CONSOLE_ROW_LIMIT;
  const dateFilter = `data_date BETWEEN DATE '${range.startDate}' AND DATE '${range.endDate}'`;
  const searchTypeFilter = `LOWER(search_type) = LOWER(${sqlStringLiteral(HUSHHTECH_SEARCH_CONSOLE_TYPE)})`;
  const whereClause = `${dateFilter} AND ${searchTypeFilter}`;
  const aggregateQuery = `
    SELECT
      SUM(clicks) AS clicks,
      SUM(impressions) AS impressions,
      SAFE_DIVIDE(SUM(clicks), SUM(impressions)) AS ctr,
      SAFE_DIVIDE(SUM(sum_top_position), SUM(impressions)) + 1 AS averagePosition
    FROM ${siteTable}
    WHERE ${whereClause}
  `;
  const dailyQuery = `
    SELECT
      CAST(data_date AS STRING) AS date,
      SUM(clicks) AS clicks,
      SUM(impressions) AS impressions,
      SAFE_DIVIDE(SUM(clicks), SUM(impressions)) AS ctr,
      SAFE_DIVIDE(SUM(sum_top_position), SUM(impressions)) + 1 AS averagePosition
    FROM ${siteTable}
    WHERE ${whereClause}
    GROUP BY date
    ORDER BY date
  `;
  const queryRowsQuery = `
    SELECT
      COALESCE(query, '(anonymous)') AS query,
      SUM(clicks) AS clicks,
      SUM(impressions) AS impressions,
      SAFE_DIVIDE(SUM(clicks), SUM(impressions)) AS ctr,
      SAFE_DIVIDE(SUM(sum_top_position), SUM(impressions)) + 1 AS averagePosition
    FROM ${siteTable}
    WHERE ${whereClause}
    GROUP BY query
    ORDER BY impressions DESC
    LIMIT ${rowLimit}
  `;
  const countryRowsQuery = `
    SELECT
      country,
      SUM(clicks) AS clicks,
      SUM(impressions) AS impressions,
      SAFE_DIVIDE(SUM(clicks), SUM(impressions)) AS ctr,
      SAFE_DIVIDE(SUM(sum_top_position), SUM(impressions)) + 1 AS averagePosition
    FROM ${siteTable}
    WHERE ${whereClause}
    GROUP BY country
    ORDER BY impressions DESC
    LIMIT ${rowLimit}
  `;
  const deviceRowsQuery = `
    SELECT
      device,
      SUM(clicks) AS clicks,
      SUM(impressions) AS impressions,
      SAFE_DIVIDE(SUM(clicks), SUM(impressions)) AS ctr,
      SAFE_DIVIDE(SUM(sum_top_position), SUM(impressions)) + 1 AS averagePosition
    FROM ${siteTable}
    WHERE ${whereClause}
    GROUP BY device
    ORDER BY impressions DESC
    LIMIT ${rowLimit}
  `;
  const pageRowsQuery = tableNames.has('searchdata_url_impression') ? `
    SELECT
      url AS pageUrl,
      SUM(clicks) AS clicks,
      SUM(impressions) AS impressions,
      SAFE_DIVIDE(SUM(clicks), SUM(impressions)) AS ctr,
      SAFE_DIVIDE(SUM(sum_position), SUM(impressions)) + 1 AS averagePosition
    FROM ${urlTable}
    WHERE ${whereClause}
    GROUP BY pageUrl
    ORDER BY impressions DESC
    LIMIT ${rowLimit}
  ` : null;

  const [aggregate, daily, queries, countries, devices, pages] = await Promise.all([
    queryBigQuerySql(queryProject, aggregateQuery),
    queryBigQuerySql(queryProject, dailyQuery),
    queryBigQuerySql(queryProject, queryRowsQuery),
    queryBigQuerySql(queryProject, countryRowsQuery),
    queryBigQuerySql(queryProject, deviceRowsQuery),
    pageRowsQuery ? queryBigQuerySql(queryProject, pageRowsQuery) : Promise.resolve({ rows: [], error: null }),
  ]);
  const errors = [aggregate.error, daily.error, queries.error, countries.error, devices.error, pages.error].filter(Boolean);
  if (aggregate.rows.length === 0 && errors.length > 0) return { data: null, error: errors.join('; ') };

  const overview = searchConsoleMetric(aggregate.rows[0]);
  const latestDataDate = latestSearchConsoleDate(daily.rows);
  const data = {
      source: 'metrics-hushh-ai-search-console-bigquery',
      sourceLabel: 'Search Console official export',
      available: overview.clicks > 0 || overview.impressions > 0,
      realtime: false,
      latestDataDate,
      latestIngestedAt: null,
      expectedLagSeconds: 86_400,
      dataState: HUSHHTECH_SEARCH_CONSOLE_DATA_STATE,
      searchType: HUSHHTECH_SEARCH_CONSOLE_TYPE,
      overview,
      range: {
        startDate: range.startDate,
        endDate: range.endDate,
        days: range.days,
      },
      rangeTotals: overview,
      daily: searchConsoleDailySpine(range, daily.rows),
      queries: queries.rows.map((row) => ({
        query: String(row.query ?? ''),
        ...searchConsoleMetric(row),
      })),
      pages: pages.rows.map((row) => ({
        pageUrl: String(row.pageUrl ?? ''),
        ...searchConsoleMetric(row),
      })),
      countries: countries.rows.map((row) => ({
        country: String(row.country ?? ''),
        ...searchConsoleMetric(row),
      })),
      devices: devices.rows.map((row) => ({
        device: String(row.device ?? ''),
        ...searchConsoleMetric(row),
      })),
      searchAppearance: [],
      state: {
        source: 'metrics-hushh-ai-search-console-bigquery',
        available: false,
        byRegion: [],
        note: 'Search Console bulk export does not provide US state-level rows.',
      },
      metadata: {
        siteUrl: HUSHHTECH_SEARCH_CONSOLE_SITE_URL,
        generatedAt,
        startDate: range.startDate,
        endDate: range.endDate,
        expectedLagSeconds: 86_400,
      },
      note: overview.clicks > 0 || overview.impressions > 0
        ? 'Read by metrics.hushh.ai from the Search Console BigQuery bulk export.'
        : 'Search Console bulk export returned no rows for this range.',
  };
  const fallback = await fetchHushhTechSearchConsoleFallback(
    range,
    'GCP fallback is also checked because the official Search Console export can lag behind the API fallback.',
  );
  if (shouldPreferSearchConsoleFallback(data, fallback.data)) return fallback;
  return { data, error: errors.length > 0 ? errors.join('; ') : null };
}

function mergeHushhTechCoverage(summary: Record<string, unknown>): Record<string, unknown> {
  const coverage = { ...(asRecord(summary.dataCoverage) ?? {}) };
  const traffic = asRecord(summary.traffic);
  const gcp = asRecord(summary.gcp);
  const searchPerformance = asRecord(summary.searchPerformance);
  const supabase = asRecord(summary.supabase);
  coverage.ga4Available = Boolean(traffic?.available);
  coverage.gcpAvailable = Boolean(gcp?.available);
  coverage.searchConsoleAvailable = Boolean(searchPerformance?.available);
  coverage.supabaseAvailable = Boolean(supabase);
  coverage.supabaseAggregateTables = Array.isArray(supabase?.metrics)
    ? (supabase.metrics as unknown[]).length
    : toNumber(coverage.supabaseAggregateTables);
  coverage.note = coverage.note ?? 'Provider coverage is assembled by metrics.hushh.ai.';
  return coverage;
}

async function fetchHushhTechAnalytics(range: HushhAiDateRange): Promise<{ data: Record<string, unknown> | null; error: string | null }> {
  const [publicSummary, gcp, searchConsole, supabase] = await Promise.all([
    fetchHushhTechPublicAnalytics(range),
    fetchHushhTechCloudRun(range),
    fetchHushhTechSearchConsole(range),
    fetchHushhTechSupabaseSummary(range),
  ]);
  const summary = publicSummary.data
    ? { ...publicSummary.data }
    : emptyHushhTechSummary(range, 'HushhTech public summary endpoint is unavailable.');

  if (gcp.data) summary.gcp = gcp.data;
  if (searchConsole.data) summary.searchPerformance = searchConsole.data;
  if (supabase.data) summary.supabase = supabase.data;
  summary.dataCoverage = mergeHushhTechCoverage(summary);

  const warnings = new Set(
    (Array.isArray(summary.dataQualityWarnings) ? summary.dataQualityWarnings : [])
      .filter((value): value is string => typeof value === 'string'),
  );
  if (publicSummary.error) warnings.add('HushhTech public summary endpoint is unavailable.');
  if (gcp.error) warnings.add('Cloud Run Monitoring is unavailable to metrics.hushh.ai.');
  if (supabase.error) warnings.add('HushhTech Supabase database aggregates are unavailable.');
  if (searchConsole.data && asRecord(searchConsole.data)?.available === false) {
    warnings.add(String(asRecord(searchConsole.data)?.note ?? 'Search Console is waiting.'));
  }
  summary.dataQualityWarnings = Array.from(warnings);
  summary.sourceCards = buildHushhTechSourceCards(summary);

  return {
    data: summary,
    error: publicSummary.data || gcp.data || searchConsole.data ? null : publicSummary.error ?? gcp.error ?? null,
  };
}

// ---------------------------------------------------------------------------
// Kai GA4 raw export summary
// ---------------------------------------------------------------------------

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function defaultUtcRange(days: number): HushhAiDateRange {
  const end = new Date();
  const endDate = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  const windowDays = Math.max(1, Math.min(days, MAX_HUSHH_AI_RANGE_DAYS));
  return {
    startDate: formatUtcDate(addUtcDays(endDate, -(windowDays - 1))),
    endDate: formatUtcDate(endDate),
    days: windowDays,
    startTime: addUtcDays(endDate, -(windowDays - 1)).toISOString(),
    endTime: addUtcDays(endDate, 1).toISOString(),
    windowSeconds: windowDays * 86_400,
  };
}

async function fetchKaiGa4Summary(range?: HushhAiDateRange): Promise<DataResult<Record<string, unknown>>> {
  const windowDays = Number.isFinite(KAI_GA4_WINDOW_DAYS) ? KAI_GA4_WINDOW_DAYS : 14;
  const effectiveRange = range ?? defaultUtcRange(windowDays);
  return fetchKaiGa4ExportSummary(KAI_GA4_PROJECT, KAI_GA4_DATASET, effectiveRange, false);
}

function ga4ExportSuffixFilter(startDate: string, endDate: string, includeIntraday = false): string {
  const start = startDate.replaceAll('-', '');
  const end = endDate.replaceAll('-', '');
  if (!includeIntraday) return `_TABLE_SUFFIX BETWEEN '${start}' AND '${end}'`;

  const suffixes: string[] = [];
  let cursor = parseUtcDate(startDate) as Date;
  const last = parseUtcDate(endDate) as Date;
  while (cursor <= last) {
    const suffix = formatUtcDate(cursor).replaceAll('-', '');
    suffixes.push(`'${suffix}'`, `'intraday_${suffix}'`);
    cursor = addUtcDays(cursor, 1);
  }
  return `_TABLE_SUFFIX IN (${suffixes.join(', ')})`;
}

function ga4ExportTotalsSql(table: string, whereClause: string): string {
  return `
    SELECT
      COUNT(*) AS events,
      COUNT(DISTINCT user_pseudo_id) AS users,
      COUNT(DISTINCT (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id')) AS sessions
    FROM ${table}
    WHERE ${whereClause}
  `;
}

async function fetchKaiGa4ExportSummary(
  projectId: string,
  dataset: string,
  range: HushhAiDateRange,
  tolerateMissingDataset: boolean,
): Promise<DataResult<Record<string, unknown>>> {
  const generatedAt = new Date().toISOString();
  const table = `\`${projectId}.${dataset}.events_*\``;
  const dateFilter = ga4ExportSuffixFilter(range.startDate, range.endDate);
  const last7Range = defaultUtcRange(7);
  const last24Range = defaultUtcRange(2);
  const last7Filter = ga4ExportSuffixFilter(last7Range.startDate, last7Range.endDate);
  const last24Filter = `${ga4ExportSuffixFilter(last24Range.startDate, last24Range.endDate, true)}
    AND TIMESTAMP_MICROS(event_timestamp) >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)`;

  const dailyQuery = `
    SELECT
      CAST(DATE(TIMESTAMP_MICROS(event_timestamp)) AS STRING) AS eventDate,
      COUNT(*) AS events,
      COUNT(DISTINCT user_pseudo_id) AS users,
      COUNT(DISTINCT (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id')) AS sessions
    FROM ${table}
    WHERE ${dateFilter}
    GROUP BY eventDate
    ORDER BY eventDate
  `;
  const totalsQuery = ga4ExportTotalsSql(table, dateFilter);
  const last7Query = ga4ExportTotalsSql(table, last7Filter);
  const last24Query = ga4ExportTotalsSql(table, last24Filter);
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

  const queryProject = BQ_JOB_PROJECT || projectId;
  const [daily, totals, last7, last24, topEvents, geo] = await Promise.all([
    queryBigQuerySql(queryProject, dailyQuery),
    queryBigQuerySql(queryProject, totalsQuery),
    queryBigQuerySql(queryProject, last7Query),
    queryBigQuerySql(queryProject, last24Query),
    queryBigQuerySql(queryProject, eventsQuery),
    queryBigQuerySql(queryProject, geoQuery),
  ]);
  const errors = [daily.error, totals.error, last7.error, last24.error, topEvents.error, geo.error].filter(Boolean);

  if (daily.rows.length === 0 && topEvents.rows.length === 0 && geo.rows.length === 0 && errors.length > 0) {
    if (tolerateMissingDataset) {
      return {
        data: {
          sourceProjectId: projectId,
          sourceDataset: dataset,
          generatedAt,
          realtimeMode: 'delayed_export',
          expectedLagSeconds: 86_400,
          available: false,
          range: {
            startDate: range.startDate,
            endDate: range.endDate,
            days: range.days,
          },
          rangeTotals: {
            users: 0,
            sessions: 0,
            events: 0,
          },
          sections: buildGa4Sections({
            generatedAt,
            realtime: {
              users: null,
              sessions: null,
              events: null,
              available: false,
              note: 'Realtime GA4 needs a GA4 Data API property ID; BigQuery export is delayed.',
            },
            last24Hours: {
              users: null,
              sessions: null,
              events: null,
              available: false,
              note: 'GA4 export rows are not available for the last 24 hours yet.',
            },
            last7Days: { users: 0, sessions: 0, events: 0, available: false },
            selectedTotal: { users: 0, sessions: 0, events: 0, available: false },
          }),
          daily: dateSpine(range).map((date) => ({
            eventDate: date,
            events: 0,
            users: 0,
            sessions: 0,
          })),
          topEvents: [],
          geo: [],
        },
        error: null,
      };
    }
    return { data: null, error: errors.join('; ') };
  }

  const dailyByDate = new Map(daily.rows.map((row) => [String(row.eventDate), row]));
  const totalsRow = totals.rows[0] ?? {};
  const last7Row = last7.rows[0] ?? {};
  const last24Row = last24.rows[0] ?? {};
  const selectedTotals = {
    users: toNumber(totalsRow.users),
    sessions: toNumber(totalsRow.sessions),
    events: toNumber(totalsRow.events),
  };

  return {
    data: {
      sourceProjectId: projectId,
      sourceDataset: dataset,
      sourceLabel: 'GA4 export',
      generatedAt,
      realtimeMode: 'delayed_export',
      expectedLagSeconds: 86_400,
      available: daily.rows.length > 0 || topEvents.rows.length > 0 || geo.rows.length > 0,
      windowDays: range.days,
      range: {
        startDate: range.startDate,
        endDate: range.endDate,
        days: range.days,
      },
      rangeTotals: {
        users: selectedTotals.users,
        sessions: selectedTotals.sessions,
        events: selectedTotals.events,
      },
      sections: buildGa4Sections({
        generatedAt,
        realtime: {
          users: null,
          sessions: null,
          events: null,
          available: false,
          note: 'Realtime GA4 needs a GA4 Data API property ID; BigQuery export is delayed.',
        },
        last24Hours: {
          users: toNumber(last24Row.users),
          sessions: toNumber(last24Row.sessions),
          events: toNumber(last24Row.events),
          available: !last24.error,
        },
        last7Days: {
          users: toNumber(last7Row.users),
          sessions: toNumber(last7Row.sessions),
          events: toNumber(last7Row.events),
          available: !last7.error,
        },
        selectedTotal: {
          ...selectedTotals,
          available: !totals.error,
        },
      }),
      daily: dateSpine(range).map((date) => {
        const row = dailyByDate.get(date) ?? {};
        return {
          eventDate: date,
          events: toNumber(row.events),
          users: toNumber(row.users),
          sessions: toNumber(row.sessions),
        };
      }),
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

function waitingGa4Summary(
  productLabel: string,
  range: HushhAiDateRange,
  sourceProjectId: string,
  sourceDataset: string,
  note: string,
): Record<string, unknown> {
  return {
    sourceProjectId,
    sourceDataset,
    sourceLabel: 'GA4 waiting',
    generatedAt: new Date().toISOString(),
    realtimeMode: 'delayed_export',
    expectedLagSeconds: 86_400,
    available: false,
    windowDays: range.days,
    range: {
      startDate: range.startDate,
      endDate: range.endDate,
      days: range.days,
    },
    rangeTotals: {
      users: null,
      sessions: null,
      events: null,
    },
    sections: buildGa4Sections({
      generatedAt: new Date().toISOString(),
      realtime: { users: null, sessions: null, events: null, available: false, note },
      last24Hours: { users: null, sessions: null, events: null, available: false, note },
      last7Days: { users: null, sessions: null, events: null, available: false, note },
      selectedTotal: { users: null, sessions: null, events: null, available: false, note },
    }),
    daily: dateSpine(range).map((date) => ({
      eventDate: date,
      events: 0,
      users: 0,
      sessions: 0,
    })),
    topEvents: [],
    geo: [],
    note: `${productLabel} ${note}`,
  };
}

type Ga4RunReportRow = {
  dimensionValues?: Array<{ value?: string }>;
  metricValues?: Array<{ value?: string }>;
};

type Ga4RunReportResponse = {
  rows?: Ga4RunReportRow[];
};

function ga4Metric(row: Ga4RunReportRow | undefined, index: number): number {
  return toNumber(row?.metricValues?.[index]?.value);
}

function ga4Dimension(row: Ga4RunReportRow | undefined, index: number): string {
  return String(row?.dimensionValues?.[index]?.value ?? '');
}

function formatGa4ApiDate(value: string): string {
  return /^\d{8}$/.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
    : value;
}

async function ga4AuthorizedClient() {
  const { GoogleAuth, Impersonated } = await import('google-auth-library');
  const auth = new GoogleAuth({
    scopes: HUSHH_AI_GA4_IMPERSONATE_SERVICE_ACCOUNT
      ? ['https://www.googleapis.com/auth/cloud-platform']
      : ['https://www.googleapis.com/auth/analytics.readonly'],
  });
  const sourceClient = await auth.getClient();
  const client = HUSHH_AI_GA4_IMPERSONATE_SERVICE_ACCOUNT
    ? new Impersonated({
      sourceClient,
      targetPrincipal: HUSHH_AI_GA4_IMPERSONATE_SERVICE_ACCOUNT,
      targetScopes: ['https://www.googleapis.com/auth/analytics.readonly'],
      lifetime: 3600,
    })
    : sourceClient;
  return client as any;
}

async function runGa4Report(propertyId: string, body: Record<string, unknown>): Promise<Ga4RunReportResponse> {
  const client = await ga4AuthorizedClient();
  const res = await (client as any).request({
    url: `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    method: 'POST',
    data: body,
    timeout: 30_000,
  });
  return res.data as Ga4RunReportResponse;
}

async function runGa4RealtimeReport(propertyId: string, body: Record<string, unknown>): Promise<Ga4RunReportResponse> {
  const client = await ga4AuthorizedClient();
  const res = await (client as any).request({
    url: `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runRealtimeReport`,
    method: 'POST',
    data: body,
    timeout: 30_000,
  });
  return res.data as Ga4RunReportResponse;
}

function ga4TotalsFromRow(row: Ga4RunReportRow | undefined, offset = 0) {
  return {
    users: ga4Metric(row, offset),
    sessions: ga4Metric(row, offset + 1),
    events: ga4Metric(row, offset + 2),
  };
}

function sumGa4Rows(rows: Ga4RunReportRow[] | undefined, metricOffset = 0) {
  return (rows ?? []).reduce(
    (totals, row) => ({
      users: totals.users + ga4Metric(row, metricOffset),
      sessions: totals.sessions + ga4Metric(row, metricOffset + 1),
      events: totals.events + ga4Metric(row, metricOffset + 2),
    }),
    { users: 0, sessions: 0, events: 0 },
  );
}

function buildGa4Sections(params: {
  generatedAt: string;
  realtime?: { users: number | null; sessions: number | null; events: number | null; available: boolean; note?: string | null };
  last24Hours?: { users: number | null; sessions: number | null; events: number | null; available: boolean; note?: string | null };
  last7Days?: { users: number | null; sessions: number | null; events: number | null; available: boolean; note?: string | null };
  selectedTotal?: { users: number | null; sessions: number | null; events: number | null; available: boolean; note?: string | null };
}) {
  const toSection = (
    key: string,
    label: string,
    mode: string,
    totals: { users: number | null; sessions: number | null; events: number | null; available: boolean; note?: string | null } | undefined,
  ) => ({
    key,
    label,
    status: totals?.available ? (key === 'realtime' ? 'live' : 'delayed') : 'waiting',
    stateClass: sourceStateClass(totals?.available ? (key === 'realtime' ? 'live' : 'delayed') : 'waiting'),
    source: mode,
    freshness: {
      generatedAt: params.generatedAt,
      expectedLagSeconds: key === 'realtime' ? 60 : 86_400,
    },
    metrics: [
      sourceMetric('users', key === 'realtime' ? 'Active Users' : 'Users', totals?.users),
      sourceMetric('sessions', 'Sessions', totals?.sessions),
      sourceMetric('events', 'Events', totals?.events),
    ],
    blocker: totals?.available ? null : totals?.note ?? `${label} is waiting for GA4 rows.`,
  });

  return [
    toSection('realtime', 'Realtime', 'GA4 Realtime API', params.realtime),
    toSection('last_24_hours', 'Last 24 Hours', 'GA4 processed report', params.last24Hours),
    toSection('last_7_days', 'Last 7 Days', 'GA4 processed report', params.last7Days),
    toSection('selected_total', 'Selected Total', 'GA4 selected range', params.selectedTotal),
  ];
}

async function fetchGa4DataApiSummary(
  propertyId: string,
  measurementId: string,
  range: HushhAiDateRange,
): Promise<DataResult<Record<string, unknown>>> {
  const generatedAt = new Date().toISOString();
  const dateRanges = [{ startDate: range.startDate, endDate: range.endDate }];
  const last7DateRanges = [{ startDate: '7daysAgo', endDate: 'today' }];
  const last24DateRanges = [{ startDate: 'yesterday', endDate: 'today' }];
  const coreMetrics = [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'eventCount' }];

  try {
    const [realtime, last24Hourly, last7Totals, daily, totals, topEvents, geo] = await Promise.all([
      runGa4RealtimeReport(propertyId, {
        minuteRanges: [{ name: 'last_30_minutes', startMinutesAgo: 29, endMinutesAgo: 0 }],
        metrics: [{ name: 'activeUsers' }, { name: 'eventCount' }],
        limit: '10',
      }),
      runGa4Report(propertyId, {
        dateRanges: last24DateRanges,
        dimensions: [{ name: 'dateHour' }],
        metrics: coreMetrics,
        orderBys: [{ dimension: { dimensionName: 'dateHour' } }],
      }),
      runGa4Report(propertyId, {
        dateRanges: last7DateRanges,
        metrics: coreMetrics,
      }),
      runGa4Report(propertyId, {
        dateRanges,
        dimensions: [{ name: 'date' }],
        metrics: coreMetrics,
        orderBys: [{ dimension: { dimensionName: 'date' } }],
      }),
      runGa4Report(propertyId, {
        dateRanges,
        metrics: coreMetrics,
      }),
      runGa4Report(propertyId, {
        dateRanges,
        dimensions: [{ name: 'eventName' }],
        metrics: [{ name: 'eventCount' }, { name: 'activeUsers' }],
        orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
        limit: '20',
      }),
      runGa4Report(propertyId, {
        dateRanges,
        dimensions: [{ name: 'platform' }, { name: 'deviceCategory' }, { name: 'country' }],
        metrics: [{ name: 'eventCount' }, { name: 'activeUsers' }],
        orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
        limit: '20',
      }),
    ]);

    const dailyByDate = new Map(
      (daily.rows ?? []).map((row) => [formatGa4ApiDate(ga4Dimension(row, 0)), row]),
    );
    const totalsRow = totals.rows?.[0];
    const realtimeRow = realtime.rows?.[0];
    const realtimeTotals = {
      users: realtimeRow ? ga4Metric(realtimeRow, 0) : 0,
      sessions: null,
      events: realtimeRow ? ga4Metric(realtimeRow, 1) : 0,
      available: true,
      note: null,
    };
    const last24Totals = sumGa4Rows(last24Hourly.rows);
    const last7Row = last7Totals.rows?.[0];
    const selectedTotals = ga4TotalsFromRow(totalsRow);

    return {
      data: {
        source: 'ga4-data-api',
        sourceLabel: 'GA4 Data API',
        propertyId,
        measurementId,
        generatedAt,
        realtimeMode: 'delayed_export',
        expectedLagSeconds: 86_400,
        available: true,
        windowDays: range.days,
        range: {
          startDate: range.startDate,
          endDate: range.endDate,
          days: range.days,
        },
        rangeTotals: {
          users: selectedTotals.users,
          sessions: selectedTotals.sessions,
          events: selectedTotals.events,
        },
        sections: buildGa4Sections({
          generatedAt,
          realtime: realtimeTotals,
          last24Hours: {
            ...last24Totals,
            available: true,
            note: 'Last 24 hours is assembled from GA4 hourly processed rows.',
          },
          last7Days: {
            ...ga4TotalsFromRow(last7Row),
            available: true,
          },
          selectedTotal: {
            ...selectedTotals,
            available: true,
          },
        }),
        daily: dateSpine(range).map((date) => {
          const row = dailyByDate.get(date);
          return {
            eventDate: date,
            users: ga4Metric(row, 0),
            sessions: ga4Metric(row, 1),
            events: ga4Metric(row, 2),
          };
        }),
        topEvents: (topEvents.rows ?? []).map((row) => ({
          eventName: ga4Dimension(row, 0),
          events: ga4Metric(row, 0),
          users: ga4Metric(row, 1),
        })),
        geo: (geo.rows ?? []).map((row) => ({
          platform: ga4Dimension(row, 0),
          deviceCategory: ga4Dimension(row, 1),
          country: ga4Dimension(row, 2),
          events: ga4Metric(row, 0),
          users: ga4Metric(row, 1),
        })),
      },
      error: null,
    };
  } catch (err: unknown) {
    const message = publicIntegrationError('GA4 Data API', err);
    return {
      data: waitingGa4Summary(
        'Hushh AI',
        range,
        `properties/${propertyId}`,
        measurementId,
        `GA4 Data API source is configured for ${measurementId}, but ${message}`,
      ),
      error: null,
    };
  }
}

async function fetchHushhAiGa4Summary(range: HushhAiDateRange): Promise<DataResult<Record<string, unknown>>> {
  if (HUSHH_AI_GA4_PROPERTY_ID) {
    return fetchGa4DataApiSummary(HUSHH_AI_GA4_PROPERTY_ID, HUSHH_AI_GA4_MEASUREMENT_ID, range);
  }

  if (!HUSHH_AI_GA4_PROJECT || !HUSHH_AI_GA4_DATASET) {
    return {
      data: waitingGa4Summary(
        'Hushh AI',
        range,
        HUSHH_AI_GA4_PROJECT,
        HUSHH_AI_GA4_DATASET,
        `GA4 Data API property ID is not configured in metrics.hushh.ai yet for ${HUSHH_AI_GA4_MEASUREMENT_ID}.`,
      ),
      error: null,
    };
  }
  return fetchKaiGa4ExportSummary(HUSHH_AI_GA4_PROJECT, HUSHH_AI_GA4_DATASET, range, true);
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

async function fetchCloudRunSummary(
  projectId: string,
  serviceName: string,
  range: HushhAiDateRange,
  logLabel: string,
): Promise<DataResult<Record<string, unknown>>> {
  try {
    const generatedAt = new Date().toISOString();
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
        generatedAt,
        realtimeMode: 'near_live',
        expectedLagSeconds: 300,
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
    console.error(`${logLabel} Cloud Run metrics failed:`, message);
    return { data: null, error: message };
  }
}

async function fetchHushhAiCloudRun(range: HushhAiDateRange): Promise<DataResult<Record<string, unknown>>> {
  return fetchCloudRunSummary(HUSHH_AI_GCP_PROJECT, HUSHH_AI_CLOUD_RUN_SERVICE, range, 'Hushh AI');
}

async function fetchHushhAiSearchConsole(range: HushhAiDateRange): Promise<DataResult<Record<string, unknown>>> {
  return fetchProductSearchConsole({
    productLabel: 'Hushh AI',
    sourceProjectId: HUSHH_AI_SEARCH_PROJECT,
    sourceDataset: HUSHH_AI_SEARCH_DATASET,
    fallbackProjectId: HUSHH_AI_SEARCH_FALLBACK_PROJECT,
    fallbackDataset: HUSHH_AI_SEARCH_FALLBACK_DATASET,
    siteUrl: HUSHH_AI_SEARCH_CONSOLE_SITE_URL,
    searchType: HUSHH_AI_SEARCH_CONSOLE_TYPE,
    dataState: HUSHH_AI_SEARCH_CONSOLE_DATA_STATE,
    rowLimit: HUSHH_AI_SEARCH_CONSOLE_ROW_LIMIT,
    pageFilterRegex: HUSHH_AI_SEARCH_CONSOLE_PAGE_FILTER_REGEX,
  }, range);
}

async function fetchKaiSearchConsole(range: HushhAiDateRange): Promise<DataResult<Record<string, unknown>>> {
  return fetchProductSearchConsole({
    productLabel: 'Kai',
    sourceProjectId: KAI_SEARCH_PROJECT,
    sourceDataset: KAI_SEARCH_DATASET,
    fallbackProjectId: KAI_SEARCH_FALLBACK_PROJECT,
    fallbackDataset: KAI_SEARCH_FALLBACK_DATASET,
    siteUrl: KAI_SEARCH_CONSOLE_SITE_URL,
    searchType: KAI_SEARCH_CONSOLE_TYPE,
    dataState: KAI_SEARCH_CONSOLE_DATA_STATE,
    rowLimit: KAI_SEARCH_CONSOLE_ROW_LIMIT,
    pageFilterRegex: KAI_SEARCH_CONSOLE_PAGE_FILTER_REGEX,
  }, range);
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

function timestampString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'value' in value && typeof (value as { value?: unknown }).value === 'string') {
    return (value as { value: string }).value;
  }
  return null;
}

function buildKaiFeedStatus(rows: Record<string, unknown>[]) {
  const statusRows = rows.filter((row) => row.metric_group === 'status');
  const get = (name: string) => statusRows.find((row) => row.metric_name === name);
  return {
    sourceEnvironment: String(get('source_environment')?.metric_string_value ?? ''),
    sourceProjectId: String(get('source_project_id')?.metric_string_value ?? ''),
    sourceDataset: String(get('source_dataset')?.metric_string_value ?? ''),
    productionReady: get('production_ready')?.metric_string_value === 'true',
    knownBlockers: typeof get('known_blockers')?.metric_string_value === 'string'
      ? String(get('known_blockers')?.metric_string_value)
      : null,
    latestEventAt: timestampString(get('latest_event_at')?.metric_timestamp),
    freshnessLagMinutes: get('freshness_lag_minutes')?.metric_value == null
      ? null
      : toNumber(get('freshness_lag_minutes')?.metric_value),
    sourceEventRows: toNumber(get('source_event_rows')?.metric_count ?? get('source_event_rows')?.metric_value),
    asOfTimestamp: timestampString(statusRows[0]?.as_of_timestamp),
  };
}

function buildKaiFreshness(
  fetchedAt: string,
  productionRows: Record<string, unknown>[],
  gcp: Record<string, unknown> | null,
  productionGa4: Record<string, unknown> | null,
) {
  const feedStatus = buildKaiFeedStatus(productionRows);
  const ga4Available = Boolean(productionGa4?.available);
  return {
    mode: 'polling',
    refreshIntervalSeconds: HUSHH_AI_LIVE_REFRESH_SECONDS,
    fetchedAt,
    sources: [
      {
        key: 'cloud_run',
        label: 'Cloud Run',
        state: gcp ? 'near_live' : 'unavailable',
        realtimeLevel: gcp ? 'monitoring_lag' : 'unavailable',
        generatedAt: typeof gcp?.generatedAt === 'string' ? gcp.generatedAt : fetchedAt,
        expectedLagSeconds: 300,
        detail: gcp ? 'kai.hushh.ai Cloud Run metrics can lag by a few minutes' : 'Kai Cloud Run Monitoring unavailable',
      },
      {
        key: 'production_feed',
        label: 'Production Feed',
        state: feedStatus.productionReady ? 'live' : 'waiting',
        realtimeLevel: feedStatus.productionReady ? 'public_feed' : 'status_only',
        generatedAt: feedStatus.asOfTimestamp ?? fetchedAt,
        expectedLagSeconds: feedStatus.productionReady ? null : 86_400,
        detail: feedStatus.productionReady ? 'production public feed is ready' : 'production feed is status-only until GA4 export materializes',
      },
      {
        key: 'production_ga4',
        label: 'Production GA4',
        state: ga4Available ? 'delayed' : 'waiting',
        realtimeLevel: 'delayed_export',
        generatedAt: typeof productionGa4?.generatedAt === 'string' ? productionGa4.generatedAt : fetchedAt,
        expectedLagSeconds: 86_400,
        detail: ga4Available ? 'production GA4 export is available with daily export lag' : 'hushh-pda.analytics_526603671 is not visible/materialized yet',
      },
      {
        key: 'uat_validation',
        label: 'UAT Validation',
        state: 'live',
        realtimeLevel: 'validation_feed',
        generatedAt: fetchedAt,
        expectedLagSeconds: 86_400,
        detail: 'UAT Kai feed remains available for validation, separate from production truth',
      },
    ],
  };
}

function buildHushhAiFreshness(
  fetchedAt: string,
  gcp: Record<string, unknown> | null,
  searchConsole: Record<string, unknown> | null,
  ga4: Record<string, unknown> | null = null,
  productEvents: Record<string, unknown> | null = null,
) {
  const searchAvailable = Boolean(searchConsole?.available);
  const ga4Available = Boolean(ga4?.available);
  const eventsAvailable = Boolean(productEvents?.available);
  const productEventsState = eventsAvailable
    ? 'live'
    : String(productEvents?.status ?? 'waiting');
  return {
    mode: 'polling',
    refreshIntervalSeconds: HUSHH_AI_LIVE_REFRESH_SECONDS,
    fetchedAt,
    sources: [
      {
        key: 'gcp',
        label: 'Cloud Run',
        state: gcp ? 'near_live' : 'unavailable',
        realtimeLevel: gcp ? 'monitoring_lag' : 'unavailable',
        generatedAt: typeof gcp?.generatedAt === 'string' ? gcp.generatedAt : fetchedAt,
        expectedLagSeconds: 300,
        detail: gcp ? 'Google Cloud Monitoring can lag by a few minutes' : 'Cloud Run Monitoring unavailable',
      },
      {
        key: 'search_console',
        label: 'Search Console',
        state: searchAvailable ? 'delayed' : 'waiting',
        realtimeLevel: 'delayed_export',
        generatedAt: typeof searchConsole?.generatedAt === 'string' ? searchConsole.generatedAt : fetchedAt,
        expectedLagSeconds: 86_400,
        detail: searchAvailable ? 'Search Console exports are delayed' : 'export tables/data not ready for this window',
      },
      {
        key: 'ga4',
        label: 'GA4',
        state: ga4Available ? 'delayed' : 'waiting',
        realtimeLevel: 'delayed_export',
        generatedAt: typeof ga4?.generatedAt === 'string' ? ga4.generatedAt : fetchedAt,
        expectedLagSeconds: 86_400,
        detail: ga4Available ? 'GA4 export is available with daily export lag' : 'GA4 source is not configured or has not exported rows yet',
      },
      {
        key: 'product_events',
        label: 'DB / Product Events',
        state: productEventsState,
        realtimeLevel: eventsAvailable ? 'events_aggregate' : 'not_configured',
        generatedAt: typeof productEvents?.generatedAt === 'string' ? productEvents.generatedAt : fetchedAt,
        expectedLagSeconds: eventsAvailable ? null : null,
        detail: eventsAvailable
          ? 'Product event aggregates are available'
          : String(productEvents?.note ?? 'Hushh AI DB aggregate source is not configured yet'),
      },
    ],
  };
}

function sourceStateClass(status: string): string {
  if (status === 'live' || status === 'near_live') return 'live';
  if (status === 'delayed') return 'delayed';
  if (status === 'collecting_not_ingested') return 'collecting_not_ingested';
  if (status === 'waiting' || status === 'not_configured') return 'waiting';
  return 'unavailable';
}

function metricValue(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sourceMetric(key: string, label: string, value: unknown, displayValue?: string | null) {
  return {
    key,
    label,
    value: metricValue(value),
    ...(displayValue ? { displayValue } : {}),
  };
}

function formatSourcePercent(value: unknown): string | null {
  const parsed = metricValue(value);
  return parsed == null ? null : `${(parsed * 100).toFixed(1)}%`;
}

function formatSourcePosition(value: unknown): string | null {
  const parsed = metricValue(value);
  return parsed == null ? null : parsed.toFixed(1);
}

function searchConsoleDailyRows(searchConsole: Record<string, unknown> | null): Record<string, unknown>[] {
  return Array.isArray(searchConsole?.daily)
    ? searchConsole.daily.filter((row): row is Record<string, unknown> => Boolean(asRecord(row)))
    : [];
}

function aggregateSearchConsoleRows(rows: Record<string, unknown>[]) {
  const clicks = rows.reduce((sum, row) => sum + toNumber(row.clicks), 0);
  const impressions = rows.reduce((sum, row) => sum + toNumber(row.impressions), 0);
  const weightedPosition = rows.reduce((sum, row) => {
    const position = metricValue(row.averagePosition);
    return position == null ? sum : sum + position * toNumber(row.impressions);
  }, 0);
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : null,
    averagePosition: impressions > 0 ? weightedPosition / impressions : null,
  };
}

function searchConsoleSectionMetrics(metric: Record<string, unknown>) {
  return [
    sourceMetric('clicks', 'Clicks', metric.clicks),
    sourceMetric('impressions', 'Impressions', metric.impressions),
    sourceMetric('ctr', 'CTR', metric.ctr, formatSourcePercent(metric.ctr)),
    sourceMetric('average_position', 'Avg Position', metric.averagePosition, formatSourcePosition(metric.averagePosition)),
  ];
}

function buildSearchConsoleSourceCard(searchConsole: Record<string, unknown> | null, fallbackSource: string) {
  const available = Boolean(searchConsole?.available);
  const note = typeof searchConsole?.note === 'string' ? searchConsole.note : null;
  const overview = asRecord(searchConsole?.overview) ?? {};
  const generatedAt = typeof searchConsole?.generatedAt === 'string' ? searchConsole.generatedAt : new Date().toISOString();
  const dailyRows = searchConsoleDailyRows(searchConsole);
  const latestAvailableDaily = dailyRows
    .filter((row) => toNumber(row.clicks) > 0 || toNumber(row.impressions) > 0)
    .at(-1) ?? dailyRows.at(-1);
  const latestMetric = latestAvailableDaily
    ? {
        ...searchConsoleMetric(latestAvailableDaily),
        date: latestAvailableDaily.date,
      }
    : aggregateSearchConsoleRows([]);
  const lastSevenMetric = aggregateSearchConsoleRows(dailyRows.slice(-7));
  const rangeTotals = asRecord(searchConsole?.rangeTotals) ?? {};
  const selectedMetric = searchConsoleMetric({ ...overview, ...rangeTotals });
  const latestDataDate = typeof searchConsole?.latestDataDate === 'string'
    ? searchConsole.latestDataDate
    : typeof latestAvailableDaily?.date === 'string'
      ? latestAvailableDaily.date
      : null;
  const latestIngestedAt = typeof searchConsole?.latestIngestedAt === 'string' ? searchConsole.latestIngestedAt : null;
  const sourceFreshnessAt = latestIngestedAt ?? generatedAt;
  const dailySource = latestDataDate ? `GCP daily aggregate · data date ${latestDataDate}` : 'GCP daily aggregate';
  const waitingSearchNote = 'Waiting for the next GCP Search Console daily aggregate.';
  return {
    key: 'search_console',
    label: 'Search Console',
    status: available ? 'delayed' : 'waiting',
    stateClass: sourceStateClass(available ? 'delayed' : 'waiting'),
    source: String(searchConsole?.sourceLabel ?? publicSearchConsoleSourceLabel(searchConsole?.source ?? fallbackSource)),
    freshness: {
      generatedAt: sourceFreshnessAt,
      expectedLagSeconds: metricValue(searchConsole?.expectedLagSeconds),
    },
    metrics: [
      sourceMetric('clicks', 'Clicks', searchConsole?.clicks ?? overview.clicks),
      sourceMetric('impressions', 'Impressions', searchConsole?.impressions ?? overview.impressions),
      sourceMetric('ctr', 'CTR', searchConsole?.ctr ?? overview.ctr, formatSourcePercent(searchConsole?.ctr ?? overview.ctr)),
      sourceMetric(
        'average_position',
        'Avg Position',
        searchConsole?.averagePosition ?? overview.averagePosition,
        formatSourcePosition(searchConsole?.averagePosition ?? overview.averagePosition),
      ),
    ],
    sections: [
      {
        key: 'last_24_hours',
        label: 'Latest Available Day',
        status: latestAvailableDaily && available ? 'delayed' : 'waiting',
        stateClass: sourceStateClass(latestAvailableDaily && available ? 'delayed' : 'waiting'),
        source: dailySource,
        freshness: {
          generatedAt: sourceFreshnessAt,
          expectedLagSeconds: metricValue(searchConsole?.expectedLagSeconds ?? 86_400),
        },
        metrics: searchConsoleSectionMetrics(latestMetric),
        blocker: latestAvailableDaily && available ? null : note ?? waitingSearchNote,
      },
      {
        key: 'last_7_days',
        label: 'Last 7 Days',
        status: available ? 'delayed' : 'waiting',
        stateClass: sourceStateClass(available ? 'delayed' : 'waiting'),
        source: dailySource,
        freshness: {
          generatedAt: sourceFreshnessAt,
          expectedLagSeconds: metricValue(searchConsole?.expectedLagSeconds ?? 86_400),
        },
        metrics: searchConsoleSectionMetrics(lastSevenMetric),
        blocker: available ? null : note ?? 'Search Console 7-day aggregate is waiting in GCP.',
      },
      {
        key: 'selected_total',
        label: 'Selected Total',
        status: available ? 'delayed' : 'waiting',
        stateClass: sourceStateClass(available ? 'delayed' : 'waiting'),
        source: latestDataDate ? `GCP selected range aggregate · latest data ${latestDataDate}` : 'GCP selected range aggregate',
        freshness: {
          generatedAt: sourceFreshnessAt,
          expectedLagSeconds: metricValue(searchConsole?.expectedLagSeconds ?? 86_400),
        },
        metrics: searchConsoleSectionMetrics(selectedMetric),
        blocker: available ? null : note ?? 'Search Console selected-range aggregate is waiting in GCP.',
      },
    ],
    blocker: available ? null : note ?? 'Search Console source is waiting for export or fallback rows.',
  };
}

function buildGa4SourceCard(ga4: Record<string, unknown> | null, source: string, blocker: string) {
  const available = Boolean(ga4?.available);
  const totals = asRecord(ga4?.rangeTotals) ?? {};
  const sections = Array.isArray(ga4?.sections) ? ga4.sections : [];
  return {
    key: 'ga4',
    label: 'GA4',
    status: available ? 'delayed' : 'waiting',
    stateClass: sourceStateClass(available ? 'delayed' : 'waiting'),
    source: publicGa4SourceLabel(source),
    freshness: {
      generatedAt: typeof ga4?.generatedAt === 'string' ? ga4.generatedAt : new Date().toISOString(),
      expectedLagSeconds: metricValue(ga4?.expectedLagSeconds ?? 86_400),
    },
    metrics: [
      sourceMetric('users', 'Users', totals.users),
      sourceMetric('sessions', 'Sessions', totals.sessions),
      sourceMetric('events', 'Events', totals.events),
    ],
    sections,
    blocker: available ? null : (typeof ga4?.note === 'string' ? ga4.note : blocker),
  };
}

function buildHushhTechGa4SourceCard(summary: Record<string, unknown>) {
  const traffic = asRecord(summary.traffic);
  const overview = asRecord(traffic?.overview) ?? {};
  const available = Boolean(traffic?.available);
  return {
    key: 'ga4',
    label: 'GA4',
    status: available ? 'delayed' : 'waiting',
    stateClass: sourceStateClass(available ? 'delayed' : 'waiting'),
    source: publicGa4SourceLabel(traffic?.source ?? 'ga4-data-api'),
    freshness: {
      generatedAt: String(summary.generatedAt ?? new Date().toISOString()),
      expectedLagSeconds: 86_400,
    },
    metrics: [
      sourceMetric('active_7_day_users', '7d Active Users', overview.active7DayUsers),
      sourceMetric('sessions', 'Sessions', overview.sessions),
      sourceMetric('page_views', 'Page Views', overview.screenPageViews),
      sourceMetric('new_users', 'New Users', overview.newUsers),
    ],
    sections: [
      {
        key: 'realtime',
        label: 'Realtime',
        status: overview.realtimeActiveUsers == null ? 'waiting' : 'live',
        stateClass: sourceStateClass(overview.realtimeActiveUsers == null ? 'waiting' : 'live'),
        source: 'GA4 realtime',
        freshness: {
          generatedAt: String(summary.generatedAt ?? new Date().toISOString()),
          expectedLagSeconds: 60,
        },
        metrics: [
          sourceMetric('active_users', 'Active Users', overview.realtimeActiveUsers),
        ],
        blocker: overview.realtimeActiveUsers == null ? 'Realtime GA4 is not exposed by the HushhTech public summary yet.' : null,
      },
      {
        key: 'last_24_hours',
        label: 'Last 24 Hours',
        status: available ? 'delayed' : 'waiting',
        stateClass: sourceStateClass(available ? 'delayed' : 'waiting'),
        source: 'GA4 processed report',
        freshness: {
          generatedAt: String(summary.generatedAt ?? new Date().toISOString()),
          expectedLagSeconds: 86_400,
        },
        metrics: [
          sourceMetric('users', 'Users', overview.active1DayUsers),
          sourceMetric('sessions', 'Sessions', overview.sessions),
          sourceMetric('page_views', 'Page Views', overview.screenPageViews),
          sourceMetric('new_users', 'New Users', overview.newUsers),
        ],
        blocker: available ? null : String(traffic?.note ?? 'Last 24 hours GA4 data is waiting.'),
      },
      {
        key: 'last_7_days',
        label: 'Last 7 Days',
        status: available ? 'delayed' : 'waiting',
        stateClass: sourceStateClass(available ? 'delayed' : 'waiting'),
        source: 'GA4 processed report',
        freshness: {
          generatedAt: String(summary.generatedAt ?? new Date().toISOString()),
          expectedLagSeconds: 86_400,
        },
        metrics: [
          sourceMetric('users', 'Users', overview.active7DayUsers),
          sourceMetric('sessions', 'Sessions', overview.sessions),
          sourceMetric('page_views', 'Page Views', overview.screenPageViews),
          sourceMetric('new_users', 'New Users', overview.newUsers),
        ],
        blocker: available ? null : String(traffic?.note ?? 'Last 7 days GA4 data is waiting.'),
      },
      {
        key: 'selected_total',
        label: 'Selected Total',
        status: available ? 'delayed' : 'waiting',
        stateClass: sourceStateClass(available ? 'delayed' : 'waiting'),
        source: 'GA4 selected range',
        freshness: {
          generatedAt: String(summary.generatedAt ?? new Date().toISOString()),
          expectedLagSeconds: 86_400,
        },
        metrics: [
          sourceMetric('users', 'Users', overview.active7DayUsers),
          sourceMetric('sessions', 'Sessions', overview.sessions),
          sourceMetric('page_views', 'Page Views', overview.screenPageViews),
          sourceMetric('new_users', 'New Users', overview.newUsers),
        ],
        blocker: available ? null : String(traffic?.note ?? 'Selected range GA4 data is waiting.'),
      },
    ],
    blocker: available ? null : String(traffic?.note ?? 'GA4 Data API is waiting or returned no traffic rows.'),
  };
}

function buildHushhTechEventsSourceCard(summary: Record<string, unknown>) {
  const supabase = asRecord(summary.supabase);
  const totals = asRecord(supabase?.rangeTotals) ?? {};
  const available = Boolean(supabase);
  return {
    key: 'product_events',
    label: 'DB / Product Events',
    status: available ? 'live' : 'waiting',
    stateClass: sourceStateClass(available ? 'live' : 'waiting'),
    source: publicProductEventsSourceLabel('HushhTech'),
    freshness: {
      generatedAt: typeof supabase?.generatedAt === 'string' ? supabase.generatedAt : new Date().toISOString(),
      expectedLagSeconds: null,
    },
    metrics: [
      sourceMetric('total_users', 'Total Users', totals.totalUsers),
      sourceMetric('new_users', 'New Users', totals.newUsers),
      sourceMetric('active_users', 'Active Users', totals.activeUsers),
      sourceMetric('analytics_events', 'Events', totals.analyticsEvents),
    ],
    blocker: available ? null : 'HushhTech Supabase database aggregates are unavailable.',
  };
}

function buildHushhTechSourceCards(summary: Record<string, unknown>) {
  return [
    buildSearchConsoleSourceCard(asRecord(summary.searchPerformance), 'hushhtech Search Console'),
    buildHushhTechGa4SourceCard(summary),
    buildHushhTechEventsSourceCard(summary),
  ];
}

function hushhAiGa4SourceLabel(): string {
  if (HUSHH_AI_GA4_PROPERTY_ID) return `properties/${HUSHH_AI_GA4_PROPERTY_ID}`;
  if (HUSHH_AI_GA4_PROJECT && HUSHH_AI_GA4_DATASET) return `${HUSHH_AI_GA4_PROJECT}.${HUSHH_AI_GA4_DATASET}`;
  return 'not_configured';
}

function buildHushhAiProductEvents(fetchedAt: string): Record<string, unknown> {
  return {
    source: 'hushh-ai-db-status',
    available: false,
    status: 'not_configured',
    generatedAt: fetchedAt,
    metrics: [],
    note: 'Hushh AI DB aggregate source is not configured in metrics.hushh.ai yet.',
  };
}

function buildHushhAiSourceCards(
  searchConsole: Record<string, unknown> | null,
  ga4: Record<string, unknown> | null,
  productEvents: Record<string, unknown> | null,
) {
  const eventsAvailable = Boolean(productEvents?.available);
  const eventsStatus = eventsAvailable ? 'live' : String(productEvents?.status ?? 'waiting');
  return [
    buildSearchConsoleSourceCard(searchConsole, 'hushh.ai Search Console'),
    buildGa4SourceCard(
      ga4,
      hushhAiGa4SourceLabel(),
      'Hushh AI GA4 source is not configured in metrics.hushh.ai yet.',
    ),
    {
      key: 'product_events',
      label: 'DB / Product Events',
      status: eventsStatus,
      stateClass: sourceStateClass(eventsStatus),
      source: publicProductEventsSourceLabel('Hushh AI'),
      freshness: {
        generatedAt: typeof productEvents?.generatedAt === 'string' ? productEvents.generatedAt : new Date().toISOString(),
        expectedLagSeconds: null,
      },
      metrics: [],
      blocker: eventsAvailable ? null : String(productEvents?.note ?? 'Hushh AI product events are not ingested into the dashboard yet.'),
    },
  ];
}

function kaiFeedMetric(rows: Record<string, unknown>[], group: string, name: string): number {
  const row = latestRowsForProductGroup(rows, group).find((item) => item.metric_name === name);
  return toNumber(row?.metric_count ?? row?.metric_value);
}

function latestRowsForProductGroup(rows: Record<string, unknown>[], group: string): Record<string, unknown>[] {
  const groupRows = rows.filter((row) => row.metric_group === group);
  const dated = groupRows.filter((row) => timestampString(row.metric_date) || typeof row.metric_date === 'string');
  const latestDate = dated
    .map((row) => timestampString(row.metric_date) ?? String(row.metric_date ?? ''))
    .filter(Boolean)
    .sort()
    .at(-1);
  return latestDate
    ? groupRows.filter((row) => (timestampString(row.metric_date) ?? String(row.metric_date ?? '')) === latestDate)
    : groupRows;
}

function buildKaiEventsSourceCard(uatRows: Record<string, unknown>[], fetchedAt: string) {
  const status = buildKaiFeedStatus(uatRows);
  const available = uatRows.length > 0;
  return {
    key: 'product_events',
    label: 'DB / Product Events',
    status: available ? 'live' : 'waiting',
    stateClass: sourceStateClass(available ? 'live' : 'waiting'),
    source: publicProductEventsSourceLabel('Kai UAT'),
    freshness: {
      generatedAt: status.asOfTimestamp ?? fetchedAt,
      expectedLagSeconds: 86_400,
    },
    metrics: [
      sourceMetric('dau', 'DAU', kaiFeedMetric(uatRows, 'summary', 'current_dau')),
      sourceMetric('wau', 'WAU', kaiFeedMetric(uatRows, 'summary', 'current_wau')),
      sourceMetric('sessions', 'Sessions', kaiFeedMetric(uatRows, 'summary', 'current_sessions')),
      sourceMetric('events', 'Events', kaiFeedMetric(uatRows, 'summary', 'current_total_events')),
    ],
    blocker: available ? null : 'Kai UAT public dashboard feed is unavailable.',
  };
}

function buildKaiSourceCards(
  searchConsole: Record<string, unknown> | null,
  uatGa4: Record<string, unknown> | null,
  uatRows: Record<string, unknown>[],
  fetchedAt: string,
) {
  return [
    buildSearchConsoleSourceCard(searchConsole, 'Kai Search Console'),
    buildGa4SourceCard(
      uatGa4,
      `${KAI_GA4_PROJECT}.${KAI_GA4_DATASET}`,
      'Kai UAT GA4 export is waiting or unavailable.',
    ),
    buildKaiEventsSourceCard(uatRows, fetchedAt),
  ];
}

async function fetchHushhTechSupabaseSummary(range: HushhAiDateRange): Promise<DataResult<Record<string, unknown>>> {
  if (!HUSHHTECH_SUPABASE_ACCESS_TOKEN) {
    return { data: null, error: 'HUSHHTECH_SUPABASE_ACCESS_TOKEN is not configured' };
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
    const res = await fetch(`https://api.supabase.com/v1/projects/${HUSHHTECH_SUPABASE_PROJECT_REF}/database/query`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${HUSHHTECH_SUPABASE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const message = `HushhTech Supabase metrics returned ${res.status}`;
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
        sourceProjectRef: HUSHHTECH_SUPABASE_PROJECT_REF,
        sourceProjectName: 'hushhtech',
        sourceDatabaseName: 'Hush AI',
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
    console.error('HushhTech Supabase metrics failed:', message);
    return { data: null, error: message };
  }
}

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

app.get('/api/analytics/kai/uat', async (_req, res) => {
  const result = await queryBigQuery(BQ_UAT_PROJECT, BQ_UAT_DATASET, BQ_UAT_VIEW);
  res.status(result.error ? 502 : 200).json(sanitizePublicPayload({
    environment: 'uat',
    rows: result.rows,
    error: result.error,
    fetchedAt: new Date().toISOString(),
  }));
});

app.get('/api/analytics/kai/production', async (_req, res) => {
  const result = await queryBigQuery(BQ_PROD_PROJECT, BQ_PROD_DATASET, BQ_PROD_VIEW);
  res.status(result.error ? 502 : 200).json(sanitizePublicPayload({
    environment: 'production',
    rows: result.rows,
    error: result.error,
    fetchedAt: new Date().toISOString(),
  }));
});

app.get('/api/analytics/hushhtech', async (req, res) => {
  const hushhTechRange = parseHushhTechDateRange(req.query as Record<string, unknown>);
  const result = await fetchHushhTechAnalytics(hushhTechRange);
  res.status(result.error ? 502 : 200).json(sanitizePublicPayload({
    platform: 'hushhtech.com',
    data: result.data,
    error: result.error,
    fetchedAt: new Date().toISOString(),
  }));
});

app.get('/api/analytics/kai/ga4', async (_req, res) => {
  const result = await fetchKaiGa4Summary();
  res.status(result.error && !result.data ? 502 : 200).json(sanitizePublicPayload({
    platform: 'kai.hushh.ai',
    data: result.data,
    error: result.error,
    fetchedAt: new Date().toISOString(),
  }));
});

app.get('/api/analytics/kai', async (req, res) => {
  const kaiRange = parseKaiDateRange(req.query as Record<string, unknown>);
  const [production, uat, uatGa4, productionGa4, gcp, searchConsole] = await Promise.all([
    queryBigQuery(BQ_PROD_PROJECT, BQ_PROD_DATASET, BQ_PROD_VIEW),
    queryBigQuery(BQ_UAT_PROJECT, BQ_UAT_DATASET, BQ_UAT_VIEW),
    fetchKaiGa4Summary(kaiRange),
    fetchKaiGa4ExportSummary(KAI_PROD_GA4_PROJECT, KAI_PROD_GA4_DATASET, kaiRange, true),
    fetchCloudRunSummary(KAI_PROD_GCP_PROJECT, KAI_PROD_CLOUD_RUN_SERVICE, kaiRange, 'Kai production'),
    fetchKaiSearchConsole(kaiRange),
  ]);
  const fetchedAt = new Date().toISOString();
  const error = [production.error, uat.error, uatGa4.error, productionGa4.error, gcp.error, searchConsole.error].filter(Boolean).join('; ') || null;
  res.status(error && production.rows.length === 0 && !gcp.data && !productionGa4.data ? 502 : 200).json(sanitizePublicPayload({
    platform: 'kai.hushh.ai',
    data: {
      productionFeed: {
        rows: production.rows,
        status: buildKaiFeedStatus(production.rows),
      },
      uatFeed: {
        rows: uat.rows,
        status: buildKaiFeedStatus(uat.rows),
      },
      uatGa4: uatGa4.data,
      productionGa4: productionGa4.data,
      searchConsole: searchConsole.data,
      gcp: gcp.data,
      freshness: buildKaiFreshness(fetchedAt, production.rows, gcp.data, productionGa4.data),
      sourceCards: buildKaiSourceCards(searchConsole.data, uatGa4.data, uat.rows, fetchedAt),
    },
    error,
    fetchedAt,
  }));
});

app.get('/api/analytics/hushhai', async (req, res) => {
  const hushhAiRange = parseHushhAiDateRange(req.query as Record<string, unknown>);
  const [gcp, searchConsole, ga4] = await Promise.all([
    fetchHushhAiCloudRun(hushhAiRange),
    fetchHushhAiSearchConsole(hushhAiRange),
    fetchHushhAiGa4Summary(hushhAiRange),
  ]);
  const error = [gcp.error, searchConsole.error, ga4.error].filter(Boolean).join('; ') || null;
  const fetchedAt = new Date().toISOString();
  const productEvents = buildHushhAiProductEvents(fetchedAt);
  res.status(error && !gcp.data && !searchConsole.data ? 502 : 200).json(sanitizePublicPayload({
    platform: 'hushh.ai',
    data: {
      gcp: gcp.data,
      searchConsole: searchConsole.data,
      ga4: ga4.data,
      productEvents,
      freshness: buildHushhAiFreshness(fetchedAt, gcp.data, searchConsole.data, ga4.data, productEvents),
      sourceCards: buildHushhAiSourceCards(searchConsole.data, ga4.data, productEvents),
    },
    error,
    fetchedAt,
  }));
});

app.get('/api/analytics/all', async (req, res) => {
  const hushhAiRange = parseHushhAiDateRange(req.query as Record<string, unknown>);
  const kaiRange = parseKaiDateRange(req.query as Record<string, unknown>);
  const hushhTechRange = parseHushhTechDateRange(req.query as Record<string, unknown>);
  const [uat, production, kaiGa4, kaiProductionGa4, kaiProductionGcp, kaiSearchConsole, hushhAiGcp, hushhAiSearchConsole, hushhAiGa4, hushhTech] = await Promise.all([
    queryBigQuery(BQ_UAT_PROJECT, BQ_UAT_DATASET, BQ_UAT_VIEW),
    queryBigQuery(BQ_PROD_PROJECT, BQ_PROD_DATASET, BQ_PROD_VIEW),
    fetchKaiGa4Summary(kaiRange),
    fetchKaiGa4ExportSummary(KAI_PROD_GA4_PROJECT, KAI_PROD_GA4_DATASET, kaiRange, true),
    fetchCloudRunSummary(KAI_PROD_GCP_PROJECT, KAI_PROD_CLOUD_RUN_SERVICE, kaiRange, 'Kai production'),
    fetchKaiSearchConsole(kaiRange),
    fetchHushhAiCloudRun(hushhAiRange),
    fetchHushhAiSearchConsole(hushhAiRange),
    fetchHushhAiGa4Summary(hushhAiRange),
    fetchHushhTechAnalytics(hushhTechRange),
  ]);
  const fetchedAt = new Date().toISOString();
  const hushhAiProductEvents = buildHushhAiProductEvents(fetchedAt);
  res.json(sanitizePublicPayload({
    kai: {
      uat: { environment: 'uat', rows: uat.rows, error: uat.error },
      production: { environment: 'production', rows: production.rows, error: production.error },
      ga4: { platform: 'kai.hushh.ai', data: kaiGa4.data, error: kaiGa4.error },
      productionProduct: {
        platform: 'kai.hushh.ai',
        data: {
          productionFeed: {
            rows: production.rows,
            status: buildKaiFeedStatus(production.rows),
          },
          uatFeed: {
            rows: uat.rows,
            status: buildKaiFeedStatus(uat.rows),
          },
          uatGa4: kaiGa4.data,
          productionGa4: kaiProductionGa4.data,
          searchConsole: kaiSearchConsole.data,
          gcp: kaiProductionGcp.data,
          freshness: buildKaiFreshness(fetchedAt, production.rows, kaiProductionGcp.data, kaiProductionGa4.data),
          sourceCards: buildKaiSourceCards(kaiSearchConsole.data, kaiGa4.data, uat.rows, fetchedAt),
        },
        error: [production.error, uat.error, kaiGa4.error, kaiProductionGa4.error, kaiProductionGcp.error, kaiSearchConsole.error].filter(Boolean).join('; ') || null,
      },
    },
    hushhAi: {
      platform: 'hushh.ai',
      data: {
        gcp: hushhAiGcp.data,
        searchConsole: hushhAiSearchConsole.data,
        ga4: hushhAiGa4.data,
        productEvents: hushhAiProductEvents,
        freshness: buildHushhAiFreshness(fetchedAt, hushhAiGcp.data, hushhAiSearchConsole.data, hushhAiGa4.data, hushhAiProductEvents),
        sourceCards: buildHushhAiSourceCards(hushhAiSearchConsole.data, hushhAiGa4.data, hushhAiProductEvents),
      },
      error: [hushhAiGcp.error, hushhAiSearchConsole.error, hushhAiGa4.error].filter(Boolean).join('; ') || null,
    },
    hushhTech: { platform: 'hushhtech.com', data: hushhTech.data, error: hushhTech.error },
    fetchedAt,
  }));
});

app.get('/api/health', (_req, res) => {
  res.json(sanitizePublicPayload({
    status: 'ok',
    uptime: process.uptime(),
    config: {
      bqUat: `${BQ_UAT_PROJECT}.${BQ_UAT_DATASET}.${BQ_UAT_VIEW}`,
      bqProd: `${BQ_PROD_PROJECT}.${BQ_PROD_DATASET}.${BQ_PROD_VIEW}`,
      bqJobProject: BQ_JOB_PROJECT || '(feed project)',
      kaiGa4: `${KAI_GA4_PROJECT}.${KAI_GA4_DATASET}`,
      kaiProductionGa4: `${KAI_PROD_GA4_PROJECT}.${KAI_PROD_GA4_DATASET}`,
      kaiProductionCloudRun: `${KAI_PROD_GCP_PROJECT}/${KAI_PROD_CLOUD_RUN_SERVICE}`,
      kaiSearchConsole: `${KAI_SEARCH_PROJECT}.${KAI_SEARCH_DATASET}`,
      kaiSearchConsoleFallback: `${KAI_SEARCH_FALLBACK_PROJECT}.${KAI_SEARCH_FALLBACK_DATASET}`,
      kaiSearchConsoleSiteUrl: KAI_SEARCH_CONSOLE_SITE_URL,
      hushhAiCloudRun: `${HUSHH_AI_GCP_PROJECT}/${HUSHH_AI_CLOUD_RUN_SERVICE}`,
      hushhAiSearchConsole: `${HUSHH_AI_SEARCH_PROJECT}.${HUSHH_AI_SEARCH_DATASET}`,
      hushhAiSearchConsoleFallback: `${HUSHH_AI_SEARCH_FALLBACK_PROJECT}.${HUSHH_AI_SEARCH_FALLBACK_DATASET}`,
      hushhAiSearchConsoleSiteUrl: HUSHH_AI_SEARCH_CONSOLE_SITE_URL,
      hushhAiGa4: hushhAiGa4SourceLabel(),
      hushhAiGa4MeasurementId: HUSHH_AI_GA4_MEASUREMENT_ID,
      hushhAiGa4Impersonation: HUSHH_AI_GA4_IMPERSONATE_SERVICE_ACCOUNT || '(direct)',
      hushhTechEndpoint: buildHushhTechUrl(),
      hushhTechCloudRun: `${HUSHHTECH_GCP_PROJECT}/${HUSHHTECH_CLOUD_RUN_SERVICE}`,
      hushhTechSearchConsole: `${HUSHHTECH_SEARCH_PROJECT}.${HUSHHTECH_SEARCH_DATASET}`,
      hushhTechSearchConsoleFallback: `${HUSHHTECH_SEARCH_FALLBACK_PROJECT}.${HUSHHTECH_SEARCH_FALLBACK_DATASET}`,
      hushhTechSearchConsoleSiteUrl: HUSHHTECH_SEARCH_CONSOLE_SITE_URL,
      hushhTechSupabase: HUSHHTECH_SUPABASE_PROJECT_REF,
    },
  }));
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
  console.log(`  Kai Prod GA4:  ${KAI_PROD_GA4_PROJECT}.${KAI_PROD_GA4_DATASET}`);
  console.log(`  Kai GCP:       ${KAI_PROD_GCP_PROJECT}/${KAI_PROD_CLOUD_RUN_SERVICE}`);
  console.log(`  Kai GSC Fallback: ${KAI_SEARCH_FALLBACK_PROJECT}.${KAI_SEARCH_FALLBACK_DATASET}`);
  console.log(`  Hush AI GCP:   ${HUSHH_AI_GCP_PROJECT}/${HUSHH_AI_CLOUD_RUN_SERVICE}`);
  console.log(`  Hush AI GA4:   ${hushhAiGa4SourceLabel()} (${HUSHH_AI_GA4_MEASUREMENT_ID})`);
  console.log(`  Hush AI GA4 SA:${HUSHH_AI_GA4_IMPERSONATE_SERVICE_ACCOUNT || '(direct runtime service account)'}`);
  console.log(`  Hush AI GSC Fallback: ${HUSHH_AI_SEARCH_FALLBACK_PROJECT}.${HUSHH_AI_SEARCH_FALLBACK_DATASET}`);
  console.log(`  hushhtech.com: ${buildHushhTechUrl()}`);
  console.log(`  HushhTech GCP: ${HUSHHTECH_GCP_PROJECT}/${HUSHHTECH_CLOUD_RUN_SERVICE}`);
  console.log(`  HushhTech GSC: ${HUSHHTECH_SEARCH_PROJECT}.${HUSHHTECH_SEARCH_DATASET}`);
  console.log(`  HushhTech GSC Fallback: ${HUSHHTECH_SEARCH_FALLBACK_PROJECT}.${HUSHHTECH_SEARCH_FALLBACK_DATASET}`);
  console.log(`  HushhTech DB:  ${HUSHHTECH_SUPABASE_PROJECT_REF}`);
});
