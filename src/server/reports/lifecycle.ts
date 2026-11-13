import { digest, ReportError, validatePolicy, type ReportingPolicy, type ReportJob } from './contracts';
import { MetricsReportWorker } from './service';
import { MetricsSourceCircuit, SourceCircuitClosed, type CircuitTicket } from './circuit';
import { validateSourceBinding, type ReportSourceBinding } from './bindings';
import { SourceRequestFailure } from './source-errors';
import { reportPath, type ReportStore } from './store';
import type { AggregateReportSource } from './collector';

export type CollectionPolicy = { approved: boolean; enabled: boolean; maxClaims: number; retryDelayMs: number };
export type SourceFactory = (job: ReportJob, binding: ReportSourceBinding, signal: AbortSignal) => Promise<AggregateReportSource>;
function validateCollectionPolicy(p: CollectionPolicy | null) {
  if (!p || Object.keys(p).sort().join() !== 'approved,enabled,maxClaims,retryDelayMs' || p.approved !== true || p.enabled !== true
    || ![p.maxClaims, p.retryDelayMs].every(v => Number.isSafeInteger(v) && v > 0)) throw new ReportError('unavailable');
  return p;
}
/** The production collector uses this lifecycle, not an unguarded source adapter. */
export class MetricsCollection {
  private worker: MetricsReportWorker;
  private circuit: MetricsSourceCircuit;
  constructor(private store: ReportStore, private factory: SourceFactory, private now: () => number = Date.now,
    random: () => number = Math.random) {
    this.worker = new MetricsReportWorker(store, now); this.circuit = new MetricsSourceCircuit(store, now, random);
  }
  async collect(jobId: string, workerHash: string) {
    const p = await this.store.transaction(async tx => validateCollectionPolicy(await tx.get<CollectionPolicy>(reportPath('policy', 'collection'))));
    const existing = await this.worker.inspect(jobId);
    if (!existing) throw new ReportError('unavailable');
    if (existing.fence >= p.maxClaims) {
      await this.worker.stopRecovery(jobId); return this.progress(jobId);
    }
    const claimed = await this.worker.claim(jobId, workerHash);
    if (!claimed) return this.progress(jobId);
    const job = claimed.job;
    let ticket: CircuitTicket | undefined;
    try {
      const binding = await this.store.transaction(async tx => {
        const policy = validatePolicy(await tx.get<ReportingPolicy>(reportPath('policy', 'current')));
        let source: ReportSourceBinding;
        try { source = validateSourceBinding(await tx.get(reportPath('sources', job.request.reportId)), job); }
        catch { throw new SourceRequestFailure('configuration'); }
        if (source.timeoutMs > policy.leaseMs) throw new ReportError('invalid');
        return source;
      });
      // Existing journals never repeat provider I/O, including uncertain calls.
      // Only a missing journal can admit a new request and affect source health.
      const receipt = await this.store.transaction(tx => tx.get<{ state: string }>(reportPath('sourceReceipts', job.id)));
      if (!receipt) ticket = await this.circuit.acquire(job.control.sourceGeneration, digest([job.id, job.fence, workerHash]));
      const remaining = job.leaseUntil - this.now();
      if (remaining <= 0) throw new SourceCircuitClosed(this.now() + p.retryDelayMs, false);
      const signal = AbortSignal.timeout(Math.min(binding.timeoutMs, remaining));
      const source = await this.factory(job, binding, signal);
      const result = await (claimed.recoverOnly ? source.recover(job) : source.submit(job));
      if (!result) {
        if (ticket) await this.circuit.complete(ticket, 'transient');
        await this.worker.defer(job, this.now() + p.retryDelayMs, job.fence >= p.maxClaims);
        return this.progress(jobId);
      }
      if (ticket) await this.circuit.complete(ticket, 'healthy');
      ticket = undefined;
      await this.worker.publish(job, result);
      return this.progress(jobId);
    } catch (error) {
      const configuration = error instanceof SourceRequestFailure && error.kind === 'configuration'
        || error instanceof ReportError && error.code === 'invalid';
      if (ticket) {
        try { await this.circuit.complete(ticket, configuration ? 'configuration' : 'transient',
          error instanceof SourceRequestFailure ? error.retryAfterMs : 0); } catch { /* preserve original job uncertainty */ }
      }
      const retryAt = error instanceof SourceCircuitClosed ? error.retryAt : this.now() + p.retryDelayMs;
      const attention = configuration || error instanceof SourceCircuitClosed && error.needsAttention || job.fence >= p.maxClaims;
      try { await this.worker.defer(job, attention ? 0 : retryAt, attention); }
      catch { /* Another lease or completed publication owns the authoritative state. */ }
      return this.progress(jobId);
    }
  }
  private async progress(jobId: string) {
    const job = await this.worker.inspect(jobId);
    if (!job) throw new ReportError('unavailable');
    const terminal = ['completed', 'failed', 'invalidated'].includes(job.status);
    return { state: job.status, needsAttention: job.needsAttention,
      retryAfterMs: terminal || job.needsAttention ? 0 : Math.max(1, job.leaseUntil - this.now(), job.nextAttemptAt - this.now()) };
  }
}
