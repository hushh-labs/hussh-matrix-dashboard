import { digest, ReportError, reportKey, validateAccess, validateControl, validatePolicy, validateRequest, type ReportAccess, type ReportControl, type ReportJob, type ReportingPolicy } from './contracts';
import { reportPath as path, type ReportStore } from './store';
import { validateOneAgentDetail } from './one-agent-detail-contract';
import { validateUatDetailPolicy, type StagedUatDetailQuery } from './staged-uat-detail-query';
import { validateUatFeatureManifest } from './uat-feature-manifest';
import type { buildUatFeaturePlan } from '../uat-one-feature-plan';

type DetailControl = { approved:true; enabled:true; manifestDigest:string; config:Parameters<typeof buildUatFeaturePlan>[0] };
type Head = { sequence:number; activeJob:string|null; publication:string|null };
type Capacity = { active:number };
const fail=()=>{throw new ReportError('unavailable');};
function binding(raw:DetailControl|null, job:ReportJob, source:ReturnType<typeof validateUatDetailPolicy>) {
  if (!raw || Object.keys(raw).sort().join()!=='approved,config,enabled,manifestDigest' || raw.approved!==true || raw.enabled!==true) return fail();
  const {manifest,manifestDigest}=validateUatFeatureManifest(raw.config,raw.manifestDigest);
  if (manifest.queryHash!==source.queryHash || manifest.startDate!==job.request.startDate || manifest.endDate!==job.request.endDate
    || manifest.timezone!==job.request.timezone || source.scopeDigest!==job.control.scopeDigest
    || source.sourceGeneration!==job.control.sourceGeneration || job.control.definitionVersion!==manifest.definitionVersion) return fail();
  return manifestDigest;
}
function detail(snapshot:any, job:ReportJob, policy:ReportingPolicy, now:number) {
  if (!snapshot || Object.keys(snapshot).sort().join()!=='binding,computedAt,coverage,detail,kind,schema'
    || snapshot.schema!==1 || snapshot.kind!=='uat-feature-subset' || snapshot.coverage!=='partial'
    || !Number.isSafeInteger(snapshot.computedAt) || snapshot.computedAt<job.acceptedAt || snapshot.computedAt>now
    || Buffer.byteLength(JSON.stringify(snapshot))>policy.maxSnapshotBytes) return fail();
  const value=validateOneAgentDetail(snapshot.detail,{environment:'uat',scopeDigest:job.control.scopeDigest,
    period:{startDate:job.request.startDate,endDate:job.request.endDate,timezone:job.request.timezone}});
  if (value.source.checkedAt!==null || value.source.watermark!==null || value.source.coverage!=='intraday_or_unknown'
    || value.rows.some(row=>row.agent==='location' && row.state!=='unavailable')) return fail();
  return value;
}

/** Internal prototype only. The caller must bind the supplied authority to the
 * current viewer and approved UAT source. External revocation is not atomic. */
export class UatFeatureLifecycle {
  constructor(private store:ReportStore, private saga:StagedUatDetailQuery,
    private authorize:(job:ReportJob, access:ReportAccess)=>Promise<boolean>, private now:()=>number=Date.now, private enabled=false) {}
  async readCurrent(input:unknown, access:ReportAccess) {
    if (!this.enabled) return fail(); validateAccess(access);
    const job=await this.store.transaction(async tx=>{
      const policy=validatePolicy(await tx.get<ReportingPolicy>(path('policy','current')));
      const request=validateRequest(input,policy.maxPeriodDays);
      if (request.reportId!=='one.agent-detail-uat') return fail();
      const control=validateControl(await tx.get<ReportControl>(path('controls',request.reportId)),request,access);
      const key=reportKey(request,control), head=await tx.get<Head>(path('heads',key));
      if (!head?.publication || !/^[a-f0-9]{64}$/.test(head.publication)) return fail();
      const found=await tx.get<ReportJob>(path('jobs',head.publication));
      if (!found || found.key!==key || digest(found.request)!==digest(request) || digest(found.control)!==digest(control)) return fail();
      return found;
    });
    return this.read(job,access);
  }
  async complete(job:ReportJob, access:ReportAccess) {
    if (!this.enabled) return fail(); validateAccess(access);
    if (access.scopeDigest!==job.control.scopeDigest || !await this.authorize(job,access)) throw new ReportError('unauthorized');
    const proof=await this.saga.readProof(job); // verifies canonical reservation and native proof
    if (!await this.authorize(job,access)) throw new ReportError('unauthorized');
    const result=await this.store.transaction(async tx=>{
      const [live,control,global,rawSource,rawManifest,intent,storedProof,snapshot,head,slots,subject,existing]=await Promise.all([
        tx.get<ReportJob>(path('jobs',job.id)),tx.get<ReportControl>(path('controls',job.request.reportId)),
        tx.get<ReportingPolicy>(path('policy','current')),tx.get<any>(path('policy','one-agent-detail-bq')),
        tx.get<DetailControl>(path('policy','one-agent-detail-manifest')),tx.get<any>(path('uatDetailIntents',job.id)),
        tx.get<any>(path('uatDetailNativeProofs',job.id)),tx.get<any>(path('uatDetailPartialSnapshots',job.id)),
        tx.get<Head>(path('heads',job.key)),tx.get<Capacity>(path('capacity',job.lane)),
        tx.get<Capacity>(path('subjectCapacity',digest([job.lane,job.requesterHash]))),tx.get<any>(path('uatDetailPublications',job.id))]);
      const now=this.now(), policy=validatePolicy(global), source=validateUatDetailPolicy(rawSource,now), manifestDigest=binding(rawManifest,job,source);
      if (!Number.isSafeInteger(now) || !policy.computeEnabled || !live || live.status!=='running' || live.id!==job.id || live.key!==job.key
        || live.fence!==job.fence || live.workerHash!==job.workerHash || live.leaseUntil<=now || live.expiresAt<=now
        || live.sourceStarted!==true || String(live.request.reportId)!=='one.agent-detail-uat' || digest(live.request)!==digest(job.request)
        || digest(live.control)!==digest(job.control) || digest(control)!==digest(job.control) || job.control.enabled!==true
        || live.lane!==job.lane || live.requesterHash!==job.requesterHash || live.acceptedAt!==job.acceptedAt
        || !head || head.activeJob!==job.id || !slots || !Number.isSafeInteger(slots.active) || slots.active<1
        || !subject || !Number.isSafeInteger(subject.active) || subject.active<1 || existing
        || !intent || intent.state!=='complete' || intent.jobId!==job.id || intent.policyDigest!==digest(source)
        || !storedProof || digest(storedProof)!==digest(proof) || storedProof.binding!==intent.binding
        || storedProof.policyDigest!==intent.policyDigest || storedProof.scopeDigest!==job.control.scopeDigest
        || storedProof.sourceGeneration!==job.control.sourceGeneration || storedProof.queryHash!==source.queryHash
        || snapshot?.binding!==digest([job.id,job.key,job.request,job.control,digest(source),digest(proof)])) return fail();
      const value=detail(snapshot,job,policy,now);
      tx.create(path('uatDetailPublications',job.id),{schema:1,kind:'uat-feature-subset',coverage:'partial',id:job.id,key:job.key,
        request:job.request,control:job.control,manifestDigest,sourcePolicyDigest:digest(source),proofDigest:digest(proof),computedAt:snapshot.computedAt,publishedAt:now,detail:value});
      tx.set(path('heads',job.key),{...head,activeJob:null,publication:job.id});
      tx.set(path('jobs',job.id),{...live,status:'completed',leaseUntil:0,completedAt:now});
      tx.set(path('capacity',job.lane),{active:slots.active-1});
      tx.set(path('subjectCapacity',digest([job.lane,job.requesterHash])),{active:subject.active-1});
      return {state:'partial' as const,id:job.id};
    });
    if (!await this.authorize(job,access)) throw new ReportError('unauthorized'); return result;
  }
  async read(job:ReportJob, access:ReportAccess) {
    if (!this.enabled) return fail(); validateAccess(access);
    if (access.scopeDigest!==job.control.scopeDigest || !await this.authorize(job,access)) throw new ReportError('unauthorized');
    const result=await this.store.transaction(async tx=>{
      const [live,control,global,rawSource,rawManifest,intent,proof,snapshot,head,pub]=await Promise.all([
        tx.get<ReportJob>(path('jobs',job.id)),tx.get<ReportControl>(path('controls',job.request.reportId)),
        tx.get<ReportingPolicy>(path('policy','current')),tx.get<any>(path('policy','one-agent-detail-bq')),
        tx.get<DetailControl>(path('policy','one-agent-detail-manifest')),tx.get<any>(path('uatDetailIntents',job.id)),
        tx.get<any>(path('uatDetailNativeProofs',job.id)),tx.get<any>(path('uatDetailPartialSnapshots',job.id)),
        tx.get<Head>(path('heads',job.key)),tx.get<any>(path('uatDetailPublications',job.id))]);
      const now=this.now(), policy=validatePolicy(global), source=validateUatDetailPolicy(rawSource,now,true), manifestDigest=binding(rawManifest,job,source);
      const quotaKey=digest([access.subjectHash,'read',Math.floor(now/policy.quotaWindowMs)]);
      const quota=await tx.get<{count:number}>(path('quotas',quotaKey)), count=quota?.count??0;
      if (!Number.isSafeInteger(now) || !Number.isSafeInteger(count) || count<0 || count>=policy.readRequests) throw new ReportError('quota');
      if (!live || live.status!=='completed' || live.id!==job.id || live.key!==job.key || digest(live.request)!==digest(job.request)
        || digest(live.control)!==digest(job.control) || digest(control)!==digest(job.control) || job.control.enabled!==true
        || head?.publication!==job.id || !intent || intent.state!=='complete' || intent.jobId!==job.id
        || intent.policyDigest!==digest(source) || !proof || proof.binding!==intent.binding || proof.policyDigest!==intent.policyDigest
        || snapshot?.binding!==digest([job.id,job.key,job.request,job.control,digest(source),digest(proof)])
        || !pub || Object.keys(pub).sort().join()!=='computedAt,control,coverage,detail,id,key,kind,manifestDigest,proofDigest,publishedAt,request,schema,sourcePolicyDigest'
        || pub.schema!==1 || pub.kind!=='uat-feature-subset' || pub.coverage!=='partial' || pub.id!==job.id || pub.key!==job.key
        || digest(pub.request)!==digest(job.request) || digest(pub.control)!==digest(job.control) || pub.manifestDigest!==manifestDigest
        || pub.sourcePolicyDigest!==digest(source) || pub.proofDigest!==digest(proof) || pub.computedAt!==snapshot.computedAt
        || !Number.isSafeInteger(pub.publishedAt) || pub.publishedAt>now || pub.publishedAt<pub.computedAt
        || now-pub.computedAt>job.control.staleMs || digest(pub.detail)!==digest(snapshot.detail)) return fail();
      const value=detail(snapshot,job,policy,now);
      tx.set(path('quotas',quotaKey),{count:count+1,windowEndsAt:(Math.floor(now/policy.quotaWindowMs)+1)*policy.quotaWindowMs});
      return {state:'partial' as const,freshness:'unknown' as const,computedAt:pub.computedAt,detail:value};
    });
    if (!await this.authorize(job,access)) throw new ReportError('unauthorized'); return result;
  }
}
