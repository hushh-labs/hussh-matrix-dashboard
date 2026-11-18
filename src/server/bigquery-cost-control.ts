import { conservativeBillingBound } from './bigquery-billing-bound';
import { BIGQUERY_COST_LIMITS } from './bigquery-cost-limits';
export { BIGQUERY_COST_LIMITS } from './bigquery-cost-limits';
import { buildUatFeaturePlan, buildUatLocationPlan } from './uat-one-feature-plan';
import { uatTwoSourceChildIds, validateUatTwoSourcePolicies } from './reports/uat-two-source-manifest';
import { digest as detailDigest, reportKey as detailReportKey, validateControl as validateDetailControl,
  validateRequest as validateDetailRequest, validatePolicy as validateDetailPolicy, validateAccess as validateDetailAccess,
  type ReportJob, type ReportingPolicy, type ReportControl, type ReportAccess } from './reports/contracts';
import { reportPath as detailPath, FirestoreReportStore, type ReportStore } from './reports/store';
import { prepareUatCombinedDetail } from './reports/uat-combined-detail';
import { validateUatCombinedPublication } from './reports/uat-combined-publication';
import { validateUatServicePolicy } from './reports/uat-service-policy';
import { UatTwoSourceReservations } from './reports/uat-two-source-reservations';
import { reportingSession } from './reports/session';
import { googleWorkerIdentityVerifier } from './reports/worker-http';
import { MetricsReportWorker, MetricsReports } from './reports/service';
import { UatDetailTaskQueue } from './reports/uat-detail-queue';
import { MetricsReportDispatch } from './reports/dispatch';
import { cloudTasksRequest } from './reports/transports';
import { createHash, randomUUID } from 'node:crypto';
import type { BigQuery, Query } from '@google-cloud/bigquery';
import type { Firestore } from '@google-cloud/firestore';
import { currentClosedMeasurement } from './closed-measurement';
import { currentContinuation } from './legacy-continuation';
import { currentDailyOneRefresh } from './daily-one-refresh';
import { platformCaptureAborted } from './platform-capture-signal';
import { currentDailyOneMeasurement } from './daily-one-measurement';
import { legacyRestoration, legacyDiagnosticOnly, noteLegacyQueryFailure, currentClosedComposition, ClosedJobMissingError, freezeRestorationSql, RESTORATION_LIMITS, HISTORICAL_LIMITS, type RestorationGrant } from './legacy-restoration';

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
  /** Optional immutable intent binding for new staged jobs. */
  binding?: string;
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

  /** Read-only reconciliation for a staged, bound reservation. Failure or
   * unknown acknowledgement never authorizes submission. */
  async confirmBound(reservation: QueryBudgetReservation): Promise<void> {
    if (reservation.restoration || !/^[a-f0-9]{64}$/.test(reservation.binding ?? '')
      || !/^\d{4}-\d{2}-\d{2}$/.test(reservation.day) || !Number.isFinite(Date.parse(reservation.day))
      || new Date(reservation.day).toISOString().slice(0,10) !== reservation.day
      || !/^metrics_[a-zA-Z0-9_-]+$/.test(reservation.id) || reservation.statements !== 1
      || !Number.isSafeInteger(reservation.bytes) || reservation.bytes < 1 || reservation.bytes > BIGQUERY_COST_LIMITS.bytesPerStatement)
      throw new BigQueryCostControlError('Invalid bound reservation.');
    const db = await this.getDatabase(), dayRef = db.doc(`metricsQueryBudgetDays/${reservation.day}`);
    const reservationRef = dayRef.collection('reservations').doc(reservation.id);
    await db.runTransaction(async tx => {
      const [day, row] = await tx.getAll(dayRef, reservationRef), total = day.data(), value = row.data();
      if (!day.exists || !row.exists || total?.policyVersion !== 1 || !Number.isSafeInteger(total.bytes)
        || total.bytes < reservation.bytes || total.bytes > BIGQUERY_COST_LIMITS.bytesPerUtcDay
        || !Number.isSafeInteger(total.statements) || total.statements < 1 || total.statements > BIGQUERY_COST_LIMITS.statementsPerUtcDay
        || value?.bytes !== reservation.bytes || value?.statements !== 1 || value?.binding !== reservation.binding)
        throw new BigQueryCostControlError('Bound reservation could not be verified.');
    });
  }

  async reserve(reservation: QueryBudgetReservation): Promise<void> {
    if (reservation.restoration) {
      const restore = currentDailyOneRefresh()?.store ?? currentContinuation()?.store ?? await legacyRestoration();
      if (!restore || reservation.binding !== undefined || reservation.statements !== 1 || reservation.id !== reservation.restoration.id
        || reservation.bytes !== reservation.restoration.bytes) throw new BigQueryCostControlError();
      await restore.reserve(reservation.restoration);
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reservation.day)
      || !/^metrics_[a-zA-Z0-9_-]+$/.test(reservation.id)
      || !Number.isSafeInteger(reservation.statements) || reservation.statements < 1
      || reservation.statements > BIGQUERY_COST_LIMITS.statementsPerRequest
      || !Number.isSafeInteger(reservation.bytes) || reservation.bytes < 1
      || (reservation.binding !== undefined && (!/^[a-f0-9]{64}$/.test(reservation.binding)
        || reservation.statements !== 1 || !Number.isFinite(Date.parse(reservation.day))
        || new Date(reservation.day).toISOString().slice(0,10) !== reservation.day))
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
        if (existing?.bytes !== reservation.bytes || existing?.statements !== reservation.statements || existing?.binding !== reservation.binding) {
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
      transaction.create(reservationRef, { bytes: reservation.bytes, statements: reservation.statements,
        ...(reservation.binding !== undefined ? { binding: reservation.binding } : {}) });
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

/** Fixed UAT preflight only. This capability exposes no client or query input;
 * paid submission and runtime integration are deliberately not provided yet. */
class FixedUatDetailPreflight {
  constructor(private readonly store:ReportStore, private readonly authorize:(job:ReportJob)=>Promise<boolean>,
    private readonly now:()=>number=Date.now) {}
  async estimate(role:'feature'|'location', job:ReportJob, signal:AbortSignal) {
    const enabled=()=>{ if (process.env.METRICS_BIGQUERY_ENABLED!=='true' || process.env.METRICS_UAT_DETAIL_ENABLED!=='true' || process.env.FIRESTORE_EMULATOR_HOST) throw new BigQueryCostControlError(); };
    if (role!=='feature' && role!=='location') throw new BigQueryCostControlError();
    enabled(); signal.throwIfAborted();
    const gate=()=>this.store.transaction(async tx=>{
      const [live,control,global,raw]=await Promise.all([tx.get<ReportJob>(detailPath('jobs',job.id)),
        tx.get<ReportControl>(detailPath('controls',job.request.reportId)),tx.get<ReportingPolicy>(detailPath('policy','current')),
        tx.get<any>(detailPath('policy','one-agent-detail-two-source'))]);
      const now=this.now(), policy=validateUatTwoSourcePolicies(raw,now);
      if (!validateDetailPolicy(global).computeEnabled || !live || live.id!==job.id || live.key!==job.key || live.status!=='running'
        || live.fence!==job.fence || live.workerHash!==job.workerHash || live.leaseUntil<=now || live.expiresAt<=now || live.sourceStarted!==true
        || String(live.request.reportId)!=='one.agent-detail-uat' || detailDigest(live.request)!==detailDigest(job.request)
        || detailDigest(live.control)!==detailDigest(job.control) || detailDigest(control)!==detailDigest(job.control)
        || job.control.enabled!==true || job.control.scopeDigest!==policy.manifest.scopeDigest
        || job.control.sourceGeneration!==policy.manifest.sourceGeneration || job.request.startDate!==policy.manifest.startDate
        || job.request.endDate!==policy.manifest.endDate || job.request.timezone!==policy.manifest.timezone) throw new BigQueryCostControlError();
      return {raw,policy};
    });
    const initial=await gate(); if (!await this.authorize(job)) throw new BigQueryCostControlError(); enabled(); signal.throwIfAborted();
    const plan=role==='feature'?buildUatFeaturePlan(initial.raw.config):buildUatLocationPlan(initial.raw.config);
    if (plan.queryHash!==initial.policy[role].queryHash) throw new BigQueryCostControlError();
    const { BigQuery }=await import('@google-cloud/bigquery'); enabled(); signal.throwIfAborted();
    const beforeNative=await gate();
    if (detailDigest(beforeNative.raw)!==detailDigest(initial.raw)) throw new BigQueryCostControlError();
    enabled(); signal.throwIfAborted();
    const client=new BigQuery({projectId:BIGQUERY_COST_LIMITS.project,autoRetry:false,maxRetries:0});
    const [nativeJob]=await client.createQueryJob({query:plan.query,dryRun:true,useLegacySql:false,useQueryCache:true,location:'US',
      maximumBytesBilled:String(BIGQUERY_COST_LIMITS.bytesPerStatement),jobTimeoutMs:BIGQUERY_COST_LIMITS.timeoutMs});
    enabled(); signal.throwIfAborted();
    const m=nativeJob.metadata as any,q=m?.configuration?.query,stats=m?.statistics?.query,ref=m?.jobReference;
    if (ref?.projectId!==BIGQUERY_COST_LIMITS.project || ref?.location!=='US' || q?.query!==plan.query || q?.useLegacySql!==false
      || q?.useQueryCache!==true || q?.parameterMode || (q?.queryParameters!==undefined && (!Array.isArray(q.queryParameters) || q.queryParameters.length))
      || stats?.statementType!=='SELECT' || !['PRECISE','UPPER_BOUND'].includes(stats?.totalBytesProcessedAccuracy)
      || typeof m?.statistics?.totalBytesProcessed!=='string' || !/^\d+$/.test(m.statistics.totalBytesProcessed)) throw new BigQueryCostControlError();
    const processed=Number(m.statistics.totalBytesProcessed), refs=stats.referencedTables;
    if (!Number.isSafeInteger(processed) || !Array.isArray(refs) || refs.length<1 || refs.length>1000) throw new BigQueryCostControlError();
    const seen=new Set<string>(), sorted=refs.map((r:any)=>{
      if (!r || r.projectId!==plan.sourceProject || r.datasetId!==plan.dataset || typeof r.tableId!=='string') throw new BigQueryCostControlError();
      if (r.tableId!=='events_*' && r.tableId!=='INFORMATION_SCHEMA.TABLES') {
        const match=/^events_(?:intraday_)?(\d{8})$/.exec(r.tableId);
        if (!match || match[1]<plan.startDate.replaceAll('-','') || match[1]>plan.endDate.replaceAll('-','')) throw new BigQueryCostControlError();
      }
      const key=`${r.projectId}:${r.datasetId}:${r.tableId}`; if (seen.has(key)) throw new BigQueryCostControlError(); seen.add(key);
      return {projectId:r.projectId,datasetId:r.datasetId,tableId:r.tableId};
    }).sort((a:any,b:any)=>a.tableId.localeCompare(b.tableId));
    if (!sorted.some((r:any)=>r.tableId.startsWith('events_'))) throw new BigQueryCostControlError();
    const catalog:{id:string;type:string}[]=[], tableIds=new Set<string>(), tokens=new Set<string>(); let pageToken:string|undefined;
    for (let page=0;page<10;page++) {
      enabled(); signal.throwIfAborted();
      const [tables,next]=await client.dataset(plan.dataset,{projectId:plan.sourceProject}).getTables({autoPaginate:false,maxResults:1000,pageToken});
      for (const table of tables) { const id=table.id,type=String(table.metadata?.type??'');
        if (!id || !type || tableIds.has(id)) throw new BigQueryCostControlError(); tableIds.add(id); catalog.push({id,type}); }
      pageToken=next?.pageToken; if (!pageToken) break;
      if (tokens.has(pageToken) || page===9) throw new BigQueryCostControlError(); tokens.add(pageToken);
    }
    catalog.sort((a,b)=>a.id.localeCompare(b.id));
    const referenceDigest=createHash('sha256').update(JSON.stringify({refs:sorted,catalog})).digest('hex');
    if (referenceDigest!==initial.policy[role].referenceDigest) throw new BigQueryCostControlError();
    const bound=await conservativeBillingBound(processed,sorted,async(project,dataset)=>{
      if (project!==plan.sourceProject || dataset!==plan.dataset) throw new BigQueryCostControlError(); return catalog;
    });
    if (!Number.isSafeInteger(bound) || bound<1 || bound>initial.policy[role].maxBytes) throw new BigQueryCostControlError();
    enabled(); signal.throwIfAborted(); if (!await this.authorize(job)) throw new BigQueryCostControlError();
    const current=await gate(); if (detailDigest(current.raw)!==detailDigest(initial.raw)) throw new BigQueryCostControlError();
    enabled(); signal.throwIfAborted();
    return {queryHash:plan.queryHash,project:BIGQUERY_COST_LIMITS.project,location:'US' as const,statementType:'SELECT' as const,
      referenceDigest,accuracy:stats.totalBytesProcessedAccuracy,processed,referencedFloor:bound,bound};
  }
}

/** Internal, default-off child dispatch prototype. No route constructs this.
 * SDK creation is confined here; callers cannot provide SQL or a client. */
class FixedUatDetailDispatch {
  private readonly budget=new FirestoreQueryBudgetStore();
  constructor(private readonly store:ReportStore,
    private readonly authorize:(job:ReportJob)=>Promise<boolean>, private readonly now:()=>number=Date.now,
    private readonly enabled=false) {}
  async submit(role:'feature'|'location',job:ReportJob,signal:AbortSignal) {
    const gateFlags=()=>{if(this.enabled!==true || process.env.METRICS_BIGQUERY_ENABLED!=='true'
      || process.env.METRICS_UAT_DETAIL_ENABLED!=='true' || process.env.FIRESTORE_EMULATOR_HOST) throw new BigQueryCostControlError();};
    gateFlags(); if (role!=='feature' && role!=='location') throw new BigQueryCostControlError(); signal.throwIfAborted();
    const read=async(tx:any)=>{
      const [live,control,global,raw,intent]=await Promise.all([tx.get(detailPath('jobs',job.id)),tx.get(detailPath('controls',job.request.reportId)),
        tx.get(detailPath('policy','current')),tx.get(detailPath('policy','one-agent-detail-two-source')),tx.get(detailPath('uatTwoSourceIntents',job.id))]);
      const now=this.now(),p=validateUatTwoSourcePolicies(raw,now),ids=uatTwoSourceChildIds(job.id,p.manifestDigest),policyDigest=detailDigest(raw);
      if (!validateDetailPolicy(global).computeEnabled || !live || live.id!==job.id || live.key!==job.key || live.status!=='running'
        || live.fence!==job.fence || live.workerHash!==job.workerHash || live.leaseUntil<=now || live.expiresAt<=now || live.sourceStarted!==true
        || String(live.request.reportId)!=='one.agent-detail-uat' || detailDigest(live.request)!==detailDigest(job.request)
        || detailDigest(live.control)!==detailDigest(job.control) || detailDigest(control)!==detailDigest(job.control) || job.control.enabled!==true
        || p.manifest.scopeDigest!==job.control.scopeDigest || p.manifest.sourceGeneration!==job.control.sourceGeneration
        || p.manifest.startDate!==job.request.startDate || p.manifest.endDate!==job.request.endDate || p.manifest.timezone!==job.request.timezone
        || !intent || Object.keys(intent).sort().join()!=='fence,manifestDigest,parentId,policyDigest,reservations,schema,state,workerHash'
        || intent.schema!==1 || intent.state!=='confirmed' || intent.parentId!==job.id || intent.fence!==job.fence || intent.workerHash!==job.workerHash
        || intent.policyDigest!==policyDigest || intent.manifestDigest!==p.manifestDigest
        || !intent.reservations || Object.keys(intent.reservations).sort().join()!=='feature,location') throw new BigQueryCostControlError();
      const day=new Date(now).toISOString().slice(0,10);
      for(const childRole of ['feature','location'] as const) { const r=intent.reservations[childRole];
        if (!r || Object.keys(r).sort().join()!=='binding,bytes,day,id,statements' || r.id!==`metrics_detail_${ids[childRole]}`
          || r.day!==day || r.statements!==1 || !Number.isSafeInteger(r.bytes) || r.bytes<1 || r.bytes>p[childRole].maxBytes
          || r.binding!==detailDigest(['uat-two-source-reservation-v1',job.id,job.key,job.request,job.control,p.manifestDigest,policyDigest,childRole,day,r.bytes])) throw new BigQueryCostControlError();
      }
      return {p,raw,intent,ids,policyDigest};
    };
    const initial=await this.store.transaction(read); gateFlags(); signal.throwIfAborted();
    const estimate=await new FixedUatDetailPreflight(this.store,this.authorize,this.now).estimate(role,job,signal);
    const reservation=initial.intent.reservations[role];
    if (estimate.queryHash!==initial.p[role].queryHash || estimate.referenceDigest!==initial.p[role].referenceDigest || estimate.bound!==reservation.bytes) throw new BigQueryCostControlError();
    await this.budget.confirmBound(initial.intent.reservations.feature); signal.throwIfAborted();
    await this.budget.confirmBound(initial.intent.reservations.location); signal.throwIfAborted();
    if (!await this.authorize(job)) throw new BigQueryCostControlError(); gateFlags(); signal.throwIfAborted();
    const { BigQuery }=await import('@google-cloud/bigquery'); gateFlags(); signal.throwIfAborted();
    const plan=role==='feature'?buildUatFeaturePlan(initial.raw.config):buildUatLocationPlan(initial.raw.config);
    await this.store.transaction(async tx=>{
      const current=await read(tx),child=await tx.get(detailPath('uatTwoSourceChildren',initial.ids[role])),fresh=await read(tx);
      if (detailDigest(current.raw)!==initial.policyDigest || detailDigest(current.intent)!==detailDigest(initial.intent) || child
        || detailDigest(fresh.raw)!==initial.policyDigest || detailDigest(fresh.intent)!==detailDigest(initial.intent)
        || plan.queryHash!==fresh.p[role].queryHash) throw new BigQueryCostControlError();
      gateFlags(); signal.throwIfAborted();
      tx.create(detailPath('uatTwoSourceChildren',initial.ids[role]),{schema:1,state:'dispatching',parentId:job.id,role,
        fence:job.fence,workerHash:job.workerHash,manifestDigest:current.p.manifestDigest,policyDigest:initial.policyDigest,
        reservation,queryHash:plan.queryHash,startedAt:this.now()});
    });
    gateFlags(); signal.throwIfAborted();
    const client=new BigQuery({projectId:BIGQUERY_COST_LIMITS.project,autoRetry:false,maxRetries:0});
    await client.createQueryJob({query:plan.query,jobId:reservation.id,location:'US',useLegacySql:false,useQueryCache:true,
      maximumBytesBilled:String(reservation.bytes),jobTimeoutMs:BIGQUERY_COST_LIMITS.timeoutMs});
  }
  async recover(role:'feature'|'location',job:ReportJob,signal:AbortSignal) {
    const flags=()=>{if(this.enabled!==true || process.env.METRICS_BIGQUERY_ENABLED!=='true'
      || process.env.METRICS_UAT_DETAIL_ENABLED!=='true' || process.env.FIRESTORE_EMULATOR_HOST) throw new BigQueryCostControlError();};
    flags(); if (role!=='feature' && role!=='location') throw new BigQueryCostControlError(); signal.throwIfAborted();
    const read=async(tx:any)=>{
      const [live,control,global,raw,intent]=await Promise.all([tx.get(detailPath('jobs',job.id)),tx.get(detailPath('controls',job.request.reportId)),
        tx.get(detailPath('policy','current')),tx.get(detailPath('policy','one-agent-detail-two-source')),tx.get(detailPath('uatTwoSourceIntents',job.id))]);
      const now=this.now(),p=validateUatTwoSourcePolicies(raw,now,true),ids=uatTwoSourceChildIds(job.id,p.manifestDigest),policyDigest=detailDigest(raw);
      const child=await tx.get(detailPath('uatTwoSourceChildren',ids[role]));
      if (!validateDetailPolicy(global).computeEnabled || !live || live.id!==job.id || live.key!==job.key || live.status!=='running'
        || live.fence!==job.fence || live.workerHash!==job.workerHash || live.leaseUntil<=now || live.acceptedAt!==job.acceptedAt || live.expiresAt!==job.expiresAt
        || !Number.isSafeInteger(live.acceptedAt) || !Number.isSafeInteger(live.expiresAt) || detailDigest(live.request)!==detailDigest(job.request)
        || detailDigest(live.control)!==detailDigest(job.control) || detailDigest(control)!==detailDigest(job.control) || job.control.enabled!==true
        || String(live.request.reportId)!=='one.agent-detail-uat' || !intent || Object.keys(intent).sort().join()!=='fence,manifestDigest,parentId,policyDigest,reservations,schema,state,workerHash'
        || intent.schema!==1 || intent.state!=='confirmed' || intent.parentId!==job.id || intent.manifestDigest!==p.manifestDigest || intent.policyDigest!==policyDigest
        || !Number.isSafeInteger(intent.fence) || intent.fence<1 || intent.fence>job.fence || typeof intent.workerHash!=='string' || !/^[a-f0-9]{64}$/.test(intent.workerHash)
        || intent.fence===job.fence && intent.workerHash!==job.workerHash || !intent.reservations || Object.keys(intent.reservations).sort().join()!=='feature,location'
        || p.manifest.scopeDigest!==job.control.scopeDigest || p.manifest.sourceGeneration!==job.control.sourceGeneration
        || p.manifest.startDate!==job.request.startDate || p.manifest.endDate!==job.request.endDate || p.manifest.timezone!==job.request.timezone
        || !child || child.state!=='dispatching' || child.parentId!==job.id || child.role!==role || child.fence!==intent.fence || child.workerHash!==intent.workerHash
        || child.manifestDigest!==p.manifestDigest || child.policyDigest!==policyDigest || child.queryHash!==p[role].queryHash
        || !Number.isSafeInteger(child.startedAt) || child.startedAt<live.acceptedAt || child.startedAt>=live.expiresAt || child.startedAt>now) throw new BigQueryCostControlError();
      const today=new Date(now).toISOString().slice(0,10),day=intent.reservations.feature?.day;
      if (typeof day!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0,10)!==day || day>today) throw new BigQueryCostControlError();
      for(const childRole of ['feature','location'] as const) { const r=intent.reservations[childRole];
        if (!r || Object.keys(r).sort().join()!=='binding,bytes,day,id,statements' || r.id!==`metrics_detail_${ids[childRole]}` || r.day!==day || r.statements!==1
          || !Number.isSafeInteger(r.bytes) || r.bytes<1 || r.bytes>p[childRole].maxBytes
          || r.binding!==detailDigest(['uat-two-source-reservation-v1',job.id,job.key,job.request,job.control,p.manifestDigest,policyDigest,childRole,day,r.bytes])) throw new BigQueryCostControlError();
      }
      if (detailDigest(child.reservation)!==detailDigest(intent.reservations[role])) throw new BigQueryCostControlError();
      return {raw,p,intent,child,ids,policyDigest};
    };
    if (!await this.authorize(job)) throw new BigQueryCostControlError(); flags(); signal.throwIfAborted();
    const initial=await this.store.transaction(read);
    try { await this.budget.confirmBound(initial.intent.reservations.feature); await this.budget.confirmBound(initial.intent.reservations.location); }
    catch { return {state:'uncertain' as const}; }
    flags(); signal.throwIfAborted(); const {BigQuery}=await import('@google-cloud/bigquery'); flags(); signal.throwIfAborted();
    const plan=role==='feature'?buildUatFeaturePlan(initial.raw.config):buildUatLocationPlan(initial.raw.config);
    const nativeClient=new BigQuery({projectId:BIGQUERY_COST_LIMITS.project,autoRetry:false,maxRetries:0});
    let metadata:any; try { [metadata]=await nativeClient.job(initial.child.reservation.id,{location:'US'}).getMetadata(); }
    catch(error) { if ((error as {code?:number}).code===404) return {state:'uncertain' as const}; throw error; }
    flags(); signal.throwIfAborted();
    const query=metadata?.configuration?.query,ref=metadata?.jobReference,stats=metadata?.statistics?.query;
    const rawBilled=stats?.totalBytesBilled,rawEndedAt=metadata?.statistics?.endTime;
    const billed=typeof rawBilled==='string' && /^\d+$/.test(rawBilled)?Number(rawBilled):NaN;
    const endedAt=typeof rawEndedAt==='string' && /^\d+$/.test(rawEndedAt)?Number(rawEndedAt):NaN;
    if (ref?.jobId!==initial.child.reservation.id || ref?.projectId!==BIGQUERY_COST_LIMITS.project || ref?.location!=='US'
      || query?.query!==plan.query || query?.useLegacySql!==false || query?.useQueryCache!==true || query?.parameterMode
      || (query?.queryParameters!==undefined && (!Array.isArray(query.queryParameters) || query.queryParameters.length))
      || query?.maximumBytesBilled!==String(initial.child.reservation.bytes) || stats?.statementType!=='SELECT'
      || metadata?.status?.state!=='DONE' || metadata?.status?.errorResult || !Number.isSafeInteger(billed) || billed<0 || billed>initial.child.reservation.bytes
      || !Number.isSafeInteger(endedAt) || endedAt<initial.child.startedAt || endedAt>this.now()) return {state:'uncertain' as const};
    try { await this.budget.confirmBound(initial.intent.reservations.feature); await this.budget.confirmBound(initial.intent.reservations.location); }
    catch { return {state:'uncertain' as const}; }
    if (!await this.authorize(job)) throw new BigQueryCostControlError(); flags(); signal.throwIfAborted();
    await this.store.transaction(async tx=>{
      const current=await read(tx),existing=await tx.get(detailPath('uatTwoSourceProofs',initial.ids[role])),fresh=await read(tx);
      if (detailDigest(current)!==detailDigest(initial) || detailDigest(fresh)!==detailDigest(initial) || existing) throw new BigQueryCostControlError();
      flags(); signal.throwIfAborted();
      tx.create(detailPath('uatTwoSourceProofs',initial.ids[role]),{schema:1,parentId:job.id,role,childDigest:detailDigest(initial.child),
        manifestDigest:initial.p.manifestDigest,policyDigest:initial.policyDigest,queryHash:plan.queryHash,reservation:initial.child.reservation,
        billed,endedAt,verifiedFence:job.fence,verifiedWorkerHash:job.workerHash});
      tx.set(detailPath('uatTwoSourceChildren',initial.ids[role]),{...initial.child,state:'complete'});
    });
    return {state:'complete' as const};
  }
  /** Private aggregate result read: fixed plan, both reservations and the
   * immutable child proof are rechecked around one bounded native page. */
  async readRows(role:'feature'|'location',job:ReportJob,signal:AbortSignal) {
    const flags=()=>{if(this.enabled!==true || process.env.METRICS_BIGQUERY_ENABLED!=='true'
      || process.env.METRICS_UAT_DETAIL_ENABLED!=='true' || process.env.FIRESTORE_EMULATOR_HOST) throw new BigQueryCostControlError();};
    flags(); if (role!=='feature' && role!=='location') throw new BigQueryCostControlError(); signal.throwIfAborted();
    const read=async(tx:any)=>{
      const [live,control,global,raw,intent]=await Promise.all([tx.get(detailPath('jobs',job.id)),tx.get(detailPath('controls',job.request.reportId)),
        tx.get(detailPath('policy','current')),tx.get(detailPath('policy','one-agent-detail-two-source')),tx.get(detailPath('uatTwoSourceIntents',job.id))]);
      const now=this.now(),p=validateUatTwoSourcePolicies(raw,now,true),ids=uatTwoSourceChildIds(job.id,p.manifestDigest),policyDigest=detailDigest(raw);
      const [child,proof]=await Promise.all([tx.get(detailPath('uatTwoSourceChildren',ids[role])),tx.get(detailPath('uatTwoSourceProofs',ids[role]))]);
      if (!validateDetailPolicy(global).computeEnabled || !live || live.id!==job.id || live.key!==job.key || live.status!=='running'
        || live.fence!==job.fence || live.workerHash!==job.workerHash || live.leaseUntil<=now || live.acceptedAt!==job.acceptedAt || live.expiresAt!==job.expiresAt
        || !Number.isSafeInteger(live.acceptedAt) || !Number.isSafeInteger(live.expiresAt) || detailDigest(live.request)!==detailDigest(job.request)
        || detailDigest(live.control)!==detailDigest(job.control) || detailDigest(control)!==detailDigest(job.control) || job.control.enabled!==true
        || String(live.request.reportId)!=='one.agent-detail-uat' || !intent || Object.keys(intent).sort().join()!=='fence,manifestDigest,parentId,policyDigest,reservations,schema,state,workerHash'
        || intent.schema!==1 || intent.state!=='confirmed' || intent.parentId!==job.id || intent.manifestDigest!==p.manifestDigest || intent.policyDigest!==policyDigest
        || !Number.isSafeInteger(intent.fence) || intent.fence<1 || intent.fence>job.fence || typeof intent.workerHash!=='string' || !/^[a-f0-9]{64}$/.test(intent.workerHash)
        || intent.fence===job.fence && intent.workerHash!==job.workerHash || !intent.reservations || Object.keys(intent.reservations).sort().join()!=='feature,location'
        || p.manifest.scopeDigest!==job.control.scopeDigest || p.manifest.sourceGeneration!==job.control.sourceGeneration
        || p.manifest.startDate!==job.request.startDate || p.manifest.endDate!==job.request.endDate || p.manifest.timezone!==job.request.timezone
        || !child || child.state!=='complete' || child.parentId!==job.id || child.role!==role || child.fence!==intent.fence || child.workerHash!==intent.workerHash
        || child.manifestDigest!==p.manifestDigest || child.policyDigest!==policyDigest || child.queryHash!==p[role].queryHash
        || !Number.isSafeInteger(child.startedAt) || child.startedAt<live.acceptedAt || child.startedAt>=live.expiresAt || child.startedAt>now) throw new BigQueryCostControlError();
      const today=new Date(now).toISOString().slice(0,10),day=intent.reservations.feature?.day;
      if (typeof day!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0,10)!==day || day>today) throw new BigQueryCostControlError();
      for(const childRole of ['feature','location'] as const) { const r=intent.reservations[childRole];
        if (!r || Object.keys(r).sort().join()!=='binding,bytes,day,id,statements' || r.id!==`metrics_detail_${ids[childRole]}` || r.day!==day || r.statements!==1
          || !Number.isSafeInteger(r.bytes) || r.bytes<1 || r.bytes>p[childRole].maxBytes
          || r.binding!==detailDigest(['uat-two-source-reservation-v1',job.id,job.key,job.request,job.control,p.manifestDigest,policyDigest,childRole,day,r.bytes])) throw new BigQueryCostControlError();
      }
      const original={...child,state:'dispatching'};
      if (detailDigest(child.reservation)!==detailDigest(intent.reservations[role]) || !proof
        || Object.keys(proof).sort().join()!=='billed,childDigest,endedAt,manifestDigest,parentId,policyDigest,queryHash,reservation,role,schema,verifiedFence,verifiedWorkerHash'
        || proof.schema!==1 || proof.parentId!==job.id || proof.role!==role || proof.childDigest!==detailDigest(original)
        || proof.manifestDigest!==p.manifestDigest || proof.policyDigest!==policyDigest || proof.queryHash!==p[role].queryHash
        || detailDigest(proof.reservation)!==detailDigest(intent.reservations[role]) || !Number.isSafeInteger(proof.verifiedFence) || proof.verifiedFence<1 || proof.verifiedFence>job.fence
        || typeof proof.verifiedWorkerHash!=='string' || !/^[a-f0-9]{64}$/.test(proof.verifiedWorkerHash)
        || proof.verifiedFence===job.fence && proof.verifiedWorkerHash!==job.workerHash || !Number.isSafeInteger(proof.billed) || proof.billed<0
        || proof.billed>proof.reservation.bytes || !Number.isSafeInteger(proof.endedAt) || proof.endedAt<child.startedAt || proof.endedAt>now) throw new BigQueryCostControlError();
      return {raw,p,intent,child,proof};
    };
    if (!await this.authorize(job)) throw new BigQueryCostControlError(); flags(); signal.throwIfAborted();
    const initial=await this.store.transaction(read);
    await this.budget.confirmBound(initial.intent.reservations.feature); await this.budget.confirmBound(initial.intent.reservations.location);
    flags(); signal.throwIfAborted(); const {BigQuery}=await import('@google-cloud/bigquery'); flags(); signal.throwIfAborted();
    const plan=role==='feature'?buildUatFeaturePlan(initial.raw.config):buildUatLocationPlan(initial.raw.config);
    const client=new BigQuery({projectId:BIGQUERY_COST_LIMITS.project,autoRetry:false,maxRetries:0}),native=client.job(initial.proof.reservation.id,{location:'US'});
    const verify=async()=>{const [m]=await native.getMetadata(),q=m.configuration?.query,ref=m.jobReference,stats=m.statistics?.query;
      if (ref?.jobId!==initial.proof.reservation.id || ref?.projectId!==BIGQUERY_COST_LIMITS.project || ref?.location!=='US'
        || q?.query!==plan.query || q?.useLegacySql!==false || q?.useQueryCache!==true || q?.parameterMode
        || (q?.queryParameters!==undefined && (!Array.isArray(q.queryParameters) || q.queryParameters.length))
        || q?.maximumBytesBilled!==String(initial.proof.reservation.bytes) || stats?.statementType!=='SELECT'
        || m.status?.state!=='DONE' || m.status?.errorResult || stats?.totalBytesBilled!==String(initial.proof.billed)
        || m.statistics?.endTime!==String(initial.proof.endedAt)) throw new BigQueryCostControlError(); };
    await verify(); flags(); signal.throwIfAborted(); if (!await this.authorize(job)) throw new BigQueryCostControlError();
    if (detailDigest(await this.store.transaction(read))!==detailDigest(initial)) throw new BigQueryCostControlError(); flags(); signal.throwIfAborted();
    const [rows,next]=await native.getQueryResults({autoPaginate:false,maxResults:2000,timeoutMs:BIGQUERY_COST_LIMITS.timeoutMs});
    flags(); signal.throwIfAborted(); if (!Array.isArray(rows) || rows.length>=2000 || next?.pageToken || Buffer.byteLength(JSON.stringify(rows))>700_000) throw new BigQueryCostControlError();
    await verify(); await this.budget.confirmBound(initial.intent.reservations.feature); await this.budget.confirmBound(initial.intent.reservations.location);
    if (!await this.authorize(job) || detailDigest(await this.store.transaction(read))!==detailDigest(initial)) throw new BigQueryCostControlError(); flags(); signal.throwIfAborted();
    // The composer must compare these immutable identities again in its own
    // publication transaction; row shape alone is not source proof.
    return {rows,role,rowDigest:detailDigest(rows),proofDigest:detailDigest(initial.proof),manifestDigest:initial.p.manifestDigest,
      policyDigest:detailDigest(initial.raw)};
  }
  /** A private immutable draft, not a published report or capacity release.
   * Head/status routing must be integrated before this can become visible. */
  async prepareCombined(job:ReportJob,signal:AbortSignal) {
    if (this.enabled!==true || process.env.METRICS_BIGQUERY_ENABLED!=='true' || process.env.METRICS_UAT_DETAIL_ENABLED!=='true'
      || process.env.FIRESTORE_EMULATOR_HOST) throw new BigQueryCostControlError();
    const feature=await this.readRows('feature',job,signal),location=await this.readRows('location',job,signal);
    const prepared=prepareUatCombinedDetail(feature,location,{scopeDigest:job.control.scopeDigest,
      period:{startDate:job.request.startDate,endDate:job.request.endDate,timezone:job.request.timezone}});
    signal.throwIfAborted(); if (!await this.authorize(job)) throw new BigQueryCostControlError(); signal.throwIfAborted();
    const result=await this.store.transaction(async tx=>{
      const [live,control,global,raw,service,intent,existing]=await Promise.all([tx.get<ReportJob>(detailPath('jobs',job.id)),
        tx.get<ReportControl>(detailPath('controls',job.request.reportId)),tx.get<ReportingPolicy>(detailPath('policy','current')),
        tx.get<any>(detailPath('policy','one-agent-detail-two-source')),tx.get<any>(detailPath('policy','one-agent-detail-service')),
        tx.get<any>(detailPath('uatTwoSourceIntents',job.id)),tx.get<any>(detailPath('uatCombinedDrafts',job.id))]);
      const now=this.now(),p=validateUatTwoSourcePolicies(raw,now),servicePolicy=validateUatServicePolicy(service,raw,now),ids=uatTwoSourceChildIds(job.id,p.manifestDigest);
      const [featureProof,locationProof]=await Promise.all([tx.get<any>(detailPath('uatTwoSourceProofs',ids.feature)),tx.get<any>(detailPath('uatTwoSourceProofs',ids.location))]);
      const freshNow=this.now(); validateUatTwoSourcePolicies(raw,freshNow); validateUatServicePolicy(service,raw,freshNow);
      if (!validateDetailPolicy(global).computeEnabled || !live || live.id!==job.id || live.key!==job.key || live.status!=='running'
        || live.fence!==job.fence || live.workerHash!==job.workerHash || live.leaseUntil<=freshNow || live.expiresAt<=freshNow
        || detailDigest(live.request)!==detailDigest(job.request) || detailDigest(live.control)!==detailDigest(job.control)
        || detailDigest(control)!==detailDigest(job.control) || job.control.enabled!==true || String(job.request.reportId)!=='one.agent-detail-uat'
        || p.manifestDigest!==prepared.manifestDigest || detailDigest(raw)!==prepared.policyDigest || servicePolicy.manifestDigest!==prepared.manifestDigest
        || !intent || intent.state!=='confirmed' || intent.parentId!==job.id || intent.policyDigest!==prepared.policyDigest || intent.manifestDigest!==prepared.manifestDigest
        || !featureProof || !locationProof || featureProof.parentId!==job.id || locationProof.parentId!==job.id
        || featureProof.role!=='feature' || locationProof.role!=='location' || detailDigest(featureProof)!==prepared.proofDigests.feature
        || detailDigest(locationProof)!==prepared.proofDigests.location || existing) throw new BigQueryCostControlError();
      if (process.env.METRICS_BIGQUERY_ENABLED!=='true' || process.env.METRICS_UAT_DETAIL_ENABLED!=='true' || process.env.FIRESTORE_EMULATOR_HOST) throw new BigQueryCostControlError();
      signal.throwIfAborted();
      const draft={schema:1,kind:'uat-combined-draft',parentId:job.id,key:job.key,request:job.request,control:job.control,
        servicePolicyDigest:detailDigest(service),computedAt:freshNow,...prepared};
      if (Buffer.byteLength(JSON.stringify(draft))>validateDetailPolicy(global).maxSnapshotBytes) throw new BigQueryCostControlError();
      tx.create(detailPath('uatCombinedDrafts',job.id),draft); return {state:'private_partial' as const};
    });
    signal.throwIfAborted(); if (!await this.authorize(job)) throw new BigQueryCostControlError(); signal.throwIfAborted();
    return result;
  }
  /** Atomic combined completion; not wired until matching reader/status routes
   * and verified runtime qualification are complete. */
  async publishCombined(job:ReportJob,signal:AbortSignal) {
    const flags=()=>{if(this.enabled!==true || process.env.METRICS_BIGQUERY_ENABLED!=='true'
      || process.env.METRICS_UAT_DETAIL_ENABLED!=='true' || process.env.FIRESTORE_EMULATOR_HOST) throw new BigQueryCostControlError();};
    flags(); signal.throwIfAborted(); if (!await this.authorize(job)) throw new BigQueryCostControlError();
    const first=await this.store.transaction(tx=>tx.get<any>(detailPath('uatTwoSourceIntents',job.id)));
    if (!first?.reservations?.feature || !first?.reservations?.location) throw new BigQueryCostControlError();
    await this.budget.confirmBound(first.reservations.feature);await this.budget.confirmBound(first.reservations.location);
    flags(); signal.throwIfAborted(); if (!await this.authorize(job)) throw new BigQueryCostControlError();
    const result=await this.store.transaction(async tx=>{
      const subjectId=detailDigest([job.lane,job.requesterHash]);
      const [live,control,global,raw,service,intent,draft,head,slots,subject,existing]=await Promise.all([
        tx.get<ReportJob>(detailPath('jobs',job.id)),tx.get<ReportControl>(detailPath('controls',job.request.reportId)),
        tx.get<ReportingPolicy>(detailPath('policy','current')),tx.get<any>(detailPath('policy','one-agent-detail-two-source')),
        tx.get<any>(detailPath('policy','one-agent-detail-service')),tx.get<any>(detailPath('uatTwoSourceIntents',job.id)),
        tx.get<any>(detailPath('uatCombinedDrafts',job.id)),tx.get<any>(detailPath('heads',job.key)),
        tx.get<any>(detailPath('capacity',job.lane)),tx.get<any>(detailPath('subjectCapacity',subjectId)),
        tx.get<any>(detailPath('uatCombinedPublications',job.id))]);
      const p=validateUatTwoSourcePolicies(raw,this.now()),servicePolicy=validateUatServicePolicy(service,raw,this.now()),ids=uatTwoSourceChildIds(job.id,p.manifestDigest);
      const [feature,location]=await Promise.all([tx.get<any>(detailPath('uatTwoSourceProofs',ids.feature)),tx.get<any>(detailPath('uatTwoSourceProofs',ids.location))]);
      const now=this.now();validateUatTwoSourcePolicies(raw,now);validateUatServicePolicy(service,raw,now);
      if (!validateDetailPolicy(global).computeEnabled || !live || live.id!==job.id || live.key!==job.key || live.status!=='running'
        || live.fence!==job.fence || live.workerHash!==job.workerHash || live.leaseUntil<=now || live.expiresAt<=now
        || live.lane!==job.lane || live.requesterHash!==job.requesterHash || live.acceptedAt!==job.acceptedAt || live.sourceStarted!==true
        || detailDigest(live.request)!==detailDigest(job.request) || detailDigest(live.control)!==detailDigest(job.control)
        || detailDigest(control)!==detailDigest(job.control) || job.control.enabled!==true || head?.activeJob!==job.id
        || !slots || !Number.isSafeInteger(slots.active) || slots.active<1 || !subject || !Number.isSafeInteger(subject.active) || subject.active<1
        || !intent || detailDigest(intent)!==detailDigest(first) || intent.state!=='confirmed' || intent.parentId!==job.id
        || intent.policyDigest!==detailDigest(raw) || intent.manifestDigest!==p.manifestDigest || !draft || existing
        || draft.servicePolicyDigest!==detailDigest(service) || draft.policyDigest!==detailDigest(raw) || draft.manifestDigest!==p.manifestDigest
        || servicePolicy.scopeDigest!==job.control.scopeDigest || servicePolicy.sourceGeneration!==job.control.sourceGeneration) throw new BigQueryCostControlError();
      const publication={schema:1,kind:'uat-combined',id:job.id,key:job.key,request:job.request,control:job.control,
        servicePolicyDigest:draft.servicePolicyDigest,draftDigest:detailDigest(draft),computedAt:draft.computedAt,publishedAt:now,
        coverage:draft.coverage,freshness:draft.freshness,manifestDigest:draft.manifestDigest,policyDigest:draft.policyDigest,
        proofDigests:draft.proofDigests,rowDigests:draft.rowDigests,detail:draft.detail};
      validateUatCombinedPublication(publication,draft,{feature,location},job,now,validateDetailPolicy(global).maxSnapshotBytes);
      flags();signal.throwIfAborted();
      tx.create(detailPath('uatCombinedPublications',job.id),publication);
      tx.set(detailPath('heads',job.key),{...head,activeJob:null,publication:job.id});
      tx.set(detailPath('jobs',job.id),{...live,status:'completed',leaseUntil:0,completedAt:now});
      tx.set(detailPath('capacity',job.lane),{active:slots.active-1});tx.set(detailPath('subjectCapacity',subjectId),{active:subject.active-1});
      return {state:'partial' as const,id:job.id};
    });
    flags();signal.throwIfAborted();if (!await this.authorize(job)) throw new BigQueryCostControlError(); signal.throwIfAborted();return result;
  }
}

/** Service-owned UAT identity boundary. No job creation, dispatch or source
 * access is exposed here. Cookie checks honor existing expiry/domain rules;
 * they do not establish instantaneous Google account revocation. */
export async function createServiceOwnedUatRuntime() {
  const flags=()=>{if(process.env.METRICS_UAT_SERVICE_ENABLED!=='true'
    || process.env.METRICS_UAT_DETAIL_ENABLED!=='true' || process.env.FIRESTORE_EMULATOR_HOST) throw new BigQueryCostControlError();};
  const computeFlags=()=>{flags();if(process.env.METRICS_BIGQUERY_ENABLED!=='true') throw new BigQueryCostControlError();};
  flags(); let config:any;
  try { config=JSON.parse(process.env.METRICS_UAT_SERVICE_CONFIG??''); } catch { throw new BigQueryCostControlError(); }
  if (!config || typeof config!=='object' || Array.isArray(config)
    || Object.keys(config).sort().join()!=='maxResponseBytes,queueParent,reportingDatabase,reportingProject,rpcTimeoutMs,taskInvoker,webInvoker,workerAudience'
    || config.reportingProject!=='hushh-ai-prod' || config.reportingDatabase!=='metrics-reports'
    || !Number.isSafeInteger(config.rpcTimeoutMs) || config.rpcTimeoutMs<1 || config.rpcTimeoutMs>60000
    || !Number.isSafeInteger(config.maxResponseBytes) || config.maxResponseBytes<1 || config.maxResponseBytes>900000
    || config.taskInvoker!==`metrics-report-task-invoker@${config.reportingProject}.iam.gserviceaccount.com`
    || config.webInvoker!==`metrics-report-web@${config.reportingProject}.iam.gserviceaccount.com`
    || typeof config.queueParent!=='string' || !/^projects\/hushh-ai-prod\/locations\/[a-z0-9-]+\/queues\/metrics-uat-detail-[a-z0-9-]+$/.test(config.queueParent)) throw new BigQueryCostControlError();
  let audience:URL; try { audience=new URL(config.workerAudience); } catch { throw new BigQueryCostControlError(); }
  if (audience.protocol!=='https:' || !audience.hostname.endsWith('.run.app') || audience.origin!==config.workerAudience
    || audience.username || audience.password || audience.port || audience.search || audience.hash) throw new BigQueryCostControlError();
  const {Firestore}=await import('@google-cloud/firestore'); flags();
  const db=new Firestore({projectId:config.reportingProject,databaseId:config.reportingDatabase}),store=new FirestoreReportStore(db);
  const policy=async(sourceRecovery=false)=>store.transaction(async tx=>{
    const [raw,source]=await Promise.all([tx.get<any>(detailPath('policy','one-agent-detail-service')),
      tx.get<any>(detailPath('policy','one-agent-detail-two-source'))]);
    const p=validateUatServicePolicy(raw,source,Date.now(),sourceRecovery);
    if (p.reportingProject!==config.reportingProject || p.reportingDatabase!==config.reportingDatabase
      || p.workerAudience!==config.workerAudience || p.taskInvoker!==config.taskInvoker || p.webInvoker!==config.webInvoker || p.queueParent!==config.queueParent || p.rpcTimeoutMs!==config.rpcTimeoutMs || p.maxResponseBytes!==config.maxResponseBytes) throw new BigQueryCostControlError();
    return p;
  });
  try { await policy(true); flags(); } catch(error) { await db.terminate(); throw error; }
  const verify=googleWorkerIdentityVerifier();
  // The capabilities are intentionally private and cannot be reached by a
  // web or worker request until a reviewed job/composition route exists.
  const serviceAuthority=async(job:ReportJob)=>{
    flags(); const p=await policy(); flags();
    return String(job.request.reportId)==='one.agent-detail-uat' && job.control.scopeDigest===p.scopeDigest
      && job.control.sourceGeneration===p.sourceGeneration;
  };
  const preflight=new FixedUatDetailPreflight(store,serviceAuthority);
  const dispatch=new FixedUatDetailDispatch(store,serviceAuthority,Date.now,true);
  const reservations=new UatTwoSourceReservations(store,new FirestoreQueryBudgetStore(),Date.now,true);
  const worker=new MetricsReportWorker(store);
  const checkWorker=async(token:string)=>{
    flags(); if (typeof token!=='string' || !token || token.length>16384) throw new BigQueryCostControlError();
    const first=await policy(),identity=await verify(token,config.workerAudience),second=await policy();flags();
    if (!identity.emailVerified || identity.email!==config.taskInvoker || detailDigest(first)!==detailDigest(second)) throw new BigQueryCostControlError();
    return true;
  };
  const web=async(token:string,access:ReportAccess,sourceRecovery=false)=>{
    flags(); validateDetailAccess(access);
    if (typeof token!=='string' || !token || token.length>16384) throw new BigQueryCostControlError();
    const first=await policy(sourceRecovery),identity=await verify(token,config.workerAudience),second=await policy(sourceRecovery); flags();
    if (!identity.emailVerified || identity.email!==config.webInvoker || access.scopeDigest!==first.scopeDigest
      || detailDigest(first)!==detailDigest(second)) throw new BigQueryCostControlError();
    return access;
  };
  const staff=async(cookie:string|undefined,sourceRecovery=false)=>{
    flags(); const access=reportingSession(cookie); if (!access) throw new BigQueryCostControlError();
    const first=await policy(sourceRecovery); if (access.scopeDigest!==first.scopeDigest) throw new BigQueryCostControlError();
    const second=await policy(sourceRecovery); flags(); const again=reportingSession(cookie);
    if (!again || detailDigest(again)!==detailDigest(access) || detailDigest(first)!==detailDigest(second)) throw new BigQueryCostControlError();
    return access;
  };
  const readAccess=async(access:ReportAccess,input:unknown)=>{
    return store.transaction(async tx=>{
        const [global,raw,service]=await Promise.all([tx.get<ReportingPolicy>(detailPath('policy','current')),
          tx.get<any>(detailPath('policy','one-agent-detail-two-source')),tx.get<any>(detailPath('policy','one-agent-detail-service'))]);
        const now=Date.now(),limits=validateDetailPolicy(global),source=validateUatTwoSourcePolicies(raw,now,true),approved=validateUatServicePolicy(service,raw,now,true);
        if (approved.reportingProject!==config.reportingProject || approved.reportingDatabase!==config.reportingDatabase
          || approved.workerAudience!==config.workerAudience || approved.taskInvoker!==config.taskInvoker || approved.webInvoker!==config.webInvoker
          || approved.queueParent!==config.queueParent || approved.rpcTimeoutMs!==config.rpcTimeoutMs || approved.maxResponseBytes!==config.maxResponseBytes || approved.scopeDigest!==access.scopeDigest) throw new BigQueryCostControlError();
        const request=validateDetailRequest(input,limits.maxPeriodDays); if (request.reportId!=='one.agent-detail-uat') throw new BigQueryCostControlError();
        const control=validateDetailControl(await tx.get<ReportControl>(detailPath('controls',request.reportId)),request,access);
        if (control.scopeDigest!==source.manifest.scopeDigest || control.sourceGeneration!==source.manifest.sourceGeneration
          || request.startDate!==source.manifest.startDate || request.endDate!==source.manifest.endDate || request.timezone!==source.manifest.timezone) throw new BigQueryCostControlError();
        const key=detailReportKey(request,control),head=await tx.get<any>(detailPath('heads',key));
        const id=head?.publication;
        let result:{state:'unavailable'}|{state:'partial';freshness:'unknown';computedAt:number;detail:unknown}={state:'unavailable'};
        if (id!==undefined && id!==null) {
          if (typeof id!=='string' || !/^[a-f0-9]{64}$/.test(id)) throw new BigQueryCostControlError();
          const ids=uatTwoSourceChildIds(id,source.manifestDigest);
          const [job,pub,draft,feature,location]=await Promise.all([tx.get<ReportJob>(detailPath('jobs',id)),
            tx.get<any>(detailPath('uatCombinedPublications',id)),tx.get<any>(detailPath('uatCombinedDrafts',id)),
            tx.get<any>(detailPath('uatTwoSourceProofs',ids.feature)),tx.get<any>(detailPath('uatTwoSourceProofs',ids.location))]);
          if (!job || job.status!=='completed' || job.key!==key || detailDigest(job.request)!==detailDigest(request)
            || detailDigest(job.control)!==detailDigest(control) || !pub || pub.servicePolicyDigest!==detailDigest(service)
            || pub.policyDigest!==detailDigest(raw) || pub.manifestDigest!==source.manifestDigest) throw new BigQueryCostControlError();
          const validated=validateUatCombinedPublication(pub,draft,{feature,location},job,now,limits.maxSnapshotBytes);
          if (now-validated.computedAt<=control.staleMs) result={state:'partial',freshness:'unknown',computedAt:validated.computedAt,detail:validated.detail};
        }
        const quotaKey=detailDigest([access.subjectHash,'read',Math.floor(now/limits.quotaWindowMs)]),quota=await tx.get<{count:number}>(detailPath('quotas',quotaKey));
        const count=quota?.count??0;if (!Number.isSafeInteger(count) || count<0 || count>=limits.readRequests) throw new BigQueryCostControlError();
        tx.set(detailPath('quotas',quotaKey),{count:count+1,windowEndsAt:(Math.floor(now/limits.quotaWindowMs)+1)*limits.quotaWindowMs});
        return result;
      });
  };
  const statusAccess=async(access:ReportAccess,id:string)=>{
    if (!/^[a-f0-9]{64}$/.test(id)) throw new BigQueryCostControlError();
    const result=await store.transaction(async tx=>{
        const [global,job]=await Promise.all([tx.get<ReportingPolicy>(detailPath('policy','current')),tx.get<ReportJob>(detailPath('jobs',id))]);
        const now=Date.now(),limits=validateDetailPolicy(global);
        if (!job || job.id!==id || String(job.request.reportId)!=='one.agent-detail-uat' || job.control.scopeDigest!==access.scopeDigest) throw new BigQueryCostControlError();
        const request=validateDetailRequest(job.request,limits.maxPeriodDays),control=validateDetailControl(await tx.get<ReportControl>(detailPath('controls',request.reportId)),request,access);
        if (detailDigest(control)!==detailDigest(job.control) || job.key!==detailReportKey(request,control)) throw new BigQueryCostControlError();
        const head=await tx.get<any>(detailPath('heads',job.key));
        if (job.status==='completed' && head?.publication!==id) throw new BigQueryCostControlError();
        const quotaKey=detailDigest([access.subjectHash,'status',Math.floor(now/limits.quotaWindowMs)]),quota=await tx.get<{count:number}>(detailPath('quotas',quotaKey));
        const count=quota?.count??0;if (!Number.isSafeInteger(count) || count<0 || count>=limits.statusRequests) throw new BigQueryCostControlError();
        tx.set(detailPath('quotas',quotaKey),{count:count+1,windowEndsAt:(Math.floor(now/limits.quotaWindowMs)+1)*limits.quotaWindowMs});
        return {state:job.status,request,key:job.key,needsAttention:job.needsAttention};
      });
      if (result.state==='completed') {
        // A completed status also consumes one read quota: it validates the
        // actual current publication rather than trusting the job state alone.
        const current=await readAccess(access,result.request); if (current.state!=='partial') throw new BigQueryCostControlError();
        const head=await store.transaction(tx=>tx.get<any>(detailPath('heads',result.key)));
        if (head?.publication!==id) throw new BigQueryCostControlError();
      }
    return {state:result.state==='completed'?'partial' as const:result.state,needsAttention:result.needsAttention};
  };
  return Object.freeze({
    async checkStaff(cookie:string|undefined) {
      await staff(cookie,true); return true;
    },
    checkWorker,
    async checkWeb(token:string,access:ReportAccess) { await web(token,access,true); return true; },
    async read(cookie:string|undefined,input:unknown) {
      const access=await staff(cookie,true);
      const result=await readAccess(access,input);
      const after=await staff(cookie,true); if (detailDigest(after)!==detailDigest(access)) throw new BigQueryCostControlError();
      return result;
    },
    async readForWeb(token:string,access:ReportAccess,input:unknown) {
      validateDetailAccess(access); const scoped=Object.freeze({...access});
      await web(token,scoped,true); const result=await readAccess(scoped,input);
      await web(token,scoped,true); return result;
    },
    async requestForWeb(token:string,access:ReportAccess,input:unknown,signal:AbortSignal) {
      validateDetailAccess(access); const scoped=Object.freeze({...access});
      computeFlags(); signal.throwIfAborted(); await web(token,scoped); computeFlags(); signal.throwIfAborted();
      const result=await new MetricsReports(store,Date.now,undefined,true).request(input,scoped);
      await web(token,scoped); computeFlags(); signal.throwIfAborted();
      if (result.jobId) {
        const queue=new UatDetailTaskQueue({enabled:true,parent:config.queueParent,workerUrl:config.workerAudience+'/internal/metrics/uat-detail/collect',invokerEmail:config.taskInvoker,rpcTimeoutMs:config.rpcTimeoutMs},cloudTasksRequest(config.maxResponseBytes));
        const guardedQueue={taskName:(id:string)=>queue.taskName(id),
          create:async(id:string)=>{await web(token,scoped); computeFlags(); signal.throwIfAborted(); return queue.create(id);},
          lookup:async(id:string)=>{await web(token,scoped); computeFlags(); signal.throwIfAborted(); return queue.lookup(id);}};
        await new MetricsReportDispatch(store,guardedQueue).deliver(result.jobId,detailDigest(config.webInvoker));
        await web(token,scoped); computeFlags(); signal.throwIfAborted();
      }
      return result;
    },
    async status(cookie:string|undefined,id:string) {
      const access=await staff(cookie,true), result=await statusAccess(access,id);
      const after=await staff(cookie,true);if(detailDigest(after)!==detailDigest(access)) throw new BigQueryCostControlError(); return result;
    },
    async statusForWeb(token:string,access:ReportAccess,id:string) {
      validateDetailAccess(access);const scoped=Object.freeze({...access});await web(token,scoped,true);
      const result=await statusAccess(scoped,id);await web(token,scoped,true);return result;
    },
    async collect(token:string,jobId:string,signal:AbortSignal) {
      computeFlags(); await checkWorker(token); computeFlags(); signal.throwIfAborted();
      if (!/^[a-f0-9]{64}$/.test(jobId)) throw new BigQueryCostControlError();
      const prior=await worker.inspect(jobId); signal.throwIfAborted();
      if (!prior || String(prior.request.reportId)!=='one.agent-detail-uat' || prior.lane!=='custom' || !await serviceAuthority(prior)) throw new BigQueryCostControlError();
      const claim=await worker.claim(jobId,detailDigest(config.taskInvoker)); if (!claim) return {state:'unavailable' as const};
      const job=claim.job;
      try {
        if (!await serviceAuthority(job)) throw new BigQueryCostControlError(); signal.throwIfAborted();
        if (!claim.recoverOnly) {
          const feature=await preflight.estimate('feature',job,signal),location=await preflight.estimate('location',job,signal);
          const held=await reservations.reserve(job,{feature,location});
          if (held.state!=='reservations_observed' || (await reservations.confirm(job)).state!=='confirmed') throw new BigQueryCostControlError();
          signal.throwIfAborted(); await dispatch.submit('feature',job,signal); signal.throwIfAborted();
          await dispatch.submit('location',job,signal); signal.throwIfAborted();
        }
        const source=await store.transaction(tx=>tx.get<any>(detailPath('policy','one-agent-detail-two-source')));
        const approved=validateUatTwoSourcePolicies(source,Date.now(),true), ids=uatTwoSourceChildIds(job.id,approved.manifestDigest);
        for (const role of ['feature','location'] as const) {
          const child=await store.transaction(tx=>tx.get<any>(detailPath('uatTwoSourceChildren',ids[role])));
          if (child?.state==='dispatching') { if ((await dispatch.recover(role,job,signal)).state!=='complete') throw new BigQueryCostControlError(); }
          else if (child?.state!=='complete') throw new BigQueryCostControlError();
          signal.throwIfAborted();
        }
        await dispatch.prepareCombined(job,signal);
        return await dispatch.publishCombined(job,signal);
      } catch(error) { try { await worker.defer(job,0,true); } catch { /* Preserve the winning durable state. */ } throw error; }
    },
    close:()=>db.terminate(),
  });
}
