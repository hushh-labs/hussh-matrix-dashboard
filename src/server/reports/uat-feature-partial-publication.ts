import type { ReportJob, ReportControl, ReportingPolicy } from './contracts';
import { digest, ReportError, validatePolicy } from './contracts';
import { reportPath, type ReportStore } from './store';
import { validateOneAgentDetail } from './one-agent-detail-contract';
import { validateUatDetailPolicy, type StagedUatDetailQuery } from './staged-uat-detail-query';
import { readUatFeatureDetail } from './uat-feature-detail-read';
import type { UatFeatureNative } from '../uat-one-feature-native';

/** Private, explicitly partial prototype: does not update legacy heads, report
 * job status or capacity. Caller must supply current viewer/source authority;
 * the upstream membership system has no transactional revocation epoch. */
export class UatFeaturePartialPublisher {
  constructor(private store:ReportStore, private saga:StagedUatDetailQuery, private native:UatFeatureNative,
    private authorize:(job:ReportJob)=>Promise<boolean>, private now:()=>number=Date.now, private enabled=false) {}
  async publish(job:ReportJob, signal:AbortSignal) {
    if (!this.enabled) throw new ReportError('unavailable');
    signal.throwIfAborted(); if (!await this.authorize(job)) throw new ReportError('unauthorized'); signal.throwIfAborted();
    const detail=await readUatFeatureDetail(job,this.native,signal); signal.throwIfAborted();
    const proof=await this.saga.readProof(job); signal.throwIfAborted();
    if (!await this.authorize(job)) throw new ReportError('unauthorized'); signal.throwIfAborted();
    const result=await this.store.transaction(async tx=>{
      const [live,control,global,rawPolicy,intent,storedProof,existing]=await Promise.all([
        tx.get<ReportJob>(reportPath('jobs',job.id)),tx.get<ReportControl>(reportPath('controls',job.request.reportId)),
        tx.get<ReportingPolicy>(reportPath('policy','current')),tx.get<any>(reportPath('policy','one-agent-detail-bq')),
        tx.get<any>(reportPath('uatDetailIntents',job.id)),tx.get<any>(reportPath('uatDetailNativeProofs',job.id)),
        tx.get<any>(reportPath('uatDetailPartialSnapshots',job.id))]);
      const now=this.now(), policy=validatePolicy(global), source=validateUatDetailPolicy(rawPolicy,now);
      if (!Number.isSafeInteger(now) || !policy.computeEnabled || !live || live.status!=='running' || live.id!==job.id
        || live.key!==job.key || live.fence!==job.fence || live.workerHash!==job.workerHash || live.leaseUntil<=now
        || live.expiresAt<=now || live.sourceStarted!==true || !Number.isSafeInteger(job.acceptedAt) || job.acceptedAt>now
        || live.acceptedAt!==job.acceptedAt || job.control.enabled!==true || String(live.request.reportId)!=='one.agent-detail-uat'
        || digest(live.request)!==digest(job.request) || digest(live.control)!==digest(job.control) || digest(control)!==digest(job.control)
        || source.scopeDigest!==job.control.scopeDigest || source.sourceGeneration!==job.control.sourceGeneration
        || source.startDate!==job.request.startDate || source.endDate!==job.request.endDate || source.timezone!==job.request.timezone
        || !intent || intent.state!=='complete' || intent.jobId!==job.id || intent.policyDigest!==digest(source)
        || !storedProof || digest(storedProof)!==digest(proof) || storedProof.binding!==intent.binding
        || storedProof.policyDigest!==intent.policyDigest || storedProof.scopeDigest!==job.control.scopeDigest
        || storedProof.sourceGeneration!==job.control.sourceGeneration || storedProof.queryHash!==source.queryHash) throw new ReportError('unavailable');
      const expected={environment:'uat' as const,scopeDigest:job.control.scopeDigest,period:{startDate:job.request.startDate,
        endDate:job.request.endDate,timezone:job.request.timezone}};
      validateOneAgentDetail(detail,expected);
      if (detail.source.checkedAt!==null || detail.source.watermark!==null || detail.source.coverage!=='intraday_or_unknown'
        || detail.rows.some(row=>row.agent==='location' && row.state!=='unavailable')) throw new ReportError('invalid');
      const binding=digest([job.id,job.key,job.request,job.control,digest(source),digest(proof)]);
      if (existing) {
        if (Object.keys(existing).sort().join()!=='binding,computedAt,coverage,detail,kind,schema'
          || existing.schema!==1 || existing.kind!=='uat-feature-subset' || existing.coverage!=='partial'
          || existing.binding!==binding || digest(existing.detail)!==digest(detail)) throw new ReportError('unavailable');
        return {state:'partial' as const, id:job.id};
      }
      const snapshot={schema:1,kind:'uat-feature-subset',coverage:'partial',binding,computedAt:now,detail};
      if (Buffer.byteLength(JSON.stringify(snapshot))>policy.maxSnapshotBytes) throw new ReportError('invalid');
      signal.throwIfAborted();
      tx.create(reportPath('uatDetailPartialSnapshots',job.id),snapshot);
      return {state:'partial' as const,id:job.id};
    });
    // A commit already dispatched cannot be retracted; no read route exists,
    // and any future reader must independently recheck current authority.
    signal.throwIfAborted(); if (!await this.authorize(job)) throw new ReportError('unauthorized'); signal.throwIfAborted();
    return result;
  }
}
