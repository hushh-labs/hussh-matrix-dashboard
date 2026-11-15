import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import * as cohorts from '../src/server/one-customer-cohort';
import type { Firestore } from '@google-cloud/firestore';
import { DailyOneRefresh, dailyOneManifest, dailyOnePolicyGeneration, dailyPartialDigest, DAILY_ONE_LIMITS, withDailyOneRefresh, currentDailyOneRefresh, validOnePayload } from '../src/server/daily-one-refresh';
import { DailyOneComposer } from '../src/server/daily-one-composer';
import { DailyOneMeasurement, withDailyOneMeasurement } from '../src/server/daily-one-measurement';
import { currentClosedComposition, restorationReportDigest, withClosedComposition, withLegacyReportScope } from '../src/server/legacy-restoration';
import { verifyDailyOneCohortPreflight } from '../src/server/daily-one-cohort-preflight';
import { DailyClosedDiagnostic } from '../src/server/daily-closed-diagnostic';
class Database {
 values = new Map<string, any>(); private tail = Promise.resolve();
 doc(path: string): any { return { get: async () => this.snapshot(path), collection: (name: string) => ({ doc: (id: string) => this.doc(`${path}/${name}/${id}`), get: async () => { const prefix = `${path}/${name}/`; const docs = [...this.values.keys()].filter(key => key.startsWith(prefix) && !key.slice(prefix.length).includes('/')).map(key => this.snapshot(key)); return { docs, size: docs.length }; } }), path }; }
 snapshot(path: string) { return { exists: this.values.has(path), data: () => this.values.get(path) }; }
 async runTransaction<T>(run: (tx: any) => Promise<T>) { const prior = this.tail; let unlock!: () => void; this.tail = new Promise<void>(r => { unlock = r; }); await prior;
  const writes = new Map<string, any>(); try { const result = await run({ get: async (ref: any) => this.snapshot(ref.path), update: (ref: any, value: any) => writes.set(ref.path, { ...(writes.get(ref.path) ?? this.values.get(ref.path)), ...value }), create: (ref: any, value: any) => { if (this.values.has(ref.path)) throw new Error('exists'); writes.set(ref.path, value); } }); for (const [key,value] of writes) this.values.set(key,value); return result; } finally { unlock(); } }
 native() { return this as unknown as Pick<Firestore, 'doc' | 'runTransaction'>; }
}
function payloadFor(report: string, count = 1) {
 const url = new URL(report, 'http://internal'), environment = url.searchParams.get('environment')!, startDate = url.searchParams.get('one_start_date')!, endDate = url.searchParams.get('one_end_date')!;
 const one = { reportingEnvironment: environment, reportingScopeVersion: 'one-environment-v1', range: { startDate, endDate, days: (Date.parse(endDate) - Date.parse(startDate)) / 86_400_000 + 1 }, activeUsers: { countingUnit: 'device' }, identifiedUsers: { countingUnit: 'account', selectedRange: { startDate, endDate } }, count };
 return { status: 200, body: { one: { error: null, data: { production: environment === 'production' ? one : null, uat: environment === 'uat' ? one : null } } } };
}
const day = '2026-11-15', asOf = '2026-11-14T23:59:59.999Z', start = Date.parse('2026-11-15T07:00:00Z'), source = 'a'.repeat(40), id = 'refresh_20261115_1111111111111111', unit = 1024 ** 2;
function fixture() {
 const db = new Database(); let now = start; const reports = dailyOneManifest('2026-11-14'), reportDigest = restorationReportDigest(reports);
 const sha = (value: string) => createHash('sha256').update(value).digest('hex');
 const measurementScopes = Object.fromEntries(reports.map((report, index) => [sha(report), sha(`${index < 5 ? 'b'.repeat(64) : ''}:${report}`)]));
 const scopeDigest = sha(JSON.stringify(Object.entries(measurementScopes).sort(([a], [b]) => a.localeCompare(b))));
 const policy = { approved: true, source, maxDailyBytes: 200 * unit, maxDailyJobs: 5, maxPerJobBytes: 100 * unit }; const generation = dailyOnePolicyGeneration(source, policy.maxDailyBytes, policy.maxDailyJobs, policy.maxPerJobBytes);
 const run = { source, policyGeneration: generation, day, logicalAsOf: asOf, phase: 'open', createdAt: start, expiresAt: start + 3600_000, reports, reportDigest, measurementId: 'dailymeasure_20261115_3333333333333333', measurementSource: source, measurementDigest: 'f'.repeat(64), measurementScopes, scopeDigest, maxBytes: 150 * unit, maxJobs: 4, maxPerJobBytes: 100 * unit, reservedBytes: 0, reservedJobs: 0 };
 db.values.set(`metricsOneDailyRuns/${id}`, run); db.values.set(`metricsOneDailyPolicies/${generation}`, { ...policy, generation });
 db.values.set(`metricsOneDailyApprovals/${id}`, { ...run, runId: id, approved: true }); db.values.set(`metricsOneDailySlots/${day}`, { day, runId: id, source, policyGeneration: generation, state: 'sealed' });
 db.values.set(`metricsOneDailyMeasurements/${id}`, { phase: 'sealed', runId: id, source, day, logicalAsOf: asOf, reportDigest, digest: run.measurementDigest, coverage: 'not exhaustive', sealedAt: start, measuredBytes: 80 * unit, measuredQueries: 3 });
 db.values.set(`metricsOneDailyMeasurements/${run.measurementId}`, { phase: 'closed', source, targetRunId: id, day, logicalAsOf: asOf, reportDigest, expiresAt: start + 3600_000 });
 db.values.set(`metricsOneDailyBudgets/${day}`, { day, policyGeneration: generation, reservedBytes: 0, reservedJobs: 0 });
 const store = new DailyOneRefresh(db.native(), id, source, () => now), scope = <T>(fn: () => Promise<T>) => withLegacyReportScope(`${'b'.repeat(64)}:${reports[0]}`, fn);
 return { db, run, policy, generation, reports, store, scope, time: (value: number) => { now = value; } };
}
async function continuationFixture(index = 1, cacheKey = 'b'.repeat(64)) {
 const f = fixture(), sha = (s: string) => createHash('sha256').update(s).digest('hex');
 if (cacheKey !== 'b'.repeat(64)) {
  for (const report of f.reports.slice(0, 5)) f.run.measurementScopes[sha(report)] = sha(`${cacheKey}:${report}`);
  f.run.scopeDigest = sha(JSON.stringify(Object.entries(f.run.measurementScopes).sort(([a], [b]) => a.localeCompare(b))));
  f.db.values.get(`metricsOneDailyApprovals/${id}`).scopeDigest = f.run.scopeDigest;
 }
 const scope = <T>(fn: () => Promise<T>) => withLegacyReportScope(`${index < 5 ? cacheKey : ''}:${f.reports[index]}`, fn);
 const parentScope = <T>(fn: () => Promise<T>) => withLegacyReportScope(`${cacheKey}:${f.reports[0]}`, fn);
 const query = { query: 'SELECT 1' }, prior = await parentScope(() => f.store.admit(query, 1));
 await parentScope(() => f.store.reserve(prior)); await parentScope(() => f.store.claimSubmission(prior));
 const parent = f.db.values.get(`metricsOneDailyRuns/${id}`); parent.phase = 'closed'; f.time(start + 1000);
 const childId = 'refresh_20261115_2222222222222222', childSource = 'e'.repeat(40), measurementId = 'dailymeasure_20261115_5555555555555555';
 const child = { ...parent, source: childSource, phase: 'open', createdAt: start + 1000, expiresAt: start + 3600_000,
  measurementId, measurementSource: childSource, measurementDigest: '9'.repeat(64), maxBytes: 150 * unit, maxJobs: 4,
  reservedBytes: 0, reservedJobs: 0, parentId: id, parentSource: source, parentReservedBytes: parent.reservedBytes,
  parentReservedJobs: parent.reservedJobs, parentCreatedAt: parent.createdAt, newReportsDigest: restorationReportDigest(f.reports.slice(1)),
  composerId: 'dailycomposer_4444444444444444', composerSource: childSource };
 f.db.values.set(`metricsOneDailyRuns/${childId}`, child); f.db.values.set(`metricsOneDailyApprovals/${childId}`, { ...child, runId: childId, approved: true });
 f.db.values.set(`metricsOneDailyContinuationClaims/${id}`, { ...child, runId: childId, approved: true });
 f.db.values.set(`metricsOneDailyMeasurements/${childId}`, { phase: 'sealed', runId: childId, source: childSource, day, logicalAsOf: asOf,
  reportDigest: child.reportDigest, digest: child.measurementDigest, coverage: 'not exhaustive', sealedAt: start + 1000, measuredBytes: 80 * unit, measuredQueries: 3 });
 f.db.values.set(`metricsOneDailyMeasurements/${measurementId}`, { phase: 'closed', source: childSource, targetRunId: childId, day, logicalAsOf: asOf,
  reportDigest: child.reportDigest, expiresAt: start + 3600_000 });
 const composerPath = `metricsOneDailyComposers/${child.composerId}`, report = f.reports[0], reportHash = createHash('sha256').update(report).digest('hex');
 f.db.values.set(composerPath, { phase: 'closed', source: childSource, parentId: id, parentSource: source, childId, logicalAsOf: asOf,
  report, reportDigest: child.reportDigest, scopeDigest: child.scopeDigest, createdAt: start, expiresAt: start + 3600_000 });
 f.db.values.set(`${composerPath}/snapshots/${reportHash}`, { state: 'verified', source: childSource, parentId: id, parentSource: source, childId,
  logicalAsOf: asOf, reportHash, computedAt: start + 500, json: JSON.stringify(payloadFor(report)), nonWarehouseFreshness: 'unknown', jobs: [{ id: prior.id, endedAt: start + 500 }],
  witness: { policyRevision: 'c'.repeat(64), rowsHash: cacheKey, asOf } });
 let childNow = start + 1000; const store = new DailyOneRefresh(f.db.native(), childId, childSource, () => childNow);
 return { ...f, time: (value: number) => { f.time(value); childNow = value; }, scope, parent, child, childId, childSource, store, prior, query };
}
async function secondRecoveryFixture(cacheKey = 'b'.repeat(64)) {
 const f = await continuationFixture(1, cacheKey), query = { query: 'SELECT 2' };
 const prior = await f.scope(() => f.store.admit(query, 1)); await f.scope(() => f.store.reserve(prior)); await f.scope(() => f.store.claimSubmission(prior));
 const parent = f.db.values.get(`metricsOneDailyRuns/${f.childId}`); parent.phase = 'closed'; f.time(start + 2000);
 const id2 = 'refresh_20261115_7777777777777777', source2 = 'f'.repeat(40), measurementId = 'dailymeasure_20261115_8888888888888888';
 const priorBytes = parent.parentReservedBytes + parent.reservedBytes, priorJobs = parent.parentReservedJobs + parent.reservedJobs;
 const run = { ...parent, source: source2, phase: 'open', createdAt: start + 2000, expiresAt: start + 3600_000,
  measurementId, measurementSource: source2, measurementDigest: '8'.repeat(64), maxBytes: f.policy.maxDailyBytes - priorBytes, maxJobs: f.policy.maxDailyJobs - priorJobs,
  reservedBytes: 0, reservedJobs: 0, parentId: f.childId, parentSource: f.childSource, parentDepth: 2 as const,
  parentReservedBytes: priorBytes, parentReservedJobs: priorJobs, parentOwnReservedBytes: parent.reservedBytes, parentOwnReservedJobs: parent.reservedJobs,
  parentCreatedAt: parent.createdAt, newReportsDigest: restorationReportDigest(f.reports.slice(2)), composerId: 'dailycomposer_7777777777777777', composerSource: source2 };
 f.db.values.set(`metricsOneDailyRuns/${id2}`, run); f.db.values.set(`metricsOneDailyApprovals/${id2}`, { ...run, runId: id2, approved: true });
 f.db.values.set(`metricsOneDailyContinuationClaims/${f.childId}`, { ...run, runId: id2, approved: true });
 f.db.values.set(`metricsOneDailyMeasurements/${id2}`, { phase: 'sealed', runId: id2, source: source2, day, logicalAsOf: asOf, reportDigest: run.reportDigest,
  digest: run.measurementDigest, coverage: 'not exhaustive', sealedAt: start + 2000, measuredBytes: 80 * unit, measuredQueries: 4 });
 f.db.values.set(`metricsOneDailyMeasurements/${measurementId}`, { phase: 'closed', source: source2, targetRunId: id2, day, logicalAsOf: asOf,
  reportDigest: run.reportDigest, expiresAt: start + 3600_000 });
 const report = f.reports[1], reportHash = createHash('sha256').update(report).digest('hex'), composerPath = `metricsOneDailyComposers/${run.composerId}`;
 f.db.values.set(composerPath, { phase: 'closed', source: source2, parentId: f.childId, parentSource: f.childSource, childId: id2,
  logicalAsOf: asOf, report, reportDigest: run.reportDigest, scopeDigest: run.scopeDigest, createdAt: start + 1000, expiresAt: start + 3600_000 });
 f.db.values.set(`${composerPath}/snapshots/${reportHash}`, { state: 'verified', source: source2, parentId: f.childId, parentSource: f.childSource, childId: id2,
  logicalAsOf: asOf, reportHash, computedAt: start + 1500, json: JSON.stringify(payloadFor(report)), nonWarehouseFreshness: 'unknown',
  jobs: [{ id: prior.id, endedAt: start + 1500 }], witness: { policyRevision: 'c'.repeat(64), rowsHash: cacheKey, asOf } });
 const store = new DailyOneRefresh(f.db.native(), id2, source2, () => start + 2000);
 const scope = <T>(fn: () => Promise<T>) => withLegacyReportScope(`${cacheKey}:${f.reports[2]}`, fn);
 return { ...f, id2, source2, run2: run, parent2: parent, store, scope, prior2: prior };
}
async function finalRecoveryFixture() {
 const policyRevision = 'c'.repeat(64), rows = [{ analyticsUserId: 'd'.repeat(32), registeredAt: '2026-11-01T00:00:00.000Z' }];
 const cacheKey = createHash('sha256').update(JSON.stringify([policyRevision, rows])).digest('hex');
 const cohort = { policyRevision, rows, cacheKey, asOf, expiresAt: start + 600_000 }, f = await secondRecoveryFixture(cacheKey);
 const sha = (value: string) => createHash('sha256').update(value).digest('hex');
 const parentScope = <T>(fn: () => Promise<T>) => withLegacyReportScope(`${cacheKey}:${f.reports[4]}`, fn);
 const query = { query: 'SELECT 90' }, prior = await parentScope(() => f.store.admit(query, 1));
 await parentScope(() => f.store.reserve(prior)); await parentScope(() => f.store.claimSubmission(prior));
 const closedParent = f.db.values.get(`metricsOneDailyRuns/${f.id2}`); closedParent.phase = 'closed';
 const witness = cohorts.cohortSnapshotWitness(cohort)!;
 for (const [index, report] of f.reports.slice(2, 4).entries()) {
  f.db.values.set(`metricsOneDailyRuns/${f.id2}/snapshots/${sha(report)}`, { schema: 1, state: 'verified', source: f.source2, runId: f.id2,
   reportHash: sha(report), dataAsOf: asOf, scopeDigest: closedParent.scopeDigest, measurementId: closedParent.measurementId,
   measurementSource: closedParent.measurementSource, measurementDigest: closedParent.measurementDigest, parentId: closedParent.parentId,
   parentSource: closedParent.parentSource, sourceCoverage: 'intraday-or-unknown', nonWarehouseFreshness: 'unknown',
   computedAt: start + 2000, witness, json: JSON.stringify(payloadFor(report)), jobs: [{ id: `metrics_${f.id2}_${String(index).padStart(64, '0')}`, endedAt: start + 2000 }] });
 }
 const partial = { state: 'active', source: f.source2, runId: f.id2, reportDigest: f.run2.reportDigest, logicalAsOf: asOf, witness, reports: f.reports.slice(0, 4).map(sha) };
 f.db.values.set(`metricsOneDailyRuns/${f.id2}/activation/partial`, partial);
 const id3 = 'refresh_20261115_9999999999999999', source3 = 'e'.repeat(40), measurementId = 'dailymeasure_20261115_aaaaaaaaaaaaaaaa';
 const parentBytes = closedParent.parentReservedBytes + closedParent.reservedBytes, parentJobs = closedParent.parentReservedJobs + closedParent.reservedJobs;
 const run: any = { ...closedParent, source: source3, phase: 'open', createdAt: start + 3000, expiresAt: start + 3600_000,
  measurementId, measurementSource: source3, measurementDigest: '7'.repeat(64), maxBytes: f.policy.maxDailyBytes - parentBytes, maxJobs: f.policy.maxDailyJobs - parentJobs,
  reservedBytes: 0, reservedJobs: 0, parentId: f.id2, parentSource: f.source2, parentDepth: 3,
  parentReservedBytes: parentBytes, parentReservedJobs: parentJobs, parentOwnReservedBytes: closedParent.reservedBytes, parentOwnReservedJobs: closedParent.reservedJobs,
  parentCreatedAt: closedParent.createdAt, parentPartialDigest: dailyPartialDigest(partial), newReportsDigest: restorationReportDigest(f.reports.slice(4)) };
 delete run.composerId; delete run.composerSource;
 f.db.values.set(`metricsOneDailyRuns/${id3}`, run); f.db.values.set(`metricsOneDailyApprovals/${id3}`, { ...run, runId: id3, approved: true });
 f.db.values.set(`metricsOneDailyContinuationClaims/${f.id2}`, { ...run, runId: id3, approved: true });
 f.db.values.set(`metricsOneDailyMeasurements/${id3}`, { phase: 'sealed', runId: id3, source: source3, day, logicalAsOf: asOf, reportDigest: run.reportDigest,
  digest: run.measurementDigest, coverage: 'not exhaustive', sealedAt: start + 3000, measuredBytes: 80 * unit, measuredQueries: 4 });
 f.db.values.set(`metricsOneDailyMeasurements/${measurementId}`, { phase: 'closed', source: source3, targetRunId: id3, day, logicalAsOf: asOf, reportDigest: run.reportDigest, expiresAt: start + 3600_000 });
 let finalNow = start + 3000; const store = new DailyOneRefresh(f.db.native(), id3, source3, () => finalNow);
 const scope = <T>(fn: () => Promise<T>) => withLegacyReportScope(`${cacheKey}:${f.reports[4]}`, fn);
 return { ...f, cohort, cacheKey, id3, source3, run3: run, partial, prior3: prior, query3: query, store, scope, time3: (value: number) => { finalNow = value; } };
}
describe('private no-query cohort preflight', () => {
 it('checks the sealed report scopes twice and fails closed on changed membership, missing evidence and expiry', async () => {
  const f = fixture(), sha = (s: string) => createHash('sha256').update(s).digest('hex');
  const preflight = 'preflight_20261115_4444444444444444', measurement = f.run.measurementId;
  const samples = Object.fromEntries(f.reports.map((report, i) => [sha(report), sha(`sample-${i}`)]));
  const doc = { phase: 'open', source, day, createdAt: start, expiresAt: start + 1000, runId: id, measurementId: measurement,
   measurementSource: source, measurementDigest: f.run.measurementDigest, logicalAsOf: asOf, reportDigest: f.run.reportDigest,
   scopes: f.run.measurementScopes, scopeDigest: f.run.scopeDigest, samples };
  f.db.values.set(`metricsOneDailyPreflights/${preflight}`, doc);
  Object.assign(f.db.values.get(`metricsOneDailyMeasurements/${measurement}`), { attempted: 10 });
  Object.assign(f.db.values.get(`metricsOneDailyMeasurements/${id}`), { measuredQueries: 10 });
  for (const report of f.reports) { const key = sha(report), planHash = samples[key]; f.db.values.set(`metricsOneDailyMeasurements/${measurement}/attempts/${planHash}`, { state: 'measured', planHash, reportHash: key, scopeHash: doc.scopes[key] }); }
  const cohort = { policyRevision: 'a'.repeat(64), asOf, expiresAt: Date.now() + 60000, cacheKey: 'b'.repeat(64), rows: [] };
  const verify = (load = async () => cohort, now = () => start) => verifyDailyOneCohortPreflight(f.db.native(), preflight, source, load, now);
  expect(await verify()).toBe(true);
  let calls = 0; await expect(verify(async () => ({ ...cohort, cacheKey: ++calls === 1 ? cohort.cacheKey : 'c'.repeat(64) }))).rejects.toThrow();
  await expect(verify(async () => ({ ...cohort, cacheKey: 'c'.repeat(64) }))).resolves.toBe(false);
  await expect(verify(undefined, () => start + 1000)).rejects.toThrow();
  f.db.values.delete(`metricsOneDailyMeasurements/${measurement}/attempts/${Object.values(samples)[0]}`);
  await expect(verify()).rejects.toThrow();
 });
});
describe('finite daily One refresh admission', () => {
 it('serializes local reservations and stops an aborted waiter before its transaction', async () => {
  const f = fixture(), first = await f.scope(() => f.store.admit({ query: 'SELECT 11' }, 1)), second = await f.scope(() => f.store.admit({ query: 'SELECT 12' }, 1));
  const original = f.db.runTransaction.bind(f.db); let release!: () => void, entered!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  let transactions = 0;
  vi.spyOn(f.db, 'runTransaction').mockImplementation(async run => { transactions++; if (transactions === 1) { entered(); await barrier; } return original(run); });
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {}), controller = new AbortController();
  try {
   const one = f.scope(() => withDailyOneRefresh(f.store, f.reports[0], () => f.store.reserve(first)));
   await started;
   const two = f.scope(() => withDailyOneRefresh(f.store, f.reports[0], () => f.store.reserve(second), controller.signal));
   const rejected = expect(two).rejects.toThrow(); controller.abort(); expect(transactions).toBe(1); release(); await one; await rejected;
   expect(transactions).toBe(1); expect(f.db.values.get(`metricsOneDailyBudgets/${day}`).reservedJobs).toBe(1);
   expect(warning).toHaveBeenCalledWith('Daily reservation held:', 'window');
  } finally { release(); vi.restoreAllMocks(); }
 });
 it('releases the local reservation queue after failure and logs only a fixed category', async () => {
  const f = fixture(), grant = await f.scope(() => f.store.admit({ query: 'SELECT 13' }, 1));
  const original = f.db.runTransaction.bind(f.db), warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(f.db, 'runTransaction').mockRejectedValueOnce(Object.assign(new Error('private provider detail'), { code: 10 })).mockImplementation(run => original(run));
  try {
   await expect(f.scope(() => withDailyOneRefresh(f.store, f.reports[0], () => f.store.reserve(grant)))).rejects.toThrow();
   await expect(f.scope(() => withDailyOneRefresh(f.store, f.reports[0], () => f.store.reserve(grant)))).resolves.toBeUndefined();
   expect(warning).toHaveBeenCalledWith('Daily reservation held:', 'contention');
   expect(JSON.stringify(warning.mock.calls)).not.toContain('private provider detail');
  } finally { vi.restoreAllMocks(); }
 });
 it('reuses only exact closed parent reservations without increasing the shared budget', async () => {
  vi.useFakeTimers(); vi.setSystemTime(start + 3000);
  try {
   const f = await finalRecoveryFixture(), before = { ...f.db.values.get(`metricsOneDailyBudgets/${day}`) };
   await f.scope(() => withDailyOneRefresh(f.store, f.reports[4], async () => {
    const prior = await f.store.existing(f.query3); expect(prior?.id).toBe(f.prior3.id); expect(prior?.reuse?.priorPermitId).toBe(f.id2);
    await f.store.reserve(prior!); expect(await f.store.claimSubmission(prior!)).toBe(false);
    expect(f.db.values.get(`metricsOneDailyBudgets/${day}`)).toEqual(before);
    expect(await f.store.existing({ query: 'SELECT missing' })).toBeUndefined();
    const row = f.db.values.get(`metricsOneDailyRuns/${f.id2}/reservations/${f.prior3.planHash}`); row.jobId = 'wrong';
    await expect(f.store.existing(f.query3)).rejects.toThrow(); row.jobId = f.prior3.id;
    row.state = 'reserved'; await expect(f.store.existing(f.query3)).rejects.toThrow();
    row.state = 'started'; row.startedAt = start; await expect(f.store.reserve(prior!)).rejects.toThrow();
   }, undefined, undefined, f.cohort));
  } finally { vi.restoreAllMocks(); vi.useRealTimers(); }
 });
 it('fences final recovery on the parent partial witness, manifest and cumulative ledger', async () => {
  vi.useFakeTimers(); vi.setSystemTime(start + 3000);
  try {
   const f = await finalRecoveryFixture();
   await expect(f.store.requireOpen(f.reports[3])).rejects.toThrow(); await expect(f.store.requireOpen(f.reports[4])).resolves.toBeDefined();
   const changed = { ...f.cohort, rows: [], cacheKey: '0'.repeat(64) };
   await expect(f.store.verifyMeasuredCohort(changed)).rejects.toThrow();
   f.partial.reports.pop(); await expect(f.store.requireOpen(f.reports[4])).rejects.toThrow(); f.partial.reports.push(createHash('sha256').update(f.reports[3]).digest('hex'));
   const parentSnapshot = f.db.values.get(`metricsOneDailyRuns/${f.id2}/snapshots/${createHash('sha256').update(f.reports[2]).digest('hex')}`);
   const original = parentSnapshot.json; parentSnapshot.json = '{}'; await expect(f.store.requireOpen(f.reports[4])).rejects.toThrow(); parentSnapshot.json = original;
   const budget = f.db.values.get(`metricsOneDailyBudgets/${day}`); budget.reservedJobs--;
   await f.scope(() => withDailyOneRefresh(f.store, f.reports[4], async () => {
    const grant = await f.store.existing(f.query3); await expect(f.store.reserve(grant!)).rejects.toThrow();
   }, undefined, undefined, f.cohort));
  } finally { vi.restoreAllMocks(); vi.useRealTimers(); }
 });
 it('stages mixed verified job origins and rejects a changed prior reservation on read', async () => {
  vi.useFakeTimers(); vi.setSystemTime(start + 3000);
  try {
   const f = await finalRecoveryFixture(); vi.spyOn(cohorts, 'requireCurrentCustomerCohort').mockResolvedValue(f.cohort);
   await f.scope(() => withDailyOneRefresh(f.store, f.reports[4], async () => {
    const prior = await f.store.existing(f.query3); await f.store.reserve(prior!); expect(await f.store.claimSubmission(prior!)).toBe(false);
    const fresh = await f.store.admit({ query: 'SELECT missing' }, 1); await f.store.reserve(fresh); expect(await f.store.claimSubmission(fresh)).toBe(true);
    const jobs = [{ id: prior!.id, endedAt: start + 2500, bytes: prior!.bytes }, { id: fresh.id, endedAt: start + 3000, bytes: fresh.bytes }];
    for (const job of jobs) { currentDailyOneRefresh()!.jobs.set(job.id, job.endedAt); currentDailyOneRefresh()!.bounds.set(job.id, job.bytes); }
    await expect(f.store.save(f.reports[4], payloadFor(f.reports[4]), [{ ...jobs[0], bytes: jobs[0].bytes + 1 }, jobs[1]], f.cohort)).rejects.toThrow();
    await expect(f.store.save(f.reports[4], payloadFor(f.reports[4]), jobs, f.cohort)).resolves.toBe(start + 3000);
   }, undefined, undefined, f.cohort));
   f.db.values.get(`metricsOneDailyRuns/${f.id3}`).phase = 'closed';
   f.db.values.set(`metricsOneDailyRuns/${f.id3}/activation/current`, { state: 'active', source: f.source3, runId: f.id3, reportDigest: f.run3.reportDigest, logicalAsOf: asOf, witness: cohorts.cohortSnapshotWitness(f.cohort) });
   expect(await f.store.read(f.reports[4], f.cohort)).not.toBeNull();
   const snap = f.db.values.get(`metricsOneDailyRuns/${f.id3}/snapshots/${createHash('sha256').update(f.reports[4]).digest('hex')}`);
   const parentRow = f.db.values.get(`metricsOneDailyRuns/${f.id2}/reservations/${f.prior3.planHash}`), childRow = f.db.values.get(`metricsOneDailyRuns/${f.id3}/reservations/${snap.jobs[1].id.slice(-64)}`);
   const parentStart = parentRow.startedAt, childStart = childRow.startedAt, parentEnd = snap.jobs[0].endedAt, childEnd = snap.jobs[1].endedAt, computedAt = snap.computedAt;
   const later = start + 3600_000 + 2000, freshCohort = { ...f.cohort, expiresAt: later + 60_000 }; f.time3(later); vi.setSystemTime(later);
   expect(await f.store.read(f.reports[4], freshCohort)).not.toBeNull();
   parentRow.startedAt = start + 3600_000; snap.jobs[0].endedAt = parentRow.startedAt + 1; snap.computedAt = later;
   expect(await f.store.read(f.reports[4], freshCohort)).toBeNull();
   parentRow.startedAt = parentStart; snap.jobs[0].endedAt = parentEnd;
   childRow.startedAt = start + 3600_000; snap.jobs[1].endedAt = childRow.startedAt + 1;
   expect(await f.store.read(f.reports[4], freshCohort)).toBeNull();
   childRow.startedAt = childStart; snap.jobs[1].endedAt = childEnd; snap.computedAt = computedAt; parentRow.bytes++;
   expect(await f.store.read(f.reports[4], freshCohort)).toBeNull();
  } finally { vi.restoreAllMocks(); vi.useRealTimers(); }
 });
 it('keeps UAT data separate while requiring the production activation cohort', async () => {
  vi.useFakeTimers(); vi.setSystemTime(start + 3000);
  try {
   const f = await finalRecoveryFixture(), report = f.reports[5];
   vi.spyOn(cohorts, 'requireCurrentCustomerCohort').mockRejectedValue(new Error('revoked'));
   await withLegacyReportScope(`:${report}`, () => withDailyOneRefresh(f.store, report, async () => {
    expect(await f.store.existing(f.query3)).toBeUndefined();
    const grant = await f.store.admit({ query: 'SELECT uat' }, 1); await f.store.reserve(grant); await f.store.claimSubmission(grant);
    const jobs = [{ id: grant.id, endedAt: start + 3000, bytes: grant.bytes }]; currentDailyOneRefresh()!.jobs.set(grant.id, start + 3000); currentDailyOneRefresh()!.bounds.set(grant.id, grant.bytes);
    await expect(f.store.save(report, payloadFor(report), jobs, null)).rejects.toThrow();
    expect(f.db.values.has(`metricsOneDailyRuns/${f.id3}/snapshots/${createHash('sha256').update(report).digest('hex')}`)).toBe(false);
   }, undefined, undefined, f.cohort));
  } finally { vi.restoreAllMocks(); vi.useRealTimers(); }
 });
 it('activates all ten only after the six remaining scopes and preserves the parent partial publications', async () => {
  vi.useFakeTimers(); vi.setSystemTime(start + 3000);
  try {
   const f = await finalRecoveryFixture(); vi.spyOn(cohorts, 'requireCurrentCustomerCohort').mockResolvedValue(f.cohort);
   const sha = (value: string) => createHash('sha256').update(value).digest('hex');
   for (const [index, report] of f.reports.slice(4).entries()) {
    const uat = index > 0, plan = String(index + 1).padStart(64, '0'), jobId = `metrics_${f.id3}_${plan}`;
    f.db.values.set(`metricsOneDailyRuns/${f.id3}/reservations/${plan}`, { jobId, state: 'started', startedAt: start + 3000, bytes: unit,
     scopeHash: f.run3.measurementScopes[sha(report)], reportHash: sha(report) });
    f.db.values.set(`metricsOneDailyRuns/${f.id3}/snapshots/${sha(report)}`, { schema: 1, state: 'verified', source: f.source3,
     measurementId: f.run3.measurementId, measurementSource: f.run3.measurementSource, measurementDigest: f.run3.measurementDigest,
     scopeDigest: f.run3.scopeDigest, runId: f.id3, parentId: f.id2, parentSource: f.source2, reportHash: sha(report), dataAsOf: asOf,
     sourceCoverage: 'intraday-or-unknown', nonWarehouseFreshness: 'unknown', computedAt: start + 3000,
     jobs: [{ id: jobId, endedAt: start + 3000, bytes: unit }], json: JSON.stringify(payloadFor(report)), ...(!uat ? { witness: cohorts.cohortSnapshotWitness(f.cohort) } : {}) });
   }
   f.db.values.get(`metricsOneDailyRuns/${f.id3}`).phase = 'closed';
   const missing = `metricsOneDailyRuns/${f.id3}/snapshots/${sha(f.reports[4])}`, last = f.db.values.get(missing); f.db.values.delete(missing);
   await expect(f.store.activate(f.cohort)).rejects.toThrow();
   expect(await f.store.activatePartial(f.cohort)).toBe(9);
   expect((await f.store.partialReports(f.cohort)).filter(row => row.environment === 'uat')).toHaveLength(5);
   expect(await f.store.read(f.reports[9], null, true, f.cohort)).not.toBeNull();
   expect(await f.store.read(f.reports[9], null, true, { ...f.cohort, rows: [], cacheKey: '0'.repeat(64) })).toBeNull();
   f.db.values.set(missing, last);
   await expect(f.store.activate(f.cohort)).resolves.toBe(asOf);
   expect(await f.store.read(f.reports[0], f.cohort)).not.toBeNull();
   expect(await f.store.read(f.reports[2], f.cohort)).not.toBeNull();
   expect(await f.store.read(f.reports[9], null, true, f.cohort)).not.toBeNull();
   expect(await f.store.read(f.reports[9], null, true, { ...f.cohort, rows: [], cacheKey: '0'.repeat(64) })).toBeNull();
  } finally { vi.restoreAllMocks(); vi.useRealTimers(); }
 });
 it('admits only eight new reports while accounting for both closed predecessors', async () => {
  const f = await secondRecoveryFixture(), before = f.parent.reservedBytes + f.parent2.reservedBytes;
  await expect(f.store.requireOpen(f.reports[0])).rejects.toThrow(); await expect(f.store.requireOpen(f.reports[1])).rejects.toThrow();
  await expect(f.store.requireOpen(f.reports[2])).resolves.toBeDefined();
  // The full fixed manifest was measured, but only the remaining paid jobs count against the new limit.
  expect(f.run2.maxJobs).toBe(3); expect(f.db.values.get(`metricsOneDailyMeasurements/${f.id2}`).measuredQueries).toBe(4);
  const grant = await f.scope(() => f.store.admit({ query: 'SELECT 3' }, 1)); await f.scope(() => f.store.reserve(grant));
  expect(f.db.values.get(`metricsOneDailyBudgets/${day}`).reservedBytes).toBe(before + grant.bytes);
  expect(await f.scope(() => f.store.claimSubmission(grant))).toBe(true); expect(await f.scope(() => f.store.claimSubmission(grant))).toBe(false);
 });
 it('rejects changed predecessor totals, a reset ledger, and any third continuation', async () => {
  const f = await secondRecoveryFixture(), grant = await f.scope(() => f.store.admit({ query: 'SELECT 3' }, 1));
  f.db.values.get(`metricsOneDailyBudgets/${day}`).reservedBytes = f.parent2.reservedBytes;
  await expect(f.scope(() => f.store.reserve(grant))).rejects.toThrow();
  f.db.values.get(`metricsOneDailyBudgets/${day}`).reservedBytes = f.run2.parentReservedBytes;
  f.parent2.reservedJobs++; await expect(f.store.requireOpen(f.reports[2])).rejects.toThrow(); f.parent2.reservedJobs--;
  f.run2.parentOwnReservedBytes++; f.db.values.get(`metricsOneDailyApprovals/${f.id2}`).parentOwnReservedBytes++;
  f.db.values.get(`metricsOneDailyContinuationClaims/${f.childId}`).parentOwnReservedBytes++;
  await expect(f.store.requireOpen(f.reports[2])).rejects.toThrow();
  f.run2.parentOwnReservedBytes--; f.db.values.get(`metricsOneDailyApprovals/${f.id2}`).parentOwnReservedBytes--;
  f.db.values.get(`metricsOneDailyContinuationClaims/${f.childId}`).parentOwnReservedBytes--;
  // A malformed extra ancestor is rejected before recursion can become unbounded.
  f.parent.parentId = f.id2; f.parent.parentSource = f.source2;
  await expect(f.store.requireOpen(f.reports[2])).rejects.toThrow();
 });
 it('requires both parent composers and all eight new snapshots before activation', async () => {
  vi.useFakeTimers(); vi.setSystemTime(start + 2000);
  try {
   const policyRevision = 'c'.repeat(64), rows = [{ analyticsUserId: 'd'.repeat(32), registeredAt: '2026-11-01T00:00:00.000Z' }];
   const cacheKey = createHash('sha256').update(JSON.stringify([policyRevision, rows])).digest('hex');
   const cohort = { policyRevision, rows, cacheKey, asOf: '2026-11-15T07:00:02.000Z', expiresAt: start + 600_000 };
   const f = await secondRecoveryFixture(cacheKey); vi.spyOn(cohorts, 'requireCurrentCustomerCohort').mockResolvedValue(cohort);
   f.db.values.get(`metricsOneDailyRuns/${f.id2}`).phase = 'closed'; const witness = cohorts.cohortSnapshotWitness(cohort)!;
   for (const [i, report] of f.reports.slice(2).entries()) {
    const reportHash = createHash('sha256').update(report).digest('hex');
    f.db.values.set(`metricsOneDailyRuns/${f.id2}/snapshots/${reportHash}`, { schema: 1, state: 'verified', source: f.source2,
     measurementId: f.run2.measurementId, measurementSource: f.run2.measurementSource, measurementDigest: f.run2.measurementDigest,
     scopeDigest: f.run2.scopeDigest, runId: f.id2, parentId: f.childId, parentSource: f.childSource, reportHash, dataAsOf: asOf,
     sourceCoverage: 'intraday-or-unknown', nonWarehouseFreshness: 'unknown', computedAt: start + 2000,
     jobs: [{ id: `metrics_${f.id2}_${String(i).padStart(64, '0')}`, endedAt: start + 2000 }],
     json: JSON.stringify(payloadFor(report)), ...(i < 3 ? { witness } : {}) });
   }
   const composerPath = `metricsOneDailyComposers/${f.run2.composerId}`, composer = f.db.values.get(composerPath);
   composer.phase = 'open'; await expect(f.store.activate(cohort)).rejects.toThrow(); composer.phase = 'closed';
   await expect(f.store.activate(cohort)).resolves.toBe(asOf);
   const first = await f.store.read(f.reports[0], cohort), second = await f.store.read(f.reports[1], cohort);
   expect(first?.warehouseFrom).toBe(start + 500); expect(second?.warehouseFrom).toBe(start + 1500);
   expect(await f.store.read(f.reports[7], null, true, { ...cohort, rows: [], cacheKey: '0'.repeat(64) })).toBeNull();
  } finally { vi.restoreAllMocks(); vi.useRealTimers(); }
 });
 it('activates only verified partial scopes while retaining the complete-set anchor', async () => {
  vi.useFakeTimers(); vi.setSystemTime(start + 2000);
  try {
   const policyRevision = 'c'.repeat(64), rows = [{ analyticsUserId: 'd'.repeat(32), registeredAt: '2026-11-01T00:00:00.000Z' }];
   const cacheKey = createHash('sha256').update(JSON.stringify([policyRevision, rows])).digest('hex');
   const cohort = { policyRevision, rows, cacheKey, asOf: '2026-11-15T07:00:02.000Z', expiresAt: start + 600_000 };
   const f = await secondRecoveryFixture(cacheKey); vi.spyOn(cohorts, 'requireCurrentCustomerCohort').mockResolvedValue(cohort);
   f.db.values.get(`metricsOneDailyRuns/${f.id2}`).phase = 'closed'; const witness = cohorts.cohortSnapshotWitness(cohort)!;
   for (const [i, report] of f.reports.slice(2, 4).entries()) {
    const reportHash = createHash('sha256').update(report).digest('hex');
    f.db.values.set(`metricsOneDailyRuns/${f.id2}/snapshots/${reportHash}`, { schema: 1, state: 'verified', source: f.source2,
     measurementId: f.run2.measurementId, measurementSource: f.run2.measurementSource, measurementDigest: f.run2.measurementDigest,
     scopeDigest: f.run2.scopeDigest, runId: f.id2, parentId: f.childId, parentSource: f.childSource, reportHash, dataAsOf: asOf,
     sourceCoverage: 'intraday-or-unknown', nonWarehouseFreshness: 'unknown', computedAt: start + 2000,
     jobs: [{ id: `metrics_${f.id2}_${String(i).padStart(64, '0')}`, endedAt: start + 2000 }], json: JSON.stringify(payloadFor(report)), witness });
   }
   expect(await f.store.activatePartial(cohort)).toBe(4);
   expect(await f.store.read(f.reports[2], cohort)).not.toBeNull();
   expect(await f.store.read(f.reports[4], cohort)).toBeNull();
   expect(await f.store.publicationAsOf(cohort)).toBeNull();
   expect((await f.store.partialReports(cohort)).length).toBe(4);
   const removed = { ...cohort, rows: [], cacheKey: '0'.repeat(64) };
   expect(await f.store.read(f.reports[2], removed)).toBeNull();
   expect(await f.store.partialReports(removed)).toEqual([]);
   await expect(f.store.activatePartial(cohort)).rejects.toThrow();
  } finally { vi.restoreAllMocks(); vi.useRealTimers(); }
 });
 it('composes the second report only from the immediate closed parent jobs', async () => {
  vi.useFakeTimers(); vi.setSystemTime(start + 2000);
  try {
   const policyRevision = 'c'.repeat(64), rows = [{ analyticsUserId: 'd'.repeat(32), registeredAt: '2026-11-01T00:00:00.000Z' }];
   const cacheKey = createHash('sha256').update(JSON.stringify([policyRevision, rows])).digest('hex');
   const cohort = { policyRevision, rows, cacheKey, asOf: '2026-11-15T07:00:02.000Z', expiresAt: start + 600_000 };
   const f = await secondRecoveryFixture(cacheKey), report = f.reports[1], path = `metricsOneDailyComposers/${f.run2.composerId}`;
   f.db.values.get(path).phase = 'open'; f.db.values.delete(`${path}/snapshots/${createHash('sha256').update(report).digest('hex')}`);
   await expect(f.store.requireOpen(f.reports[2])).rejects.toThrow(); vi.spyOn(cohorts, 'requireCurrentCustomerCohort').mockResolvedValue(cohort);
   const composer = new DailyOneComposer(f.db.native(), f.run2.composerId, f.source2, f.store, () => start + 2000), claim = await composer.claim(report);
   await withLegacyReportScope(`${cacheKey}:${report}`, () => withClosedComposition(claim.parent, async () => {
    const active = currentClosedComposition()!; active.jobs.add(f.prior2.id); active.jobTimes.set(f.prior2.id, start + 1500);
    await expect(composer.save(claim, payloadFor(report), cohort, validOnePayload)).resolves.toBe(start + 2000);
   }, asOf));
   f.db.values.get(path).phase = 'closed'; await expect(f.store.requireOpen(f.reports[2])).resolves.toBeDefined();
   f.db.values.get(`metricsOneDailyRuns/${f.id2}`).phase = 'closed';
   expect((await f.store.read(f.reports[0], cohort, false))?.warehouseFrom).toBe(start + 500);
   expect((await f.store.read(report, cohort, false))?.warehouseFrom).toBe(start + 1500);
  } finally { vi.restoreAllMocks(); vi.useRealTimers(); }
 });
 it('does not reserve after the caller aborts while the ledger transaction is reading', async () => {
  const f = fixture(), controller = new AbortController(), grant = await f.scope(() => f.store.admit({ query: 'SELECT 1' }, 1));
  let entered!: () => void, release!: () => void; const started = new Promise<void>(r => { entered = r; }), barrier = new Promise<void>(r => { release = r; });
  const original = f.db.runTransaction.bind(f.db);
  vi.spyOn(f.db, 'runTransaction').mockImplementationOnce((run: any) => original((tx: any) => run({ ...tx, get: async (ref: any) => {
   if (ref.path === `metricsOneDailyBudgets/${day}`) { entered(); await barrier; } return tx.get(ref);
  } })));
  const pending = withDailyOneRefresh(f.store, f.reports[0], () => f.scope(() => f.store.reserve(grant)), controller.signal, () => controller.abort());
  await started; controller.abort(); release(); await expect(pending).rejects.toThrow();
  expect(f.db.values.get(`metricsOneDailyBudgets/${day}`).reservedBytes).toBe(0);
  expect(f.db.values.has(`metricsOneDailyRuns/${id}/reservations/${grant.planHash}`)).toBe(false);
  vi.restoreAllMocks();
 });
 it('keeps a reserved job unsubmitted if the caller aborts during the submission fence', async () => {
  const f = fixture(), controller = new AbortController(), grant = await f.scope(() => f.store.admit({ query: 'SELECT 1' }, 1));
  await f.scope(() => f.store.reserve(grant)); const path = `metricsOneDailyRuns/${id}/reservations/${grant.planHash}`;
  let entered!: () => void, release!: () => void; const started = new Promise<void>(r => { entered = r; }), barrier = new Promise<void>(r => { release = r; });
  const original = f.db.runTransaction.bind(f.db);
  vi.spyOn(f.db, 'runTransaction').mockImplementationOnce((run: any) => original((tx: any) => run({ ...tx, get: async (ref: any) => {
   if (ref.path === path) { entered(); await barrier; } return tx.get(ref);
  } })));
  const pending = withDailyOneRefresh(f.store, f.reports[0], () => f.scope(() => f.store.claimSubmission(grant)), controller.signal, () => controller.abort());
  await started; controller.abort(); release(); await expect(pending).rejects.toThrow();
  expect(f.db.values.get(path).state).toBe('reserved'); expect(f.db.values.get(`metricsOneDailyBudgets/${day}`).reservedBytes).toBe(grant.bytes);
  vi.restoreAllMocks();
 });
 it.each([1, 2])('does not verify when abort is observed before save transaction %i writes', async targetRead => {
  const f = fixture(), controller = new AbortController(), report = f.reports[5], scope = <T>(fn: () => Promise<T>) => withLegacyReportScope(`:${report}`, fn);
  f.time(start + 1000); const grant = await scope(() => f.store.admit({ query: 'SELECT 1' }, 1));
  await scope(() => f.store.reserve(grant)); await scope(() => f.store.claimSubmission(grant));
  const path = `metricsOneDailyRuns/${id}/snapshots/${createHash('sha256').update(report).digest('hex')}`;
  let entered!: () => void, release!: () => void, reads = 0; const started = new Promise<void>(r => { entered = r; }), barrier = new Promise<void>(r => { release = r; });
  const original = f.db.runTransaction.bind(f.db);
  vi.spyOn(f.db, 'runTransaction').mockImplementation((run: any) => original((tx: any) => run({ ...tx, get: async (ref: any) => {
   const result = await tx.get(ref); if (ref.path === path && ++reads === targetRead) { entered(); await barrier; } return result;
  } })));
  const pending = scope(() => withDailyOneRefresh(f.store, report, async () => {
   currentDailyOneRefresh()!.jobs.set(grant.id, start + 1000);
   return f.store.save(report, payloadFor(report), [{ id: grant.id, endedAt: start + 1000 }], null);
  }, controller.signal, () => controller.abort()));
  await started; controller.abort(); release(); await expect(pending).rejects.toThrow();
  expect(f.db.values.get(path)?.state).not.toBe('verified');
  expect(f.db.values.get(`metricsOneDailyBudgets/${day}`).reservedBytes).toBe(grant.bytes);
  vi.restoreAllMocks();
 });
 it('fences the parent report and debits remaining reports to the same cumulative ledger', async () => {
  const f = await continuationFixture(), before = f.db.values.get(`metricsOneDailyBudgets/${day}`).reservedBytes;
  await expect(withLegacyReportScope(`${'b'.repeat(64)}:${f.reports[0]}`, () => f.store.existing(f.query))).rejects.toThrow();
  expect(f.db.values.get(`metricsOneDailyBudgets/${day}`).reservedBytes).toBe(before);
  expect(await f.scope(() => f.store.existing({ query: 'SELECT 2' }))).toBeUndefined();
  const next = await f.scope(() => f.store.admit({ query: 'SELECT 2' }, 1)); await f.scope(() => f.store.reserve(next));
  expect(f.db.values.get(`metricsOneDailyBudgets/${day}`).reservedBytes).toBe(before + next.bytes);
  expect(await f.scope(() => f.store.claimSubmission(next))).toBe(true); expect(await f.scope(() => f.store.claimSubmission(next))).toBe(false);
 });
 it('fails closed on changed lineage without allocating new budget', async () => {
  const f = await continuationFixture(), before = f.db.values.get(`metricsOneDailyBudgets/${day}`).reservedBytes;
  f.parent.reservedBytes++; await expect(f.store.requireOpen(f.reports[0])).rejects.toThrow();
  expect(f.db.values.get(`metricsOneDailyBudgets/${day}`).reservedBytes).toBe(before);
 });
 it('rejects reset ledger, mismatched claim and nested continuation lineage', async () => {
  const f = await continuationFixture(), next = await f.scope(() => f.store.admit({ query: 'SELECT 2' }, 1));
  f.db.values.get(`metricsOneDailyBudgets/${day}`).reservedBytes = 0;
  await expect(f.scope(() => f.store.reserve(next))).rejects.toThrow();
  f.db.values.get(`metricsOneDailyBudgets/${day}`).reservedBytes = f.parent.reservedBytes;
  f.db.values.get(`metricsOneDailyContinuationClaims/${id}`).parentReservedJobs++;
  await expect(f.store.requireOpen(f.reports[0])).rejects.toThrow();
  f.db.values.get(`metricsOneDailyContinuationClaims/${id}`).parentReservedJobs--;
  f.parent.parentId = f.childId; f.parent.parentSource = f.childSource;
  await expect(f.store.requireOpen(f.reports[0])).rejects.toThrow();
 });
 it('rejects a reordered manifest even when its overall digest is unchanged', async () => {
  const f = await continuationFixture(); f.child.reports = [f.reports[1], f.reports[0], ...f.reports.slice(2)];
  f.child.newReportsDigest = restorationReportDigest(f.child.reports.slice(1));
  Object.assign(f.db.values.get(`metricsOneDailyApprovals/${f.childId}`), { newReportsDigest: f.child.newReportsDigest });
  Object.assign(f.db.values.get(`metricsOneDailyContinuationClaims/${id}`), { newReportsDigest: f.child.newReportsDigest });
  await expect(f.store.requireOpen(f.reports[0])).rejects.toThrow();
 });
 it('enforces the parent-inclusive hard cap, unique claim and expiration', async () => {
  const f = await continuationFixture(), tooLarge = f.policy.maxDailyBytes - f.parent.reservedBytes + 1;
  f.child.maxBytes = tooLarge; f.db.values.get(`metricsOneDailyApprovals/${f.childId}`).maxBytes = tooLarge;
  f.db.values.get(`metricsOneDailyContinuationClaims/${id}`).maxBytes = tooLarge;
  await expect(f.store.requireOpen(f.reports[1])).rejects.toThrow();
  f.child.maxBytes = 150 * unit; f.db.values.get(`metricsOneDailyApprovals/${f.childId}`).maxBytes = f.child.maxBytes;
  f.db.values.get(`metricsOneDailyContinuationClaims/${id}`).maxBytes = f.child.maxBytes;
  f.db.values.get(`metricsOneDailyContinuationClaims/${id}`).runId = 'refresh_20261115_9999999999999999';
  await expect(f.store.requireOpen(f.reports[1])).rejects.toThrow();
  f.db.values.get(`metricsOneDailyContinuationClaims/${id}`).runId = f.childId; f.time(f.child.expiresAt);
  expect(await f.store.isPreparing()).toBe(false); await expect(f.store.requireOpen(f.reports[1])).rejects.toThrow();
 });
 it('coalesces concurrent child reservations and keeps uncertain submissions charged', async () => {
  const f = await continuationFixture(), before = f.parent.reservedBytes;
  const grant = await f.scope(() => f.store.admit({ query: 'SELECT 2' }, 1));
  await Promise.all(Array.from({ length: 8 }, () => f.scope(() => f.store.reserve(grant))));
  const claims = await Promise.all(Array.from({ length: 8 }, () => f.scope(() => f.store.claimSubmission(grant))));
  expect(claims.filter(Boolean)).toHaveLength(1);
  expect(f.db.values.get(`metricsOneDailyBudgets/${day}`).reservedBytes).toBe(before + grant.bytes);
  f.db.values.get(`metricsOneDailyRuns/${f.childId}`).phase = 'closed';
  await expect(f.scope(() => f.store.claimSubmission(grant))).rejects.toThrow();
  expect(f.db.values.get(`metricsOneDailyBudgets/${day}`).reservedBytes).toBe(before + grant.bytes);
 });
 it('requires a separately composed, current-cohort parent publication before child work', async () => {
  vi.useFakeTimers(); vi.setSystemTime(start + 1000);
  try {
   const policyRevision = 'c'.repeat(64), rows = [{ analyticsUserId: 'd'.repeat(32), registeredAt: '2026-11-01T00:00:00.000Z' }];
   const cacheKey = createHash('sha256').update(JSON.stringify([policyRevision, rows])).digest('hex');
   const cohort = { policyRevision, rows, cacheKey, asOf: '2026-11-15T07:00:01.000Z', expiresAt: start + 600_000 };
   const f = await continuationFixture(1, cacheKey), report = f.reports[0], path = `metricsOneDailyComposers/${f.child.composerId}`;
   f.db.values.get(path).phase = 'open'; f.db.values.delete(`${path}/snapshots/${createHash('sha256').update(report).digest('hex')}`);
   await expect(f.store.requireOpen(f.reports[1])).rejects.toThrow();
   vi.spyOn(cohorts, 'requireCurrentCustomerCohort').mockResolvedValue(cohort);
   const composer = new DailyOneComposer(f.db.native(), f.child.composerId, f.childSource, f.store, () => start + 1000);
   const claim = await composer.claim(report); await expect(composer.claim(report)).rejects.toThrow();
   await withLegacyReportScope(`${cacheKey}:${report}`, () => withClosedComposition(claim.parent, async () => {
    const active = currentClosedComposition()!; active.jobs.add(f.prior.id); active.jobTimes.set(f.prior.id, start + 500);
    await expect(composer.save(claim, payloadFor(report), cohort, validOnePayload)).resolves.toBe(start + 1000);
   }, asOf));
   await expect(f.store.requireOpen(f.reports[1])).rejects.toThrow();
   f.db.values.get(path).phase = 'closed'; await expect(f.store.requireOpen(f.reports[1])).resolves.toBeDefined();
   f.db.values.get(`metricsOneDailyRuns/${f.childId}`).phase = 'closed';
   const result = await f.store.read(report, cohort, false); expect(result?.warehouseFrom).toBe(start + 500);
   expect(await f.store.read(report, { ...cohort, rows: [], cacheKey: 'f'.repeat(64) }, false)).toBeNull();
   const witness = cohorts.cohortSnapshotWitness(cohort)!;
   for (const [i, childReport] of f.reports.slice(1).entries()) {
    const reportHash = createHash('sha256').update(childReport).digest('hex');
    f.db.values.set(`metricsOneDailyRuns/${f.childId}/snapshots/${reportHash}`, { schema: 1, state: 'verified', source: f.childSource,
     measurementId: f.child.measurementId, measurementSource: f.child.measurementSource, measurementDigest: f.child.measurementDigest,
     scopeDigest: f.child.scopeDigest, runId: f.childId, parentId: id, parentSource: source, reportHash, dataAsOf: asOf,
     sourceCoverage: 'intraday-or-unknown', nonWarehouseFreshness: 'unknown', computedAt: start + 1000,
     jobs: [{ id: `metrics_${f.childId}_${String(i).padStart(64, '0')}`, endedAt: start + 1000 }],
     json: JSON.stringify(payloadFor(childReport)), ...(i < 4 ? { witness } : {}) });
   }
   const lastReport = f.reports[9], lastPath = `metricsOneDailyRuns/${f.childId}/snapshots/${createHash('sha256').update(lastReport).digest('hex')}`;
   const last = f.db.values.get(lastPath); f.db.values.delete(lastPath); await expect(f.store.activate(cohort)).rejects.toThrow();
   f.db.values.set(lastPath, last); await expect(f.store.activate(cohort)).resolves.toBe(asOf);
   expect(await f.store.read(lastReport, null, true, { ...cohort, rows: [], cacheKey: 'f'.repeat(64) })).toBeNull();
  } finally { vi.restoreAllMocks(); vi.useRealTimers(); }
 });
 it('does not publish a parent composition if the child closes while results are loading', async () => {
  vi.useFakeTimers(); vi.setSystemTime(start + 1000);
  try {
   const policyRevision = 'c'.repeat(64), rows = [{ analyticsUserId: 'd'.repeat(32), registeredAt: '2026-11-01T00:00:00.000Z' }];
   const cacheKey = createHash('sha256').update(JSON.stringify([policyRevision, rows])).digest('hex');
   const cohort = { policyRevision, rows, cacheKey, asOf: '2026-11-15T07:00:01.000Z', expiresAt: start + 600_000 };
   const f = await continuationFixture(1, cacheKey), report = f.reports[0], path = `metricsOneDailyComposers/${f.child.composerId}`;
   const snapshot = `${path}/snapshots/${createHash('sha256').update(report).digest('hex')}`;
   f.db.values.get(path).phase = 'open'; f.db.values.delete(snapshot); vi.spyOn(cohorts, 'requireCurrentCustomerCohort').mockResolvedValue(cohort);
   const composer = new DailyOneComposer(f.db.native(), f.child.composerId, f.childSource, f.store, () => start + 1000), claim = await composer.claim(report);
   f.db.values.get(`metricsOneDailyRuns/${f.childId}`).phase = 'closed';
   await withLegacyReportScope(`${cacheKey}:${report}`, () => withClosedComposition(claim.parent, async () => {
    const active = currentClosedComposition()!; active.jobs.add(f.prior.id); active.jobTimes.set(f.prior.id, start + 500);
    await expect(composer.save(claim, payloadFor(report), cohort, validOnePayload)).rejects.toThrow();
   }, asOf));
   expect(f.db.values.has(snapshot)).toBe(false);
  } finally { vi.restoreAllMocks(); vi.useRealTimers(); }
 });
 it('holds the parent publication and child budget if membership changes during composition', async () => {
  vi.useFakeTimers(); vi.setSystemTime(start + 1000);
  try {
   const policyRevision = 'c'.repeat(64), rows = [{ analyticsUserId: 'd'.repeat(32), registeredAt: '2026-11-01T00:00:00.000Z' }];
   const cacheKey = createHash('sha256').update(JSON.stringify([policyRevision, rows])).digest('hex');
   const cohort = { policyRevision, rows, cacheKey, asOf: '2026-11-15T07:00:01.000Z', expiresAt: start + 600_000 };
   const f = await continuationFixture(1, cacheKey), report = f.reports[0], path = `metricsOneDailyComposers/${f.child.composerId}`;
   const snapshot = `${path}/snapshots/${createHash('sha256').update(report).digest('hex')}`;
   f.db.values.get(path).phase = 'open'; f.db.values.delete(snapshot);
   vi.spyOn(cohorts, 'requireCurrentCustomerCohort').mockResolvedValueOnce(cohort).mockRejectedValueOnce(new Error('membership changed'));
   const composer = new DailyOneComposer(f.db.native(), f.child.composerId, f.childSource, f.store, () => start + 1000), claim = await composer.claim(report);
   await withLegacyReportScope(`${cacheKey}:${report}`, () => withClosedComposition(claim.parent, async () => {
    const active = currentClosedComposition()!; active.jobs.add(f.prior.id); active.jobTimes.set(f.prior.id, start + 500);
    await expect(composer.save(claim, payloadFor(report), cohort, validOnePayload)).rejects.toThrow('membership changed');
   }, asOf));
   expect(f.db.values.get(snapshot).state).toBe('pending'); f.db.values.get(path).phase = 'closed';
   expect(await f.store.isPreparing()).toBe(false); expect(f.db.values.get(`metricsOneDailyBudgets/${day}`).reservedBytes).toBe(f.parent.reservedBytes);
  } finally { vi.restoreAllMocks(); vi.useRealTimers(); }
 });
 it('resolves only exact started reservations in a closed run', async () => {
  const f = fixture(), query = { query: 'SELECT 1' }, grant = await f.scope(() => f.store.admit(query, 1));
  await f.scope(() => f.store.reserve(grant));
  await expect(f.scope(() => f.store.closedJob(query))).rejects.toThrow();
  await f.scope(() => f.store.claimSubmission(grant)); f.db.values.get(`metricsOneDailyRuns/${id}`).phase = 'closed';
  await expect(f.scope(() => f.store.closedJob(query))).resolves.toMatchObject({ id: grant.id, bytes: grant.bytes, query: query.query });
  await expect(f.scope(() => f.store.closedJob({ query: 'SELECT 2' }))).rejects.toThrow();
  f.db.values.get(`metricsOneDailyRuns/${id}/reservations/${grant.planHash}`).jobId = 'wrong';
  await expect(f.scope(() => f.store.closedJob(query))).rejects.toThrow();
 });
 it('claims one diagnostic attempt only for the fixed closed run and stores bounded categories', async () => {
  const f = fixture(); f.run.phase = 'closed'; const diagnosticId = 'dailycheck_4444444444444444', path = `metricsDailyClosedDiagnostics/${diagnosticId}`;
  f.db.values.set(path, { phase: 'open', source, runId: id, runSource: source, logicalAsOf: asOf, report: f.reports[0], reportDigest: f.run.reportDigest, createdAt: start, expiresAt: start + 1000 });
  const diagnostic = new DailyClosedDiagnostic(f.db.native(), diagnosticId, source, f.store, () => start);
  await expect(diagnostic.claim(f.reports[1])).rejects.toThrow();
  const { attempt } = await diagnostic.claim(f.reports[0]); await expect(diagnostic.claim(f.reports[0])).rejects.toThrow();
  await expect(diagnostic.finish(attempt, { stage: 'capture', reason: 'missing-reservation', jobs: 1, maxRows: 2, maxBytes: 3, payloadBytes: 0 })).resolves.toBeUndefined();
  await expect(diagnostic.finish(attempt, { stage: 'capture', reason: 'missing-reservation', jobs: 1, maxRows: 2, maxBytes: 3, payloadBytes: 0 })).rejects.toThrow();
 });
 it('limits a closed continuation diagnostic to its first attempted child report', async () => {
  const f = await continuationFixture(), diagnosticId = 'dailycheck_6666666666666666', path = `metricsDailyClosedDiagnostics/${diagnosticId}`;
  f.db.values.get(`metricsOneDailyRuns/${f.childId}`).phase = 'closed';
  f.db.values.set(path, { phase: 'open', source: f.childSource, runId: f.childId, runSource: f.childSource, logicalAsOf: asOf,
   report: f.reports[1], reportDigest: f.child.reportDigest, createdAt: start, expiresAt: start + 3600_000 });
  const diagnostic = new DailyClosedDiagnostic(f.db.native(), diagnosticId, f.childSource, f.store, () => start + 1000);
  await expect(diagnostic.claim(f.reports[0])).rejects.toThrow(); await expect(diagnostic.claim(f.reports[1])).resolves.toBeDefined();
 });
 it('limits the second closed continuation diagnostic to its failed production 90-day report', async () => {
  const f = await secondRecoveryFixture(), diagnosticId = 'dailycheck_7777777777777777', path = `metricsDailyClosedDiagnostics/${diagnosticId}`;
  f.db.values.get(`metricsOneDailyRuns/${f.id2}`).phase = 'closed';
  f.db.values.set(path, { phase: 'open', source: f.source2, runId: f.id2, runSource: f.source2, logicalAsOf: asOf,
   report: f.reports[4], reportDigest: f.run2.reportDigest, createdAt: start, expiresAt: start + 3600_000 });
  const diagnostic = new DailyClosedDiagnostic(f.db.native(), diagnosticId, f.source2, f.store, () => start + 1000);
  await expect(diagnostic.claim(f.reports[3])).rejects.toThrow(); await expect(diagnostic.claim(f.reports[4])).resolves.toBeDefined();
 });
 it('fixes all five windows for both environments and rejects unsupported reports', async () => {
  const f = fixture(); expect(f.reports).toHaveLength(10); expect(new Set(f.reports).size).toBe(10); await expect(f.store.requireOpen(f.reports[0])).resolves.toBeDefined(); await expect(f.store.requireOpen('/api/analytics/all?view=growth')).rejects.toThrow();
 });
 it('rejects a logical clock later than the run creation time', async () => {
  const f = fixture(); const future = '2026-11-15T23:59:59.999Z';
  const reports = dailyOneManifest('2026-11-15'), reportDigest = restorationReportDigest(reports);
  Object.assign(f.run, { logicalAsOf: future, reports, reportDigest });
  Object.assign(f.db.values.get(`metricsOneDailyApprovals/${id}`), { logicalAsOf: future, reportDigest });
  Object.assign(f.db.values.get(`metricsOneDailyMeasurements/${id}`), { logicalAsOf: future, reportDigest });
  await expect(f.store.requireOpen(reports[0])).rejects.toThrow();
 });
 it('binds the admitted report scope to the sealed clock', async () => {
  const f = fixture();
  await expect(withDailyOneRefresh(f.store, f.reports[0], () => f.scope(() => f.store.admit({ query: 'SELECT 1' }, 1)))).resolves.toBeDefined();
  await expect(withDailyOneRefresh(f.store, f.reports[1], () => f.scope(() => f.store.admit({ query: 'SELECT 1' }, 1)))).rejects.toThrow();
 });
 it('accepts the exact earlier measurement source under a one-TiB cap and rejects drift or larger caps', async () => {
  const f = fixture(), earlier = '3c6bb690a538d75b20c6dfc6494b9c0a8ae3bd58';
  const generation = dailyOnePolicyGeneration(source, DAILY_ONE_LIMITS.bytes, 250, DAILY_ONE_LIMITS.perJob);
  Object.assign(f.run, { policyGeneration: generation, measurementSource: earlier, maxBytes: DAILY_ONE_LIMITS.bytes, maxJobs: 250, maxPerJobBytes: DAILY_ONE_LIMITS.perJob });
  f.db.values.set(`metricsOneDailyPolicies/${generation}`, { approved: true, generation, source, maxDailyBytes: DAILY_ONE_LIMITS.bytes, maxDailyJobs: 250, maxPerJobBytes: DAILY_ONE_LIMITS.perJob });
  Object.assign(f.db.values.get(`metricsOneDailyApprovals/${id}`), f.run);
  Object.assign(f.db.values.get(`metricsOneDailySlots/${day}`), { policyGeneration: generation });
  Object.assign(f.db.values.get(`metricsOneDailyMeasurements/${f.run.measurementId}`), { source: earlier });
  Object.assign(f.db.values.get(`metricsOneDailyMeasurements/${id}`), { source: earlier, measuredBytes: 734202429440, measuredQueries: 220 });
  await expect(f.store.requireOpen(f.reports[0])).resolves.toBeDefined();
  f.run.measurementSource = 'e'.repeat(40); f.db.values.get(`metricsOneDailyApprovals/${id}`).measurementSource = f.run.measurementSource;
  await expect(f.store.requireOpen(f.reports[0])).rejects.toThrow();
  f.run.measurementSource = earlier; f.db.values.get(`metricsOneDailyApprovals/${id}`).measurementSource = earlier;
  f.run.maxBytes = DAILY_ONE_LIMITS.bytes + 1; f.db.values.get(`metricsOneDailyApprovals/${id}`).maxBytes = f.run.maxBytes;
  await expect(f.store.requireOpen(f.reports[0])).rejects.toThrow();
 });
 it('rejects changed membership, swapped environment scopes and tampered scope manifests', async () => {
  const f = fixture(), production = f.reports[0], uat = f.reports[5];
  await expect(withLegacyReportScope(`${'c'.repeat(64)}:${production}`, () => f.store.admit({ query: 'SELECT 1' }, 1))).rejects.toThrow();
  await expect(withLegacyReportScope(`${'b'.repeat(64)}:${uat}`, () => f.store.admit({ query: 'SELECT 1' }, 1))).rejects.toThrow();
  await expect(withLegacyReportScope(`:${production}`, () => f.store.admit({ query: 'SELECT 1' }, 1))).rejects.toThrow();
  const key = createHash('sha256').update(production).digest('hex'); f.run.measurementScopes[key] = 'd'.repeat(64);
  await expect(f.store.requireOpen(production)).rejects.toThrow();
 });
 it('verifies all measured production and UAT scopes before paid work', async () => {
  const f = fixture(), cohort = { cacheKey: 'b'.repeat(64), expiresAt: Date.now() + 60_000 } as cohorts.CustomerCohort;
  await expect(f.store.verifyMeasuredCohort(cohort)).resolves.toBeUndefined();
  await expect(f.store.verifyMeasuredCohort({ ...cohort, cacheKey: 'c'.repeat(64) })).rejects.toThrow();
  const sha = (value: string) => createHash('sha256').update(value).digest('hex');
  f.run.measurementScopes[sha(f.reports[4])] = sha(`${'d'.repeat(64)}:${f.reports[4]}`);
  f.run.scopeDigest = sha(JSON.stringify(Object.entries(f.run.measurementScopes).sort(([a], [b]) => a.localeCompare(b))));
  f.db.values.get(`metricsOneDailyApprovals/${id}`).scopeDigest = f.run.scopeDigest;
  await expect(f.store.verifyMeasuredCohort(cohort)).rejects.toThrow();
 });
 it('never opens or submits after the original measurement expires', async () => {
  const f = fixture(), measurement = f.db.values.get(`metricsOneDailyMeasurements/${f.run.measurementId}`);
  measurement.expiresAt = start + 500; f.run.expiresAt = start + 500; f.db.values.get(`metricsOneDailyApprovals/${id}`).expiresAt = start + 500;
  const grant = await f.scope(() => f.store.admit({ query: 'SELECT 1' }, 1)); await f.scope(() => f.store.reserve(grant));
  f.time(start + 500);
  await expect(f.store.requireOpen(f.reports[0])).rejects.toThrow();
  await expect(f.scope(() => f.store.claimSubmission(grant))).rejects.toThrow();
  expect(f.db.values.get(`metricsOneDailyBudgets/${day}`).reservedJobs).toBe(1);
  const later = fixture(); later.db.values.get(`metricsOneDailyMeasurements/${later.run.measurementId}`).expiresAt = start + 500;
  await expect(later.store.requireOpen(later.reports[0])).rejects.toThrow();
 });
 it('coalesces atomic reservations and claims a single submission before native work', async () => {
  const f = fixture(), query = await f.store.prepare({ query: 'SELECT CURRENT_DATE()' }); expect(query.query).toContain('2026-11-14');
  const grant = await f.scope(() => f.store.admit(query, 20 * unit)); await Promise.all(Array.from({ length: 8 }, () => f.scope(() => f.store.reserve(grant))));
  expect(f.db.values.get(`metricsOneDailyBudgets/${day}`)).toMatchObject({ reservedBytes: grant.bytes, reservedJobs: 1 });
  const claims = await Promise.all(Array.from({ length: 8 }, () => f.scope(() => f.store.claimSubmission(grant)))); expect(claims.filter(Boolean)).toHaveLength(1);
  expect(await f.scope(() => f.store.existing(query))).toMatchObject({ id: grant.id, bytes: grant.bytes, reuse: { priorPlanHash: grant.planHash } });
 });
 it('fails closed on changed policy, missing measurement, slot mismatch and UTC rollover', async () => {
  for (const mutate of [(f: ReturnType<typeof fixture>) => { f.db.values.get(`metricsOneDailyPolicies/${f.generation}`).maxDailyBytes++; }, (f: ReturnType<typeof fixture>) => { f.db.values.delete(`metricsOneDailyMeasurements/${id}`); }, (f: ReturnType<typeof fixture>) => { f.db.values.get(`metricsOneDailySlots/${day}`).runId = 'other'; }, (f: ReturnType<typeof fixture>) => { f.time(Date.parse('2026-11-16T00:00:00Z')); }]) {
   const f = fixture(), grant = await f.scope(() => f.store.admit({ query: 'SELECT 1' }, 1)); mutate(f); await expect(f.store.reserve(grant)).rejects.toThrow(); expect(f.db.values.get(`metricsOneDailyBudgets/${day}`).reservedJobs).toBe(0);
  }
 });
 it('requires completed scoped proof and exposes a write-once UAT publication only after close', async () => {
  const f = fixture(), report = f.reports[5]; f.time(start + 1000);
  const grant = await withLegacyReportScope(`:${report}`, () => f.store.admit({ query: 'SELECT 1' }, 1));
  await withLegacyReportScope(`:${report}`, () => f.store.reserve(grant)); await withLegacyReportScope(`:${report}`, () => f.store.claimSubmission(grant));
  const jobs = [{ id: grant.id, endedAt: start + 1000 }];
  await expect(f.store.save(report, payloadFor(report, 3), jobs, null)).rejects.toThrow();
  await withLegacyReportScope(`:${report}`, () => withDailyOneRefresh(f.store, report, async () => {
    await expect(f.store.save(report, payloadFor(report, 3), jobs, null)).rejects.toThrow();
    currentDailyOneRefresh()!.jobs.set(grant.id, start + 1000);
    const wrong = payloadFor(report, 3); wrong.body.one.data.uat!.reportingEnvironment = 'production';
    await expect(f.store.save(report, wrong, jobs, null)).rejects.toThrow();
    await expect(f.store.save(report, payloadFor(report, 3), [{ ...jobs[0], endedAt: start + 999 }], null)).rejects.toThrow();
    await f.store.save(report, payloadFor(report, 3), jobs, null);
    await expect(f.store.save(report, payloadFor(report, 4), jobs, null)).rejects.toThrow();
  }));
  expect(await f.store.read(report, null)).toBeNull();
  f.db.values.get(`metricsOneDailyRuns/${id}`).phase = 'closed';
  expect(await f.store.read(report, null)).toBeNull();
  expect(await f.store.publicationAsOf({} as cohorts.CustomerCohort)).toBeNull();
  const activationGate = {} as cohorts.CustomerCohort;
  const gate = vi.spyOn(cohorts, 'cohortMatchesSnapshotWitness').mockReturnValue(true);
  f.db.values.set(`metricsOneDailyRuns/${id}/activation/current`, { state: 'active', source, runId: id, reportDigest: f.run.reportDigest, logicalAsOf: asOf, witness: { policyRevision: 'a'.repeat(64), rowsHash: 'b'.repeat(64), asOf } });
  expect(await f.store.read(report, null, true, activationGate)).toMatchObject({ value: { body: { one: { data: { uat: { count: 3 } } } } }, warehouseFrom: start + 1000 });
  gate.mockReturnValue(false); expect(await f.store.read(report, null, true, activationGate)).toBeNull(); gate.mockRestore();
  expect(await f.store.read(f.reports[0], null)).toBeNull();
  f.time(start + 91 * 86_400_000); expect(await f.store.read(report, null)).toBeNull();
 });
 it('activates all ten only together and invalidates both lanes after member removal', async () => {
  vi.useFakeTimers(); vi.setSystemTime(start + 1000);
  try {
    const f = fixture(); f.time(start + 1000); f.db.values.get(`metricsOneDailyRuns/${id}`).phase = 'closed';
    const policyRevision = 'c'.repeat(64), rows = [{ analyticsUserId: 'd'.repeat(32), registeredAt: '2026-11-01T00:00:00.000Z' }];
    const keyFor = (members: typeof rows) => createHash('sha256').update(JSON.stringify([policyRevision, members])).digest('hex');
    const cohort = { policyRevision, rows, cacheKey: keyFor(rows), asOf: '2026-11-15T07:00:01.000Z', expiresAt: start + 600_000 };
    vi.spyOn(cohorts, 'requireCurrentCustomerCohort').mockResolvedValue(cohort);
    const witness = cohorts.cohortSnapshotWitness(cohort), sha = (value: string) => createHash('sha256').update(value).digest('hex');
    for (const [index, report] of f.reports.entries()) f.db.values.set(`metricsOneDailyRuns/${id}/snapshots/${sha(report)}`, {
      schema: 1, state: 'verified', source, measurementId: f.run.measurementId, measurementSource: source, measurementDigest: 'f'.repeat(64), scopeDigest: f.run.scopeDigest, runId: id, reportHash: sha(report), dataAsOf: asOf, computedAt: start + 1000,
      sourceCoverage: 'intraday-or-unknown', nonWarehouseFreshness: 'unknown', json: JSON.stringify(payloadFor(report, index)),
      jobs: [{ id: `metrics_${id}_${sha(report)}`, endedAt: start + 500 }], ...(index < 5 ? { witness } : {}),
    });
    expect(await f.store.activate(cohort)).toBe(asOf); expect(await f.store.publicationAsOf(cohort)).toBe(asOf);
    const removed = { ...cohort, rows: [], cacheKey: keyFor([]) };
    for (const [index, report] of f.reports.entries()) expect(await f.store.read(report, index < 5 ? removed : null, true, removed)).toBeNull();
  } finally { vi.restoreAllMocks(); vi.useRealTimers(); }
 });
 it('cannot activate a closed run without all ten verified publications', async () => {
  vi.useFakeTimers(); vi.setSystemTime(start + 1000);
  try {
    const f = fixture(); f.time(start + 1000); f.db.values.get(`metricsOneDailyRuns/${id}`).phase = 'closed';
    const policyRevision = 'c'.repeat(64), rows = [{ analyticsUserId: 'd'.repeat(32), registeredAt: '2026-11-01T00:00:00.000Z' }];
    const cacheKey = createHash('sha256').update(JSON.stringify([policyRevision, rows])).digest('hex');
    const cohort = { policyRevision, rows, cacheKey, asOf: '2026-11-15T07:00:01.000Z', expiresAt: start + 600_000 };
    vi.spyOn(cohorts, 'requireCurrentCustomerCohort').mockResolvedValue(cohort);
    await expect(f.store.activate(cohort)).rejects.toThrow();
    expect(f.db.values.has(`metricsOneDailyRuns/${id}/activation/current`)).toBe(false);
  } finally { vi.restoreAllMocks(); vi.useRealTimers(); }
 });
 it('rejects reservations and publications borrowed from another report scope', async () => {
  const f = fixture(), report = f.reports[5], other = f.reports[6]; f.time(start + 1000);
  const grant = await withLegacyReportScope(`:${report}`, () => f.store.admit({ query: 'SELECT 1' }, 1));
  await expect(withLegacyReportScope(`:${other}`, () => f.store.reserve(grant))).rejects.toThrow();
  await withLegacyReportScope(`:${report}`, () => f.store.reserve(grant));
  await expect(withLegacyReportScope(`:${other}`, () => f.store.claimSubmission(grant))).rejects.toThrow();
  await withLegacyReportScope(`:${report}`, () => f.store.claimSubmission(grant));
  await withLegacyReportScope(`:${other}`, () => withDailyOneRefresh(f.store, other, async () => {
    currentDailyOneRefresh()!.jobs.set(grant.id, start + 1000);
    await expect(f.store.save(other, payloadFor(report, 1), [{ id: grant.id, endedAt: start + 1000 }], null)).rejects.toThrow();
  }));
 });
 it('keeps a production snapshot pending if current membership changes during staging', async () => {
  vi.useFakeTimers(); vi.setSystemTime(start + 1000);
  try {
    const f = fixture(), report = f.reports[0]; f.time(start + 1000);
    const policyRevision = 'c'.repeat(64), rows = [{ analyticsUserId: 'd'.repeat(32), registeredAt: '2026-11-01T00:00:00.000Z' }];
    const cacheKey = createHash('sha256').update(JSON.stringify([policyRevision, rows])).digest('hex');
    const cohort = { policyRevision, rows, cacheKey, asOf: '2026-11-15T07:00:01.000Z', expiresAt: start + 600_000 };
    const sha = (value: string) => createHash('sha256').update(value).digest('hex');
    f.run.measurementScopes[sha(report)] = sha(`${cacheKey}:${report}`);
    f.run.scopeDigest = sha(JSON.stringify(Object.entries(f.run.measurementScopes).sort(([a], [b]) => a.localeCompare(b))));
    f.db.values.get(`metricsOneDailyApprovals/${id}`).scopeDigest = f.run.scopeDigest;
    const current = vi.spyOn(cohorts, 'requireCurrentCustomerCohort').mockResolvedValueOnce(cohort).mockRejectedValueOnce(new Error('membership changed'));
    const scope = <T>(fn: () => Promise<T>) => withLegacyReportScope(`${cacheKey}:${report}`, fn);
    const grant = await scope(() => f.store.admit({ query: 'SELECT 1' }, 1));
    await scope(() => f.store.reserve(grant)); await scope(() => f.store.claimSubmission(grant));
    await scope(() => withDailyOneRefresh(f.store, report, async () => {
      currentDailyOneRefresh()!.jobs.set(grant.id, start + 1000);
      await expect(f.store.save(report, payloadFor(report, 1), [{ id: grant.id, endedAt: start + 1000 }], cohort)).rejects.toThrow('membership changed');
    }));
    expect(current).toHaveBeenCalledTimes(2); f.db.values.get(`metricsOneDailyRuns/${id}`).phase = 'closed';
    expect(await f.store.read(report, cohort)).toBeNull();
  } finally { vi.restoreAllMocks(); vi.useRealTimers(); }
 });
 it('never refunds an uncertain started job or admits work above approved limits', async () => {
  const f = fixture(), query = { query: 'SELECT 1' }, grant = await f.scope(() => f.store.admit(query, 90 * unit)); await f.scope(() => f.store.reserve(grant)); expect(await f.scope(() => f.store.claimSubmission(grant))).toBe(true); expect(await f.scope(() => f.store.claimSubmission(grant))).toBe(false);
  await expect(f.scope(() => f.store.admit({ query: 'SELECT 2' }, DAILY_ONE_LIMITS.perJob))).rejects.toThrow();
  expect(f.db.values.get(`metricsOneDailyBudgets/${day}`).reservedBytes).toBe(grant.bytes);
 });
 it('rejects unscoped, changed-manifest and corrupt reservation records', async () => {
  const f = fixture(); await expect(f.store.admit({ query: 'SELECT 1' }, 1)).rejects.toThrow();
  const grant = await f.scope(() => f.store.admit({ query: 'SELECT 1' }, 1)); await f.scope(() => f.store.reserve(grant));
  f.db.values.get(`metricsOneDailyRuns/${id}/reservations/${grant.planHash}`).jobId = 'wrong'; await expect(f.scope(() => f.store.existing({ query: 'SELECT 1' }))).rejects.toThrow();
  f.db.values.get(`metricsOneDailyRuns/${id}`).reports = f.reports.slice(1); await expect(f.store.requireOpen(f.reports[1])).rejects.toThrow();
 });
});




describe('daily One native-estimate admission', () => {
 it('seals only completed bounded estimates for every fixed report', async () => {
  const f = fixture(), measurementId = 'dailymeasure_20261115_2222222222222222';
  f.db.values.set(`metricsOneDailyMeasurements/${measurementId}`, { source, targetRunId: id, day, logicalAsOf: asOf, reports: f.reports, reportDigest: restorationReportDigest(f.reports), createdAt: start, expiresAt: start + 3600_000, phase: 'open', maxDryRuns: 10, attempted: 0 });
  const measurement = new DailyOneMeasurement(f.db.native(), measurementId, source, () => start + 1000);
  f.db.values.delete(`metricsOneDailyMeasurements/${id}`);
  for (const [index, report] of f.reports.entries()) {
    const cohort = index < 5 ? 'b'.repeat(64) : '';
    const attempt = await withLegacyReportScope(`${cohort}:${report}`, () => withDailyOneMeasurement(measurement, report, () => measurement.claim(report, `SELECT ${index}`)));
    await measurement.finish(attempt.planHash, { processed: index, bound: 10 * unit, referenceDigest: 'e'.repeat(64) });
    await measurement.noteReport(report);
  }
  const seal = await measurement.seal();
  expect(seal).toMatchObject({ measuredBytes: 100 * unit, measuredQueries: 10, coverage: 'not exhaustive' });
  expect(f.db.values.get(`metricsOneDailyMeasurements/${id}`)).toMatchObject({ phase: 'sealed', digest: seal.digest });
  await expect(measurement.requireOpen(f.reports[0])).rejects.toThrow();
 });
 it('leaves uncertain estimates unsealed', async () => {
  const f = fixture(), measurementId = 'dailymeasure_20261115_2222222222222222';
  f.db.values.set(`metricsOneDailyMeasurements/${measurementId}`, { source, targetRunId: id, day, logicalAsOf: asOf, reports: f.reports, reportDigest: restorationReportDigest(f.reports), createdAt: start, expiresAt: start + 3600_000, phase: 'open', maxDryRuns: 10, attempted: 0 });
  const measurement = new DailyOneMeasurement(f.db.native(), measurementId, source, () => start + 1000);
  await f.scope(() => measurement.claim(f.reports[0], 'SELECT 1'));
  await expect(measurement.seal()).rejects.toThrow();
  expect(f.db.values.get(`metricsOneDailyMeasurements/${id}`).digest).toBe('f'.repeat(64));
  expect(f.db.values.get(`metricsOneDailyMeasurements/${measurementId}`).phase).toBe('closing');
 });

 it('deduplicates bounded attempts and never retries an uncertain estimate', async () => {
  const f = fixture(), measurementId = 'dailymeasure_20261115_2222222222222222', report = f.reports[0];
  f.db.values.set(`metricsOneDailyMeasurements/${measurementId}`, { source, targetRunId: id, day, logicalAsOf: asOf, reports: f.reports, reportDigest: restorationReportDigest(f.reports), createdAt: start, expiresAt: start + 3600_000, phase: 'open', maxDryRuns: 2, attempted: 0 });
  const measurement = new DailyOneMeasurement(f.db.native(), measurementId, source, () => start + 1000);
  const claim = () => f.scope(() => withDailyOneMeasurement(measurement, report, () => measurement.claim(report, 'SELECT 1')));
  const first = await claim(); await expect(claim()).rejects.toThrow();
  await measurement.finish(first.planHash, { processed: 1, bound: 10 * unit, referenceDigest: 'e'.repeat(64) });
  expect((await claim()).existing).toMatchObject({ state: 'measured', bound: 10 * unit });
  expect(f.db.values.get(`metricsOneDailyMeasurements/${measurementId}`).attempted).toBe(1);
  await expect(withLegacyReportScope(`:${report}`, () => measurement.claim(report, 'SELECT 2'))).rejects.toThrow();
  await expect(measurement.requireOpen('/other')).rejects.toThrow();
 });
});
