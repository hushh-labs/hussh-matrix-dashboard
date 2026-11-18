import { digest, ReportError, validatePolicy, type ReportJob, type ReportingPolicy } from './contracts';
import { reportPath, type ReportStore } from './store';
import type { QueryBudgetReservation } from '../bigquery-cost-control';
import { uatTwoSourceChildIds, validateUatTwoSourcePolicies } from './uat-two-source-manifest';

type Estimate={queryHash:string;project:string;location:string;statementType:string;referenceDigest:string;accuracy:string;processed:number;referencedFloor:number;bound:number};
type Budget={reserve:(r:QueryBudgetReservation)=>Promise<void>;confirmBound:(r:QueryBudgetReservation)=>Promise<void>};
/** Unwired reservation stage. The injected budget must be the canonical BQ
 * ledger and estimates must come from the independently verified native adapter. */
export class UatTwoSourceReservations {
  constructor(private store:ReportStore,private budget:Budget,private now:()=>number=Date.now,private enabled=false) {}
  async reserve(job:ReportJob, estimates:{feature:Estimate;location:Estimate}) {
    if (this.enabled!==true) throw new ReportError('unavailable');
    const prepared=await this.store.transaction(async tx=>{
      const [live,control,raw,prior,global]=await Promise.all([tx.get<ReportJob>(reportPath('jobs',job.id)),
        tx.get<any>(reportPath('controls',job.request.reportId)),tx.get<any>(reportPath('policy','one-agent-detail-two-source')),
        tx.get<any>(reportPath('uatTwoSourceIntents',job.id)),tx.get<ReportingPolicy>(reportPath('policy','current'))]);
      const now=this.now(), p=validateUatTwoSourcePolicies(raw,now);
      if (!validatePolicy(global).computeEnabled || job.control.enabled!==true || !Number.isSafeInteger(now) || !live || live.id!==job.id || live.key!==job.key || live.status!=='running' || live.fence!==job.fence
        || live.workerHash!==job.workerHash || live.leaseUntil<=now || live.expiresAt<=now || live.sourceStarted!==true
        || String(live.request.reportId)!=='one.agent-detail-uat' || digest(live.request)!==digest(job.request)
        || digest(live.control)!==digest(job.control) || digest(control)!==digest(job.control)
        || job.control.scopeDigest!==p.manifest.scopeDigest || job.control.sourceGeneration!==p.manifest.sourceGeneration
        || job.request.startDate!==p.manifest.startDate || job.request.endDate!==p.manifest.endDate || job.request.timezone!==p.manifest.timezone) throw new ReportError('unavailable');
      const day=new Date(now).toISOString().slice(0,10), ids=uatTwoSourceChildIds(job.id,p.manifestDigest), policyDigest=digest(raw);
      const reservations=Object.fromEntries((['feature','location'] as const).map(role=>{
        const e=estimates?.[role], policy=p[role];
        if (!e || e.queryHash!==policy.queryHash || e.project!==policy.project || e.location!==policy.location
          || e.statementType!=='SELECT' || e.referenceDigest!==policy.referenceDigest || !['PRECISE','UPPER_BOUND'].includes(e.accuracy)
          || !Number.isSafeInteger(e.processed) || e.processed<0 || !Number.isSafeInteger(e.referencedFloor) || e.referencedFloor<1
          || !Number.isSafeInteger(e.bound) || e.bound<Math.max(e.processed,e.referencedFloor) || e.bound>policy.maxBytes) throw new ReportError('unavailable');
        const binding=digest(['uat-two-source-reservation-v1',job.id,job.key,job.request,job.control,p.manifestDigest,policyDigest,role,day,e.bound]);
        return [role,{id:`metrics_detail_${ids[role]}`,day,bytes:e.bound,statements:1,binding} satisfies QueryBudgetReservation];
      })) as Record<'feature'|'location',QueryBudgetReservation>;
      const record={schema:1,state:'reserving',parentId:job.id,fence:job.fence,workerHash:job.workerHash,manifestDigest:p.manifestDigest,policyDigest,reservations};
      if (prior) { if (digest(prior)!==digest(record)) throw new ReportError('unavailable'); return null; }
      tx.create(reportPath('uatTwoSourceIntents',job.id),record);
      return record;
    });
    if (!prepared) return {state:'uncertain' as const};
    // A lost acknowledgement is never a reason to issue a second grant or submit.
    for (const role of ['feature','location'] as const) {
      try {
        await this.store.transaction(async tx=>{
          const [live,control,raw,global,intent]=await Promise.all([tx.get<ReportJob>(reportPath('jobs',job.id)),
            tx.get<any>(reportPath('controls',job.request.reportId)),tx.get<any>(reportPath('policy','one-agent-detail-two-source')),
            tx.get<ReportingPolicy>(reportPath('policy','current')),tx.get<any>(reportPath('uatTwoSourceIntents',job.id))]);
          const now=this.now(); validateUatTwoSourcePolicies(raw,now);
          if (!validatePolicy(global).computeEnabled || !live || live.id!==job.id || live.key!==job.key || live.status!=='running' || live.fence!==job.fence || live.workerHash!==job.workerHash
            || live.leaseUntil<=now || live.expiresAt<=now || digest(live.request)!==digest(job.request) || digest(live.control)!==digest(job.control)
            || digest(control)!==digest(job.control) || digest(raw)!==prepared.policyDigest || digest(intent)!==digest(prepared)
            || new Date(now).toISOString().slice(0,10)!==prepared.reservations[role].day) throw new ReportError('unavailable');
        });
        await this.budget.reserve(prepared.reservations[role]); await this.budget.confirmBound(prepared.reservations[role]);
      }
      catch { return {state:'uncertain' as const}; }
    }
    return {state:'reservations_observed' as const}; // Caller must durably confirm both; no native create exists here.
  }
  async confirm(job:ReportJob) {
    if (this.enabled!==true) throw new ReportError('unavailable');
    const gate=async(tx:any)=>{
      const [live,control,raw,global,intent]=await Promise.all([tx.get(reportPath('jobs',job.id)),tx.get(reportPath('controls',job.request.reportId)),
        tx.get(reportPath('policy','one-agent-detail-two-source')),tx.get(reportPath('policy','current')),tx.get(reportPath('uatTwoSourceIntents',job.id))]);
      const now=this.now(), p=validateUatTwoSourcePolicies(raw,now), ids=uatTwoSourceChildIds(job.id,p.manifestDigest);
      if (!validatePolicy(global).computeEnabled || !Number.isSafeInteger(now) || !live || live.id!==job.id || live.key!==job.key || live.status!=='running'
        || live.fence!==job.fence || live.workerHash!==job.workerHash || live.leaseUntil<=now || live.expiresAt<=now || live.sourceStarted!==true
        || digest(live.request)!==digest(job.request) || digest(live.control)!==digest(job.control) || digest(control)!==digest(job.control)
        || !intent || Object.keys(intent).sort().join()!=='fence,manifestDigest,parentId,policyDigest,reservations,schema,state,workerHash'
        || !intent.reservations || Object.keys(intent.reservations).sort().join()!=='feature,location'
        || intent.schema!==1 || !['reserving','confirmed'].includes(intent.state) || intent.parentId!==job.id
        || intent.fence!==job.fence || intent.workerHash!==job.workerHash || intent.manifestDigest!==p.manifestDigest || intent.policyDigest!==digest(raw)
        || job.control.enabled!==true || job.control.scopeDigest!==p.manifest.scopeDigest || job.control.sourceGeneration!==p.manifest.sourceGeneration
        || job.request.startDate!==p.manifest.startDate || job.request.endDate!==p.manifest.endDate || job.request.timezone!==p.manifest.timezone) throw new ReportError('unavailable');
      for (const role of ['feature','location'] as const) {
        const r=intent.reservations?.[role], day=new Date(now).toISOString().slice(0,10);
        if (!r || Object.keys(r).sort().join()!=='binding,bytes,day,id,statements' || r.id!==`metrics_detail_${ids[role]}` || r.day!==day
          || r.statements!==1 || !Number.isSafeInteger(r.bytes) || r.bytes<1 || r.bytes>p[role].maxBytes
          || r.binding!==digest(['uat-two-source-reservation-v1',job.id,job.key,job.request,job.control,p.manifestDigest,intent.policyDigest,role,day,r.bytes])) throw new ReportError('unavailable');
      }
      return intent;
    };
    const intent=await this.store.transaction(gate);
    try { await this.budget.confirmBound(intent.reservations.feature); await this.budget.confirmBound(intent.reservations.location); }
    catch { return {state:'uncertain' as const}; }
    return this.store.transaction(async tx=>{
      const current=await gate(tx);
      if (digest(current)!==digest(intent)) throw new ReportError('unavailable');
      if (current.state==='reserving') tx.set(reportPath('uatTwoSourceIntents',job.id),{...current,state:'confirmed'});
      return {state:'confirmed' as const};
    });
  }
}
