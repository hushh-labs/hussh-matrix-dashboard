import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import type { Firestore } from '@google-cloud/firestore';
import { currentLegacyReportKey, nativeDatabase, restorationReportDigest } from './legacy-restoration';
import { dailyOneManifest } from './daily-one-refresh';

type Database = Pick<Firestore, 'doc' | 'runTransaction'>;
type Document = { source: string; targetRunId: string; day: string; logicalAsOf: string; reports: string[]; reportDigest: string; createdAt: number; expiresAt: number; phase: 'open' | 'closing' | 'closed'; maxDryRuns: number; attempted: number };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const fail = () => new Error('The bounded One measurement is unavailable.');
const context = new AsyncLocalStorage<{ measurement: DailyOneMeasurement; report: string; logicalAsOf: string }>();
export const currentDailyOneMeasurement = () => context.getStore();
export async function withDailyOneMeasurement<T>(measurement: DailyOneMeasurement, report: string, load: () => Promise<T>) {
  const doc = await measurement.requireOpen(report);
  return context.run({ measurement, report, logicalAsOf: doc.logicalAsOf }, load);
}
/** Native dry runs only; this object cannot reserve or execute a paid job. */
export class DailyOneMeasurement {
  constructor(private db: Database, private id: string, private source: string, private now = Date.now) {
    if (!/^dailymeasure_\d{8}_[a-f0-9]{16}$/.test(id) || !/^[a-f0-9]{40}$/.test(source)) throw fail();
  }
  private ref() { return this.db.doc(`metricsOneDailyMeasurements/${this.id}`); }
  private checked(doc: Document | undefined) {
    if (!doc || doc.source !== this.source || !/^refresh_\d{8}_[a-f0-9]{16}$/.test(doc.targetRunId ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(doc.day) || this.id.slice(13, 21) !== doc.day.replaceAll('-', '')
      || !Number.isSafeInteger(doc.createdAt) || !Number.isSafeInteger(doc.expiresAt) || doc.expiresAt <= doc.createdAt || doc.expiresAt - doc.createdAt > 3600_000
      || new Date(doc.createdAt).toISOString().slice(0, 10) !== doc.day || !Number.isFinite(Date.parse(doc.logicalAsOf)) || new Date(doc.logicalAsOf).toISOString() !== doc.logicalAsOf
      || Date.parse(doc.logicalAsOf) > doc.createdAt || Date.parse(doc.day) - Date.parse(doc.logicalAsOf.slice(0, 10)) < 0 || Date.parse(doc.day) - Date.parse(doc.logicalAsOf.slice(0, 10)) > 86_400_000
      || doc.targetRunId.slice(8, 16) !== doc.day.replaceAll('-', '') || !['open', 'closing', 'closed'].includes(doc.phase) || !Array.isArray(doc.reports) || restorationReportDigest(doc.reports) !== doc.reportDigest
      || restorationReportDigest(dailyOneManifest(doc.logicalAsOf.slice(0, 10))) !== doc.reportDigest
      || !Number.isSafeInteger(doc.maxDryRuns) || doc.maxDryRuns < 1 || doc.maxDryRuns > 250 || !Number.isSafeInteger(doc.attempted) || doc.attempted < 0 || doc.attempted > doc.maxDryRuns) throw fail();
    return doc;
  }
  async requireOpen(report: string) {
    const doc = this.checked((await this.ref().get()).data() as Document), now = this.now();
    if (doc.phase !== 'open' || now < doc.createdAt || now >= doc.expiresAt || new Date(now).toISOString().slice(0, 10) !== doc.day || !doc.reports.includes(report)) throw fail();
    return doc;
  }
  async claim(report: string, query: string) {
    const doc = await this.requireOpen(report), scope = currentLegacyReportKey();
    if (!scope || !scope.endsWith(`:${report}`) || !/^(?:SELECT|WITH)\b/i.test(query.trim())) throw fail();
    const separator = scope.indexOf(':'), cohort = scope.slice(0, separator), environment = new URL(report, 'http://analytics.internal').searchParams.get('environment');
    if (separator < 0 || (environment === 'production' ? !/^[a-f0-9]{64}$/.test(cohort) : environment !== 'uat' || cohort !== '')) throw fail();
    const scopeHash = hash(scope), planHash = hash(JSON.stringify({ schema: 1, source: this.source, report, scopeHash, asOf: doc.logicalAsOf, project: 'hushh-ai-prod', location: 'US', query }));
    const attempt = this.ref().collection('attempts').doc(planHash);
    return this.db.runTransaction(async tx => {
      const live = this.checked((await tx.get(this.ref())).data() as Document), prior = await tx.get(attempt), now = this.now();
      if (live.phase !== 'open' || now < live.createdAt || now >= live.expiresAt || new Date(now).toISOString().slice(0, 10) !== live.day
        || live.reportDigest !== doc.reportDigest || live.logicalAsOf !== doc.logicalAsOf || !live.reports.includes(report)) throw fail();
      if (prior.exists) { const row = prior.data(); if (row?.state !== 'measured' || row.scopeHash !== scopeHash || row.reportHash !== hash(report) || !Number.isSafeInteger(row.processed) || row.processed < 0 || !Number.isSafeInteger(row.bound) || row.bound < 1 || !/^[a-f0-9]{64}$/.test(row.referenceDigest ?? '')) throw fail(); return { planHash, existing: row }; }
      if (live.attempted >= live.maxDryRuns) throw fail();
      tx.update(this.ref(), { attempted: live.attempted + 1 });
      tx.create(attempt, { state: 'pending', planHash, scopeHash, reportHash: hash(report), startedAt: now });
      return { planHash, existing: null };
    });
  }
  async finish(planHash: string, outcome: { processed: number; bound: number; referenceDigest: string } | null) {
    if (!/^[a-f0-9]{64}$/.test(planHash) || (outcome && (!Number.isSafeInteger(outcome.processed) || outcome.processed < 0 || !Number.isSafeInteger(outcome.bound) || outcome.bound < 1 || !/^[a-f0-9]{64}$/.test(outcome.referenceDigest)))) throw fail();
    const attempt = this.ref().collection('attempts').doc(planHash);
    await this.db.runTransaction(async tx => {
      const doc = this.checked((await tx.get(this.ref())).data() as Document), row = await tx.get(attempt), now = this.now();
      if (doc.phase !== 'open' || now < doc.createdAt || now >= doc.expiresAt || new Date(now).toISOString().slice(0, 10) !== doc.day || !row.exists || row.data()?.state !== 'pending') throw fail();
      tx.update(attempt, { state: outcome ? 'measured' : 'failed', finishedAt: now, ...(outcome ?? {}) });
    });
  }
  async noteReport(report: string) {
    const doc = await this.requireOpen(report), ref = this.ref().collection('reports').doc(hash(report));
    await this.db.runTransaction(async tx => {
      const live = this.checked((await tx.get(this.ref())).data() as Document), prior = await tx.get(ref), now = this.now();
      if (live.phase !== 'open' || now < live.createdAt || now >= live.expiresAt || new Date(now).toISOString().slice(0, 10) !== live.day
        || live.reportDigest !== doc.reportDigest || !live.reports.includes(report) || prior.exists) throw fail();
      tx.create(ref, { reportHash: hash(report), finishedAt: now });
    });
  }
  /** Freeze attempts before reading them; uncertain intents prevent a seal. */
  async seal() {
    const root = this.ref();
    const doc = await this.db.runTransaction(async tx => {
      const live = this.checked((await tx.get(root)).data() as Document), now = this.now();
      if (live.phase !== 'open' || now < live.createdAt || now >= live.expiresAt || new Date(now).toISOString().slice(0, 10) !== live.day) throw fail();
      tx.update(root, { phase: 'closing' }); return live;
    });
    const [attempts, ...markers] = await Promise.all([root.collection('attempts').get(), ...doc.reports.map(report => root.collection('reports').doc(hash(report)).get())]);
    if (attempts.size !== doc.attempted || !attempts.size || attempts.size > doc.maxDryRuns
      || markers.some((marker, index) => !marker.exists || marker.data()?.reportHash !== hash(doc.reports[index]))) throw fail();
    const rows = attempts.docs.map(snapshot => snapshot.data()).sort((a, b) => String(a.planHash).localeCompare(String(b.planHash)));
    const reportHashes = new Set(doc.reports.map(hash));
    if (rows.some(row => row.state !== 'measured' || !/^[a-f0-9]{64}$/.test(row.planHash ?? '') || !/^[a-f0-9]{64}$/.test(row.scopeHash ?? '')
      || !reportHashes.has(row.reportHash) || !Number.isSafeInteger(row.processed) || row.processed < 0 || !Number.isSafeInteger(row.bound) || row.bound < 1
      || !/^[a-f0-9]{64}$/.test(row.referenceDigest ?? '')) || new Set(rows.map(row => row.planHash)).size !== rows.length
      || [...reportHashes].some(reportHash => !rows.some(row => row.reportHash === reportHash))) throw fail();
    const measuredBytes = rows.reduce((sum, row) => sum + row.bound, 0), measuredQueries = rows.length;
    if (!Number.isSafeInteger(measuredBytes)) throw fail();
    const digest = hash(JSON.stringify({ schema: 1, source: this.source, targetRunId: doc.targetRunId, day: doc.day, logicalAsOf: doc.logicalAsOf,
      reportDigest: doc.reportDigest, attempts: rows.map(row => [row.planHash, row.reportHash, row.scopeHash, row.processed, row.bound, row.referenceDigest]) }));
    const summary = this.db.doc(`metricsOneDailyMeasurements/${doc.targetRunId}`);
    await this.db.runTransaction(async tx => {
      const live = this.checked((await tx.get(root)).data() as Document), previous = await tx.get(summary), now = this.now();
      if (live.phase !== 'closing' || live.attempted !== doc.attempted || now >= live.expiresAt || new Date(now).toISOString().slice(0, 10) !== live.day || previous.exists) throw fail();
      tx.create(summary, { phase: 'sealed', runId: doc.targetRunId, source: this.source, day: doc.day, logicalAsOf: doc.logicalAsOf,
        reportDigest: doc.reportDigest, digest, measuredBytes, measuredQueries, coverage: 'not exhaustive', sealedAt: now });
      tx.update(root, { phase: 'closed' });
    });
    return { digest, measuredBytes, measuredQueries, coverage: 'not exhaustive' as const };
  }
}

let configured: { key: string; promise: Promise<DailyOneMeasurement> } | undefined;
export async function dailyOneMeasurement(): Promise<DailyOneMeasurement | null> {
  const id = process.env.METRICS_DAILY_MEASUREMENT_ID, source = process.env.METRICS_DAILY_ONE_SOURCE;
  if (!id && !source) return null;
  if (!/^dailymeasure_\d{8}_[a-f0-9]{16}$/.test(id ?? '') || !/^[a-f0-9]{40}$/.test(source ?? '')) throw fail();
  const key = `${id}:${source}`;
  if (configured?.key !== key) configured = { key, promise: nativeDatabase().then(db => new DailyOneMeasurement(db, id!, source!)) };
  return configured.promise;
}
