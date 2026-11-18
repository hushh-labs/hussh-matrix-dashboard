import { ReportError } from './contracts';
import { validateUatTwoSourcePolicies } from './uat-two-source-manifest';

/** An approved service policy authorizes aggregate collection, not a user's
 * current Google membership. Every web read/admission still checks a session. */
export function validateUatServicePolicy(value:unknown, source:unknown, now:number, sourceRecovery=false) {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new ReportError('unavailable');
  const p=value as any;
  if (Object.keys(p).sort().join()!=='approved,enabled,expiresAt,manifestDigest,maxResponseBytes,queueParent,reportingDatabase,reportingProject,rpcTimeoutMs,scopeDigest,sourceGeneration,taskInvoker,webInvoker,workerAudience'
    || p.approved!==true || p.enabled!==true || !Number.isSafeInteger(now) || !Number.isSafeInteger(p.expiresAt) || p.expiresAt<=now
    || typeof p.reportingProject!=='string' || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(p.reportingProject)
    || typeof p.reportingDatabase!=='string' || !/^metrics-[a-z0-9-]{1,50}$/.test(p.reportingDatabase)
    || !Number.isSafeInteger(p.rpcTimeoutMs) || p.rpcTimeoutMs<1 || p.rpcTimeoutMs>60000
    || !Number.isSafeInteger(p.maxResponseBytes) || p.maxResponseBytes<1 || p.maxResponseBytes>900000
    || p.taskInvoker!==`metrics-report-task-invoker@${p.reportingProject}.iam.gserviceaccount.com`
    || p.webInvoker!==`metrics-report-web@${p.reportingProject}.iam.gserviceaccount.com`
    || typeof p.queueParent!=='string' || !new RegExp(`^projects/${p.reportingProject}/locations/[a-z0-9-]+/queues/metrics-uat-detail-[a-z0-9-]+$`).test(p.queueParent)) throw new ReportError('unavailable');
  let audience:URL; try { audience=new URL(p.workerAudience); } catch { throw new ReportError('unavailable'); }
  if (audience.protocol!=='https:' || !audience.hostname.endsWith('.run.app') || audience.origin!==p.workerAudience
    || audience.username || audience.password || audience.port || audience.search || audience.hash) throw new ReportError('unavailable');
  const approved=validateUatTwoSourcePolicies(source,now,sourceRecovery);
  if (p.manifestDigest!==approved.manifestDigest || p.scopeDigest!==approved.manifest.scopeDigest
    || p.sourceGeneration!==approved.manifest.sourceGeneration) throw new ReportError('unavailable');
  return Object.freeze({...p});
}
