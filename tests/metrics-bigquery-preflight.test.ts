import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { BIGQUERY_PREFLIGHT as plan, BIGQUERY_PREFLIGHT_SQL, bigQueryPreflightRequest,
  runBigQueryPreflight, validatePreflightEstimate, validatePreflightMetadata } from '../scripts/lib/metrics-bigquery-preflight';

vi.mock('node:crypto', async importOriginal => ({
  ...await importOriginal<typeof import('node:crypto')>(),
  randomUUID: () => '12345678-1234-4234-8234-123456789abc',
}));
const fixtureJobId = 'metrics_preflight_12345678_1234_4234_8234_123456789abc';

function table() {
  return { tableReference: { ...plan.source }, location: 'US', type: 'TABLE', etag: 'known-schema',
    lastModifiedTime: '1794084168137', schema: { fields: [
      { name: 'platform', type: 'STRING' }, { name: 'user_id', type: 'STRING' },
      { name: 'event_params', type: 'RECORD', mode: 'REPEATED', fields: [
        { name: 'key', type: 'STRING' },
        { name: 'value', type: 'RECORD', fields: [{ name: 'string_value', type: 'STRING' }] },
      ] },
    ] } };
}
function estimate(bytes = '10485760') {
  return { ...bigQueryPreflightRequest(), statistics: { totalBytesProcessed: bytes, query: {
    totalBytesProcessed: bytes, totalBytesProcessedAccuracy: 'PRECISE',
    statementType: 'SELECT', referencedTables: [{ ...plan.source }],
  } } };
}
const token = 'synthetic-credential-that-must-not-enter-receipts';
const now = () => new Date('2026-11-14T16:00:00Z');
function transport(values: unknown[]) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(values.shift()), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  }));
}

describe('fixed BigQuery estimate-only operator', () => {
  it('uses exactly two metadata reads and one dry run while every runtime flag stays unchanged', async () => {
    const native = transport([table(), estimate(), table()]);
    const environment = process.env.METRICS_BIGQUERY_ENABLED;
    const result = await runBigQueryPreflight({ accessToken: token, fetch: native, now });
    expect(result).toMatchObject({ state: 'estimated', estimatedBytes: 10485760,
      metadataGetCount: 2, dryRunRequestCount: 1, paidQueryCount: 0, resultReadCount: 0,
      executionAuthorized: false, reportingAccepted: false, reportingTimezone: 'unverified' });
    expect(result.queryDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.table?.schemaDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(process.env.METRICS_BIGQUERY_ENABLED).toBe(environment);
    expect(native.mock.calls.map(([url, options]) => [url, options?.method])).toEqual([
      ['https://bigquery.googleapis.com/bigquery/v2/projects/hushh-pda/datasets/analytics_526603671/tables/events_20261105', 'GET'],
      ['https://bigquery.googleapis.com/bigquery/v2/projects/hushh-ai-prod/jobs', 'POST'],
      ['https://bigquery.googleapis.com/bigquery/v2/projects/hushh-pda/datasets/analytics_526603671/tables/events_20261105', 'GET'],
    ]);
    const options = native.mock.calls[1][1]!;
    expect(JSON.parse(String(options.body))).toEqual({
      jobReference: { projectId: 'hushh-ai-prod', location: 'US', jobId: fixtureJobId },
      configuration: { dryRun: true,
        query: { query: BIGQUERY_PREFLIGHT_SQL, useLegacySql: false, useQueryCache: false, maximumBytesBilled: '73400320' },
        labels: { application: 'metrics_planning', plan: 'one-export-capture-20261105-v1' } },
    });
    expect(options.redirect).toBe('error');
    expect(options.signal).toBeInstanceOf(AbortSignal);
    const saved = JSON.stringify(result);
    expect(saved).not.toContain(token);
    expect(saved).not.toContain('Authorization');
    expect(saved).not.toContain('schema":{"fields"');
    expect(saved).not.toContain(BIGQUERY_PREFLIGHT_SQL);
  });

  it.each(['', 'bad\ncredential', 'a'.repeat(16_385)])('refuses invalid credentials before transport', async accessToken => {
    const native = transport([]);
    const result = await runBigQueryPreflight({ accessToken, fetch: native, now });
    expect(result.reason).toBe('credential_unavailable'); expect(native).not.toHaveBeenCalled();
  });
  it('refuses a recent/future export before transport', async () => {
    const native = transport([]);
    const result = await runBigQueryPreflight({ accessToken: token, fetch: native, now: () => new Date('2026-11-05T12:00:00Z') });
    expect(result.reason).toBe('export_not_historical'); expect(native).not.toHaveBeenCalled();
  });
  it.each(['--execute', '--sql', '--date', '--project'])('CLI has no %s override or execution mode', argument => {
    const result = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/metrics-bigquery-preflight.ts', argument, 'ignored'],
      { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, METRICS_BQ_PLANNING_ACCESS_TOKEN: '' } });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr.trim())).toEqual({ state: 'held', reason: 'operator_preflight_unavailable' });
    expect(result.stdout).toBe('');
  });

  it.each([
    (value: any) => { value.tableReference.projectId = 'other-project'; },
    (value: any) => { value.tableReference.tableId = 'events_*'; },
    (value: any) => { value.tableReference.tableId = 'events_intraday_20261105'; },
    (value: any) => { value.type = 'VIEW'; },
    (value: any) => { value.externalDataConfiguration = {}; },
    (value: any) => { value.cloneDefinition = {}; },
    (value: any) => { value.snapshotDefinition = {}; },
    (value: any) => { value.location = 'EU'; },
    (value: any) => { delete value.etag; },
    (value: any) => { value.schema.fields[0].type = 'BYTES'; },
    (value: any) => { value.schema.fields[1].policyTags = { names: ['masked'] }; },
    (value: any) => { value.schema.fields[2].mode = 'NULLABLE'; },
    (value: any) => { value.schema.fields.push(value.schema.fields[0]); },
  ])('refuses an unverified table before the dry run', async change => {
    const metadata = table(); change(metadata);
    expect(() => validatePreflightMetadata(metadata)).toThrow();
    const native = transport([metadata]);
    const result = await runBigQueryPreflight({ accessToken: token, fetch: native, now });
    expect(result.state).toBe('held'); expect(native).toHaveBeenCalledTimes(1);
    expect(result.dryRunRequestCount).toBe(0);
  });
  it.each([
    (value: any) => { value.configuration.dryRun = false; },
    (value: any) => { value.configuration.query.query = 'SELECT 1'; },
    (value: any) => { value.configuration.query.maximumBytesBilled = '73400321'; },
    (value: any) => { value.jobReference.projectId = 'other-project'; },
    (value: any) => { value.jobReference.jobId = 'unexpected-job'; },
    (value: any) => { value.statistics.query.statementType = 'SCRIPT'; },
    (value: any) => { value.statistics.query.totalBytesProcessedAccuracy = 'LOWER_BOUND'; },
    (value: any) => { delete value.statistics.query.totalBytesProcessed; },
    (value: any) => { value.statistics.query.referencedTables = []; },
    (value: any) => { value.statistics.query.referencedTables.push({ ...plan.source }); },
    (value: any) => { value.statistics.query.referencedTables[0].datasetId = 'wrong'; },
    (value: any) => { value.statistics.query.undeclaredQueryParameters = [{ name: 'unbound' }]; },
    (value: any) => { value.statistics.rowLevelSecurityStatistics = { rowLevelSecurityApplied: true }; },
    (value: any) => { value.statistics.totalBytesProcessed = '1'; },
    (value: any) => { value.status = { errors: [{ message: token }] }; },
  ])('rejects incomplete or conflicting dry-run proof', change => {
    const value = estimate(); change(value);
    expect(() => validatePreflightEstimate(value, fixtureJobId)).toThrow();
  });
  it.each(['0', '-1', '1.5', '01', ' 1', '9007199254740993', '73400321', 'NaN'])('rejects unsafe/out-of-cap estimate %s', bytes => {
    expect(() => validatePreflightEstimate(estimate(bytes), fixtureJobId)).toThrow();
  });
  it('admits the exact 70 MiB ceiling without turning it into execution authority', () => {
    expect(validatePreflightEstimate(estimate('73400320'), fixtureJobId)).toBe(73400320);
  });
  it('handles the observed native dry-run response omitting an unpersisted job ID', async () => {
    const value = estimate();
    const { jobId: _planningId, ...reference } = value.jobReference;
    const native = transport([table(), { ...value, jobReference: reference }, table()]);
    const result = await runBigQueryPreflight({ accessToken: token, fetch: native, now });
    expect(result).toMatchObject({ state: 'estimated', estimatedBytes: 10485760,
      planningJobId: fixtureJobId, providerProof: { dryRun: true, jobIdPresent: false, jobIdMatches: false },
      executionAuthorized: false, paidQueryCount: 0, resultReadCount: 0 });
  });
  it('refuses source mutation between metadata checks', async () => {
    const after = table(); after.lastModifiedTime = '1794084168138';
    const native = transport([table(), estimate(), after]);
    const result = await runBigQueryPreflight({ accessToken: token, fetch: native, now });
    expect(result).toMatchObject({ state: 'held', reason: 'source_changed_during_estimate', estimatedBytes: null });
    expect(native).toHaveBeenCalledTimes(3);
  });
  it('never retries/falls back after HTTP403, ambiguous submission or invalid provider output', async () => {
    for (const mode of ['forbidden', 'ambiguous', 'invalid']) {
      let calls = 0;
      const native = vi.fn<typeof fetch>(async () => {
        calls++;
        if (calls === 1) return Response.json(table());
        if (mode === 'forbidden') return new Response('', { status: 403 });
        if (mode === 'ambiguous') throw new Error(`provider detail ${token}`);
        return new Response('not-json');
      });
      const result = await runBigQueryPreflight({ accessToken: token, fetch: native, now });
      expect(result.state).toBe('held'); expect(native).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(result)).not.toContain(token);
      expect(result.paidQueryCount).toBe(0);
    }
  });
  it('bounds response bytes without attempting another call', async () => {
    const native = vi.fn<typeof fetch>(async () => new Response('x'.repeat(plan.maximumResponseBytes + 1)));
    const result = await runBigQueryPreflight({ accessToken: token, fetch: native, now });
    expect(result.reason).toBe('response_too_large'); expect(native).toHaveBeenCalledTimes(1);
  });
  it('keeps absent and duplicate env labels in a one-row-per-event capture definition', () => {
    expect(BIGQUERY_PREFLIGHT_SQL).toContain('ARRAY(SELECT AS STRUCT value.string_value AS tag');
    expect(BIGQUERY_PREFLIGHT_SQL).toContain('env_tags[SAFE_OFFSET(0)].tag');
    expect(BIGQUERY_PREFLIGHT_SQL).toContain('COUNTIF(env_count > 1) AS duplicate_env_events');
    expect(BIGQUERY_PREFLIGHT_SQL).toContain("env_count = 0 OR (env_count = 1 AND env_tag IS NULL)");
    expect(BIGQUERY_PREFLIGHT_SQL).not.toMatch(/ANY_VALUE|CROSS JOIN|SELECT \*|DISTINCT|;|\bLIMIT\b/i);
    expect(BIGQUERY_PREFLIGHT_SQL.match(/`[^`]+`/g)).toEqual(['`hushh-pda.analytics_526603671.events_20261105`']);
    // Structural checks only, not a claim that SQL has executed against data.
  });
});
