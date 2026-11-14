import { describe, expect, it } from 'vitest';
import type { Firestore } from '@google-cloud/firestore';
import { LegacyRestoration, RESTORATION_LIMITS as limits, freezeRestorationSql,
  restorationPlanDigest, validPermit, withLegacyReportScope, type RestorationPermit } from '../src/server/legacy-restoration';

class Database {
  values = new Map<string, any>(); private tail = Promise.resolve();
  doc(path: string): any { return { path, get: async () => this.snapshot(path),
    collection: (name: string) => ({ doc: (id: string) => this.doc(`${path}/${name}/${id}`) }) }; }
  snapshot(path: string) { return { exists: this.values.has(path), data: () => this.values.get(path) }; }
  async runTransaction<T>(run: (transaction: any) => Promise<T>) {
    const previous = this.tail; let unlock!: () => void;
    this.tail = new Promise<void>(resolve => { unlock = resolve; }); await previous;
    const writes = new Map<string, any>();
    try {
      const result = await run({ get: async (ref: any) => this.snapshot(ref.path),
        getAll: async (...refs: any[]) => refs.map(ref => this.snapshot(ref.path)),
        update: (ref: any, value: any) => writes.set(ref.path, { ...(writes.get(ref.path) ?? this.values.get(ref.path)), ...value }),
        create: (ref: any, value: any) => { if (this.values.has(ref.path)) throw new Error('exists'); writes.set(ref.path, value); } });
      for (const [key, value] of writes) this.values.set(key, value);
      return result;
    } finally { unlock(); }
  }
  native() { return this as unknown as Pick<Firestore, 'doc' | 'runTransaction'>; }
}
const id = 'restore_1234567890abcdef', source = 'a'.repeat(40), path = `metricsRestorationPermits/${id}`;
const start = Date.parse('2026-11-14T23:59:00.000Z');
function permit(): RestorationPermit {
  return { source, phase: 'planning', createdAt: start, expiresAt: start + 600_000, asOf: new Date(start).toISOString(),
    maxBytes: 100 * 1024 ** 2, maxJobs: 3, plans: {}, reservedBytes: 0, reservedJobs: 0 };
}
function fixture() {
  const db = new Database(); let now = start;
  db.values.set(path, permit()); db.values.set('metricsQueryBudgetDays/2026-11-14', { bytes: 123, statements: 100 });
  const store = new LegacyRestoration(db.native(), id, source, () => now);
  const inScope = <T>(load: () => Promise<T>, key = 'a'.repeat(64) + ':/api/analytics/founder?day=2026-11-05') => withLegacyReportScope(key, load);
  const open = () => { const p = db.values.get(path); db.values.set(path, { ...p, phase: 'open', approvedPlanDigest: restorationPlanDigest(p.plans) }); };
  return { db, store, inScope, open, time: (value: number) => { now = value; } };
}

describe('finite initial restoration', () => {
  it('only records free plans, seals exact source/scope/SQL and reserves stable IDs once across midnight/restart', async () => {
    const f = fixture();
    const query = await f.inScope(() => f.store.prepare({ query: 'SELECT CURRENT_TIMESTAMP(), CURRENT_DATE()' }));
    expect(query.query).toContain("TIMESTAMP('2026-11-14T23:59:00.000Z')");
    await expect(f.inScope(() => f.store.admit(query, 1))).rejects.toThrow('no query was executed');
    expect(f.db.values.get(path).reservedJobs).toBe(0);
    f.open();
    const grant = (await f.inScope(() => f.store.admit(query, 1)))!;
    await expect(f.inScope(() => f.store.admit({ query: 'SELECT 2' }, 1))).rejects.toThrow('held');
    await expect(f.inScope(() => f.store.admit(query, 1), 'b'.repeat(64) + ':/api/analytics/founder?day=2026-11-05')).rejects.toThrow('held');
    await expect(f.inScope(() => f.store.admit({ ...query, params: { x: 1 } }, 1))).rejects.toThrow('held');
    await Promise.all(Array.from({ length: 8 }, () => f.store.reserve(grant)));
    f.time(start + 120_000);
    await new LegacyRestoration(f.db.native(), id, source, () => start + 120_000).reserve(grant);
    expect(f.db.values.get(path)).toMatchObject({ reservedJobs: 1, reservedBytes: grant.bytes });
    expect([...f.db.values.keys()].filter(key => key.includes('/reservations/'))).toHaveLength(1);
    expect(f.db.values.get('metricsQueryBudgetDays/2026-11-14')).toEqual({ bytes: 123, statements: 100 });
    expect(f.db.values.has('metricsQueryBudgetDays/2026-11-15')).toBe(false);
  });
  it('rejects expiry after admission and mutated sealed plans without altering counters', async () => {
    const f = fixture();
    await expect(f.inScope(() => f.store.admit({ query: 'SELECT 1' }, 1))).rejects.toThrow('recorded'); f.open();
    const grant = (await f.inScope(() => f.store.admit({ query: 'SELECT 1' }, 1)))!;
    f.time(start + 600_000);
    await expect(f.store.reserve(grant)).rejects.toThrow('held');
    expect(f.db.values.get(path).reservedJobs).toBe(0);
    f.time(start); f.db.values.get(path).plans[grant.planHash]++;
    await expect(f.store.reserve(grant)).rejects.toThrow('held');
  });
  it('enforces source, finite duration, cardinality, total reservation and native byte ceilings', async () => {
    const p = permit();
    for (const patch of [{ source: 'b'.repeat(40) }, { expiresAt: start + limits.windowMs + 1 },
      { maxBytes: limits.bytes + 1 }, { maxJobs: limits.jobs + 1 }, { reservedJobs: p.maxJobs + 1 },
      { reservedBytes: p.maxBytes + 1 }, { plans: { ['c'.repeat(64)]: limits.bytesPerJob + 1 } }]) {
      expect(() => validPermit({ ...p, ...patch }, source, start)).toThrow('held');
    }
    const f = fixture(); f.db.values.get(path).maxJobs = 1;
    await expect(f.inScope(() => f.store.admit({ query: 'SELECT 1' }, 1))).rejects.toThrow('recorded');
    await expect(f.inScope(() => f.store.admit({ query: 'SELECT 2' }, 1))).rejects.toThrow('held');
    f.open(); const grant = (await f.inScope(() => f.store.admit({ query: 'SELECT 1' }, 1)))!;
    f.db.values.get(path).reservedBytes = f.db.values.get(path).maxBytes;
    await expect(f.store.reserve(grant)).rejects.toThrow('held');
    expect(f.db.values.get(path).reservedJobs).toBe(0);
  });
  it('keeps immutable, bounded, dated aggregates available after the permit expires, without refreshing their timestamp', async () => {
    const f = fixture();
    expect(await f.store.publicationAsOf()).toBeNull();
    f.open();
    const value = { status: 200, body: { period: { startDate: '2026-11-05', endDate: '2026-11-05' },
      one: { available: true, partial: true, firstObservedAccounts: { current: null, previous: null } } } };
    await f.store.saveSnapshot('cohort-A:report', value, start);
    await f.store.saveSnapshot('cohort-A:report', { status: 200, body: { error: 'failed refresh' } }, start);
    f.db.values.get(path).phase = 'closed'; f.time(start + 700_000);
    expect(await f.store.isActive()).toBe(false);
    expect(await f.store.publicationAsOf()).toBe(new Date(start).toISOString());
    expect(await f.store.readSnapshot('cohort-A:report')).toEqual({ at: start, value });
    expect(await f.store.readSnapshot('cohort-B:report')).toBeNull();
    expect(f.db.values.get(path).reservedJobs).toBe(0);
    f.time(start + limits.snapshotMs + 1); expect(await f.store.readSnapshot('cohort-A:report')).toBeNull();
    expect(await f.store.publicationAsOf()).toBeNull();
  });
  it('binds recovery to a closed original and its remaining total allowance without changing its snapshots', async () => {
    const f = fixture(); f.open();
    const value = { status: 200, body: { result: 'original' } };
    await f.store.saveSnapshot('cohort-A:report', value, start);
    const old = f.db.values.get(path); old.phase = 'closed'; old.maxBytes = limits.bytes; old.reservedBytes = 60 * 1024 ** 3;
    const nextId = 'restore_fedcba0987654321', nextSource = 'b'.repeat(40), nextPath = `metricsRestorationPermits/${nextId}`;
    const next = { ...permit(), source: nextSource, maxBytes: 4 * 1024 ** 3, previousPermitId: id,
      previousSource: source, previousReservedBytes: old.reservedBytes };
    f.db.values.set(nextPath, next);
    f.db.values.set(`metricsRestorationRecoveryClaims/${id}`, { previousPermitId: id, previousSource: source,
      previousReservedBytes: old.reservedBytes, recoveryPermitId: nextId, recoverySource: nextSource,
      maxBytes: next.maxBytes, maxJobs: next.maxJobs, createdAt: next.createdAt, expiresAt: next.expiresAt });
    const recovery = new LegacyRestoration(f.db.native(), nextId, nextSource, () => start, { id, source });
    expect(await recovery.isPreparing()).toBe(true);
    expect(await f.store.readSnapshot('cohort-A:report')).toEqual({ at: start, value });
    next.maxBytes++;
    await expect(recovery.isPreparing()).rejects.toThrow('held');
    next.maxBytes--; old.phase = 'open';
    await expect(recovery.isPreparing()).rejects.toThrow('held');
    old.phase = 'closed'; old.reservedBytes--;
    await expect(recovery.isPreparing()).rejects.toThrow('held');
    old.reservedBytes++;
    const claim = f.db.values.get(`metricsRestorationRecoveryClaims/${id}`);
    claim.recoveryPermitId = 'restore_0000000000000000';
    await expect(recovery.isPreparing()).rejects.toThrow('held');
    claim.recoveryPermitId = nextId; old.previousPermitId = 'restore_0000000000000000';
    await expect(recovery.isPreparing()).rejects.toThrow('held');
  });
  it('records bounded dry-run observations without reserving or permitting execution', async () => {
    const f = fixture(); f.open(); const old = f.db.values.get(path); old.phase = 'closed';
    const nextId = 'restore_abcdefabcdefabcd', nextSource = 'c'.repeat(40), nextPath = `metricsRestorationPermits/${nextId}`;
    const next = { ...permit(), source: nextSource, previousPermitId: id, previousSource: source,
      previousReservedBytes: old.reservedBytes };
    f.db.values.set(nextPath, next);
    f.db.values.set(`metricsRestorationRecoveryClaims/${id}`, { previousPermitId: id, previousSource: source,
      previousReservedBytes: old.reservedBytes, recoveryPermitId: nextId, recoverySource: nextSource,
      maxBytes: next.maxBytes, maxJobs: next.maxJobs, createdAt: next.createdAt, expiresAt: next.expiresAt });
    const diagnostic = new LegacyRestoration(f.db.native(), nextId, nextSource, () => start, { id, source }, true);
    await expect(f.inScope(() => diagnostic.admit({ query: 'SELECT 1' }, 5 * 1024 ** 3))).rejects.toThrow('Diagnostic estimate recorded');
    const observations = Object.values(f.db.values.get(nextPath).observations) as Array<{ bytes: number; reports: string[] }>;
    expect(observations).toHaveLength(1); expect(observations[0].bytes).toBeGreaterThan(5 * 1024 ** 3);
    expect(observations[0].reports).toEqual(['/api/analytics/founder?day=2026-11-05']);
    expect(f.db.values.get(nextPath).observations[Object.keys(f.db.values.get(nextPath).observations)[0]].cohortScope).toBe('a'.repeat(64));
    expect(f.db.values.get(nextPath).reservedJobs).toBe(0); expect(f.db.values.get(nextPath).plans).toEqual({});
    await expect(diagnostic.reserve({ permitId: nextId, planHash: 'a'.repeat(64), id: 'anything', bytes: 1 })).rejects.toThrow('held');
    await expect(diagnostic.saveSnapshot('key', { status: 200, body: {} }, start)).rejects.toThrow('held');
    f.db.values.get(nextPath).phase = 'closed'; f.db.values.get(nextPath).approvedPlanDigest = restorationPlanDigest({});
    await expect(diagnostic.prepare({ query: 'SELECT 1' })).rejects.toThrow('held');
  });
  it('never freezes string literals, escaped identifiers or comments as SQL clock functions', () => {
    const sql = "SELECT CURRENT_DATE('UTC'), CURRENT_TIMESTAMP(), 'CURRENT_TIMESTAMP()', `CURRENT_DATE()` -- CURRENT_DATE()\n/* CURRENT_TIMESTAMP() */";
    expect(freezeRestorationSql(sql, new Date(start).toISOString())).toBe(
      "SELECT DATE(TIMESTAMP('2026-11-14T23:59:00.000Z'), 'UTC'), TIMESTAMP('2026-11-14T23:59:00.000Z'), 'CURRENT_TIMESTAMP()', `CURRENT_DATE()` -- CURRENT_DATE()\n/* CURRENT_TIMESTAMP() */");
  });
});
