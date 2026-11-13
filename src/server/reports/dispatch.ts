import { digest, ReportError, validatePolicy, type ReportControl, type ReportJob, type ReportingPolicy } from './contracts';
import { reportPath, type ReportStore } from './store';

export type DispatchPolicy = { approved: boolean; enabled: boolean; leaseMs: number; lookupDelayMs: number; maxLookups: number };
type DispatchReceipt = { taskName: string; state: 'uncertain' | 'queued' | 'blocked' | 'settled';
  fence: number; ownerHash: string; leaseUntil: number; nextLookupAt: number; lookups: number };
export interface ReportTaskQueue {
  taskName(jobId: string): string;
  create(jobId: string): Promise<'accepted' | 'rejected'>;
  lookup(jobId: string): Promise<'present' | 'missing' | 'rejected'>;
}
function dispatchPolicy(value: DispatchPolicy | null) {
  if (!value || Object.keys(value).sort().join() !== 'approved,enabled,leaseMs,lookupDelayMs,maxLookups'
    || value.approved !== true || value.enabled !== true
    || ![value.leaseMs, value.lookupDelayMs, value.maxLookups].every(v => Number.isSafeInteger(v) && v > 0)) throw new ReportError('unavailable');
  return value;
}

/** Durable enqueue bridge; only an explicit private dispatcher calls it.
 * Rendering and report reads never import this module. */
export class MetricsReportDispatch {
  constructor(private store: ReportStore, private queue: ReportTaskQueue, private now: () => number = Date.now) {}
  async deliver(jobId: string, ownerHash: string) {
    if (!/^[a-f0-9]{64}$/.test(jobId) || !/^[a-f0-9]{64}$/.test(ownerHash)) throw new ReportError('invalid');
    const now = this.now(), taskName = this.queue.taskName(jobId);
    const intent = await this.store.transaction(async tx => {
      const policy = dispatchPolicy(await tx.get<DispatchPolicy>(reportPath('policy', 'dispatch')));
      const reporting = validatePolicy(await tx.get<ReportingPolicy>(reportPath('policy', 'current')));
      const job = await tx.get<ReportJob>(reportPath('jobs', jobId));
      const current = await tx.get<DispatchReceipt>(reportPath('dispatches', jobId));
      if (!job || !reporting.computeEnabled) throw new ReportError('unavailable');
      const control = await tx.get<ReportControl>(reportPath('controls', job.request.reportId));
      if (current && current.taskName !== taskName) throw new ReportError('unavailable');
      if (['completed', 'failed', 'invalidated'].includes(job.status)) {
        if (current) tx.set(reportPath('dispatches', jobId), { ...current, state: 'settled', leaseUntil: 0 });
        return { state: 'settled' as const };
      }
      if (digest(control) !== digest(job.control) || !job.sourceStarted && job.expiresAt <= now) return { state: 'skipped' as const };
      if (current?.state === 'blocked') return { state: current.state };
      if (current && (current.leaseUntil > now || current.nextLookupAt > now)) return { state: 'delayed' as const };
      if (!current && job.sourceStarted) return { state: 'skipped' as const };
      if (current && (!Number.isSafeInteger(current.lookups) || current.lookups < 0 || current.lookups >= policy.maxLookups)) {
        tx.set(reportPath('dispatches', jobId), { ...current, state: 'blocked', leaseUntil: 0 });
        return { state: 'blocked' as const };
      }
      const receipt: DispatchReceipt = { taskName, state: 'uncertain', fence: (current?.fence ?? 0) + 1,
        ownerHash, leaseUntil: now + policy.leaseMs, nextLookupAt: now + policy.lookupDelayMs,
        lookups: current ? current.lookups + 1 : 0 };
      tx.set(reportPath('dispatches', jobId), receipt);
      return { receipt, mode: current ? 'lookup' as const : 'create' as const };
    });
    if ('state' in intent) return intent;
    let state: DispatchReceipt['state'] = 'uncertain';
    try {
      const result = intent.mode === 'create' ? await this.queue.create(jobId) : await this.queue.lookup(jobId);
      state = result === 'accepted' || result === 'present' ? 'queued' : result === 'rejected' ? 'blocked' : 'uncertain';
    } catch { /* A missing acknowledgement is not evidence that enqueue failed. */ }
    return this.store.transaction(async tx => {
      const current = await tx.get<DispatchReceipt>(reportPath('dispatches', jobId));
      if (!current || current.ownerHash !== ownerHash || current.fence !== intent.receipt.fence) return { state: 'delayed' as const };
      tx.set(reportPath('dispatches', jobId), { ...current, state, leaseUntil: 0 });
      return { state: state === 'uncertain' ? 'delayed' as const : state };
    });
  }
}

export type TaskApiRequest = (url: string, request: { method: 'POST' | 'GET'; body?: unknown; signal: AbortSignal }) =>
  Promise<{ status: number; name?: string }>;

/** Fixed native API origin, deterministic task identity and opaque job-only body.
 * The injected caller supplies its own narrow cloud identity; no token is stored. */
export class CloudReportTaskQueue implements ReportTaskQueue {
  private audience: string;
  constructor(private config: { parent: string; workerUrl: string; invokerEmail: string; rpcTimeoutMs: number }, private request: TaskApiRequest) {
    const parent = /^projects\/([a-z][a-z0-9-]{4,61}[a-z0-9])\/locations\/[a-z0-9-]+\/queues\/metrics-reporting-[a-z0-9-]+$/.exec(config.parent);
    let target: URL;
    try { target = new URL(config.workerUrl); } catch { throw new ReportError('invalid'); }
    if (!parent || !Number.isSafeInteger(config.rpcTimeoutMs) || config.rpcTimeoutMs <= 0
      || target.protocol !== 'https:' || !target.hostname.endsWith('.run.app')
      || target.username || target.password || target.search || target.hash || target.port
      || target.pathname !== '/internal/metrics/collect'
      || config.invokerEmail !== `metrics-report-task-invoker@${parent[1]}.iam.gserviceaccount.com`) throw new ReportError('invalid');
    this.audience = target.origin;
  }
  taskName(jobId: string) {
    if (!/^[a-f0-9]{64}$/.test(jobId)) throw new ReportError('invalid');
    return `${this.config.parent}/tasks/${jobId}`;
  }
  async create(jobId: string): Promise<'accepted' | 'rejected'> {
    const name = this.taskName(jobId);
    const response = await this.request(`https://cloudtasks.googleapis.com/v2/${this.config.parent}/tasks`, {
      method: 'POST', signal: AbortSignal.timeout(this.config.rpcTimeoutMs), body: { responseView: 'BASIC', task: { name, httpRequest: {
        url: this.config.workerUrl, httpMethod: 'POST', headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(JSON.stringify({ jobId })).toString('base64'),
        oidcToken: { serviceAccountEmail: this.config.invokerEmail, audience: this.audience },
      } } },
    });
    if (response.status === 409) return 'accepted'; // named task already exists or was recently executed
    if (response.status >= 200 && response.status < 300 && response.name === name) return 'accepted';
    if ([400, 401, 403].includes(response.status)) return 'rejected';
    throw new ReportError('unavailable');
  }
  async lookup(jobId: string): Promise<'present' | 'missing' | 'rejected'> {
    const name = this.taskName(jobId);
    const response = await this.request(`https://cloudtasks.googleapis.com/v2/${name}?responseView=BASIC`, {
      method: 'GET', signal: AbortSignal.timeout(this.config.rpcTimeoutMs),
    });
    if (response.status === 200 && response.name === name) return 'present';
    // Executed/deleted tasks also return 404. Never create a replacement from it.
    if (response.status === 404) return 'missing';
    if ([400, 401, 403].includes(response.status)) return 'rejected';
    throw new ReportError('unavailable');
  }
}
