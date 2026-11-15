import { createHash } from 'node:crypto';
import type { Firestore } from '@google-cloud/firestore';
import { dailyOneManifest } from './daily-one-refresh';
import { nativeDatabase, restorationReportDigest } from './legacy-restoration';
import { readCustomerCohort, requireFreshCohort, type CustomerCohort } from './one-customer-cohort';

type Database = Pick<Firestore, 'doc'>;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const fail = () => new Error('Daily One cohort preflight is unavailable.');
const digestScopes = (scopes: Record<string, string>) => hash(JSON.stringify(Object.entries(scopes).sort(([a], [b]) => a.localeCompare(b))));
/** Authenticated operator-only, read-only check: never exposes membership or submits queries. */
export async function verifyDailyOneCohortPreflight(db: Database, id: string, source: string,
  load: () => Promise<CustomerCohort> = () => readCustomerCohort(300_000), now = Date.now): Promise<boolean> {
  if (!/^preflight_\d{8}_[a-f0-9]{16}$/.test(id) || !/^[a-f0-9]{40}$/.test(source)) throw fail();
  const doc = (await db.doc(`metricsOneDailyPreflights/${id}`).get()).data(), current = now();
  if (!doc || doc.phase !== 'open' || doc.source !== source || !/^\d{4}-\d{2}-\d{2}$/.test(doc.day ?? '')
    || id.slice(10, 18) !== doc.day.replaceAll('-', '') || new Date(current).toISOString().slice(0, 10) !== doc.day
    || !Number.isSafeInteger(doc.createdAt) || !Number.isSafeInteger(doc.expiresAt) || current < doc.createdAt || current >= doc.expiresAt
    || doc.expiresAt - doc.createdAt > 3600_000 || !/^refresh_\d{8}_[a-f0-9]{16}$/.test(doc.runId ?? '')
    || !/^dailymeasure_\d{8}_[a-f0-9]{16}$/.test(doc.measurementId ?? '') || doc.runId.slice(8, 16) !== id.slice(10, 18)
    || doc.measurementId.slice(13, 21) !== id.slice(10, 18) || !/^[a-f0-9]{40}$/.test(doc.measurementSource ?? '')
    || !/^[a-f0-9]{64}$/.test(doc.measurementDigest ?? '') || !Number.isFinite(Date.parse(doc.logicalAsOf))
    || new Date(doc.logicalAsOf).toISOString() !== doc.logicalAsOf || Date.parse(doc.logicalAsOf) > doc.createdAt
    || Date.parse(doc.day) - Date.parse(doc.logicalAsOf.slice(0, 10)) < 0 || Date.parse(doc.day) - Date.parse(doc.logicalAsOf.slice(0, 10)) > 86_400_000) throw fail();
  const reports = dailyOneManifest(doc.logicalAsOf.slice(0, 10)), keys = reports.map(hash);
  if (restorationReportDigest(reports) !== doc.reportDigest || !doc.scopes || !doc.samples || typeof doc.scopes !== 'object' || typeof doc.samples !== 'object'
    || Array.isArray(doc.scopes) || Array.isArray(doc.samples) || Object.keys(doc.scopes).length !== 10 || Object.keys(doc.samples).length !== 10
    || keys.some(key => !/^[a-f0-9]{64}$/.test(doc.scopes[key] ?? '') || !/^[a-f0-9]{64}$/.test(doc.samples[key] ?? ''))
    || new Set(Object.values(doc.samples)).size !== 10 || digestScopes(doc.scopes) !== doc.scopeDigest) throw fail();
  const [measurement, summary, ...samples] = await Promise.all([
    db.doc(`metricsOneDailyMeasurements/${doc.measurementId}`).get(), db.doc(`metricsOneDailyMeasurements/${doc.runId}`).get(),
    ...keys.map(key => db.doc(`metricsOneDailyMeasurements/${doc.measurementId}/attempts/${doc.samples[key]}`).get()),
  ]);
  const original = measurement.data(), sealed = summary.data();
  if (!measurement.exists || original?.phase !== 'closed' || original.source !== doc.measurementSource || original.targetRunId !== doc.runId
    || original.day !== doc.day || original.logicalAsOf !== doc.logicalAsOf || original.reportDigest !== doc.reportDigest
    || !Number.isSafeInteger(original.expiresAt) || doc.expiresAt > original.expiresAt || current >= original.expiresAt
    || !summary.exists || sealed?.phase !== 'sealed' || sealed.source !== doc.measurementSource || sealed.runId !== doc.runId
    || sealed.digest !== doc.measurementDigest || sealed.reportDigest !== doc.reportDigest || sealed.logicalAsOf !== doc.logicalAsOf
    || sealed.coverage !== 'not exhaustive' || sealed.measuredQueries !== original.attempted || samples.some((snapshot, index) => !snapshot.exists || snapshot.data()?.state !== 'measured'
      || snapshot.data()?.planHash !== doc.samples[keys[index]] || snapshot.data()?.reportHash !== keys[index] || snapshot.data()?.scopeHash !== doc.scopes[keys[index]])) throw fail();
  const before = requireFreshCohort(await load());
  if (!/^[a-f0-9]{64}$/.test(before.cacheKey)) throw fail();
  const matches = reports.every((report, index) => {
    const env = new URL(report, 'http://analytics.internal').searchParams.get('environment');
    return doc.scopes[keys[index]] === hash(`${env === 'production' ? before.cacheKey : ''}:${report}`);
  });
  const after = requireFreshCohort(await load());
  if (now() >= doc.expiresAt || now() >= original.expiresAt || new Date(now()).toISOString().slice(0, 10) !== doc.day || after.cacheKey !== before.cacheKey) throw fail();
  return matches;
}
export async function configuredDailyOneCohortPreflight(): Promise<boolean | null> {
  const id = process.env.METRICS_DAILY_PREFLIGHT_ID, source = process.env.METRICS_DAILY_ONE_SOURCE;
  if (!id && !source) return null;
  if (!id || !source) throw fail();
  return verifyDailyOneCohortPreflight(await nativeDatabase(), id, source);
}
