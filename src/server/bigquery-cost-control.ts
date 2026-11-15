import { conservativeBillingBound } from './bigquery-billing-bound';
import { createHash, randomUUID } from 'node:crypto';
import type { BigQuery, Query } from '@google-cloud/bigquery';
import type { Firestore } from '@google-cloud/firestore';
import { currentClosedMeasurement } from './closed-measurement';
import { currentContinuation } from './legacy-continuation';
import { currentDailyOneRefresh } from './daily-one-refresh';
import { platformCaptureAborted } from './platform-capture-signal';
import { currentDailyOneMeasurement } from './daily-one-measurement';
import { legacyRestoration, legacyDiagnosticOnly, noteLegacyQueryFailure, currentClosedComposition, ClosedJobMissingError, freezeRestorationSql, RESTORATION_LIMITS, HISTORICAL_LIMITS, type RestorationGrant } from './legacy-restoration';

// These ceilings cannot be raised through request options or environment variables.
export const BIGQUERY_COST_LIMITS = Object.freeze({
  project: 'hushh-ai-prod',
  database: 'one-plg-production',
  bytesPerStatement: 100 * 1024 * 1024,
  bytesPerUtcDay: 10 * 1024 * 1024 * 1024,
  statementsPerUtcDay: 100,
  statementsPerRequest: 8,
  timeoutMs: 30_000,
  concurrentRequests: 2,
  queuedRequests: 32,
});

export class BigQueryCostControlError extends Error {
  constructor(message = 'BigQuery queries are paused by the dashboard cost controls.') {
    super(message);
    this.name = 'BigQueryCostControlError';
  }
}

export interface QueryBudgetReservation {
  id: string;
  day: string;
  bytes: number;
  statements: number;
  restoration?: RestorationGrant;
}
export interface QueryBudgetStore {
  reserve(reservation: QueryBudgetReservation): Promise<void>;
}
export type GuardedQueryResult = [Record<string, unknown>[]];
export type QueryExecutor = (options: Query) => Promise<GuardedQueryResult>;

/** Remove strings, quoted identifiers and comments before counting fixed statements.
 * Runtime SQL supports fixed SELECT/DML/transaction statements, not scripting loops,
 * stored procedure calls or dynamic SQL that could create unreserved child jobs.
 */
export function countBudgetedStatements(sql: string): number {
  let clean = '';
  for (let i = 0; i < sql.length;) {
    if (sql.startsWith('--', i) || sql[i] === '#') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end;
      clean += ' ';
    } else if (sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i + 2);
      if (end === -1) throw new BigQueryCostControlError('Invalid query comment.');
      i = end + 2;
      clean += ' ';
    } else if (['\'', '"', '`'].includes(sql[i])) {
      const quote = sql[i];
      const delimiter = quote !== '`' && sql.startsWith(quote.repeat(3), i) ? quote.repeat(3) : quote;
      i += delimiter.length;
      let closed = false;
      while (i < sql.length) {
        if (sql[i] === '\\') { i += 2; continue; }
        if (sql.startsWith(delimiter, i)) {
          i += delimiter.length;
          if (delimiter.length === 1 && sql[i] === quote) { i++; continue; }
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) throw new BigQueryCostControlError('Invalid query string.');
      clean += ' ';
    } else {
      clean += sql[i++];
    }
  }
  const statements = clean.split(';').map(value => value.trim()).filter(Boolean);
  if (!statements.length || statements.length > BIGQUERY_COST_LIMITS.statementsPerRequest) {
    throw new BigQueryCostControlError('Query exceeds the allowed statement count.');
  }
  for (const statement of statements) {
    const fixedTransaction = /^(?:BEGIN|COMMIT|ROLLBACK)\s+TRANSACTION$/i.test(statement);
    if (!fixedTransaction && !/^(?:SELECT|WITH|INSERT|UPDATE|DELETE|MERGE|ASSERT)\b/i.test(statement)) {
      throw new BigQueryCostControlError('This SQL statement is not supported by the cost controls.');
    }
    if (/\b(?:EXECUTE\s+IMMEDIATE|CALL|WHILE|LOOP|REPEAT)\b/i.test(statement)) {
      throw new BigQueryCostControlError('Dynamic or repeated SQL is not allowed.');
    }
  }
  return statements.length;
}

/** Durable, atomic reservations shared by every instance. Never refund a submission:
 * an RPC failure or cancellation can happen after billable work has started.
 */
export class FirestoreQueryBudgetStore implements QueryBudgetStore {
  private database: Promise<Pick<Firestore, 'doc' | 'runTransaction'>> | undefined;
  constructor(private injectedDatabase?: Pick<Firestore, 'doc' | 'runTransaction'>) {}

  private getDatabase() {
    return this.database ??= this.injectedDatabase
      ? Promise.resolve(this.injectedDatabase)
      : import('@google-cloud/firestore').then(({ Firestore }) => new Firestore({
        projectId: BIGQUERY_COST_LIMITS.project,
        databaseId: BIGQUERY_COST_LIMITS.database,
      }));
  }

  async reserve(reservation: QueryBudgetReservation): Promise<void> {
    if (reservation.restoration) {
      const restore = currentDailyOneRefresh()?.store ?? currentContinuation()?.store ?? await legacyRestoration();
      if (!restore || reservation.statements !== 1 || reservation.id !== reservation.restoration.id
        || reservation.bytes !== reservation.restoration.bytes) throw new BigQueryCostControlError();
      await restore.reserve(reservation.restoration);
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reservation.day)
      || !/^metrics_[a-zA-Z0-9_-]+$/.test(reservation.id)
      || !Number.isSafeInteger(reservation.statements) || reservation.statements < 1
      || reservation.statements > BIGQUERY_COST_LIMITS.statementsPerRequest
      || !Number.isSafeInteger(reservation.bytes) || reservation.bytes < 1
      || reservation.bytes > reservation.statements * BIGQUERY_COST_LIMITS.bytesPerStatement) {
      throw new BigQueryCostControlError('Invalid query budget reservation.');
    }
    const db = await this.getDatabase();
    const dayRef = db.doc(`metricsQueryBudgetDays/${reservation.day}`);
    const reservationRef = dayRef.collection('reservations').doc(reservation.id);
    await db.runTransaction(async transaction => {
      const [daySnapshot, reservationSnapshot] = await transaction.getAll(dayRef, reservationRef);
      if (reservationSnapshot.exists && !daySnapshot.exists) {
        throw new BigQueryCostControlError('The query budget is unavailable.');
      }
      if (reservationSnapshot.exists) {
        const existing = reservationSnapshot.data();
        if (existing?.bytes !== reservation.bytes || existing?.statements !== reservation.statements) {
          throw new BigQueryCostControlError('Query reservation does not match.');
        }
        return;
      }
      const current = daySnapshot.data();
      const bytes = daySnapshot.exists ? current?.bytes : 0;
      const statements = daySnapshot.exists ? current?.statements : 0;
      if ((daySnapshot.exists && current?.policyVersion !== 1)
        || !Number.isSafeInteger(bytes) || bytes < 0
        || !Number.isSafeInteger(statements) || statements < 0) {
        throw new BigQueryCostControlError('The query budget is unavailable.');
      }
      if (bytes + reservation.bytes > BIGQUERY_COST_LIMITS.bytesPerUtcDay
        || statements + reservation.statements > BIGQUERY_COST_LIMITS.statementsPerUtcDay) {
        throw new BigQueryCostControlError('The dashboard daily BigQuery budget is exhausted.');
      }
      transaction.set(dayRef, { policyVersion: 1, bytes: bytes + reservation.bytes,
        statements: statements + reservation.statements });
      transaction.create(reservationRef, { bytes: reservation.bytes, statements: reservation.statements });
    });
  }
}

export function createGuardedBigQuery(options: {
  budget: QueryBudgetStore;
  execute: QueryExecutor;
  /** A free native estimate rejects known oversized work before reserving it. */
  estimate?: (request: Query) => Promise<number>;
  prepare?: (request: Query) => Promise<Query>;
  restoration?: (request: Query, estimatedBytes: number) => Promise<RestorationGrant | undefined>;
  existing?: (request: Query) => Promise<RestorationGrant | undefined>;
  queueLimit?: () => Promise<number>;
  guard?: () => Promise<void>;
  beforeExecute?: (grant: RestorationGrant | undefined) => Promise<boolean>;
  enabled: () => boolean;
  now?: () => Date;
  newId?: () => string;
}) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async (project: string, request: Query): Promise<GuardedQueryResult> => {
    assertQueryNotAborted();
    if (!options.enabled()) throw new BigQueryCostControlError();
    if (project !== BIGQUERY_COST_LIMITS.project) {
      throw new BigQueryCostControlError('BigQuery query jobs must use the approved dashboard project.');
    }
    if (options.prepare) request = await options.prepare(request);
    assertQueryNotAborted();
    if (typeof request.query !== 'string') throw new BigQueryCostControlError('A fixed SQL query is required.');
    const statements = countBudgetedStatements(request.query);
    const requestedBytes = request.maximumBytesBilled == null
      ? BIGQUERY_COST_LIMITS.bytesPerStatement : Number(request.maximumBytesBilled);
    if (!Number.isSafeInteger(requestedBytes) || requestedBytes <= 0) {
      throw new BigQueryCostControlError('Invalid per-query byte limit.');
    }
    let perStatement = Math.min(requestedBytes, BIGQUERY_COST_LIMITS.bytesPerStatement);
    let restoration: RestorationGrant | undefined;
    // Resolve any asynchronous policy before inspecting the semaphore, so a
    // completion cannot race between the capacity check and enqueue.
    const requestedQueue = legacyDiagnosticOnly() ? 128 : await options.queueLimit?.() ?? BIGQUERY_COST_LIMITS.queuedRequests;
    const queueLimit = Math.max(BIGQUERY_COST_LIMITS.queuedRequests, Math.min(128, requestedQueue));
    if (active >= BIGQUERY_COST_LIMITS.concurrentRequests) {
      if (waiting.length >= queueLimit) {
        throw new BigQueryCostControlError('Dashboard queries are busy. Try again later.');
      }
      await new Promise<void>(resolve => waiting.push(resolve));
    } else {
      active++;
    }
    try {
      assertQueryNotAborted();
      if (!options.enabled()) throw new BigQueryCostControlError();
      await options.guard?.();
      restoration = await options.existing?.(request);
      assertQueryNotAborted();
      if (restoration) {
        if (statements !== 1 || !restoration.reuse || !Number.isSafeInteger(restoration.bytes)
          || restoration.bytes < 1 || restoration.bytes > HISTORICAL_LIMITS.bytesPerJob) throw new BigQueryCostControlError();
        perStatement = restoration.bytes;
      }
      if (!restoration && options.estimate) {
        let estimatedBytes: number;
        try {
          estimatedBytes = await options.estimate({ query: request.query, params: request.params, types: request.types });
        } catch {
          throw new BigQueryCostControlError('The query scan could not be estimated safely.');
        }
        assertQueryNotAborted();
        if (!Number.isSafeInteger(estimatedBytes) || estimatedBytes < 0) throw new BigQueryCostControlError('Invalid scan limit estimate.');
        restoration = await options.restoration?.(request, estimatedBytes);
        assertQueryNotAborted();
        if (restoration) {
          if (statements !== 1 || !Number.isSafeInteger(restoration.bytes) || (!restoration.reuse && restoration.bytes < estimatedBytes)
            || restoration.bytes > HISTORICAL_LIMITS.bytesPerJob) throw new BigQueryCostControlError();
          perStatement = restoration.bytes;
        }
        // A reuse grant can only read the exact previously reserved completed job;
        // today's larger table-floor estimate does not change that job's cost.
        if (!restoration?.reuse && estimatedBytes > perStatement * statements) {
          throw new BigQueryCostControlError('This report exceeds the query scan limit. Choose a shorter period.');
        }
      }
      if (!options.enabled()) throw new BigQueryCostControlError();
      await options.guard?.();
      assertQueryNotAborted();
      // Independent final fence: diagnostic revisions never reserve or submit a paid job.
      if (legacyDiagnosticOnly()) throw new BigQueryCostControlError('Diagnostic mode cannot execute queries.');
      const id = restoration?.id ?? `metrics_${options.newId?.() ?? randomUUID().replaceAll('-', '_')}`;
      const day = (options.now?.() ?? new Date()).toISOString().slice(0, 10);
      try {
        await options.budget.reserve({ id, day, bytes: perStatement * statements, statements, ...(restoration ? { restoration } : {}) });
      } catch (error) {
        if (error instanceof BigQueryCostControlError) throw error;
        throw new BigQueryCostControlError('The dashboard query budget is unavailable.');
      }
      if (!options.enabled()) throw new BigQueryCostControlError();
      await options.guard?.();
      assertQueryNotAborted();
      const reuseOnly = await options.beforeExecute?.(restoration) ?? !!restoration?.reuse;
      assertQueryNotAborted();
      // Whitelist request fields; caller-supplied project/job/session/destination
      // options cannot bypass the fixed job identity or expand the billing scope.
      return await options.execute({
        query: request.query,
        params: request.params,
        types: request.types,
        wrapIntegers: request.wrapIntegers,
        parseJSON: request.parseJSON,
        maximumBytesBilled: String(perStatement),
        useLegacySql: false,
        useQueryCache: true,
        location: 'US',
        jobId: id,
        jobTimeoutMs: BIGQUERY_COST_LIMITS.timeoutMs,
        ...(statements > 1 ? { scriptOptions: {
          statementByteBudget: String(perStatement),
          statementTimeoutMs: String(BIGQUERY_COST_LIMITS.timeoutMs),
        } } : {}),
        labels: { application: 'metrics_dashboard', cost_policy: restoration ? 'initial_restore_v1' : 'v1', budget_day: day,
          ...(restoration ? { restore_permit: restoration.permitId, ...(reuseOnly ? { reuse_only: 'true' } : {}) } : {}) },
      });
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

function assertQueryNotAborted() {
  if (platformCaptureAborted() || currentDailyOneRefresh()?.signal?.aborted) throw new BigQueryCostControlError('The report request was interrupted.');
}

const activeRestoration = async () => currentDailyOneRefresh()?.store ?? currentContinuation()?.store ?? await legacyRestoration();

const clients = new Map<string, BigQuery>();
async function nativeClient() {
  const { BigQuery } = await import('@google-cloud/bigquery');
  const project = BIGQUERY_COST_LIMITS.project;
  const client = clients.get(project) ?? new BigQuery({ projectId: project });
  clients.set(project, client);
  return client;
}

async function measureDailyOne(project: string, request: Query) {
  const scope = currentDailyOneMeasurement();
  if (!scope || process.env.METRICS_BIGQUERY_ENABLED !== 'true' || project !== BIGQUERY_COST_LIMITS.project
    || typeof request.query !== 'string' || request.params !== undefined || request.types !== undefined || countBudgetedStatements(request.query) !== 1) throw new BigQueryCostControlError();
  const query = freezeRestorationSql(request.query, scope.logicalAsOf);
  const claim = await scope.measurement.claim(scope.report, query);
  if (claim.existing) return claim.existing.processed as number;
  let outcome: { processed: number; bound: number; referenceDigest: string } | null = null;
  try {
    await scope.measurement.requireOpen(scope.report);
    const client = await nativeClient();
    await scope.measurement.requireOpen(scope.report);
    const [job] = await client.createQueryJob({ query, dryRun: true, useLegacySql: false, useQueryCache: true, location: 'US',
      maximumBytesBilled: String(64 * 1024 ** 3), jobTimeoutMs: BIGQUERY_COST_LIMITS.timeoutMs });
    const stats = job.metadata.statistics?.query, raw = job.metadata.statistics?.totalBytesProcessed;
    if (stats?.statementType !== 'SELECT' || !['PRECISE', 'UPPER_BOUND'].includes(String(stats?.totalBytesProcessedAccuracy ?? ''))
      || typeof raw !== 'string' || !/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new BigQueryCostControlError('No safe native estimate.');
    const refs = stats.referencedTables ?? [], processed = Number(raw), bound = await conservativeBillingBound(processed, refs, nativeTableCatalog);
    if (!Number.isSafeInteger(bound) || bound < 1 || bound > 64 * 1024 ** 3) throw new BigQueryCostControlError('The estimated query exceeds the per-job bound.');
    outcome = { processed, bound, referenceDigest: createHash('sha256').update(JSON.stringify(refs)).digest('hex') };
    return processed;
  } finally { await scope.measurement.finish(claim.planHash, outcome); }
}

/** Estimates never execute SQL. Keep the platform capture's existing scan
 * comparison without exposing native createQueryJob to runtime callers. */
export async function guardedBigQueryDryRun(project: string, request: Query) {
  assertQueryNotAborted();
  if (currentDailyOneMeasurement()) {
    if (request.dryRun !== true) throw new BigQueryCostControlError();
    const processed = await measureDailyOne(project, request);
    return [{ metadata: { statistics: { totalBytesProcessed: String(processed) } } }];
  }
  if (currentClosedComposition()) { noteLegacyQueryFailure(); throw new BigQueryCostControlError('Closed-job composition cannot estimate or submit jobs.'); }
  if (process.env.METRICS_BIGQUERY_ENABLED !== 'true') throw new BigQueryCostControlError();
  if (project !== BIGQUERY_COST_LIMITS.project || request.dryRun !== true
    || typeof request.query !== 'string' || countBudgetedStatements(request.query) !== 1) {
    throw new BigQueryCostControlError('Only a fixed dry-run estimate is allowed.');
  }
  const client = await nativeClient();
  const restoration = await activeRestoration();
  const preparing = await restoration?.isPreparing();
  if (restoration && !preparing) throw new BigQueryCostControlError('No retained report is available for this selection.');
  const prepared = restoration ? await restoration.prepare(request) : request;
  const restorationCeiling = preparing ? await restoration!.perJobCeiling() : BIGQUERY_COST_LIMITS.bytesPerStatement;
  assertQueryNotAborted();
  return client.createQueryJob({ query: prepared.query, dryRun: true,
    useLegacySql: false, location: 'US', useQueryCache: true,
    maximumBytesBilled: String(legacyDiagnosticOnly() ? 512 * 1024 ** 3 : restorationCeiling) });
}

const executeGuardedBigQuery = createGuardedBigQuery({
  budget: new FirestoreQueryBudgetStore(),
  // Disabled unless deliberately configured after an explicit decision to resume.
  enabled: () => process.env.METRICS_BIGQUERY_ENABLED === 'true',
  prepare: async request => {
    const restoration = await activeRestoration();
    // A closed restoration is read-only: a cache miss must not start a new
    // daily-budget query when the UTC ledger rolls over.
    if (restoration && !await restoration.isPreparing()) throw new BigQueryCostControlError('No retained report is available for this selection.');
    return restoration?.prepare(request) ?? request;
  },
  existing: async request => (currentDailyOneRefresh()?.store ?? currentContinuation()?.store)?.existing(request),
  restoration: async (request, estimated) => {
    const restoration = await activeRestoration();
    const grant = await restoration?.admit(request, estimated);
    if (restoration && !grant) throw new BigQueryCostControlError('The restoration is no longer open.');
    return grant;
  },
  guard: async () => {
    const restoration = await activeRestoration();
    if (restoration && !await restoration.isPreparing()) throw new BigQueryCostControlError('The restoration is no longer open.');
  },
  beforeExecute: async grant => {
    const daily = currentDailyOneRefresh();
    if (!daily) return !!grant?.reuse;
    if (!grant) throw new BigQueryCostControlError('The daily refresh grant is unavailable.');
    return !await daily.store.claimSubmission(grant);
  },
  queueLimit: async () => (currentContinuation() || currentDailyOneRefresh()) ? 128 : process.env.METRICS_LEGACY_ABANDONED_ID && await (await legacyRestoration())?.expandedPreparing() ? 128 : BIGQUERY_COST_LIMITS.queuedRequests,
  estimate: async request => {
    assertQueryNotAborted();
    const client = await nativeClient();
    const restoration = await activeRestoration();
    const preparing = await restoration?.isPreparing();
    if (restoration && !preparing) throw new BigQueryCostControlError('The restoration is no longer open.');
    const restorationCeiling = preparing ? await restoration!.perJobCeiling() : BIGQUERY_COST_LIMITS.bytesPerStatement;
    assertQueryNotAborted();
    const [job] = await client.createQueryJob({ query: request.query, params: request.params, types: request.types,
      dryRun: true, useLegacySql: false, useQueryCache: true, location: 'US',
      maximumBytesBilled: String(legacyDiagnosticOnly() ? 512 * 1024 ** 3 : restorationCeiling),
      jobTimeoutMs: BIGQUERY_COST_LIMITS.timeoutMs });
    const value = job.metadata.statistics?.totalBytesProcessed;
    if (preparing && job.metadata.statistics?.query?.statementType !== 'SELECT') {
      throw new BigQueryCostControlError('Initial restoration accepts read-only SELECT plans only.');
    }
    if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new BigQueryCostControlError('No native query estimate.');
    if (await restoration?.expandedPreparing()) {
      const stats = job.metadata.statistics?.query;
      if (!['PRECISE', 'UPPER_BOUND'].includes(String(stats?.totalBytesProcessedAccuracy ?? ''))) throw new BigQueryCostControlError('No safe native estimate precision.');
      return conservativeBillingBound(Number(value), stats?.referencedTables ?? [], nativeTableCatalog);
    }
    return Number(value);
  },
  execute: async request => {
    assertQueryNotAborted();
    const client = await nativeClient();
    assertQueryNotAborted();
    if (typeof request.jobId === 'string' && (request.jobId.startsWith('metrics_restore_') || request.jobId.startsWith('metrics_refresh_'))) {
      const job = client.job(request.jobId, { location: 'US' });
      let exists = false;
      try {
        const [metadata] = await job.getMetadata();
        const query = metadata.configuration?.query;
        if (query?.query !== request.query || query?.maximumBytesBilled !== request.maximumBytesBilled
          || (request.jobId.startsWith('metrics_refresh_') && metadata.jobReference?.jobId !== request.jobId)
          || (request.labels?.reuse_only === 'true' && (metadata.status?.state !== 'DONE' || metadata.status?.errorResult))
          || query.useLegacySql !== false || metadata.jobReference?.projectId !== BIGQUERY_COST_LIMITS.project
          || metadata.jobReference?.location !== 'US') throw new BigQueryCostControlError();
        exists = true;
      } catch (error) {
        if ((error as { code?: number }).code !== 404) throw error;
      }
      assertQueryNotAborted();
      if (!exists) {
        if (request.labels?.reuse_only === 'true') throw new BigQueryCostControlError('A prior job could not be verified.');
        const daily = currentDailyOneRefresh();
        if (daily && !await daily.store.isPreparing()) throw new BigQueryCostControlError('The daily refresh is no longer open.');
        assertQueryNotAborted();
        // A submission already dispatched can complete after an abort; its
        // started reservation remains charged and must be reconciled by ID.
        try { await client.createQueryJob(request); }
        catch (error) { if ((error as { code?: number }).code !== 409) throw error; }
        assertQueryNotAborted();
        // Reconcile the exact stable ID, including any lost acknowledgement.
        const [metadata] = await job.getMetadata();
        if ((request.jobId.startsWith('metrics_refresh_') && metadata.jobReference?.jobId !== request.jobId)
          || metadata.configuration?.query?.query !== request.query
          || metadata.configuration?.query?.maximumBytesBilled !== request.maximumBytesBilled
          || metadata.configuration?.query?.useLegacySql !== false
          || metadata.jobReference?.projectId !== BIGQUERY_COST_LIMITS.project
          || metadata.jobReference?.location !== 'US') throw new BigQueryCostControlError();
      }
      const [rows, next] = await job.getQueryResults({ autoPaginate: false, maxResults: 2000, timeoutMs: BIGQUERY_COST_LIMITS.timeoutMs });
      if (next?.pageToken || rows.length >= 2000 || Buffer.byteLength(JSON.stringify(rows)) > RESTORATION_LIMITS.snapshotBytes) throw new BigQueryCostControlError('Restored aggregate exceeds its payload bound.');
      const continuation = currentContinuation();
      const daily = currentDailyOneRefresh();
      if (continuation || daily) {
        const [proof] = await job.getMetadata(); const query = proof.configuration?.query, endedAt = Number(proof.statistics?.endTime);
        if (proof.status?.state !== 'DONE' || proof.status?.errorResult || query?.query !== request.query
          || query?.maximumBytesBilled !== request.maximumBytesBilled || query?.useLegacySql !== false
          || proof.jobReference?.jobId !== request.jobId || proof.jobReference?.projectId !== BIGQUERY_COST_LIMITS.project || proof.jobReference?.location !== 'US'
          || !Number.isSafeInteger(endedAt) || endedAt <= 0 || endedAt > Date.now() + 10_000) throw new BigQueryCostControlError('Completed continuation job failed verification.');
        continuation?.jobs.set(request.jobId!, { id: request.jobId!, endedAt });
        daily?.jobs.set(request.jobId!, endedAt);
        if (daily?.strictJobBounds) daily.bounds.set(request.jobId!, Number(request.maximumBytesBilled));
      }
      return [rows as Record<string, unknown>[]];
    }
    // A stable, pre-reserved jobId makes submission retries idempotent.
    assertQueryNotAborted();
    const [job] = await client.createQueryJob(request);
    const [rows] = await job.getQueryResults({ autoPaginate: true, timeoutMs: BIGQUERY_COST_LIMITS.timeoutMs });
    return [rows as Record<string, unknown>[]];
  },
});

export async function guardedBigQuery(project: string, request: Query): Promise<GuardedQueryResult> {
  try {
    if (currentDailyOneMeasurement()) { await measureDailyOne(project, request); throw new BigQueryCostControlError('Measurement records estimates only.'); }
    const composition = currentClosedComposition();
    if (composition) {
      if (process.env.METRICS_BIGQUERY_ENABLED !== 'true') throw new BigQueryCostControlError();
      if (project !== BIGQUERY_COST_LIMITS.project || typeof request.query !== 'string' || countBudgetedStatements(request.query) !== 1) throw new BigQueryCostControlError();
      let grant: Awaited<ReturnType<typeof composition.store.closedJob>>;
      try { grant = await composition.store.closedJob(request); }
      catch (error) {
        const scope = currentClosedMeasurement();
        if (scope && error instanceof ClosedJobMissingError && error.plannedBytes === undefined
          && await scope.measurement.claim(scope.report, error.planHash)) {
          let outcome: { processed: number; bound: number; referenceDigest: string; minimumUnits: number } | null = null;
          try {
            const descriptor = await composition.store.closedDescriptor();
            const frozenQuery = freezeRestorationSql(request.query, descriptor.asOf);
            const client = await nativeClient();
            const [job] = await client.createQueryJob({ query: frozenQuery, dryRun: true, useLegacySql: false,
              useQueryCache: true, location: 'US', maximumBytesBilled: String(RESTORATION_LIMITS.bytesPerJob),
              jobTimeoutMs: BIGQUERY_COST_LIMITS.timeoutMs });
            const stats = job.metadata.statistics?.query, raw = job.metadata.statistics?.totalBytesProcessed;
            if (stats?.statementType !== 'SELECT' || !['PRECISE', 'UPPER_BOUND'].includes(String(stats?.totalBytesProcessedAccuracy ?? ''))
              || typeof raw !== 'string' || !/^\d+$/.test(raw)) throw new BigQueryCostControlError('No safe native estimate.');
            const processed = Number(raw), refs = stats?.referencedTables ?? [];
            const bound = await conservativeBillingBound(processed, refs, nativeTableCatalog), unit = 10 * 1024 ** 2;
            const minimumUnits = Math.max(0, (bound - Math.ceil(processed / unit) * unit) / unit);
            if (bound > RESTORATION_LIMITS.bytesPerJob) throw new BigQueryCostControlError('The measured query exceeds the per-job ceiling.');
            outcome = { processed, bound, minimumUnits,
              referenceDigest: createHash('sha256').update(JSON.stringify(refs)).digest('hex') };
          } finally { await scope.measurement.finish(error.planHash, outcome); }
        }
        throw error;
      }
      const client = await nativeClient(), job = client.job(grant.id, { location: 'US' });
      const [metadata] = await job.getMetadata();
      const query = metadata.configuration?.query;
      if (metadata.status?.state !== 'DONE' || metadata.status?.errorResult || query?.query !== grant.query
        || query?.maximumBytesBilled !== String(grant.bytes) || query?.useLegacySql !== false
        || metadata.jobReference?.jobId !== grant.id || metadata.jobReference?.projectId !== BIGQUERY_COST_LIMITS.project || metadata.jobReference?.location !== 'US') throw new BigQueryCostControlError('Completed job failed verification.');
      if (composition.logicalAsOf) {
        const endedAt = Number(metadata.statistics?.endTime);
        if (!Number.isSafeInteger(endedAt) || endedAt <= 0 || endedAt > Date.now() + 10_000) throw new BigQueryCostControlError('Completed job failed verification.');
        composition.jobTimes.set(grant.id, endedAt);
      }
      const continuation = currentContinuation();
      if (continuation) {
        const endedAt = Number(metadata.statistics?.endTime);
        if (metadata.jobReference?.jobId !== grant.id || !Number.isSafeInteger(endedAt) || endedAt <= 0 || endedAt > Date.now() + 10_000)
          throw new BigQueryCostControlError('Completed continuation job failed verification.');
        continuation.jobs.set(grant.id, { id: grant.id, endedAt });
      }
      const [rows, next] = await job.getQueryResults({ autoPaginate: false, maxResults: 2000, timeoutMs: BIGQUERY_COST_LIMITS.timeoutMs });
      composition.observation.maxRows = Math.max(composition.observation.maxRows, rows.length);
      composition.observation.maxBytes = Math.max(composition.observation.maxBytes, Buffer.byteLength(JSON.stringify(rows)));
      if (continuation) {
        continuation.observation.maxRows = Math.max(continuation.observation.maxRows, rows.length);
        continuation.observation.maxBytes = Math.max(continuation.observation.maxBytes, Buffer.byteLength(JSON.stringify(rows)));
      }
      if (next?.pageToken || rows.length >= 2000 || Buffer.byteLength(JSON.stringify(rows)) > RESTORATION_LIMITS.snapshotBytes) throw new BigQueryCostControlError('Completed aggregate exceeds its payload bound.');
      composition.jobs.add(grant.id);
      return [rows as Record<string, unknown>[]];
    }
    return await executeGuardedBigQuery(project, request);
  }
  catch (error) {
    currentDailyOneRefresh()?.cancel?.();
    const closed = currentClosedComposition();
    if (closed) {
      const message = error instanceof Error ? error.message : '';
      closed.observation.reason ??= error instanceof ClosedJobMissingError ? 'missing-reservation'
        : message.includes('payload bound') ? 'result-bound' : message.includes('verification') ? 'native-verification'
          : (error as { code?: number })?.code === 403 ? 'native-access' : 'source-error';
    }
    const continuation = currentContinuation();
    if (continuation && currentClosedComposition()) {
      const message = error instanceof Error ? error.message : '';
      continuation.observation.reason ??= error instanceof ClosedJobMissingError ? 'missing-reservation'
        : message.includes('payload bound') ? 'result-bound' : message.includes('verification') ? 'native-verification'
          : (error as { code?: number })?.code === 403 ? 'native-access' : 'source-error';
    }
    noteLegacyQueryFailure(); throw error;
  }
}

/** Metadata only; every request is paginated and bounded. */
async function nativeTableCatalog(project: string, dataset: string): Promise<{ id: string; type: string }[]> {
  const { BigQuery } = await import('@google-cloud/bigquery');
  const client = new BigQuery({ projectId: project });
  const result: { id: string; type: string }[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    const [tables, next] = await client.dataset(dataset).getTables({ autoPaginate: false, maxResults: 1000, pageToken });
    for (const table of tables) {
      const id = table.id, type = String(table.metadata?.type ?? '');
      if (!id || !type) throw new Error('Incomplete table catalog.');
      result.push({ id, type });
    }
    pageToken = next?.pageToken;
    if (!pageToken) return result;
  }
  throw new Error('Table catalog pagination bound exceeded.');
}
