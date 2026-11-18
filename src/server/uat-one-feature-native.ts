import { BigQuery } from '@google-cloud/bigquery';
import { createHash } from 'node:crypto';
import { BIGQUERY_COST_LIMITS, type FirestoreQueryBudgetStore } from './bigquery-cost-control';
import { digest, validatePolicy, type ReportJob, type ReportingPolicy, type ReportControl } from './reports/contracts';
import { reportPath, type ReportStore } from './reports/store';
import { conservativeBillingBound } from './bigquery-billing-bound';
import { buildUatFeaturePlan } from './uat-one-feature-plan';

type Config = Parameters<typeof buildUatFeaturePlan>[0];
type Ref = { projectId:string; datasetId:string; tableId:string };
type Table = { id:string; type:string };
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const bad=()=>{throw new Error('UAT native feature query unavailable');};
const integer=(v:unknown)=>typeof v==='string' && /^\d+$/.test(v) && Number.isSafeInteger(Number(v)) ? Number(v) : bad();
/** Disconnected native adapter. Caller must verify the approved source policy,
 * property timezone and billing policy, and must use the staged journal. */
export class UatFeatureNative {
  private plan:ReturnType<typeof buildUatFeaturePlan>;
  private client:BigQuery;
  private proof:{ refs:Ref[]; referenceDigest:string; bound:number } | undefined;
  constructor(config:Config, approvedQueryHash:string, private readonly approvedReferenceDigest:string,
    private readonly budget:FirestoreQueryBudgetStore, private readonly store:ReportStore,
    private readonly authorize:(job:ReportJob)=>Promise<boolean>, private readonly now:()=>number=Date.now,
    factory:(options:{projectId:string;autoRetry:false;maxRetries:0})=>BigQuery = options=>new BigQuery(options)) {
    this.plan=buildUatFeaturePlan(config);
    if (approvedQueryHash!==this.plan.queryHash || !/^[a-f0-9]{64}$/.test(approvedReferenceDigest)) bad();
    this.client=factory({projectId:BIGQUERY_COST_LIMITS.project,autoRetry:false,maxRetries:0});
  }
  private async catalog(signal:AbortSignal):Promise<Table[]> {
    const all:Table[]=[], seen=new Set<string>(), tokens=new Set<string>(); let pageToken:string|undefined;
    for (let page=0;page<10;page++) {
      signal.throwIfAborted();
      const [tables,next]=await this.client.dataset(this.plan.dataset,{projectId:this.plan.sourceProject}).getTables({autoPaginate:false,maxResults:1000,pageToken});
      signal.throwIfAborted();
      for (const table of tables) {
        const id=table.id, type=String(table.metadata?.type ?? '');
        if (!id || !type || seen.has(id)) bad(); seen.add(id); all.push({id,type});
      }
      pageToken=next?.pageToken;
      if (!pageToken) return all.sort((a,b)=>a.id.localeCompare(b.id));
      if (tokens.has(pageToken)) bad(); tokens.add(pageToken);
    }
    return bad();
  }
  private validateReferences(raw:unknown):Ref[] {
    if (!Array.isArray(raw) || !raw.length || raw.length>1000) return bad();
    const refs:Ref[]=raw.map(ref=>{
      if (!ref || ref.projectId!==this.plan.sourceProject || ref.datasetId!==this.plan.dataset || typeof ref.tableId!=='string') return bad();
      const table=ref.tableId;
      if (table!=='events_*' && table!=='INFORMATION_SCHEMA.TABLES') {
        const match=/^events_(?:intraday_)?(\d{8})$/.exec(table);
        if (!match || match[1]<this.plan.startDate.replaceAll('-','') || match[1]>this.plan.endDate.replaceAll('-','')) return bad();
      }
      return {projectId:ref.projectId,datasetId:ref.datasetId,tableId:table};
    });
    const keys=refs.map(r=>`${r.projectId}:${r.datasetId}:${r.tableId}`);
    if (new Set(keys).size!==keys.length || !refs.some(r=>r.tableId.startsWith('events_'))) bad();
    return refs.sort((a,b)=>a.tableId.localeCompare(b.tableId));
  }
  private referenceDigest(refs:Ref[], catalog:Table[]) { return sha(JSON.stringify({refs,catalog})); }
  async estimate(sql:string, signal:AbortSignal) {
    signal.throwIfAborted(); if (sql!==this.plan.query) return bad();
    const [job]=await this.client.createQueryJob({query:sql,dryRun:true,useLegacySql:false,useQueryCache:true,location:'US',
      maximumBytesBilled:String(BIGQUERY_COST_LIMITS.bytesPerStatement),jobTimeoutMs:BIGQUERY_COST_LIMITS.timeoutMs});
    signal.throwIfAborted();
    const m=job.metadata as any, q=m?.configuration?.query, stats=m?.statistics?.query, ref=m?.jobReference;
    if (ref?.projectId!==BIGQUERY_COST_LIMITS.project || ref?.location!=='US' || q?.query!==sql || q?.useLegacySql!==false
      || q?.useQueryCache!==true || q?.parameterMode || (q?.queryParameters !== undefined && (!Array.isArray(q.queryParameters) || q.queryParameters.length)) || stats?.statementType!=='SELECT'
      || !['PRECISE','UPPER_BOUND'].includes(stats?.totalBytesProcessedAccuracy)) return bad();
    const processed=integer(m.statistics.totalBytesProcessed), refs=this.validateReferences(stats.referencedTables), catalog=await this.catalog(signal);
    const bound=await conservativeBillingBound(processed,refs,async (project,dataset)=>{
      if (project!==this.plan.sourceProject || dataset!==this.plan.dataset) return bad(); return catalog;
    });
    const referenceDigest=this.referenceDigest(refs,catalog);
    if (referenceDigest!==this.approvedReferenceDigest || bound>BIGQUERY_COST_LIMITS.bytesPerStatement) return bad();
    this.proof={refs,referenceDigest,bound};
    return {queryHash:this.plan.queryHash,project:BIGQUERY_COST_LIMITS.project,location:'US',statementType:'SELECT',
      referenceDigest,accuracy:stats.totalBytesProcessedAccuracy,processed,referencedFloor:bound,bound};
  }
  async submit(request:{sql:string;id:string;jobId:string;day:string;binding:string;project:string;location:'US';queryHash:string;useLegacySql:false;maximumBytesBilled:number;signal:AbortSignal}) {
    if (!this.proof || request.sql!==this.plan.query || request.queryHash!==this.plan.queryHash
      || !/^metrics_detail_[a-f0-9]{64}$/.test(request.id) || request.project!==BIGQUERY_COST_LIMITS.project
      || request.location!=='US' || request.useLegacySql!==false || request.maximumBytesBilled!==this.proof.bound) return bad();
    request.signal.throwIfAborted();
    await this.budget.confirmBound({id:request.id,day:request.day,bytes:request.maximumBytesBilled,statements:1,binding:request.binding});
    request.signal.throwIfAborted();
    if (this.referenceDigest(this.proof.refs,await this.catalog(request.signal))!==this.proof.referenceDigest) return bad();
    request.signal.throwIfAborted();
    const initial=await this.store.transaction(tx=>tx.get<ReportJob>(reportPath('jobs',request.jobId)));
    if (!initial || !await this.authorize(initial)) return bad();
    request.signal.throwIfAborted();
    await this.store.transaction(async tx=>{
      const [job,control,global,p,i]=await Promise.all([tx.get<ReportJob>(reportPath('jobs',request.jobId)),
        tx.get<ReportControl>(reportPath('controls','one.agent-detail-uat')),tx.get<ReportingPolicy>(reportPath('policy','current')),
        tx.get<any>(reportPath('policy','one-agent-detail-bq')),tx.get<any>(reportPath('uatDetailIntents',request.jobId))]);
      const now=this.now(), today=Number.isSafeInteger(now) && now>=0 ? new Date(now).toISOString().slice(0,10) : '';
      if (!validatePolicy(global).computeEnabled || !job || job.status!=='running' || job.id!==request.jobId
        || job.fence!==initial.fence || job.workerHash!==initial.workerHash || job.leaseUntil<=now || job.expiresAt<=now
        || digest(job.control)!==digest(initial.control) || digest(control)!==digest(job.control)
        || String(job.request.reportId)!=='one.agent-detail-uat' || job.request.startDate!==this.plan.startDate
        || job.request.endDate!==this.plan.endDate || job.request.timezone!==this.plan.timezone
        || !p || p.approved!==true || p.enabled!==true || p.environment!=='uat' || p.project!==request.project
        || p.location!=='US' || p.queryHash!==this.plan.queryHash || p.referenceDigest!==this.approvedReferenceDigest
        || p.startDate!==this.plan.startDate || p.endDate!==this.plan.endDate || p.timezone!==this.plan.timezone
        || p.scopeDigest!==job.control.scopeDigest || p.sourceGeneration!==job.control.sourceGeneration || p.expiresAt<=now
        || !Number.isSafeInteger(p.maxBytes) || p.maxBytes<request.maximumBytesBilled || p.maxBytes>BIGQUERY_COST_LIMITS.bytesPerStatement
        || !i || i.state!=='started' || i.jobId!==job.id || i.fence!==job.fence || i.workerHash!==job.workerHash
        || i.nativeId!==request.id || i.binding!==request.binding || i.day!==request.day || today!==request.day
        || i.bytes!==request.maximumBytesBilled || i.queryHash!==this.plan.queryHash || i.policyDigest!==digest(p)
        || i.binding!==digest([job.id,job.key,job.request,job.control,p.environment,p.project,p.location,p.queryHash,i.policyDigest,i.day,i.bytes])) return bad();
      // Claim this one external create attempt atomically; a crash or lost ack
      // after this point is reconciled only by native ID, never recreated.
      tx.set(reportPath('uatDetailIntents',request.jobId),{...i,state:'dispatching'});
    });
    request.signal.throwIfAborted();
    // One call only; disabled SDK retries and the durable journal own uncertainty.
    await this.client.createQueryJob({query:request.sql,jobId:request.id,location:'US',useLegacySql:false,useQueryCache:true,
      maximumBytesBilled:String(request.maximumBytesBilled),jobTimeoutMs:BIGQUERY_COST_LIMITS.timeoutMs});
  }
  async lookup(id:string) {
    if (!/^metrics_detail_[a-f0-9]{64}$/.test(id)) return bad();
    let m:any; try { [m]=await this.client.job(id,{location:'US'}).getMetadata(); }
    catch (error) { if ((error as {code?:number}).code===404) return null; throw error; }
    const q=m?.configuration?.query, ref=m?.jobReference, stats=m?.statistics?.query;
    if (ref?.jobId!==id || ref?.projectId!==BIGQUERY_COST_LIMITS.project || ref?.location!=='US'
      || q?.query!==this.plan.query || q?.useLegacySql!==false || q?.useQueryCache!==true || q?.parameterMode
      || (q?.queryParameters !== undefined && (!Array.isArray(q.queryParameters) || q.queryParameters.length))
      || stats?.statementType!=='SELECT') return bad();
    return {id,project:ref.projectId,location:ref.location,queryHash:this.plan.queryHash,useLegacySql:false,
      maximumBytesBilled:integer(q.maximumBytesBilled),state:m?.status?.state,error:!!m?.status?.errorResult,
      billed:integer(stats.totalBytesBilled),endedAt:integer(m?.statistics?.endTime)};
  }
}
