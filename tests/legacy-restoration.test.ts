import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type { CustomerCohort } from '../src/server/one-customer-cohort';
import type { Firestore } from '@google-cloud/firestore';
import { LegacyRestoration, RESTORATION_LIMITS as limits, freezeRestorationSql,
  restorationPlanDigest, restorationReportDigest, restorationReuseDigest, validPermit, withLegacyReportScope, type RestorationPermit } from '../src/server/legacy-restoration';

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
  it('allows only a sealed report manifest within a finite cumulative expansion', async () => {
    const f = fixture(); f.open(); const original = f.db.values.get(path);
    original.phase = 'closed'; original.maxBytes = limits.bytes; original.reservedBytes = 60 * 1024 ** 3;
    const priorId = 'restore_aaaaaaaaaaaaaaaa', priorSource = 'b'.repeat(40), priorPath = `metricsRestorationPermits/${priorId}`;
    const prior = { ...permit(), phase: 'closed', source: priorSource, previousPermitId: id, previousSource: source,
      previousReservedBytes: original.reservedBytes, approvedPlanDigest: restorationPlanDigest({}) };
    f.db.values.set(priorPath, prior);
    f.db.values.set(`metricsRestorationRecoveryClaims/${id}`, { previousPermitId: id, previousSource: source,
      previousReservedBytes: original.reservedBytes, recoveryPermitId: priorId, recoverySource: priorSource,
      maxBytes: prior.maxBytes, maxJobs: prior.maxJobs, createdAt: prior.createdAt, expiresAt: prior.expiresAt });
    const nextId = 'restore_bbbbbbbbbbbbbbbb', nextSource = 'c'.repeat(40), nextPath = `metricsRestorationPermits/${nextId}`;
    const fixedReports = ['/api/analytics/founder?day=2026-11-05'];
    const digest = (v: string) => createHash('sha256').update(v).digest('hex');
    const query = 'SELECT 7', cohortScope = 'a'.repeat(64);
    const oldHash = digest(JSON.stringify({ schema: 1, source, cohortScope, project: 'hushh-ai-prod', location: 'US', asOf: original.asOf, query }));
    const reuseKey = digest(JSON.stringify([digest(query), cohortScope]));
    original.plans = { [oldHash]: 20 * 1024 ** 2 }; original.approvedPlanDigest = restorationPlanDigest(original.plans);
    original.reservedJobs = 1;
    f.db.values.set(`${path}/reservations/${oldHash}`, { bytes: original.plans[oldHash], jobId: `metrics_${id}_${oldHash}` });
    const next = { ...permit(), source: nextSource, maxBytes: 80 * 1024 ** 3, maxJobs: 200,
      previousPermitId: id, previousSource: source, previousReservedBytes: original.reservedBytes,
      abandonedPermitId: priorId, abandonedSource: priorSource, maxTotalBytes: 140 * 1024 ** 3,
      maxPerJobBytes: 32 * 1024 ** 3, fixedReports, approvedReportDigest: restorationReportDigest(fixedReports), reusePlans: { [reuseKey]: oldHash }, approvedReuseDigest: restorationReuseDigest({ [reuseKey]: oldHash }) };
    f.db.values.set(nextPath, next);
    const claim = { previousPermitId: id, previousSource: source, previousReservedBytes: original.reservedBytes,
      abandonedPermitId: priorId, abandonedSource: priorSource, recoveryPermitId: nextId, recoverySource: nextSource,
      maxBytes: next.maxBytes, maxJobs: next.maxJobs, maxTotalBytes: next.maxTotalBytes, maxPerJobBytes: next.maxPerJobBytes,
      approvedReportDigest: next.approvedReportDigest, approvedReuseDigest: next.approvedReuseDigest, createdAt: next.createdAt, expiresAt: next.expiresAt };
    f.db.values.set(`metricsRestorationExpansionClaims/${id}`, claim);
    const expanded = new LegacyRestoration(f.db.native(), nextId, nextSource, () => start, { id, source }, false, { id: priorId, source: priorSource });
    await expect(f.inScope(() => expanded.admit({ query: 'SELECT 1' }, 1))).rejects.toThrow('recorded');
    const planned = f.db.values.get(nextPath); planned.phase = 'open'; planned.approvedPlanDigest = restorationPlanDigest(planned.plans);
    planned.approvedBytes = planned.maxBytes; planned.approvedJobs = planned.maxJobs;
    f.db.values.set(`metricsRestorationExecutionApprovals/${nextId}`, { source: nextSource, approvedPlanDigest: planned.approvedPlanDigest,
      approvedReportDigest: planned.approvedReportDigest, approvedReuseDigest: planned.approvedReuseDigest,
      approvedBytes: planned.approvedBytes, approvedJobs: planned.approvedJobs, createdAt: planned.createdAt, expiresAt: planned.expiresAt });
    const grant = (await f.inScope(() => expanded.admit({ query: 'SELECT 2' }, 1)))!;
    await Promise.all(Array.from({ length: 4 }, () => expanded.reserve(grant)));
    expect(f.db.values.get(nextPath).reservedJobs).toBe(1);
    const reused = (await f.inScope(() => expanded.admit({ query }, 1)))!;
    expect(reused.reuse?.priorPlanHash).toBe(oldHash); await expanded.reserve(reused);
    expect(f.db.values.get(nextPath).reservedJobs).toBe(1);
    expect(f.db.values.get(path).reservedBytes).toBe(original.reservedBytes);
    await expect(f.inScope(() => expanded.admit({ query: 'SELECT 3' }, 1), 'a'.repeat(64) + ':/api/analytics/founder?day=other')).rejects.toThrow('held');
    await expect(expanded.reserve({ ...grant, bytes: -1 })).rejects.toThrow('held');
    const approval = f.db.values.get(`metricsRestorationExecutionApprovals/${nextId}`);
    approval.approvedBytes++; await expect(expanded.isActive()).rejects.toThrow('held'); approval.approvedBytes--;
    const reserved = f.db.values.get(nextPath); reserved.approvedBytes = reserved.reservedBytes;
    approval.approvedBytes = reserved.approvedBytes;
    const extra = (await f.inScope(() => expanded.admit({ query: 'SELECT 8' }, 1)))!;
    await expect(expanded.reserve(extra)).rejects.toThrow('held');
    expect(f.db.values.get(nextPath).reservedJobs).toBe(1);
    claim.maxTotalBytes++;
    await expect(expanded.isActive()).rejects.toThrow('held');
    claim.maxTotalBytes--; prior.reservedJobs = 1;
    await expect(expanded.isActive()).rejects.toThrow('held');
  });
  it('indexes only witnessed snapshots and preserves them only for later eligible additions', async () => {
    const f = fixture(); f.open();
    const revision = 'c'.repeat(64), cutoff = '2026-11-14T12:00:00.000Z';
    const make = (rows: CustomerCohort['rows'], asOf = cutoff): CustomerCohort => ({ policyRevision: revision, asOf,
      expiresAt: Date.now() + 60_000, rows, cacheKey: createHash('sha256').update(JSON.stringify([revision, rows])).digest('hex') });
    const original = make([{ analyticsUserId: '1'.repeat(32), registeredAt: '2026-10-01T00:00:00.000Z' }]);
    const reportUrl = '/api/analytics/founder?day=2026-11-05', key = `${original.cacheKey}:${reportUrl}`;
    const value = { status: 200, body: { marker: 'dated aggregate' } };
    await f.store.saveSnapshot(key, value, start, { reportUrl, cohort: original });
    f.db.values.get(path).phase = 'closed'; f.time(start + 700_000);
    const addition = { analyticsUserId: '2'.repeat(32), registeredAt: '2026-11-14T12:01:00.000Z' };
    const later = make([...original.rows, addition], '2026-11-14T12:05:00.000Z');
    expect(await f.store.readCompatibleSnapshot(reportUrl, later)).toEqual({ at: start, value, cohortAsOf: cutoff });
    expect(await f.store.readCompatibleSnapshot(reportUrl, make([], '2026-11-14T12:05:00.000Z'))).toBeNull();
    expect(await f.store.readCompatibleSnapshot('/api/analytics/founder?day=other', later)).toBeNull();
    const snapshot = [...f.db.values.entries()].find(([key]) => key.includes('/snapshots/'))![1];
    expect(Object.keys(snapshot.witness).sort()).toEqual(['asOf', 'policyRevision', 'rowsHash']);
    expect(JSON.stringify(snapshot.witness)).not.toContain('1'.repeat(32));
  });
  it('never freezes string literals, escaped identifiers or comments as SQL clock functions', () => {
    const sql = "SELECT CURRENT_DATE('UTC'), CURRENT_TIMESTAMP(), 'CURRENT_TIMESTAMP()', `CURRENT_DATE()` -- CURRENT_DATE()\n/* CURRENT_TIMESTAMP() */";
    expect(freezeRestorationSql(sql, new Date(start).toISOString())).toBe(
      "SELECT DATE(TIMESTAMP('2026-11-14T23:59:00.000Z'), 'UTC'), TIMESTAMP('2026-11-14T23:59:00.000Z'), 'CURRENT_TIMESTAMP()', `CURRENT_DATE()` -- CURRENT_DATE()\n/* CURRENT_TIMESTAMP() */");
  });
});
