import { randomUUID } from 'node:crypto';
import type { BigQuery, Query } from '@google-cloud/bigquery';
import type { Firestore } from '@google-cloud/firestore';

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
    if (typeof request.query !== 'string') throw new BigQueryCostControlError('A fixed SQL query is required.');
    const statements = countBudgetedStatements(request.query);
    const requestedBytes = request.maximumBytesBilled == null
      ? BIGQUERY_COST_LIMITS.bytesPerStatement : Number(request.maximumBytesBilled);
    if (!Number.isSafeInteger(requestedBytes) || requestedBytes <= 0) {
      throw new BigQueryCostControlError('Invalid per-query byte limit.');
    }
    const perStatement = Math.min(requestedBytes, BIGQUERY_COST_LIMITS.bytesPerStatement);
    if (active >= BIGQUERY_COST_LIMITS.concurrentRequests) {
      if (waiting.length >= BIGQUERY_COST_LIMITS.queuedRequests) {
        throw new BigQueryCostControlError('Dashboard queries are busy. Try again later.');
      }
      await new Promise<void>(resolve => waiting.push(resolve));
    } else {
      active++;
    }
    try {
      if (!options.enabled()) throw new BigQueryCostControlError();
      const id = `metrics_${options.newId?.() ?? randomUUID().replaceAll('-', '_')}`;
      const day = (options.now?.() ?? new Date()).toISOString().slice(0, 10);
      try {
        await options.budget.reserve({ id, day, bytes: perStatement * statements, statements });
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
        labels: { application: 'metrics_dashboard', cost_policy: 'v1', budget_day: day },
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
  return client.createQueryJob({ query: request.query, dryRun: true,
    useLegacySql: false, location: 'US', useQueryCache: true,
    maximumBytesBilled: String(BIGQUERY_COST_LIMITS.bytesPerStatement) });
}

export const guardedBigQuery = createGuardedBigQuery({
  budget: new FirestoreQueryBudgetStore(),
  // Disabled unless deliberately configured after an explicit decision to resume.
  enabled: () => process.env.METRICS_BIGQUERY_ENABLED === 'true',
  execute: async request => {
    const client = await nativeClient();
    // A stable, pre-reserved jobId makes submission retries idempotent.
    const [job] = await client.createQueryJob(request);
    const [rows] = await job.getQueryResults({ autoPaginate: true, timeoutMs: BIGQUERY_COST_LIMITS.timeoutMs });
    return [rows as Record<string, unknown>[]];
  },
});
