import { randomUUID } from 'node:crypto';
import type { BigQuery, Query } from '@google-cloud/bigquery';
import type { Firestore } from '@google-cloud/firestore';
import { legacyRestoration, legacyDiagnosticOnly, noteLegacyQueryFailure, RESTORATION_LIMITS, type RestorationGrant } from './legacy-restoration';

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
      const restore = await legacyRestoration();
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
  enabled: () => boolean;
  now?: () => Date;
  newId?: () => string;
}) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async (project: string, request: Query): Promise<GuardedQueryResult> => {
    if (!options.enabled()) throw new BigQueryCostControlError();
    if (project !== BIGQUERY_COST_LIMITS.project) {
      throw new BigQueryCostControlError('BigQuery query jobs must use the approved dashboard project.');
    }
    if (options.prepare) request = await options.prepare(request);
    if (typeof request.query !== 'string') throw new BigQueryCostControlError('A fixed SQL query is required.');
    const statements = countBudgetedStatements(request.query);
    const requestedBytes = request.maximumBytesBilled == null
      ? BIGQUERY_COST_LIMITS.bytesPerStatement : Number(request.maximumBytesBilled);
    if (!Number.isSafeInteger(requestedBytes) || requestedBytes <= 0) {
      throw new BigQueryCostControlError('Invalid per-query byte limit.');
    }
    let perStatement = Math.min(requestedBytes, BIGQUERY_COST_LIMITS.bytesPerStatement);
    let restoration: RestorationGrant | undefined;
    if (active >= BIGQUERY_COST_LIMITS.concurrentRequests) {
      // Diagnostics perform dry runs only and can queue a bounded whole report.
      const queueLimit = legacyDiagnosticOnly() ? 128 : BIGQUERY_COST_LIMITS.queuedRequests;
      if (waiting.length >= queueLimit) {
        throw new BigQueryCostControlError('Dashboard queries are busy. Try again later.');
      }
      await new Promise<void>(resolve => waiting.push(resolve));
    } else {
      active++;
    }
    try {
      if (!options.enabled()) throw new BigQueryCostControlError();
      if (options.estimate) {
        let estimatedBytes: number;
        try {
          estimatedBytes = await options.estimate({ query: request.query, params: request.params, types: request.types });
        } catch {
          throw new BigQueryCostControlError('The query scan could not be estimated safely.');
        }
        if (!Number.isSafeInteger(estimatedBytes) || estimatedBytes < 0) throw new BigQueryCostControlError('Invalid scan limit estimate.');
        restoration = await options.restoration?.(request, estimatedBytes);
        if (restoration) {
          if (statements !== 1 || !Number.isSafeInteger(restoration.bytes) || restoration.bytes < estimatedBytes
            || restoration.bytes > RESTORATION_LIMITS.bytesPerJob) throw new BigQueryCostControlError();
          perStatement = restoration.bytes;
        }
        if (estimatedBytes > perStatement * statements) {
          throw new BigQueryCostControlError('This report exceeds the query scan limit. Choose a shorter period.');
        }
      }
      if (!options.enabled()) throw new BigQueryCostControlError();
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
          ...(restoration ? { restore_permit: restoration.permitId } : {}) },
      });
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

const clients = new Map<string, BigQuery>();
async function nativeClient() {
  const { BigQuery } = await import('@google-cloud/bigquery');
  const project = BIGQUERY_COST_LIMITS.project;
  const client = clients.get(project) ?? new BigQuery({ projectId: project });
  clients.set(project, client);
  return client;
}

/** Estimates never execute SQL. Keep the platform capture's existing scan
 * comparison without exposing native createQueryJob to runtime callers. */
export async function guardedBigQueryDryRun(project: string, request: Query) {
  if (process.env.METRICS_BIGQUERY_ENABLED !== 'true') throw new BigQueryCostControlError();
  if (project !== BIGQUERY_COST_LIMITS.project || request.dryRun !== true
    || typeof request.query !== 'string' || countBudgetedStatements(request.query) !== 1) {
    throw new BigQueryCostControlError('Only a fixed dry-run estimate is allowed.');
  }
  const client = await nativeClient();
  const restoration = await legacyRestoration();
  const preparing = await restoration?.isPreparing();
  const prepared = restoration ? await restoration.prepare(request) : request;
  return client.createQueryJob({ query: prepared.query, dryRun: true,
    useLegacySql: false, location: 'US', useQueryCache: true,
    maximumBytesBilled: String(legacyDiagnosticOnly() ? 512 * 1024 ** 3 : preparing ? RESTORATION_LIMITS.bytesPerJob : BIGQUERY_COST_LIMITS.bytesPerStatement) });
}

const executeGuardedBigQuery = createGuardedBigQuery({
  budget: new FirestoreQueryBudgetStore(),
  // Disabled unless deliberately configured after an explicit decision to resume.
  enabled: () => process.env.METRICS_BIGQUERY_ENABLED === 'true',
  prepare: async request => (await legacyRestoration())?.prepare(request) ?? request,
  restoration: async (request, estimated) => (await legacyRestoration())?.admit(request, estimated),
  estimate: async request => {
    const client = await nativeClient();
    const restoration = await legacyRestoration();
    const preparing = await restoration?.isPreparing();
    const [job] = await client.createQueryJob({ query: request.query, params: request.params, types: request.types,
      dryRun: true, useLegacySql: false, useQueryCache: true, location: 'US',
      maximumBytesBilled: String(legacyDiagnosticOnly() ? 512 * 1024 ** 3 : preparing ? RESTORATION_LIMITS.bytesPerJob : BIGQUERY_COST_LIMITS.bytesPerStatement),
      jobTimeoutMs: BIGQUERY_COST_LIMITS.timeoutMs });
    const value = job.metadata.statistics?.totalBytesProcessed;
    if (preparing && job.metadata.statistics?.query?.statementType !== 'SELECT') {
      throw new BigQueryCostControlError('Initial restoration accepts read-only SELECT plans only.');
    }
    if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new BigQueryCostControlError('No native query estimate.');
    return Number(value);
  },
  execute: async request => {
    const client = await nativeClient();
    if (typeof request.jobId === 'string' && request.jobId.startsWith('metrics_restore_')) {
      const job = client.job(request.jobId, { location: 'US' });
      let exists = false;
      try {
        const [metadata] = await job.getMetadata();
        const query = metadata.configuration?.query;
        if (query?.query !== request.query || query?.maximumBytesBilled !== request.maximumBytesBilled
          || query.useLegacySql !== false || metadata.jobReference?.projectId !== BIGQUERY_COST_LIMITS.project
          || metadata.jobReference?.location !== 'US') throw new BigQueryCostControlError();
        exists = true;
      } catch (error) {
        if ((error as { code?: number }).code !== 404) throw error;
      }
      if (!exists) {
        try { await client.createQueryJob(request); }
        catch (error) { if ((error as { code?: number }).code !== 409) throw error; }
        // Reconcile the exact stable ID, including any lost acknowledgement.
        const [metadata] = await job.getMetadata();
        if (metadata.configuration?.query?.query !== request.query
          || metadata.configuration?.query?.maximumBytesBilled !== request.maximumBytesBilled
          || metadata.configuration?.query?.useLegacySql !== false
          || metadata.jobReference?.projectId !== BIGQUERY_COST_LIMITS.project
          || metadata.jobReference?.location !== 'US') throw new BigQueryCostControlError();
      }
      const [rows, next] = await job.getQueryResults({ autoPaginate: false, maxResults: 2000, timeoutMs: BIGQUERY_COST_LIMITS.timeoutMs });
      if (next?.pageToken || rows.length >= 2000 || Buffer.byteLength(JSON.stringify(rows)) > RESTORATION_LIMITS.snapshotBytes) throw new BigQueryCostControlError('Restored aggregate exceeds its payload bound.');
      return [rows as Record<string, unknown>[]];
    }
    // A stable, pre-reserved jobId makes submission retries idempotent.
    const [job] = await client.createQueryJob(request);
    const [rows] = await job.getQueryResults({ autoPaginate: true, timeoutMs: BIGQUERY_COST_LIMITS.timeoutMs });
    return [rows as Record<string, unknown>[]];
  },
});

export async function guardedBigQuery(project: string, request: Query): Promise<GuardedQueryResult> {
  try { return await executeGuardedBigQuery(project, request); }
  catch (error) { noteLegacyQueryFailure(); throw error; }
}
