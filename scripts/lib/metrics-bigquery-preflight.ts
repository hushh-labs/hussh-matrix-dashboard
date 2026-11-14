import { createHash, randomUUID } from 'node:crypto';

// Operator-only planning. This module is not imported by either application or
// collector. There is deliberately no paid execution or query-results method.
export const BIGQUERY_PREFLIGHT = Object.freeze({
  version: 'one-export-capture-20261105-v1',
  billingProject: 'hushh-ai-prod',
  location: 'US',
  source: Object.freeze({ projectId: 'hushh-pda', datasetId: 'analytics_526603671', tableId: 'events_20261105' }),
  exportDate: '2026-11-05',
  maximumBytesBilled: 70 * 1024 * 1024,
  timeoutMs: 15_000,
  maximumResponseBytes: 1024 * 1024,
});

// This is capture diagnostics over the entire export, NOT production/customer
// adoption. No identity, prompt, location, URL or arbitrary label leaves SQL.
// ARRAY preserves one row per event, including absent/duplicate env parameters.
export const BIGQUERY_PREFLIGHT_SQL = `WITH captured AS (
  SELECT platform, NULLIF(user_id, '') IS NOT NULL AS has_account_id,
    ARRAY(SELECT AS STRUCT value.string_value AS tag
      FROM UNNEST(event_params) WHERE key = 'env') AS env_tags
  FROM \`hushh-pda.analytics_526603671.events_20261105\`
), labelled AS (
  SELECT platform, has_account_id, ARRAY_LENGTH(env_tags) AS env_count,
    env_tags[SAFE_OFFSET(0)].tag AS env_tag
  FROM captured
)
SELECT COUNT(*) AS exported_events,
  COUNTIF(has_account_id) AS events_with_account_id,
  COUNTIF(platform = 'WEB') AS web_events,
  COUNTIF(platform = 'IOS') AS ios_events,
  COUNTIF(platform = 'ANDROID') AS android_events,
  COUNTIF(platform IS NULL OR platform NOT IN ('WEB', 'IOS', 'ANDROID')) AS other_platform_events,
  COUNTIF(env_count = 0 OR (env_count = 1 AND env_tag IS NULL)) AS missing_env_events,
  COUNTIF(env_count > 1) AS duplicate_env_events,
  COUNTIF(env_count = 1 AND env_tag = 'production') AS production_label_events,
  COUNTIF(env_count = 1 AND env_tag = 'uat') AS uat_label_events,
  COUNTIF(env_count = 1 AND env_tag = 'development') AS development_label_events,
  COUNTIF(env_count = 1 AND env_tag IS NOT NULL
    AND env_tag NOT IN ('production', 'uat', 'development')) AS other_env_events
FROM labelled`;

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const record = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Refused('invalid_metadata');
  return value as Record<string, any>;
};
class Refused extends Error { constructor(readonly reason: string) { super(reason); } }
function requireThat(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Refused(reason);
}
function integer(value: unknown) {
  requireThat(typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value), 'invalid_byte_estimate');
  const parsed = Number(value);
  requireThat(Number.isSafeInteger(parsed), 'invalid_byte_estimate');
  return parsed;
}
function sameSource(value: unknown) {
  const source = record(value);
  return Object.keys(source).length === 3
    && Object.entries(BIGQUERY_PREFLIGHT.source).every(([key, expected]) => source[key] === expected);
}

export function bigQueryPreflightRequest() {
  return {
    jobReference: { projectId: BIGQUERY_PREFLIGHT.billingProject, location: BIGQUERY_PREFLIGHT.location,
      jobId: `metrics_preflight_${randomUUID().replaceAll('-', '_')}` },
    configuration: {
      dryRun: true,
      query: { query: BIGQUERY_PREFLIGHT_SQL, useLegacySql: false, useQueryCache: false,
        maximumBytesBilled: String(BIGQUERY_PREFLIGHT.maximumBytesBilled) },
      labels: { application: 'metrics_planning', plan: BIGQUERY_PREFLIGHT.version },
    },
  } as const;
}

export function validatePreflightMetadata(value: unknown) {
  const metadata = record(value);
  requireThat(sameSource(metadata.tableReference) && metadata.type === 'TABLE'
    && metadata.location === 'US' && !metadata.externalDataConfiguration
    && !metadata.view && !metadata.materializedView && !metadata.cloneDefinition
    && !metadata.snapshotDefinition, 'source_mismatch');
  requireThat(typeof metadata.etag === 'string' && metadata.etag.length > 0 && metadata.etag.length <= 500
    && typeof metadata.lastModifiedTime === 'string' && /^[1-9][0-9]{0,15}$/.test(metadata.lastModifiedTime), 'invalid_metadata');
  const fields = record(metadata.schema).fields;
  requireThat(Array.isArray(fields), 'schema_mismatch');
  function field(list: any[], name: string, type: string, mode: string) {
    const matches = list.filter(value => value?.name === name);
    requireThat(matches.length === 1, 'schema_mismatch');
    const value = matches[0];
    requireThat(value.type === type && (value.mode ?? 'NULLABLE') === mode
      && !value.policyTags && !value.dataPolicies, 'schema_mismatch');
    return value;
  }
  field(fields, 'platform', 'STRING', 'NULLABLE');
  field(fields, 'user_id', 'STRING', 'NULLABLE');
  const params = field(fields, 'event_params', 'RECORD', 'REPEATED');
  requireThat(Array.isArray(params.fields), 'schema_mismatch');
  field(params.fields, 'key', 'STRING', 'NULLABLE');
  const parameterValue = field(params.fields, 'value', 'RECORD', 'NULLABLE');
  requireThat(Array.isArray(parameterValue.fields), 'schema_mismatch');
  field(parameterValue.fields, 'string_value', 'STRING', 'NULLABLE');
  return {
    source: BIGQUERY_PREFLIGHT.source, type: 'TABLE', location: 'US',
    schemaDigest: hash(fields), etag: metadata.etag, lastModifiedTime: metadata.lastModifiedTime,
  };
}

export function validatePreflightEstimate(value: unknown, expectedJobId: string) {
  const result = record(value), statistics = record(result.statistics), query = record(statistics.query);
  requireThat(!result.status?.errorResult && !result.status?.errors?.length, 'provider_rejected');
  requireThat(result.configuration?.dryRun === true
    && result.configuration?.query?.query === BIGQUERY_PREFLIGHT_SQL
    && result.configuration?.query?.useLegacySql === false
    && result.configuration?.query?.useQueryCache === false
    && result.configuration?.query?.maximumBytesBilled === String(BIGQUERY_PREFLIGHT.maximumBytesBilled)
    && result.jobReference?.projectId === BIGQUERY_PREFLIGHT.billingProject
    // The native dry-run API omits jobId even when supplied (no persisted job).
    // If returned it must still match. Paid-job recovery must require its ID;
    // this estimator has no paid submit, native lookup or result method.
    && (result.jobReference?.jobId === undefined || result.jobReference.jobId === expectedJobId)
    && result.jobReference?.location === 'US', 'dry_run_proof_mismatch');
  requireThat(query.statementType === 'SELECT' && query.totalBytesProcessedAccuracy === 'PRECISE'
    && Array.isArray(query.referencedTables) && query.referencedTables.length === 1
    && sameSource(query.referencedTables[0])
    && (!query.undeclaredQueryParameters || query.undeclaredQueryParameters.length === 0)
    && statistics.rowLevelSecurityStatistics?.rowLevelSecurityApplied !== true
    && query.rowLevelSecurityStatistics?.rowLevelSecurityApplied !== true, 'estimate_scope_mismatch');
  const bytes = integer(query.totalBytesProcessed);
  requireThat(bytes > 0 && bytes <= BIGQUERY_PREFLIGHT.maximumBytesBilled, 'estimate_outside_ceiling');
  if (statistics.totalBytesProcessed !== undefined) {
    requireThat(integer(statistics.totalBytesProcessed) === bytes, 'conflicting_byte_estimate');
  }
  return bytes;
}

export async function runBigQueryPreflight(options: {
  accessToken: string;
  fetch?: typeof fetch;
  now?: () => Date;
}) {
  const now = () => (options.now?.() ?? new Date()).toISOString();
  const request = bigQueryPreflightRequest();
  const receipt = {
    plan: BIGQUERY_PREFLIGHT.version,
    state: 'held' as 'held' | 'estimated',
    startedAt: now(), completedAt: '', reason: '',
    requestDigest: hash(request), queryDigest: hash(BIGQUERY_PREFLIGHT_SQL),
    planningJobId: request.jobReference.jobId,
    exportDate: BIGQUERY_PREFLIGHT.exportDate, reportingTimezone: 'unverified',
    countingUnit: 'exported event rows; not distinct accounts or confirmed outcomes',
    sourceScope: 'whole retained export; production customer scope unverified',
    billingProject: BIGQUERY_PREFLIGHT.billingProject, location: BIGQUERY_PREFLIGHT.location,
    source: BIGQUERY_PREFLIGHT.source,
    maximumBytesBilled: BIGQUERY_PREFLIGHT.maximumBytesBilled,
    metadataGetCount: 0, dryRunRequestCount: 0, paidQueryCount: 0, resultReadCount: 0,
    providerProof: null as { dryRun: boolean; queryMatches: boolean; controlsMatch: boolean;
      projectMatches: boolean; locationMatches: boolean; jobIdMatches: boolean; jobIdPresent: boolean } | null,
    estimatedBytes: null as number | null,
    table: null as ReturnType<typeof validatePreflightMetadata> | null,
    executionAuthorized: false, reportingAccepted: false,
  };
  async function json(url: string, method: 'GET' | 'POST', body?: unknown) {
    const response = await (options.fetch ?? fetch)(url, {
      method, redirect: 'error', signal: AbortSignal.timeout(BIGQUERY_PREFLIGHT.timeoutMs),
      headers: { Authorization: `Bearer ${options.accessToken}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    requireThat(response.ok, `http_${response.status}`);
    requireThat(response.body, 'empty_response');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        requireThat(bytes <= BIGQUERY_PREFLIGHT.maximumResponseBytes, 'response_too_large');
        chunks.push(part.value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  }
  try {
    requireThat(typeof options.accessToken === 'string' && options.accessToken.length > 0
      && options.accessToken.length <= 16_384 && !/[\r\n]/.test(options.accessToken), 'credential_unavailable');
    // A fixed historical shard only; no caller-controlled date/SQL/table input.
    requireThat(Date.parse(receipt.startedAt) >= Date.parse('2026-11-10T00:00:00Z'), 'export_not_historical');
    const tableUrl = 'https://bigquery.googleapis.com/bigquery/v2/projects/hushh-pda/datasets/analytics_526603671/tables/events_20261105';
    receipt.metadataGetCount++;
    receipt.table = validatePreflightMetadata(await json(tableUrl, 'GET'));
    receipt.dryRunRequestCount++;
    const result = record(await json(
      'https://bigquery.googleapis.com/bigquery/v2/projects/hushh-ai-prod/jobs', 'POST', request));
    receipt.providerProof = {
      dryRun: result.configuration?.dryRun === true,
      queryMatches: result.configuration?.query?.query === BIGQUERY_PREFLIGHT_SQL,
      controlsMatch: result.configuration?.query?.useLegacySql === false
        && result.configuration?.query?.useQueryCache === false
        && result.configuration?.query?.maximumBytesBilled === String(BIGQUERY_PREFLIGHT.maximumBytesBilled),
      projectMatches: result.jobReference?.projectId === BIGQUERY_PREFLIGHT.billingProject,
      locationMatches: result.jobReference?.location === BIGQUERY_PREFLIGHT.location,
      jobIdMatches: result.jobReference?.jobId === request.jobReference.jobId,
      jobIdPresent: typeof result.jobReference?.jobId === 'string' && result.jobReference.jobId.length > 0,
    };
    const bytes = validatePreflightEstimate(result, request.jobReference.jobId);
    receipt.metadataGetCount++;
    const after = validatePreflightMetadata(await json(tableUrl, 'GET'));
    requireThat(JSON.stringify(receipt.table) === JSON.stringify(after), 'source_changed_during_estimate');
    receipt.estimatedBytes = bytes;
    receipt.state = 'estimated';
  } catch (error) {
    receipt.reason = error instanceof Refused ? error.reason : 'transport_or_response_unavailable';
  }
  receipt.completedAt = now();
  return receipt;
}
