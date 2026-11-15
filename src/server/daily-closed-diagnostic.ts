import type { Firestore } from '@google-cloud/firestore';
import { nativeDatabase } from './legacy-restoration';
import type { DailyOneRefresh } from './daily-one-refresh';

type Database = Pick<Firestore, 'doc' | 'runTransaction'>;
type Observation = { stage: string; reason: string | null; jobs: number; maxRows: number; maxBytes: number; payloadBytes: number };
const fail = () => new Error('Closed daily diagnostic is unavailable.');
/** One private, write-once diagnostic claim; no query admission is exposed. */
export class DailyClosedDiagnostic {
  constructor(private db: Database, private id: string, private source: string, private daily: DailyOneRefresh, private now = Date.now) {
    if (!/^dailycheck_[a-f0-9]{16}$/.test(id) || !/^[a-f0-9]{40}$/.test(source)) throw fail();
  }
  async claim(report: string) {
    const { run, id } = await this.daily.closedDescriptor(), ref = this.db.doc(`metricsDailyClosedDiagnostics/${this.id}`);
    const doc = (await ref.get()).data(), now = this.now();
    if (!doc || doc.phase !== 'open' || doc.source !== this.source || doc.runId !== id || doc.runSource !== run.source || doc.logicalAsOf !== run.logicalAsOf
      || doc.report !== report || report !== run.reports[run.parentDepth === 2 ? 4 : run.parentId ? 1 : 0] || doc.reportDigest !== run.reportDigest
      || !Number.isSafeInteger(doc.createdAt) || !Number.isSafeInteger(doc.expiresAt) || now < doc.createdAt || now >= doc.expiresAt
      || doc.expiresAt - doc.createdAt > 3600_000) throw fail();
    const attempt = ref.collection('attempts').doc('one');
    await this.db.runTransaction(async tx => {
      const live = (await tx.get(ref)).data(), prior = await tx.get(attempt), time = this.now();
      if (!live || live.phase !== 'open' || live.source !== doc.source || live.runId !== doc.runId || live.runSource !== doc.runSource || live.report !== report
        || live.logicalAsOf !== doc.logicalAsOf || live.reportDigest !== doc.reportDigest || live.createdAt !== doc.createdAt
        || live.expiresAt !== doc.expiresAt || time >= live.expiresAt || prior.exists) throw fail();
      tx.create(attempt, { state: 'started', startedAt: time });
    });
    return { run, attempt };
  }
  async finish(attempt: any, observation: Observation) {
    const allowed = ['cohort', 'capture', 'payload', 'cohort-recheck', 'complete'];
    const reasons = [null, 'missing-reservation', 'result-bound', 'native-verification', 'native-access', 'source-error', 'incomplete-source', 'invalid-payload', 'cohort-unavailable'];
    if (!allowed.includes(observation.stage) || !reasons.includes(observation.reason)
      || [observation.jobs, observation.maxRows, observation.maxBytes, observation.payloadBytes].some(n => !Number.isSafeInteger(n) || n < 0)) throw fail();
    await this.db.runTransaction(async (tx: any) => {
      const snap = await tx.get(attempt); if (!snap.exists || snap.data()?.state !== 'started') throw fail();
      tx.update(attempt, { state: 'finished', finishedAt: this.now(), ...observation });
    });
  }
}
export async function configuredDailyClosedDiagnostic(daily: DailyOneRefresh) {
  const id = process.env.METRICS_DAILY_CLOSED_DIAGNOSTIC_ID, source = process.env.METRICS_DAILY_CLOSED_DIAGNOSTIC_SOURCE;
  if (!id && !source) return null;
  if (!id || !source) throw fail();
  return new DailyClosedDiagnostic(await nativeDatabase(), id, source, daily);
}
