import type { ReportJob } from './contracts';
import { ReportError } from './contracts';
import { buildUatFeaturePlan } from '../uat-one-feature-plan';
import type { StagedUatDetailQuery } from './staged-uat-detail-query';

/** Internal opt-in prototype. One explicit invocation performs one operation; reserve may also
 * confirm the durable reservation; it is not registered with the BQ-off reporting worker, any
 * route, scheduler or production source factory. No default limits are set. */
export class UatDetailWorker {
  constructor(private saga:Pick<StagedUatDetailQuery,'inspect'|'prepare'|'reserve'|'confirm'|'submit'|'recover'|'readProof'>,
    private source:Parameters<typeof buildUatFeaturePlan>[0], private enabled=false) {}
  async advance(job:ReportJob, signal:AbortSignal, recoverOnly=false) {
    if (!this.enabled) throw new ReportError('unavailable');
    signal.throwIfAborted(); const state=await this.saga.inspect(job); signal.throwIfAborted();
    if (recoverOnly && !['started','dispatching','complete'].includes(state)) throw new ReportError('unavailable');
    if (state==='new') { await this.saga.prepare(job,buildUatFeaturePlan(this.source).query,signal); return {state:'prepared' as const}; }
    if (state==='prepared') return this.saga.reserve(job);
    if (state==='reserving') return this.saga.confirm(job);
    if (state==='reserved') return this.saga.submit(job,buildUatFeaturePlan(this.source).query,signal);
    if (state==='started' || state==='dispatching') return this.saga.recover(job);
    if (state==='complete') return {state:'complete' as const, proof:await this.saga.readProof(job)};
    throw new ReportError('unavailable');
  }
}
