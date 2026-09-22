/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Express server for the Hussh Matrix Dashboard.
 * Proxies BigQuery public feed queries and the hushhtech.com analytics endpoint
 * so the React SPA can consume real metrics without exposing credentials.
 */

import { config as loadDotenvFile } from 'dotenv';
import { execFile } from 'node:child_process';
import { sign as cryptoSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import express from 'express';
import path from 'path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'url';

// `.env.local` (git-ignored, per-developer) overrides `.env` (shared
// defaults, if present) -- Vite's own convention via `loadEnv`, which the
// frontend already relies on. Plain `dotenv/config` only loads `.env`, so
// this repo's own documented "cp .env.example .env.local" setup step did
// nothing on the backend until now.
loadDotenvFile({ path: '.env' });
loadDotenvFile({ path: '.env.local', override: true });

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

const BQ_JOB_PROJECT = process.env.BQ_JOB_PROJECT || 'hushh-pda';
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
// one.hushh.ai reports into the same GA4 property as the rest of the webapp, so
// it defaults to the Kai production export rather than introducing a second
// dataset. Overridable purely so a One-specific property can be split out later
// without a code change.
const ONE_APP_GA4_PROJECT = process.env.ONE_APP_GA4_PROJECT || KAI_PROD_GA4_PROJECT;
const ONE_APP_GA4_DATASET = process.env.ONE_APP_GA4_DATASET || KAI_PROD_GA4_DATASET;
const ONE_APP_GA4_WINDOW_DAYS = parseInt(process.env.ONE_APP_GA4_WINDOW_DAYS || '30', 10);
const ONE_APP_UAT_GA4_PROJECT = process.env.ONE_APP_UAT_GA4_PROJECT || KAI_GA4_PROJECT;
const ONE_APP_UAT_GA4_DATASET = process.env.ONE_APP_UAT_GA4_DATASET || KAI_GA4_DATASET;
const HUSHH_AI_GCP_PROJECT = process.env.HUSHH_AI_GCP_PROJECT || 'hushh-ai-prod';
const HUSHH_AI_CLOUD_RUN_SERVICE = process.env.HUSHH_AI_CLOUD_RUN_SERVICE || 'hushh-ai-website';
const HUSHH_AI_METRICS_WINDOW_DAYS = parseInt(process.env.HUSHH_AI_METRICS_WINDOW_DAYS || '7', 10);
// App Store Connect — Hushh 1 iOS. Official Analytics Reports API only; see the
// "App Store Connect" section below. Credentials are optional: when absent the
// dashboard reports `App Store Connect analytics not connected` rather than a
// fabricated number.
const APP_STORE_CONNECT_KEY_ID = process.env.APP_STORE_CONNECT_KEY_ID || '';
const APP_STORE_CONNECT_ISSUER_ID = process.env.APP_STORE_CONNECT_ISSUER_ID || '';
/**
 * The .p8 private key, resolved once at startup. `APP_STORE_CONNECT_PRIVATE_KEY_PATH`
 * (read straight off disk) takes precedence over `APP_STORE_CONNECT_PRIVATE_KEY`
 * (inline PEM, real or "\n"-escaped) when both are set -- reading from a path
 * outside the repo means the key never has to sit in `.env.local` at all. A
 * read failure is logged without the path's contents and leaves the key
 * empty, so `appStoreConnectConfigured()` correctly reports "not connected"
 * instead of crashing the server over a bad path.
 */
function resolveAppStoreConnectPrivateKey(): string {
  const inlineKey = (process.env.APP_STORE_CONNECT_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const keyPath = process.env.APP_STORE_CONNECT_PRIVATE_KEY_PATH || '';
  if (!keyPath) return inlineKey;
  try {
    return readFileSync(keyPath, 'utf8');
  } catch (err) {
    console.error(
      `App Store Connect: could not read APP_STORE_CONNECT_PRIVATE_KEY_PATH (${err instanceof Error ? err.message : String(err)})`,
    );
    return inlineKey;
  }
}
const APP_STORE_CONNECT_PRIVATE_KEY = resolveAppStoreConnectPrivateKey();
const APP_STORE_CONNECT_APP_ID = process.env.APP_STORE_CONNECT_APP_ID || '6757718917';
const APP_STORE_CONNECT_WINDOW_DAYS = parseInt(process.env.APP_STORE_CONNECT_WINDOW_DAYS || '90', 10);
/**
 * Org-level growth reporting.
 *
 * Every product on this dashboard was previously measured in its own silo, so
 * nothing answered organisation-shaped questions: how many people we have
 * picked up in total, what an active person costs us, whether the website
 * feeds the app, and whether the measurement itself is healthy.
 */
const BILLING_PROJECT = process.env.BILLING_PROJECT || 'hushh-pda';
const BILLING_DATASET = process.env.BILLING_DATASET || 'billing';
const BILLING_TABLE =
  process.env.BILLING_TABLE || 'gcp_billing_export_v1_014D7F_FD970D_D2459E';

/**
 * GCP project to product, and to whether the spend serves real users.
 *
 * The production/non-production split is the point. Spend on an environment no
 * customer touches is a different fact from spend on serving people, and a
 * single "cloud bill" number hides which one is growing.
 */
const COST_PROJECT_MAP: Array<{ project: string; key: string; product: string; production: boolean }> = [
  { project: 'hushh-pda', key: 'one', product: 'Agent One', production: true },
  { project: 'hushh-pda-uat', key: 'one', product: 'Agent One', production: false },
  { project: 'hushh-pda-dev', key: 'one', product: 'Agent One', production: false },
  { project: 'hushone-app', key: 'one', product: 'Agent One', production: false },
  { project: 'hushh-ai-prod', key: 'hushh_ai', product: 'hushh.ai', production: true },
  { project: 'hushh-ai-uat', key: 'hushh_ai', product: 'hushh.ai', production: false },
  { project: 'hushh-tech-prod', key: 'fund', product: 'Hussh fund', production: true },
  { project: 'hushh-tech-uat', key: 'fund', product: 'Hussh fund', production: false },
];

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
const KAI_PROD_SEARCH_CONSOLE_PAGE_FILTER_REGEX =
  process.env.KAI_PROD_SEARCH_CONSOLE_PAGE_FILTER_REGEX || '^https://kai\\.hushh\\.ai(/|$)';
const KAI_UAT_SEARCH_CONSOLE_PAGE_FILTER_REGEX =
  process.env.KAI_UAT_SEARCH_CONSOLE_PAGE_FILTER_REGEX || '^https://uat\\.kai\\.hushh\\.ai(/|$)';
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

// Keep upstream analytics calls from being repeated by every browser refresh.
// Clients still receive `no-store`; this is a short-lived, aggregate-only
// process cache keyed by the complete URL, including the selected date range.
const ANALYTICS_RESPONSE_CACHE_TTL_MS = 30_000;
const ANALYTICS_RESPONSE_CACHE_MAX_ENTRIES = 100;
const analyticsResponseCache = new Map<string, { expiresAt: number; body: unknown }>();

app.use('/api/analytics', (req, res, next) => {
  if (req.method !== 'GET') return next();
  const key = req.originalUrl;
  const cached = analyticsResponseCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    res.set('X-Metrics-Cache', 'HIT');
    return res.json(cached.body);
  }
  if (cached) analyticsResponseCache.delete(key);

  const sendJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (res.statusCode < 500) {
      if (analyticsResponseCache.size >= ANALYTICS_RESPONSE_CACHE_MAX_ENTRIES) {
        const oldestKey = analyticsResponseCache.keys().next().value as string | undefined;
        if (oldestKey) analyticsResponseCache.delete(oldestKey);
      }
      analyticsResponseCache.set(key, {
        expiresAt: Date.now() + ANALYTICS_RESPONSE_CACHE_TTL_MS,
        body,
      });
      res.set('X-Metrics-Cache', 'MISS');
    }
    return sendJson(body);
  }) as typeof res.json;
  return next();
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
  // Public analytics is aggregate-only. These fields must never cross the
  // API boundary even if an upstream integration accidentally returns them.
  'identities',
  'featureUserIdentities',
  'userPseudoId',
  'user_pseudo_id',
  'userId',
  'user_id',
  'displayName',
  'boundEmail',
  'email',
  'phoneNumber',
  'phone',
  'paramName',
  'paramPhone',
]);
const PUBLIC_UNSAFE_VALUE_PATTERN = /analytics_\d+|searchconsole_|_search_console_api|hushh-ai-prod|hushh-pda(?:-uat)?|ibsisfnjxeowvdtvgzff/i;
const PUBLIC_EMAIL_VALUE_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PUBLIC_PHONE_VALUE_PATTERN = /(?:^|\s)\+\d[\d\s().-]{8,}\d(?:$|\s)/;

function sanitizePublicPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizePublicPayload(item));
  if (typeof value === 'string') {
    if (PUBLIC_EMAIL_VALUE_PATTERN.test(value) || PUBLIC_PHONE_VALUE_PATTERN.test(value)) return '[redacted]';
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

  return buildDateRange(start, end);
}

function buildDateRange(start: Date, end: Date): HushhAiDateRange {
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

function utcToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** The trailing `days` days ending today, inclusive. */
function trailingDateRange(days: number): HushhAiDateRange {
  const end = utcToday();
  return buildDateRange(addUtcDays(end, -(days - 1)), end);
}

// The earliest day any organisation-level feed has data: the One app GA4
// export begins 2026-05-01 (billing follows on 2026-06-01). "All time" on the
// comparison tab starts here rather than at some epoch so the label is honest
// about what the number covers. Not passed through parseProductDateRange
// because that caps at MAX_HUSHH_AI_RANGE_DAYS, which is the right ceiling for
// an interactive range and the wrong one for this.
const ORG_ALL_TIME_START_DATE = process.env.ORG_ALL_TIME_START_DATE || '2026-05-01';

function allTimeDateRange(): HushhAiDateRange {
  const start = parseUtcDate(ORG_ALL_TIME_START_DATE) ?? (parseUtcDate('2026-05-01') as Date);
  return buildDateRange(start, utcToday());
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

function parseOneAppDateRange(query: Record<string, unknown>): HushhAiDateRange {
  return parseProductDateRange(query, 'one', ONE_APP_GA4_WINDOW_DAYS);
}

function parseAppStoreConnectDateRange(query: Record<string, unknown>): HushhAiDateRange {
  return parseProductDateRange(query, 'app_store_connect', APP_STORE_CONNECT_WINDOW_DAYS);
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
  range?: HushhAiDateRange,
): Promise<Record<string, unknown>[]> {
  const queryJobProject = BQ_JOB_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || projectId;
  const dateFilter = range
    ? `WHERE metric_date IS NULL OR DATE(metric_date) BETWEEN DATE(${sqlStringLiteral(range.startDate)}) AND DATE(${sqlStringLiteral(range.endDate)})`
    : '';
  const query = `
    SELECT *
    FROM \`${projectId}.${dataset}.${view}\`
    ${dateFilter}
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
  range?: HushhAiDateRange,
): Promise<BigQueryFeedResult> {
  try {
    const { BigQuery } = await import('@google-cloud/bigquery');
    const bq = new BigQuery({ projectId: BQ_JOB_PROJECT || projectId });
    const dateFilter = range
      ? `WHERE metric_date IS NULL OR DATE(metric_date) BETWEEN DATE(${sqlStringLiteral(range.startDate)}) AND DATE(${sqlStringLiteral(range.endDate)})`
      : '';
    const query = `
      SELECT *
      FROM \`${projectId}.${dataset}.${view}\`
      ${dateFilter}
      ORDER BY metric_group, metric_name, metric_date
    `;
    const [rows] = await bq.query({ query, location: 'US' });
    return { rows: rows as Record<string, unknown>[], error: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`BigQuery query failed for ${projectId}.${dataset}.${view}:`, message);
    if (BQ_CLI_FALLBACK) {
      try {
        const rows = await queryBigQueryWithCli(projectId, dataset, view, range);
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
  const usePageTable = Boolean(config.pageFilterRegex && tableNames.has('page_daily'));
  if (!tableNames.has('site_daily') && !usePageTable) {
    return {
      data: unavailableProductSearchConsole(
        config,
        range,
        `${config.productLabel} Search Console fallback is configured, but the required daily aggregate table has not been created or populated yet. ${officialExportNote}`,
      ),
      error: null,
    };
  }

  const dateFilter = `data_date BETWEEN DATE '${range.startDate}' AND DATE '${range.endDate}'`;
  const searchTypeFilter = `LOWER(search_type) = LOWER(${sqlStringLiteral(config.searchType)})`;
  const siteFilter = `site_url = ${sqlStringLiteral(config.siteUrl)}`;
  const pageFilter = usePageTable && config.pageFilterRegex
    ? `AND REGEXP_CONTAINS(page_url, ${sqlRawStringLiteral(config.pageFilterRegex)})`
    : '';
  const sourceTable = usePageTable ? 'page_daily' : 'site_daily';
  const baseWhereClause = `${dateFilter} AND ${searchTypeFilter} AND ${siteFilter}`;
  const whereClause = `${baseWhereClause} ${pageFilter}`;
  const weightedPosition = 'SAFE_DIVIDE(SUM(average_position * impressions), SUM(impressions))';
  const aggregateQuery = `
    SELECT
      SUM(clicks) AS clicks,
      SUM(impressions) AS impressions,
      SAFE_DIVIDE(SUM(clicks), SUM(impressions)) AS ctr,
      ${weightedPosition} AS averagePosition
    FROM ${datasetRef}.${sourceTable}
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
    FROM ${datasetRef}.${sourceTable}
    WHERE ${whereClause}
    GROUP BY date
    ORDER BY date
  `;
  const dimensionQuery = (table: string, field: string, alias: string) => {
    if (!tableNames.has(table)) return null;
    if (config.pageFilterRegex && table !== 'page_daily') return null;
    const dimensionWhereClause = table === 'page_daily' ? whereClause : baseWhereClause;
    return `
      SELECT
        ${field} AS ${alias},
        SUM(clicks) AS clicks,
        SUM(impressions) AS impressions,
        SAFE_DIVIDE(SUM(clicks), SUM(impressions)) AS ctr,
        ${weightedPosition} AS averagePosition
      FROM ${datasetRef}.${table}
      WHERE ${dimensionWhereClause}
      GROUP BY ${alias}
      ORDER BY impressions DESC
      LIMIT ${config.rowLimit}
    `;
  };

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

const HUSHHTECH_GA4_ZERO_TRAFFIC_WARNING =
  'HushhTech GA4 Data API is reachable, but processed traffic is all zero for this window. Treat processed GA4 traffic as unverified until the HushhTech web tag/property is confirmed.';

function hushhTechGa4NeedsVerification(traffic: Record<string, unknown> | null | undefined): boolean {
  if (!traffic?.available) return false;
  const overview = asRecord(traffic.overview) ?? {};
  const processedSignals = [
    overview.active1DayUsers,
    overview.active7DayUsers,
    overview.sessions,
    overview.screenPageViews,
    overview.newUsers,
  ].map((value) => metricValue(value) ?? 0);
  return processedSignals.every((value) => value === 0);
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
  if (hushhTechGa4NeedsVerification(asRecord(summary.traffic))) {
    warnings.add(HUSHHTECH_GA4_ZERO_TRAFFIC_WARNING);
    const traffic = asRecord(summary.traffic) ?? {};
    const existingNote = typeof traffic.note === 'string' && traffic.note.trim() ? traffic.note.trim() : null;
    summary.traffic = {
      ...traffic,
      processedMetricsVerified: false,
      note: existingNote ? `${existingNote} ${HUSHHTECH_GA4_ZERO_TRAFFIC_WARNING}` : HUSHHTECH_GA4_ZERO_TRAFFIC_WARNING,
    };
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

function last24HourUtcRange(now = new Date()): HushhAiDateRange {
  const start = new Date(now.getTime() - 86_400_000);
  return {
    startDate: formatUtcDate(start),
    endDate: formatUtcDate(now),
    days: 1,
    startTime: start.toISOString(),
    endTime: now.toISOString(),
    windowSeconds: 86_400,
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
      -- GA4 app-instance ids belong to a platform/stream namespace. Prefixing
      -- prevents an opaque id collision between web, iOS and Android from
      -- silently collapsing two devices into one.
      COUNT(DISTINCT CONCAT(COALESCE(platform, 'UNKNOWN'), ':', user_pseudo_id)) AS users,
      -- ga_session_id is a session start timestamp, not a globally unique id.
      -- Counting it alone merges unrelated devices that started in the same
      -- second. A session is the compound device + ga_session_id identity.
      COUNT(DISTINCT CONCAT(
        COALESCE(platform, 'UNKNOWN'), ':', user_pseudo_id, ':',
        CAST((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS STRING)
      )) AS sessions
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
      COUNT(DISTINCT CONCAT(COALESCE(platform, 'UNKNOWN'), ':', user_pseudo_id)) AS users,
      COUNT(DISTINCT CONCAT(
        COALESCE(platform, 'UNKNOWN'), ':', user_pseudo_id, ':',
        CAST((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS STRING)
      )) AS sessions
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
      COUNT(DISTINCT CONCAT(COALESCE(platform, 'UNKNOWN'), ':', user_pseudo_id)) AS users
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
      COUNT(DISTINCT CONCAT(COALESCE(platform, 'UNKNOWN'), ':', user_pseudo_id)) AS users
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

// ---------------------------------------------------------------------------
// one.hushh.ai — the One app: per-agent user behaviour + the One Location funnel
//
// This product is a different lens on the SAME GA4 property as kai.hushh.ai
// (the whole webapp reports into one property), not a new data source. So there
// is no new dataset, no new export, and no new grant beyond what Kai already
// uses — what is new is the segmentation: which agent a person actually used,
// and how far they got in One Location.
// ---------------------------------------------------------------------------

/**
 * The One Location funnel in the order a real person walks it. Rendering is
 * driven by this list rather than by whatever GA4 happens to return, because a
 * funnel sorted by volume is not a funnel — and the existing investor funnel
 * already demonstrates the failure mode, reporting more users at `vault_ready`
 * than at `entered` because that step is emitted app-wide rather than scoped to
 * the journey. Steps absent from the data render as zero instead of collapsing
 * the sequence.
 */
const ONE_LOCATION_FUNNEL_STEPS: Array<{ key: string; label: string }> = [
  { key: 'entered', label: 'Opened One Location' },
  { key: 'auth_started', label: 'Sent to sign-in' },
  { key: 'auth_completed', label: 'Signed in' },
  { key: 'phone_verified', label: 'Phone verified' },
  { key: 'vault_unlocked', label: 'Vault unlocked' },
  { key: 'onboarding_started', label: 'Started onboarding' },
  { key: 'onboarding_completed', label: 'Finished onboarding' },
  { key: 'circle_created', label: 'Created a Circle' },
  { key: 'invite_shared', label: 'Shared an invite' },
  { key: 'first_share_sent', label: 'Sent first location' },
  { key: 'activated', label: 'Activated' },
];

const ONE_LOCATION_BEHAVIOR_FEATURES = [
  { key: 'live_sharing', label: 'Live sharing' },
  { key: 'check_in', label: 'Check-In' },
  { key: 'check_out', label: 'Check-Out' },
  { key: 'sms_safety', label: 'Save My Soul SMS' },
  { key: 'request_location', label: 'Request Location' },
  { key: 'public_sharing', label: 'Public location sharing' },
  { key: 'contact_sync', label: 'Contact sync' },
  { key: 'invitations', label: 'Invitation flow' },
  { key: 'circle_engagement', label: 'Circle engagement' },
] as const;

/**
 * These are independent reach milestones, not a strict nested funnel. People
 * can share directly without syncing contacts or creating a Circle, so forcing
 * the rows to descend would turn valid paths into apparent drop-off.
 */
const ONE_LOCATION_JOURNEY_STEPS = [
  { key: 'location_opened', label: 'Opened One Location', requiresJourneyAction: false },
  { key: 'connect_opened', label: 'Opened Connect', requiresJourneyAction: false },
  { key: 'contact_sync', label: 'Completed contact sync', requiresJourneyAction: false },
  { key: 'invitation_shared', label: 'Shared an invitation', requiresJourneyAction: false },
  { key: 'circle_engaged', label: 'Engaged with a Circle', requiresJourneyAction: false },
  { key: 'request_sent', label: 'Sent a location request', requiresJourneyAction: false },
  { key: 'request_fulfilled', label: 'Request fulfilled', requiresJourneyAction: true },
  { key: 'live_shared', label: 'Shared live location', requiresJourneyAction: false },
  { key: 'check_in', label: 'Completed Check-In', requiresJourneyAction: false },
  { key: 'profile_opened', label: 'Opened Profile', requiresJourneyAction: false },
] as const;

/**
 * The One capability catalogue: which events mean a person deliberately used a
 * capability, and which merely mean the app was running.
 *
 * This replaces a CASE over event-name prefixes. Prefix matching was wrong in
 * ways that flattered the product and could not be seen from the dashboard:
 * `agent_%` matched only the three `agent_pkm_*` reliability events, so "people
 * using Agent chat" was really "devices whose PKM context resolved"; the One
 * Location bucket was 71% `one_location_foreground_retry`, a geolocation
 * failure signal; and the Kai bucket was 78% `market_insights_loaded`, a load
 * health ping.
 *
 * `deliberate` events are user-initiated actions. `background` events are the rest of
 * the capability's traffic -- retries, prefetches, health pings, diagnostics.
 * Both are reported, so the honest number is visible next to the total the
 * dashboard used to show on its own.
 *
 * `instrumented: false` marks a capability that exists in the product but emits
 * no event at all. It renders as "not instrumented" and never as zero: a
 * capability nobody can measure and a capability nobody used are different
 * facts, and only one of them is a product problem.
 *
 * The rows mirror the product's own catalogue in
 * hushh-webapp/lib/onboarding/one-capabilities.ts, using its ids and titles,
 * so this list is what the team calls these agents rather than a parallel
 * naming invented here. "Kai" is gone: that agent is Finance.
 *
 * Event membership is maintained against
 * hushh-webapp/lib/observability/events.ts. An event in neither list is
 * counted nowhere, which is deliberate -- a new event should be classified on
 * purpose rather than absorbed by a prefix.
 *
 * Four product capabilities emit no events at all (Wallet, Calendar, KYC,
 * CRM) and Memory emits only reliability diagnostics. They are listed anyway,
 * marked not instrumented: an agent nobody can measure is a fact worth
 * showing, and leaving them off made the dashboard imply the product had six
 * agents when it has eleven.
 *
 * Sign-up & onboarding is not in the product catalogue -- it is a funnel
 * stage, kept because it is useful and labelled so it cannot be mistaken for
 * an agent.
 */
interface OneCapabilitySpec {
  key: string;
  label: string;
  deliberate: string[];
  background: string[];
  instrumented: boolean;
  /** Why a capability cannot be measured. Shown verbatim in the UI. */
  note?: string;
}

const ONE_CAPABILITIES: OneCapabilitySpec[] = [
  {
    key: 'location',
    label: 'Location',
    deliberate: [
      'one_location_share_confirmed', 'one_location_check_in_completed', 'one_location_check_out_completed',
      'one_location_circle_created', 'one_location_circle_invite_created',
      'one_location_public_link_created', 'one_location_request_sent',
      'one_location_sos_triggered', 'one_location_recommendation_selected',
      'one_location_share_review_opened', 'one_location_visit_rated',
      'one_location_review_handoff_opened', 'one_location_setup_completed',
      'one_location_onboarding_completed', 'one_location_activation_completed',
      'one_location_journey_action', 'one_location_checkin', 'one_location_circle_engagement',
    ],
    // A retry is the app fighting the OS for a fix, and a contact sync is a
    // background job. Neither is somebody using the product.
    background: ['one_location_foreground_retry', 'one_location_contact_signal_synced'],
    instrumented: true,
  },
  {
    key: 'finance',
    label: 'Finance',
    deliberate: [
      'portfolio_viewed', 'recommendation_viewed', 'analysis_stream_started',
      'analysis_stream_terminal_decision', 'import_upload_started',
      'import_save_completed', 'import_parse_completed',
      'one_finance_portfolio_viewed', 'one_finance_analysis_started',
    ],
    background: [
      'market_insights_loaded', 'profile_picks_loaded', 'analysis_stream_error',
      'analysis_stream_aborted', 'import_quality_gate_passed', 'import_quality_gate_failed',
    ],
    instrumented: true,
  },
  {
    key: 'consent',
    label: 'Consent',
    deliberate: [
      'consent_action_submitted', 'consent_action_result',
      'one_consent_preferences_updated', 'one_consent_data_unlocked',
    ],
    // consent_pending_loaded carries load_surface precisely to separate a real
    // screen view from the unlock warm prefetch. It is split on that parameter
    // below rather than listed as deliberate here.
    background: ['consent_pending_loaded'],
    instrumented: true,
  },
  {
    key: 'gmail',
    label: 'Gmail',
    deliberate: [
      'gmail_connect_started', 'gmail_connect_result', 'gmail_sync_requested',
      'gmail_disconnect_result', 'hushh_mail_signin_screen_view',
      'one_gmail_connected', 'one_gmail_receipt_synced',
    ],
    background: ['gmail_receipts_loaded', 'gmail_sync_result'],
    instrumented: true,
  },
  {
    key: 'ria',
    label: 'RIA',
    deliberate: [
      'ria_onboarding_submitted', 'ria_request_created', 'ria_workspace_opened',
      'ria_verification_status_changed', 'persona_switched',
      'one_ria_workspace_visited', 'one_ria_onboarding_completed',
    ],
    background: [],
    instrumented: true,
  },
  {
    key: 'marketplace',
    label: 'Information Marketplace',
    deliberate: ['marketplace_profile_viewed'],
    background: [],
    instrumented: true,
  },
  {
    key: 'memory',
    label: 'Memory',
    deliberate: [],
    // The PKM events are agent-turn reliability diagnostics, not somebody
    // using Memory. Counting them as usage is what made "Agent chat" look
    // like a used capability when nothing measured its use.
    background: [
      'agent_pkm_context_resolved', 'agent_pkm_context_unavailable',
      'agent_pkm_save_confirmation_completed',
    ],
    instrumented: false,
    note: 'Only PKM reliability diagnostics are emitted. Nothing records deliberate Memory usage at device level.',
  },
  {
    key: 'wallet',
    label: 'Wallet',
    deliberate: [],
    background: [],
    instrumented: false,
    note: 'No wallet event is emitted anywhere in the app.',
  },
  {
    key: 'calendar',
    label: 'Calendar',
    deliberate: [],
    background: [],
    instrumented: false,
    note: 'No calendar event is emitted anywhere in the app.',
  },
  {
    key: 'kyc',
    label: 'KYC',
    deliberate: [],
    background: [],
    instrumented: false,
    note: 'No KYC event is emitted anywhere in the app.',
  },
  {
    key: 'connected_systems',
    label: 'CRM',
    deliberate: [],
    background: [],
    instrumented: false,
    note: 'No connected-systems event is emitted anywhere in the app.',
  },
  {
    key: 'onboarding',
    label: 'Sign-up & onboarding',
    deliberate: [
      'auth_started', 'auth_succeeded', 'google_sign_in_started', 'google_sign_in_completed',
      'phone_verification_started', 'phone_verification_completed',
      'onboarding_started', 'onboarding_step_completed', 'onboarding_completed',
      'one_auth_login_completed', 'one_phone_verified', 'one_onboarding_completed',
    ],
    background: ['auth_failed', 'google_sign_in_failed'],
    instrumented: true,
  },
];

/**
 * Machine-generated events, excluded from every active-user and usage count.
 *
 * An HTTP request is not a person and a cache warm is not a use. Kept in one
 * place because the same list governs the production feed view
 * (sql/kai_public_dashboard_feed.production.sql) and the reconciliation probe
 * (scripts/check-one-metrics-reconciliation.mjs); the three drifting apart
 * would make the dashboard and its own verification disagree.
 */
const ONE_BACKGROUND_EVENTS = [
  'api_request_completed', 'warmup_completed', 'startup_readiness_warmup_completed',
  'cache_resource_resolved', 'route_readiness_completed', 'route_refresh_completed',
  'web_vital', 'session_start', 'first_visit', 'first_open', 'user_engagement',
  'notification_receive', 'notification_dismiss', 'notification_foreground',
  'app_update', 'os_update', 'one_location_foreground_retry',
];

function sqlNameList(names: string[]): string {
  return names.map((name) => sqlStringLiteral(name)).join(', ');
}

/**
 * Builds `capability` and `is_deliberate` for one event row.
 *
 * Kept in SQL rather than post-processed in TypeScript because distinct users
 * per capability cannot be recovered by summing per-event counts after the fact.
 */
function oneCapabilitySql(): { capability: string; isDeliberate: string } {
  const capabilityBranches = ONE_CAPABILITIES
    .filter((spec) => spec.deliberate.length > 0 || spec.background.length > 0)
    .map((spec) => {
      const all = [...spec.deliberate, ...spec.background];
      return `        WHEN event_name IN (${sqlNameList(all)}) THEN ${sqlStringLiteral(spec.key)}`;
    })
    .join('\n');

  const deliberateNames = ONE_CAPABILITIES.flatMap((spec) => spec.deliberate);

  return {
    capability: `      CASE\n${capabilityBranches}\n        ELSE NULL\n      END AS capability`,
    // The consent prefetch is admitted only when the event says it was a real
    // screen. `load_surface` is NULL on events emitted before the param
    // shipped, and those stay out rather than being assumed deliberate.
    isDeliberate: `      (
        event_name IN (${sqlNameList(deliberateNames)})
        OR (
          event_name = 'consent_pending_loaded'
          AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'load_surface') = 'screen'
        )
      ) AS is_deliberate`,
  };
}

const ONE_APP_HOST = process.env.ONE_APP_WEB_HOST || 'one.hushh.ai';
const ONE_APP_UAT_HOST = process.env.ONE_APP_UAT_WEB_HOST || 'uat.one.hushh.ai';

function oneAppSurfaceFilter(webHost: string): string {
  return `(
      platform IN ('IOS', 'ANDROID')
      OR (
        platform = 'WEB'
        AND NET.HOST((SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location')) = ${sqlStringLiteral(webHost)}
      )
    )`;
}

interface OneAppFunnelStepRow {
  step: string;
  label: string;
  users: number;
  conversionFromPrevious: number | null;
  dropoffFromPrevious: number | null;
}

/**
 * Builds the ordered One Location funnel with drop-off between adjacent steps.
 *
 * Conversion is computed against the previous *non-zero* step so that a step
 * which has not shipped instrumentation yet (all of them, until the webapp
 * release lands) reads as a gap rather than as a 100% collapse that would make
 * the next step look like a catastrophic drop.
 */
function buildOneLocationFunnel(usersByStep: Map<string, number>): OneAppFunnelStepRow[] {
  let previousUsers: number | null = null;
  return ONE_LOCATION_FUNNEL_STEPS.map(({ key, label }) => {
    const users = usersByStep.get(key) ?? 0;
    const conversionFromPrevious =
      previousUsers && previousUsers > 0 ? users / previousUsers : null;
    const row: OneAppFunnelStepRow = {
      step: key,
      label,
      users,
      conversionFromPrevious,
      dropoffFromPrevious:
        conversionFromPrevious === null ? null : 1 - conversionFromPrevious,
    };
    if (users > 0) previousUsers = users;
    return row;
  });
}

async function fetchOneAppSummary(
  projectId: string,
  dataset: string,
  range: HushhAiDateRange,
  tolerateMissingDataset: boolean,
  webHost: string = ONE_APP_HOST,
): Promise<DataResult<Record<string, unknown>>> {
  const generatedAt = new Date().toISOString();
  const table = `\`${projectId}.${dataset}.events_*\``;
  const surfaceFilter = oneAppSurfaceFilter(webHost);
  // Selected-range totals must include GA4's streaming table. Without it, an
  // action completed today is already present in BigQuery but the dashboard
  // continues to show zero until the finalized daily export lands. GA4 removes
  // an intraday table when that day's daily table is finalized, so selecting
  // both suffix forms keeps historical totals intact while making the current
  // day visible within the streaming-export delay.
  const dateFilter = `${ga4ExportSuffixFilter(range.startDate, range.endDate, true)} AND ${surfaceFilter}`;
  const last24Range = defaultUtcRange(2);
  // Intraday tables are what make the last-24h tile meaningful during a launch;
  // the finalized daily table lands a day late.
  const last24Filter = `${ga4ExportSuffixFilter(last24Range.startDate, last24Range.endDate, true)}
    AND TIMESTAMP_MICROS(event_timestamp) >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
    AND ${surfaceFilter}`;

  const funnelQuery = `
    SELECT step, COUNT(DISTINCT user_pseudo_id) AS users
    FROM (
      SELECT
        user_pseudo_id,
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'step') AS step
      FROM ${table}
      WHERE ${dateFilter}
        AND event_name = 'growth_funnel_step_completed'
        AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'journey') = 'location'
      UNION ALL
      SELECT user_pseudo_id, 'activated' AS step
      FROM ${table}
      WHERE ${dateFilter} AND event_name = 'one_location_activation_completed'
    )
    WHERE step IS NOT NULL
    GROUP BY step
  `;

  const capabilitySql = oneCapabilitySql();

  // Two numbers per capability. `devices` counts device/browser identifiers
  // that did something
  // deliberate; `totalUsers` is everyone the old prefix bucket would have
  // counted. Reporting both means the drop from the previous figures reads as
  // a correction rather than as a regression.
  const agentQuery = `
    SELECT
      capability,
      COUNT(DISTINCT IF(is_deliberate, user_pseudo_id, NULL)) AS deliberateDevices,
      COUNTIF(is_deliberate) AS deliberateEvents,
      COUNT(DISTINCT user_pseudo_id) AS totalUsers,
      COUNT(*) AS totalEvents
    FROM (
      SELECT
        user_pseudo_id,
${capabilitySql.capability},
${capabilitySql.isDeliberate}
      FROM ${table}
      WHERE ${dateFilter}
    )
    WHERE capability IS NOT NULL
    GROUP BY capability
    ORDER BY deliberateDevices DESC, totalUsers DESC
  `;

  const locationFeatureQuery = `
    SELECT event_name AS eventName, COUNT(DISTINCT user_pseudo_id) AS users, COUNT(*) AS events
    FROM ${table}
    WHERE ${dateFilter} AND event_name LIKE 'one_location%'
    GROUP BY eventName
    ORDER BY users DESC
    LIMIT 20
  `;

  // One scan produces every level needed by the Location drill-down. The
  // dedicated events preserve historical coverage; `one_location_journey_action`
  // adds the Connect/Circles/Profile actions that did not exist before this
  // dashboard. No identifiers or free text leave BigQuery.
  const locationBehaviorQuery = `
    WITH raw AS (
      SELECT
        CAST(DATE(TIMESTAMP_MICROS(event_timestamp)) AS STRING) AS eventDate,
        user_pseudo_id,
        COALESCE(platform, 'UNKNOWN') AS platform,
        event_name AS eventName,
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'action') AS actionName,
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'result') AS result,
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'route_id') AS routeId,
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'circle_kind') AS circleKind,
        COALESCE((SELECT value.int_value = 1 FROM UNNEST(event_params) WHERE key = 'copied_to_clipboard'), FALSE) AS copiedToClipboard,
        COALESCE((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'success_count'), 0) AS successCount
      FROM ${table}
      WHERE ${dateFilter}
        AND (
          event_name = 'page_view'
          OR event_name LIKE 'one_location%'
          OR event_name LIKE '%check_in%'
          OR event_name LIKE '%check_out%'
        )
    ),
    classified AS (
      SELECT
        *,
        CASE
          WHEN eventName = 'one_location_share_confirmed' THEN 'live_sharing'
          WHEN eventName = 'one_location_check_in_completed' OR eventName LIKE '%check_in%' THEN 'check_in'
          WHEN eventName LIKE '%check_out%' THEN 'check_out'
          WHEN eventName = 'one_location_journey_action' AND actionName = 'nearby_check_in_result' THEN 'check_in'
          WHEN eventName = 'one_location_sos_triggered' THEN 'sms_safety'
          WHEN eventName = 'one_location_request_sent' THEN 'request_location'
          WHEN eventName = 'one_location_public_link_created' THEN 'public_sharing'
          WHEN eventName = 'one_location_contact_signal_synced' THEN 'contact_sync'
          WHEN eventName = 'one_location_circle_invite_created' THEN 'invitations'
          WHEN eventName = 'one_location_circle_created' THEN 'circle_engagement'
          WHEN eventName = 'one_location_journey_action' AND actionName LIKE 'contact_invitation_%' THEN 'invitations'
          WHEN eventName = 'one_location_journey_action' AND actionName = 'circle_code_shared' THEN 'invitations'
          WHEN eventName = 'one_location_journey_action' AND actionName LIKE 'contact_sync_%' THEN 'contact_sync'
          WHEN eventName = 'one_location_journey_action' AND actionName LIKE 'public_link_%' THEN 'public_sharing'
          WHEN eventName = 'one_location_journey_action' AND actionName LIKE 'location_request_%' THEN 'request_location'
          WHEN eventName = 'one_location_journey_action' AND actionName LIKE 'location_share_%' THEN 'live_sharing'
          WHEN eventName = 'one_location_journey_action' AND actionName LIKE 'circle_%' THEN 'circle_engagement'
          ELSE NULL
        END AS featureKey,
        CASE
          WHEN eventName = 'page_view' AND routeId IN ('one_location', 'one_location_map', 'one_location_check_in') THEN 'location_opened'
          WHEN eventName = 'page_view' AND routeId = 'connect' THEN 'connect_opened'
          WHEN eventName = 'one_location_contact_signal_synced' AND result = 'success' THEN 'contact_sync'
          WHEN eventName = 'one_location_circle_invite_created' AND result = 'success' AND copiedToClipboard THEN 'invitation_shared'
          WHEN eventName = 'one_location_journey_action' AND actionName IN ('contact_invitation_handoff', 'circle_code_shared') AND result = 'success' THEN 'invitation_shared'
          WHEN eventName = 'one_location_circle_created' AND result = 'success' THEN 'circle_engaged'
          WHEN eventName = 'one_location_journey_action' AND actionName LIKE 'circle_%' AND result = 'success' THEN 'circle_engaged'
          WHEN eventName = 'one_location_request_sent' AND result = 'success' AND successCount > 0 THEN 'request_sent'
          WHEN eventName = 'one_location_journey_action' AND actionName = 'location_request_fulfilled' AND result = 'success' THEN 'request_fulfilled'
          WHEN eventName = 'one_location_share_confirmed' AND result = 'success' AND successCount > 0 THEN 'live_shared'
          WHEN eventName = 'one_location_check_in_completed' AND result = 'success' AND successCount > 0 THEN 'check_in'
          WHEN eventName = 'one_location_journey_action' AND actionName = 'nearby_check_in_result' AND result = 'success' THEN 'check_in'
          WHEN eventName = 'page_view' AND (routeId = 'profile' OR STARTS_WITH(routeId, 'profile_')) THEN 'profile_opened'
          ELSE NULL
        END AS journeyKey
      FROM raw
    )
    SELECT
      'feature' AS scope,
      featureKey AS metricKey,
      CAST(NULL AS STRING) AS eventDate,
      CAST(NULL AS STRING) AS dimension,
      COUNT(DISTINCT user_pseudo_id) AS users,
      COUNT(*) AS events,
      COUNTIF(result = 'success') AS successes,
      COUNTIF(result IN ('expected_error', 'error')) AS failures
    FROM classified
    WHERE featureKey IS NOT NULL
    GROUP BY featureKey
    UNION ALL
    SELECT
      'feature_daily', featureKey, eventDate, NULL,
      COUNT(DISTINCT user_pseudo_id), COUNT(*),
      COUNTIF(result = 'success'), COUNTIF(result IN ('expected_error', 'error'))
    FROM classified
    WHERE featureKey IS NOT NULL
    GROUP BY featureKey, eventDate
    UNION ALL
    SELECT
      'feature_platform', featureKey, NULL, platform,
      COUNT(DISTINCT user_pseudo_id), COUNT(*),
      COUNTIF(result = 'success'), COUNTIF(result IN ('expected_error', 'error'))
    FROM classified
    WHERE featureKey IS NOT NULL
    GROUP BY featureKey, platform
    UNION ALL
    SELECT
      'journey', journeyKey, NULL, NULL,
      COUNT(DISTINCT user_pseudo_id), COUNT(*),
      COUNTIF(result = 'success' OR eventName = 'page_view'),
      COUNTIF(result IN ('expected_error', 'error'))
    FROM classified
    WHERE journeyKey IS NOT NULL
    GROUP BY journeyKey
    UNION ALL
    SELECT
      'circle_kind', COALESCE(NULLIF(circleKind, ''), 'unknown'), NULL, NULL,
      COUNT(DISTINCT user_pseudo_id), COUNT(*),
      COUNTIF(result = 'success'), COUNTIF(result IN ('expected_error', 'error'))
    FROM classified
    WHERE eventName = 'one_location_circle_created'
    GROUP BY COALESCE(NULLIF(circleKind, ''), 'unknown')
    UNION ALL
    SELECT
      'instrumentation', 'journey_action', MIN(eventDate), NULL,
      COUNT(DISTINCT user_pseudo_id), COUNT(*),
      COUNTIF(result = 'success'), COUNTIF(result IN ('expected_error', 'error'))
    FROM classified
    WHERE eventName = 'one_location_journey_action'
  `;

  const platformQuery = `
    SELECT
      COALESCE(platform, 'unknown') AS platform,
      COUNT(DISTINCT user_pseudo_id) AS users,
      COUNT(*) AS events
    FROM ${table}
    WHERE ${dateFilter}
    GROUP BY platform
    ORDER BY users DESC
  `;

  // Per-capability, per-day deliberate users. Drives the trend on each card: a
  // total alone cannot tell you whether a capability is growing or dying.
  const agentDailyQuery = `
    SELECT eventDate, capability, COUNT(DISTINCT user_pseudo_id) AS users
    FROM (
      SELECT
        CAST(DATE(TIMESTAMP_MICROS(event_timestamp)) AS STRING) AS eventDate,
        user_pseudo_id,
${capabilitySql.capability},
${capabilitySql.isDeliberate}
      FROM ${table}
      WHERE ${dateFilter}
    )
    WHERE capability IS NOT NULL AND is_deliberate
    GROUP BY eventDate, capability
    ORDER BY eventDate
  `;

  // Deliberately NOT surface-filtered: this is the audit trail for the filter
  // itself, so the dashboard can show what it left out instead of quietly
  // dropping it.
  const surfaceQuery = `
    SELECT
      CASE
        WHEN platform IN ('IOS', 'ANDROID') THEN CONCAT('App - ', platform)
        WHEN NET.HOST((SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location')) = ${sqlStringLiteral(webHost)}
          THEN 'Web app'
        ELSE 'Other site or environment'
      END AS surface,
      CASE
        WHEN platform IN ('IOS', 'ANDROID') THEN 'Native app'
        WHEN NET.HOST((SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location')) = ${sqlStringLiteral(webHost)}
          THEN ${sqlStringLiteral(webHost)}
        WHEN NET.HOST((SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location')) LIKE '%hushh.ai'
          THEN NET.HOST((SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location'))
        -- Anything else is a sign-in redirect or a developer machine. Named
        -- rather than passed through, because the public payload sanitizer
        -- rewrites any string carrying an internal project id and the row would
        -- otherwise read as an unhelpful "Internal aggregate source".
        ELSE 'Sign-in redirect or local'
      END AS host,
      COUNT(DISTINCT user_pseudo_id) AS users
    FROM ${table}
    WHERE ${ga4ExportSuffixFilter(range.startDate, range.endDate, true)}
    GROUP BY surface, host
    ORDER BY users DESC
    LIMIT 15
  `;

  // Native streams share the GA4 property with web. Preserve their emitted
  // environment tag as an aggregate diagnostic: the public-store workflows
  // currently build against the UAT backend, and silently calling those rows
  // "production" would make the environment selector dishonest. Automatic
  // Firebase lifecycle events have no custom `env` parameter and remain
  // explicitly labelled as such.
  const nativeEnvironmentQuery = `
    SELECT
      platform,
      COALESCE(
        NULLIF((SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'env'), ''),
        'unlabeled'
      ) AS environment,
      COUNT(DISTINCT user_pseudo_id) AS devices,
      COUNT(*) AS events
    FROM ${table}
    WHERE ${ga4ExportSuffixFilter(range.startDate, range.endDate, true)}
      AND platform IN ('IOS', 'ANDROID')
    GROUP BY platform, environment
    ORDER BY platform, events DESC
  `;

  const acquisitionQuery = `
    SELECT
      COALESCE(NULLIF(traffic_source.source, ''), '(direct)') AS source,
      COALESCE(NULLIF(traffic_source.medium, ''), '(none)') AS medium,
      COUNT(DISTINCT user_pseudo_id) AS users
    FROM ${table}
    WHERE ${dateFilter}
    GROUP BY source, medium
    ORDER BY users DESC
    LIMIT 12
  `;

  const dailyQuery = `
    SELECT
      CAST(DATE(TIMESTAMP_MICROS(event_timestamp)) AS STRING) AS eventDate,
      COUNT(DISTINCT user_pseudo_id) AS users,
      COUNT(DISTINCT IF(event_name LIKE 'one_location%', user_pseudo_id, NULL)) AS locationUsers,
      COUNT(*) AS events
    FROM ${table}
    WHERE ${dateFilter}
    GROUP BY eventDate
    ORDER BY eventDate
  `;

  // Retries per affected user is a standing geolocation-reliability signal: a
  // high ratio means the fix is failing repeatedly for the few people trying.
  const reliabilityQuery = `
    SELECT
      COUNTIF(event_name = 'one_location_foreground_retry') AS locationRetries,
      COUNT(DISTINCT IF(event_name = 'one_location_foreground_retry', user_pseudo_id, NULL)) AS locationRetryUsers,
      COUNT(DISTINCT IF(event_name = 'one_location_share_confirmed', user_pseudo_id, NULL)) AS sharingUsers
    FROM ${table}
    WHERE ${dateFilter}
  `;

  const last24Query = ga4ExportTotalsSql(table, last24Filter);
  const totalsQuery = ga4ExportTotalsSql(table, dateFilter);

  // ---------------------------------------------------------------------
  // Usage metrics for the simplified readout.
  //
  // These are anchored to the END of the selected range rather than to its
  // length. DAU/WAU/MAU have fixed meanings -- 1, 7 and 30 days -- and would
  // stop meaning anything if a 7-day range silently redefined "monthly".
  // ---------------------------------------------------------------------
  const backgroundNames = sqlNameList(ONE_BACKGROUND_EVENTS);
  const meaningful = `event_name NOT IN (${backgroundNames})`;

  // Read a few days wider than thirty so a full 30-day window is still
  // available after anchoring back to the last finalized daily export. Active
  // KPIs deliberately exclude intraday_*: at the start of a UTC day that table
  // is only a sliver, and calling it DAU makes a healthy product look dead.
  // Streaming rows remain included in selected-range and last-24-hour totals.
  const activeWindowFilter = ga4ExportSuffixFilter(
    formatUtcDate(addUtcDays(parseUtcDate(range.endDate) as Date, -33)),
    range.endDate,
    false,
  );

  // DAU is anchored to the last day with data, not to the end of the selected
  // range. GA4's daily export lands a day or more late, so anchoring to "today"
  // reports a sliver of a day -- a healthy product looks dead every morning.
  // MAX(day) never exceeds the range end, so a historical range still anchors
  // to its own last day.
  //
  // Days come from `event_date`, not from `DATE(TIMESTAMP_MICROS(event_timestamp))`.
  // GA4 partitions the export by the property's reporting timezone while
  // event_timestamp is UTC, so bucketing by the timestamp splits the newest
  // daily table across two dates and invents a partial trailing day. That made
  // DAU anchor to a handful of spillover events instead of to the real last day.
  const activeQuery = `
    WITH days AS (
      SELECT user_pseudo_id, PARSE_DATE('%Y%m%d', event_date) AS day
      FROM ${table}
      WHERE ${activeWindowFilter} AND ${surfaceFilter} AND ${meaningful}
    ),
    anchor AS (SELECT MAX(day) AS latest FROM days)
    SELECT
      CAST((SELECT latest FROM anchor) AS STRING) AS asOf,
      COUNT(DISTINCT IF(day = (SELECT latest FROM anchor), user_pseudo_id, NULL)) AS dau,
      COUNT(DISTINCT IF(
        day BETWEEN DATE_SUB((SELECT latest FROM anchor), INTERVAL 6 DAY)
                AND (SELECT latest FROM anchor), user_pseudo_id, NULL)) AS wau,
      COUNT(DISTINCT IF(
        day BETWEEN DATE_SUB((SELECT latest FROM anchor), INTERVAL 29 DAY)
                AND (SELECT latest FROM anchor), user_pseudo_id, NULL)) AS mau
    FROM days
  `;

  // What happens to a native install.
  //
  // The activation funnel elsewhere starts at "opened the app", which quietly
  // omits the largest drop in the product: most people who install never sign
  // in at all. This is a true cohort funnel -- every stage is measured against
  // the same set of devices that installed inside the window, so the stages
  // nest and the percentages mean something. Counting each stage independently
  // would mix in people who installed months ago and make the rates nonsense.
  // The 6-stage native install cohort funnel (iOS & Android native only).
  // Stages nest because every one is measured against the same set of devices
  // that installed inside the window. Web is excluded (no native install cohort).
  const installFunnelQuery = `
    WITH scoped AS (
      SELECT
        COALESCE(platform, 'UNKNOWN') AS platform,
        user_pseudo_id,
        event_name,
        PARSE_DATE('%Y%m%d', event_date) AS day,
        DATE(TIMESTAMP_MICROS(user_first_touch_timestamp)) AS firstDay
      FROM ${table}
      WHERE ${dateFilter} AND platform IN ('IOS', 'ANDROID')
    ),
    installs AS (
      SELECT DISTINCT platform, user_pseudo_id, firstDay FROM scoped WHERE event_name = 'first_open'
    ),
    progressed AS (
      SELECT
        i.platform,
        i.user_pseudo_id,
        MAX(IF(s.event_name IN ('auth_started', 'google_sign_in_started'), 1, 0)) AS triedSignIn,
        MAX(IF(s.event_name IN ('auth_succeeded', 'google_sign_in_completed'), 1, 0)) AS signedIn,
        MAX(IF(s.event_name = 'one_location_onboarding_completed', 1, 0)) AS onboarded,
        MAX(IF(s.event_name = 'one_location_activation_completed', 1, 0)) AS activated,
        MAX(IF(s.day BETWEEN DATE_ADD(i.firstDay, INTERVAL 1 DAY) AND DATE_ADD(i.firstDay, INTERVAL 7 DAY), 1, 0)) AS returnedW1
      FROM installs i
      JOIN scoped s USING (platform, user_pseudo_id)
      GROUP BY i.platform, i.user_pseudo_id, i.firstDay
    )
    SELECT
      platform,
      COUNT(*) AS installed,
      SUM(triedSignIn) AS triedSignIn,
      SUM(signedIn) AS signedIn,
      SUM(onboarded) AS onboarded,
      SUM(activated) AS activated,
      SUM(IF(activated = 1 AND returnedW1 = 1, 1, 0)) AS returnedW1
    FROM progressed
    GROUP BY platform
    ORDER BY installed DESC
  `;

  // Per-platform actives, reported separately because they cannot be summed.
  //
  // GA4 keeps web, iOS and Android on separate streams with separate device
  // ids, and the account key that would stitch them (`user_id`) is bound on
  // iOS only. So the same person on a phone and a laptop is two rows here and
  // there is no way to collapse them. Splitting does not fix that -- it stops
  // the page implying an addition that is not valid, and shows exactly where
  // the identity gap is instead of averaging it away.
  const activeByPlatformQuery = `
    WITH days AS (
      SELECT
        COALESCE(platform, 'UNKNOWN') AS platform,
        user_pseudo_id,
        user_id,
        PARSE_DATE('%Y%m%d', event_date) AS day
      FROM ${table}
      WHERE ${activeWindowFilter} AND ${surfaceFilter} AND ${meaningful}
    ),
    anchor AS (SELECT MAX(day) AS latest FROM days)
    SELECT
      platform,
      COUNT(DISTINCT IF(day = (SELECT latest FROM anchor), user_pseudo_id, NULL)) AS dauDevices,
      COUNT(DISTINCT IF(
        day BETWEEN DATE_SUB((SELECT latest FROM anchor), INTERVAL 6 DAY)
                AND (SELECT latest FROM anchor), user_pseudo_id, NULL)) AS wauDevices,
      COUNT(DISTINCT IF(
        day BETWEEN DATE_SUB((SELECT latest FROM anchor), INTERVAL 29 DAY)
                AND (SELECT latest FROM anchor), user_pseudo_id, NULL)) AS mauDevices,
      COUNT(DISTINCT user_id) AS accounts,
      COUNT(DISTINCT IF(user_id IS NOT NULL, user_pseudo_id, NULL)) AS devicesWithAccount
    FROM days
    GROUP BY platform
    ORDER BY mauDevices DESC
  `;

  // New versus returning, decided by first touch rather than by whether we
  // happened to see the person earlier in this window. Without this split an
  // MAU made almost entirely of first-timers reads as health.
  const growthQuery = `
    SELECT
      COUNT(DISTINCT IF(firstTouch IS NULL, user_pseudo_id, NULL)) AS unknownUsers,
      COUNT(DISTINCT IF(firstTouch >= ${sqlStringLiteral(range.startDate)}, user_pseudo_id, NULL)) AS newUsers,
      COUNT(DISTINCT IF(firstTouch < ${sqlStringLiteral(range.startDate)}, user_pseudo_id, NULL)) AS returningUsers
    FROM (
      SELECT
        user_pseudo_id,
        CAST(DATE(TIMESTAMP_MICROS(user_first_touch_timestamp)) AS STRING) AS firstTouch
      FROM ${table}
      WHERE ${dateFilter} AND ${meaningful}
    )
  `;

  // Week-1 retention by acquisition cohort: of the people who first appeared in
  // a given week, how many came back in the following seven days. Cohorts are
  // read from a wider window than the selected range because a cohort has to be
  // old enough to have had its week.
  const retentionStart = formatUtcDate(addUtcDays(parseUtcDate(range.endDate) as Date, -83));
  const retentionQuery = `
    SELECT
      CAST(DATE_TRUNC(firstDay, WEEK) AS STRING) AS cohortWeek,
      COUNT(DISTINCT user_pseudo_id) AS cohortSize,
      COUNT(DISTINCT IF(
        day BETWEEN DATE_ADD(firstDay, INTERVAL 1 DAY) AND DATE_ADD(firstDay, INTERVAL 7 DAY),
        user_pseudo_id, NULL)) AS returnedW1
    FROM (
      SELECT
        user_pseudo_id,
        PARSE_DATE('%Y%m%d', event_date) AS day,
        DATE(TIMESTAMP_MICROS(user_first_touch_timestamp)) AS firstDay
      FROM ${table}
      WHERE ${ga4ExportSuffixFilter(retentionStart, range.endDate, true)} AND ${surfaceFilter} AND ${meaningful}
    )
    WHERE firstDay IS NOT NULL
    GROUP BY cohortWeek
    ORDER BY cohortWeek DESC
    LIMIT 8
  `;

  // Onboarding to first value, as three counts rather than a ratio, so a stage
  // with no emitter cannot masquerade as a conversion collapse.
  // Three stages, not four. `one_location_setup_completed` was tried as a stage
  // between arrival and onboarding and it produced *fewer* people than the step
  // after it -- the two are alternative paths through setup, not a sequence, and
  // a funnel that goes back up teaches the reader to distrust the whole chart.
  const activationQuery = `
    SELECT
      COUNT(DISTINCT user_pseudo_id) AS reachedApp,
      COUNT(DISTINCT IF(event_name = 'one_location_onboarding_completed', user_pseudo_id, NULL)) AS onboarded,
      COUNT(DISTINCT IF(event_name = 'one_location_activation_completed', user_pseudo_id, NULL)) AS activated
    FROM ${table}
    WHERE ${dateFilter} AND ${meaningful}
  `;

  // Aggregate-only sub-feature adoption. This deliberately returns counts,
  // never person or device rows, and replaces the former UI-side estimates.
  const featureUsageQuery = `
    WITH classified AS (
      SELECT
        user_pseudo_id,
        CASE
          WHEN event_name = 'one_location_share_confirmed' THEN 'live_sharing'
          WHEN event_name = 'one_location_check_in_completed' OR event_name LIKE '%check_in%' THEN 'check_in'
          WHEN event_name LIKE '%check_out%' THEN 'check_out'
          WHEN event_name = 'one_location_journey_action' AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'action') = 'nearby_check_in_result' THEN 'check_in'
          WHEN event_name = 'one_location_sos_triggered' THEN 'sms_safety'
          WHEN event_name = 'one_location_request_sent' THEN 'request_location'
          WHEN event_name = 'one_location_public_link_created' THEN 'public_sharing'
          WHEN event_name = 'one_location_contact_signal_synced' THEN 'contact_sync'
          WHEN event_name = 'one_location_circle_invite_created' THEN 'invitations'
          WHEN event_name = 'one_location_circle_created' THEN 'circle_engagement'
          WHEN event_name = 'one_location_journey_action' AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'action') LIKE 'contact_invitation_%' THEN 'invitations'
          WHEN event_name = 'one_location_journey_action' AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'action') = 'circle_code_shared' THEN 'invitations'
          WHEN event_name = 'one_location_journey_action' AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'action') LIKE 'contact_sync_%' THEN 'contact_sync'
          WHEN event_name = 'one_location_journey_action' AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'action') LIKE 'public_link_%' THEN 'public_sharing'
          WHEN event_name = 'one_location_journey_action' AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'action') LIKE 'location_request_%' THEN 'request_location'
          WHEN event_name = 'one_location_journey_action' AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'action') LIKE 'location_share_%' THEN 'live_sharing'
          WHEN event_name = 'one_location_journey_action' AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'action') LIKE 'circle_%' THEN 'circle_engagement'
          WHEN event_name IN ('auth_started', 'one_auth_started') THEN 'auth_started'
          WHEN event_name IN ('auth_completed', 'one_auth_login_completed', 'one_auth_google_signed_in', 'one_auth_phone_verified', 'one_phone_verified', 'auth_succeeded') THEN 'daily_signin'
          WHEN event_name IN ('phone_verification_started', 'phone_verification_completed', 'one_auth_phone_verified', 'one_phone_verified') THEN 'phone_verified'
          WHEN event_name IN ('google_sign_in_started', 'google_sign_in_completed', 'one_auth_google_signed_in') THEN 'google_signin'
          WHEN event_name IN ('profile_created', 'one_auth_profile_created') THEN 'profile_created'
          WHEN event_name IN ('onboarding_completed', 'one_auth_onboarding_completed', 'one_onboarding_completed') THEN 'onboarding_completed'
          WHEN event_name IN ('portfolio_viewed', 'one_finance_portfolio_viewed') THEN 'portfolio_view'
          WHEN event_name IN ('recommendation_viewed', 'one_finance_recommendation_viewed') THEN 'ai_recommendation'
          WHEN event_name IN ('analysis_stream_started', 'one_finance_analysis_started') THEN 'analysis_stream'
          WHEN event_name IN ('import_parse_completed', 'import_save_completed') THEN 'receipt_parsed'
          WHEN event_name IN ('consent_action_submitted', 'one_consent_preferences_updated', 'consent_pending_loaded') THEN 'preferences_updated'
          WHEN event_name IN ('one_consent_data_unlocked', 'data_unlocked', 'one_consent_data_unlock_requested', 'consent_action_result') THEN 'data_unlock'
          WHEN event_name IN ('permission_granted', 'one_consent_permission_granted') THEN 'permission_granted'
          WHEN event_name IN ('gmail_connect_started', 'gmail_connect_result', 'one_gmail_connected') THEN 'account_connected'
          WHEN event_name IN ('gmail_sync_requested', 'one_gmail_receipt_synced') THEN 'receipt_sync'
          WHEN event_name IN ('hushh_mail_signin_screen_view', 'one_gmail_inbox_viewed') THEN 'inbox_viewed'
          WHEN event_name IN ('autocategory_applied', 'receipt_categorized', 'one_gmail_receipt_categorized') THEN 'autocategory_applied'
          WHEN event_name IN ('ria_verification_status_changed', 'one_ria_verification_checked') THEN 'verification_checked'
          WHEN event_name IN ('ria_workspace_opened', 'one_ria_workspace_visited') THEN 'workspace_visited'
          WHEN event_name IN ('ria_request_created', 'one_ria_strategy_requested') THEN 'strategy_requested'
          WHEN event_name IN ('marketplace_browsed', 'one_marketplace_browsed') THEN 'marketplace_browsed'
          WHEN event_name IN ('marketplace_profile_viewed', 'one_marketplace_profile_viewed') THEN 'profile_viewed'
          WHEN event_name IN ('agent_pkm_context_resolved', 'one_memory_context_resolved') THEN 'context_resolved'
          ELSE NULL
        END AS feature_key
      FROM ${table}
      WHERE ${dateFilter}
    )
    SELECT
      feature_key AS featureKey,
      COUNT(DISTINCT user_pseudo_id) AS devices,
      COUNT(*) AS signals
    FROM classified
    WHERE feature_key IS NOT NULL
    GROUP BY feature_key
  `;

  const queryProject = BQ_JOB_PROJECT || projectId;
  const [
    funnel,
    agents,
    agentDaily,
    surfaces,
    locationFeatures,
    locationBehavior,
    platforms,
    acquisition,
    daily,
    reliability,
    totals,
    last24,
    active,
    activeByPlatform,
    installFunnel,
    growth,
    retention,
    activationStages,
    featureUsage,
    nativeEnvironments,
  ] = await Promise.all([
    queryBigQuerySql(queryProject, funnelQuery),
    queryBigQuerySql(queryProject, agentQuery),
    queryBigQuerySql(queryProject, agentDailyQuery),
    queryBigQuerySql(queryProject, surfaceQuery),
    queryBigQuerySql(queryProject, locationFeatureQuery),
    queryBigQuerySql(queryProject, locationBehaviorQuery),
    queryBigQuerySql(queryProject, platformQuery),
    queryBigQuerySql(queryProject, acquisitionQuery),
    queryBigQuerySql(queryProject, dailyQuery),
    queryBigQuerySql(queryProject, reliabilityQuery),
    queryBigQuerySql(queryProject, totalsQuery),
    queryBigQuerySql(queryProject, last24Query),
    queryBigQuerySql(queryProject, activeQuery),
    queryBigQuerySql(queryProject, activeByPlatformQuery),
    queryBigQuerySql(queryProject, installFunnelQuery),
    queryBigQuerySql(queryProject, growthQuery),
    queryBigQuerySql(queryProject, retentionQuery),
    queryBigQuerySql(queryProject, activationQuery),
    queryBigQuerySql(queryProject, featureUsageQuery),
    queryBigQuerySql(queryProject, nativeEnvironmentQuery),
  ]);

  const errors = [
    funnel.error,
    agents.error,
    agentDaily.error,
    surfaces.error,
    locationFeatures.error,
    locationBehavior.error,
    platforms.error,
    acquisition.error,
    daily.error,
    reliability.error,
    totals.error,
    last24.error,
    active.error,
    activeByPlatform.error,
    installFunnel.error,
    growth.error,
    retention.error,
    activationStages.error,
    featureUsage.error,
    nativeEnvironments.error,
  ].filter(Boolean);

  const hasAnyRows =
    daily.rows.length > 0 || agents.rows.length > 0 || locationFeatures.rows.length > 0 || locationBehavior.rows.length > 0;

  if (!hasAnyRows && errors.length > 0 && !tolerateMissingDataset) {
    return { data: null, error: errors.join('; ') };
  }

  const usersByStep = new Map<string, number>(
    funnel.rows.map((row) => [String(row.step), toNumber(row.users)]),
  );
  const dailyByDate = new Map(daily.rows.map((row) => [String(row.eventDate), row]));
  const totalsRow = totals.rows[0] ?? {};
  const last24Row = last24.rows[0] ?? {};
  const reliabilityRow = reliability.rows[0] ?? {};
  const activeRow = active.rows[0] ?? {};
  const growthRow = growth.rows[0] ?? {};
  const activationRow = activationStages.rows[0] ?? {};
  const capabilityRows = new Map(
    agents.rows.map((row) => [String(row.capability), row]),
  );
  const locationBehaviorRows = (scope: string) =>
    locationBehavior.rows.filter((row) => String(row.scope) === scope);
  const locationFeatureRows = new Map(
    locationBehaviorRows('feature').map((row) => [String(row.metricKey), row]),
  );
  const locationJourneyRows = new Map(
    locationBehaviorRows('journey').map((row) => [String(row.metricKey), row]),
  );
  const journeyInstrumentationRow = locationBehaviorRows('instrumentation')[0] ?? {};
  const journeyActionInstrumented = toNumber(journeyInstrumentationRow.events) > 0;

  const activatedUsers = usersByStep.get('activated') ?? 0;
  const locationRetries = toNumber(reliabilityRow.locationRetries);
  const locationRetryUsers = toNumber(reliabilityRow.locationRetryUsers);

  return {
    data: {
      sourceProjectId: projectId,
      sourceDataset: dataset,
      sourceLabel: 'GA4 export',
      sourceWebHost: webHost,
      surfaceScope: {
        webHost,
        strictWebHost: true,
        nativeFromSameProperty: true,
      },
      generatedAt,
      realtimeMode: 'streaming_export',
      expectedLagSeconds: 300,
      available: hasAnyRows,
      windowDays: range.days,
      range: {
        startDate: range.startDate,
        endDate: range.endDate,
        days: range.days,
      },
      rangeTotals: {
        users: toNumber(totalsRow.users),
        sessions: toNumber(totalsRow.sessions),
        events: toNumber(totalsRow.events),
      },
      last24Hours: {
        users: toNumber(last24Row.users),
        sessions: toNumber(last24Row.sessions),
        events: toNumber(last24Row.events),
        available: !last24.error,
      },
      // Measured only. The scoreboard deliberately has no goal in it, so the
      // server does not carry one either -- a target in the payload is a
      // target someone re-adds to the UI later, and it would be visible to
      // anyone reading the response besides.
      activation: {
        activatedUsers,
        sharingUsers: toNumber(reliabilityRow.sharingUsers),
      },
      funnel: buildOneLocationFunnel(usersByStep),
      activeUsers: {
        countingUnit: 'device',
        identityScope: 'GA4 device/browser identifier; not cross-device deduplicated',
        dau: toNumber(activeRow.dau),
        wau: toNumber(activeRow.wau),
        mau: toNumber(activeRow.mau),
        // Stickiness is only meaningful against a non-zero denominator, and a
        // fabricated 0% would read as a product collapse rather than as no data.
        stickiness: toNumber(activeRow.mau) > 0
          ? toNumber(activeRow.dau) / toNumber(activeRow.mau)
          : null,
        // The day DAU was actually measured on, which is the last day with
  // finalized daily data rather than the end of the selected range.
        asOf: String(activeRow.asOf ?? range.endDate),
      },
      // The install cohort funnel, per native platform. Stages nest because
      // every one is measured against the same devices that installed inside
      // the window, so the ratios are real conversions rather than unrelated
      // counts placed next to each other.
      installFunnel: installFunnel.rows.map((row) => {
        const installed = toNumber(row.installed);
        const stage = (key: string, label: string, users: number) => ({
          key,
          label,
          users,
          // Share of the install cohort, not of the previous stage: the
          // question this answers is "of everyone who installed, how many got
          // here", and step-to-step ratios hide how steep the first drop is.
          shareOfInstalls: installed > 0 ? users / installed : null,
        });
        return {
          platform: String(row.platform ?? 'UNKNOWN'),
          installed,
          stages: [
            stage('installed', 'Installed the app', installed),
            stage('tried_sign_in', 'Tried to sign in', toNumber(row.triedSignIn)),
            stage('signed_in', 'Signed in', toNumber(row.signedIn)),
            stage('onboarded', 'Finished onboarding', toNumber(row.onboarded)),
            stage('activated', 'Reached first value', toNumber(row.activated)),
            stage('returned_w1', 'Returned in week 1', toNumber(row.returnedW1)),
          ],
        };
      }),
      // One row per platform, never a total. The columns are separate
      // populations: the same person on an iPhone and a laptop is two rows and
      // nothing here can collapse them.
      activeByPlatform: activeByPlatform.rows.map((row) => {
        const devices = toNumber(row.mauDevices);
        const withAccount = toNumber(row.devicesWithAccount);
        return {
          platform: String(row.platform ?? 'UNKNOWN'),
          dauDevices: toNumber(row.dauDevices),
          wauDevices: toNumber(row.wauDevices),
          mauDevices: devices,
          // Null, not zero, when nothing on this platform ever bound an
          // account: "no accounts signed in" and "this platform cannot report
          // accounts" are different facts and only one is about behaviour.
          accounts: withAccount > 0 ? toNumber(row.accounts) : null,
          signedInShare: devices > 0 && withAccount > 0 ? withAccount / devices : null,
          identityBound: withAccount > 0,
        };
      }),
      growth: {
        newUsers: toNumber(growthRow.newUsers),
        returningUsers: toNumber(growthRow.returningUsers),
        // First touch is missing on some rows. Named rather than folded into
        // "new", which is where it would flatter the number.
        unknownUsers: toNumber(growthRow.unknownUsers),
      },
      retention: retention.rows
        .map((row) => {
          const cohortSize = toNumber(row.cohortSize);
          const returned = toNumber(row.returnedW1);
          return {
            cohortWeek: String(row.cohortWeek),
            cohortSize,
            returnedW1: returned,
            rateW1: cohortSize > 0 ? returned / cohortSize : null,
          };
        })
        // Oldest first, so the chart reads left to right like every other
        // trend on the page.
        .reverse(),
      activationStages: [
        { key: 'reached_app', label: 'Opened the app', users: toNumber(activationRow.reachedApp) },
        { key: 'onboarded', label: 'Finished onboarding', users: toNumber(activationRow.onboarded) },
        { key: 'activated', label: 'Shared or received a location', users: toNumber(activationRow.activated) },
      ],
      // Driven by the declared catalogue, not by what came back from the query,
      // so a capability that emits nothing appears with a reason instead of
      // vanishing from the list.
      capabilities: ONE_CAPABILITIES.map((spec) => {
        const row = capabilityRows.get(spec.key);
        const byDate = new Map(
          agentDaily.rows
            .filter((point) => String(point.capability) === spec.key)
            .map((point) => [String(point.eventDate), toNumber(point.users)]),
        );
        return {
          key: spec.key,
          label: spec.label,
          instrumented: spec.instrumented,
          note: spec.note ?? null,
          devices: spec.instrumented ? toNumber(row?.deliberateDevices) : null,
          deliberateEvents: spec.instrumented ? toNumber(row?.deliberateEvents) : null,
          totalUsers: toNumber(row?.totalUsers),
          totalEvents: toNumber(row?.totalEvents),
          // Spined so every capability's chart shares one x-axis and quiet days
          // read as zero rather than being skipped.
          daily: dateSpine(range).map((date) => ({
            eventDate: date,
            users: byDate.get(date) ?? 0,
          })),
        };
      }),
      surfaces: surfaces.rows.map((row) => ({
        surface: String(row.surface),
        host: String(row.host),
        users: toNumber(row.users),
      })),
      nativeEnvironments: nativeEnvironments.rows.map((row) => ({
        platform: String(row.platform),
        environment: String(row.environment),
        devices: toNumber(row.devices),
        events: toNumber(row.events),
      })),
      locationFeatures: locationFeatures.rows.map((row) => ({
        eventName: String(row.eventName),
        users: toNumber(row.users),
        events: toNumber(row.events),
      })),
      locationAnalytics: {
        // Stable catalogue ordering means a newly instrumented feature appears
        // as "measuring" before its first event instead of disappearing.
        features: ONE_LOCATION_BEHAVIOR_FEATURES.map((spec) => {
          const row = locationFeatureRows.get(spec.key);
          const byDate = new Map(
            locationBehaviorRows('feature_daily')
              .filter((point) => String(point.metricKey) === spec.key)
              .map((point) => [String(point.eventDate), point]),
          );
          return {
            key: spec.key,
            label: spec.label,
            instrumented: true,
            users: toNumber(row?.users),
            events: toNumber(row?.events),
            successes: toNumber(row?.successes),
            failures: toNumber(row?.failures),
            daily: dateSpine(range).map((date) => {
              const point = byDate.get(date) ?? {};
              return {
                eventDate: date,
                users: toNumber(point.users),
                events: toNumber(point.events),
              };
            }),
          };
        }),
        // This is reach across optional branches, not a sequential conversion
        // funnel. The UI says so explicitly and does not compute drop-off.
        journey: ONE_LOCATION_JOURNEY_STEPS.map((spec) => {
          const row = locationJourneyRows.get(spec.key);
          const instrumented = !spec.requiresJourneyAction || journeyActionInstrumented;
          return {
            key: spec.key,
            label: spec.label,
            instrumented,
            users: instrumented ? toNumber(row?.users) : null,
            events: instrumented ? toNumber(row?.events) : null,
          };
        }),
        circleKinds: [
          { key: 'family', label: 'Family' },
          { key: 'friends', label: 'Friends' },
          { key: 'other', label: 'Custom' },
        ].map((spec) => {
          const row = locationBehaviorRows('circle_kind').find(
            (candidate) => String(candidate.metricKey).toLowerCase() === spec.key,
          );
          return {
            kind: spec.key,
            label: spec.label,
            creators: toNumber(row?.users),
            circlesCreated: toNumber(row?.successes),
          };
        }),
        platforms: locationBehaviorRows('feature_platform').map((row) => ({
          platform: String(row.dimension ?? 'UNKNOWN').toUpperCase(),
          feature: String(row.metricKey ?? ''),
          users: toNumber(row.users),
          events: toNumber(row.events),
        })),
        journeyActionSeen: journeyActionInstrumented,
        instrumentationStartedAt: journeyActionInstrumented
          ? String(journeyInstrumentationRow.eventDate)
          : null,
        instrumentationNote: journeyActionInstrumented
          ? 'Detailed Connect, Circles, invitation and Profile actions are flowing from the shared web/native analytics adapter.'
          : webHost === ONE_APP_HOST
            ? 'The detailed journey event has not reached the production export yet. Existing feature events remain live while the new release rolls out.'
            : 'The detailed journey event has not reached the UAT export yet. TestFlight, Android internal and UAT web events will appear after the next GA4 export.',
      },
      featureUsage: Object.fromEntries(featureUsage.rows.map((row) => [
        String(row.featureKey),
        { devices: toNumber(row.devices), signals: toNumber(row.signals) },
      ])),
      platforms: platforms.rows.map((row) => ({
        platform: String(row.platform),
        users: toNumber(row.users),
        events: toNumber(row.events),
      })),
      acquisition: acquisition.rows.map((row) => ({
        source: String(row.source),
        medium: String(row.medium),
        users: toNumber(row.users),
      })),
      daily: dateSpine(range).map((date) => {
        const row = dailyByDate.get(date) ?? {};
        return {
          eventDate: date,
          users: toNumber(row.users),
          locationUsers: toNumber(row.locationUsers),
          events: toNumber(row.events),
        };
      }),
      reliability: {
        locationRetries,
        locationRetryUsers,
        retriesPerAffectedUser:
          locationRetryUsers > 0 ? locationRetries / locationRetryUsers : null,
      },
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
      engagedSessions: null,
      engagementRate: null,
      averageSessionDuration: null,
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
      events: null,
      users: null,
      sessions: null,
      engagedSessions: null,
      engagementRate: null,
      averageSessionDuration: null,
    })),
    topEvents: [],
    topPages: [],
    acquisition: {
      sessionChannels: [],
      sessionSourceMedium: [],
      landingPages: [],
      geoDevice: [],
    },
    sessionTiming: {
      timezoneLabel: 'GA4 property timezone',
      hourly: [],
      hourOfDay: [],
      topDateHours: [],
    },
    warnings: [
      'GA4 aggregate data only; no user-level/session-level rows.',
      'Users are non-additive across days and dimensions.',
      'Hourly timestamps are in the GA4 property timezone.',
      'Last-day/today data is processed GA4 reporting data and may change.',
      'DB/Product Events are not configured, so conversion/signup/product behavior is unavailable.',
    ],
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

function compactGa4DateHour(value: string): string {
  return String(value || '').replace(/\D/g, '').slice(0, 10);
}

function formatGa4ApiDateHour(value: string): string {
  const compact = compactGa4DateHour(value);
  if (/^\d{10}$/.test(compact)) {
    return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)} ${compact.slice(8, 10)}:00`;
  }
  return value || '(not set)';
}

function dateHourSpine(range: HushhAiDateRange): string[] {
  const hours: string[] = [];
  for (const date of dateSpine(range)) {
    const compactDate = date.replace(/-/g, '');
    for (let hour = 0; hour < 24; hour += 1) {
      hours.push(`${compactDate}${String(hour).padStart(2, '0')}`);
    }
  }
  return hours;
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
    engagedSessions: ga4Metric(row, offset + 3),
    engagementRate: ga4Metric(row, offset + 4),
    averageSessionDuration: ga4Metric(row, offset + 5),
  };
}

type Ga4SectionTotals = {
  users: number | null;
  sessions: number | null;
  events: number | null;
  engagedSessions?: number | null;
  engagementRate?: number | null;
  averageSessionDuration?: number | null;
  available: boolean;
  label?: string | null;
  source?: string | null;
  note?: string | null;
  expectedLagSeconds?: number | null;
};

function buildGa4Sections(params: {
  generatedAt: string;
  realtime?: Ga4SectionTotals;
  last24Hours?: Ga4SectionTotals;
  last7Days?: Ga4SectionTotals;
  selectedTotal?: Ga4SectionTotals;
}) {
  const toSection = (
    key: string,
    label: string,
    mode: string,
    totals: Ga4SectionTotals | undefined,
  ) => ({
    key,
    label: totals?.label ?? label,
    status: totals?.available ? (key === 'realtime' ? 'live' : 'delayed') : 'waiting',
    stateClass: sourceStateClass(totals?.available ? (key === 'realtime' ? 'live' : 'delayed') : 'waiting'),
    source: totals?.source ?? mode,
    freshness: {
      generatedAt: params.generatedAt,
      expectedLagSeconds: totals?.expectedLagSeconds ?? (key === 'realtime' ? 60 : 86_400),
    },
    metrics: [
      sourceMetric('users', key === 'realtime' ? 'Active Users' : 'Users', totals?.users),
      sourceMetric('sessions', 'Sessions', totals?.sessions),
      sourceMetric('events', 'Events', totals?.events),
      sourceMetric('engaged_sessions', 'Engaged Sessions', totals?.engagedSessions),
      sourceMetric('engagement_rate', 'Engagement Rate', totals?.engagementRate, formatSourcePercent(totals?.engagementRate)),
      sourceMetric(
        'average_session_duration',
        'Avg Session Duration',
        totals?.averageSessionDuration,
        formatSourceDuration(totals?.averageSessionDuration),
      ),
    ],
    note: totals?.note ?? null,
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
  const ga4Warnings = [
    'GA4 aggregate data only; no user-level/session-level rows.',
    'Users are non-additive across days and dimensions.',
    'Hourly timestamps are in the GA4 property timezone.',
    'Last-day/today data is processed GA4 reporting data and may change.',
    'DB/Product Events are not configured, so conversion/signup/product behavior is unavailable.',
  ];
  const coreMetrics = [
    { name: 'activeUsers' },
    { name: 'sessions' },
    { name: 'eventCount' },
    { name: 'engagedSessions' },
    { name: 'engagementRate' },
    { name: 'averageSessionDuration' },
  ];

  try {
    const [
      realtime,
      lastDayTotals,
      last7Totals,
      daily,
      totals,
      topEvents,
      topPages,
      geo,
      sessionChannels,
      sessionSourceMedium,
      landingPages,
      geoDevice,
      hourlySessions,
      hourOfDay,
    ] = await Promise.all([
      runGa4RealtimeReport(propertyId, {
        minuteRanges: [{ name: 'last_30_minutes', startMinutesAgo: 29, endMinutesAgo: 0 }],
        metrics: [{ name: 'activeUsers' }, { name: 'eventCount' }],
        limit: '10',
      }),
      runGa4Report(propertyId, {
        dateRanges: last24DateRanges,
        metrics: coreMetrics,
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
        dimensions: [{ name: 'pagePath' }, { name: 'pageTitle' }],
        metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }, { name: 'eventCount' }],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: '20',
      }),
      runGa4Report(propertyId, {
        dateRanges,
        dimensions: [{ name: 'platform' }, { name: 'deviceCategory' }, { name: 'country' }],
        metrics: [{ name: 'eventCount' }, { name: 'activeUsers' }],
        orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
        limit: '20',
      }),
      runGa4Report(propertyId, {
        dateRanges,
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [
          { name: 'sessions' },
          { name: 'activeUsers' },
          { name: 'newUsers' },
          { name: 'engagedSessions' },
          { name: 'averageSessionDuration' },
          { name: 'eventCount' },
        ],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: '12',
      }),
      runGa4Report(propertyId, {
        dateRanges,
        dimensions: [{ name: 'sessionSourceMedium' }],
        metrics: [
          { name: 'sessions' },
          { name: 'activeUsers' },
          { name: 'newUsers' },
          { name: 'engagedSessions' },
          { name: 'averageSessionDuration' },
          { name: 'eventCount' },
        ],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: '12',
      }),
      runGa4Report(propertyId, {
        dateRanges,
        dimensions: [{ name: 'sessionDefaultChannelGroup' }, { name: 'landingPage' }],
        metrics: [
          { name: 'sessions' },
          { name: 'activeUsers' },
          { name: 'engagedSessions' },
          { name: 'eventCount' },
        ],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: '15',
      }),
      runGa4Report(propertyId, {
        dateRanges,
        dimensions: [{ name: 'country' }, { name: 'deviceCategory' }],
        metrics: [
          { name: 'sessions' },
          { name: 'activeUsers' },
          { name: 'engagedSessions' },
          { name: 'eventCount' },
        ],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: '20',
      }),
      runGa4Report(propertyId, {
        dateRanges,
        dimensions: [{ name: 'dateHour' }],
        metrics: [
          { name: 'sessions' },
          { name: 'engagedSessions' },
          { name: 'averageSessionDuration' },
          { name: 'eventCount' },
          { name: 'activeUsers' },
        ],
        orderBys: [{ dimension: { dimensionName: 'dateHour' } }],
        limit: String(Math.min(range.days * 24, 2_400)),
      }),
      runGa4Report(propertyId, {
        dateRanges,
        dimensions: [{ name: 'hour' }],
        metrics: [
          { name: 'sessions' },
          { name: 'engagedSessions' },
          { name: 'eventCount' },
          { name: 'activeUsers' },
        ],
        orderBys: [{ dimension: { dimensionName: 'hour' } }],
        limit: '24',
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
    const lastDayRow = lastDayTotals.rows?.[0];
    const lastDayProcessedTotals = ga4TotalsFromRow(lastDayRow);
    const last7Row = last7Totals.rows?.[0];
    const selectedTotals = ga4TotalsFromRow(totalsRow);
    const hourlyByDateHour = new Map(
      (hourlySessions.rows ?? []).map((row) => [compactGa4DateHour(ga4Dimension(row, 0)), row]),
    );
    const hourly = dateHourSpine(range).map((dateHour) => {
      const row = hourlyByDateHour.get(dateHour);
      return {
        dateHour,
        label: formatGa4ApiDateHour(dateHour),
        sessions: ga4Metric(row, 0),
        engagedSessions: ga4Metric(row, 1),
        averageSessionDuration: ga4Metric(row, 2),
        events: ga4Metric(row, 3),
        users: ga4Metric(row, 4),
      };
    });
    const topDateHours = hourly
      .filter((row) => row.sessions > 0)
      .sort((a, b) => b.sessions - a.sessions || b.events - a.events)
      .slice(0, 12);

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
          engagedSessions: selectedTotals.engagedSessions,
          engagementRate: selectedTotals.engagementRate,
          averageSessionDuration: selectedTotals.averageSessionDuration,
        },
        sections: buildGa4Sections({
          generatedAt,
          realtime: realtimeTotals,
          last24Hours: {
            ...lastDayProcessedTotals,
            available: true,
            label: 'Last Day Aggregate',
            source: 'GA4 processed date report',
            note: 'GA4 Data API provides this as a processed yesterday-through-today date aggregate, not an exact rolling 24-hour unique-user window.',
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
            engagedSessions: ga4Metric(row, 3),
            engagementRate: ga4Metric(row, 4),
            averageSessionDuration: ga4Metric(row, 5),
          };
        }),
        topEvents: (topEvents.rows ?? []).map((row) => ({
          eventName: ga4Dimension(row, 0),
          events: ga4Metric(row, 0),
          users: ga4Metric(row, 1),
        })),
        topPages: (topPages.rows ?? []).map((row) => ({
          path: ga4Dimension(row, 0) || '(not set)',
          title: ga4Dimension(row, 1) || '(not set)',
          views: ga4Metric(row, 0),
          users: ga4Metric(row, 1),
          events: ga4Metric(row, 2),
        })),
        geo: (geo.rows ?? []).map((row) => ({
          platform: ga4Dimension(row, 0),
          deviceCategory: ga4Dimension(row, 1),
          country: ga4Dimension(row, 2),
          events: ga4Metric(row, 0),
          users: ga4Metric(row, 1),
        })),
        acquisition: {
          sessionChannels: (sessionChannels.rows ?? []).map((row) => ({
            channel: ga4Dimension(row, 0) || '(not set)',
            sessions: ga4Metric(row, 0),
            users: ga4Metric(row, 1),
            newUsers: ga4Metric(row, 2),
            engagedSessions: ga4Metric(row, 3),
            averageSessionDuration: ga4Metric(row, 4),
            events: ga4Metric(row, 5),
          })),
          sessionSourceMedium: (sessionSourceMedium.rows ?? []).map((row) => ({
            sourceMedium: ga4Dimension(row, 0) || '(not set)',
            sessions: ga4Metric(row, 0),
            users: ga4Metric(row, 1),
            newUsers: ga4Metric(row, 2),
            engagedSessions: ga4Metric(row, 3),
            averageSessionDuration: ga4Metric(row, 4),
            events: ga4Metric(row, 5),
          })),
          landingPages: (landingPages.rows ?? []).map((row) => ({
            channel: ga4Dimension(row, 0) || '(not set)',
            landingPage: ga4Dimension(row, 1) || '(not set)',
            sessions: ga4Metric(row, 0),
            users: ga4Metric(row, 1),
            engagedSessions: ga4Metric(row, 2),
            events: ga4Metric(row, 3),
          })),
          geoDevice: (geoDevice.rows ?? []).map((row) => ({
            country: ga4Dimension(row, 0) || '(not set)',
            deviceCategory: ga4Dimension(row, 1) || '(not set)',
            sessions: ga4Metric(row, 0),
            users: ga4Metric(row, 1),
            engagedSessions: ga4Metric(row, 2),
            events: ga4Metric(row, 3),
          })),
        },
        sessionTiming: {
          timezoneLabel: 'GA4 property timezone',
          hourly,
          hourOfDay: (hourOfDay.rows ?? []).map((row) => ({
            hour: ga4Dimension(row, 0) || '(not set)',
            label: `${String(ga4Dimension(row, 0) || '0').padStart(2, '0')}:00`,
            sessions: ga4Metric(row, 0),
            engagedSessions: ga4Metric(row, 1),
            events: ga4Metric(row, 2),
            users: ga4Metric(row, 3),
          })),
          topDateHours,
        },
        warnings: ga4Warnings,
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

async function fetchKaiSearchConsoleFor(
  range: HushhAiDateRange,
  productLabel: string,
  pageFilterRegex: string,
): Promise<DataResult<Record<string, unknown>>> {
  return fetchProductSearchConsole({
    productLabel,
    sourceProjectId: KAI_SEARCH_PROJECT,
    sourceDataset: KAI_SEARCH_DATASET,
    fallbackProjectId: KAI_SEARCH_FALLBACK_PROJECT,
    fallbackDataset: KAI_SEARCH_FALLBACK_DATASET,
    siteUrl: KAI_SEARCH_CONSOLE_SITE_URL,
    searchType: KAI_SEARCH_CONSOLE_TYPE,
    dataState: KAI_SEARCH_CONSOLE_DATA_STATE,
    rowLimit: KAI_SEARCH_CONSOLE_ROW_LIMIT,
    pageFilterRegex,
  }, range);
}

async function fetchKaiSearchConsole(range: HushhAiDateRange): Promise<DataResult<Record<string, unknown>>> {
  return fetchKaiSearchConsoleFor(range, 'Kai', KAI_SEARCH_CONSOLE_PAGE_FILTER_REGEX);
}

async function fetchKaiProductionSearchConsole(range: HushhAiDateRange): Promise<DataResult<Record<string, unknown>>> {
  return fetchKaiSearchConsoleFor(range, 'Kai production', KAI_PROD_SEARCH_CONSOLE_PAGE_FILTER_REGEX);
}

async function fetchKaiUatSearchConsole(range: HushhAiDateRange): Promise<DataResult<Record<string, unknown>>> {
  return fetchKaiSearchConsoleFor(range, 'Kai UAT', KAI_UAT_SEARCH_CONSOLE_PAGE_FILTER_REGEX);
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

function formatSourceDuration(value: unknown): string | null {
  const parsed = metricValue(value);
  if (parsed == null) return null;
  const seconds = Math.round(parsed);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainder}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
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
  const sections = (Array.isArray(ga4?.sections) ? ga4.sections : []).map((section) => {
    const sectionRecord = asRecord(section);
    if (!sectionRecord || sectionRecord.status !== 'waiting' || !Array.isArray(sectionRecord.metrics)) return section;
    return {
      ...sectionRecord,
      metrics: sectionRecord.metrics.map((metric) => {
        const metricRecord = asRecord(metric);
        return metricRecord ? { ...metricRecord, value: null } : metric;
      }),
    };
  });
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
      sourceMetric('users', 'Users', available ? totals.users : null),
      sourceMetric('sessions', 'Sessions', available ? totals.sessions : null),
      sourceMetric('events', 'Events', available ? totals.events : null),
    ],
    sections,
    blocker: available ? null : (typeof ga4?.note === 'string' ? ga4.note : blocker),
  };
}

function buildHushhTechGa4SourceCard(summary: Record<string, unknown>) {
  const traffic = asRecord(summary.traffic);
  const overview = asRecord(traffic?.overview) ?? {};
  const available = Boolean(traffic?.available);
  const needsVerification = hushhTechGa4NeedsVerification(traffic);
  const processedStatus = available && !needsVerification ? 'delayed' : 'waiting';
  const processedBlocker = needsVerification
    ? HUSHHTECH_GA4_ZERO_TRAFFIC_WARNING
    : String(traffic?.note ?? 'GA4 Data API is waiting or returned no traffic rows.');
  const processedValue = (value: unknown) => (needsVerification ? null : value);
  return {
    key: 'ga4',
    label: 'GA4',
    status: processedStatus,
    stateClass: sourceStateClass(processedStatus),
    source: publicGa4SourceLabel(traffic?.source ?? 'ga4-data-api'),
    freshness: {
      generatedAt: String(summary.generatedAt ?? new Date().toISOString()),
      expectedLagSeconds: 86_400,
    },
    metrics: [
      sourceMetric('active_7_day_users', '7d Active Users', processedValue(overview.active7DayUsers)),
      sourceMetric('sessions', 'Sessions', processedValue(overview.sessions)),
      sourceMetric('page_views', 'Page Views', processedValue(overview.screenPageViews)),
      sourceMetric('new_users', 'New Users', processedValue(overview.newUsers)),
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
        status: processedStatus,
        stateClass: sourceStateClass(processedStatus),
        source: 'GA4 processed report',
        freshness: {
          generatedAt: String(summary.generatedAt ?? new Date().toISOString()),
          expectedLagSeconds: 86_400,
        },
        metrics: [
          sourceMetric('users', 'Users', processedValue(overview.active1DayUsers)),
          sourceMetric('sessions', 'Sessions', processedValue(overview.sessions)),
          sourceMetric('page_views', 'Page Views', processedValue(overview.screenPageViews)),
          sourceMetric('new_users', 'New Users', processedValue(overview.newUsers)),
        ],
        blocker: processedStatus === 'delayed' ? null : processedBlocker,
      },
      {
        key: 'last_7_days',
        label: 'Last 7 Days',
        status: processedStatus,
        stateClass: sourceStateClass(processedStatus),
        source: 'GA4 processed report',
        freshness: {
          generatedAt: String(summary.generatedAt ?? new Date().toISOString()),
          expectedLagSeconds: 86_400,
        },
        metrics: [
          sourceMetric('users', 'Users', processedValue(overview.active7DayUsers)),
          sourceMetric('sessions', 'Sessions', processedValue(overview.sessions)),
          sourceMetric('page_views', 'Page Views', processedValue(overview.screenPageViews)),
          sourceMetric('new_users', 'New Users', processedValue(overview.newUsers)),
        ],
        blocker: processedStatus === 'delayed' ? null : processedBlocker,
      },
      {
        key: 'selected_total',
        label: 'Selected Total',
        status: processedStatus,
        stateClass: sourceStateClass(processedStatus),
        source: 'GA4 selected range',
        freshness: {
          generatedAt: String(summary.generatedAt ?? new Date().toISOString()),
          expectedLagSeconds: 86_400,
        },
        metrics: [
          sourceMetric('users', 'Users', processedValue(overview.active7DayUsers)),
          sourceMetric('sessions', 'Sessions', processedValue(overview.sessions)),
          sourceMetric('page_views', 'Page Views', processedValue(overview.screenPageViews)),
          sourceMetric('new_users', 'New Users', processedValue(overview.newUsers)),
        ],
        blocker: processedStatus === 'delayed' ? null : processedBlocker,
      },
    ],
    blocker: processedStatus === 'delayed' ? null : processedBlocker,
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
  const expectedEvents = [
    ['signup_started', 'Signup Started'],
    ['signup_completed', 'Signup Completed'],
    ['login', 'Login'],
    ['cta_clicked', 'CTA Clicked'],
    ['demo_requested', 'Demo Requested'],
    ['contact_submitted', 'Contact Submitted'],
    ['product_page_viewed', 'Product Page Viewed'],
  ].map(([eventName, label]) => ({
    eventName,
    label,
    status: 'not_configured',
    count: null,
    note: 'Waiting for a real hushh.ai product-event aggregate source.',
  }));

  return {
    source: 'hushh-ai-db-status',
    available: false,
    status: 'not_configured',
    generatedAt: fetchedAt,
    metrics: [],
    expectedEvents,
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
      metrics: (Array.isArray(productEvents?.expectedEvents) ? productEvents.expectedEvents : [])
        .map((event) => {
          const eventRecord = asRecord(event);
          return sourceMetric(
            String(eventRecord?.eventName ?? ''),
            String(eventRecord?.label ?? 'Product Event'),
            null,
            'Not configured',
          );
        }),
      blocker: eventsAvailable ? null : String(productEvents?.note ?? 'Hushh AI product events are not ingested into the dashboard yet.'),
    },
  ];
}

function kaiFeedMetricValue(rows: Record<string, unknown>[], group: string, name: string): number | null {
  const row = latestRowsForProductGroup(rows, group).find((item) => item.metric_name === name);
  return row ? toNumber(row.metric_count ?? row.metric_value) : null;
}

function kaiFeedMetric(rows: Record<string, unknown>[], group: string, name: string): number {
  return kaiFeedMetricValue(rows, group, name) ?? 0;
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

function buildKaiFeedSourceCard(rows: Record<string, unknown>[], environment: 'production' | 'uat', fetchedAt: string) {
  const status = buildKaiFeedStatus(rows);
  const hasSummaryRows = rows.some((row) => row.metric_group === 'summary');
  const available = rows.length > 0 && hasSummaryRows;
  const label = environment === 'production' ? 'Kai Production' : 'Kai UAT';
  return {
    key: 'product_events',
    label: 'DB / Product Events',
    status: available ? 'live' : 'waiting',
    stateClass: sourceStateClass(available ? 'live' : 'waiting'),
    source: publicProductEventsSourceLabel(label),
    freshness: {
      generatedAt: status.asOfTimestamp ?? fetchedAt,
      expectedLagSeconds: 86_400,
    },
    metrics: [
      sourceMetric('dau', 'DAU', kaiFeedMetricValue(rows, 'summary', 'current_dau')),
      sourceMetric('wau', 'WAU', kaiFeedMetricValue(rows, 'summary', 'current_wau')),
      sourceMetric('sessions', 'Sessions', kaiFeedMetricValue(rows, 'summary', 'current_sessions')),
      sourceMetric('events', 'Events', kaiFeedMetricValue(rows, 'summary', 'current_total_events')),
    ],
    blocker: available ? null : `${label} public dashboard feed is waiting for summary rows.`,
  };
}

function buildKaiProductionSourceCards(
  searchConsole: Record<string, unknown> | null,
  productionGa4: Record<string, unknown> | null,
  productionRows: Record<string, unknown>[],
  fetchedAt: string,
) {
  return [
    buildSearchConsoleSourceCard(searchConsole, 'Kai Production Search Console'),
    buildGa4SourceCard(
      productionGa4,
      `${KAI_PROD_GA4_PROJECT}.${KAI_PROD_GA4_DATASET}`,
      'Kai production GA4 export is waiting or unavailable.',
    ),
    buildKaiFeedSourceCard(productionRows, 'production', fetchedAt),
  ];
}

function buildKaiUatSourceCards(
  searchConsole: Record<string, unknown> | null,
  uatGa4: Record<string, unknown> | null,
  uatRows: Record<string, unknown>[],
  fetchedAt: string,
) {
  return [
    buildSearchConsoleSourceCard(searchConsole, 'Kai UAT Search Console'),
    buildGa4SourceCard(
      uatGa4,
      `${KAI_GA4_PROJECT}.${KAI_GA4_DATASET}`,
      'Kai UAT GA4 export is waiting or unavailable.',
    ),
    buildKaiFeedSourceCard(uatRows, 'uat', fetchedAt),
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
  const [production, uat, uatGa4, productionGa4, gcp, productionSearchConsole, uatSearchConsole] = await Promise.all([
    queryBigQuery(BQ_PROD_PROJECT, BQ_PROD_DATASET, BQ_PROD_VIEW),
    queryBigQuery(BQ_UAT_PROJECT, BQ_UAT_DATASET, BQ_UAT_VIEW),
    fetchKaiGa4Summary(kaiRange),
    fetchKaiGa4ExportSummary(KAI_PROD_GA4_PROJECT, KAI_PROD_GA4_DATASET, kaiRange, true),
    fetchCloudRunSummary(KAI_PROD_GCP_PROJECT, KAI_PROD_CLOUD_RUN_SERVICE, kaiRange, 'Kai production'),
    fetchKaiProductionSearchConsole(kaiRange),
    fetchKaiUatSearchConsole(kaiRange),
  ]);
  const fetchedAt = new Date().toISOString();
  const error = [
    production.error,
    uat.error,
    uatGa4.error,
    productionGa4.error,
    gcp.error,
    productionSearchConsole.error,
    uatSearchConsole.error,
  ].filter(Boolean).join('; ') || null;
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
      searchConsole: productionSearchConsole.data,
      productionSearchConsole: productionSearchConsole.data,
      uatSearchConsole: uatSearchConsole.data,
      gcp: gcp.data,
      freshness: buildKaiFreshness(fetchedAt, production.rows, gcp.data, productionGa4.data),
      sourceCards: buildKaiProductionSourceCards(productionSearchConsole.data, productionGa4.data, production.rows, fetchedAt),
      uatSourceCards: buildKaiUatSourceCards(uatSearchConsole.data, uatGa4.data, uat.rows, fetchedAt),
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

/**
 * Organisation-level growth summary.
 *
 * Six sections, each answering a question no single product panel can:
 * how many people we have picked up over time, what an active person costs,
 * whether the website feeds the app, how long first value takes, what organic
 * search brings in, and whether the measurement itself is trustworthy.
 *
 * Everything is aggregate. Nothing here joins identities across products: the
 * cross-product section works only because both surfaces sit in one GA4
 * property and share a device id, which is a same-device fact rather than a
 * merged person.
 */
async function fetchGrowthSummary(
  range: HushhAiDateRange,
): Promise<DataResult<Record<string, unknown>>> {
  const generatedAt = new Date().toISOString();
  const project = ONE_APP_GA4_PROJECT;
  const table = `\`${project}.${ONE_APP_GA4_DATASET}.events_*\``;
  const queryProject = BQ_JOB_PROJECT || project;
  const surface = oneAppSurfaceFilter(ONE_APP_HOST);
  const meaningful = `event_name NOT IN (${sqlNameList(ONE_BACKGROUND_EVENTS)})`;

  // A year of first-touch history, so "users picked up over time" is a real
  // curve rather than the slice the selected range happens to cover.
  const historyFilter = ga4ExportSuffixFilter(
    formatUtcDate(addUtcDays(parseUtcDate(range.endDate) as Date, -364)),
    range.endDate,
  );

  // Weekly first-touch cohorts. The running total is accumulated in TypeScript
  // rather than with a window function so the same rows serve both the weekly
  // bars and the cumulative line without a second scan.
  const usersQuery = `
    SELECT
      CAST(DATE_TRUNC(firstDay, WEEK) AS STRING) AS week,
      COUNT(DISTINCT user_pseudo_id) AS newUsers
    FROM (
      SELECT user_pseudo_id, DATE(TIMESTAMP_MICROS(user_first_touch_timestamp)) AS firstDay
      FROM ${table}
      WHERE ${historyFilter} AND ${surface} AND ${meaningful}
    )
    WHERE firstDay IS NOT NULL
    GROUP BY week
    ORDER BY week
  `;

  // New devices inside the selected range, and inside the equal-length window
  // immediately before it for the trend. The weekly curve above is
  // deliberately all-time; these are what the range picker actually moves.
  const priorEnd = addUtcDays(parseUtcDate(range.startDate) as Date, -1);
  const priorStart = addUtcDays(priorEnd, -(range.days - 1));
  const windowQuery = `
    SELECT
      COUNT(DISTINCT IF(firstDay BETWEEN DATE ${sqlStringLiteral(range.startDate)} AND DATE ${sqlStringLiteral(range.endDate)}, user_pseudo_id, NULL)) AS newUsers,
      COUNT(DISTINCT IF(firstDay BETWEEN DATE ${sqlStringLiteral(formatUtcDate(priorStart))} AND DATE ${sqlStringLiteral(formatUtcDate(priorEnd))}, user_pseudo_id, NULL)) AS priorNewUsers
    FROM (
      SELECT user_pseudo_id, DATE(TIMESTAMP_MICROS(user_first_touch_timestamp)) AS firstDay
      FROM ${table}
      WHERE ${ga4ExportSuffixFilter(formatUtcDate(priorStart), range.endDate)} AND ${surface} AND ${meaningful}
    )
  `;

  // Devices against accounts, on the same window as the users chart above so
  // the two numbers can be read side by side.
  //
  // This exists to make one gap impossible to miss: almost nobody on this
  // product is identifiable. Reporting "people" anywhere on the dashboard
  // would mean reporting only the identified slice and silently dropping the
  // rest, so the page reports devices and shows the shortfall here instead of
  // hiding it behind a single confident number.
  const identityQuery = `
    WITH scoped AS (
      SELECT
        COALESCE(platform, 'UNKNOWN') AS platform,
        user_pseudo_id,
        NULLIF(user_id, '') AS user_id
      FROM ${table}
      WHERE ${historyFilter} AND ${surface} AND ${meaningful}
    )
    SELECT
      platform,
      COUNT(DISTINCT user_pseudo_id) AS devices,
      COUNT(DISTINCT user_id) AS accounts,
      COUNT(DISTINCT IF(user_id IS NOT NULL, user_pseudo_id, NULL)) AS identifiedDevices
    FROM scoped
    GROUP BY platform
    UNION ALL
    SELECT
      '__ALL__' AS platform,
      COUNT(DISTINCT CONCAT(platform, ':', user_pseudo_id)) AS devices,
      COUNT(DISTINCT user_id) AS accounts,
      COUNT(DISTINCT IF(user_id IS NOT NULL, CONCAT(platform, ':', user_pseudo_id), NULL)) AS identifiedDevices
    FROM scoped
    ORDER BY devices DESC
  `;

  // Same-device, same-property. A visitor to the marketing site who later
  // appears on the app host is the only cross-product journey measurable
  // without merging identities, and web User-ID is empty so nothing else is
  // available. Ordering is checked so a person who used the app first and read
  // the site afterwards is not counted as a conversion.
  const crossProductQuery = `
    WITH scoped AS (
      SELECT
        PARSE_DATE('%Y%m%d', event_date) AS d,
        user_pseudo_id,
        NET.HOST((SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location')) AS host
      FROM ${table}
      WHERE ${ga4ExportSuffixFilter(range.startDate, range.endDate)}
    ),
    site AS (SELECT user_pseudo_id, MIN(d) AS firstSite FROM scoped WHERE host IN ('hushh.ai','www.hushh.ai') GROUP BY user_pseudo_id),
    app AS (SELECT user_pseudo_id, MIN(d) AS firstApp FROM scoped WHERE host = ${sqlStringLiteral(ONE_APP_HOST)} GROUP BY user_pseudo_id)
    SELECT
      (SELECT COUNT(*) FROM site) AS siteVisitors,
      (SELECT COUNT(*) FROM app) AS appWebVisitors,
      (SELECT COUNT(*) FROM site s JOIN app a USING (user_pseudo_id) WHERE a.firstApp >= s.firstSite) AS siteThenApp
  `;

  // Measured from first touch to the activation event, so it is the whole
  // journey a person experienced, not the part inside the selected window.
  // Reported as median plus a distribution: a mean would be dragged around by
  // the person who came back a month later.
  const ttfvQuery = `
    WITH activated AS (
      SELECT
        user_pseudo_id,
        MIN(TIMESTAMP_MICROS(event_timestamp)) AS activatedAt,
        ANY_VALUE(TIMESTAMP_MICROS(user_first_touch_timestamp)) AS firstTs
      FROM ${table}
      WHERE ${historyFilter} AND ${surface}
        AND event_name = 'one_location_activation_completed'
        AND user_first_touch_timestamp IS NOT NULL
      GROUP BY user_pseudo_id
    ),
    deltas AS (
      SELECT TIMESTAMP_DIFF(activatedAt, firstTs, MINUTE) AS minutes
      FROM activated WHERE activatedAt >= firstTs
    )
    SELECT
      COUNT(*) AS activatedUsers,
      APPROX_QUANTILES(minutes, 2)[OFFSET(1)] AS medianMinutes,
      MIN(minutes) AS fastestMinutes,
      MAX(minutes) AS slowestMinutes,
      COUNTIF(minutes <= 60) AS withinHour,
      COUNTIF(minutes > 60 AND minutes <= 1440) AS withinDay,
      COUNTIF(minutes > 1440 AND minutes <= 10080) AS withinWeek,
      COUNTIF(minutes > 10080) AS beyondWeek
    FROM deltas
  `;

  // Shared-param completeness on governed events only. Counting GA4's own
  // automatic events here would report a permanent deficit nobody can fix.
  const instrumentationQuery = `
    SELECT
      COUNTIF(category IS NOT NULL) AS governedEvents,
      COUNTIF(category IS NULL) AS ungovernedEvents,
      COUNT(DISTINCT event_name) AS distinctEvents,
      COUNT(DISTINCT IF(category IS NULL, event_name, NULL)) AS ungovernedEventNames
    FROM (
      SELECT
        event_name,
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'event_category') AS category
      FROM ${table}
      WHERE ${ga4ExportSuffixFilter(range.startDate, range.endDate)} AND ${surface} AND ${meaningful}
    )
  `;

  const costTable = `\`${BILLING_PROJECT}.${BILLING_DATASET}.${BILLING_TABLE}\``;
  const costQuery = `
    SELECT project.id AS project, ROUND(SUM(cost), 2) AS cost
    FROM ${costTable}
    WHERE DATE(usage_start_time) BETWEEN ${sqlStringLiteral(range.startDate)} AND ${sqlStringLiteral(range.endDate)}
    GROUP BY project
    HAVING cost > 0
    ORDER BY cost DESC
  `;

  const searchTable = `\`${HUSHH_AI_SEARCH_PROJECT}.${HUSHH_AI_SEARCH_DATASET}.searchdata_site_impression\``;
  const searchQuery = `
    SELECT
      SUM(clicks) AS clicks,
      SUM(impressions) AS impressions,
      SAFE_DIVIDE(SUM(clicks), SUM(impressions)) AS ctr,
      SAFE_DIVIDE(SUM(sum_top_position), NULLIF(SUM(impressions), 0)) + 1 AS avgPosition,
      CAST(MAX(data_date) AS STRING) AS latestDay
    FROM ${searchTable}
    WHERE data_date BETWEEN ${sqlStringLiteral(range.startDate)} AND ${sqlStringLiteral(range.endDate)}
  `;
  const searchTrendQuery = `
    SELECT CAST(DATE_TRUNC(data_date, WEEK) AS STRING) AS week,
           SUM(clicks) AS clicks, SUM(impressions) AS impressions
    FROM ${searchTable}
    WHERE data_date >= DATE_SUB(DATE ${sqlStringLiteral(range.endDate)}, INTERVAL 70 DAY)
      AND data_date <= DATE ${sqlStringLiteral(range.endDate)}
    GROUP BY week ORDER BY week
  `;

  const [users, usersWindow, identity, cross, ttfv, instrumentation, cost, search, searchTrend] = await Promise.all([
    queryBigQuerySql(queryProject, usersQuery),
    queryBigQuerySql(queryProject, windowQuery),
    queryBigQuerySql(queryProject, identityQuery),
    queryBigQuerySql(queryProject, crossProductQuery),
    queryBigQuerySql(queryProject, ttfvQuery),
    queryBigQuerySql(queryProject, instrumentationQuery),
    queryBigQuerySql(BQ_JOB_PROJECT || BILLING_PROJECT, costQuery),
    queryBigQuerySql(BQ_JOB_PROJECT || HUSHH_AI_SEARCH_PROJECT, searchQuery),
    queryBigQuerySql(BQ_JOB_PROJECT || HUSHH_AI_SEARCH_PROJECT, searchTrendQuery),
  ]);

  const errors = [
    users.error, usersWindow.error, identity.error, cross.error, ttfv.error, instrumentation.error,
    cost.error, search.error, searchTrend.error,
  ].filter(Boolean);

  let runningTotal = 0;
  const userSeries = users.rows.map((row) => {
    const newUsers = toNumber(row.newUsers);
    runningTotal += newUsers;
    return { week: String(row.week), newUsers, cumulative: runningTotal };
  });

  const windowRow = usersWindow.rows[0] ?? {};
  const crossRow = cross.rows[0] ?? {};
  const ttfvRow = ttfv.rows[0] ?? {};
  const instrumentationRow = instrumentation.rows[0] ?? {};
  const searchRow = search.rows[0] ?? {};

  const byProject = new Map(cost.rows.map((row) => [String(row.project), toNumber(row.cost)]));
  const totalCost = Array.from(byProject.values()).reduce((sum, value) => sum + value, 0);
  const mapped = new Set(COST_PROJECT_MAP.map((entry) => entry.project));
  const productCost = new Map<string, { key: string; production: number; nonProduction: number }>();
  for (const entry of COST_PROJECT_MAP) {
    const value = byProject.get(entry.project) ?? 0;
    const current = productCost.get(entry.product) ?? { key: entry.key, production: 0, nonProduction: 0 };
    if (entry.production) current.production += value;
    else current.nonProduction += value;
    productCost.set(entry.product, current);
  }
  // Anything not in the map is reported as its own line rather than silently
  // dropped -- an unattributed bill is still money, and hiding it would make
  // the product totals look like the whole picture.
  const unmapped = Array.from(byProject.entries())
    .filter(([id]) => !mapped.has(id))
    .reduce((sum, [, value]) => sum + value, 0);

  const productionCost = COST_PROJECT_MAP
    .filter((entry) => entry.production)
    .reduce((sum, entry) => sum + (byProject.get(entry.project) ?? 0), 0);

  return {
    data: {
      generatedAt,
      range: { startDate: range.startDate, endDate: range.endDate, days: range.days },
      users: {
        series: userSeries,
        totalEverSeen: runningTotal,
        window: {
          startDate: range.startDate,
          endDate: range.endDate,
          days: range.days,
          newUsers: toNumber(windowRow.newUsers),
          priorStartDate: formatUtcDate(priorStart),
          priorEndDate: formatUtcDate(priorEnd),
          priorNewUsers: toNumber(windowRow.priorNewUsers),
        },
        note: 'Distinct devices first seen on the One app surface, by week of first visit. Device-scoped, so one person on a phone and a laptop counts twice.',
      },
      // Devices against accounts. Deliberately reported as a shortfall rather
      // than resolved into one "people" figure: only the identified slice
      // could be counted as people, and that slice is small enough that
      // publishing it as the headline would erase most of the audience.
      identity: (() => {
        const allRows = identity.rows.map((row) => ({
          platform: String(row.platform ?? 'UNKNOWN'),
          devices: toNumber(row.devices),
          accounts: toNumber(row.accounts),
          identifiedDevices: toNumber(row.identifiedDevices),
        }));
        const total = allRows.find((row) => row.platform === '__ALL__');
        const rows = allRows.filter((row) => row.platform !== '__ALL__');
        const devices = total?.devices ?? 0;
        const identified = total?.identifiedDevices ?? 0;
        // This is globally distinct, not a sum of platform account counts: a
        // stable account used on iOS and web must still count once.
        const accounts = total?.accounts ?? 0;
        return {
          devices,
          accounts,
          identifiedDevices: identified,
          coverage: devices > 0 ? identified / devices : null,
          windowDays: 365,
          byPlatform: rows,
        };
      })(),
      crossProduct: {
        siteVisitors: toNumber(crossRow.siteVisitors),
        appWebVisitors: toNumber(crossRow.appWebVisitors),
        siteThenApp: toNumber(crossRow.siteThenApp),
        conversionRate: toNumber(crossRow.siteVisitors) > 0
          ? toNumber(crossRow.siteThenApp) / toNumber(crossRow.siteVisitors)
          : null,
        note: 'Same device, same analytics property. Web only -- app installs cannot be attributed to a website visit while web User-ID is unbound.',
      },
      timeToFirstValue: {
        activatedUsers: toNumber(ttfvRow.activatedUsers),
        medianMinutes: ttfvRow.medianMinutes === null || ttfvRow.medianMinutes === undefined
          ? null : toNumber(ttfvRow.medianMinutes),
        fastestMinutes: ttfvRow.fastestMinutes === null || ttfvRow.fastestMinutes === undefined
          ? null : toNumber(ttfvRow.fastestMinutes),
        slowestMinutes: ttfvRow.slowestMinutes === null || ttfvRow.slowestMinutes === undefined
          ? null : toNumber(ttfvRow.slowestMinutes),
        distribution: [
          { bucket: 'Within an hour', users: toNumber(ttfvRow.withinHour) },
          { bucket: 'Same day', users: toNumber(ttfvRow.withinDay) },
          { bucket: 'Within a week', users: toNumber(ttfvRow.withinWeek) },
          { bucket: 'Longer', users: toNumber(ttfvRow.beyondWeek) },
        ],
      },
      cost: {
        total: Math.round(totalCost * 100) / 100,
        production: Math.round(productionCost * 100) / 100,
        nonProduction: Math.round((totalCost - productionCost) * 100) / 100,
        unattributed: Math.round(unmapped * 100) / 100,
        byProduct: Array.from(productCost.entries()).map(([product, value]) => ({
          // Stable key so a consumer can attribute cost to a product without
          // string-matching a display label.
          key: value.key,
          product,
          production: Math.round(value.production * 100) / 100,
          nonProduction: Math.round(value.nonProduction * 100) / 100,
        })),
        available: cost.rows.length > 0,
      },
      organicSearch: {
        available: toNumber(searchRow.impressions) > 0,
        clicks: toNumber(searchRow.clicks),
        impressions: toNumber(searchRow.impressions),
        ctr: searchRow.ctr === null || searchRow.ctr === undefined ? null : toNumber(searchRow.ctr),
        avgPosition: searchRow.avgPosition === null || searchRow.avgPosition === undefined
          ? null : toNumber(searchRow.avgPosition),
        latestDay: searchRow.latestDay ? String(searchRow.latestDay) : null,
        series: searchTrend.rows.map((row) => ({
          week: String(row.week),
          clicks: toNumber(row.clicks),
          impressions: toNumber(row.impressions),
        })),
      },
      instrumentation: {
        governedEvents: toNumber(instrumentationRow.governedEvents),
        ungovernedEvents: toNumber(instrumentationRow.ungovernedEvents),
        distinctEvents: toNumber(instrumentationRow.distinctEvents),
        ungovernedEventNames: toNumber(instrumentationRow.ungovernedEventNames),
        // Declared in the observability contract with no live emitter. Static
        // because it is a fact about the code, not about the data.
        declaredNotEmitted: [
          'ria_verification_status_changed',
          'ria_request_blocked_policy',
          'mcp_ria_read_tool_called',
        ],
      },
    },
    error: errors.length > 0 ? errors.join('; ') : null,
  };
}

// ---------------------------------------------------------------------------
// App Store Connect — Hushh 1 iOS
// ---------------------------------------------------------------------------
//
// Official server-side APIs only, per
// https://developer.apple.com/documentation/appstoreconnectapi -- no scraping
// and no undocumented endpoint. Auth is a short-lived ES256 JWT signed with an
// App Store Connect API key
// (https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests),
// built with node:crypto so no new signing dependency is needed.
//
// Permissions: an Admin-role key is required to request a new Analytics
// Report type the first time (`ensureAppStoreConnectReportRequestId` below).
// After that request exists, a key with the Sales and Reports or Finance
// role can list and download the generated reports on every later call.
// The TestFlight endpoints below (beta testers, beta build/tester usage
// metrics, beta feedback) are gated separately from Production, per-resource
// -- Apple's role requirements are not uniform across them and are not
// encoded in the OpenAPI spec itself (only in its prose Help docs), so the
// exact role each one needs should be confirmed against that endpoint's own
// documentation rather than assumed from another endpoint in this file.
//
// Production (the App Store) and UAT (TestFlight) are two genuinely different
// Apple APIs, not one API with a channel filter:
//
// - Production uses the bulk Analytics Reports API (this section's first
//   half): impressions, product page views, downloads, conversion rate,
//   sessions, active devices, installations, deletions, crashes. Apple does
//   not publish the literal TSV column header strings for these reports
//   outside a live report sample, so columns are matched by a
//   case-insensitive "contains all these tokens" test rather than an exact
//   name. If Apple renames a column this degrades to `null` for that one
//   metric rather than silently reading the wrong column.
// - TestFlight has no equivalent bulk Analytics Reports API -- a pre-release
//   build has no App Store product page, so impressions/page views/downloads/
//   conversion rate genuinely do not exist for it. What TestFlight *does*
//   expose is a separate set of REST/metrics resources (this section's second
//   half), confirmed against Apple's published OpenAPI spec (App Store
//   Connect API v4.4.1) rather than assumed:
//     - `GET /v1/betaTesters?filter[apps]=` -- the tester roster, including
//       `attributes.state` (NOT_INVITED / INVITED / ACCEPTED / INSTALLED /
//       REVOKED). Per-tester accepted/installed state IS a documented field;
//       an earlier version of this integration said it was not, which was
//       wrong.
//     - `GET /v1/apps/{id}/metrics/betaTesterUsages?period=` -- app-level
//       sessionCount/crashCount/feedbackCount over a fixed trailing period
//       (P7D/P30D/P90D/P365D; Apple does not accept an arbitrary date range
//       here).
//     - `GET /v1/builds/{id}/metrics/betaBuildUsages` -- per-build
//       installCount/inviteCount/sessionCount/crashCount/feedbackCount as a
//       time series; this is the only place installCount/inviteCount exist.
//   What is genuinely not in the current OpenAPI spec: an app-level (not
//   per-build) install/invite count, and an arbitrary custom-date-range
//   equivalent of the `period` metrics (only the four fixed periods exist).
//   Visible in the App Store Connect UI's Builds tab, but with no
//   corresponding public REST field/endpoint found in the current spec:
//   nothing beyond what's listed above -- Installs and Sessions *are* both
//   covered, by the two metrics endpoints, contrary to what an earlier
//   version of this integration claimed.

let appStoreConnectReportRequestId: string | null = null;

function appStoreConnectConfigured(): boolean {
  return Boolean(
    APP_STORE_CONNECT_KEY_ID && APP_STORE_CONNECT_ISSUER_ID && APP_STORE_CONNECT_PRIVATE_KEY && APP_STORE_CONNECT_APP_ID,
  );
}

function base64UrlEncode(input: Buffer | string): string {
  return (Buffer.isBuffer(input) ? input : Buffer.from(input))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** A 19-minute ES256 JWT, under Apple's 20-minute cap. */
function buildAppStoreConnectToken(): string {
  const header = { alg: 'ES256', kid: APP_STORE_CONNECT_KEY_ID, typ: 'JWT' };
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload = {
    iss: APP_STORE_CONNECT_ISSUER_ID,
    iat: nowSeconds,
    exp: nowSeconds + 19 * 60,
    aud: 'appstoreconnect-v1',
  };
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  // JOSE ES256 needs the raw r||s signature, not the DER encoding node
  // produces by default -- `dsaEncoding: 'ieee-p1363'` asks for that directly.
  const signature = cryptoSign('sha256', Buffer.from(signingInput), {
    key: APP_STORE_CONNECT_PRIVATE_KEY,
    dsaEncoding: 'ieee-p1363',
  });
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

const APP_STORE_CONNECT_API_BASE = 'https://api.appstoreconnect.apple.com/v1';

async function appStoreConnectRequest(
  pathAndQuery: string,
  init?: { method?: string; body?: unknown },
): Promise<Record<string, unknown>> {
  const res = await fetch(`${APP_STORE_CONNECT_API_BASE}${pathAndQuery}`, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${buildAppStoreConnectToken()}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`App Store Connect API ${pathAndQuery} returned ${res.status}: ${body.slice(0, 300)}`);
  }
  if (res.status === 204) return {};
  return res.json() as Promise<Record<string, unknown>>;
}

/**
 * Ongoing report requests persist once created, so this reuses one across the
 * process instead of asking Apple to create a duplicate on every dashboard
 * load -- creating one also requires the Admin role, which the day-to-day
 * runtime identity may not have.
 */
async function ensureAppStoreConnectReportRequestId(): Promise<string> {
  if (appStoreConnectReportRequestId) return appStoreConnectReportRequestId;
  const list = await appStoreConnectRequest(
    `/apps/${APP_STORE_CONNECT_APP_ID}/analyticsReportRequests?filter[accessType]=ONGOING`,
  );
  const existing = (list.data as Array<Record<string, unknown>> | undefined)?.[0];
  if (existing && typeof existing.id === 'string') {
    appStoreConnectReportRequestId = existing.id;
    return appStoreConnectReportRequestId;
  }
  const created = await appStoreConnectRequest('/analyticsReportRequests', {
    method: 'POST',
    body: {
      data: {
        type: 'analyticsReportRequests',
        attributes: { accessType: 'ONGOING' },
        relationships: { app: { data: { type: 'apps', id: APP_STORE_CONNECT_APP_ID } } },
      },
    },
  });
  const createdId = (created.data as Record<string, unknown> | undefined)?.id;
  if (typeof createdId !== 'string') {
    throw new Error('App Store Connect did not return a report request id.');
  }
  appStoreConnectReportRequestId = createdId;
  return appStoreConnectReportRequestId;
}

async function findAppStoreConnectReportId(
  reportRequestId: string,
  category: string,
  nameContains: string,
): Promise<string | null> {
  const list = await appStoreConnectRequest(
    `/analyticsReportRequests/${reportRequestId}/reports?filter[category]=${category}&limit=50`,
  );
  const rows = (list.data as Array<Record<string, unknown>> | undefined) ?? [];
  const match = rows.find((row) => {
    const name = (row.attributes as Record<string, unknown> | undefined)?.name;
    return typeof name === 'string' && name.toLowerCase().includes(nameContains.toLowerCase());
  });
  return typeof match?.id === 'string' ? match.id : null;
}

async function downloadAppStoreConnectSegment(url: string): Promise<Array<Record<string, string>>> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`App Store Connect segment download returned ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const text = gunzipSync(buffer).toString('utf8');
  const lines = text.split('\n').filter((line) => line.length > 0);
  if (lines.length === 0) return [];
  const headers = lines[0].split('\t');
  return lines.slice(1).map((line) => {
    const cells = line.split('\t');
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? '';
    });
    return row;
  });
}

async function fetchAppStoreConnectReportRows(
  reportId: string,
  range: HushhAiDateRange,
): Promise<Array<Record<string, string>>> {
  const instancesResp = await appStoreConnectRequest(
    `/analyticsReports/${reportId}/instances?filter[granularity]=DAILY&limit=200`,
  );
  const instances = (instancesResp.data as Array<Record<string, unknown>> | undefined) ?? [];
  const inRange = instances.filter((instance) => {
    const date = (instance.attributes as Record<string, unknown> | undefined)?.processingDate;
    return typeof date === 'string' && date >= range.startDate && date <= range.endDate;
  });
  const rows: Array<Record<string, string>> = [];
  for (const instance of inRange) {
    const segmentsResp = await appStoreConnectRequest(`/analyticsReportInstances/${instance.id}/segments`);
    const segments = (segmentsResp.data as Array<Record<string, unknown>> | undefined) ?? [];
    for (const segment of segments) {
      const url = (segment.attributes as Record<string, unknown> | undefined)?.url;
      if (typeof url !== 'string') continue;
      rows.push(...(await downloadAppStoreConnectSegment(url)));
    }
  }
  return rows;
}

/** First header containing every token, case-insensitively. */
function findAppStoreConnectColumn(headers: string[], tokens: string[]): string | null {
  const found = headers.find((header) => {
    const lower = header.toLowerCase();
    return tokens.every((token) => lower.includes(token));
  });
  return found ?? null;
}

function sumAppStoreConnectColumn(rows: Array<Record<string, string>>, column: string | null): number | null {
  if (!column) return null;
  let total = 0;
  let sawValue = false;
  for (const row of rows) {
    const raw = row[column];
    if (raw === undefined || raw === '') continue;
    const value = Number(raw);
    if (Number.isFinite(value)) {
      total += value;
      sawValue = true;
    }
  }
  return sawValue ? total : null;
}

const APP_STORE_CONNECT_NOT_CONNECTED: { available: false; note: string; metrics: null } = {
  available: false,
  note: 'App Store Connect analytics not connected',
  metrics: null,
};

/**
 * TestFlight metrics, confirmed against Apple's published OpenAPI spec
 * (App Store Connect API v4.4.1) rather than assumed. What's left out and
 * why is in `APP_STORE_CONNECT_TESTFLIGHT_GAP_NOTE` below, not in this
 * comment, so the running note and the code agree by construction.
 */
const APP_STORE_CONNECT_TESTFLIGHT_GAP_NOTE =
  'Sessions, crashes and feedback are Apple\'s own trailing-period rollup (nearest fixed period to the selected ' +
  'window -- P7D/P30D/P90D/P365D; Apple\'s metrics API takes no arbitrary date range). Invites and installs are ' +
  'each build\'s lifetime-to-date total (Apple has no app-level total for either, and no windowed one either -- ' +
  'per build is the only granularity, and it is cumulative, not scoped to any date range), summed across builds ' +
  'uploaded inside the selected window.';

/** Every row of a paginated App Store Connect list endpoint, one page at a time. */
async function listAppStoreConnectAll(
  pathAndQuery: string,
  maxPages = 5,
): Promise<{ rows: Array<Record<string, unknown>>; truncated: boolean }> {
  const rows: Array<Record<string, unknown>> = [];
  let next: string | null = pathAndQuery;
  let pages = 0;
  while (next && pages < maxPages) {
    const resp: Record<string, unknown> = await appStoreConnectRequest(next);
    rows.push(...((resp.data as Array<Record<string, unknown>> | undefined) ?? []));
    const nextLink = (resp.links as Record<string, unknown> | undefined)?.next;
    next = typeof nextLink === 'string' ? nextLink.replace(APP_STORE_CONNECT_API_BASE, '') : null;
    pages += 1;
  }
  return { rows, truncated: Boolean(next) };
}

/** Apple's beta usage metrics take one of four fixed trailing periods, never an arbitrary range. */
function appStoreConnectPeriodFor(days: number): 'P7D' | 'P30D' | 'P90D' | 'P365D' {
  if (days <= 7) return 'P7D';
  if (days <= 30) return 'P30D';
  if (days <= 90) return 'P90D';
  return 'P365D';
}

const BETA_TESTER_STATE_KEYS: Record<string, string> = {
  NOT_INVITED: 'notInvited',
  INVITED: 'invited',
  ACCEPTED: 'accepted',
  INSTALLED: 'installed',
  REVOKED: 'revoked',
};

/** `BetaTester.attributes.state` is a documented enum -- NOT_INVITED / INVITED / ACCEPTED / INSTALLED / REVOKED. */
function summarizeBetaTesterStates(rows: Array<Record<string, unknown>>): Record<string, number> {
  const counts: Record<string, number> = { notInvited: 0, invited: 0, accepted: 0, installed: 0, revoked: 0 };
  for (const row of rows) {
    const state = (row.attributes as Record<string, unknown> | undefined)?.state;
    const key = typeof state === 'string' ? BETA_TESTER_STATE_KEYS[state] : undefined;
    if (key) counts[key] += 1;
  }
  return counts;
}

/**
 * Sums `values.<key>` across every dataPoint of every returned group.
 *
 * Confirmed against the live API rather than assumed: neither endpoint's
 * dataPoints line up with our own selected date range, so re-filtering by
 * date here would silently zero out real data rather than scope it.
 * `apps/{id}/metrics/betaTesterUsages?period=` (grouped by tester) returns
 * one dataPoint per tester spanning exactly the requested period -- already
 * scoped by Apple, nothing left to filter. `builds/{id}/metrics/betaBuildUsages`
 * returns one dataPoint per build spanning roughly the trailing year ending
 * today, regardless of any parameter -- a lifetime-to-date total, not a
 * windowed series at all.
 */
function sumAppStoreConnectMetricValues(groups: Array<Record<string, unknown>>, key: string): number | null {
  let total = 0;
  let sawValue = false;
  for (const group of groups) {
    const dataPoints = (group.dataPoints as Array<Record<string, unknown>> | undefined) ?? [];
    for (const point of dataPoints) {
      const value = (point.values as Record<string, unknown> | undefined)?.[key];
      if (typeof value === 'number') {
        total += value;
        sawValue = true;
      }
    }
  }
  return sawValue ? total : null;
}

/** No more than this many builds get a per-build usage call in one fetch, so a long-lived app cannot turn into hundreds of sequential requests on every dashboard load. */
const APP_STORE_CONNECT_MAX_BUILDS_QUERIED = 15;

async function fetchAppStoreConnectTestFlightSummary(
  range: HushhAiDateRange,
): Promise<{ available: boolean; note: string | null; generatedAt: string; range: { startDate: string; endDate: string; days: number }; metrics: Record<string, unknown> | null }> {
  const generatedAt = new Date().toISOString();
  const rangeOut = { startDate: range.startDate, endDate: range.endDate, days: range.days };

  if (!appStoreConnectConfigured()) {
    return { available: false, note: 'App Store Connect analytics not connected', generatedAt, range: rangeOut, metrics: null };
  }

  const errors: string[] = [];
  async function safely<T>(label: string, run: () => Promise<T>): Promise<T | null> {
    try {
      return await run();
    } catch (err) {
      errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  const [testerResult, usageResult, buildsResult] = await Promise.all([
    safely('beta testers', () => listAppStoreConnectAll(`/betaTesters?filter[apps]=${APP_STORE_CONNECT_APP_ID}&limit=200`)),
    safely('beta tester usage', () => appStoreConnectRequest(
      // `groupBy=betaTesters` is required here -- the live API rejects the call
      // with PARAMETER_ERROR.REQUIRED without it (the OpenAPI spec lists it as
      // optional; it is not, in practice). `limit` is rejected outright unless
      // paired with `groupBy`/`filter`, so it is left off; grouping by tester
      // already bounds the response to one entry per tester.
      `/apps/${APP_STORE_CONNECT_APP_ID}/metrics/betaTesterUsages?period=${appStoreConnectPeriodFor(range.days)}&groupBy=betaTesters`,
    )),
    safely('builds', () => listAppStoreConnectAll(
      `/builds?filter[app]=${APP_STORE_CONNECT_APP_ID}&fields[builds]=uploadedDate&sort=-uploadedDate&limit=200`,
    )),
  ]);

  const testerCount = testerResult ? testerResult.rows.length : null;
  const testersByState = testerResult ? summarizeBetaTesterStates(testerResult.rows) : null;

  const usageGroups = (usageResult?.data as Array<Record<string, unknown>> | undefined) ?? [];
  const sessions = usageResult ? sumAppStoreConnectMetricValues(usageGroups, 'sessionCount') : null;
  const crashes = usageResult ? sumAppStoreConnectMetricValues(usageGroups, 'crashCount') : null;
  const feedback = usageResult ? sumAppStoreConnectMetricValues(usageGroups, 'feedbackCount') : null;

  // installCount/inviteCount exist only per build (GET /v1/builds/{id}/metrics/betaBuildUsages,
  // no `limit` param -- rejected outright), not at the app level, so this queries every build
  // uploaded inside the window, capped. Each build's numbers are that build's lifetime-to-date
  // totals (roughly the trailing year), not scoped to the window -- see the note this feeds.
  const buildIdsInRange = (buildsResult?.rows ?? [])
    .filter((row) => {
      const uploadedDate = (row.attributes as Record<string, unknown> | undefined)?.uploadedDate;
      return typeof uploadedDate === 'string' && uploadedDate.slice(0, 10) >= range.startDate && uploadedDate.slice(0, 10) <= range.endDate;
    })
    .map((row) => row.id)
    .filter((id): id is string => typeof id === 'string');
  const buildIdsQueried = buildIdsInRange.slice(0, APP_STORE_CONNECT_MAX_BUILDS_QUERIED);
  const buildUsageResults = buildIdsQueried.length
    ? await Promise.all(buildIdsQueried.map((buildId) =>
        safely(`build ${buildId} usage`, () => appStoreConnectRequest(`/builds/${buildId}/metrics/betaBuildUsages`)),
      ))
    : [];
  const fetchedAnyBuildUsage = buildUsageResults.some((result) => result !== null);
  const buildUsageGroups = buildUsageResults
    .filter((result): result is Record<string, unknown> => result !== null)
    .flatMap((result) => (result.data as Array<Record<string, unknown>> | undefined) ?? []);
  const invites = fetchedAnyBuildUsage ? sumAppStoreConnectMetricValues(buildUsageGroups, 'inviteCount') : null;
  const installs = fetchedAnyBuildUsage ? sumAppStoreConnectMetricValues(buildUsageGroups, 'installCount') : null;

  const anyAvailable = [testerCount, sessions, crashes, feedback, invites, installs].some((value) => value !== null);
  const notes = [
    anyAvailable ? APP_STORE_CONNECT_TESTFLIGHT_GAP_NOTE : null,
    buildIdsInRange.length > APP_STORE_CONNECT_MAX_BUILDS_QUERIED
      ? `${buildIdsInRange.length} builds were uploaded in this window; invites/installs were summed from the ${APP_STORE_CONNECT_MAX_BUILDS_QUERIED} most recent only.`
      : null,
  ].filter((value): value is string => Boolean(value));

  return {
    available: anyAvailable,
    note: notes.length
      ? notes.join(' ')
      : publicIntegrationError('App Store Connect TestFlight', new Error(errors.join('; ') || 'request failed')),
    generatedAt,
    range: rangeOut,
    metrics: anyAvailable ? { testerCount, testersByState, invites, installs, sessions, crashes, feedback } : null,
  };
}

async function fetchAppStoreConnectProductionSummary(
  range: HushhAiDateRange,
): Promise<{ available: boolean; note: string | null; generatedAt?: string; range?: { startDate: string; endDate: string; days: number }; metrics: Record<string, number | null> | null }> {
  if (!appStoreConnectConfigured()) {
    return APP_STORE_CONNECT_NOT_CONNECTED;
  }

  try {
    const reportRequestId = await ensureAppStoreConnectReportRequestId();
    const [engagementReportId, downloadsReportId, sessionsReportId, installDeleteReportId, crashesReportId] =
      await Promise.all([
        findAppStoreConnectReportId(reportRequestId, 'APP_STORE_ENGAGEMENT', 'discovery and engagement'),
        findAppStoreConnectReportId(reportRequestId, 'COMMERCE', 'downloads standard'),
        findAppStoreConnectReportId(reportRequestId, 'APP_USAGE', 'sessions'),
        findAppStoreConnectReportId(reportRequestId, 'APP_USAGE', 'installation and deletion standard'),
        findAppStoreConnectReportId(reportRequestId, 'APP_USAGE', 'crashes'),
      ]);

    const [engagementRows, downloadRows, sessionRows, installDeleteRows, crashRows] = await Promise.all([
      engagementReportId ? fetchAppStoreConnectReportRows(engagementReportId, range) : Promise.resolve([]),
      downloadsReportId ? fetchAppStoreConnectReportRows(downloadsReportId, range) : Promise.resolve([]),
      sessionsReportId ? fetchAppStoreConnectReportRows(sessionsReportId, range) : Promise.resolve([]),
      installDeleteReportId ? fetchAppStoreConnectReportRows(installDeleteReportId, range) : Promise.resolve([]),
      crashesReportId ? fetchAppStoreConnectReportRows(crashesReportId, range) : Promise.resolve([]),
    ]);

    const engagementHeaders = engagementRows[0] ? Object.keys(engagementRows[0]) : [];
    const downloadHeaders = downloadRows[0] ? Object.keys(downloadRows[0]) : [];
    const sessionHeaders = sessionRows[0] ? Object.keys(sessionRows[0]) : [];
    const installDeleteHeaders = installDeleteRows[0] ? Object.keys(installDeleteRows[0]) : [];
    const crashHeaders = crashRows[0] ? Object.keys(crashRows[0]) : [];

    const impressions = sumAppStoreConnectColumn(engagementRows, findAppStoreConnectColumn(engagementHeaders, ['impression']));
    const productPageViews = sumAppStoreConnectColumn(
      engagementRows,
      findAppStoreConnectColumn(engagementHeaders, ['page', 'view']),
    );
    const firstTimeDownloads = sumAppStoreConnectColumn(
      downloadRows,
      findAppStoreConnectColumn(downloadHeaders, ['first', 'download']),
    );
    const redownloads = sumAppStoreConnectColumn(downloadRows, findAppStoreConnectColumn(downloadHeaders, ['redownload']));
    const totalDownloadsColumn =
      findAppStoreConnectColumn(downloadHeaders, ['total', 'download']) ??
      findAppStoreConnectColumn(downloadHeaders, ['download']);
    let totalDownloads = sumAppStoreConnectColumn(downloadRows, totalDownloadsColumn);
    if (totalDownloads === null && (firstTimeDownloads !== null || redownloads !== null)) {
      totalDownloads = (firstTimeDownloads ?? 0) + (redownloads ?? 0);
    }
    const sessions = sumAppStoreConnectColumn(sessionRows, findAppStoreConnectColumn(sessionHeaders, ['session']));
    const activeDevices =
      sumAppStoreConnectColumn(sessionRows, findAppStoreConnectColumn(sessionHeaders, ['unique', 'device'])) ??
      sumAppStoreConnectColumn(sessionRows, findAppStoreConnectColumn(sessionHeaders, ['device']));
    const installations = sumAppStoreConnectColumn(installDeleteRows, findAppStoreConnectColumn(installDeleteHeaders, ['install']));
    const deletions = sumAppStoreConnectColumn(installDeleteRows, findAppStoreConnectColumn(installDeleteHeaders, ['delet']));
    const crashes = sumAppStoreConnectColumn(crashRows, findAppStoreConnectColumn(crashHeaders, ['crash']));
    const conversionRate = totalDownloads !== null && productPageViews ? totalDownloads / productPageViews : null;

    const anyMetricFound = [
      impressions, productPageViews, firstTimeDownloads, redownloads, totalDownloads,
      sessions, activeDevices, installations, deletions, crashes,
    ].some((value) => value !== null);

    return {
      available: anyMetricFound,
      note: anyMetricFound
        ? null
        : 'App Store Connect responded but no matching report columns were found for this window. A newly ' +
          'created ONGOING report request can take 24-48 hours to produce its first report.',
      generatedAt: new Date().toISOString(),
      range: { startDate: range.startDate, endDate: range.endDate, days: range.days },
      // `null`, not a bag of nulls, when unavailable -- matching every other unavailable
      // case in this file (not-connected, request-failed, TestFlight's own unavailable branch).
      metrics: !anyMetricFound ? null : {
        impressions, productPageViews, firstTimeDownloads, redownloads, totalDownloads,
        conversionRate, sessions, activeDevices, installations, crashes, deletions,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('App Store Connect production analytics failed:', message);
    return {
      available: false,
      note: publicIntegrationError('App Store Connect', err),
      metrics: null,
    };
  }
}

/**
 * Fetches Production (App Store) and UAT (TestFlight) independently -- they
 * are two unrelated Apple APIs (Analytics Reports vs. plain REST resources),
 * so one failing does not take the other down.
 */
async function fetchAppStoreConnectSummary(range: HushhAiDateRange): Promise<DataResult<Record<string, unknown>>> {
  const [production, testflight] = await Promise.all([
    fetchAppStoreConnectProductionSummary(range),
    fetchAppStoreConnectTestFlightSummary(range),
  ]);
  // "Not connected" (no credentials configured) is a setup state, not a
  // fetch failure -- only surface `error` when credentials exist and a real
  // request still failed, so a fresh, unconfigured deploy does not add a
  // permanent warning to every dashboard load.
  const error = appStoreConnectConfigured()
    ? [!production.available ? production.note : null, !testflight.available ? testflight.note : null]
        .filter(Boolean).join('; ') || null
    : null;

  return {
    data: { appAppleId: APP_STORE_CONNECT_APP_ID, production, testflight },
    error,
  };
}

app.get('/api/analytics/app-store-connect', async (req, res) => {
  const range = parseAppStoreConnectDateRange(req.query as Record<string, unknown>);
  const result = await fetchAppStoreConnectSummary(range);
  res.status(result.error && !result.data ? 502 : 200).json(sanitizePublicPayload({
    platform: 'Hushh 1 iOS',
    data: result.data,
    error: result.error,
    fetchedAt: new Date().toISOString(),
  }));
});

app.get('/api/analytics/one', async (req, res) => {
  const oneRange = parseOneAppDateRange(req.query as Record<string, unknown>);
  const [production, uat] = await Promise.all([
    fetchOneAppSummary(ONE_APP_GA4_PROJECT, ONE_APP_GA4_DATASET, oneRange, true),
    fetchOneAppSummary(ONE_APP_UAT_GA4_PROJECT, ONE_APP_UAT_GA4_DATASET, oneRange, true, ONE_APP_UAT_HOST),
  ]);
  const error = [production.error, uat.error].filter(Boolean).join('; ') || null;
  const fetchedAt = new Date().toISOString();
  res.status(error && !production.data && !uat.data ? 502 : 200).json(sanitizePublicPayload({
    platform: 'one.hushh.ai',
    data: { production: production.data, uat: uat.data },
    error,
    fetchedAt,
  }));
});

app.get('/api/analytics/growth', async (req, res) => {
  const range = parseOneAppDateRange(req.query as Record<string, unknown>);
  const growth = await fetchGrowthSummary(range);
  res.status(growth.error && !growth.data ? 502 : 200).json(sanitizePublicPayload({
    platform: 'organisation',
    data: growth.data,
    error: growth.error,
    fetchedAt: new Date().toISOString(),
  }));
});

// The same organisation-level summary over three fixed windows, side by side.
// Fetched on its own rather than folded into /all because it is three more
// growth scans and only one tab reads it.
app.get('/api/analytics/growth/compare', async (_req, res) => {
  const windows = [
    { key: '30d', label: 'Last 30 days', range: trailingDateRange(30) },
    { key: '90d', label: 'Last 90 days', range: trailingDateRange(90) },
    { key: 'all', label: 'All time', range: allTimeDateRange() },
  ];
  const results = await Promise.all(windows.map((window) => fetchGrowthSummary(window.range)));
  const error = results.map((result) => result.error).filter(Boolean).join('; ') || null;
  res.status(error && results.every((result) => !result.data) ? 502 : 200).json(sanitizePublicPayload({
    platform: 'organisation',
    windows: windows.map((window, index) => ({
      key: window.key,
      label: window.label,
      range: { startDate: window.range.startDate, endDate: window.range.endDate, days: window.range.days },
      data: results[index].data,
      error: results[index].error,
    })),
    error,
    fetchedAt: new Date().toISOString(),
  }));
});

app.get('/api/analytics/all', async (req, res) => {
  const hushhAiRange = parseHushhAiDateRange(req.query as Record<string, unknown>);
  const kaiRange = parseKaiDateRange(req.query as Record<string, unknown>);
  const hushhTechRange = parseHushhTechDateRange(req.query as Record<string, unknown>);
  const oneRange = parseOneAppDateRange(req.query as Record<string, unknown>);
  const appStoreConnectRange = parseAppStoreConnectDateRange(req.query as Record<string, unknown>);
  const [
    uat,
    production,
    kaiGa4,
    kaiProductionGa4,
    kaiProductionGcp,
    kaiProductionSearchConsole,
    kaiUatSearchConsole,
    hushhAiGcp,
    hushhAiSearchConsole,
    hushhAiGa4,
    hushhTech,
    oneAppProduction,
    oneAppUat,
    growth,
    appStoreConnect,
  ] = await Promise.all([
    queryBigQuery(BQ_UAT_PROJECT, BQ_UAT_DATASET, BQ_UAT_VIEW, kaiRange),
    queryBigQuery(BQ_PROD_PROJECT, BQ_PROD_DATASET, BQ_PROD_VIEW, kaiRange),
    fetchKaiGa4Summary(kaiRange),
    fetchKaiGa4ExportSummary(KAI_PROD_GA4_PROJECT, KAI_PROD_GA4_DATASET, kaiRange, true),
    fetchCloudRunSummary(KAI_PROD_GCP_PROJECT, KAI_PROD_CLOUD_RUN_SERVICE, kaiRange, 'Kai production'),
    fetchKaiProductionSearchConsole(kaiRange),
    fetchKaiUatSearchConsole(kaiRange),
    fetchHushhAiCloudRun(hushhAiRange),
    fetchHushhAiSearchConsole(hushhAiRange),
    fetchHushhAiGa4Summary(hushhAiRange),
    fetchHushhTechAnalytics(hushhTechRange),
    fetchOneAppSummary(ONE_APP_GA4_PROJECT, ONE_APP_GA4_DATASET, oneRange, true),
    fetchOneAppSummary(ONE_APP_UAT_GA4_PROJECT, ONE_APP_UAT_GA4_DATASET, oneRange, true, ONE_APP_UAT_HOST),
    fetchGrowthSummary(oneRange),
    fetchAppStoreConnectSummary(appStoreConnectRange),
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
            status: buildKaiFeedStatus(production.rows),
          },
          uatFeed: {
            status: buildKaiFeedStatus(uat.rows),
          },
          uatGa4: kaiGa4.data,
          productionGa4: kaiProductionGa4.data,
          searchConsole: kaiProductionSearchConsole.data,
          productionSearchConsole: kaiProductionSearchConsole.data,
          uatSearchConsole: kaiUatSearchConsole.data,
          gcp: kaiProductionGcp.data,
          freshness: buildKaiFreshness(fetchedAt, production.rows, kaiProductionGcp.data, kaiProductionGa4.data),
          sourceCards: buildKaiProductionSourceCards(kaiProductionSearchConsole.data, kaiProductionGa4.data, production.rows, fetchedAt),
          uatSourceCards: buildKaiUatSourceCards(kaiUatSearchConsole.data, kaiGa4.data, uat.rows, fetchedAt),
        },
        error: [
          production.error,
          uat.error,
          kaiGa4.error,
          kaiProductionGa4.error,
          kaiProductionGcp.error,
          kaiProductionSearchConsole.error,
          kaiUatSearchConsole.error,
        ].filter(Boolean).join('; ') || null,
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
    one: {
      platform: 'one.hushh.ai',
      data: { production: oneAppProduction.data, uat: oneAppUat.data },
      error: [oneAppProduction.error, oneAppUat.error].filter(Boolean).join('; ') || null,
    },
    growth: { platform: 'organisation', data: growth.data, error: growth.error },
    appStoreConnect: { platform: 'Hushh 1 iOS', data: appStoreConnect.data, error: appStoreConnect.error },
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
      appStoreConnectAppId: APP_STORE_CONNECT_APP_ID,
      appStoreConnectConfigured: appStoreConnectConfigured(),
    },
  }));
});

// ---------------------------------------------------------------------------
// Hussh Insights AI — production analyst agent
// ---------------------------------------------------------------------------

type ProductKey = 'hushh.ai' | 'kai.hushh.ai' | 'uat.kai.hushh.ai' | 'hushhtech.com';
type AgentConfidence = 'high' | 'medium' | 'low';
type AgentWindow = 'calendar_days' | 'last_24_hours';

interface AgentRange {
  startDate: string;
  endDate: string;
  days: number;
}

interface MetricClaim {
  product: ProductKey;
  metric: string;
  label: string;
  value: number | string | null;
  unit: string;
  source: string;
  range: AgentRange;
}

interface AgentSource {
  product: ProductKey;
  source: string;
  status: string;
  available: boolean;
  generatedAt?: string | null;
  expectedLagSeconds?: number | null;
  detail?: string | null;
}

interface AgentAnswer {
  reply: string;
  claims: MetricClaim[];
  sources: AgentSource[];
  warnings: string[];
  confidence: AgentConfidence;
  suggestedQuestions?: string[];
}

interface AgentToolResult {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  data: unknown;
  warning?: string;
}

interface ProductMetrics {
  product: ProductKey;
  range: AgentRange;
  cloudRun?: Record<string, unknown> | null;
  ga4?: Record<string, unknown> | null;
  searchConsole?: Record<string, unknown> | null;
  businessFunnel?: Record<string, unknown> | null;
  traffic?: Record<string, unknown> | null;
  supabase?: Record<string, unknown> | null;
  productEvents?: Record<string, unknown> | null;
  sourceStatuses: AgentSource[];
  warnings: string[];
}

interface MetricsSnapshot {
  generatedAt: string;
  window: AgentWindow;
  windowLabel: string;
  range: AgentRange;
  products: Record<ProductKey, ProductMetrics>;
  catalog: Array<Record<string, unknown>>;
}

interface MetricFieldCatalogEntry {
  id: string;
  product: ProductKey;
  source: string;
  label: string;
  unit: string;
  description: string;
  synonyms: string[];
  caveat?: string;
  exampleQuestions: string[];
}

interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_METRICS_CHAT_MODEL = process.env.GEMINI_METRICS_CHAT_MODEL || 'gemini-2.5-flash';
const METRICS_CHAT_RATE_LIMIT_HOURLY = parseInt(process.env.METRICS_CHAT_RATE_LIMIT_HOURLY || '60', 10);
const METRICS_CHAT_RATE_LIMIT_DAILY = parseInt(process.env.METRICS_CHAT_RATE_LIMIT_DAILY || '300', 10);
const METRICS_CHAT_REQUEST_TIMEOUT_MS = Math.max(
  10_000,
  Math.min(parseInt(process.env.METRICS_CHAT_REQUEST_TIMEOUT_MS || '45_000', 10) || 45_000, 90_000),
);
const METRICS_CHAT_CONTEXT_CACHE_SECONDS = Math.max(
  5,
  Math.min(parseInt(process.env.METRICS_CHAT_CONTEXT_CACHE_SECONDS || '30', 10) || 30, 180),
);
const METRICS_CHAT_MAX_TOOL_ROUNDS = 2;
const METRICS_CHAT_MAX_OUTPUT_TOKENS = 2048;

const chatRateBuckets = new Map<string, { hourly: number; daily: number; hourReset: number; dayReset: number }>();
let metricsSnapshotCache: { key: string; expiresAt: number; promise: Promise<MetricsSnapshot> } | null = null;

const PRODUCT_KEYS = ['hushh.ai', 'kai.hushh.ai', 'uat.kai.hushh.ai', 'hushhtech.com'] as const;

const METRIC_FIELD_CATALOG: MetricFieldCatalogEntry[] = [
  {
    id: 'cloud_run.request_count',
    product: 'hushh.ai',
    source: 'cloud_run',
    label: 'Cloud Run requests',
    unit: 'requests',
    description: 'Near-live server request volume for the production hushh.ai Cloud Run service.',
    synonyms: ['traffic', 'requests', 'server hits', 'api requests', 'site requests'],
    caveat: 'Requests are infrastructure events, not people or accounts.',
    exampleQuestions: ['How many Cloud Run requests did hushh.ai receive?', 'Is hushh.ai traffic up today?'],
  },
  {
    id: 'ga4.users',
    product: 'hushh.ai',
    source: 'ga4',
    label: 'GA4 web users',
    unit: 'users',
    description: 'Distinct web audience users reported by the hushh.ai GA4 aggregate source.',
    synonyms: ['web users', 'visitors', 'audience users', 'site users'],
    caveat: 'GA4 users are browser/device audience users and are not de-duplicated product accounts.',
    exampleQuestions: ['How many hushh.ai web users do we have?', 'Compare hushh.ai GA4 users with hushhtech users.'],
  },
  {
    id: 'search_console.clicks',
    product: 'hushh.ai',
    source: 'search_console',
    label: 'Search clicks',
    unit: 'clicks',
    description: 'Organic Google Search clicks for hushh.ai from Search Console aggregates.',
    synonyms: ['seo clicks', 'google clicks', 'organic clicks', 'search traffic'],
    exampleQuestions: ['How many search clicks did hushh.ai get?', 'What search terms drove hushh.ai traffic?'],
  },
  {
    id: 'cloud_run.request_count',
    product: 'kai.hushh.ai',
    source: 'cloud_run',
    label: 'Production Cloud Run requests',
    unit: 'requests',
    description: 'Near-live server request volume for the production kai.hushh.ai Cloud Run service.',
    synonyms: ['kai production traffic', 'prod requests', 'server requests', 'cloud run traffic'],
    caveat: 'Production request volume should not be interpreted as users.',
    exampleQuestions: ['How many production requests did kai.hushh.ai receive?', 'Show Kai production reliability.'],
  },
  {
    id: 'ga4.users',
    product: 'kai.hushh.ai',
    source: 'production_ga4',
    label: 'Production GA4 users',
    unit: 'users',
    description: 'Production kai.hushh.ai GA4 web-user aggregate when the production export is available.',
    synonyms: ['kai production users', 'prod ga4 users', 'production visitors'],
    caveat: 'If production GA4 is waiting, do not substitute UAT values.',
    exampleQuestions: ['How many users does Kai production have?', 'Is Kai production GA4 ready?'],
  },
  {
    id: 'ga4.users',
    product: 'uat.kai.hushh.ai',
    source: 'uat_ga4',
    label: 'UAT GA4 users',
    unit: 'users',
    description: 'UAT kai.hushh.ai GA4 web-user aggregate used for validation and UAT behavior analysis.',
    synonyms: ['kai uat users', 'uat visitors', 'testing users', 'uat ga4 users'],
    caveat: 'UAT values must remain separate from production Kai truth.',
    exampleQuestions: ['How many users are on Kai UAT?', 'Compare Kai production and UAT users.'],
  },
  {
    id: 'product_events.dau',
    product: 'uat.kai.hushh.ai',
    source: 'uat_feed',
    label: 'UAT DB DAU',
    unit: 'users',
    description: 'Daily active users from the Kai UAT public DB aggregate feed.',
    synonyms: ['uat dau', 'daily active users', 'active users', 'kai uat db users'],
    caveat: 'This is a UAT aggregate feed and is not production product-account truth.',
    exampleQuestions: ['What is Kai UAT DAU?', 'Show Kai UAT DB activity.'],
  },
  {
    id: 'product_events.total_events',
    product: 'uat.kai.hushh.ai',
    source: 'uat_feed',
    label: 'UAT DB events',
    unit: 'events',
    description: 'Total aggregate product events from the Kai UAT public DB feed.',
    synonyms: ['uat events', 'db events', 'product events', 'kai uat activity'],
    exampleQuestions: ['How many Kai UAT events happened?', 'Compare UAT GA4 events with UAT DB events.'],
  },
  {
    id: 'supabase.total_users',
    product: 'hushhtech.com',
    source: 'supabase',
    label: 'Total product users',
    unit: 'users',
    description: 'Aggregate total user/account count from hushhtech.com Supabase product data.',
    synonyms: ['total users', 'accounts', 'registered users', 'product users', 'customers'],
    caveat: 'This is product-account truth for hushhtech.com only, not a cross-product de-duplicated user table.',
    exampleQuestions: ['How many hushhtech.com users are there?', 'How many total product users does hushhtech have?'],
  },
  {
    id: 'funnel.signup_to_persisted_rate',
    product: 'hushhtech.com',
    source: 'business_funnel',
    label: 'Signup to persisted conversion',
    unit: '%',
    description: 'Conversion rate from signup events to persisted users in the hushhtech.com business funnel.',
    synonyms: ['signup conversion', 'persisted conversion', 'activation rate', 'signup to user rate'],
    exampleQuestions: ['What is hushhtech.com signup conversion?', 'Where is hushhtech funnel dropping?'],
  },
  {
    id: 'traffic.sessions',
    product: 'hushhtech.com',
    source: 'ga4_traffic',
    label: 'GA4 sessions',
    unit: 'sessions',
    description: 'Aggregate GA4 sessions for hushhtech.com web traffic.',
    synonyms: ['sessions', 'visits', 'web sessions', 'traffic sessions'],
    exampleQuestions: ['How many hushhtech sessions do we have?', 'Is hushhtech traffic active?'],
  },
  {
    id: 'search_console.clicks',
    product: 'hushhtech.com',
    source: 'search_console',
    label: 'Search clicks',
    unit: 'clicks',
    description: 'Organic Google Search clicks for hushhtech.com from Search Console aggregates.',
    synonyms: ['seo clicks', 'organic clicks', 'google clicks', 'search performance'],
    exampleQuestions: ['What are top hushhtech search queries?', 'How many organic clicks did hushhtech get?'],
  },
];

const METRIC_CATALOG = PRODUCT_KEYS.map((product) => {
  const fields = METRIC_FIELD_CATALOG.filter((field) => field.product === product);
  return {
    product,
    sources: Array.from(new Set(fields.map((field) => field.source))),
    metrics: Array.from(new Set(fields.map((field) => field.id))),
    fields,
    exampleQuestions: fields.flatMap((field) => field.exampleQuestions).slice(0, 8),
  };
}) satisfies Array<Record<string, unknown>>;

const METRICS_TOOL_DECLARATIONS = [
  {
    name: 'get_metric_catalog',
    description: 'Returns the aggregate-only metric ids, products, and source families available to Hussh Insights AI.',
    parametersJsonSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'get_product_metrics',
    description: 'Returns aggregate metrics for one Hushh product or all products. Use this before making numeric claims.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        product: {
          type: 'string',
          enum: ['all', 'hushh.ai', 'kai.hushh.ai', 'uat.kai.hushh.ai', 'hushhtech.com'],
          description: 'Product to retrieve. Use all for cross-product comparisons.',
        },
        rangeDays: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_HUSHH_AI_RANGE_DAYS,
          description: 'Calendar-day range to summarize. Defaults to 7.',
        },
        window: {
          type: 'string',
          enum: ['calendar_days', 'last_24_hours'],
          description: 'Use last_24_hours for last day, past 24 hours, or 24-hour report questions.',
        },
      },
      required: ['product'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_source_status',
    description: 'Returns source availability and freshness for product metrics without raw provider diagnostics.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        product: {
          type: 'string',
          enum: ['all', 'hushh.ai', 'kai.hushh.ai', 'uat.kai.hushh.ai', 'hushhtech.com'],
          description: 'Product to inspect. Use all for the full source matrix.',
        },
        source: {
          type: 'string',
          description: 'Optional source key such as cloud_run, ga4, search_console, product_events, or business_funnel.',
        },
        rangeDays: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_HUSHH_AI_RANGE_DAYS,
          description: 'Calendar-day range to summarize. Defaults to 7.',
        },
        window: {
          type: 'string',
          enum: ['calendar_days', 'last_24_hours'],
          description: 'Use last_24_hours for last day, past 24 hours, or 24-hour report questions.',
        },
      },
      required: ['product'],
      additionalProperties: false,
    },
  },
];

const AGENT_ANSWER_SCHEMA = {
  type: 'object',
  required: ['reply', 'claims', 'sources', 'warnings', 'confidence', 'suggestedQuestions'],
  additionalProperties: false,
  properties: {
    reply: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    warnings: { type: 'array', items: { type: 'string' } },
    claims: {
      type: 'array',
      items: {
        type: 'object',
        required: ['product', 'metric', 'label', 'value', 'unit', 'source', 'range'],
        additionalProperties: false,
        properties: {
          product: { type: 'string', enum: ['hushh.ai', 'kai.hushh.ai', 'uat.kai.hushh.ai', 'hushhtech.com'] },
          metric: { type: 'string' },
          label: { type: 'string' },
          value: { anyOf: [{ type: 'number' }, { type: 'string' }, { type: 'null' }] },
          unit: { type: 'string' },
          source: { type: 'string' },
          range: {
            type: 'object',
            required: ['startDate', 'endDate', 'days'],
            additionalProperties: false,
            properties: {
              startDate: { type: 'string' },
              endDate: { type: 'string' },
              days: { type: 'integer' },
            },
          },
        },
      },
    },
    sources: {
      type: 'array',
      items: {
        type: 'object',
        required: ['product', 'source', 'status', 'available'],
        additionalProperties: false,
        properties: {
          product: { type: 'string', enum: ['hushh.ai', 'kai.hushh.ai', 'uat.kai.hushh.ai', 'hushhtech.com'] },
          source: { type: 'string' },
          status: { type: 'string' },
          available: { type: 'boolean' },
          generatedAt: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          expectedLagSeconds: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          detail: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        },
      },
    },
    suggestedQuestions: {
      type: 'array',
      items: { type: 'string' },
      minItems: 0,
      maxItems: 6,
    },
  },
};

function checkChatRateLimit(ip: string): boolean {
  const now = Date.now();
  let bucket = chatRateBuckets.get(ip);
  if (!bucket) {
    bucket = { hourly: 0, daily: 0, hourReset: now + 3_600_000, dayReset: now + 86_400_000 };
    chatRateBuckets.set(ip, bucket);
  }
  if (now > bucket.hourReset) { bucket.hourly = 0; bucket.hourReset = now + 3_600_000; }
  if (now > bucket.dayReset) { bucket.daily = 0; bucket.dayReset = now + 86_400_000; }
  if (chatRateBuckets.size > 10_000) {
    for (const [key, value] of chatRateBuckets.entries()) {
      if (now > value.hourReset && now > value.dayReset) chatRateBuckets.delete(key);
    }
  }
  if (bucket.hourly >= METRICS_CHAT_RATE_LIMIT_HOURLY || bucket.daily >= METRICS_CHAT_RATE_LIMIT_DAILY) return false;
  bucket.hourly++;
  bucket.daily++;
  return true;
}

function clampChatRangeDays(value: unknown): number {
  const parsed = Number(value ?? 7);
  return Math.max(1, Math.min(Number.isFinite(parsed) ? Math.floor(parsed) : 7, MAX_HUSHH_AI_RANGE_DAYS));
}

function agentRange(range: HushhAiDateRange): AgentRange {
  return {
    startDate: range.startDate,
    endDate: range.endDate,
    days: range.days,
  };
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(asRecord(item)))
    : [];
}

function optionalNumber(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeAgentText(value: string): string {
  return value
    .replace(/\b[A-Z0-9_]*(?:KEY|TOKEN|SECRET|URL)[A-Z0-9_]*\b/g, 'runtime config')
    .replace(/\b(?:hushh-ai-prod|hushh-pda(?:-uat)?|ibsisfnjxeowvdtvgzff)\b/g, 'internal aggregate source')
    .replace(/\b(?:analytics|searchconsole)_[A-Za-z0-9_]+\b/g, 'internal aggregate source');
}

function productFromValue(value: unknown): ProductKey | 'all' {
  const raw = String(value ?? 'all').toLowerCase();
  if (raw === 'all') return 'all';
  if (raw.includes('uat.kai') || (raw.includes('kai') && raw.includes('uat'))) return 'uat.kai.hushh.ai';
  if (raw.includes('hushhtech') || raw.includes('hushhtech.com')) return 'hushhtech.com';
  if (raw.includes('kai')) return 'kai.hushh.ai';
  if (raw.includes('hushh.ai') || raw.includes('hushhai') || raw.includes('hushh ai')) return 'hushh.ai';
  return 'all';
}

function productsFor(product: ProductKey | 'all'): ProductKey[] {
  return product === 'all' ? [...PRODUCT_KEYS] : [product];
}

function compactCloudRun(gcp: Record<string, unknown> | null, range: AgentRange): Record<string, unknown> | null {
  if (!gcp) return null;
  return {
    metricPrefix: 'cloud_run',
    source: 'Cloud Run Monitoring',
    available: true,
    serviceName: String(gcp.serviceName ?? ''),
    range,
    requestCount: toNumber(gcp.requestCount),
    errorCount: optionalNumber(gcp.errorCount),
    errorRate: optionalNumber(gcp.errorRate),
    p95LatencyMs: optionalNumber(gcp.p95LatencyMs),
    instanceCount: optionalNumber(gcp.instanceCount),
    daily: recordArray(gcp.daily).slice(-range.days).map((row) => ({
      date: String(row.date ?? ''),
      requests: toNumber(row.requests),
      errors: toNumber(row.errors),
      errorRate: optionalNumber(row.errorRate),
      p95LatencyMs: optionalNumber(row.p95LatencyMs),
    })),
  };
}

function sourceSectionMetric(section: Record<string, unknown> | undefined, key: string): number | null {
  const metrics = recordArray(section?.metrics);
  const metric = metrics.find((item) => item.key === key);
  return optionalNumber(metric?.value);
}

function sourceSectionByKey(source: Record<string, unknown> | null, key: string): Record<string, unknown> | undefined {
  return recordArray(source?.sections).find((section) => section.key === key);
}

function compactGa4(ga4: Record<string, unknown> | null, range: AgentRange): Record<string, unknown> | null {
  if (!ga4) return null;
  const rangeTotals = asRecord(ga4.rangeTotals) ?? {};
  const last24Section = sourceSectionByKey(ga4, 'last_24_hours');
  return {
    metricPrefix: 'ga4',
    source: String(ga4.sourceLabel ?? ga4.source ?? 'GA4'),
    available: Boolean(ga4.available),
    range,
    users: optionalNumber(rangeTotals.users),
    sessions: optionalNumber(rangeTotals.sessions),
    events: optionalNumber(rangeTotals.events),
    last24Hours: last24Section ? {
      available: Boolean(last24Section.status === 'delayed' || last24Section.status === 'live' || last24Section.status === 'near_live'),
      status: String(last24Section.status ?? 'unknown'),
      label: String(last24Section.label ?? 'Last 24 Hours'),
      source: String(last24Section.source ?? 'GA4 processed report'),
      users: sourceSectionMetric(last24Section, 'users'),
      sessions: sourceSectionMetric(last24Section, 'sessions'),
      events: sourceSectionMetric(last24Section, 'events'),
      note: typeof last24Section.note === 'string'
        ? sanitizeAgentText(last24Section.note)
        : typeof last24Section.blocker === 'string'
          ? sanitizeAgentText(last24Section.blocker)
          : null,
    } : null,
    topEvents: recordArray(ga4.topEvents).slice(0, 8).map((row) => ({
      eventName: String(row.eventName ?? ''),
      events: toNumber(row.events),
      users: toNumber(row.users),
    })),
    daily: recordArray(ga4.daily).slice(-range.days).map((row) => ({
      date: String(row.eventDate ?? row.date ?? ''),
      users: toNumber(row.users),
      sessions: toNumber(row.sessions),
      events: toNumber(row.events),
    })),
  };
}

function compactSearchConsole(searchConsole: Record<string, unknown> | null, range: AgentRange): Record<string, unknown> | null {
  if (!searchConsole) return null;
  return {
    metricPrefix: 'search_console',
    source: String(searchConsole.sourceLabel ?? searchConsole.source ?? 'Search Console'),
    available: Boolean(searchConsole.available),
    latestDataDate: typeof searchConsole.latestDataDate === 'string' ? searchConsole.latestDataDate : null,
    expectedLagSeconds: optionalNumber(searchConsole.expectedLagSeconds),
    range,
    clicks: toNumber(searchConsole.clicks ?? asRecord(searchConsole.overview)?.clicks),
    impressions: toNumber(searchConsole.impressions ?? asRecord(searchConsole.overview)?.impressions),
    ctr: optionalNumber(searchConsole.ctr ?? asRecord(searchConsole.overview)?.ctr),
    averagePosition: optionalNumber(searchConsole.averagePosition ?? asRecord(searchConsole.overview)?.averagePosition),
    topQueries: recordArray(searchConsole.queries).slice(0, 8).map((row) => ({
      query: String(row.query ?? ''),
      clicks: toNumber(row.clicks),
      impressions: toNumber(row.impressions),
      ctr: optionalNumber(row.ctr),
    })),
    topPages: recordArray(searchConsole.pages).slice(0, 5).map((row) => ({
      pageUrl: String(row.pageUrl ?? ''),
      clicks: toNumber(row.clicks),
      impressions: toNumber(row.impressions),
    })),
    note: typeof searchConsole.note === 'string' ? searchConsole.note : null,
  };
}

function compactBusinessFunnel(summary: Record<string, unknown> | null, range: AgentRange): Record<string, unknown> | null {
  const funnel = asRecord(summary?.businessFunnel);
  if (!funnel) return null;
  const overview = asRecord(funnel.overview) ?? {};
  const conversionRates = asRecord(funnel.conversionRates) ?? {};
  return {
    metricPrefix: 'funnel',
    source: 'hushhtech.com business funnel',
    available: String(funnel.source ?? '') !== 'unavailable',
    range,
    signups: toNumber(overview.signups),
    persistedUsers: toNumber(overview.persistedUsers),
    onboardingStarted: toNumber(overview.onboardingStarted),
    onboardingCompleted: toNumber(overview.onboardingCompleted),
    profilesCreated: toNumber(overview.profilesCreated),
    profilesConfirmed: toNumber(overview.profilesConfirmed),
    signupToPersistedRate: optionalNumber(conversionRates.signupToPersistedUsers),
    onboardingCompletionRate: optionalNumber(conversionRates.onboardingCompletionRate),
    daily: recordArray(funnel.series).slice(-range.days),
  };
}

function compactTraffic(summary: Record<string, unknown> | null, range: AgentRange): Record<string, unknown> | null {
  const traffic = asRecord(summary?.traffic);
  const overview = asRecord(traffic?.overview);
  if (!overview) return null;
  const needsVerification = hushhTechGa4NeedsVerification(traffic);
  const verifiedMetric = (value: unknown) => (needsVerification ? null : optionalNumber(value));
  return {
    metricPrefix: 'traffic',
    source: 'hushhtech.com GA4 traffic',
    available: Boolean(traffic?.available) && !needsVerification,
    range,
    active1DayUsers: verifiedMetric(overview.active1DayUsers),
    active7DayUsers: verifiedMetric(overview.active7DayUsers),
    active28DayUsers: verifiedMetric(overview.active28DayUsers),
    sessions: verifiedMetric(overview.sessions),
    engagedSessions: verifiedMetric(overview.engagedSessions),
    pageViews: verifiedMetric(overview.screenPageViews),
    newUsers: verifiedMetric(overview.newUsers),
    engagementRate: optionalNumber(overview.engagementRate),
    realtimeActiveUsers: optionalNumber(overview.realtimeActiveUsers),
    note: needsVerification ? HUSHHTECH_GA4_ZERO_TRAFFIC_WARNING : null,
  };
}

function compactSupabase(summary: Record<string, unknown> | null, range: AgentRange): Record<string, unknown> | null {
  const supabase = asRecord(summary?.supabase);
  const rangeTotals = asRecord(supabase?.rangeTotals);
  if (!rangeTotals) return null;
  return {
    metricPrefix: 'supabase',
    source: 'hushhtech.com Supabase aggregates',
    available: true,
    range,
    totalUsers: optionalNumber(rangeTotals.totalUsers),
    newUsers: optionalNumber(rangeTotals.newUsers),
    confirmedUsers: optionalNumber(rangeTotals.confirmedUsers),
    activeUsers: optionalNumber(rangeTotals.activeUsers),
    returningUsers: optionalNumber(rangeTotals.returningUsers),
    deletedUsers: optionalNumber(rangeTotals.deletedUsers),
    sessionsStarted: optionalNumber(rangeTotals.sessionsStarted),
    sessionUsers: optionalNumber(rangeTotals.sessionUsers),
  };
}

function compactProductEvents(productEvents: Record<string, unknown> | null, range: AgentRange): Record<string, unknown> | null {
  if (!productEvents) return null;
  return {
    metricPrefix: 'product_events',
    source: String(productEvents.sourceLabel ?? 'DB / Product Events'),
    available: Boolean(productEvents.available),
    status: String(productEvents.status ?? (productEvents.available ? 'live' : 'not_configured')),
    range,
    note: typeof productEvents.note === 'string' ? productEvents.note : null,
    rangeTotals: asRecord(productEvents.rangeTotals) ?? null,
  };
}

function compactKaiFeedRows(rows: Record<string, unknown>[], range: AgentRange, label: string): Record<string, unknown> | null {
  if (rows.length === 0) return null;
  const status = buildKaiFeedStatus(rows);
  const usageRows = rows.filter((row) => row.metric_group === 'usage');
  const byDate = new Map<string, { date: string; dau: number | null; sessions: number | null; totalEvents: number | null }>();
  for (const row of usageRows) {
    const date = typeof row.metric_date === 'string'
      ? row.metric_date
      : asRecord(row.metric_date)?.value;
    if (typeof date !== 'string') continue;
    const current = byDate.get(date) ?? { date, dau: null, sessions: null, totalEvents: null };
    if (row.metric_name === 'daily_active_users') current.dau = toNumber(row.metric_count ?? row.metric_value);
    if (row.metric_name === 'sessions') current.sessions = toNumber(row.metric_count ?? row.metric_value);
    if (row.metric_name === 'total_events') current.totalEvents = toNumber(row.metric_count ?? row.metric_value);
    byDate.set(date, current);
  }
  return {
    metricPrefix: 'product_events',
    source: `${label} DB aggregate feed`,
    available: rows.some((row) => row.metric_group === 'summary'),
    status: status.productionReady ? 'live' : 'waiting',
    range,
    dau: kaiFeedMetricValue(rows, 'summary', 'current_dau'),
    wau: kaiFeedMetricValue(rows, 'summary', 'current_wau'),
    mau: kaiFeedMetricValue(rows, 'summary', 'current_mau'),
    sessions: kaiFeedMetricValue(rows, 'summary', 'current_sessions'),
    totalEvents: kaiFeedMetricValue(rows, 'summary', 'current_total_events'),
    freshnessLagMinutes: status.freshnessLagMinutes,
    sourceEventRows: status.sourceEventRows,
    daily: Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date)).slice(-range.days),
  };
}

function sourceFromFreshness(product: ProductKey, rawSource: Record<string, unknown>): AgentSource {
  const state = String(rawSource.state ?? rawSource.status ?? 'unknown');
  return {
    product,
    source: String(rawSource.key ?? rawSource.source ?? rawSource.label ?? 'source'),
    status: state,
    available: ['live', 'near_live', 'delayed', 'collecting_not_ingested'].includes(state),
    generatedAt: typeof rawSource.generatedAt === 'string' ? rawSource.generatedAt : null,
    expectedLagSeconds: optionalNumber(rawSource.expectedLagSeconds),
    detail: typeof rawSource.detail === 'string' ? sanitizeAgentText(rawSource.detail) : null,
  };
}

function sourceFromCard(product: ProductKey, rawSource: Record<string, unknown>): AgentSource {
  const status = String(rawSource.status ?? 'unknown');
  return {
    product,
    source: String(rawSource.key ?? rawSource.source ?? rawSource.label ?? 'source'),
    status,
    available: ['live', 'near_live', 'delayed', 'collecting_not_ingested'].includes(status),
    generatedAt: timestampString(asRecord(rawSource.freshness)?.generatedAt),
    expectedLagSeconds: optionalNumber(asRecord(rawSource.freshness)?.expectedLagSeconds),
    detail: typeof rawSource.blocker === 'string' ? sanitizeAgentText(rawSource.blocker) : null,
  };
}

function warningList(...values: unknown[]): string[] {
  return values
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => sanitizeAgentText(value.replace(/\s+/g, ' ').trim()))
    .filter((value) => !/legacy metrics|schema drift|runtime config/i.test(value))
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, 8);
}

async function buildMetricsSnapshot(rangeInput: number | HushhAiDateRange, window: AgentWindow = 'calendar_days'): Promise<MetricsSnapshot> {
  const range = typeof rangeInput === 'number' ? defaultUtcRange(rangeInput) : rangeInput;
  const compactRange = agentRange(range);
  const [
    uat,
    production,
    kaiUatGa4,
    kaiProductionGa4,
    kaiProductionGcp,
    kaiProductionSearchConsole,
    kaiUatSearchConsole,
    hushhAiGcp,
    hushhAiSearchConsole,
    hushhAiGa4,
    hushhTech,
  ] = await Promise.all([
    queryBigQuery(BQ_UAT_PROJECT, BQ_UAT_DATASET, BQ_UAT_VIEW),
    queryBigQuery(BQ_PROD_PROJECT, BQ_PROD_DATASET, BQ_PROD_VIEW),
    fetchKaiGa4Summary(range),
    fetchKaiGa4ExportSummary(KAI_PROD_GA4_PROJECT, KAI_PROD_GA4_DATASET, range, true),
    fetchCloudRunSummary(KAI_PROD_GCP_PROJECT, KAI_PROD_CLOUD_RUN_SERVICE, range, 'Kai production'),
    fetchKaiProductionSearchConsole(range),
    fetchKaiUatSearchConsole(range),
    fetchHushhAiCloudRun(range),
    fetchHushhAiSearchConsole(range),
    fetchHushhAiGa4Summary(range),
    fetchHushhTechAnalytics(range),
  ]);
  const fetchedAt = new Date().toISOString();
  const hushhAiProductEvents = buildHushhAiProductEvents(fetchedAt);
  const hushhTechData = hushhTech.data;
  const hushhTechSourceCards = recordArray(hushhTechData?.sourceCards);

  const hushhAiSources = recordArray(
    buildHushhAiFreshness(fetchedAt, hushhAiGcp.data, hushhAiSearchConsole.data, hushhAiGa4.data, hushhAiProductEvents).sources,
  ).map((source) => sourceFromFreshness('hushh.ai', source));
  const kaiSources = recordArray(
    buildKaiFreshness(fetchedAt, production.rows, kaiProductionGcp.data, kaiProductionGa4.data).sources,
  ).map((source) => sourceFromFreshness('kai.hushh.ai', source));
  const kaiUatSources = recordArray(
    buildKaiUatSourceCards(kaiUatSearchConsole.data, kaiUatGa4.data, uat.rows, fetchedAt),
  ).map((source) => sourceFromCard('uat.kai.hushh.ai', source));
  const hushhTechSources = [
    ...hushhTechSourceCards.map((source) => sourceFromCard('hushhtech.com', source)),
    ...(['business_funnel', 'cloud_run', 'supabase'] as const).map((source) => {
      let available = Boolean(asRecord(hushhTechData?.gcp));
      if (source === 'business_funnel') available = Boolean(asRecord(hushhTechData?.businessFunnel));
      if (source === 'supabase') available = Boolean(asRecord(hushhTechData?.supabase));
      return {
        product: 'hushhtech.com' as const,
        source,
        status: available ? 'near_live' : 'unavailable',
        available,
        generatedAt: fetchedAt,
        expectedLagSeconds: source === 'cloud_run' ? 300 : null,
        detail: available ? null : `${source} source is unavailable.`,
      };
    }),
  ];

  return {
    generatedAt: fetchedAt,
    window,
    windowLabel: window === 'last_24_hours'
      ? `24-hour operations snapshot ending ${fetchedAt}; source-specific activity windows are labeled per metric`
      : `${compactRange.startDate} to ${compactRange.endDate}`,
    range: compactRange,
    catalog: METRIC_CATALOG,
    products: {
      'hushh.ai': {
        product: 'hushh.ai',
        range: compactRange,
        cloudRun: compactCloudRun(hushhAiGcp.data, compactRange),
        ga4: compactGa4(hushhAiGa4.data, compactRange),
        searchConsole: compactSearchConsole(hushhAiSearchConsole.data, compactRange),
        productEvents: compactProductEvents(hushhAiProductEvents, compactRange),
        sourceStatuses: hushhAiSources,
        warnings: warningList(hushhAiGcp.error, hushhAiSearchConsole.error, hushhAiGa4.error, hushhAiProductEvents.note),
      },
      'kai.hushh.ai': {
        product: 'kai.hushh.ai',
        range: compactRange,
        cloudRun: compactCloudRun(kaiProductionGcp.data, compactRange),
        ga4: compactGa4(kaiProductionGa4.data, compactRange),
        searchConsole: compactSearchConsole(kaiProductionSearchConsole.data, compactRange),
        productEvents: compactKaiFeedRows(production.rows, compactRange, 'Kai production'),
        sourceStatuses: kaiSources,
        warnings: warningList(production.error, kaiProductionGcp.error, kaiProductionGa4.error, kaiProductionSearchConsole.error),
      },
      'uat.kai.hushh.ai': {
        product: 'uat.kai.hushh.ai',
        range: compactRange,
        ga4: compactGa4(kaiUatGa4.data, compactRange),
        searchConsole: compactSearchConsole(kaiUatSearchConsole.data, compactRange),
        productEvents: compactKaiFeedRows(uat.rows, compactRange, 'Kai UAT'),
        sourceStatuses: kaiUatSources,
        warnings: warningList(uat.error, kaiUatGa4.error, kaiUatSearchConsole.error),
      },
      'hushhtech.com': {
        product: 'hushhtech.com',
        range: compactRange,
        cloudRun: compactCloudRun(asRecord(hushhTechData?.gcp), compactRange),
        searchConsole: compactSearchConsole(asRecord(hushhTechData?.searchPerformance), compactRange),
        businessFunnel: compactBusinessFunnel(hushhTechData, compactRange),
        traffic: compactTraffic(hushhTechData, compactRange),
        supabase: compactSupabase(hushhTechData, compactRange),
        sourceStatuses: hushhTechSources,
        warnings: warningList(hushhTech.error, hushhTechData?.dataQualityWarnings),
      },
    },
  };
}

async function getMetricsSnapshot(rangeDays: number): Promise<MetricsSnapshot> {
  const key = `calendar:${clampChatRangeDays(rangeDays)}`;
  const now = Date.now();
  if (metricsSnapshotCache?.key === key && metricsSnapshotCache.expiresAt > now) {
    return metricsSnapshotCache.promise;
  }
  const promise = buildMetricsSnapshot(clampChatRangeDays(rangeDays), 'calendar_days');
  metricsSnapshotCache = {
    key,
    expiresAt: now + METRICS_CHAT_CONTEXT_CACHE_SECONDS * 1000,
    promise,
  };
  return promise;
}

async function getLast24MetricsSnapshot(): Promise<MetricsSnapshot> {
  const key = 'last_24_hours';
  const now = Date.now();
  if (metricsSnapshotCache?.key === key && metricsSnapshotCache.expiresAt > now) {
    return metricsSnapshotCache.promise;
  }
  const promise = buildMetricsSnapshot(last24HourUtcRange(), 'last_24_hours');
  metricsSnapshotCache = {
    key,
    expiresAt: now + METRICS_CHAT_CONTEXT_CACHE_SECONDS * 1000,
    promise,
  };
  return promise;
}

function selectSnapshotProducts(snapshot: MetricsSnapshot, product: ProductKey | 'all'): MetricsSnapshot | ProductMetrics {
  if (product !== 'all') return snapshot.products[product];
  return snapshot;
}

async function executeAgentTool(name: string | undefined, args: Record<string, unknown> | undefined): Promise<AgentToolResult> {
  const safeName = name ?? 'unknown';
  const safeArgs = args ?? {};
  const product = productFromValue(safeArgs.product);
  const rangeDays = clampChatRangeDays(safeArgs.rangeDays);
  const window = safeArgs.window === 'last_24_hours' ? 'last_24_hours' : 'calendar_days';
  if (safeName === 'get_metric_catalog') {
    return { tool: safeName, args: safeArgs, ok: true, data: { products: METRIC_CATALOG } };
  }
  if (safeName === 'get_product_metrics') {
    const snapshot = window === 'last_24_hours'
      ? await getLast24MetricsSnapshot()
      : await getMetricsSnapshot(rangeDays);
    return { tool: safeName, args: safeArgs, ok: true, data: selectSnapshotProducts(snapshot, product) };
  }
  if (safeName === 'get_source_status') {
    const snapshot = window === 'last_24_hours'
      ? await getLast24MetricsSnapshot()
      : await getMetricsSnapshot(rangeDays);
    const sourceFilter = typeof safeArgs.source === 'string' ? safeArgs.source.toLowerCase() : '';
    const sources = productsFor(product)
      .flatMap((key) => snapshot.products[key].sourceStatuses)
      .filter((source) => !sourceFilter || source.source.toLowerCase().includes(sourceFilter));
    return { tool: safeName, args: safeArgs, ok: true, data: { generatedAt: snapshot.generatedAt, range: snapshot.range, sources } };
  }
  return {
    tool: safeName,
    args: safeArgs,
    ok: false,
    data: null,
    warning: `Unsupported analyst tool: ${safeName}`,
  };
}

function normalizeHistory(value: unknown): ChatHistoryMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = asRecord(item);
      const role = record?.role === 'assistant' ? 'assistant' : record?.role === 'user' ? 'user' : null;
      const content = typeof record?.content === 'string' ? record.content.trim() : '';
      return role && content ? { role, content: content.slice(0, 2000) } : null;
    })
    .filter((item): item is ChatHistoryMessage => Boolean(item))
    .slice(-8);
}

function historyToGeminiContents(history: ChatHistoryMessage[]) {
  return history.map((msg) => ({
    role: msg.role === 'assistant' ? 'model' as const : 'user' as const,
    parts: [{ text: msg.content }],
  }));
}

const HUSSH_ANALYST_TOOL_PROMPT = `You are Hussh Insights AI, an analyst agent for metrics.hushh.ai.
Use tools before answering any metrics question. Only request aggregate metrics. Never request or expose raw users, emails, prompts, tokens, project ids, dataset ids, stack traces, or provider diagnostics.
Prefer get_product_metrics for numeric questions and get_source_status for availability/freshness questions. Use get_metric_catalog if the requested metric name is ambiguous.
For "last day", "past day", "last 24 hours", "24-hour report", or "what happened in the last day" requests, call get_product_metrics with window="last_24_hours" and rangeDays=1.
Treat the metric catalog as the semantic field model: use field labels, descriptions, synonyms, caveats, and example questions to map business language to the right aggregate metric.`;

const HUSSH_ANALYST_SYNTHESIS_PROMPT = `You are Hussh Insights AI, a detailed analyst for metrics.hushh.ai.
Answer only from the provided aggregate tool results. Do not invent data.
Return JSON matching the schema exactly.
Every numeric claim in reply must appear in claims with a canonical metric id from the catalog when possible.
Use product names exactly: hushh.ai, kai.hushh.ai, uat.kai.hushh.ai, hushhtech.com.
When tool results have window="last_24_hours", call Cloud Run reliability rolling 24-hour data. For GA4 or traffic sections, use the section label/source/note exactly; if a section says it is date-based or not exact rolling, state that caveat instead of calling it exact rolling 24-hour users.
Never blend kai.hushh.ai production with uat.kai.hushh.ai. If the user says "Kai UAT", use uat.kai.hushh.ai; if they say "Kai production" or "kai.hushh.ai", use kai.hushh.ai.
Use complete sentences. Never end mid-sentence, after a comma, after an open parenthesis, or after words such as "of", "for", "with", "and", "DAU", or "DA".
For "top 3 issues" or "act on" requests, return exactly three numbered action items in the reply.
Mention missing or delayed sources in warnings instead of treating unavailable data as zero.
Return 3-5 suggestedQuestions that are useful next steps for this exact answer.
Detailed analyst style is preferred: exact number, date range, source, interpretation, then action.`;

async function collectAgentToolResults(ai: any, message: string, history: ChatHistoryMessage[]): Promise<AgentToolResult[]> {
  const inferredWindow = inferAgentWindow(message, history);
  const contents: any[] = [
    ...historyToGeminiContents(history),
    { role: 'user' as const, parts: [{ text: message }] },
  ];
  const toolResults: AgentToolResult[] = [];

  for (let round = 0; round < METRICS_CHAT_MAX_TOOL_ROUNDS; round++) {
    const response = await ai.models.generateContent({
      model: GEMINI_METRICS_CHAT_MODEL,
      contents,
      config: {
        systemInstruction: HUSSH_ANALYST_TOOL_PROMPT,
        tools: [{ functionDeclarations: METRICS_TOOL_DECLARATIONS }],
        toolConfig: {
          functionCallingConfig: round === 0
            ? {
              mode: 'ANY',
              allowedFunctionNames: ['get_metric_catalog', 'get_product_metrics', 'get_source_status'],
            }
            : { mode: 'AUTO' },
        },
        maxOutputTokens: 512,
        temperature: 0.1,
        thinkingConfig: { thinkingBudget: -1 },
        httpOptions: { timeout: METRICS_CHAT_REQUEST_TIMEOUT_MS },
      },
    });
    const calls = (response.functionCalls ?? []).slice(0, 4);
    if (calls.length === 0) break;

    const modelContent = response.candidates?.[0]?.content;
    if (modelContent) contents.push(modelContent);

    const responseParts = [];
    for (const call of calls) {
      const result = await executeAgentTool(call.name, call.args);
      toolResults.push(result);
      responseParts.push({
        functionResponse: {
          ...(call.id ? { id: call.id } : {}),
          name: call.name ?? 'unknown',
          response: result,
        },
      });
    }
    contents.push({ role: 'user' as const, parts: responseParts });
  }

  if (!toolResults.some((result) => result.tool === 'get_product_metrics')) {
    toolResults.push(await executeAgentTool(
      'get_product_metrics',
      inferredWindow === 'last_24_hours'
        ? { product: 'all', rangeDays: 1, window: 'last_24_hours' }
        : { product: 'all', rangeDays: 7 },
    ));
  }
  return toolResults;
}

function extractResponseText(response: any): string {
  return typeof response?.text === 'string' ? response.text.trim() : '';
}

function parseAgentAnswer(text: string): AgentAnswer | null {
  try {
    const parsed = JSON.parse(text) as AgentAnswer;
    return parsed && typeof parsed.reply === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeMetricId(metric: string): string {
  const normalized = metric.toLowerCase().trim().replaceAll(' ', '_').replaceAll('-', '_');
  const aliases: Record<string, string> = {
    'cloud_run.requests': 'cloud_run.request_count',
    'cloudrun.request_count': 'cloud_run.request_count',
    'cloud_run.errors': 'cloud_run.error_count',
    'cloud_run.p95_latency': 'cloud_run.p95_latency_ms',
    'search_console.average_position': 'search_console.average_position',
    'search_console.avg_position': 'search_console.average_position',
    'funnel.persisted': 'funnel.persisted_users',
    'funnel.signup_to_persisted': 'funnel.signup_to_persisted_rate',
    'supabase.users': 'supabase.total_users',
    'supabase.total': 'supabase.total_users',
    'supabase.active': 'supabase.active_users',
    'supabase.new': 'supabase.new_users',
  };
  return aliases[normalized] ?? normalized;
}

function metricValueFromSnapshot(snapshot: MetricsSnapshot, product: ProductKey, metric: string): number | null {
  const productMetrics = snapshot.products[product];
  const canonicalMetric = normalizeMetricId(metric);
  const cloudRun = asRecord(productMetrics.cloudRun);
  const ga4 = asRecord(productMetrics.ga4);
  const searchConsole = asRecord(productMetrics.searchConsole);
  const funnel = asRecord(productMetrics.businessFunnel);
  const traffic = asRecord(productMetrics.traffic);
  const supabase = asRecord(productMetrics.supabase);
  const productEvents = asRecord(productMetrics.productEvents);
  const productEventTotals = asRecord(productEvents?.rangeTotals);
  const values: Record<string, unknown> = {
    'cloud_run.request_count': cloudRun?.requestCount,
    'cloud_run.error_count': cloudRun?.errorCount,
    'cloud_run.error_rate': cloudRun?.errorRate,
    'cloud_run.p95_latency_ms': cloudRun?.p95LatencyMs,
    'cloud_run.instance_count': cloudRun?.instanceCount,
    'ga4.users': ga4?.users,
    'ga4.sessions': ga4?.sessions,
    'ga4.events': ga4?.events,
    'ga4.last_24_hours.users': asRecord(ga4?.last24Hours)?.users,
    'ga4.last_24_hours.sessions': asRecord(ga4?.last24Hours)?.sessions,
    'ga4.last_24_hours.events': asRecord(ga4?.last24Hours)?.events,
    'search_console.clicks': searchConsole?.clicks,
    'search_console.impressions': searchConsole?.impressions,
    'search_console.ctr': searchConsole?.ctr,
    'search_console.average_position': searchConsole?.averagePosition,
    'funnel.signups': funnel?.signups,
    'funnel.persisted_users': funnel?.persistedUsers,
    'funnel.onboarding_started': funnel?.onboardingStarted,
    'funnel.onboarding_completed': funnel?.onboardingCompleted,
    'funnel.profiles_created': funnel?.profilesCreated,
    'funnel.profiles_confirmed': funnel?.profilesConfirmed,
    'funnel.signup_to_persisted_rate': funnel?.signupToPersistedRate,
    'funnel.onboarding_completion_rate': funnel?.onboardingCompletionRate,
    'traffic.active_1_day_users': traffic?.active1DayUsers,
    'traffic.active_7_day_users': traffic?.active7DayUsers,
    'traffic.active_28_day_users': traffic?.active28DayUsers,
    'traffic.sessions': traffic?.sessions,
    'traffic.engaged_sessions': traffic?.engagedSessions,
    'traffic.page_views': traffic?.pageViews,
    'traffic.new_users': traffic?.newUsers,
    'traffic.engagement_rate': traffic?.engagementRate,
    'supabase.total_users': supabase?.totalUsers,
    'supabase.new_users': supabase?.newUsers,
    'supabase.confirmed_users': supabase?.confirmedUsers,
    'supabase.active_users': supabase?.activeUsers,
    'supabase.returning_users': supabase?.returningUsers,
    'supabase.deleted_users': supabase?.deletedUsers,
    'supabase.sessions_started': supabase?.sessionsStarted,
    'supabase.session_users': supabase?.sessionUsers,
    'product_events.analytics_events': productEventTotals?.analyticsEvents,
    'product_events.dau': productEvents?.dau ?? productEventTotals?.dau,
    'product_events.wau': productEvents?.wau ?? productEventTotals?.wau,
    'product_events.mau': productEvents?.mau ?? productEventTotals?.mau,
    'product_events.sessions': productEvents?.sessions ?? productEventTotals?.sessions,
    'product_events.total_events': productEvents?.totalEvents ?? productEventTotals?.totalEvents,
    'product_events.source_event_rows': productEvents?.sourceEventRows,
  };
  return optionalNumber(values[canonicalMetric]);
}

function claimNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const parsed = Number(value.replace(/,/g, '').replace(/%/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function isRateMetric(metric: string): boolean {
  const canonical = normalizeMetricId(metric);
  return canonical.endsWith('_rate') || canonical === 'search_console.ctr' || canonical === 'traffic.engagement_rate';
}

function isCompleteReply(reply: string): boolean {
  const trimmed = reply.trim();
  if (trimmed.length < 20) return false;
  if (!/[.!?)]$/.test(trimmed)) return false;
  return !/(^|[\s(])(of|for|with|and|or|to|from|DA|DAU|WAU|MAU)$/i.test(trimmed);
}

function normalizeAgentAnswer(answer: AgentAnswer): AgentAnswer {
  return {
    reply: String(answer.reply ?? '').trim(),
    confidence: ['high', 'medium', 'low'].includes(answer.confidence) ? answer.confidence : 'medium',
    claims: Array.isArray(answer.claims) ? answer.claims.map((claim) => ({
      product: productFromValue(claim.product) === 'all' ? 'hushh.ai' : productFromValue(claim.product) as ProductKey,
      metric: normalizeMetricId(String(claim.metric ?? '')),
      label: String(claim.label ?? claim.metric ?? ''),
      value: claim.value ?? null,
      unit: String(claim.unit ?? ''),
      source: String(claim.source ?? ''),
      range: {
        startDate: String(claim.range?.startDate ?? ''),
        endDate: String(claim.range?.endDate ?? ''),
        days: Number(claim.range?.days ?? 0),
      },
    })).filter((claim) => claim.metric && claim.range.startDate && claim.range.endDate) : [],
    sources: Array.isArray(answer.sources) ? answer.sources.map((source) => ({
      product: productFromValue(source.product) === 'all' ? 'hushh.ai' : productFromValue(source.product) as ProductKey,
      source: String(source.source ?? ''),
      status: String(source.status ?? ''),
      available: Boolean(source.available),
      generatedAt: typeof source.generatedAt === 'string' ? source.generatedAt : null,
      expectedLagSeconds: optionalNumber(source.expectedLagSeconds),
      detail: typeof source.detail === 'string' ? source.detail : null,
    })).filter((source) => source.source) : [],
    warnings: warningList(answer.warnings),
    suggestedQuestions: Array.isArray(answer.suggestedQuestions)
      ? answer.suggestedQuestions
        .filter((question): question is string => typeof question === 'string' && question.trim().length > 0)
        .map((question) => sanitizeAgentText(question.trim()).slice(0, 180))
        .slice(0, 6)
      : [],
  };
}

function validateAgentAnswer(answer: AgentAnswer, snapshot: MetricsSnapshot): string[] {
  const errors: string[] = [];
  if (!isCompleteReply(answer.reply)) errors.push('reply is incomplete or too short');
  if (!['high', 'medium', 'low'].includes(answer.confidence)) errors.push('confidence is invalid');
  for (const claim of answer.claims) {
    const numericClaim = claimNumber(claim.value);
    if (numericClaim == null) continue;
    const expected = metricValueFromSnapshot(snapshot, claim.product, claim.metric);
    if (expected == null) {
      errors.push(`numeric claim uses unsupported metric ${claim.product}:${claim.metric}`);
      continue;
    }
    const expectedDisplay = isRateMetric(claim.metric) && (claim.unit.includes('%') || numericClaim > 1)
      ? expected * 100
      : expected;
    const tolerance = Math.max(0.02, Math.abs(expectedDisplay) * 0.005);
    if (Math.abs(numericClaim - expectedDisplay) > tolerance) {
      errors.push(`numeric claim ${claim.product}:${claim.metric}=${numericClaim} does not match source value ${expectedDisplay}`);
    }
  }
  return errors;
}

function formatInteger(value: unknown): string {
  return Math.round(toNumber(value)).toLocaleString('en-US');
}

function formatOptionalInteger(value: unknown): string {
  const parsed = optionalNumber(value);
  return parsed == null ? 'not available' : formatInteger(parsed);
}

function formatPercent(value: unknown, digits = 2): string {
  const parsed = optionalNumber(value);
  return parsed == null ? 'N/A' : `${(parsed * 100).toFixed(digits)}%`;
}

function sourceSubset(snapshot: MetricsSnapshot, products: ProductKey[]): AgentSource[] {
  return products.flatMap((product) => snapshot.products[product].sourceStatuses).slice(0, 12);
}

function deterministicClaim(
  snapshot: MetricsSnapshot,
  product: ProductKey,
  metric: string,
  label: string,
  value: number | string | null,
  unit: string,
  source: string,
): MetricClaim {
  return { product, metric, label, value, unit, source, range: snapshot.range };
}

function inferProductFromQuestion(text: string): ProductKey | 'all' {
  const lower = text.toLowerCase();
  if (lower.includes('hushhtech')) return 'hushhtech.com';
  if (lower.includes('kai')) return 'kai.hushh.ai';
  if (lower.includes('hushh.ai') || lower.includes('hushh ai')) return 'hushh.ai';
  return 'all';
}

function isCrossProductUserQuestion(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    /\b(users?|active users?|new users?|registered users?|accounts?|customers?|dau|wau|mau)\b/.test(lower)
    && /(across all products|all products|hushh have|hushh total|total hushh|overall|company-wide)/.test(lower)
  );
}

function mentionsLast24Window(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    /\b(last|past|previous)\s*(24|twenty[-\s]?four)\s*(h|hr|hrs|hours?)\b/.test(lower)
    || /\b24[-\s]?hour\b/.test(lower)
    || /\b(last|past|previous)\s+day\b/.test(lower)
    || /\bwhat (happened|changed) today\b/.test(lower)
  );
}

function isLast24ReportQuestion(text: string): boolean {
  const lower = text.toLowerCase();
  return mentionsLast24Window(lower) && (
    /\b(report|summary|brief|recap|review|status|happened|changed)\b/.test(lower)
    || /\bwhat happened\b/.test(lower)
    || /\bgive me\b/.test(lower)
  );
}

function inferAgentWindow(message: string, history: ChatHistoryMessage[] = []): AgentWindow {
  const context = `${history.map((item) => item.content).join('\n')}\n${message}`;
  return mentionsLast24Window(context) ? 'last_24_hours' : 'calendar_days';
}

function buildCrossProductUsersAnswer(snapshot: MetricsSnapshot): AgentAnswer {
  const hushhAiGa4 = asRecord(snapshot.products['hushh.ai'].ga4);
  const kaiGa4 = asRecord(snapshot.products['kai.hushh.ai'].ga4);
  const kaiUatGa4 = asRecord(snapshot.products['uat.kai.hushh.ai'].ga4);
  const hushhTechSupabase = asRecord(snapshot.products['hushhtech.com'].supabase);
  const hushhTechTotalUsers = optionalNumber(hushhTechSupabase?.totalUsers);
  const hushhTechActiveUsers = optionalNumber(hushhTechSupabase?.activeUsers);
  const hushhTechNewUsers = optionalNumber(hushhTechSupabase?.newUsers);
  const hushhAiUsers = optionalNumber(hushhAiGa4?.users);
  const kaiUsers = optionalNumber(kaiGa4?.users);
  const kaiGa4Available = Boolean(kaiGa4?.available);
  const kaiUatUsers = optionalNumber(kaiUatGa4?.users);
  const kaiUatGa4Available = Boolean(kaiUatGa4?.available);
  const accountLine = hushhTechTotalUsers != null
    ? `Confirmed product-account users: hushhtech.com has ${formatInteger(hushhTechTotalUsers)} total users, including ${formatOptionalInteger(hushhTechActiveUsers)} active users and ${formatOptionalInteger(hushhTechNewUsers)} new users for ${snapshot.range.startDate} to ${snapshot.range.endDate}.`
    : 'Confirmed product-account users: no configured product-account total is available across all products in this runtime.';
  const hushhAiLine = hushhAiUsers != null
    ? `hushh.ai has ${formatInteger(hushhAiUsers)} GA4 web users`
    : 'hushh.ai GA4 web users are not available';

  const claims: MetricClaim[] = [];
  if (hushhTechTotalUsers != null) {
    claims.push(deterministicClaim(snapshot, 'hushhtech.com', 'supabase.total_users', 'Total product users', hushhTechTotalUsers, 'users', 'hushhtech.com Supabase aggregates'));
  }
  if (hushhTechActiveUsers != null) {
    claims.push(deterministicClaim(snapshot, 'hushhtech.com', 'supabase.active_users', 'Active product users', hushhTechActiveUsers, 'users', 'hushhtech.com Supabase aggregates'));
  }
  if (hushhTechNewUsers != null) {
    claims.push(deterministicClaim(snapshot, 'hushhtech.com', 'supabase.new_users', 'New product users', hushhTechNewUsers, 'users', 'hushhtech.com Supabase aggregates'));
  }
  if (hushhAiUsers != null) {
    claims.push(deterministicClaim(snapshot, 'hushh.ai', 'ga4.users', 'GA4 web users', hushhAiUsers, 'users', 'GA4 Data API'));
  }
  if (kaiGa4Available && kaiUsers != null) {
    claims.push(deterministicClaim(snapshot, 'kai.hushh.ai', 'ga4.users', 'GA4 web users', kaiUsers, 'users', 'GA4 export'));
  }
  if (kaiUatGa4Available && kaiUatUsers != null) {
    claims.push(deterministicClaim(snapshot, 'uat.kai.hushh.ai', 'ga4.users', 'UAT GA4 web users', kaiUatUsers, 'users', 'Kai UAT GA4 export'));
  }

  const kaiLine = kaiGa4Available && kaiUsers != null
    ? `kai.hushh.ai has ${formatInteger(kaiUsers)} GA4 web users.`
    : 'kai.hushh.ai production user analytics is not currently available, so I am not counting it as zero users.';
  const kaiUatLine = kaiUatGa4Available && kaiUatUsers != null
    ? `Kai UAT separately has ${formatInteger(kaiUatUsers)} GA4 web users for validation, but I am not mixing UAT into production totals.`
    : 'Kai UAT user analytics is not available in this range.';

  return {
    reply: [
      `Short answer: I cannot honestly give one de-duplicated “Hushh total users across all products” yet, because each product exposes a different aggregate user definition.`,
      accountLine,
      `Web audience users for the same range: ${hushhAiLine}; ${kaiLine}`,
      kaiUatLine,
      'I am deliberately not using server request volume as a user count, because traffic/reliability events are not people or accounts.',
    ].join('\n'),
    claims,
    sources: sourceSubset(snapshot, ['hushhtech.com', 'hushh.ai', 'kai.hushh.ai', 'uat.kai.hushh.ai']),
    warnings: warningList(
      'A single cross-product de-duplicated user identity source is not configured yet.',
      hushhTechTotalUsers == null ? 'hushhtech.com product-account totals are unavailable in this runtime.' : null,
      hushhAiUsers == null ? 'hushh.ai GA4 web-user totals are unavailable in this runtime.' : null,
      kaiGa4Available ? null : 'kai.hushh.ai production user analytics is waiting or unavailable.',
      kaiUatGa4Available ? 'Kai UAT is reported separately and must not be blended into Kai production.' : 'Kai UAT user analytics is waiting or unavailable.',
      snapshot.products['hushh.ai'].warnings,
      snapshot.products['kai.hushh.ai'].warnings,
      snapshot.products['uat.kai.hushh.ai'].warnings,
    ),
    confidence: 'medium',
    suggestedQuestions: [
      'Compare Kai production and Kai UAT without mixing the numbers.',
      'Which user numbers are account truth versus web audience estimates?',
      'What should we configure to get de-duplicated users across products?',
    ],
  };
}

function buildKaiEnvironmentSplitAnswer(snapshot: MetricsSnapshot): AgentAnswer {
  const prod = snapshot.products['kai.hushh.ai'];
  const uat = snapshot.products['uat.kai.hushh.ai'];
  const prodCloudRun = asRecord(prod.cloudRun);
  const prodGa4 = asRecord(prod.ga4);
  const prodEvents = asRecord(prod.productEvents);
  const uatGa4 = asRecord(uat.ga4);
  const uatEvents = asRecord(uat.productEvents);
  const prodGa4Available = Boolean(prodGa4?.available);
  const uatGa4Available = Boolean(uatGa4?.available);

  return {
    reply: [
      `Kai production and Kai UAT are now separate in the analyst model for ${snapshot.range.startDate} to ${snapshot.range.endDate}.`,
      `Production kai.hushh.ai: ${formatInteger(prodCloudRun?.requestCount)} Cloud Run requests, ${formatInteger(prodCloudRun?.errorCount)} 5xx responses, and ${formatPercent(prodCloudRun?.errorRate)} error rate. Production GA4 users are ${prodGa4Available ? formatInteger(prodGa4?.users) : 'waiting'}, and production DB/product events are ${prodEvents?.available ? 'available' : 'waiting'}.`,
      `UAT uat.kai.hushh.ai: GA4 users are ${uatGa4Available ? formatInteger(uatGa4?.users) : 'waiting'}, GA4 sessions are ${uatGa4Available ? formatInteger(uatGa4?.sessions) : 'waiting'}, and UAT DB events are ${formatOptionalInteger(uatEvents?.totalEvents)} with DAU ${formatOptionalInteger(uatEvents?.dau)}.`,
      'Do not use UAT values as production truth; UAT is validation and test-environment behavior.',
    ].join('\n'),
    claims: [
      deterministicClaim(snapshot, 'kai.hushh.ai', 'cloud_run.request_count', 'Production Cloud Run requests', toNumber(prodCloudRun?.requestCount), 'requests', 'Cloud Run Monitoring'),
      deterministicClaim(snapshot, 'kai.hushh.ai', 'cloud_run.error_rate', 'Production Cloud Run error rate', Number((toNumber(prodCloudRun?.errorRate) * 100).toFixed(2)), '%', 'Cloud Run Monitoring'),
      ...(prodGa4Available ? [deterministicClaim(snapshot, 'kai.hushh.ai', 'ga4.users', 'Production GA4 users', toNumber(prodGa4?.users), 'users', 'Kai production GA4 export')] : []),
      ...(uatGa4Available ? [
        deterministicClaim(snapshot, 'uat.kai.hushh.ai', 'ga4.users', 'UAT GA4 users', toNumber(uatGa4?.users), 'users', 'Kai UAT GA4 export'),
        deterministicClaim(snapshot, 'uat.kai.hushh.ai', 'ga4.sessions', 'UAT GA4 sessions', toNumber(uatGa4?.sessions), 'sessions', 'Kai UAT GA4 export'),
      ] : []),
      deterministicClaim(snapshot, 'uat.kai.hushh.ai', 'product_events.dau', 'UAT DB DAU', optionalNumber(uatEvents?.dau), 'users', 'Kai UAT DB aggregate feed'),
      deterministicClaim(snapshot, 'uat.kai.hushh.ai', 'product_events.total_events', 'UAT DB events', optionalNumber(uatEvents?.totalEvents), 'events', 'Kai UAT DB aggregate feed'),
    ],
    sources: sourceSubset(snapshot, ['kai.hushh.ai', 'uat.kai.hushh.ai']),
    warnings: warningList(
      prodGa4Available ? null : 'Kai production GA4 is waiting or unavailable.',
      prodEvents?.available ? null : 'Kai production DB/product events are waiting for summary rows.',
      uat.warnings,
      prod.warnings,
    ),
    confidence: 'high',
    suggestedQuestions: [
      'Show Kai production reliability trend by day.',
      'Show Kai UAT GA4 versus UAT DB event mismatch.',
      'What must be configured for Kai production user analytics?',
    ],
  };
}

function ga4Last24(ga4: unknown): Record<string, unknown> | null {
  return asRecord(asRecord(ga4)?.last24Hours);
}

function hasAnyNumber(...values: unknown[]): boolean {
  return values.some((value) => optionalNumber(value) != null);
}

function ga4WindowLabel(ga4Window: Record<string, unknown> | null, fallback = 'last 24h'): string {
  const label = typeof ga4Window?.label === 'string' && ga4Window.label.trim()
    ? ga4Window.label.trim()
    : fallback;
  return label.toLowerCase();
}

function ga4WindowSource(ga4Window: Record<string, unknown> | null, fallback: string): string {
  return typeof ga4Window?.source === 'string' && ga4Window.source.trim()
    ? ga4Window.source.trim()
    : fallback;
}

function ga4WindowNote(ga4Window: Record<string, unknown> | null): string | null {
  return typeof ga4Window?.note === 'string' && ga4Window.note.trim()
    ? ga4Window.note.trim()
    : null;
}

function ga4ActivityLine(productLabel: string, ga4Window: Record<string, unknown> | null, unavailableText: string): string {
  if (!hasAnyNumber(ga4Window?.users, ga4Window?.sessions, ga4Window?.events)) return unavailableText;
  return `${productLabel} GA4 ${ga4WindowLabel(ga4Window)}: ${formatOptionalInteger(ga4Window?.users)} users, ${formatOptionalInteger(ga4Window?.sessions)} sessions, ${formatOptionalInteger(ga4Window?.events)} events`;
}

function buildLast24HourReportAnswer(snapshot: MetricsSnapshot): AgentAnswer {
  const end = new Date(snapshot.generatedAt);
  const start = new Date(end.getTime() - 86_400_000);
  const windowText = `${start.toISOString()} to ${end.toISOString()}`;
  const reliabilityProducts: ProductKey[] = ['hushh.ai', 'kai.hushh.ai', 'hushhtech.com'];
  const reliabilityRows = reliabilityProducts
    .map((product) => {
      const cloudRun = asRecord(snapshot.products[product].cloudRun);
      return {
        product,
        requests: optionalNumber(cloudRun?.requestCount) ?? 0,
        errors: optionalNumber(cloudRun?.errorCount) ?? 0,
        errorRate: optionalNumber(cloudRun?.errorRate),
        p95LatencyMs: optionalNumber(cloudRun?.p95LatencyMs),
      };
    })
    .filter((row) => row.requests > 0 || row.errorRate != null);
  const highestError = [...reliabilityRows].sort((a, b) => (b.errorRate ?? -1) - (a.errorRate ?? -1))[0];
  const reliabilityLine = reliabilityRows.length > 0
    ? reliabilityRows.map((row) => `${row.product}: ${formatInteger(row.requests)} requests, ${formatInteger(row.errors)} 5xx, ${formatPercent(row.errorRate)} error rate${row.p95LatencyMs == null ? '' : `, ${formatInteger(row.p95LatencyMs)}ms p95`}`).join('; ')
    : 'Cloud Run reliability metrics are not available for this window.';

  const hushhAiLast24 = ga4Last24(snapshot.products['hushh.ai'].ga4);
  const kaiProdLast24 = ga4Last24(snapshot.products['kai.hushh.ai'].ga4);
  const kaiUatLast24 = ga4Last24(snapshot.products['uat.kai.hushh.ai'].ga4);
  const hushhTechTraffic = asRecord(snapshot.products['hushhtech.com'].traffic);
  const activityLines = [
    ga4ActivityLine('hushh.ai', hushhAiLast24, 'hushh.ai GA4 last-day data is waiting or unavailable'),
    ga4ActivityLine('kai.hushh.ai production', kaiProdLast24, 'kai.hushh.ai production GA4 last-24h data is waiting or unavailable'),
    ga4ActivityLine('uat.kai.hushh.ai UAT', kaiUatLast24, 'uat.kai.hushh.ai UAT GA4 last-24h data is waiting or unavailable'),
    hasAnyNumber(hushhTechTraffic?.active1DayUsers, hushhTechTraffic?.sessions, hushhTechTraffic?.pageViews)
      ? `hushhtech.com traffic: ${formatOptionalInteger(hushhTechTraffic?.active1DayUsers)} 1-day active users, ${formatOptionalInteger(hushhTechTraffic?.sessions)} sessions, ${formatOptionalInteger(hushhTechTraffic?.pageViews)} page views`
      : 'hushhtech.com 1-day traffic data is waiting or unavailable',
  ];

  const claims: MetricClaim[] = reliabilityRows.flatMap((row) => [
    deterministicClaim(snapshot, row.product, 'cloud_run.request_count', 'Cloud Run requests', row.requests, 'requests', 'Cloud Run Monitoring'),
    deterministicClaim(snapshot, row.product, 'cloud_run.error_count', 'Cloud Run 5xx errors', row.errors, 'errors', 'Cloud Run Monitoring'),
    deterministicClaim(snapshot, row.product, 'cloud_run.error_rate', 'Cloud Run error rate', row.errorRate == null ? null : Number((row.errorRate * 100).toFixed(2)), '%', 'Cloud Run Monitoring'),
  ]);
  if (hasAnyNumber(hushhAiLast24?.users, hushhAiLast24?.sessions, hushhAiLast24?.events)) {
    const label = ga4WindowLabel(hushhAiLast24);
    const source = ga4WindowSource(hushhAiLast24, 'GA4');
    claims.push(
      deterministicClaim(snapshot, 'hushh.ai', 'ga4.last_24_hours.users', `GA4 ${label} users`, optionalNumber(hushhAiLast24?.users), 'users', source),
      deterministicClaim(snapshot, 'hushh.ai', 'ga4.last_24_hours.events', `GA4 ${label} events`, optionalNumber(hushhAiLast24?.events), 'events', source),
    );
  }
  if (hasAnyNumber(kaiProdLast24?.users, kaiProdLast24?.sessions, kaiProdLast24?.events)) {
    const label = ga4WindowLabel(kaiProdLast24);
    const source = ga4WindowSource(kaiProdLast24, 'Kai production GA4');
    claims.push(
      deterministicClaim(snapshot, 'kai.hushh.ai', 'ga4.last_24_hours.users', `Production GA4 ${label} users`, optionalNumber(kaiProdLast24?.users), 'users', source),
      deterministicClaim(snapshot, 'kai.hushh.ai', 'ga4.last_24_hours.events', `Production GA4 ${label} events`, optionalNumber(kaiProdLast24?.events), 'events', source),
    );
  }
  if (hasAnyNumber(kaiUatLast24?.users, kaiUatLast24?.sessions, kaiUatLast24?.events)) {
    const label = ga4WindowLabel(kaiUatLast24);
    const source = ga4WindowSource(kaiUatLast24, 'Kai UAT GA4');
    claims.push(
      deterministicClaim(snapshot, 'uat.kai.hushh.ai', 'ga4.last_24_hours.users', `UAT GA4 ${label} users`, optionalNumber(kaiUatLast24?.users), 'users', source),
      deterministicClaim(snapshot, 'uat.kai.hushh.ai', 'ga4.last_24_hours.events', `UAT GA4 ${label} events`, optionalNumber(kaiUatLast24?.events), 'events', source),
    );
  }
  if (hasAnyNumber(hushhTechTraffic?.active1DayUsers, hushhTechTraffic?.sessions, hushhTechTraffic?.pageViews)) {
    claims.push(
      deterministicClaim(snapshot, 'hushhtech.com', 'traffic.active_1_day_users', '1-day active users', optionalNumber(hushhTechTraffic?.active1DayUsers), 'users', 'hushhtech.com GA4 traffic'),
      deterministicClaim(snapshot, 'hushhtech.com', 'traffic.sessions', 'Traffic sessions', optionalNumber(hushhTechTraffic?.sessions), 'sessions', 'hushhtech.com GA4 traffic'),
      deterministicClaim(snapshot, 'hushhtech.com', 'traffic.page_views', 'Traffic page views', optionalNumber(hushhTechTraffic?.pageViews), 'page views', 'hushhtech.com GA4 traffic'),
    );
  }

  const warnings = warningList(
    'Search Console and some product-account sources are daily or delayed, so this report uses rolling Cloud Run reliability plus source-specific traffic aggregates where available.',
    ga4WindowNote(hushhAiLast24),
    ga4WindowNote(kaiProdLast24),
    ga4WindowNote(kaiUatLast24),
    !hasAnyNumber(kaiProdLast24?.users, kaiProdLast24?.sessions, kaiProdLast24?.events) ? 'kai.hushh.ai production GA4 last-24h data is waiting or unavailable.' : null,
    snapshot.products['hushh.ai'].warnings,
    snapshot.products['kai.hushh.ai'].warnings,
    snapshot.products['uat.kai.hushh.ai'].warnings,
    snapshot.products['hushhtech.com'].warnings,
  );

  return {
    reply: [
      `24-hour operations report for ${windowText}. Cloud Run reliability uses the rolling window; activity metrics use the exact source window named on each metric.`,
      `Reliability: ${reliabilityLine}.`,
      `Activity: ${activityLines.join('; ')}.`,
      highestError
        ? `Primary watch item: ${highestError.product} has the highest Cloud Run error rate in this window at ${formatPercent(highestError.errorRate)}.`
        : 'Primary watch item: source availability is the main issue because reliability data is incomplete.',
      'Keep production kai.hushh.ai and UAT uat.kai.hushh.ai separate; UAT activity is validation behavior, not production truth.',
    ].join('\n'),
    claims,
    sources: sourceSubset(snapshot, [...PRODUCT_KEYS]),
    warnings,
    confidence: warnings.length > 1 ? 'medium' : 'high',
    suggestedQuestions: [
      'Turn this 24-hour report into priority actions.',
      'Show only last-24-hour reliability by product.',
      'Compare Kai production and Kai UAT for the last 24 hours.',
      'What data sources are missing from this 24-hour report?',
    ],
  };
}

function buildDeterministicAgentAnswer(message: string, history: ChatHistoryMessage[], snapshot: MetricsSnapshot): AgentAnswer {
  const contextText = `${history.map((item) => item.content).join('\n')}\n${message}`.toLowerCase();
  if (/^(ping|hello|hi|say hello)$/i.test(message.trim())) {
    return {
      reply: `Hussh Insights AI is online. I can analyze aggregate metrics for hushh.ai, kai.hushh.ai, and hushhtech.com from ${snapshot.range.startDate} to ${snapshot.range.endDate}.`,
      claims: [],
      sources: sourceSubset(snapshot, [...PRODUCT_KEYS]),
      warnings: [],
      confidence: 'high',
      suggestedQuestions: [
        'Review the full dashboard like an operator.',
        'Compare Kai production and Kai UAT.',
        'What are the top 3 issues today?',
      ],
    };
  }

  if (isLast24ReportQuestion(contextText)) {
    return buildLast24HourReportAnswer(snapshot);
  }

  if (isCrossProductUserQuestion(contextText)) {
    return buildCrossProductUsersAnswer(snapshot);
  }

  if (/kai/.test(contextText) && /(uat|production|prod|separat|split|compare)/i.test(contextText)) {
    return buildKaiEnvironmentSplitAnswer(snapshot);
  }

  if (/mars|colony/.test(contextText)) {
    return {
      reply: 'That metric is not available in the metrics matrix. I do not have any aggregate source for a Mars colony user count, so I will not invent a number.',
      claims: [],
      sources: sourceSubset(snapshot, ['hushh.ai']),
      warnings: ['Requested metric is outside the configured aggregate dashboard sources.'],
      confidence: 'high',
      suggestedQuestions: [
        'Show me the available metric catalog.',
        'Which user metrics are configured today?',
        'Audit source health across all products.',
      ],
    };
  }

  if (/top\s*3|act on|issues?|priorit/i.test(message)) {
    const products: ProductKey[] = [...PRODUCT_KEYS];
    const rates = products.map((product) => {
      const cloudRun = asRecord(snapshot.products[product].cloudRun);
      return { product, errorRate: optionalNumber(cloudRun?.errorRate), requests: toNumber(cloudRun?.requestCount) };
    }).sort((a, b) => (b.errorRate ?? -1) - (a.errorRate ?? -1));
    const warnings = Object.values(snapshot.products).flatMap((product) => product.warnings).slice(0, 3);
    const topRate = rates[0];
    return {
      reply: [
        `1. Watch ${topRate.product} reliability first: it has the highest Cloud Run error rate at ${formatPercent(topRate.errorRate)} across ${formatInteger(topRate.requests)} requests in ${snapshot.range.startDate} to ${snapshot.range.endDate}.`,
        `2. Clear source gaps next: ${warnings[0] ?? 'at least one delayed or unavailable source is present, so keep source-status caveats visible before making growth decisions.'}`,
        `3. Use the product source matrix before acting: compare Cloud Run, GA4, Search Console, and funnel availability so product decisions are based on live aggregate data, not missing integrations.`,
      ].join('\n'),
      claims: [
        deterministicClaim(snapshot, topRate.product, 'cloud_run.error_rate', 'Cloud Run error rate', Number(((topRate.errorRate ?? 0) * 100).toFixed(2)), '%', 'Cloud Run Monitoring'),
        deterministicClaim(snapshot, topRate.product, 'cloud_run.request_count', 'Cloud Run requests', topRate.requests, 'requests', 'Cloud Run Monitoring'),
      ],
      sources: sourceSubset(snapshot, products),
      warnings,
      confidence: 'medium',
      suggestedQuestions: [
        'Turn this into recommended actions.',
        'Show source caveats for each issue.',
        'Which issue is most urgent today?',
      ],
    };
  }

  if (/error rate|healthiest|compare/.test(contextText)) {
    const rows = (['hushh.ai', 'kai.hushh.ai', 'hushhtech.com'] as ProductKey[]).map((product) => {
      const cloudRun = asRecord(snapshot.products[product].cloudRun);
      return { product, errorRate: optionalNumber(cloudRun?.errorRate), requests: toNumber(cloudRun?.requestCount) };
    }).sort((a, b) => (a.errorRate ?? 1) - (b.errorRate ?? 1));
    const healthiest = rows[0];
    return {
      reply: `For ${snapshot.range.startDate} to ${snapshot.range.endDate}, ${rows.map((row) => `${row.product} is ${formatPercent(row.errorRate)} across ${formatInteger(row.requests)} requests`).join(', ')}. ${healthiest.product} is healthiest on Cloud Run because it has the lowest observed error rate.`,
      claims: rows.flatMap((row) => [
        deterministicClaim(snapshot, row.product, 'cloud_run.error_rate', 'Cloud Run error rate', Number(((row.errorRate ?? 0) * 100).toFixed(2)), '%', 'Cloud Run Monitoring'),
        deterministicClaim(snapshot, row.product, 'cloud_run.request_count', 'Cloud Run requests', row.requests, 'requests', 'Cloud Run Monitoring'),
      ]),
      sources: sourceSubset(snapshot, rows.map((row) => row.product)),
      warnings: [],
      confidence: 'high',
      suggestedQuestions: [
        'Show the daily reliability trend.',
        'Which service had the most 5xx responses?',
        'What action should we take on reliability?',
      ],
    };
  }

  if (/signup|persisted|conversion|funnel/.test(contextText) && contextText.includes('hushhtech')) {
    const funnel = asRecord(snapshot.products['hushhtech.com'].businessFunnel);
    const rate = optionalNumber(funnel?.signupToPersistedRate);
    return {
      reply: `For ${snapshot.range.startDate} to ${snapshot.range.endDate}, hushhtech.com signup-to-persisted conversion is ${formatPercent(rate, 1)}: ${formatInteger(funnel?.signups)} signups produced ${formatInteger(funnel?.persistedUsers)} persisted users.`,
      claims: [
        deterministicClaim(snapshot, 'hushhtech.com', 'funnel.signup_to_persisted_rate', 'Signup to persisted conversion', rate == null ? null : Number((rate * 100).toFixed(1)), '%', 'hushhtech.com business funnel'),
        deterministicClaim(snapshot, 'hushhtech.com', 'funnel.signups', 'Signups', toNumber(funnel?.signups), 'users', 'hushhtech.com business funnel'),
        deterministicClaim(snapshot, 'hushhtech.com', 'funnel.persisted_users', 'Persisted users', toNumber(funnel?.persistedUsers), 'users', 'hushhtech.com business funnel'),
      ],
      sources: sourceSubset(snapshot, ['hushhtech.com']),
      warnings: snapshot.products['hushhtech.com'].warnings,
      confidence: 'high',
      suggestedQuestions: [
        'Where is the hushhtech funnel dropping?',
        'Compare signups with active users.',
        'Give recommended actions for conversion.',
      ],
    };
  }

  if (/search quer|top quer/.test(contextText)) {
    const product = inferProductFromQuestion(contextText);
    const selectedProduct = product === 'all' ? 'hushhtech.com' : product;
    const search = asRecord(snapshot.products[selectedProduct].searchConsole);
    const topQueries = recordArray(search?.topQueries).slice(0, 5);
    const queryText = topQueries.length > 0
      ? topQueries.map((row, index) => `${index + 1}. ${row.query}: ${formatInteger(row.clicks)} clicks / ${formatInteger(row.impressions)} impressions`).join('\n')
      : 'No top search query rows are available for this range.';
    return {
      reply: `Top Search Console queries for ${selectedProduct} from ${snapshot.range.startDate} to ${snapshot.range.endDate}:\n${queryText}.`,
      claims: [
        deterministicClaim(snapshot, selectedProduct, 'search_console.clicks', 'Search Console clicks', toNumber(search?.clicks), 'clicks', 'Search Console'),
        deterministicClaim(snapshot, selectedProduct, 'search_console.impressions', 'Search Console impressions', toNumber(search?.impressions), 'impressions', 'Search Console'),
      ],
      sources: sourceSubset(snapshot, [selectedProduct]),
      warnings: snapshot.products[selectedProduct].warnings,
      confidence: topQueries.length > 0 ? 'high' : 'medium',
      suggestedQuestions: [
        `Show ${selectedProduct} Search Console caveats.`,
        `Compare ${selectedProduct} search clicks and impressions.`,
        'Which query should we optimize first?',
      ],
    };
  }

  const inferredProduct = inferProductFromQuestion(contextText);
  const product = inferredProduct === 'all' ? 'hushh.ai' : inferredProduct;
  const cloudRun = asRecord(snapshot.products[product].cloudRun);
  return {
    reply: `For ${snapshot.range.startDate} to ${snapshot.range.endDate}, ${product} received ${formatInteger(cloudRun?.requestCount)} Cloud Run requests with ${formatInteger(cloudRun?.errorCount)} 5xx errors and a ${formatPercent(cloudRun?.errorRate)} error rate. The answer is grounded in Cloud Run Monitoring.`,
    claims: [
      deterministicClaim(snapshot, product, 'cloud_run.request_count', 'Cloud Run requests', toNumber(cloudRun?.requestCount), 'requests', 'Cloud Run Monitoring'),
      deterministicClaim(snapshot, product, 'cloud_run.error_count', 'Cloud Run 5xx errors', toNumber(cloudRun?.errorCount), 'errors', 'Cloud Run Monitoring'),
      deterministicClaim(snapshot, product, 'cloud_run.error_rate', 'Cloud Run error rate', Number((toNumber(cloudRun?.errorRate) * 100).toFixed(2)), '%', 'Cloud Run Monitoring'),
    ],
    sources: sourceSubset(snapshot, [product]),
    warnings: snapshot.products[product].warnings,
    confidence: 'high',
    suggestedQuestions: [
      `Show ${product} source caveats.`,
      `Show ${product} daily trend.`,
      'What should I act on next?',
    ],
  };
}

function isClearlyUnsupportedMetricQuestion(message: string): boolean {
  return /mars|colony/i.test(message);
}

function shouldUseDeterministicFastPath(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    /^(ping|hello|hi|say hello)$/i.test(message.trim())
    || isClearlyUnsupportedMetricQuestion(message)
    || isCrossProductUserQuestion(message)
    || isLast24ReportQuestion(message)
    || (lower.includes('kai') && /(uat|production|prod|separat|split|compare)/i.test(message))
    || /top\s*3|act on|issues?|priorit/i.test(message)
    || (lower.includes('cloud run') && /(request|error rate|healthiest|compare|what about|exact)/i.test(message))
    || (lower.includes('hushhtech') && /(signup|persisted|conversion|funnel)/i.test(message))
    || /search quer|top quer/i.test(message)
  );
}

async function generateStructuredAgentAnswer(
  ai: any,
  message: string,
  history: ChatHistoryMessage[],
  toolResults: AgentToolResult[],
  validationNote = '',
): Promise<{ answer: AgentAnswer | null; usage: Record<string, number> | null; finishReason: string | null }> {
  const response = await ai.models.generateContent({
    model: GEMINI_METRICS_CHAT_MODEL,
    contents: [{
      role: 'user' as const,
      parts: [{
        text: JSON.stringify({
          userMessage: message,
          recentHistory: history,
          toolResults,
          validationNote,
        }),
      }],
    }],
    config: {
      systemInstruction: HUSSH_ANALYST_SYNTHESIS_PROMPT,
      responseMimeType: 'application/json',
      responseJsonSchema: AGENT_ANSWER_SCHEMA,
      maxOutputTokens: METRICS_CHAT_MAX_OUTPUT_TOKENS,
      temperature: 0.2,
      thinkingConfig: { thinkingBudget: -1 },
      httpOptions: { timeout: METRICS_CHAT_REQUEST_TIMEOUT_MS },
    },
  });
  const usage = response.usageMetadata ? {
    prompt_tokens: response.usageMetadata.promptTokenCount ?? 0,
    completion_tokens: response.usageMetadata.candidatesTokenCount ?? 0,
    total_tokens: response.usageMetadata.totalTokenCount ?? 0,
  } : null;
  return {
    answer: parseAgentAnswer(extractResponseText(response)),
    usage,
    finishReason: response.candidates?.[0]?.finishReason ? String(response.candidates[0].finishReason) : null,
  };
}

async function runHusshInsightsAgent(message: string, history: ChatHistoryMessage[]) {
  const inferredWindow = inferAgentWindow(message, history);
  if (shouldUseDeterministicFastPath(message)) {
    const snapshot = inferredWindow === 'last_24_hours'
      ? await getLast24MetricsSnapshot()
      : await getMetricsSnapshot(7);
    return {
      answer: buildDeterministicAgentAnswer(message, history, snapshot),
      usage: null,
    };
  }

  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({
    apiKey: GEMINI_API_KEY,
    httpOptions: { timeout: METRICS_CHAT_REQUEST_TIMEOUT_MS },
  });
  const modelWarnings: string[] = [];
  let toolResults: AgentToolResult[] = [];
  try {
    toolResults = await collectAgentToolResults(ai, message, history);
  } catch (err) {
    const messageText = err instanceof Error ? err.message : String(err);
    modelWarnings.push(`AI tool loop fallback: ${messageText}`);
    toolResults = [await executeAgentTool(
      'get_product_metrics',
      inferredWindow === 'last_24_hours'
        ? { product: 'all', rangeDays: 1, window: 'last_24_hours' }
        : { product: 'all', rangeDays: 7 },
    )];
  }
  const snapshot = inferredWindow === 'last_24_hours'
    ? await getLast24MetricsSnapshot()
    : await getMetricsSnapshot(7);

  let generated: { answer: AgentAnswer | null; usage: Record<string, number> | null; finishReason: string | null } = {
    answer: null,
    usage: null,
    finishReason: null,
  };
  let answer: AgentAnswer | null = null;
  let errors: string[] = [];
  try {
    generated = await generateStructuredAgentAnswer(ai, message, history, toolResults);
    answer = generated.answer ? normalizeAgentAnswer(generated.answer) : null;
    errors = answer ? validateAgentAnswer(answer, snapshot) : ['response was not valid JSON'];
    if (generated.finishReason && generated.finishReason !== 'STOP') {
      errors.push(`model finish reason was ${generated.finishReason}`);
    }

    if (errors.length > 0) {
      generated = await generateStructuredAgentAnswer(
        ai,
        message,
        history,
        toolResults,
        `Previous answer failed validation: ${errors.join('; ')}. Regenerate a complete, schema-valid answer with only supported numeric claims.`,
      );
      answer = generated.answer ? normalizeAgentAnswer(generated.answer) : null;
      errors = answer ? validateAgentAnswer(answer, snapshot) : ['retry response was not valid JSON'];
      if (generated.finishReason && generated.finishReason !== 'STOP') {
        errors.push(`retry model finish reason was ${generated.finishReason}`);
      }
    }
  } catch (err) {
    const messageText = err instanceof Error ? err.message : String(err);
    errors = [`AI answer generation fallback: ${messageText}`];
  }

  if (!answer || errors.length > 0) {
    answer = buildDeterministicAgentAnswer(message, history, snapshot);
    answer.warnings = warningList(answer.warnings);
  } else if (modelWarnings.length > 0) {
    answer.warnings = warningList(answer.warnings);
  }

  return { answer, usage: generated.usage };
}

app.use(express.json({ limit: '64kb' }));

app.post('/api/chat', async (req, res) => {
  const body = req.body as { message?: unknown; history?: unknown };
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const history = normalizeHistory(body.history);

  if (!message) {
    res.status(400).json({ error: 'Message is required.' });
    return;
  }

  if (message.length > 2000) {
    res.status(400).json({ error: 'Message is too long. Maximum 2000 characters.' });
    return;
  }

  if (!GEMINI_API_KEY) {
    res.status(503).json({ error: 'Hussh Insights AI is not configured. Set the GEMINI_API_KEY environment variable.' });
    return;
  }

  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  if (!checkChatRateLimit(clientIp)) {
    res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
    return;
  }

  try {
    const { answer, usage } = await runHusshInsightsAgent(message, history);
    res.json({
      reply: answer.reply,
      usage,
      model: GEMINI_METRICS_CHAT_MODEL,
      claims: answer.claims,
      sources: answer.sources,
      warnings: answer.warnings,
      confidence: answer.confidence,
      suggestedQuestions: answer.suggestedQuestions ?? [],
    });
  } catch (err) {
    const messageText = err instanceof Error ? err.message : String(err);
    console.error('Hussh Insights AI chat error:', messageText);
    res.status(502).json({ error: 'Hussh Insights AI encountered an error. Please try again.' });
  }
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
