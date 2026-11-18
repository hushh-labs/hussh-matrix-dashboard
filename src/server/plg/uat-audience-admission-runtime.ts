import { createHash } from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';
import { FirestoreReportStore, reportPath, type ReportStore } from '../reports/store';

/** Check the approved identity in the same transaction as every admission or
 * completion. Cross-database/revision consistency also needs a rollout fence. */
export function bindUatAudienceStore(base: ReportStore, project: string, database: string, key: string): ReportStore {
  const keyDigest = createHash('sha256').update(key).digest('hex');
  return { transaction: fn => base.transaction(async tx => {
    const binding = await tx.get<Record<string, unknown>>(reportPath('policy', 'uat-audience-binding'));
    if (!binding || Object.keys(binding).sort().join() !== 'approved,database,keyDigest,project'
      || binding.approved !== true || binding.project !== project || binding.database !== database || binding.keyDigest !== keyDigest)
      throw new Error('UAT audience admission unavailable');
    return fn(tx);
  }) };
}

let cached: { project: string; database: string; key: string; store: ReportStore } | undefined;
const makeStore = (project: string, database: string): ReportStore =>
  new FirestoreReportStore(new Firestore({ projectId: project, databaseId: database }));

/** Default-off. The operator must configure the canonical shared reporting DB,
 * a dedicated digest key and both approved policy documents before activation. */
export function uatAudienceAdmissionRuntime(env: NodeJS.ProcessEnv = process.env, factory: (project: string, database: string) => ReportStore = makeStore): { store: ReportStore; key: string } {
  const project = env.METRICS_UAT_AUDIENCE_PROJECT ?? '', database = env.METRICS_UAT_AUDIENCE_DATABASE ?? '', key = env.METRICS_UAT_AUDIENCE_DIGEST_KEY ?? '';
  if (env.METRICS_UAT_AUDIENCE_ADMISSION_ENABLED !== 'true'
    || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project) || !/^metrics-[a-z0-9-]{1,50}$/.test(database)
    || project !== env.METRICS_REPORTING_PROJECT || database !== env.METRICS_REPORTING_DATABASE
    || key.length < 32 || env.FIRESTORE_EMULATOR_HOST) throw new Error('UAT audience admission unavailable');
  if (cached && cached.project === project && cached.database === database && cached.key === key) return cached;
  if (cached) throw new Error('UAT audience admission unavailable'); // config changes require a new process
  const store = bindUatAudienceStore(factory(project, database), project, database, key);
  cached = { project, database, key, store };
  return cached;
}
