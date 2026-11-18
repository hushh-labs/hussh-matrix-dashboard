import { createHash } from 'node:crypto';
import { BIGQUERY_COST_LIMITS, type QueryBudgetReservation } from '../bigquery-cost-control';
import { digest, ReportError, validatePolicy, type ReportControl, type ReportJob, type ReportingPolicy } from './contracts';
import { reportPath, type ReportStore } from './store';

/** Disconnected prototype. Native and budget interfaces must be backed by
 * reviewed canonical adapters before any runtime integration is considered. */
type DetailPolicy = { approved:true; enabled:true; environment:'uat'; project:string; location:'US'; queryHash:string;
  sourceGeneration:string; scopeDigest:string; referenceDigest:string; startDate:string; endDate:string; timezone:string; expiresAt:number; maxBytes:number };
type Intent = { state:'prepared'|'reserving'|'reserved'|'started'|'dispatching'|'complete'; jobId:string; fence:number; workerHash:string;
  day:string; binding:string; nativeId:string; queryHash:string; project:string; bytes:number; policyDigest:string; startedAt:number|null };
type Budget = { reserve:(reservation:QueryBudgetReservation)=>Promise<void>; confirmBound:(reservation:QueryBudgetReservation)=>Promise<void> };
type Estimate = { queryHash:string; project:string; location:string; statementType:string; referenceDigest:string; accuracy:string; processed:number; referencedFloor:number; bound:number };
type Metadata = { id:string; queryHash:string; project:string; location:string; useLegacySql:boolean; maximumBytesBilled:number;
  state:string; error:boolean; billed:number; endedAt:number };
type Native = { estimate:(sql:string,signal:AbortSignal)=>Promise<Estimate>; submit:(request:{sql:string;id:string;jobId:string;day:string;binding:string;project:string;location:'US';queryHash:string;useLegacySql:false;maximumBytesBilled:number;signal:AbortSignal})=>Promise<void>; lookup:(id:string)=>Promise<Metadata|null> };
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const isHash=(v:unknown):v is string=>typeof v==='string' && /^[a-f0-9]{64}$/.test(v);
const fail=()=>{ throw new ReportError('unavailable'); };
const positive=(v:unknown):v is number=>Number.isSafeInteger(v) && Number(v)>0;
const canonicalDay=(v:unknown):v is string=>typeof v==='string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10)===v;
function detailPolicy(value:unknown, now:number):DetailPolicy {
  if (!value || typeof value!=='object' || Array.isArray(value)) return fail(); const p=value as DetailPolicy;
  if (Object.keys(p).sort().join()!=='approved,enabled,endDate,environment,expiresAt,location,maxBytes,project,queryHash,referenceDigest,scopeDigest,sourceGeneration,startDate,timezone'
    || p.approved!==true || p.enabled!==true || p.environment!=='uat' || p.project!==BIGQUERY_COST_LIMITS.project || p.location!=='US'
    || !isHash(p.queryHash) || !isHash(p.referenceDigest) || !isHash(p.sourceGeneration) || !isHash(p.scopeDigest)
    || !canonicalDay(p.startDate) || !canonicalDay(p.endDate) || p.startDate>p.endDate || p.timezone!=='UTC'
    || !positive(p.expiresAt) || p.expiresAt<=now || !positive(p.maxBytes) || p.maxBytes>BIGQUERY_COST_LIMITS.bytesPerStatement) return fail();
  return p;
}
function current(live:ReportJob|null, job:ReportJob, control:ReportControl|null, global:ReportingPolicy|null, p:DetailPolicy, now:number) {
  if (!validatePolicy(global).computeEnabled || !live || !isHash(job.id) || !isHash(job.key) || live.id!==job.id || live.key!==job.key || live.status!=='running'
    || live.fence!==job.fence || live.workerHash!==job.workerHash || !isHash(live.workerHash)
    || !positive(live.fence) || !Number.isSafeInteger(live.expiresAt) || live.expiresAt<=now
    || !Number.isSafeInteger(live.leaseUntil) || live.leaseUntil<=now || digest(live.request)!==digest(job.request)
    || String(live.request.reportId)!=='one.agent-detail-uat' || live.request.startDate!==p.startDate || live.request.endDate!==p.endDate
    || live.request.timezone!==p.timezone || (Date.parse(p.endDate)-Date.parse(p.startDate))/86_400_000+1>validatePolicy(global).maxPeriodDays
    || live.control.enabled!==true || digest(live.control)!==digest(job.control)
    || digest(control)!==digest(job.control) || job.control.sourceGeneration!==p.sourceGeneration || job.control.scopeDigest!==p.scopeDigest) return fail();
}
const day=(now:number)=>{ if (!Number.isSafeInteger(now) || now<0 || !Number.isFinite(new Date(now).getTime())) return fail(); return new Date(now).toISOString().slice(0,10); };

export class StagedUatDetailQuery {
  constructor(private store:ReportStore, private budget:Budget, private native:Native,
    private authorize:(job:ReportJob)=>Promise<boolean>, private now:()=>number=Date.now) {}
  private async authority(job:ReportJob) { if (!await this.authorize(job)) return fail(); }
  private async gate(job:ReportJob, read:(path:string)=>Promise<any>) {
    const [raw,global,live,control]=await Promise.all([read(reportPath('policy','one-agent-detail-bq')),
      read(reportPath('policy','current')),read(reportPath('jobs',job.id)),read(reportPath('controls',job.request.reportId))]);
    const now=this.now(), p=detailPolicy(raw,now); current(live,job,control,global,p,now); return {p,now};
  }
  /** Preflight and native free estimate only. It never starts a paid job. */
  async prepare(job:ReportJob, sql:string, signal:AbortSignal) {
    signal.throwIfAborted(); await this.authority(job); signal.throwIfAborted();
    if (typeof sql!=='string' || !sql.trim()) return fail();
    const initial=await this.store.transaction(async tx=>{
      const prior=await tx.get<Intent>(reportPath('uatDetailIntents',job.id)), g=await this.gate(job,p=>tx.get(p));
      if (prior) return fail(); return g;
    });
    if (hash(sql)!==initial.p.queryHash) return fail();
    signal.throwIfAborted(); const e=await this.native.estimate(sql,signal); signal.throwIfAborted();
    if (e.queryHash!==initial.p.queryHash || e.project!==initial.p.project || e.location!=='US'
      || e.statementType!=='SELECT' || e.referenceDigest!==initial.p.referenceDigest || !['PRECISE','UPPER_BOUND'].includes(e.accuracy) || !Number.isSafeInteger(e.processed) || e.processed<0
      || !positive(e.referencedFloor) || !positive(e.bound) || e.bound<Math.max(e.processed,e.referencedFloor) || e.bound>initial.p.maxBytes) return fail();
    const firstDay=day(initial.now), policyDigest=digest(initial.p), binding=digest([job.id,job.key,job.request,job.control,
      initial.p.environment,initial.p.project,initial.p.location,initial.p.queryHash,policyDigest,firstDay,e.bound]);
    const nativeId=`metrics_detail_${hash(binding)}`;
    await this.store.transaction(async tx=>{
      const prior=await tx.get<Intent>(reportPath('uatDetailIntents',job.id)), g=await this.gate(job,p=>tx.get(p));
      if (prior || digest(g.p)!==policyDigest || day(g.now)!==firstDay) return fail();
      tx.create(reportPath('uatDetailIntents',job.id),{state:'prepared',jobId:job.id,fence:job.fence,workerHash:job.workerHash,
        day:firstDay,binding,nativeId,queryHash:initial.p.queryHash,project:initial.p.project,bytes:e.bound,policyDigest,startedAt:null});
    });
  }
  private reservation(i:Intent):QueryBudgetReservation { return {id:i.nativeId,day:i.day,bytes:i.bytes,statements:1,binding:i.binding}; }
  private validateIntent(i:Intent|null, job:ReportJob, p:DetailPolicy, now:number) {
    if (!i || Object.keys(i).sort().join()!=='binding,bytes,day,fence,jobId,nativeId,policyDigest,project,queryHash,startedAt,state,workerHash'
      || i.jobId!==job.id || i.fence!==job.fence || i.workerHash!==job.workerHash || !isHash(i.binding)
      || i.nativeId!==`metrics_detail_${hash(i.binding)}` || i.queryHash!==p.queryHash || i.project!==p.project
      || i.policyDigest!==digest(p) || !positive(i.bytes) || i.bytes>p.maxBytes || i.day!==day(now)
      || i.binding!==digest([job.id,job.key,job.request,job.control,p.environment,p.project,p.location,p.queryHash,i.policyDigest,i.day,i.bytes])) return fail();
  }
  /** At most one canonical reserve attempt; lost acknowledgements reconcile by
   * read-only confirmation and never refund or submit on uncertainty. */
  async reserve(job:ReportJob) {
    await this.authority(job);
    const intent=await this.store.transaction(async tx=>{
      const i=await tx.get<Intent>(reportPath('uatDetailIntents',job.id)), g=await this.gate(job,p=>tx.get(p));
      this.validateIntent(i,job,g.p,g.now); if (i!.state!=='prepared') return fail();
      tx.set(reportPath('uatDetailIntents',job.id),{...i!,state:'reserving'}); return i!;
    });
    try { await this.budget.reserve(this.reservation(intent)); } catch { return {state:'uncertain' as const}; }
    return this.confirm(job);
  }
  async confirm(job:ReportJob) {
    await this.authority(job);
    const intent=await this.store.transaction(async tx=>{
      const i=await tx.get<Intent>(reportPath('uatDetailIntents',job.id)), g=await this.gate(job,p=>tx.get(p));
      this.validateIntent(i,job,g.p,g.now); if (i!.state!=='reserving') return fail(); return i!;
    });
    try { await this.budget.confirmBound(this.reservation(intent)); } catch { return {state:'uncertain' as const}; }
    await this.store.transaction(async tx=>{
      const i=await tx.get<Intent>(reportPath('uatDetailIntents',job.id)), g=await this.gate(job,p=>tx.get(p));
      this.validateIntent(i,job,g.p,g.now); if (i!.state!=='reserving' || i!.binding!==intent.binding) return fail();
      tx.set(reportPath('uatDetailIntents',job.id),{...i!,state:'reserved'});
    });
    return {state:'reserved' as const};
  }
  /** Transactionally claim the only submission before provider I/O. */
  async submit(job:ReportJob, sql:string, signal:AbortSignal) {
    signal.throwIfAborted(); await this.authority(job); signal.throwIfAborted();
    const i=await this.store.transaction(async tx=>{
      const i=await tx.get<Intent>(reportPath('uatDetailIntents',job.id)), g=await this.gate(job,p=>tx.get(p));
      this.validateIntent(i,job,g.p,g.now); if (i!.state!=='reserved' || hash(sql)!==i!.queryHash) return fail();
      tx.set(reportPath('uatDetailIntents',job.id),{...i!,state:'started',startedAt:g.now}); return i!;
    });
    signal.throwIfAborted(); await this.authority(job); signal.throwIfAborted(); // Started: cancellation or revocation remains charged.
    // Recheck after the awaited authority call. Once dispatch leaves the process,
    // later policy/revocation changes cannot retract that external I/O.
    await this.store.transaction(async tx => {
      const currentIntent=await tx.get<Intent>(reportPath('uatDetailIntents',job.id)), g=await this.gate(job,p=>tx.get(p));
      this.validateIntent(currentIntent,job,g.p,g.now);
      if (currentIntent!.state!=='started' || currentIntent!.binding!==i.binding) return fail();
    });
    signal.throwIfAborted();
    await this.native.submit({sql,id:i.nativeId,jobId:i.jobId,day:i.day,binding:i.binding,project:i.project,location:'US',queryHash:i.queryHash,useLegacySql:false,maximumBytesBilled:i.bytes,signal});
    return {state:'started' as const};
  }
  /** Read the exact stable native ID only. A 404, error, mismatch or unfinished
   * job stays held and never invokes submit. No result/publication is created. */
  async recover(job:ReportJob) {
    await this.authority(job);
    const i=await this.store.transaction(async tx=>{
      const i=await tx.get<Intent>(reportPath('uatDetailIntents',job.id)), g=await this.gate(job,p=>tx.get(p));
      this.validateIntent(i,job,g.p,g.now); if (!['started','dispatching'].includes(i!.state) || !positive(i!.startedAt)) return fail(); return i!;
    });
    const m=await this.native.lookup(i.nativeId);
    if (!m || m.id!==i.nativeId || m.queryHash!==i.queryHash || m.project!==i.project || m.location!=='US'
      || m.useLegacySql!==false || m.maximumBytesBilled!==i.bytes || m.state!=='DONE' || m.error!==false
      || !Number.isSafeInteger(m.billed) || m.billed<0 || m.billed>i.bytes || !positive(m.endedAt)
      || m.endedAt<i.startedAt! || m.endedAt>this.now()) return {state:'uncertain' as const};
    await this.authority(job);
    await this.store.transaction(async tx=>{
      const currentIntent=await tx.get<Intent>(reportPath('uatDetailIntents',job.id)), g=await this.gate(job,p=>tx.get(p));
      this.validateIntent(currentIntent,job,g.p,g.now);
      if (currentIntent!.state!==i.state || currentIntent!.binding!==i.binding || currentIntent!.startedAt!==i.startedAt) return fail();
      tx.set(reportPath('uatDetailIntents',job.id),{...currentIntent!,state:'complete'});
    });
    return {state:'complete' as const, billed:m.billed, endedAt:m.endedAt};
  }
}
