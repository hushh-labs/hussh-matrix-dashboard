import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import type { Firestore } from '@google-cloud/firestore';
import type { Query } from '@google-cloud/bigquery';
import { canonicalAnalyticsKey } from './aggregate-cache';
import { cohortMatchesSnapshotWitness, cohortSnapshotWitness, requireFreshCohort, requireCurrentCustomerCohort, type CustomerCohort } from './one-customer-cohort';
import { ClosedJobMissingError, currentLegacyReportKey, freezeRestorationSql, nativeDatabase, restorationReportDigest, type RestorationGrant } from './legacy-restoration';
import { composerMatchesCohort, verifiedDailyComposer } from './daily-one-composer';

/** Hard ceilings are safety bounds, not an approval or an operating target. */
export const DAILY_ONE_LIMITS = Object.freeze({ bytes: 1024 ** 4, jobs: 250, perJob: 64 * 1024 ** 3, lifetimeMs: 60 * 60_000 });
// The first current-day estimate was sealed by this exact reviewed producer.
// SQL is freshly estimated again by the executor before every new job.
const FIRST_MEASUREMENT_SOURCE = '3c6bb690a538d75b20c6dfc6494b9c0a8ae3bd58';
type Database = Pick<Firestore, 'doc' | 'runTransaction'>;
export type DailyRun = { source: string; policyGeneration: string; day: string; logicalAsOf: string; phase: 'open' | 'closed'; createdAt: number; expiresAt: number;
  reports: string[]; reportDigest: string; measurementId: string; measurementSource: string; measurementDigest: string; measurementScopes: Record<string, string>; scopeDigest: string;
  maxBytes: number; maxJobs: number; maxPerJobBytes: number; reservedBytes: number; reservedJobs: number;
  parentId?: string; parentSource?: string; parentReservedBytes?: number; parentReservedJobs?: number; parentCreatedAt?: number;
  parentDepth?: 2; parentOwnReservedBytes?: number; parentOwnReservedJobs?: number;
  newReportsDigest?: string; composerId?: string; composerSource?: string };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const recoveredReports = (run: DailyRun) => run.parentId ? run.parentDepth ?? 1 : 0;
export const dailyOnePolicyGeneration = (source: string, maxDailyBytes: number, maxDailyJobs: number, maxPerJobBytes: number) =>
  hash(JSON.stringify({ schema: 1, source, maxDailyBytes, maxDailyJobs, maxPerJobBytes }));
const fail = () => new Error('The bounded One refresh is unavailable.');
export function validOnePayload(value: { status?: number; body?: any }, report: string) {
  const url = new URL(report, 'http://analytics.internal'), environment = url.searchParams.get('environment');
  const start = url.searchParams.get('one_start_date'), end = url.searchParams.get('one_end_date');
  const data = value.body?.one?.data, one = environment === 'production' ? data?.production : data?.uat;
  const days = start && end ? (Date.parse(end) - Date.parse(start)) / 86_400_000 + 1 : NaN;
  return value.status === 200 && value.body?.one?.error == null && ['production', 'uat'].includes(environment ?? '')
    && one?.reportingEnvironment === environment && one?.reportingScopeVersion === 'one-environment-v1'
    && (environment === 'production' ? data?.uat === null : data?.production === null)
    && one?.range?.startDate === start && one?.range?.endDate === end && one?.range?.days === days
    && one?.activeUsers?.countingUnit === 'device' && one?.identifiedUsers?.countingUnit === 'account'
    && one?.identifiedUsers?.selectedRange?.startDate === start && one?.identifiedUsers?.selectedRange?.endDate === end;
}
const context = new AsyncLocalStorage<{ store: DailyOneRefresh; logicalAsOf: string; report: string; jobs: Map<string, number>; signal?: AbortSignal; cancel?: () => void }>();
export const currentDailyOneRefresh = () => context.getStore();
/** Internal operator scope only. Ordinary page reads never enter this context. */
export const withDailyOneRefresh = async <T>(store: DailyOneRefresh, report: string, load: () => Promise<T>, signal?: AbortSignal, cancel?: () => void) => {
  const { run } = await store.requireOpen(report);
  return context.run({ store, logicalAsOf: run.logicalAsOf, report, jobs: new Map(), signal, cancel }, load);
};

export function dailyOneManifest(dataDate: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataDate) || !Number.isFinite(Date.parse(dataDate)) || new Date(dataDate).toISOString().slice(0, 10) !== dataDate) throw fail();
  return ['production', 'uat'].flatMap(environment => [1, 7, 14, 30, 90].map(days => {
    const start = new Date(Date.parse(dataDate) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
    return canonicalAnalyticsKey(`/api/analytics/all?view=one&environment=${environment}&one_start_date=${start}&one_end_date=${dataDate}`);
  }));
}

export class DailyOneRefresh {
  constructor(private db: Database, private id: string, private source: string, private now = Date.now) {
    if (!/^refresh_\d{8}_[a-f0-9]{16}$/.test(id) || !/^[a-f0-9]{40}$/.test(source)) throw fail();
  }
  private ref() { return this.db.doc(`metricsOneDailyRuns/${this.id}`); }
  private async checked(read: (ref: any) => Promise<any>, remainingDepth = 2, requireComposer = true): Promise<{ run: DailyRun; policy: any; parent?: DailyRun; depth: number; rootId: string; rootSource: string; measurementExpiresAt: number }> {
    const run = (await read(this.ref())).data() as DailyRun | undefined;
    if (!run || run.source !== this.source || !/^[a-f0-9]{64}$/.test(run.policyGeneration ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(run.day ?? '')
      || this.id.slice(8, 16) !== run.day.replaceAll('-', '') || !Number.isFinite(Date.parse(run.logicalAsOf)) || new Date(run.logicalAsOf).toISOString() !== run.logicalAsOf
      || run.logicalAsOf.slice(0, 10) > run.day || Date.parse(run.day) - Date.parse(run.logicalAsOf.slice(0, 10)) > 86_400_000
      || !Number.isSafeInteger(run.createdAt) || !Number.isSafeInteger(run.expiresAt) || run.expiresAt <= run.createdAt || run.expiresAt - run.createdAt > DAILY_ONE_LIMITS.lifetimeMs
      || Date.parse(run.logicalAsOf) > run.createdAt || new Date(run.createdAt).toISOString().slice(0, 10) !== run.day || !/^[a-f0-9]{64}$/.test(run.measurementDigest ?? '')
      || !/^dailymeasure_\d{8}_[a-f0-9]{16}$/.test(run.measurementId ?? '') || run.measurementId.slice(13, 21) !== run.day.replaceAll('-', '')
      || ![this.source, FIRST_MEASUREMENT_SOURCE].includes(run.measurementSource)
      || !['open', 'closed'].includes(run.phase) || !Array.isArray(run.reports) || run.reportDigest !== restorationReportDigest(run.reports)
      || restorationReportDigest(dailyOneManifest(run.logicalAsOf.slice(0, 10))) !== run.reportDigest
      || !run.measurementScopes || typeof run.measurementScopes !== 'object' || Array.isArray(run.measurementScopes)
      || Object.keys(run.measurementScopes).length !== run.reports.length
      || run.reports.some(report => !/^[a-f0-9]{64}$/.test(run.measurementScopes[hash(report)] ?? ''))
      || run.scopeDigest !== hash(JSON.stringify(Object.entries(run.measurementScopes).sort(([a], [b]) => a.localeCompare(b))))
      || !Number.isSafeInteger(run.maxBytes) || run.maxBytes < 1 || run.maxBytes > DAILY_ONE_LIMITS.bytes || !Number.isSafeInteger(run.maxJobs) || run.maxJobs < 1 || run.maxJobs > DAILY_ONE_LIMITS.jobs
      || !Number.isSafeInteger(run.maxPerJobBytes) || run.maxPerJobBytes < 1 || run.maxPerJobBytes > DAILY_ONE_LIMITS.perJob
      || !Number.isSafeInteger(run.reservedBytes) || run.reservedBytes < 0 || run.reservedBytes > run.maxBytes || !Number.isSafeInteger(run.reservedJobs) || run.reservedJobs < 0 || run.reservedJobs > run.maxJobs) throw fail();
    let parent: DailyRun | undefined, depth = 0, rootId = this.id, rootSource = this.source;
    if (run.parentId !== undefined) {
      if (remainingDepth < 1) throw fail();
      if (!/^refresh_\d{8}_[a-f0-9]{16}$/.test(run.parentId) || run.parentId === this.id || !/^[a-f0-9]{40}$/.test(run.parentSource ?? '')) throw fail();
      const lineage = await new DailyOneRefresh(this.db, run.parentId, run.parentSource!, this.now).checked(read, remainingDepth - 1);
      parent = lineage.run; depth = lineage.depth + 1; rootId = lineage.rootId; rootSource = lineage.rootSource;
      if (depth > 2 || (depth === 1 ? run.parentDepth !== undefined || run.parentOwnReservedBytes !== undefined || run.parentOwnReservedJobs !== undefined
        : run.parentDepth !== 2 || run.parentOwnReservedBytes !== parent.reservedBytes || run.parentOwnReservedJobs !== parent.reservedJobs)
        || parent.phase !== 'closed' || parent.day !== run.day || parent.logicalAsOf !== run.logicalAsOf
        || parent.reports.length !== run.reports.length || parent.reports.some((report, index) => report !== run.reports[index])
        || parent.reportDigest !== run.reportDigest || parent.scopeDigest !== run.scopeDigest || parent.policyGeneration !== run.policyGeneration
        || parent.reservedBytes + (parent.parentReservedBytes ?? 0) !== run.parentReservedBytes || parent.reservedJobs + (parent.parentReservedJobs ?? 0) !== run.parentReservedJobs || parent.createdAt !== run.parentCreatedAt
        || run.newReportsDigest !== restorationReportDigest(run.reports.slice(depth)) || !/^dailycomposer_[a-f0-9]{16}$/.test(run.composerId ?? '')
        || run.composerSource !== this.source
        || run.maxBytes + run.parentReservedBytes! > DAILY_ONE_LIMITS.bytes || run.maxJobs + run.parentReservedJobs! > DAILY_ONE_LIMITS.jobs) throw fail();
    } else if (run.parentSource !== undefined || run.parentReservedBytes !== undefined || run.parentReservedJobs !== undefined || run.parentCreatedAt !== undefined
      || run.parentDepth !== undefined || run.parentOwnReservedBytes !== undefined || run.parentOwnReservedJobs !== undefined
      || run.newReportsDigest !== undefined || run.composerId !== undefined || run.composerSource !== undefined) throw fail();
    const [policySnap, approvalSnap, slotSnap, measurementSnap, measurementRunSnap] = await Promise.all([
      read(this.db.doc(`metricsOneDailyPolicies/${run.policyGeneration}`)), read(this.db.doc(`metricsOneDailyApprovals/${this.id}`)), read(this.db.doc(`metricsOneDailySlots/${run.day}`)), read(this.db.doc(`metricsOneDailyMeasurements/${this.id}`)),
      read(this.db.doc(`metricsOneDailyMeasurements/${run.measurementId}`)),
    ]);
    const policy = policySnap.data(), approval = approvalSnap.data(), slot = slotSnap.data(), measurement = measurementSnap.data(), measurementRun = measurementRunSnap.data();
    const keys = ['source','policyGeneration','day','logicalAsOf','createdAt','expiresAt','reportDigest','measurementId','measurementSource','measurementDigest','scopeDigest','maxBytes','maxJobs','maxPerJobBytes'] as const;
    if (!policySnap.exists || policy?.approved !== true || policy.generation !== run.policyGeneration || policy.source !== rootSource
      || !Number.isSafeInteger(policy.maxDailyBytes) || policy.maxDailyBytes < run.maxBytes + (run.parentReservedBytes ?? 0) || policy.maxDailyBytes > DAILY_ONE_LIMITS.bytes
      || !Number.isSafeInteger(policy.maxDailyJobs) || policy.maxDailyJobs < run.maxJobs + (run.parentReservedJobs ?? 0) || policy.maxDailyJobs > DAILY_ONE_LIMITS.jobs
      || !Number.isSafeInteger(policy.maxPerJobBytes) || policy.maxPerJobBytes < run.maxPerJobBytes || policy.maxPerJobBytes > DAILY_ONE_LIMITS.perJob
      || dailyOnePolicyGeneration(policy.source, policy.maxDailyBytes, policy.maxDailyJobs, policy.maxPerJobBytes) !== run.policyGeneration
      || !approvalSnap.exists || approval?.approved !== true || approval?.runId !== this.id || keys.some(key => approval[key] !== run[key])
      || !measurementSnap.exists || measurement?.phase !== 'sealed' || measurement.runId !== this.id || measurement.source !== run.measurementSource
      || measurement.day !== run.day || measurement.logicalAsOf !== run.logicalAsOf || measurement.reportDigest !== run.reportDigest
      || measurement.digest !== run.measurementDigest || measurement.coverage !== 'not exhaustive' || !Number.isSafeInteger(measurement.sealedAt) || measurement.sealedAt > run.createdAt
      || !measurementRunSnap.exists || measurementRun?.phase !== 'closed' || measurementRun.source !== run.measurementSource
      || measurementRun.targetRunId !== this.id || measurementRun.day !== run.day || measurementRun.logicalAsOf !== run.logicalAsOf
      || measurementRun.reportDigest !== run.reportDigest || !Number.isSafeInteger(measurementRun.expiresAt)
      || measurement.sealedAt > measurementRun.expiresAt || run.expiresAt > measurementRun.expiresAt
      || !Number.isSafeInteger(measurement.measuredBytes) || measurement.measuredBytes < 0 || measurement.measuredBytes > run.maxBytes
      || !Number.isSafeInteger(measurement.measuredQueries) || measurement.measuredQueries < 1 || measurement.measuredQueries > (parent ? DAILY_ONE_LIMITS.jobs : run.maxJobs)
      || !slotSnap.exists || slot?.state !== 'sealed' || slot?.runId !== rootId || slot.day !== run.day || slot.source !== rootSource || slot.policyGeneration !== run.policyGeneration) throw fail();
    if (parent) {
      const claim = (await read(this.db.doc(`metricsOneDailyContinuationClaims/${run.parentId}`))).data();
      const fields = ['source','day','logicalAsOf','createdAt','expiresAt','reportDigest','newReportsDigest','composerId','composerSource','scopeDigest','measurementId','measurementSource','measurementDigest','maxBytes','maxJobs','maxPerJobBytes','parentId','parentSource','parentReservedBytes','parentReservedJobs','parentCreatedAt','parentDepth','parentOwnReservedBytes','parentOwnReservedJobs'] as const;
      if (!claim || claim.runId !== this.id || claim.approved !== true || fields.some(key => claim[key] !== run[key] || approval[key] !== run[key])) throw fail();
      if (requireComposer) await verifiedDailyComposer(read, this.db, this.id, run, validOnePayload, this.now());
    }
    return { run, policy, parent, depth, rootId, rootSource, measurementExpiresAt: measurementRun.expiresAt as number };
  }
  private permit() { return this.checked(ref => ref.get()); }
  async compositionIn(read: (ref: any) => Promise<any>) {
    const { run, parent, measurementExpiresAt } = await this.checked(read, 2, false), now = this.now();
    if (!parent || !run.parentId || !run.parentSource || run.phase !== 'open' || now < run.createdAt || now >= run.expiresAt
      || now >= measurementExpiresAt || new Date(now).toISOString().slice(0, 10) !== run.day) throw fail();
    return { run, parent };
  }
  async parentForComposition() {
    const { run } = await this.compositionIn(ref => ref.get());
    return { run, childId: this.id, parent: new DailyOneRefresh(this.db, run.parentId!, run.parentSource!, this.now) };
  }
  /** Read only the original closed run's exact reservation; never admits work. */
  async closedDescriptor() {
    const { run } = await this.permit();
    if (run.phase !== 'closed') throw fail();
    return { id: this.id, asOf: run.logicalAsOf, run };
  }
  async closedJob(request: Query) {
    const { run } = await this.closedDescriptor();
    if (typeof request.query !== 'string' || request.params !== undefined || request.types !== undefined) throw fail();
    const query = freezeRestorationSql(request.query, run.logicalAsOf);
    const { planHash, report, scopeHash } = this.identity(run, query);
    const snapshot = await this.ref().collection('reservations').doc(planHash).get();
    if (!snapshot.exists) throw new ClosedJobMissingError(planHash, undefined);
    const row = snapshot.data(), id = `metrics_${this.id}_${planHash}`;
    if (row?.jobId !== id || row.state !== 'started' || row.reportHash !== hash(report) || row.scopeHash !== scopeHash
      || !Number.isSafeInteger(row.bytes) || row.bytes < 1 || row.bytes > run.maxPerJobBytes) throw fail();
    return { id, bytes: row.bytes as number, query };
  }
  async isPreparing() {
    try { const { run, measurementExpiresAt } = await this.permit(), now = this.now();
      return run.phase === 'open' && now >= run.createdAt && now < run.expiresAt && now < measurementExpiresAt && new Date(now).toISOString().slice(0, 10) === run.day;
    } catch { return false; }
  }
  async expandedPreparing() { return this.isPreparing(); }
  async perJobCeiling() { const { run } = await this.permit(); if (!await this.isPreparing()) throw fail(); return run.maxPerJobBytes; }
  async requireOpen(report: string) {
    const value = await this.permit(), now = this.now();
    if (currentDailyOneRefresh()?.signal?.aborted || value.run.phase !== 'open' || now < value.run.createdAt || now >= value.run.expiresAt || now >= value.measurementExpiresAt || new Date(now).toISOString().slice(0, 10) !== value.run.day || !value.run.reports.includes(report)
      || value.run.reports.slice(0, recoveredReports(value.run)).includes(report)) throw fail();
    return value;
  }
  /** Check every measured lane before any paid work, without using the
   * production cohort as the UAT report's data population. */
  async verifyMeasuredCohort(cohort: CustomerCohort) {
    requireFreshCohort(cohort);
    if (!/^[a-f0-9]{64}$/.test(cohort.cacheKey)) throw fail();
    const { run } = await this.permit();
    for (const report of run.reports) {
      const environment = new URL(report, 'http://analytics.internal').searchParams.get('environment');
      const prefix = environment === 'production' ? cohort.cacheKey : environment === 'uat' ? '' : null;
      if (prefix === null || run.measurementScopes[hash(report)] !== hash(`${prefix}:${report}`)) throw fail();
    }
  }
  private identity(run: DailyRun, query: string) {
    const scope = currentLegacyReportKey(), separator = scope?.indexOf(':') ?? -1;
    const cohortScope = scope?.slice(0, separator) ?? '', report = scope?.slice(separator + 1) ?? '';
    if (separator < 0 || (currentDailyOneRefresh() && currentDailyOneRefresh()?.report !== report) || !/^(?:[a-f0-9]{64})?$/.test(cohortScope) || !run.reports.includes(report) || !/^(?:SELECT|WITH)\b/i.test(query.trim())) throw fail();
    const environment = new URL(report, 'http://analytics.internal').searchParams.get('environment');
    if ((environment === 'production' && !/^[a-f0-9]{64}$/.test(cohortScope)) || (environment === 'uat' && cohortScope !== '') || !['production', 'uat'].includes(environment ?? '')) throw fail();
    if (run.measurementScopes[hash(report)] !== hash(scope!)) throw fail();
    const planHash = hash(JSON.stringify({ schema: 1, run: this.id, source: this.source, cohortScope, report, project: 'hushh-ai-prod', location: 'US', asOf: run.logicalAsOf, query }));
    return { planHash, report, scopeHash: hash(scope!) };
  }
  async prepare(request: Query) {
    const { run } = await this.permit();
    if (run.phase !== 'open' || this.now() >= run.expiresAt || typeof request.query !== 'string' || request.params !== undefined || request.types !== undefined) throw fail();
    return { ...request, query: freezeRestorationSql(request.query, run.logicalAsOf) };
  }
  async existing(request: Query): Promise<RestorationGrant | undefined> {
    const { run } = await this.permit(); if (typeof request.query !== 'string') throw fail();
    const { planHash, report, scopeHash } = this.identity(run, request.query); await this.requireOpen(report);
    const ref = this.ref().collection('reservations').doc(planHash), snapshot = await ref.get(); if (!snapshot.exists) return undefined;
    const row = snapshot.data(), id = `metrics_${this.id}_${planHash}`;
    if (row?.jobId !== id || row.scopeHash !== scopeHash || row.reportHash !== hash(report) || !Number.isSafeInteger(row.bytes) || row.bytes < 1 || row.bytes > run.maxPerJobBytes || !['reserved','started'].includes(row.state)) throw fail();
    return row.state === 'started' ? { permitId: this.id, planHash, id, bytes: row.bytes, report, scopeHash, reuse: { key: '', priorPlanHash: planHash } } as RestorationGrant : undefined;
  }
  async admit(request: Query, estimated: number): Promise<RestorationGrant> {
    const { run } = await this.permit(); if (typeof request.query !== 'string' || !Number.isSafeInteger(estimated) || estimated < 0) throw fail();
    const { planHash, report, scopeHash } = this.identity(run, request.query); await this.requireOpen(report);
    const unit = 10 * 1024 ** 2, bytes = Math.max(unit, Math.ceil(estimated / unit) * unit + unit);
    if (!Number.isSafeInteger(bytes) || bytes > run.maxPerJobBytes) throw fail();
    return { permitId: this.id, planHash, id: `metrics_${this.id}_${planHash}`, bytes, report, scopeHash } as RestorationGrant;
  }
  async reserve(grant: RestorationGrant) {
    if (grant.permitId !== this.id || !/^[a-f0-9]{64}$/.test(grant.planHash) || !grant.report || !Number.isSafeInteger(grant.bytes) || grant.bytes < 1) throw fail();
    const scope = currentLegacyReportKey();
    if (!scope || !grant.report || !scope.endsWith(`:${grant.report}`)) throw fail();
    const scopeHash = hash(scope), reportHash = hash(grant.report);
    if ((grant as RestorationGrant & { scopeHash?: string }).scopeHash !== scopeHash) throw fail();
    await this.db.runTransaction(async tx => {
      const { run, policy } = await this.checked(ref => tx.get(ref)), now = this.now();
      if (run.phase !== 'open' || now < run.createdAt || now >= run.expiresAt || new Date(now).toISOString().slice(0, 10) !== run.day || !run.reports.includes(grant.report!) || grant.bytes > run.maxPerJobBytes) throw fail();
      if (grant.id !== `metrics_${this.id}_${grant.planHash}` || run.reports.slice(0, recoveredReports(run)).includes(grant.report!)) throw fail();
      const dayRef = this.db.doc(`metricsOneDailyBudgets/${run.day}`), reservation = this.ref().collection('reservations').doc(grant.planHash);
      const [daySnap, reservationSnap] = await Promise.all([tx.get(dayRef), tx.get(reservation)]), day = daySnap.data();
      if (currentDailyOneRefresh()?.signal?.aborted) throw fail();
      if (reservationSnap.exists) { const old = reservationSnap.data(); if (old.jobId !== grant.id || old.bytes !== grant.bytes || old.scopeHash !== scopeHash || old.reportHash !== reportHash || !['reserved','started'].includes(old.state)) throw fail(); return; }
      if (!daySnap.exists || day?.day !== run.day || day.policyGeneration !== run.policyGeneration || !Number.isSafeInteger(day.reservedBytes) || day.reservedBytes < 0
        || !Number.isSafeInteger(day.reservedJobs) || day.reservedJobs < 0 || day.reservedBytes !== (run.parentReservedBytes ?? 0) + run.reservedBytes
        || day.reservedJobs !== (run.parentReservedJobs ?? 0) + run.reservedJobs || run.reservedBytes + grant.bytes > run.maxBytes || run.reservedJobs + 1 > run.maxJobs
        || day.reservedBytes + grant.bytes > policy.maxDailyBytes || day.reservedJobs + 1 > policy.maxDailyJobs) throw fail();
      tx.update(dayRef, { reservedBytes: day.reservedBytes + grant.bytes, reservedJobs: day.reservedJobs + 1 });
      tx.update(this.ref(), { reservedBytes: run.reservedBytes + grant.bytes, reservedJobs: run.reservedJobs + 1 });
      tx.create(reservation, { jobId: grant.id, bytes: grant.bytes, scopeHash, reportHash, state: 'reserved', reservedAt: now });
    });
  }
  /** Stage a write-once aggregate; readers only use it after this run closes. */
  async save(report: string, value: { status: number; body: unknown }, jobs: Array<{ id: string; endedAt: number }>, cohort: CustomerCohort | null) {
    const active = currentDailyOneRefresh(), scope = currentLegacyReportKey();
    const { run } = await this.requireOpen(report), computedAt = this.now(), json = JSON.stringify(value);
    if (!active || active.signal?.aborted || active.store !== this || active.report !== report || active.jobs.size !== jobs.length
      || jobs.some(job => active.jobs.get(job.id) !== job.endedAt) || scope !== `${cohort?.cacheKey ?? ''}:${report}`) throw fail();
    const environment = new URL(report, 'http://analytics.internal').searchParams.get('environment');
    const witness = cohort ? cohortSnapshotWitness(cohort) : null;
    if (!validOnePayload(value, report) || Buffer.byteLength(json) > 700_000 || !jobs.length || jobs.length > DAILY_ONE_LIMITS.jobs
      || (environment === 'production' ? !witness : environment !== 'uat' || !!cohort)
      || new Set(jobs.map(job => job.id)).size !== jobs.length
      || jobs.some(job => !new RegExp(`^metrics_${this.id}_[a-f0-9]{64}$`).test(job.id)
        || !Number.isSafeInteger(job.endedAt) || job.endedAt < run.createdAt || job.endedAt > computedAt + 10_000)) throw fail();
    const reportHash = hash(report), target = this.ref().collection('snapshots').doc(reportHash);
    if (cohort) await requireCurrentCustomerCohort(cohort.cacheKey);
    if (active.signal?.aborted) throw fail();
    // A Firestore commit already dispatched may complete after a disconnect.
    // Reads still require a verified payload, current cohort and all-ten activation.
    await this.db.runTransaction(async tx => {
      const { run: live } = await this.checked(ref => tx.get(ref)), now = this.now();
      if (live.phase !== 'open' || now < live.createdAt || now >= live.expiresAt || new Date(now).toISOString().slice(0, 10) !== live.day || !live.reports.includes(report)
        || live.reports.slice(0, recoveredReports(live)).includes(report)) throw fail();
      if (cohort) requireFreshCohort(cohort);
      const existing = await tx.get(target);
      const reservations = await Promise.all(jobs.map(job => tx.get(this.ref().collection('reservations').doc(job.id.slice(-64)))));
      if (active.signal?.aborted) throw fail();
      if (existing.exists || reservations.some((snapshot, index) => !snapshot.exists || snapshot.data()?.jobId !== jobs[index].id || snapshot.data()?.state !== 'started' || snapshot.data()?.scopeHash !== hash(scope!) || snapshot.data()?.reportHash !== reportHash || !Number.isSafeInteger(snapshot.data()?.startedAt)
        || snapshot.data()?.startedAt > jobs[index].endedAt)) throw fail();
      tx.create(target, { schema: 1, state: 'pending', source: this.source, measurementId: live.measurementId, measurementSource: live.measurementSource,
        measurementDigest: live.measurementDigest, scopeDigest: live.scopeDigest, runId: this.id, reportHash, dataAsOf: live.logicalAsOf,
        computedAt, sourceCoverage: 'intraday-or-unknown', nonWarehouseFreshness: 'unknown', jobs, json,
        ...(live.parentId ? { parentId: live.parentId, parentSource: live.parentSource } : {}), ...(witness ? { witness } : {}) });
    });
    if (cohort) await requireCurrentCustomerCohort(cohort.cacheKey);
    if (active.signal?.aborted) throw fail();
    await this.db.runTransaction(async tx => {
      const { run: live } = await this.checked(ref => tx.get(ref)), snapshot = await tx.get(target), now = this.now();
      if (active.signal?.aborted) throw fail();
      if (live.phase !== 'open' || now < live.createdAt || now >= live.expiresAt || new Date(now).toISOString().slice(0, 10) !== live.day
        || !snapshot.exists || snapshot.data()?.state !== 'pending' || snapshot.data()?.computedAt !== computedAt) throw fail();
      if (cohort) requireFreshCohort(cohort);
      tx.update(target, { state: 'verified' });
    });
    return computedAt;
  }
  async read(report: string, cohort: CustomerCohort | null, requireActive = true, activationCohort: CustomerCohort | null = cohort) {
    const { run } = await this.permit();
    if (run.phase !== 'closed' || !run.reports.includes(report)) return null;
    if (requireActive) {
      const full = (await this.ref().collection('activation').doc('current').get()).data();
      const activation = full ?? (await this.ref().collection('activation').doc('partial').get()).data();
      if (!activation || activation.source !== this.source || activation.runId !== this.id || activation.reportDigest !== run.reportDigest
        || activation.logicalAsOf !== run.logicalAsOf || activation.state !== 'active' || !activation.witness || !activationCohort
        || !cohortMatchesSnapshotWitness(activationCohort, activation.witness)
        || (!full && (!Array.isArray(activation.reports) || !activation.reports.includes(hash(report))))) return null;
    }
    const environment = new URL(report, 'http://analytics.internal').searchParams.get('environment');
    if (environment === 'production' ? !cohort : environment !== 'uat' || !!cohort) return null;
    if (run.parentDepth === 2 && report === run.reports[0]) {
      return new DailyOneRefresh(this.db, run.parentId!, run.parentSource!, this.now).read(report, cohort, false);
    }
    if (run.parentId && report === run.reports[recoveredReports(run) - 1]) {
      if (!cohort) return null;
      const snapshot = await verifiedDailyComposer(ref => ref.get(), this.db, this.id, run, validOnePayload, this.now());
      if (!composerMatchesCohort(snapshot, cohort) || snapshot.computedAt > this.now() || this.now() - Date.parse(run.logicalAsOf) > 90 * 86_400_000) return null;
      let value: { status?: number; body?: unknown }; try { value = JSON.parse(snapshot.json); } catch { return null; }
      if (!validOnePayload(value, report)) return null;
      const times = snapshot.jobs.map((job: { endedAt: number }) => job.endedAt);
      return { value, asOf: run.logicalAsOf, computedAt: snapshot.computedAt as number, warehouseFrom: Math.min(...times), warehouseThrough: Math.max(...times), cohortAsOf: snapshot.witness.asOf as string };
    }
    const row = (await this.ref().collection('snapshots').doc(hash(report)).get()).data();
    if (!row || row.schema !== 1 || row.state !== 'verified' || row.source !== this.source || row.measurementId !== run.measurementId || row.measurementSource !== run.measurementSource
      || row.measurementDigest !== run.measurementDigest || row.scopeDigest !== run.scopeDigest || row.runId !== this.id || row.reportHash !== hash(report)
      || row.parentId !== run.parentId || row.parentSource !== run.parentSource
      || row.dataAsOf !== run.logicalAsOf || row.sourceCoverage !== 'intraday-or-unknown' || row.nonWarehouseFreshness !== 'unknown'
      || !Number.isSafeInteger(row.computedAt) || row.computedAt < run.createdAt || row.computedAt > this.now()
      || this.now() - Date.parse(run.logicalAsOf) > 90 * 86_400_000 || typeof row.json !== 'string' || Buffer.byteLength(row.json) > 700_000
      || !Array.isArray(row.jobs) || !row.jobs.length || row.jobs.length > DAILY_ONE_LIMITS.jobs
      || new Set(row.jobs.map((job: any) => job.id)).size !== row.jobs.length
      || row.jobs.some((job: any) => typeof job.id !== 'string' || !new RegExp(`^metrics_${this.id}_[a-f0-9]{64}$`).test(job.id)
        || !Number.isSafeInteger(job.endedAt) || job.endedAt < run.createdAt || job.endedAt > row.computedAt + 10_000)
      || (cohort ? !row.witness || !cohortMatchesSnapshotWitness(cohort, row.witness) : !!row.witness)) return null;
    let value: { status?: number; body?: unknown };
    try { value = JSON.parse(row.json); } catch { return null; }
    if (!validOnePayload(value, report)) return null;
    const times = row.jobs.map((job: { endedAt: number }) => job.endedAt);
    return { value, asOf: row.dataAsOf as string, computedAt: row.computedAt as number, warehouseFrom: Math.min(...times), warehouseThrough: Math.max(...times),
      ...(row.witness ? { cohortAsOf: row.witness.asOf as string } : {}) };
  }
  /** Publish only independently verified reports, without changing the complete-set anchor. */
  async activatePartial(cohort: CustomerCohort) {
    const { run } = await this.permit();
    const witness = cohortSnapshotWitness(cohort);
    if (run.phase !== 'closed' || !witness) throw fail();
    await requireCurrentCustomerCohort(cohort.cacheKey);
    const values = await Promise.all(run.reports.map(report => {
      const environment = new URL(report, 'http://analytics.internal').searchParams.get('environment');
      return environment === 'production' ? this.read(report, cohort, false) : null;
    }));
    const reports = run.reports.filter((_, index) => values[index]?.asOf === run.logicalAsOf).map(hash);
    if (!reports.length || reports.length === run.reports.length) throw fail();
    await requireCurrentCustomerCohort(cohort.cacheKey);
    const activation = this.ref().collection('activation').doc('partial');
    await this.db.runTransaction(async tx => {
      const { run: live } = await this.checked(ref => tx.get(ref)), existing = await tx.get(activation);
      const own = live.reports.slice(recoveredReports(live)).filter(report => reports.includes(hash(report)));
      const snapshots = await Promise.all(own.map(report => tx.get(this.ref().collection('snapshots').doc(hash(report)))));
      if (live.phase !== 'closed' || live.logicalAsOf !== run.logicalAsOf || live.reportDigest !== run.reportDigest || existing.exists
        || snapshots.some((snapshot, index) => !snapshot.exists || snapshot.data()?.state !== 'verified'
          || snapshot.data()?.source !== this.source || snapshot.data()?.reportHash !== hash(own[index]))) throw fail();
      requireFreshCohort(cohort);
      tx.create(activation, { state: 'active', source: this.source, runId: this.id, reportDigest: live.reportDigest, logicalAsOf: live.logicalAsOf, witness, reports, activatedAt: this.now() });
    });
    return reports.length;
  }
  async partialReports(cohort: CustomerCohort) {
    const { run } = await this.permit();
    if (run.phase !== 'closed' || !(await this.ref().collection('activation').doc('partial').get()).exists) return [];
    const rows = await Promise.all(run.reports.map(async report => {
      const query = new URL(report, 'http://analytics.internal').searchParams;
      if (query.get('environment') !== 'production' || !await this.read(report, cohort, true, cohort)) return null;
      const startDate = query.get('one_start_date'), endDate = query.get('one_end_date');
      return startDate && endDate ? { startDate, endDate } : null;
    }));
    return rows.filter((row): row is { startDate: string; endDate: string } => !!row);
  }
  /** Make the complete, closed set visible together; no warehouse work occurs. */
  async activate(cohort: CustomerCohort) {
    const { run } = await this.permit();
    const witness = cohortSnapshotWitness(cohort);
    if (run.phase !== 'closed' || !witness) throw fail();
    await requireCurrentCustomerCohort(cohort.cacheKey);
    const values = await Promise.all(run.reports.map(report => {
      const environment = new URL(report, 'http://analytics.internal').searchParams.get('environment');
      return this.read(report, environment === 'production' ? cohort : null, false);
    }));
    if (values.some(value => value?.asOf !== run.logicalAsOf)) throw fail();
    await requireCurrentCustomerCohort(cohort.cacheKey);
    const activation = this.ref().collection('activation').doc('current');
    await this.db.runTransaction(async tx => {
      const { run: live } = await this.checked(ref => tx.get(ref)), existing = await tx.get(activation);
      const reports = live.reports.slice(recoveredReports(live));
      const snapshots = await Promise.all(reports.map(report => tx.get(this.ref().collection('snapshots').doc(hash(report)))));
      if (live.phase !== 'closed' || live.logicalAsOf !== run.logicalAsOf || live.reportDigest !== run.reportDigest || existing.exists
        || snapshots.some((snapshot, index) => !snapshot.exists || snapshot.data()?.state !== 'verified'
          || snapshot.data()?.source !== this.source || snapshot.data()?.reportHash !== hash(reports[index]))) throw fail();
      requireFreshCohort(cohort);
      tx.create(activation, { state: 'active', source: this.source, runId: this.id, reportDigest: live.reportDigest, logicalAsOf: live.logicalAsOf, witness, activatedAt: this.now() });
    });
    return run.logicalAsOf;
  }
  /** A new calendar anchor is offered only when both lanes have every preset. */
  async publicationAsOf(cohort: CustomerCohort) {
    const { run } = await this.permit();
    if (run.phase !== 'closed') return null;
    const publications = await Promise.all(run.reports.map(report => {
      const environment = new URL(report, 'http://analytics.internal').searchParams.get('environment');
      return this.read(report, environment === 'production' ? cohort : null, true, cohort);
    }));
    return publications.every(value => value?.asOf === run.logicalAsOf) ? run.logicalAsOf : null;
  }
  /** Write the uncertain-submission fence before any native job creation. */
  async claimSubmission(grant: RestorationGrant): Promise<boolean> {
    if (grant.permitId !== this.id || !/^[a-f0-9]{64}$/.test(grant.planHash) || !Number.isSafeInteger(grant.bytes) || grant.bytes < 1) throw fail();
    const scope = currentLegacyReportKey();
    if (!scope || !grant.report || !scope.endsWith(`:${grant.report}`)) throw fail();
    if ((grant as RestorationGrant & { scopeHash?: string }).scopeHash !== hash(scope)) throw fail();
    return this.db.runTransaction(async tx => {
      const { run } = await this.checked(ref => tx.get(ref)), now = this.now();
      if (run.phase !== 'open' || now < run.createdAt || now >= run.expiresAt || new Date(now).toISOString().slice(0, 10) !== run.day || !grant.report || !run.reports.includes(grant.report)) throw fail();
      if (grant.id !== `metrics_${this.id}_${grant.planHash}` || run.reports.slice(0, recoveredReports(run)).includes(grant.report!)) throw fail();
      const ref = this.ref().collection('reservations').doc(grant.planHash), snapshot = await tx.get(ref), row = snapshot.data();
      if (currentDailyOneRefresh()?.signal?.aborted) throw fail();
      if (!snapshot.exists || row.jobId !== grant.id || row.bytes !== grant.bytes || row.scopeHash !== hash(scope) || row.reportHash !== hash(grant.report!) || !['reserved','started'].includes(row.state)) throw fail();
      if (row.state === 'started') return false;
      tx.update(ref, { state: 'started', startedAt: now }); return true;
    });
  }
}

let configured: { key: string; promise: Promise<DailyOneRefresh> } | undefined;
/** Optional private operator configuration; ordinary reads never enter its scope. */
export async function dailyOneRefresh(): Promise<DailyOneRefresh | null> {
  const id = process.env.METRICS_DAILY_ONE_ID, source = process.env.METRICS_DAILY_ONE_SOURCE;
  if (!id && !source) return null;
  if (!/^refresh_\d{8}_[a-f0-9]{16}$/.test(id ?? '') || !/^[a-f0-9]{40}$/.test(source ?? '')) throw fail();
  const key = `${id}:${source}`;
  if (configured?.key !== key) configured = { key, promise: nativeDatabase().then(db => new DailyOneRefresh(db, id!, source!)) };
  return configured.promise;
}
