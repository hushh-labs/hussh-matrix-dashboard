import { digest, ReportError, validateAccess, validatePolicy, type ReportAccess, type ReportControl, type ReportJob, type ReportingPolicy } from './contracts';
import { reportPath, type ReportStore } from './store';
import { validateOneAgentDetail } from './one-agent-detail-contract';
import { validateUatDetailPolicy, type StagedUatDetailQuery } from './staged-uat-detail-query';

/** Internal, default-off reader for a feature subset only. A future route must
 * enforce request quota and bind viewer authorization/current source authority. */
export class UatFeaturePartialReader {
  constructor(private store:ReportStore, private saga:StagedUatDetailQuery,
    private authorize:(job:ReportJob,access:ReportAccess)=>Promise<boolean>, private now:()=>number=Date.now, private enabled=false) {}
  async read(job:ReportJob, access:ReportAccess) {
    if (!this.enabled) throw new ReportError('unavailable');
    validateAccess(access);
    if (access.scopeDigest!==job.control.scopeDigest || !await this.authorize(job,access)) throw new ReportError('unauthorized');
    const proof=await this.saga.readProof(job);
    const result=await this.store.transaction(async tx=>{
      const [live,control,global,rawPolicy,intent,storedProof,snapshot]=await Promise.all([
        tx.get<ReportJob>(reportPath('jobs',job.id)),tx.get<ReportControl>(reportPath('controls',job.request.reportId)),
        tx.get<ReportingPolicy>(reportPath('policy','current')),tx.get<any>(reportPath('policy','one-agent-detail-bq')),
        tx.get<any>(reportPath('uatDetailIntents',job.id)),tx.get<any>(reportPath('uatDetailNativeProofs',job.id)),
        tx.get<any>(reportPath('uatDetailPartialSnapshots',job.id))]);
      const now=this.now(), policy=validatePolicy(global), source=validateUatDetailPolicy(rawPolicy,now);
      if (!Number.isSafeInteger(now) || !policy.computeEnabled || !live || live.status!=='running' || live.id!==job.id
        || live.key!==job.key || live.fence!==job.fence || live.workerHash!==job.workerHash || live.leaseUntil<=now
        || live.expiresAt<=now || live.sourceStarted!==true || !Number.isSafeInteger(job.acceptedAt) || live.acceptedAt!==job.acceptedAt
        || job.control.enabled!==true || !Number.isSafeInteger(job.control.staleMs) || job.control.staleMs<1
        || String(live.request.reportId)!=='one.agent-detail-uat' || digest(live.request)!==digest(job.request)
        || digest(live.control)!==digest(job.control) || digest(control)!==digest(job.control)
        || source.scopeDigest!==access.scopeDigest || source.sourceGeneration!==job.control.sourceGeneration
        || source.startDate!==job.request.startDate || source.endDate!==job.request.endDate || source.timezone!==job.request.timezone
        || !intent || intent.state!=='complete' || intent.jobId!==job.id || intent.policyDigest!==digest(source)
        || !storedProof || digest(storedProof)!==digest(proof) || storedProof.binding!==intent.binding
        || storedProof.policyDigest!==intent.policyDigest || storedProof.scopeDigest!==access.scopeDigest
        || storedProof.sourceGeneration!==job.control.sourceGeneration || storedProof.queryHash!==source.queryHash
        || !snapshot || Object.keys(snapshot).sort().join()!=='binding,computedAt,coverage,detail,kind,schema'
        || snapshot.schema!==1 || snapshot.kind!=='uat-feature-subset' || snapshot.coverage!=='partial'
        || snapshot.binding!==digest([job.id,job.key,job.request,job.control,digest(source),digest(proof)])
        || !Number.isSafeInteger(snapshot.computedAt) || snapshot.computedAt<job.acceptedAt || snapshot.computedAt>now
        || now-snapshot.computedAt>job.control.staleMs || Buffer.byteLength(JSON.stringify(snapshot))>policy.maxSnapshotBytes)
        throw new ReportError('unavailable');
      const detail=validateOneAgentDetail(snapshot.detail,{environment:'uat',scopeDigest:access.scopeDigest,
        period:{startDate:job.request.startDate,endDate:job.request.endDate,timezone:job.request.timezone}});
      if (detail.source.checkedAt!==null || detail.source.watermark!==null || detail.source.coverage!=='intraday_or_unknown'
        || detail.rows.some(row=>row.agent==='location' && row.state!=='unavailable')) throw new ReportError('invalid');
      return {state:'partial' as const,freshness:'unknown' as const,computedAt:snapshot.computedAt,detail};
    });
    if (!await this.authorize(job,access)) throw new ReportError('unauthorized');
    return result;
  }
}
