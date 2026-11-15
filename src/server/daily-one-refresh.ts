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
  parentDepth?: 2 | 3 | 4 | 5; parentOwnReservedBytes?: number; parentOwnReservedJobs?: number; parentPartialDigest?: string;
  ancestorId?: string; ancestorSource?: string; legacyAncestorId?: string; legacyAncestorSource?: string; parentSnapshotsDigest?: string;
  newReportsDigest?: string; composerId?: string; composerSource?: string };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const recoveredReports = (run: DailyRun) => run.parentId ? (run.parentDepth === 5 ? [0, 1, 2, 3, 5, 6, 7] : run.parentDepth === 4 ? [0, 1, 2, 3, 5, 6] : Array.from({ length: (run.parentDepth ?? 0) >= 3 ? 4 : run.parentDepth ?? 1 }, (_, index) => index)).map(index => run.reports[index]) : [];
const newReports = (run: DailyRun) => run.reports.filter(report => !recoveredReports(run).includes(report));
const jobOwner = (run: DailyRun, id: string, runId: string, report: string) => {
  if (new RegExp(`^metrics_${runId}_[a-f0-9]{64}$`).test(id)) return runId;
  const prior = run.parentDepth === 5 ? report === run.reports[4] ? run.legacyAncestorId : report === run.reports[8] ? run.parentId : undefined
    : run.parentDepth === 4 ? report === run.reports[4] ? run.ancestorId : report === run.reports[7] ? run.parentId : undefined
    : run.parentDepth === 3 && report === run.reports[4] ? run.parentId : undefined;
  if (prior && new RegExp(`^metrics_${prior}_[a-f0-9]{64}$`).test(id)) return prior;
  return null;
};
const ownerRun = (run: DailyRun, parent: DailyRun | undefined, grandparent: DailyRun | undefined, greatGrandparent: DailyRun | undefined, owner: string | null, current: string) =>
  owner === current ? run : owner === run.parentId ? parent : owner === run.ancestorId ? grandparent : owner === run.legacyAncestorId ? greatGrandparent : undefined;
const matchesLineage = (run: DailyRun, gate: CustomerCohort | undefined, parentPartial: any, inheritedPartial: any, olderPartial: any) =>
  !!gate && cohortMatchesSnapshotWitness(gate, parentPartial?.witness)
  && ((run.parentDepth ?? 0) < 4 || cohortMatchesSnapshotWitness(gate, inheritedPartial?.witness))
  && ((run.parentDepth ?? 0) < 5 || cohortMatchesSnapshotWitness(gate, olderPartial?.witness));
export const dailyPartialDigest = (activation: any) => hash(JSON.stringify([
  activation?.source, activation?.runId, activation?.reportDigest, activation?.logicalAsOf,
  activation?.witness?.policyRevision, activation?.witness?.rowsHash, activation?.witness?.asOf,
  ...(Array.isArray(activation?.reports) ? [...activation.reports].sort() : []),
]));
export const dailySnapshotDigest = (snapshot: any) => hash(JSON.stringify([
  snapshot?.schema, snapshot?.state, snapshot?.source, snapshot?.runId, snapshot?.parentId, snapshot?.parentSource,
  snapshot?.reportHash, snapshot?.dataAsOf, snapshot?.scopeDigest, snapshot?.measurementId, snapshot?.measurementSource,
  snapshot?.measurementDigest, snapshot?.computedAt, snapshot?.sourceCoverage, snapshot?.nonWarehouseFreshness, snapshot?.json,
  ...(Array.isArray(snapshot?.jobs) ? [...snapshot.jobs].sort((a, b) => String(a.id).localeCompare(String(b.id))).map(job => [job.id, job.endedAt, job.bytes]) : []),
]));
export const dailyOnePolicyGeneration = (source: string, maxDailyBytes: number, maxDailyJobs: number, maxPerJobBytes: number) =>
  hash(JSON.stringify({ schema: 1, source, maxDailyBytes, maxDailyJobs, maxPerJobBytes }));
const fail = () => new Error('The bounded One refresh is unavailable.');
type ReservationReason = 'scope' | 'lineage' | 'cohort' | 'window' | 'conflict' | 'ledger' | 'limit';
class ReservationHold extends Error {
  constructor(readonly reason: ReservationReason) { super('The bounded One refresh is unavailable.'); }
}
function reservationReason(error: unknown): ReservationReason | 'contention' | 'deadline' | 'unavailable' | 'resource-exhausted' | 'other' {
  if (error instanceof ReservationHold) return error.reason;
  const code = (error as { code?: unknown })?.code;
  if (code === 10 || code === 'ABORTED') return 'contention';
  if (code === 4 || code === 'DEADLINE_EXCEEDED') return 'deadline';
  if (code === 14 || code === 'UNAVAILABLE') return 'unavailable';
  if (code === 8 || code === 'RESOURCE_EXHAUSTED') return 'resource-exhausted';
  if (error instanceof Error && error.message === 'Production customer membership could not be verified.') return 'cohort';
  return 'other';
}
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
const context = new AsyncLocalStorage<{ store: DailyOneRefresh; logicalAsOf: string; report: string; jobs: Map<string, number>; bounds: Map<string, number>; strictJobBounds: boolean; signal?: AbortSignal; cancel?: () => void; gateCohort?: CustomerCohort }>();
export const currentDailyOneRefresh = () => context.getStore();
/** Internal operator scope only. Ordinary page reads never enter this context. */
export const withDailyOneRefresh = async <T>(store: DailyOneRefresh, report: string, load: () => Promise<T>, signal?: AbortSignal, cancel?: () => void, gateCohort?: CustomerCohort) => {
  const { run } = await store.requireOpen(report);
  if ((run.parentDepth ?? 0) >= 3) { if (!gateCohort) throw fail(); await store.verifyMeasuredCohort(gateCohort); }
  return context.run({ store, logicalAsOf: run.logicalAsOf, report, jobs: new Map(), bounds: new Map(), strictJobBounds: (run.parentDepth ?? 0) >= 3, signal, cancel, gateCohort }, load);
};

export function dailyOneManifest(dataDate: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataDate) || !Number.isFinite(Date.parse(dataDate)) || new Date(dataDate).toISOString().slice(0, 10) !== dataDate) throw fail();
  return ['production', 'uat'].flatMap(environment => [1, 7, 14, 30, 90].map(days => {
    const start = new Date(Date.parse(dataDate) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
    return canonicalAnalyticsKey(`/api/analytics/all?view=one&environment=${environment}&one_start_date=${start}&one_end_date=${dataDate}`);
  }));
}

export class DailyOneRefresh {
  private reservationTail: Promise<void> = Promise.resolve();
  constructor(private db: Database, private id: string, private source: string, private now = Date.now) {
    if (!/^refresh_\d{8}_[a-f0-9]{16}$/.test(id) || !/^[a-f0-9]{40}$/.test(source)) throw fail();
  }
  private ref() { return this.db.doc(`metricsOneDailyRuns/${this.id}`); }
  private async checked(read: (ref: any) => Promise<any>, remainingDepth = 5, requireComposer = true, readMany: (refs: any[]) => Promise<any[]> = refs => Promise.all(refs.map(read))): Promise<{ run: DailyRun; policy: any; parent?: DailyRun; grandparent?: DailyRun; greatGrandparent?: DailyRun; parentPartial?: any; inheritedPartial?: any; olderPartial?: any; depth: number; rootId: string; rootSource: string; measurementExpiresAt: number }> {
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
    let parent: DailyRun | undefined, grandparent: DailyRun | undefined, greatGrandparent: DailyRun | undefined, inheritedPartial: any, olderPartial: any, depth = 0, rootId = this.id, rootSource = this.source;
    if (run.parentId !== undefined) {
      if (remainingDepth < 1) throw fail();
      if (!/^refresh_\d{8}_[a-f0-9]{16}$/.test(run.parentId) || run.parentId === this.id || !/^[a-f0-9]{40}$/.test(run.parentSource ?? '')) throw fail();
      const lineage = await new DailyOneRefresh(this.db, run.parentId, run.parentSource!, this.now).checked(read, remainingDepth - 1, true, readMany);
      parent = lineage.run; grandparent = lineage.parent; greatGrandparent = lineage.grandparent; inheritedPartial = lineage.parentPartial; olderPartial = lineage.inheritedPartial; depth = lineage.depth + 1; rootId = lineage.rootId; rootSource = lineage.rootSource;
      if (depth > 5 || (depth >= 4 ? run.ancestorId !== parent.parentId || run.ancestorSource !== parent.parentSource || !grandparent || !/^[a-f0-9]{64}$/.test(run.parentSnapshotsDigest ?? '') : run.ancestorId !== undefined || run.ancestorSource !== undefined || run.parentSnapshotsDigest !== undefined)
        || (depth === 5 ? run.legacyAncestorId !== grandparent?.parentId || run.legacyAncestorSource !== grandparent?.parentSource || !greatGrandparent : run.legacyAncestorId !== undefined || run.legacyAncestorSource !== undefined)
        || (depth === 1 ? run.parentDepth !== undefined || run.parentOwnReservedBytes !== undefined || run.parentOwnReservedJobs !== undefined || run.parentPartialDigest !== undefined
        : run.parentDepth !== depth || run.parentOwnReservedBytes !== parent.reservedBytes || run.parentOwnReservedJobs !== parent.reservedJobs || (depth === 2 && run.parentPartialDigest !== undefined))
        || parent.phase !== 'closed' || parent.day !== run.day || parent.logicalAsOf !== run.logicalAsOf
        || parent.reports.length !== run.reports.length || parent.reports.some((report, index) => report !== run.reports[index])
        || parent.reportDigest !== run.reportDigest || parent.scopeDigest !== run.scopeDigest || parent.policyGeneration !== run.policyGeneration
        || parent.reservedBytes + (parent.parentReservedBytes ?? 0) !== run.parentReservedBytes || parent.reservedJobs + (parent.parentReservedJobs ?? 0) !== run.parentReservedJobs || parent.createdAt !== run.parentCreatedAt
        || run.newReportsDigest !== restorationReportDigest(newReports(run))
        || (depth < 3 ? !/^dailycomposer_[a-f0-9]{16}$/.test(run.composerId ?? '') || run.composerSource !== this.source
          : run.composerId !== undefined || run.composerSource !== undefined || !/^[a-f0-9]{64}$/.test(run.parentPartialDigest ?? ''))
        || run.maxBytes + run.parentReservedBytes! > DAILY_ONE_LIMITS.bytes || run.maxJobs + run.parentReservedJobs! > DAILY_ONE_LIMITS.jobs) throw fail();
    } else if (run.parentSource !== undefined || run.parentReservedBytes !== undefined || run.parentReservedJobs !== undefined || run.parentCreatedAt !== undefined
      || run.parentDepth !== undefined || run.parentOwnReservedBytes !== undefined || run.parentOwnReservedJobs !== undefined || run.parentPartialDigest !== undefined
      || run.newReportsDigest !== undefined || run.composerId !== undefined || run.composerSource !== undefined || run.ancestorId !== undefined || run.ancestorSource !== undefined || run.legacyAncestorId !== undefined || run.legacyAncestorSource !== undefined || run.parentSnapshotsDigest !== undefined) throw fail();
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
      || !Number.isSafeInteger(measurement.measuredBytes) || measurement.measuredBytes < 0 || measurement.measuredBytes > (depth >= 4 ? DAILY_ONE_LIMITS.bytes : run.maxBytes)
      || !Number.isSafeInteger(measurement.measuredQueries) || measurement.measuredQueries < 1 || measurement.measuredQueries > (parent ? DAILY_ONE_LIMITS.jobs : run.maxJobs)
      || !slotSnap.exists || slot?.state !== 'sealed' || slot?.runId !== rootId || slot.day !== run.day || slot.source !== rootSource || slot.policyGeneration !== run.policyGeneration) throw fail();
    let parentPartial: any;
    if (parent) {
      const claim = (await read(this.db.doc(`metricsOneDailyContinuationClaims/${run.parentId}`))).data();
      const fields = ['source','day','logicalAsOf','createdAt','expiresAt','reportDigest','newReportsDigest','composerId','composerSource','scopeDigest','measurementId','measurementSource','measurementDigest','maxBytes','maxJobs','maxPerJobBytes','parentId','parentSource','parentReservedBytes','parentReservedJobs','parentCreatedAt','parentDepth','parentOwnReservedBytes','parentOwnReservedJobs','parentPartialDigest','ancestorId','ancestorSource','legacyAncestorId','legacyAncestorSource','parentSnapshotsDigest'] as const;
      if (!claim || claim.runId !== this.id || claim.approved !== true || fields.some(key => claim[key] !== run[key] || approval[key] !== run[key])) throw fail();
      if (depth >= 3) {
        parentPartial = (await read(this.db.doc(`metricsOneDailyRuns/${run.parentId}/activation/partial`))).data();
        const expected = recoveredReports(run).map(hash).sort();
        if (!parentPartial || parentPartial.state !== 'active' || parentPartial.source !== run.parentSource || parentPartial.runId !== run.parentId
          || parentPartial.reportDigest !== run.reportDigest || parentPartial.logicalAsOf !== run.logicalAsOf || !parentPartial.witness
          || !Array.isArray(parentPartial.reports) || JSON.stringify([...parentPartial.reports].sort()) !== JSON.stringify(expected)
          || dailyPartialDigest(parentPartial) !== run.parentPartialDigest) throw fail();
        for (const report of depth === 3 ? run.reports.slice(2, 4) : []) {
          const snapshot = (await read(this.db.doc(`metricsOneDailyRuns/${run.parentId}/snapshots/${hash(report)}`))).data();
          if (!snapshot || snapshot.schema !== 1 || snapshot.state !== 'verified' || snapshot.source !== run.parentSource || snapshot.runId !== run.parentId
            || snapshot.reportHash !== hash(report) || snapshot.dataAsOf !== run.logicalAsOf || snapshot.scopeDigest !== parent.scopeDigest
            || snapshot.measurementId !== parent.measurementId || snapshot.measurementSource !== parent.measurementSource || snapshot.measurementDigest !== parent.measurementDigest
            || snapshot.parentId !== parent.parentId || snapshot.parentSource !== parent.parentSource || snapshot.sourceCoverage !== 'intraday-or-unknown'
            || snapshot.nonWarehouseFreshness !== 'unknown' || typeof snapshot.json !== 'string' || Buffer.byteLength(snapshot.json) > 700_000
            || !Number.isSafeInteger(snapshot.computedAt) || snapshot.computedAt < parent.createdAt || snapshot.computedAt > this.now()
            || !snapshot.witness || snapshot.witness.policyRevision !== parentPartial.witness.policyRevision || snapshot.witness.rowsHash !== parentPartial.witness.rowsHash
            || !Number.isFinite(Date.parse(snapshot.witness.asOf)) || !Array.isArray(snapshot.jobs) || !snapshot.jobs.length || snapshot.jobs.length > DAILY_ONE_LIMITS.jobs
            || new Set(snapshot.jobs.map((job: any) => job.id)).size !== snapshot.jobs.length || snapshot.jobs.some((job: any) => typeof job.id !== 'string'
              || !new RegExp(`^metrics_${run.parentId}_[a-f0-9]{64}$`).test(job.id) || !Number.isSafeInteger(job.endedAt)
              || job.endedAt < parent.createdAt || job.endedAt > snapshot.computedAt + 10_000)) throw fail();
          try { if (!validOnePayload(JSON.parse(snapshot.json), report)) throw fail(); } catch { throw fail(); }
        }
        if (depth >= 4) {
          const indices = depth === 4 ? [5, 6] : [7];
          const preserved = await Promise.all(indices.map(index => read(this.db.doc(`metricsOneDailyRuns/${run.parentId}/snapshots/${hash(run.reports[index])}`))));
          const snapshots = preserved.map(snapshot => snapshot.data());
          if (preserved.some(snapshot => !snapshot.exists) || snapshots.some((snapshot, index) => {
            const report = run.reports[indices[index]];
            if (!snapshot || snapshot.schema !== 1 || snapshot.state !== 'verified' || snapshot.source !== run.parentSource || snapshot.runId !== run.parentId
              || snapshot.reportHash !== hash(report) || snapshot.dataAsOf !== run.logicalAsOf || snapshot.scopeDigest !== parent!.scopeDigest
              || snapshot.parentId !== parent!.parentId || snapshot.parentSource !== parent!.parentSource
              || snapshot.measurementId !== parent!.measurementId || snapshot.measurementSource !== parent!.measurementSource || snapshot.measurementDigest !== parent!.measurementDigest
              || snapshot.sourceCoverage !== 'intraday-or-unknown' || snapshot.nonWarehouseFreshness !== 'unknown' || snapshot.witness !== undefined
              || !Number.isSafeInteger(snapshot.computedAt) || snapshot.computedAt < parent!.createdAt || snapshot.computedAt > this.now()
              || typeof snapshot.json !== 'string' || Buffer.byteLength(snapshot.json) > 700_000 || !Array.isArray(snapshot.jobs) || !snapshot.jobs.length || snapshot.jobs.length > DAILY_ONE_LIMITS.jobs
              || new Set(snapshot.jobs.map((job: any) => job.id)).size !== snapshot.jobs.length
              || snapshot.jobs.some((job: any) => {
                const owner = typeof job.id === 'string' ? jobOwner(parent!, job.id, run.parentId!, report) : null;
                const producer = ownerRun(parent!, grandparent, greatGrandparent, undefined, owner, run.parentId!);
                return !producer || !Number.isSafeInteger(job.bytes) || job.bytes < 1 || job.bytes > producer.maxPerJobBytes
                  || !Number.isSafeInteger(job.endedAt) || job.endedAt < producer.createdAt || job.endedAt > snapshot.computedAt + 10_000;
              })) return true;
            try { return !validOnePayload(JSON.parse(snapshot.json), report); } catch { return true; }
          }) || hash(JSON.stringify(snapshots.map(dailySnapshotDigest))) !== run.parentSnapshotsDigest) throw fail();
          const preservedJobs = snapshots.flatMap((snapshot, index) => snapshot.jobs.map((job: any) => {
            const report = run.reports[indices[index]], owner = jobOwner(parent!, job.id, run.parentId!, report);
            return { job, report, owner, producer: ownerRun(parent!, grandparent, greatGrandparent, undefined, owner, run.parentId!) };
          }));
          if (preservedJobs.length > parent!.reservedJobs + (parent!.parentReservedJobs ?? 0) || preservedJobs.length > DAILY_ONE_LIMITS.jobs
            || new Set(preservedJobs.map(({ job }) => job.id)).size !== preservedJobs.length) throw fail();
          const reservations = await readMany(preservedJobs.map(({ job, owner }) => this.db.doc(`metricsOneDailyRuns/${owner}/reservations/${job.id.slice(-64)}`)));
          if (reservations.length !== preservedJobs.length || reservations.some((reservation, index) => {
            const row = reservation.data(), { job, report, producer } = preservedJobs[index];
            return !producer || !reservation.exists || row?.jobId !== job.id || row.state !== 'started' || row.bytes !== job.bytes
              || row.reportHash !== hash(report) || row.scopeHash !== run.measurementScopes[hash(report)]
              || !Number.isSafeInteger(row.startedAt) || row.startedAt < producer.createdAt || row.startedAt >= producer.expiresAt || row.startedAt > job.endedAt;
          })) throw fail();
        }
      } else if (requireComposer) await verifiedDailyComposer(read, this.db, this.id, run, validOnePayload, this.now());
    }
    return { run, policy, parent, grandparent, greatGrandparent, parentPartial, inheritedPartial, olderPartial, depth, rootId, rootSource, measurementExpiresAt: measurementRun.expiresAt as number };
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
      || recoveredReports(value.run).includes(report)) throw fail();
    return value;
  }
  /** Check every measured lane before any paid work, without using the
   * production cohort as the UAT report's data population. */
  async verifyMeasuredCohort(cohort: CustomerCohort) {
    requireFreshCohort(cohort);
    if (!/^[a-f0-9]{64}$/.test(cohort.cacheKey)) throw fail();
    const { run, parentPartial, inheritedPartial, olderPartial } = await this.permit();
    if ((run.parentDepth ?? 0) >= 3 && !matchesLineage(run, cohort, parentPartial, inheritedPartial, olderPartial)) throw fail();
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
    const ref = this.ref().collection('reservations').doc(planHash), snapshot = await ref.get();
    if (!snapshot.exists) {
      const priorId = run.parentDepth === 5 ? report === run.reports[4] ? run.legacyAncestorId : report === run.reports[8] ? run.parentId : undefined
        : run.parentDepth === 4 ? report === run.reports[4] ? run.ancestorId : report === run.reports[7] ? run.parentId : undefined
        : run.parentDepth === 3 && report === run.reports[4] ? run.parentId : undefined;
      const priorSource = priorId === run.legacyAncestorId ? run.legacyAncestorSource : priorId === run.ancestorId ? run.ancestorSource : run.parentSource;
      if (!priorId || !priorSource) return undefined;
      try {
        const prior = await new DailyOneRefresh(this.db, priorId, priorSource, this.now).closedJob(request);
        const priorPlanHash = prior.id.slice(-64);
        return { permitId: this.id, planHash: priorPlanHash, id: prior.id, bytes: prior.bytes, report, scopeHash,
          reuse: { key: '', priorPlanHash, priorPermitId: priorId } } as RestorationGrant;
      } catch (error) { if (error instanceof ClosedJobMissingError) return undefined; throw error; }
    }
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
    const active = currentDailyOneRefresh();
    if (active && (active.store !== this || active.report !== grant.report)) throw new ReservationHold('scope');
    let release!: () => void;
    const previous = this.reservationTail;
    this.reservationTail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      if (active?.signal?.aborted) throw new ReservationHold('window');
      await this.reserveInTransaction(grant, active);
    } catch (error) {
      if (active) console.warn('Daily reservation held:', reservationReason(error));
      throw error;
    } finally { release(); }
  }
  private async reserveInTransaction(grant: RestorationGrant, active: ReturnType<typeof currentDailyOneRefresh>) {
    if (grant.permitId !== this.id || !/^[a-f0-9]{64}$/.test(grant.planHash) || !grant.report || !Number.isSafeInteger(grant.bytes) || grant.bytes < 1) throw new ReservationHold('scope');
    const scope = currentLegacyReportKey();
    if (!scope || !grant.report || !scope.endsWith(`:${grant.report}`)) throw new ReservationHold('scope');
    const scopeHash = hash(scope), reportHash = hash(grant.report);
    if ((grant as RestorationGrant & { scopeHash?: string }).scopeHash !== scopeHash) throw new ReservationHold('scope');
    const check = async (tx: any) => {
      try { return await this.checked(ref => tx.get(ref), 5, true, refs => tx.getAll(...refs)); }
      catch (error) { if (error instanceof Error && error.message === 'The bounded One refresh is unavailable.') throw new ReservationHold('lineage'); throw error; }
    };
    if (grant.reuse?.priorPermitId) {
      await this.db.runTransaction(async tx => {
        const { run, parent, grandparent, greatGrandparent, parentPartial, inheritedPartial, olderPartial } = await check(tx), now = this.now();
        const gate = active?.gateCohort;
        const ownerId = jobOwner(run, grant.id, this.id, grant.report!);
        const owner = ownerRun(run, parent, grandparent, greatGrandparent, ownerId, this.id);
        if (!owner || ownerId !== grant.reuse?.priorPermitId || grant.reuse.priorPlanHash !== grant.planHash
          || grant.id !== `metrics_${ownerId}_${grant.planHash}` || grant.bytes > run.maxPerJobBytes) throw new ReservationHold('scope');
        if (run.phase !== 'open' || now < run.createdAt || now >= run.expiresAt || new Date(now).toISOString().slice(0, 10) !== run.day) throw new ReservationHold('window');
        if (!gate || !matchesLineage(run, gate, parentPartial, inheritedPartial, olderPartial)) throw new ReservationHold('cohort');
        requireFreshCohort(gate);
        const [rowSnap, daySnap] = await Promise.all([
          tx.get(this.db.doc(`metricsOneDailyRuns/${ownerId}/reservations/${grant.planHash}`)),
          tx.get(this.db.doc(`metricsOneDailyBudgets/${run.day}`)),
        ]), row = rowSnap.data(), day = daySnap.data();
        if (active?.signal?.aborted) throw new ReservationHold('window');
        if (!rowSnap.exists || row.jobId !== grant.id || row.state !== 'started'
          || row.bytes !== grant.bytes || row.scopeHash !== scopeHash || row.reportHash !== reportHash
          || !Number.isSafeInteger(row.startedAt) || row.startedAt < owner.createdAt || row.startedAt >= owner.expiresAt || row.startedAt > now) throw new ReservationHold('conflict');
        if (!daySnap.exists || day.policyGeneration !== run.policyGeneration || day.reservedBytes !== run.parentReservedBytes! + run.reservedBytes
          || day.reservedJobs !== run.parentReservedJobs! + run.reservedJobs) throw new ReservationHold('ledger');
      });
      return;
    }
    await this.db.runTransaction(async tx => {
      const { run, policy, parentPartial, inheritedPartial, olderPartial } = await check(tx), now = this.now();
      const gate = active?.gateCohort;
      if ((run.parentDepth ?? 0) >= 3) { if (!gate || !matchesLineage(run, gate, parentPartial, inheritedPartial, olderPartial)) throw new ReservationHold('cohort'); requireFreshCohort(gate); }
      if (run.phase !== 'open' || now < run.createdAt || now >= run.expiresAt || new Date(now).toISOString().slice(0, 10) !== run.day || !run.reports.includes(grant.report!) || grant.bytes > run.maxPerJobBytes) throw new ReservationHold('window');
      if (grant.id !== `metrics_${this.id}_${grant.planHash}` || recoveredReports(run).includes(grant.report!)) throw new ReservationHold('scope');
      const dayRef = this.db.doc(`metricsOneDailyBudgets/${run.day}`), reservation = this.ref().collection('reservations').doc(grant.planHash);
      const [daySnap, reservationSnap] = await Promise.all([tx.get(dayRef), tx.get(reservation)]), day = daySnap.data();
      if (active?.signal?.aborted) throw new ReservationHold('window');
      if (reservationSnap.exists) { const old = reservationSnap.data(); if (old.jobId !== grant.id || old.bytes !== grant.bytes || old.scopeHash !== scopeHash || old.reportHash !== reportHash || !['reserved','started'].includes(old.state)) throw new ReservationHold('conflict'); return; }
      if (!daySnap.exists || day?.day !== run.day || day.policyGeneration !== run.policyGeneration || !Number.isSafeInteger(day.reservedBytes) || day.reservedBytes < 0
        || !Number.isSafeInteger(day.reservedJobs) || day.reservedJobs < 0 || day.reservedBytes !== (run.parentReservedBytes ?? 0) + run.reservedBytes
        || day.reservedJobs !== (run.parentReservedJobs ?? 0) + run.reservedJobs) throw new ReservationHold('ledger');
      if (run.reservedBytes + grant.bytes > run.maxBytes || run.reservedJobs + 1 > run.maxJobs
        || day.reservedBytes + grant.bytes > policy.maxDailyBytes || day.reservedJobs + 1 > policy.maxDailyJobs) throw new ReservationHold('limit');
      tx.update(dayRef, { reservedBytes: day.reservedBytes + grant.bytes, reservedJobs: day.reservedJobs + 1 });
      tx.update(this.ref(), { reservedBytes: run.reservedBytes + grant.bytes, reservedJobs: run.reservedJobs + 1 });
      tx.create(reservation, { jobId: grant.id, bytes: grant.bytes, scopeHash, reportHash, state: 'reserved', reservedAt: now });
    });
  }
  /** Stage a write-once aggregate; readers only use it after this run closes. */
  async save(report: string, value: { status: number; body: unknown }, jobs: Array<{ id: string; endedAt: number; bytes?: number }>, cohort: CustomerCohort | null) {
    const active = currentDailyOneRefresh(), scope = currentLegacyReportKey();
    const { run, parent: initialParent, grandparent: initialGrandparent, greatGrandparent: initialGreatGrandparent } = await this.requireOpen(report), computedAt = this.now(), json = JSON.stringify(value);
    if (!active || active.signal?.aborted || active.store !== this || active.report !== report || active.jobs.size !== jobs.length
      || jobs.some(job => active.jobs.get(job.id) !== job.endedAt || ((run.parentDepth ?? 0) >= 3 && (!Number.isSafeInteger(job.bytes) || job.bytes! < 1 || active.bounds.get(job.id) !== job.bytes))) || scope !== `${cohort?.cacheKey ?? ''}:${report}`) throw fail();
    const environment = new URL(report, 'http://analytics.internal').searchParams.get('environment');
    const witness = cohort ? cohortSnapshotWitness(cohort) : null;
    if (!validOnePayload(value, report) || Buffer.byteLength(json) > 700_000 || !jobs.length || jobs.length > DAILY_ONE_LIMITS.jobs
      || (environment === 'production' ? !witness : environment !== 'uat' || !!cohort)
      || new Set(jobs.map(job => job.id)).size !== jobs.length
      || jobs.some(job => !jobOwner(run, job.id, this.id, report)
        || !Number.isSafeInteger(job.endedAt) || job.endedAt < (ownerRun(run, initialParent, initialGrandparent, initialGreatGrandparent, jobOwner(run, job.id, this.id, report), this.id)?.createdAt ?? Infinity) || job.endedAt > computedAt + 10_000)) throw fail();
    const reportHash = hash(report), target = this.ref().collection('snapshots').doc(reportHash);
    if (cohort) await requireCurrentCustomerCohort(cohort.cacheKey);
    if ((run.parentDepth ?? 0) >= 3) { if (!active.gateCohort) throw fail(); await this.verifyMeasuredCohort(active.gateCohort); await requireCurrentCustomerCohort(active.gateCohort.cacheKey); }
    if (active.signal?.aborted) throw fail();
    // A Firestore commit already dispatched may complete after a disconnect.
    // Reads still require a verified payload, current cohort and all-ten activation.
    await this.db.runTransaction(async tx => {
      const { run: live, parent, grandparent, greatGrandparent, parentPartial, inheritedPartial, olderPartial } = await this.checked(ref => tx.get(ref), 5, true, refs => tx.getAll(...refs)), now = this.now();
      if (live.phase !== 'open' || now < live.createdAt || now >= live.expiresAt || new Date(now).toISOString().slice(0, 10) !== live.day || !live.reports.includes(report)
        || recoveredReports(live).includes(report)) throw fail();
      if (cohort) requireFreshCohort(cohort);
      if ((live.parentDepth ?? 0) >= 3) { if (!matchesLineage(live, active.gateCohort, parentPartial, inheritedPartial, olderPartial)) throw fail(); requireFreshCohort(active.gateCohort); }
      const existing = await tx.get(target);
      const reservations = await Promise.all(jobs.map(job => tx.get(this.db.doc(`metricsOneDailyRuns/${jobOwner(live, job.id, this.id, report)}/reservations/${job.id.slice(-64)}`))));
      if (active.signal?.aborted) throw fail();
      if (existing.exists || reservations.some((snapshot, index) => !snapshot.exists || snapshot.data()?.jobId !== jobs[index].id || snapshot.data()?.state !== 'started' || snapshot.data()?.scopeHash !== hash(scope!) || snapshot.data()?.reportHash !== reportHash || ((live.parentDepth ?? 0) >= 3 && snapshot.data()?.bytes !== jobs[index].bytes) || !Number.isSafeInteger(snapshot.data()?.startedAt)
        || ((live.parentDepth ?? 0) >= 3 && snapshot.data()?.startedAt < (ownerRun(live, parent, grandparent, greatGrandparent, jobOwner(live, jobs[index].id, this.id, report), this.id)?.createdAt ?? Infinity))
        || ((live.parentDepth ?? 0) >= 3 && snapshot.data()?.startedAt >= (ownerRun(live, parent, grandparent, greatGrandparent, jobOwner(live, jobs[index].id, this.id, report), this.id)?.expiresAt ?? -Infinity))
        || snapshot.data()?.startedAt > jobs[index].endedAt)) throw fail();
      tx.create(target, { schema: 1, state: 'pending', source: this.source, measurementId: live.measurementId, measurementSource: live.measurementSource,
        measurementDigest: live.measurementDigest, scopeDigest: live.scopeDigest, runId: this.id, reportHash, dataAsOf: live.logicalAsOf,
        computedAt, sourceCoverage: 'intraday-or-unknown', nonWarehouseFreshness: 'unknown', jobs, json,
        ...(live.parentId ? { parentId: live.parentId, parentSource: live.parentSource } : {}), ...(witness ? { witness } : {}) });
    });
    if (cohort) await requireCurrentCustomerCohort(cohort.cacheKey);
    if ((run.parentDepth ?? 0) >= 3) { if (!active.gateCohort) throw fail(); await requireCurrentCustomerCohort(active.gateCohort.cacheKey); }
    if (active.signal?.aborted) throw fail();
    await this.db.runTransaction(async tx => {
      const { run: live, parentPartial, inheritedPartial, olderPartial } = await this.checked(ref => tx.get(ref), 5, true, refs => tx.getAll(...refs)), snapshot = await tx.get(target), now = this.now();
      if (active.signal?.aborted) throw fail();
      if (live.phase !== 'open' || now < live.createdAt || now >= live.expiresAt || new Date(now).toISOString().slice(0, 10) !== live.day
        || !snapshot.exists || snapshot.data()?.state !== 'pending' || snapshot.data()?.computedAt !== computedAt) throw fail();
      if (cohort) requireFreshCohort(cohort);
      if ((live.parentDepth ?? 0) >= 3) { if (!matchesLineage(live, active.gateCohort, parentPartial, inheritedPartial, olderPartial)) throw fail(); requireFreshCohort(active.gateCohort); }
      tx.update(target, { state: 'verified' });
    });
    return computedAt;
  }
  async read(report: string, cohort: CustomerCohort | null, requireActive = true, activationCohort: CustomerCohort | null = cohort) {
    const { run, parent, grandparent, greatGrandparent } = await this.permit();
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
    if ((run.parentDepth ?? 0) >= 3 && recoveredReports(run).includes(report)) {
      return new DailyOneRefresh(this.db, run.parentId!, run.parentSource!, this.now).read(report, cohort, true, activationCohort);
    }
    if (run.parentDepth === 2 && report === run.reports[0]) {
      return new DailyOneRefresh(this.db, run.parentId!, run.parentSource!, this.now).read(report, cohort, false);
    }
    if (run.parentId && (run.parentDepth ?? 0) < 3 && report === recoveredReports(run).at(-1)) {
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
      || row.jobs.some((job: any) => typeof job.id !== 'string' || !jobOwner(run, job.id, this.id, report)
        || !Number.isSafeInteger(job.endedAt) || job.endedAt < (ownerRun(run, parent, grandparent, greatGrandparent, jobOwner(run, job.id, this.id, report), this.id)?.createdAt ?? Infinity) || job.endedAt > row.computedAt + 10_000)
      || (cohort ? !row.witness || !cohortMatchesSnapshotWitness(cohort, row.witness) : !!row.witness)) return null;
    if ((run.parentDepth ?? 0) >= 3) {
      const reservations = await Promise.all(row.jobs.map((job: any) => this.db.doc(`metricsOneDailyRuns/${jobOwner(run, job.id, this.id, report)}/reservations/${job.id.slice(-64)}`).get()));
      if (reservations.some((snapshot: any, index: number) => !snapshot.exists || snapshot.data()?.jobId !== row.jobs[index].id
        || snapshot.data()?.state !== 'started' || snapshot.data()?.reportHash !== hash(report)
        || snapshot.data()?.scopeHash !== run.measurementScopes[hash(report)] || !Number.isSafeInteger(row.jobs[index].bytes) || row.jobs[index].bytes < 1
        || snapshot.data()?.bytes !== row.jobs[index].bytes || !Number.isSafeInteger(snapshot.data()?.startedAt)
        || snapshot.data()?.startedAt < (ownerRun(run, parent, grandparent, greatGrandparent, jobOwner(run, row.jobs[index].id, this.id, report), this.id)?.createdAt ?? Infinity)
        || snapshot.data()?.startedAt >= (ownerRun(run, parent, grandparent, greatGrandparent, jobOwner(run, row.jobs[index].id, this.id, report), this.id)?.expiresAt ?? -Infinity)
        || snapshot.data()?.startedAt > row.jobs[index].endedAt)) return null;
    }
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
      return environment === 'production' ? this.read(report, cohort, false)
        : (run.parentDepth ?? 0) >= 3 && environment === 'uat' ? this.read(report, null, false, cohort) : null;
    }));
    const reports = run.reports.filter((_, index) => values[index]?.asOf === run.logicalAsOf).map(hash);
    if (!reports.length || reports.length === run.reports.length || ((run.parentDepth ?? 0) >= 4 && recoveredReports(run).some(report => !reports.includes(hash(report))))) throw fail();
    await requireCurrentCustomerCohort(cohort.cacheKey);
    const activation = this.ref().collection('activation').doc('partial');
    await this.db.runTransaction(async tx => {
      const { run: live, parentPartial, inheritedPartial, olderPartial } = await this.checked(ref => tx.get(ref), 5, true, refs => tx.getAll(...refs)), existing = await tx.get(activation);
      const own = newReports(live).filter(report => reports.includes(hash(report)));
      const snapshots = await Promise.all(own.map(report => tx.get(this.ref().collection('snapshots').doc(hash(report)))));
      if (live.phase !== 'closed' || live.logicalAsOf !== run.logicalAsOf || live.reportDigest !== run.reportDigest || existing.exists
        || ((live.parentDepth ?? 0) >= 4 && (!matchesLineage(live, cohort, parentPartial, inheritedPartial, olderPartial)
          || recoveredReports(live).some(report => !reports.includes(hash(report)))))
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
      const environment = query.get('environment');
      if (!['production', 'uat'].includes(environment ?? '') || !await this.read(report, environment === 'production' ? cohort : null, true, cohort)) return null;
      const startDate = query.get('one_start_date'), endDate = query.get('one_end_date');
      return startDate && endDate && (environment === 'production' || environment === 'uat') ? { startDate, endDate, environment } : null;
    }));
    return rows.filter((row): row is { startDate: string; endDate: string; environment: 'production' | 'uat' } => !!row);
  }
  /** Make the complete, closed set visible together; no warehouse work occurs. */
  async activate(cohort: CustomerCohort) {
    const { run } = await this.permit();
    const witness = cohortSnapshotWitness(cohort);
    if (run.phase !== 'closed' || !witness) throw fail();
    await requireCurrentCustomerCohort(cohort.cacheKey);
    const values = await Promise.all(run.reports.map(report => {
      const environment = new URL(report, 'http://analytics.internal').searchParams.get('environment');
      return this.read(report, environment === 'production' ? cohort : null, false, cohort);
    }));
    if (values.some(value => value?.asOf !== run.logicalAsOf)) throw fail();
    await requireCurrentCustomerCohort(cohort.cacheKey);
    const activation = this.ref().collection('activation').doc('current');
    await this.db.runTransaction(async tx => {
      const { run: live, parentPartial, inheritedPartial, olderPartial } = await this.checked(ref => tx.get(ref), 5, true, refs => tx.getAll(...refs)), existing = await tx.get(activation);
      const reports = newReports(live);
      const snapshots = await Promise.all(reports.map(report => tx.get(this.ref().collection('snapshots').doc(hash(report)))));
      const prior = live.parentDepth === 3 ? await Promise.all(live.reports.slice(2, 4).map(report => tx.get(this.db.doc(`metricsOneDailyRuns/${live.parentId}/snapshots/${hash(report)}`)))) : [];
      if (live.phase !== 'closed' || live.logicalAsOf !== run.logicalAsOf || live.reportDigest !== run.reportDigest || existing.exists
        || ((live.parentDepth ?? 0) >= 3 && (!cohortMatchesSnapshotWitness(cohort, parentPartial?.witness)
          || ((live.parentDepth ?? 0) >= 4 && !matchesLineage(live, cohort, parentPartial, inheritedPartial, olderPartial)) || prior.some((snapshot, index) => !snapshot.exists || snapshot.data()?.state !== 'verified' || snapshot.data()?.source !== live.parentSource || snapshot.data()?.reportHash !== hash(live.reports[index + 2]))))
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
    const active = currentDailyOneRefresh();
    if (active && (active.store !== this || active.report !== grant.report)) throw fail();
    if (grant.permitId !== this.id || !/^[a-f0-9]{64}$/.test(grant.planHash) || !Number.isSafeInteger(grant.bytes) || grant.bytes < 1) throw fail();
    const scope = currentLegacyReportKey();
    if (!scope || !grant.report || !scope.endsWith(`:${grant.report}`)) throw fail();
    if ((grant as RestorationGrant & { scopeHash?: string }).scopeHash !== hash(scope)) throw fail();
    if (grant.reuse?.priorPermitId) { await this.reserve(grant); return false; }
    return this.db.runTransaction(async tx => {
      const { run, parentPartial, inheritedPartial, olderPartial } = await this.checked(ref => tx.get(ref), 5, true, refs => tx.getAll(...refs)), now = this.now();
      const gate = active?.gateCohort;
      if ((run.parentDepth ?? 0) >= 3) { if (!matchesLineage(run, gate, parentPartial, inheritedPartial, olderPartial)) throw fail(); requireFreshCohort(gate); }
      if (run.phase !== 'open' || now < run.createdAt || now >= run.expiresAt || new Date(now).toISOString().slice(0, 10) !== run.day || !grant.report || !run.reports.includes(grant.report)) throw fail();
      if (grant.id !== `metrics_${this.id}_${grant.planHash}` || recoveredReports(run).includes(grant.report!)) throw fail();
      const ref = this.ref().collection('reservations').doc(grant.planHash), snapshot = await tx.get(ref), row = snapshot.data();
      if (active?.signal?.aborted) throw fail();
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
