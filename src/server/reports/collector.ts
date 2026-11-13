import type { AggregateResult, ReportJob } from './contracts';
import { MetricsReportWorker } from './service';

/** A source owns its native idempotency and authoritative aggregate semantics.
 * recover must look up existing work; it cannot silently resubmit a new query. */
export interface AggregateReportSource {
  submit(job: Readonly<ReportJob>): Promise<AggregateResult | null>;
  recover(job: Readonly<ReportJob>): Promise<AggregateResult | null>;
}
export async function collectReport(worker: MetricsReportWorker, jobId: string, workerHash: string,
  source: AggregateReportSource) {
  const claim = await worker.claim(jobId, workerHash);
  if (!claim) return { state: 'skipped' as const };
  try {
    const result = await (claim.recoverOnly ? source.recover(claim.job) : source.submit(claim.job));
    if (!result) { await worker.uncertain(claim.job); return { state: 'delayed' as const }; }
    await worker.publish(claim.job, result);
    return { state: 'completed' as const };
  } catch (error) {
    // A local error does not prove that accepted provider work stopped.
    await worker.uncertain(claim.job);
    throw error;
  }
}
