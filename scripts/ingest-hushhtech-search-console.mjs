#!/usr/bin/env node
import { BigQuery } from '@google-cloud/bigquery';
import { OAuth2Client } from 'google-auth-library';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DEFAULT_PROJECT = 'hushh-ai-prod';
const DEFAULT_DATASET = 'hushhtech_search_console_api';
const DEFAULT_SITE_URL = 'sc-domain:hushhtech.com';
const DEFAULT_SEARCH_TYPE = 'web';
const DEFAULT_DATA_STATE = 'all';
const DEFAULT_ROW_LIMIT = 25000;
const MAX_PAGE_LIMIT = 25000;

const TABLES = {
  site_daily: {
    dimensions: ['date'],
    keyFields: ['data_date', 'site_url', 'search_type'],
    dimensionFields: [],
    schema: [
      { name: 'data_date', type: 'DATE', mode: 'REQUIRED' },
      { name: 'site_url', type: 'STRING', mode: 'REQUIRED' },
      { name: 'search_type', type: 'STRING', mode: 'REQUIRED' },
      { name: 'data_state', type: 'STRING' },
      { name: 'clicks', type: 'INT64' },
      { name: 'impressions', type: 'INT64' },
      { name: 'ctr', type: 'FLOAT64' },
      { name: 'average_position', type: 'FLOAT64' },
      { name: 'ingested_at', type: 'TIMESTAMP' },
    ],
  },
  query_daily: {
    dimensions: ['date', 'query'],
    keyFields: ['data_date', 'site_url', 'search_type', 'query'],
    dimensionFields: ['query'],
    schema: [
      { name: 'data_date', type: 'DATE', mode: 'REQUIRED' },
      { name: 'site_url', type: 'STRING', mode: 'REQUIRED' },
      { name: 'search_type', type: 'STRING', mode: 'REQUIRED' },
      { name: 'query', type: 'STRING', mode: 'REQUIRED' },
      { name: 'data_state', type: 'STRING' },
      { name: 'clicks', type: 'INT64' },
      { name: 'impressions', type: 'INT64' },
      { name: 'ctr', type: 'FLOAT64' },
      { name: 'average_position', type: 'FLOAT64' },
      { name: 'ingested_at', type: 'TIMESTAMP' },
    ],
  },
  page_daily: {
    dimensions: ['date', 'page'],
    keyFields: ['data_date', 'site_url', 'search_type', 'page_url'],
    dimensionFields: ['page_url'],
    schema: [
      { name: 'data_date', type: 'DATE', mode: 'REQUIRED' },
      { name: 'site_url', type: 'STRING', mode: 'REQUIRED' },
      { name: 'search_type', type: 'STRING', mode: 'REQUIRED' },
      { name: 'page_url', type: 'STRING', mode: 'REQUIRED' },
      { name: 'data_state', type: 'STRING' },
      { name: 'clicks', type: 'INT64' },
      { name: 'impressions', type: 'INT64' },
      { name: 'ctr', type: 'FLOAT64' },
      { name: 'average_position', type: 'FLOAT64' },
      { name: 'ingested_at', type: 'TIMESTAMP' },
    ],
  },
  country_daily: {
    dimensions: ['date', 'country'],
    keyFields: ['data_date', 'site_url', 'search_type', 'country'],
    dimensionFields: ['country'],
    schema: [
      { name: 'data_date', type: 'DATE', mode: 'REQUIRED' },
      { name: 'site_url', type: 'STRING', mode: 'REQUIRED' },
      { name: 'search_type', type: 'STRING', mode: 'REQUIRED' },
      { name: 'country', type: 'STRING', mode: 'REQUIRED' },
      { name: 'data_state', type: 'STRING' },
      { name: 'clicks', type: 'INT64' },
      { name: 'impressions', type: 'INT64' },
      { name: 'ctr', type: 'FLOAT64' },
      { name: 'average_position', type: 'FLOAT64' },
      { name: 'ingested_at', type: 'TIMESTAMP' },
    ],
  },
  device_daily: {
    dimensions: ['date', 'device'],
    keyFields: ['data_date', 'site_url', 'search_type', 'device'],
    dimensionFields: ['device'],
    schema: [
      { name: 'data_date', type: 'DATE', mode: 'REQUIRED' },
      { name: 'site_url', type: 'STRING', mode: 'REQUIRED' },
      { name: 'search_type', type: 'STRING', mode: 'REQUIRED' },
      { name: 'device', type: 'STRING', mode: 'REQUIRED' },
      { name: 'data_state', type: 'STRING' },
      { name: 'clicks', type: 'INT64' },
      { name: 'impressions', type: 'INT64' },
      { name: 'ctr', type: 'FLOAT64' },
      { name: 'average_position', type: 'FLOAT64' },
      { name: 'ingested_at', type: 'TIMESTAMP' },
    ],
  },
};

function parseArgs(argv) {
  const args = {
    days: numberFromEnv(['SEARCH_CONSOLE_BACKFILL_DAYS', 'HUSHHTECH_SEARCH_BACKFILL_DAYS'], 16),
    startDate: envValue('SEARCH_CONSOLE_START_DATE', 'HUSHHTECH_SEARCH_START_DATE'),
    endDate: envValue('SEARCH_CONSOLE_END_DATE', 'HUSHHTECH_SEARCH_END_DATE'),
    ensureOnly: false,
    skipApi: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--days' && argv[index + 1]) {
      args.days = parsePositiveInt(argv[index + 1], args.days);
      index += 1;
    } else if (arg === '--start-date' && argv[index + 1]) {
      args.startDate = argv[index + 1];
      index += 1;
    } else if (arg === '--end-date' && argv[index + 1]) {
      args.endDate = argv[index + 1];
      index += 1;
    } else if (arg === '--ensure-only') {
      args.ensureOnly = true;
    } else if (arg === '--skip-api') {
      args.skipApi = true;
    }
  }

  return args;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function envValue(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function numberFromEnv(names, fallback) {
  const normalizedNames = Array.isArray(names) ? names : [names];
  return parsePositiveInt(envValue(...normalizedNames), fallback);
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function resolveDateRange(args) {
  const now = new Date();
  const defaultEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const endDate = args.endDate || formatDate(defaultEnd);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  const startDate = args.startDate || formatDate(addDays(end, -(args.days - 1)));
  return { startDate, endDate };
}

function tableRef(projectId, datasetId, tableId) {
  return `\`${projectId}.${datasetId}.${tableId}\``;
}

function parseOauthJson() {
  const raw = envValue('SEARCH_CONSOLE_OAUTH_JSON', 'HUSHHTECH_SEARCH_CONSOLE_OAUTH_JSON');
  if (!raw) {
    throw new Error('SEARCH_CONSOLE_OAUTH_JSON is not configured');
  }
  const parsed = JSON.parse(raw);
  const installed = parsed.installed || parsed.web || parsed;
  const clientId = installed.client_id;
  const clientSecret = installed.client_secret;
  const refreshToken = installed.refresh_token || parsed.refresh_token;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Search Console OAuth JSON must include client_id, client_secret, and refresh_token');
  }
  return { clientId, clientSecret, refreshToken };
}

function createSearchConsoleClient() {
  const { clientId, clientSecret, refreshToken } = parseOauthJson();
  const client = new OAuth2Client(clientId, clientSecret);
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

async function ensureDatasetAndTables(bigquery, projectId, datasetId) {
  const dataset = bigquery.dataset(datasetId);
  const [exists] = await dataset.exists();
  if (!exists) {
    await dataset.create({ location: 'US' });
  }

  for (const [tableId, config] of Object.entries(TABLES)) {
    const table = dataset.table(tableId);
    const [tableExists] = await table.exists();
    if (!tableExists) {
      await table.create({
        schema: { fields: config.schema },
        timePartitioning: { type: 'DAY', field: 'data_date' },
        clustering: { fields: ['site_url', 'search_type', ...config.dimensionFields].slice(0, 4) },
      });
    }
  }

  return { projectId, datasetId, tables: Object.keys(TABLES) };
}

function buildDimensionFilterGroups(pageFilterRegex) {
  if (!pageFilterRegex) return undefined;
  return [
    {
      groupType: 'and',
      filters: [
        {
          dimension: 'page',
          operator: 'includingRegex',
          expression: pageFilterRegex,
        },
      ],
    },
  ];
}

async function searchConsoleQuery(client, { siteUrl, startDate, endDate, searchType, dataState, dimensions, rowLimit, startRow, pageFilterRegex }) {
  const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const dimensionFilterGroups = buildDimensionFilterGroups(pageFilterRegex);
  const response = await client.request({
    url,
    method: 'POST',
    headers: envValue('SEARCH_CONSOLE_QUOTA_PROJECT', 'HUSHHTECH_SEARCH_QUOTA_PROJECT')
      ? { 'x-goog-user-project': envValue('SEARCH_CONSOLE_QUOTA_PROJECT', 'HUSHHTECH_SEARCH_QUOTA_PROJECT') }
      : undefined,
    data: {
      startDate,
      endDate,
      dimensions,
      rowLimit,
      startRow,
      searchType,
      dataState,
      ...(dimensionFilterGroups ? { dimensionFilterGroups, aggregationType: 'auto' } : {}),
    },
    timeout: 60_000,
  });
  return response.data?.rows ?? [];
}

async function fetchAllRows(client, options) {
  const rowLimit = Math.min(
    numberFromEnv(['SEARCH_CONSOLE_API_ROW_LIMIT', 'HUSHHTECH_SEARCH_CONSOLE_API_ROW_LIMIT'], DEFAULT_ROW_LIMIT),
    MAX_PAGE_LIMIT,
  );
  const rows = [];
  for (let startRow = 0; ; startRow += rowLimit) {
    const batch = await searchConsoleQuery(client, { ...options, rowLimit, startRow });
    rows.push(...batch);
    if (batch.length < rowLimit) break;
  }
  return rows;
}

function normalizeRow(tableId, row, config, options) {
  const keys = Array.isArray(row.keys) ? row.keys : [];
  const dataDate = String(keys[0] || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataDate)) return null;
  const output = {
    data_date: dataDate,
    site_url: options.siteUrl,
    search_type: options.searchType,
    data_state: options.dataState,
    clicks: Math.round(Number(row.clicks || 0)),
    impressions: Math.round(Number(row.impressions || 0)),
    ctr: row.ctr == null ? null : Number(row.ctr),
    average_position: row.position == null ? null : Number(row.position),
    ingested_at: new Date().toISOString(),
  };

  for (let index = 0; index < config.dimensionFields.length; index += 1) {
    output[config.dimensionFields[index]] = String(keys[index + 1] ?? '');
  }

  if (tableId !== 'site_daily' && config.dimensionFields.some((field) => output[field] === '')) return null;
  return output;
}

async function writeRows(bigquery, projectId, datasetId, tableId, config, rows) {
  if (rows.length === 0) return { tableId, rows: 0 };

  const dataset = bigquery.dataset(datasetId);
  const stagingId = `_staging_${tableId}_${Date.now()}`;
  const staging = dataset.table(stagingId);
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'hushhtech-search-'));
  const filePath = path.join(tmpDir, `${tableId}.json`);

  try {
    await writeFile(filePath, rows.map((row) => JSON.stringify(row)).join('\n'));
    await staging.create({ schema: { fields: config.schema } });
    await staging.load(filePath, {
      sourceFormat: 'NEWLINE_DELIMITED_JSON',
      schema: { fields: config.schema },
      writeDisposition: 'WRITE_TRUNCATE',
    });

    const target = tableRef(projectId, datasetId, tableId);
    const source = tableRef(projectId, datasetId, stagingId);
    const keyPredicate = config.keyFields.map((field) => `T.${field} = S.${field}`).join(' AND ');
    const updateFields = config.schema
      .map((field) => field.name)
      .filter((field) => !config.keyFields.includes(field))
      .map((field) => `${field} = S.${field}`)
      .join(', ');
    const insertFields = config.schema.map((field) => field.name).join(', ');
    const insertValues = config.schema.map((field) => `S.${field.name}`).join(', ');
    await bigquery.query({
      location: 'US',
      query: `
        MERGE ${target} T
        USING ${source} S
        ON ${keyPredicate}
        WHEN MATCHED THEN UPDATE SET ${updateFields}
        WHEN NOT MATCHED THEN INSERT (${insertFields}) VALUES (${insertValues})
      `,
    });
  } finally {
    await staging.delete({ ignoreNotFound: true }).catch(() => undefined);
    await rm(tmpDir, { recursive: true, force: true });
  }

  return { tableId, rows: rows.length };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = envValue('SEARCH_CONSOLE_FALLBACK_PROJECT', 'HUSHHTECH_SEARCH_FALLBACK_PROJECT', 'HUSHHTECH_SEARCH_PROJECT') || DEFAULT_PROJECT;
  const datasetId = envValue('SEARCH_CONSOLE_FALLBACK_DATASET', 'HUSHHTECH_SEARCH_FALLBACK_DATASET') || DEFAULT_DATASET;
  const siteUrl = envValue('SEARCH_CONSOLE_SITE_URL', 'HUSHHTECH_SEARCH_CONSOLE_SITE_URL') || DEFAULT_SITE_URL;
  const searchType = envValue('SEARCH_CONSOLE_TYPE', 'HUSHHTECH_SEARCH_CONSOLE_TYPE') || DEFAULT_SEARCH_TYPE;
  const dataState = envValue('SEARCH_CONSOLE_DATA_STATE', 'HUSHHTECH_SEARCH_CONSOLE_DATA_STATE') || DEFAULT_DATA_STATE;
  const pageFilterRegex = envValue('SEARCH_CONSOLE_PAGE_FILTER_REGEX', 'HUSHHTECH_SEARCH_CONSOLE_PAGE_FILTER_REGEX');
  const range = resolveDateRange(args);
  const bigquery = new BigQuery({ projectId });
  const setup = await ensureDatasetAndTables(bigquery, projectId, datasetId);

  if (args.ensureOnly || args.skipApi) {
    console.log(JSON.stringify({ ok: true, mode: 'ensure-only', setup }, null, 2));
    return;
  }

  const client = createSearchConsoleClient();
  const summary = [];
  for (const [tableId, config] of Object.entries(TABLES)) {
    const apiRows = await fetchAllRows(client, {
      siteUrl,
      startDate: range.startDate,
      endDate: range.endDate,
      searchType,
      dataState,
      dimensions: config.dimensions,
      pageFilterRegex,
    });
    const rows = apiRows
      .map((row) => normalizeRow(tableId, row, config, { siteUrl, searchType, dataState }))
      .filter(Boolean);
    summary.push(await writeRows(bigquery, projectId, datasetId, tableId, config, rows));
  }

  console.log(JSON.stringify({
    ok: true,
    source: 'search-console-api',
    target: `${projectId}.${datasetId}`,
    siteUrl,
    searchType,
    dataState,
    pageFilterRegex: pageFilterRegex || null,
    range,
    summary,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exit(1);
});
