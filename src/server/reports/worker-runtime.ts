import { Firestore } from '@google-cloud/firestore';
import { MetricsReports, MetricsReportWorker } from './service';
import { FirestoreReportMaintenanceStore } from './maintenance-store';
import { MetricsReportMaintenance } from './maintenance';
import { ReportBodyCache } from './body-cache';
import { CloudReportTaskQueue, MetricsReportDispatch } from './dispatch';
import { MetricsCollection } from './lifecycle';
import { collectorSourceFactory } from './source-factory';
import { cloudTasksRequest } from './transports';
import { digest, ReportError, type ReportAccess } from './contracts';

export type ReportingRuntimeConfig = { projectId: string; databaseId: string; scopeDigest: string;
  workerAudience: string; webInvokerEmail: string; taskInvokerEmail: string; dispatcherInvokerEmail: string;
  queueParent: string; collectionEnabled: boolean; rpcTimeoutMs: number; maxResponseBytes: number; maxRequestBytes: number;
  bodyCacheEntries: number; bodyCacheBytes: number };
export function reportingRuntimeConfig(value: unknown): ReportingRuntimeConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ReportError('unavailable');
  const c = value as ReportingRuntimeConfig;
  let origin: URL;
  try { origin = new URL(c.workerAudience); } catch { throw new ReportError('unavailable'); }
  if (Object.keys(c).sort().join() !== ['projectId', 'databaseId', 'scopeDigest', 'workerAudience', 'webInvokerEmail', 'taskInvokerEmail',
    'dispatcherInvokerEmail', 'queueParent', 'collectionEnabled', 'rpcTimeoutMs', 'maxResponseBytes', 'maxRequestBytes', 'bodyCacheEntries', 'bodyCacheBytes'].sort().join()
    || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(c.projectId) || !/^metrics-[a-z0-9-]{1,50}$/.test(c.databaseId)
    || !/^[a-f0-9]{64}$/.test(c.scopeDigest) || typeof c.collectionEnabled !== 'boolean'
    || origin.protocol !== 'https:' || !origin.hostname.endsWith('.run.app') || origin.origin !== c.workerAudience
    || ![c.rpcTimeoutMs, c.maxResponseBytes, c.maxRequestBytes, c.bodyCacheEntries, c.bodyCacheBytes].every(v => Number.isSafeInteger(v) && v > 0)
    || c.rpcTimeoutMs > 0xffff_ffff || c.maxResponseBytes > 900_000 || c.maxRequestBytes > 8192
    || c.webInvokerEmail !== `metrics-report-web@${c.projectId}.iam.gserviceaccount.com`
    || c.taskInvokerEmail !== `metrics-report-task-invoker@${c.projectId}.iam.gserviceaccount.com`
    || c.dispatcherInvokerEmail !== `metrics-report-dispatcher@${c.projectId}.iam.gserviceaccount.com`
    || !c.queueParent.startsWith(`projects/${c.projectId}/locations/`)) throw new ReportError('unavailable');
  // Structural validation only; this does not send a native request.
  new CloudReportTaskQueue({ parent: c.queueParent, workerUrl: `${c.workerAudience}/internal/metrics/collect`,
    invokerEmail: c.taskInvokerEmail, rpcTimeoutMs: c.rpcTimeoutMs }, async () => { throw new Error('Unused validation transport'); });
  return c;
}
export function reportingRuntimeConfigFromEnv(env: Record<string, string | undefined> = process.env) {
  if (env.METRICS_WORKER_RUNTIME !== 'reporting' || env.METRICS_BIGQUERY_ENABLED !== 'false' || env.FIRESTORE_EMULATOR_HOST) throw new ReportError('unavailable');
  try { return reportingRuntimeConfig(JSON.parse(env.METRICS_COLLECTOR_CONFIG ?? '')); }
  catch { throw new ReportError('unavailable'); }
}
export function createReportingRuntime(config: ReportingRuntimeConfig) {
  config = reportingRuntimeConfig(config);
  const db = new Firestore({ projectId: config.projectId, databaseId: config.databaseId });
  const store = new FirestoreReportMaintenanceStore(db), reports = new MetricsReports(store, Date.now,
    new ReportBodyCache(config.bodyCacheEntries, config.bodyCacheBytes));
  const taskQueue = new CloudReportTaskQueue({ parent: config.queueParent,
    workerUrl: `${config.workerAudience}/internal/metrics/collect`, invokerEmail: config.taskInvokerEmail, rpcTimeoutMs: config.rpcTimeoutMs },
  cloudTasksRequest(config.maxResponseBytes));
  const dispatch = new MetricsReportDispatch(store, taskQueue);
  const collection = new MetricsCollection(store, collectorSourceFactory(store));
  const enabled = () => { if (!config.collectionEnabled) throw new ReportError('unavailable'); };
  const maintenance = new MetricsReportMaintenance(store, async job => {
    enabled();
    if (job.sourceStarted) await collection.collect(job.id, digest(config.taskInvokerEmail));
    else if (job.expiresAt <= Date.now()) await new MetricsReportWorker(store).claim(job.id, digest(config.dispatcherInvokerEmail));
    else await dispatch.deliver(job.id, digest(config.dispatcherInvokerEmail));
  });
  return {
    read: (input: unknown, access: ReportAccess) => reports.read(input, access),
    status: (id: string, access: ReportAccess) => reports.status(id, access),
    async request(input: unknown, access: ReportAccess) {
      enabled(); const accepted = await reports.request(input, access);
      if (accepted.jobId) {
        try { await dispatch.deliver(accepted.jobId, digest(config.dispatcherInvokerEmail)); }
        catch { /* The durable intent survives enqueue failure; an explicit dispatcher recovers it. */ }
      }
      return accepted;
    },
    dispatch(id: string) { enabled(); return dispatch.deliver(id, digest(config.dispatcherInvokerEmail)); },
    collect(id: string) { enabled(); return collection.collect(id, digest(config.taskInvokerEmail)); },
    maintain() { enabled(); return maintenance.run(digest(config.dispatcherInvokerEmail)); },
    async schedule(input: unknown) {
      enabled();
      const accepted = await reports.requestScheduled(input, { subjectHash: digest(config.dispatcherInvokerEmail), scopeDigest: config.scopeDigest });
      if (accepted.jobId) await dispatch.deliver(accepted.jobId, digest(config.dispatcherInvokerEmail));
      return accepted;
    },
    close: () => db.terminate(),
  };
}
