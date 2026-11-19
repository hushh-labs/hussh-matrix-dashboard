import { ReportError, validateAccess, type ReportAccess } from './contracts';
import { validateReportWebConfig, type ReportWebConfig, type ReportingIdentityHeaders } from './web-client';
import { withinDeadline } from './deadline';
import { validateOneAgentDetail } from './one-agent-detail-contract';
import { validateRequest } from './contracts';

/** Fixed private detail endpoint. No browser cookie or source credentials cross this boundary. */
export class UatDetailWebClient {
 constructor(private config:ReportWebConfig,private identity:ReportingIdentityHeaders,private fetcher:typeof fetch=fetch) {this.config=Object.freeze({...validateReportWebConfig(config)});}
 private async call(operation:'read'|'request'|'status'|'read-dates'|'request-dates',input:unknown,access:ReportAccess,callerSignal?:AbortSignal) {
  validateAccess(access);const scoped=Object.freeze({...access}),signal=callerSignal ? AbortSignal.any([callerSignal,AbortSignal.timeout(this.config.timeoutMs)]) : AbortSignal.timeout(this.config.timeoutMs);
  signal.throwIfAborted(); const headers=await withinDeadline(this.identity(this.config.audience,signal),signal); signal.throwIfAborted();
  const response=await this.fetcher(`${this.config.audience}/internal/metrics/uat-detail/${operation}`,{method:'POST',redirect:'error',cache:'no-store',signal,
   headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(operation==='status'?{jobId:input,access:scoped}:{request:input,access:scoped})});
  if(!response.ok || response.redirected || !response.headers.get('content-type')?.includes('application/json') || Number(response.headers.get('content-length'))>this.config.maxResponseBytes) throw new ReportError('unavailable');
  const reader=response.body?.getReader();if(!reader)throw new ReportError('unavailable');let text='',bytes=0;const decoder=new TextDecoder();
  try {while(true){const part=await withinDeadline(reader.read(),signal);if(part.done)break;bytes+=part.value.byteLength;if(bytes>this.config.maxResponseBytes)throw new ReportError('unavailable');text+=decoder.decode(part.value,{stream:true});}}
  finally {await reader.cancel();}
  let v:any;try{v=JSON.parse(text+decoder.decode());}catch{throw new ReportError('unavailable');}
  return v;
 }
 async request(input:unknown,access:ReportAccess,signal?:AbortSignal,dateOnly=false) {
  const v=await this.call(dateOnly?'request-dates':'request',input,access,signal);
  const hash=(x:unknown)=>typeof x==='string' && /^[a-f0-9]{64}$/.test(x);
  if(!v || typeof v!=='object' || Array.isArray(v) || Object.keys(v).sort().join()!=='jobId,reportId,state' || (v.state==='completed' ? !hash(v.reportId)||v.jobId!==null : !['accepted','running','delayed'].includes(v.state)||!hash(v.jobId)||v.reportId!==null)) throw new ReportError('unavailable');
  return v as {state:'completed'|'accepted'|'running'|'delayed';jobId:string|null;reportId:string|null};
 }
 async read(input:unknown,access:ReportAccess,signal?:AbortSignal) {
  const v=await this.call('read',input,access,signal);
  if(v && Object.keys(v).sort().join()==='state' && v.state==='unavailable')return {state:'unavailable' as const};
  if(!v || Object.keys(v).sort().join()!=='computedAt,detail,freshness,state' || v.state!=='partial' || v.freshness!=='unknown'
   || !Number.isSafeInteger(v.computedAt) || v.computedAt<0 || v.computedAt>Date.now())throw new ReportError('unavailable');
  const req=validateRequest(input,90);if(req.reportId!=='one.agent-detail-uat')throw new ReportError('invalid');
  const detail=validateOneAgentDetail(v.detail,{environment:'uat',scopeDigest:access.scopeDigest,period:req});
  if(detail.source.checkedAt!==null || detail.source.watermark!==null)throw new ReportError('unavailable');
  return {state:'partial' as const,freshness:'unknown' as const,computedAt:v.computedAt,detail};
 }
 async readDates(input:unknown,access:ReportAccess,signal?:AbortSignal) {
  const v=await this.call('read-dates',input,access,signal);
  if(!v || Object.keys(v).sort().join()!=='request,result')throw new ReportError('unavailable');
  const req=validateRequest(v.request,90), dates=input as {startDate?:unknown;endDate?:unknown};
  if(req.reportId!=='one.agent-detail-uat' || req.startDate!==dates?.startDate || req.endDate!==dates?.endDate)throw new ReportError('unavailable');
  const result=v.result;
  if(result && Object.keys(result).sort().join()==='state' && result.state==='unavailable')return result;
  if(!result || Object.keys(result).sort().join()!=='computedAt,detail,freshness,state' || result.state!=='partial' || result.freshness!=='unknown'
   || !Number.isSafeInteger(result.computedAt) || result.computedAt<0 || result.computedAt>Date.now())throw new ReportError('unavailable');
  const detail=validateOneAgentDetail(result.detail,{environment:'uat',scopeDigest:access.scopeDigest,period:req});
  if(detail.source.checkedAt!==null || detail.source.watermark!==null)throw new ReportError('unavailable');
  return {state:'partial' as const,freshness:'unknown' as const,computedAt:result.computedAt,detail};
 }
 async status(id:string,access:ReportAccess,signal?:AbortSignal) {
  if(!/^[a-f0-9]{64}$/.test(id))throw new ReportError('invalid');const v=await this.call('status',id,access,signal);
  if(!v || Object.keys(v).sort().join()!=='needsAttention,state' || typeof v.needsAttention!=='boolean' || !['accepted','running','delayed','partial','failed','invalidated'].includes(v.state))throw new ReportError('unavailable');
  return v as {state:'accepted'|'running'|'delayed'|'partial'|'failed'|'invalidated';needsAttention:boolean};
 }

}
