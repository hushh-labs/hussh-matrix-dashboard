import { createHash } from 'node:crypto';
import type { Firestore } from '@google-cloud/firestore';
import { cohortMatchesSnapshotWitness, cohortSnapshotWitness, requireCurrentCustomerCohort, requireFreshCohort, type CustomerCohort } from './one-customer-cohort';
import { currentClosedComposition, currentLegacyReportKey, nativeDatabase } from './legacy-restoration';
import type { DailyOneRefresh, DailyRun } from './daily-one-refresh';

type Database = Pick<Firestore, 'doc' | 'runTransaction'>;
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const fail = () => new Error('Daily parent composition is unavailable.');
const keys = ['source','parentId','parentSource','childId','logicalAsOf','report','reportDigest','scopeDigest','createdAt','expiresAt'] as const;
function matches(doc: any, id: string, run: DailyRun) {
 return !!doc && doc.source === run.composerSource && doc.source === run.source && doc.parentId === run.parentId && doc.parentSource === run.parentSource
  && doc.childId === id && doc.logicalAsOf === run.logicalAsOf && doc.report === run.reports[0]
  && doc.reportDigest === run.reportDigest && doc.scopeDigest === run.scopeDigest
  && Number.isSafeInteger(doc.createdAt) && Number.isSafeInteger(doc.expiresAt) && doc.expiresAt > doc.createdAt && doc.expiresAt - doc.createdAt <= 3600_000;
}
/** Revalidated by every paid reservation and every passive publication read. */
export async function verifiedDailyComposer(read: (ref: any) => Promise<any>, db: Database, childId: string, run: DailyRun,
 validate: (value: { status: number; body: unknown }, report: string) => boolean, now = Date.now()) {
 if (!run.composerId) throw fail();
 const ref = db.doc(`metricsOneDailyComposers/${run.composerId}`), doc = (await read(ref)).data();
 const snapshot = (await read(ref.collection('snapshots').doc(hash(run.reports[0])))).data();
 if (!matches(doc, childId, run) || doc.phase !== 'closed' || !snapshot || snapshot.state !== 'verified'
  || snapshot.source !== doc.source || snapshot.parentId !== doc.parentId || snapshot.parentSource !== doc.parentSource
  || snapshot.childId !== childId || snapshot.logicalAsOf !== run.logicalAsOf || snapshot.reportHash !== hash(run.reports[0])
  || snapshot.nonWarehouseFreshness !== 'unknown' || !snapshot.witness || !/^[a-f0-9]{64}$/.test(snapshot.witness.policyRevision ?? '')
  || !/^[a-f0-9]{64}$/.test(snapshot.witness.rowsHash ?? '') || !Number.isFinite(Date.parse(snapshot.witness.asOf))
  || hash(`${snapshot.witness.rowsHash}:${run.reports[0]}`) !== run.measurementScopes[hash(run.reports[0])]
  || !Number.isSafeInteger(snapshot.computedAt) || snapshot.computedAt < doc.createdAt || snapshot.computedAt > now + 10_000 || typeof snapshot.json !== 'string'
  || Buffer.byteLength(snapshot.json) > 700_000 || !Array.isArray(snapshot.jobs) || snapshot.jobs.length !== run.parentReservedJobs
  || !snapshot.jobs.length || new Set(snapshot.jobs.map((j: any) => j.id)).size !== snapshot.jobs.length
  || snapshot.jobs.some((j: any) => typeof j.id !== 'string' || !new RegExp(`^metrics_${run.parentId}_[a-f0-9]{64}$`).test(j.id)
    || !Number.isSafeInteger(j.endedAt) || j.endedAt < run.parentCreatedAt! || j.endedAt > snapshot.computedAt + 10_000)) throw fail();
 let value: { status: number; body: unknown }; try { value = JSON.parse(snapshot.json); } catch { throw fail(); }
 if (!validate(value, run.reports[0])) throw fail();
 return snapshot;
}
/** Exact completed-parent results only; an interrupted attempt cannot be replayed. */
export class DailyOneComposer {
 constructor(private db: Database, private id: string, private source: string, private daily: DailyOneRefresh, private now = Date.now) {
  if (!/^dailycomposer_[a-f0-9]{16}$/.test(id) || !/^[a-f0-9]{40}$/.test(source)) throw fail();
 }
 async claim(report: string) {
  const { run, parent, childId } = await this.daily.parentForComposition(), ref = this.db.doc(`metricsOneDailyComposers/${this.id}`);
  const doc = (await ref.get()).data(), now = this.now();
  if (!parent || this.id !== run.composerId || this.source !== run.composerSource || !matches(doc, childId, run) || doc.phase !== 'open'
   || report !== run.reports[0] || now < doc.createdAt || now >= doc.expiresAt) throw fail();
  const attempt = ref.collection('attempts').doc('one');
  await this.db.runTransaction(async tx => {
   const lineage = await this.daily.compositionIn(r => tx.get(r));
   const live = (await tx.get(ref)).data(), prior = await tx.get(attempt);
   if (lineage.run.source !== run.source || lineage.run.scopeDigest !== run.scopeDigest || !matches(live, childId, run) || live.phase !== 'open' || keys.some(k => live[k] !== doc[k]) || this.now() >= live.expiresAt || prior.exists) throw fail();
   tx.create(attempt, { state: 'started', startedAt: this.now() });
  });
  return { run, parent, childId, ref, doc, attempt };
 }
 async save(claim: Awaited<ReturnType<DailyOneComposer['claim']>>, value: { status: number; body: unknown }, cohort: CustomerCohort,
  validate: (value: { status: number; body: unknown }, report: string) => boolean) {
  const active = currentClosedComposition(), { run, parent, childId, ref, doc } = claim, computedAt = this.now(), json = JSON.stringify(value);
  const witness = cohortSnapshotWitness(cohort), jobs = active ? [...active.jobTimes].map(([id, endedAt]) => ({ id, endedAt })) : [];
  if (!active || active.store !== parent || active.jobs.size !== jobs.length || !witness || currentLegacyReportKey() !== `${cohort.cacheKey}:${run.reports[0]}`
   || hash(`${cohort.cacheKey}:${run.reports[0]}`) !== run.measurementScopes[hash(run.reports[0])] || !validate(value, run.reports[0])
   || Buffer.byteLength(json) > 700_000 || jobs.length !== run.parentReservedJobs || !jobs.length
   || jobs.some(job => !active.jobs.has(job.id) || !new RegExp(`^metrics_${run.parentId}_[a-f0-9]{64}$`).test(job.id)
     || job.endedAt < run.parentCreatedAt! || job.endedAt > computedAt + 10_000)) throw fail();
  await requireCurrentCustomerCohort(cohort.cacheKey);
  const target = ref.collection('snapshots').doc(hash(run.reports[0]));
  await this.db.runTransaction(async tx => {
   const lineage = await this.daily.compositionIn(r => tx.get(r));
   const live = (await tx.get(ref)).data(), existing = await tx.get(target), attempt = await tx.get(claim.attempt);
   const reservations = await Promise.all(jobs.map(job => tx.get(this.db.doc(`metricsOneDailyRuns/${run.parentId}`).collection('reservations').doc(job.id.slice(-64)))));
   if (lineage.run.source !== run.source || lineage.run.scopeDigest !== run.scopeDigest || !matches(live, childId, run) || live.phase !== 'open' || keys.some(k => live[k] !== doc[k]) || this.now() >= live.expiresAt
    || existing.exists || attempt.data()?.state !== 'started' || reservations.some((snapshot, index) => !snapshot.exists
      || snapshot.data()?.jobId !== jobs[index].id || snapshot.data()?.state !== 'started'
      || snapshot.data()?.reportHash !== hash(run.reports[0]) || snapshot.data()?.scopeHash !== hash(`${cohort.cacheKey}:${run.reports[0]}`)
      || !Number.isSafeInteger(snapshot.data()?.bytes) || snapshot.data()?.bytes < 1 || snapshot.data()?.bytes > run.maxPerJobBytes
      || !Number.isSafeInteger(snapshot.data()?.startedAt) || snapshot.data()?.startedAt > jobs[index].endedAt)) throw fail();
   requireFreshCohort(cohort);
   tx.create(target, { state: 'pending', source: doc.source, parentId: run.parentId, parentSource: run.parentSource, childId,
    logicalAsOf: run.logicalAsOf, reportHash: hash(run.reports[0]), computedAt, jobs, json, witness, nonWarehouseFreshness: 'unknown' });
  });
  await requireCurrentCustomerCohort(cohort.cacheKey);
  await this.db.runTransaction(async tx => {
   const lineage = await this.daily.compositionIn(r => tx.get(r));
   const live = (await tx.get(ref)).data(), snapshot = await tx.get(target);
   if (lineage.run.source !== run.source || lineage.run.scopeDigest !== run.scopeDigest || !matches(live, childId, run) || live.phase !== 'open' || keys.some(k => live[k] !== doc[k]) || this.now() >= live.expiresAt || snapshot.data()?.state !== 'pending'
    || snapshot.data()?.computedAt !== computedAt) throw fail();
   requireFreshCohort(cohort); tx.update(target, { state: 'verified' });
  });
  return computedAt;
 }
}
export function composerMatchesCohort(snapshot: any, cohort: CustomerCohort) {
 return !!snapshot.witness && cohortMatchesSnapshotWitness(cohort, snapshot.witness);
}
export async function configuredDailyOneComposer(daily: DailyOneRefresh) {
 const id = process.env.METRICS_DAILY_ONE_COMPOSER_ID, source = process.env.METRICS_DAILY_ONE_COMPOSER_SOURCE;
 if (!id && !source) return null;
 if (!id || !source) throw fail();
 return new DailyOneComposer(await nativeDatabase(), id, source, daily);
}
