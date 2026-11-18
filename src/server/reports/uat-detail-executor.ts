import { digest, ReportError, type ReportAccess, type ReportJob } from './contracts';
import type { WorkerIdentityVerifier } from './worker-http';
import type { MetricsReportWorker } from './service';
import type { UatDetailWorker } from './uat-detail-worker';
import type { UatFeaturePartialPublisher } from './uat-feature-partial-publication';
import type { UatFeatureLifecycle } from './uat-feature-lifecycle';
import type { MetricsReportDispatch } from './dispatch';

/** Explicit private worker seam. No server, queue, credentials or runtime is
 * constructed here. A failed/uncertain stage keeps the job and budget held. */
export class UatDetailExecutor {
  constructor(private config:{enabled:boolean; audience:string; taskEmail:string}, private verify:WorkerIdentityVerifier,
    private claims:Pick<MetricsReportWorker,'inspect'|'claim'|'uncertain'>, private worker:Pick<UatDetailWorker,'advance'>,
    private partial:Pick<UatFeaturePartialPublisher,'publish'>, private lifecycle:Pick<UatFeatureLifecycle,'complete'>,
    private accessFor:(job:ReportJob)=>Promise<ReportAccess>) { this.config=Object.freeze({...config}); }
  async execute(token:string, jobId:string, signal:AbortSignal) {
    if (this.config.enabled!==true) throw new ReportError('unavailable');
    if (!/^https:\/\/[a-z0-9.-]+\.run\.app$/.test(this.config.audience)
      || !/^metrics-report-task-invoker@[a-z][a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(this.config.taskEmail)
      || typeof token!=='string' || token.length<1 || token.length>16384 || !/^[a-f0-9]{64}$/.test(jobId)) throw new ReportError('invalid');
    signal.throwIfAborted(); const identity=await this.verify(token,this.config.audience); signal.throwIfAborted();
    if (!identity.emailVerified || identity.email!==this.config.taskEmail) throw new ReportError('unauthorized');
    const prior=await this.claims.inspect(jobId); signal.throwIfAborted();
    if (!prior || prior.request.reportId!=='one.agent-detail-uat' || prior.lane!=='custom') throw new ReportError('unavailable');
    const claim=await this.claims.claim(jobId,digest(this.config.taskEmail));
    if (!claim) return {state:'unavailable' as const};
    const job=claim.job;
    try {
      if (job.request.reportId!=='one.agent-detail-uat' || job.lane!=='custom') throw new ReportError('unavailable');
      const access=await this.accessFor(job); signal.throwIfAborted();
      // Bounded stages share one worker fence. Recovery may only look up an
      // existing native ID; it must never replay an uncertain submission.
      for (let step=0;step<6;step++) {
        const progress=await this.worker.advance(job,signal,claim.recoverOnly); signal.throwIfAborted();
        if (progress.state==='uncertain') throw new ReportError('unavailable');
        if (progress.state==='complete') {
          await this.partial.publish(job,signal); signal.throwIfAborted();
          return await this.lifecycle.complete(job,access);
        }
      }
      throw new ReportError('unavailable');
    } catch (error) {
      try { await this.claims.uncertain(job); } catch { /* Keep whatever durable state won. */ }
      throw error;
    }
  }
}

/** The injected dispatch must use a separately qualified, fixed detail queue;
 * the generic scalar queue target is not a valid implementation. */
export class UatDetailDispatcher {
  constructor(private config:{enabled:boolean;audience:string;dispatcherEmail:string}, private verify:WorkerIdentityVerifier,
    private claims:Pick<MetricsReportWorker,'inspect'>, private dispatch:Pick<MetricsReportDispatch,'deliver'>) { this.config=Object.freeze({...config}); }
  async deliver(token:string, jobId:string, signal:AbortSignal) {
    if (this.config.enabled!==true) throw new ReportError('unavailable');
    if (!/^https:\/\/[a-z0-9.-]+\.run\.app$/.test(this.config.audience)
      || !/^metrics-report-dispatcher@[a-z][a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(this.config.dispatcherEmail)
      || typeof token!=='string' || token.length<1 || token.length>16384 || !/^[a-f0-9]{64}$/.test(jobId)) throw new ReportError('invalid');
    signal.throwIfAborted(); const identity=await this.verify(token,this.config.audience); signal.throwIfAborted();
    if (!identity.emailVerified || identity.email!==this.config.dispatcherEmail) throw new ReportError('unauthorized');
    const job=await this.claims.inspect(jobId); signal.throwIfAborted();
    if (!job || job.request.reportId!=='one.agent-detail-uat' || job.lane!=='custom') throw new ReportError('unavailable');
    return this.dispatch.deliver(jobId,digest(this.config.dispatcherEmail));
  }
}
