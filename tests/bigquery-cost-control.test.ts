import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from '@google-cloud/firestore';
import type { Query } from '@google-cloud/bigquery';
import { BIGQUERY_COST_LIMITS as limits, BigQueryCostControlError, countBudgetedStatements,
  createGuardedBigQuery, FirestoreQueryBudgetStore, guardedBigQuery, guardedBigQueryDryRun,
  type QueryBudgetReservation } from '../src/server/bigquery-cost-control';

const sdk = vi.hoisted(() => ({ createQueryJob: vi.fn(async (_request: unknown): Promise<any[]> => [{ metadata: {} }]), job: vi.fn() }));
const restoration = vi.hoisted(() => ({ active: false, value: undefined as any }));
vi.mock('../src/server/legacy-restoration', async original => ({
  ...await original<typeof import('../src/server/legacy-restoration')>(),
  legacyRestoration: async () => restoration.active ? restoration.value : null,
}));
vi.mock('@google-cloud/bigquery', () => ({ BigQuery: class { createQueryJob = sdk.createQueryJob; job = sdk.job; } }));
vi.mock('@google-cloud/firestore', () => ({ Firestore: class {
  private database = new AtomicDatabase();
  doc = (path: string) => this.database.doc(path);
  runTransaction = (run: (transaction: any) => Promise<unknown>) => this.database.runTransaction(run);
} }));
afterEach(() => { vi.unstubAllEnvs(); sdk.createQueryJob.mockReset(); sdk.job.mockReset(); restoration.active = false; });

/** Atomic test double. Real transaction contention is covered by the emulator suite. */
class AtomicDatabase {
  values = new Map<string, Record<string, unknown>>();
  private tail = Promise.resolve();
  doc(path: string): any { return { path, collection: (name: string) => ({ doc: (id: string) => this.doc(`${path}/${name}/${id}`) }) }; }
  async runTransaction<T>(run: (transaction: any) => Promise<T>) {
    const previous = this.tail;
    let unlock!: () => void;
    this.tail = new Promise<void>(resolve => { unlock = resolve; });
    await previous;
    const writes = new Map<string, Record<string, unknown>>();
    try {
      const value = await run({
        getAll: async (...refs: { path: string }[]) => refs.map(ref => ({ exists: this.values.has(ref.path), data: () => this.values.get(ref.path) })),
        set: (ref: { path: string }, data: Record<string, unknown>) => writes.set(ref.path, data),
        create: (ref: { path: string }, data: Record<string, unknown>) => {
          if (this.values.has(ref.path)) throw new Error('already exists');
          writes.set(ref.path, data);
        },
      });
      for (const [key, data] of writes) this.values.set(key, data);
      return value;
    } finally { unlock(); }
  }
  store() { return new FirestoreQueryBudgetStore(this as unknown as Pick<Firestore, 'doc' | 'runTransaction'>); }
}
const project = limits.project;
const day = '2026-11-07';
const reservation = (id: string, statements = 1): QueryBudgetReservation => ({
  id: `metrics_${id}`, day, bytes: limits.bytesPerStatement * statements, statements,
});

describe('BigQuery execution boundary', () => {
  it('restores the normal capped script policy once a configured permit is closed or expired', async () => {
    vi.stubEnv('METRICS_BIGQUERY_ENABLED', 'true'); restoration.active = true;
    restoration.value = { prepare: async (value: Query) => value, admit: async () => undefined, isPreparing: async () => false };
    const getQueryResults = vi.fn(async () => [[]]);
    sdk.createQueryJob.mockImplementation(async (value: any) => value.dryRun
      ? [{ metadata: { statistics: { totalBytesProcessed: '1', query: { statementType: 'UPDATE' } } } }]
      : [{ getQueryResults }]);
    await guardedBigQuery(project, { query: 'UPDATE `p.d.t` SET value=1' });
    const paid = sdk.createQueryJob.mock.calls.find(([value]: any) => !value.dryRun)![0] as Query;
    expect(paid.maximumBytesBilled).toBe(String(limits.bytesPerStatement));
    expect(paid.jobId).not.toContain('restore_');
  });
  it('recovers a lost restoration submission through the exact native ID without another paid job', async () => {
    vi.stubEnv('METRICS_BIGQUERY_ENABLED', 'true');
    const grant = { permitId: 'restore_1234567890abcdef', planHash: 'a'.repeat(64),
      id: 'metrics_restore_1234567890abcdef_' + 'a'.repeat(64), bytes: 20 * 1024 ** 2 };
    restoration.active = true;
    restoration.value = { prepare: async (value: Query) => value, admit: async () => grant, isPreparing: async () => true, reserve: vi.fn(async () => {}) };
    let exists = false; let conflict = false;
    const getQueryResults = vi.fn(async () => [[{ value: 42 }], null]);
    const getMetadata = vi.fn(async () => {
      if (!exists) throw Object.assign(new Error('missing'), { code: 404 });
      return [{ jobReference: { projectId: project, location: 'US' },
        configuration: { query: { query: conflict ? 'SELECT 0' : 'SELECT 42', maximumBytesBilled: String(grant.bytes), useLegacySql: false } } }];
    });
    sdk.job.mockReturnValue({ getMetadata, getQueryResults });
    sdk.createQueryJob.mockImplementation(async (value: any) => {
      if (value.dryRun) return [{ metadata: { statistics: { totalBytesProcessed: '1', query: { statementType: 'SELECT' } } } }];
      exists = true; throw Object.assign(new Error('acknowledgement lost'), { code: 503 });
    });
    await expect(guardedBigQuery(project, { query: 'SELECT 42' })).rejects.toThrow('acknowledgement lost');
    expect(await guardedBigQuery(project, { query: 'SELECT 42' })).toEqual([[{ value: 42 }]]);
    expect(sdk.createQueryJob.mock.calls.filter(([value]: any) => !value.dryRun)).toHaveLength(1);
    expect(sdk.job).toHaveBeenCalledWith(grant.id, { location: 'US' });
    conflict = true;
    await expect(guardedBigQuery(project, { query: 'SELECT 42' })).rejects.toThrow();
    expect(sdk.createQueryJob.mock.calls.filter(([value]: any) => !value.dryRun)).toHaveLength(1);
    expect(getQueryResults).toHaveBeenCalledTimes(1);
  });
  it('rejects oversized, invalid and failed free estimates without consuming the daily allowance', async () => {
    const reserve = vi.fn(); const execute = vi.fn();
    for (const value of [limits.bytesPerStatement + 1, -1, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      const run = createGuardedBigQuery({ budget: { reserve }, execute, enabled: () => true, estimate: async () => value });
      await expect(run(project, { query: 'SELECT 1' })).rejects.toThrow('scan limit');
    }
    const run = createGuardedBigQuery({ budget: { reserve }, execute, enabled: () => true,
      estimate: async () => { throw new Error('provider unavailable'); } });
    await expect(run(project, { query: 'SELECT 1' })).rejects.toThrow('estimated safely');
    expect(reserve).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });
  it('still reserves the full native ceiling after a smaller estimate, and rechecks revocation', async () => {
    const order: string[] = []; let enabled = true;
    const reserve = vi.fn(async (_reservation: QueryBudgetReservation) => { order.push('reserve'); });
    const execute = vi.fn(async (): Promise<[Record<string, unknown>[]]> => { order.push('execute'); return [[]]; });
    const estimate = vi.fn(async () => { order.push('estimate'); return 1; });
    const run = createGuardedBigQuery({ budget: { reserve }, execute, estimate, enabled: () => enabled });
    await run(project, { query: 'SELECT @id', params: { id: 3 } });
    expect(order).toEqual(['estimate', 'reserve', 'execute']);
    expect(reserve.mock.calls[0][0]).toMatchObject({ bytes: limits.bytesPerStatement, statements: 1 });
    expect(estimate).toHaveBeenCalledWith({ query: 'SELECT @id', params: { id: 3 }, types: undefined });
    estimate.mockImplementationOnce(async () => { enabled = false; return 1; });
    await expect(run(project, { query: 'SELECT 1' })).rejects.toThrow('paused');
    expect(reserve).toHaveBeenCalledTimes(1); expect(execute).toHaveBeenCalledTimes(1);
  });
  it('is disabled by default, without loading the SDK or contacting the budget store', async () => {
    vi.stubEnv('METRICS_BIGQUERY_ENABLED', 'false');
    await expect(guardedBigQuery(project, { query: 'SELECT 1' })).rejects.toThrow('paused');
    await expect(guardedBigQueryDryRun(project, { query: 'SELECT 1', dryRun: true })).rejects.toThrow('paused');
    expect(sdk.createQueryJob).not.toHaveBeenCalled();
    const reserve = vi.fn(); const execute = vi.fn();
    await expect(createGuardedBigQuery({ budget: { reserve }, execute, enabled: () => false })(project, { query: 'SELECT 1' })).rejects.toThrow('paused');
    expect(reserve).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });
  it('reserves the worst case before submission and cannot override billing controls', async () => {
    const order: string[] = []; let stored: QueryBudgetReservation | undefined;
    const execute = vi.fn(async (_request: Query): Promise<[Record<string, unknown>[]]> => { order.push('submit'); return [[{ value: 1 }]]; });
    const guarded = createGuardedBigQuery({ enabled: () => true, now: () => new Date(`${day}T23:59:59Z`), newId: () => 'one', execute,
      budget: { reserve: async value => { order.push('reserve'); stored = value; } } });
    await guarded(project, { query: 'SELECT @value', params: { value: 1 }, maximumBytesBilled: '999999999999',
      useQueryCache: false, useLegacySql: true, location: 'EU', jobId: 'bypass', jobTimeoutMs: 999999,
      destinationTable: 'unexpected', scriptOptions: { statementByteBudget: '999999999999' } } as Query);
    expect(order).toEqual(['reserve', 'submit']);
    expect(stored).toEqual(reservation('one'));
    const request = execute.mock.calls[0][0];
    expect(request).toMatchObject({ maximumBytesBilled: String(limits.bytesPerStatement), useQueryCache: true,
      useLegacySql: false, location: 'US', jobId: 'metrics_one', jobTimeoutMs: 30000, params: { value: 1 } });
    expect(request).not.toHaveProperty('destinationTable'); expect(request).not.toHaveProperty('scriptOptions');
  });
  it('budgets every fixed script statement and sets the native statement byte budget', async () => {
    const reserve = vi.fn(async (_reservation: QueryBudgetReservation) => {}); const execute = vi.fn(async (_request: Query): Promise<[Record<string, unknown>[]]> => [[]]);
    const run = createGuardedBigQuery({ budget: { reserve }, execute, enabled: () => true });
    await run(project, { query: "BEGIN TRANSACTION; UPDATE `p.d.t` SET value=1; ASSERT @@row_count=1 AS 'ok'; COMMIT TRANSACTION;" });
    expect(reserve.mock.calls[0][0]).toMatchObject({ statements: 4, bytes: limits.bytesPerStatement * 4 });
    expect(execute.mock.calls[0][0]).toMatchObject({ scriptOptions: { statementByteBudget: String(limits.bytesPerStatement), statementTimeoutMs: '30000' } });
  });
  it('fails closed for another billing project, invalid limits, unsafe SQL, and a failed budget ledger', async () => {
    const execute = vi.fn(async (_request: Query): Promise<[Record<string, unknown>[]]> => [[]]);
    const reserve = vi.fn(async () => { throw new Error('offline'); });
    const run = createGuardedBigQuery({ budget: { reserve }, execute, enabled: () => true });
    await expect(run('other-project', { query: 'SELECT 1' })).rejects.toThrow('approved');
    await expect(run(project, { query: 'SELECT 1', maximumBytesBilled: '0' })).rejects.toThrow('limit');
    await expect(run(project, { query: 'CALL expensive_procedure()' })).rejects.toThrow();
    expect(reserve).not.toHaveBeenCalled();
    await expect(run(project, { query: 'SELECT 1' })).rejects.toThrow('budget is unavailable');
    expect(execute).not.toHaveBeenCalled();
  });
  it('does not refund jobs after a provider error and resets only at the next UTC day', async () => {
    const db = new AtomicDatabase(); let time = new Date(`${day}T23:59:59Z`); let id = 0;
    const run = createGuardedBigQuery({ budget: db.store(), enabled: () => true, now: () => time, newId: () => String(++id),
      execute: async () => { throw new Error('ambiguous RPC failure'); } });
    await expect(run(project, { query: 'SELECT 1' })).rejects.toThrow('RPC');
    expect(db.values.get(`metricsQueryBudgetDays/${day}`)?.statements).toBe(1);
    time = new Date('2026-11-08T00:00:00Z');
    await expect(run(project, { query: 'SELECT 1' })).rejects.toThrow('RPC');
    expect(db.values.get('metricsQueryBudgetDays/2026-11-08')?.statements).toBe(1);
    expect(db.values.get(`metricsQueryBudgetDays/${day}`)?.statements).toBe(1);
  });
  it('limits in-flight requests and rechecks the pause switch after waiting', async () => {
    let enabled = true; const releases: Array<() => void> = [];
    const reserve = vi.fn(async (_reservation: QueryBudgetReservation) => {});
    const execute = vi.fn(async (_request: Query): Promise<[Record<string, unknown>[]]> => { await new Promise<void>(resolve => releases.push(resolve)); return [[]]; });
    const run = createGuardedBigQuery({ budget: { reserve }, enabled: () => enabled, execute });
    const first = run(project, { query: 'SELECT 1' }), second = run(project, { query: 'SELECT 2' });
    const queued = expect(run(project, { query: 'SELECT 3' })).rejects.toThrow('paused');
    await new Promise(resolve => setImmediate(resolve));
    expect(execute).toHaveBeenCalledTimes(2);
    enabled = false; releases.forEach(resolve => resolve());
    await Promise.all([first, second, queued]); expect(reserve).toHaveBeenCalledTimes(2);
  });
  it('rechecks the pause switch after a delayed reservation', async () => {
    let enabled = true;
    const execute = vi.fn(async (_request: Query): Promise<[Record<string, unknown>[]]> => [[]]);
    const run = createGuardedBigQuery({ budget: { reserve: async () => { enabled = false; } }, enabled: () => enabled, execute });
    await expect(run(project, { query: 'SELECT 1' })).rejects.toThrow('paused');
    expect(execute).not.toHaveBeenCalled();
  });
  it('dry-run callers cannot turn an estimate into a paid job or override its options', async () => {
    vi.stubEnv('METRICS_BIGQUERY_ENABLED', 'true');
    await expect(guardedBigQueryDryRun(project, { query: 'SELECT 1', dryRun: false })).rejects.toThrow();
    await guardedBigQueryDryRun(project, { query: 'SELECT 1', dryRun: true, maximumBytesBilled: '99999999999', useLegacySql: true });
    expect(sdk.createQueryJob).toHaveBeenCalledExactlyOnceWith({ query: 'SELECT 1', dryRun: true, useLegacySql: false,
      useQueryCache: true, location: 'US', maximumBytesBilled: String(limits.bytesPerStatement) });
  });
  it('submits a stable capped native job and reads that job instead of issuing a second query', async () => {
    vi.stubEnv('METRICS_BIGQUERY_ENABLED', 'true');
    const getQueryResults = vi.fn(async () => [[{ value: 7 }]]);
    sdk.createQueryJob.mockResolvedValueOnce([{ metadata: { statistics: { totalBytesProcessed: '1' } } }]);
    sdk.createQueryJob.mockResolvedValueOnce([{ getQueryResults }]);
    expect(await guardedBigQuery(project, { query: 'SELECT 7', useQueryCache: false })).toEqual([[{ value: 7 }]]);
    expect(sdk.createQueryJob).toHaveBeenCalledTimes(2);
    expect(sdk.createQueryJob.mock.calls[0][0]).toMatchObject({ dryRun: true, query: 'SELECT 7', maximumBytesBilled: String(limits.bytesPerStatement) });
    expect(sdk.createQueryJob.mock.calls[1][0]).toMatchObject({ maximumBytesBilled: String(limits.bytesPerStatement),
      jobId: expect.stringMatching(/^metrics_/), useQueryCache: true, jobTimeoutMs: 30000 });
    expect(getQueryResults).toHaveBeenCalledExactlyOnceWith({ autoPaginate: true, timeoutMs: 30000 });
  });
});

describe('durable query reservations', () => {
  it('shares the 100-statement ceiling across store instances and process restarts', async () => {
    const db = new AtomicDatabase(); const stores = [db.store(), db.store()];
    const results = await Promise.allSettled(Array.from({ length: 110 }, (_, i) => stores[i % 2].reserve(reservation(String(i)))));
    expect(results.filter(value => value.status === 'fulfilled')).toHaveLength(100);
    expect(db.values.get(`metricsQueryBudgetDays/${day}`)).toEqual({ policyVersion: 1, bytes: limits.bytesPerStatement * 100, statements: 100 });
    await expect(db.store().reserve(reservation('after_restart'))).rejects.toThrow('exhausted');
  });
  it('is idempotent for one stable job ID but rejects mismatched retries', async () => {
    const db = new AtomicDatabase();
    await db.store().reserve(reservation('same')); await db.store().reserve(reservation('same'));
    expect(db.values.get(`metricsQueryBudgetDays/${day}`)?.statements).toBe(1);
    await expect(db.store().reserve(reservation('same', 2))).rejects.toThrow('does not match');
  });
  it('checks the byte ceiling separately and rejects corrupted ledger records', async () => {
    const db = new AtomicDatabase(), key = `metricsQueryBudgetDays/${day}`;
    db.values.set(key, { policyVersion: 1, bytes: limits.bytesPerUtcDay - 1, statements: 1 });
    await expect(db.store().reserve(reservation('bytes'))).rejects.toThrow('exhausted');
    db.values.set(key, { policyVersion: 1, bytes: -1, statements: 1 });
    await expect(db.store().reserve(reservation('corrupt'))).rejects.toThrow('unavailable');
    db.values.set(key, { policyVersion: 1, statements: 1 });
    await expect(db.store().reserve(reservation('missing'))).rejects.toThrow('unavailable');
    expect(db.values.size).toBe(1);
  });
});

describe('fixed SQL statement accounting', () => {
  it('ignores delimiters and control words inside comments, identifiers and strings', () => {
    expect(countBudgetedStatements("-- LOOP;\nSELECT '; CALL procedure()' AS `WHILE;`, '''semi;colon'''; /* ; */ SELECT 2;")).toBe(2);
    expect(countBudgetedStatements("SELECT r'\\;'; # comment;\nSELECT 'it\\'s;ok'" )).toBe(2);
  });
  it.each(['', '/* unclosed', "SELECT 'unclosed", 'EXECUTE IMMEDIATE "SELECT 1"',
    'CALL proc()', 'BEGIN SELECT 1; END;', 'WHILE TRUE DO SELECT 1; END WHILE;',
    Array(9).fill('SELECT 1').join(';')])('rejects unsupported SQL: %s', sql => {
    expect(() => countBudgetedStatements(sql)).toThrow(BigQueryCostControlError);
  });
});
