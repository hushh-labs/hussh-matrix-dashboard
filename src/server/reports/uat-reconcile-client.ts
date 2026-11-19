import { ReportError } from './contracts';
import { withinDeadline } from './deadline';
import type { ReportingIdentityHeaders } from './web-client';

/** One explicit lookup-only recovery request. This never creates or retries a task. */
export async function reconcileUatTask(jobId:string,env:Record<string,string|undefined>,identity:ReportingIdentityHeaders,fetcher:typeof fetch=fetch) {
 if(env.METRICS_UAT_OPERATOR_RECONCILE_ENABLED!=='true' || !/^[a-f0-9]{64}$/.test(jobId))throw new ReportError('unavailable');
 const raw=env.METRICS_UAT_SERVICE_CONFIG;let c:any;
 try{c=JSON.parse(raw??'');}catch{throw new ReportError('unavailable');}
 let url:URL;try{url=new URL(c.workerAudience);}catch{throw new ReportError('unavailable');}
 if(!c || Object.keys(c).sort().join()!=='maxResponseBytes,queueParent,reportingDatabase,reportingProject,rpcTimeoutMs,taskInvoker,webInvoker,workerAudience'
  || c.reportingProject!=='hushh-ai-prod' || c.reportingDatabase!=='metrics-reports'
  || c.taskInvoker!=='metrics-report-task-invoker@hushh-ai-prod.iam.gserviceaccount.com'
  || c.webInvoker!=='metrics-report-web@hushh-ai-prod.iam.gserviceaccount.com'
  || !/^projects\/hushh-ai-prod\/locations\/[a-z0-9-]+\/queues\/metrics-uat-detail-[a-z0-9-]+$/.test(c.queueParent)
  || url.protocol!=='https:' || !url.hostname.endsWith('.run.app') || url.origin!==c.workerAudience
  || url.username || url.password || url.port || url.search || url.hash
  || !Number.isSafeInteger(c.rpcTimeoutMs) || c.rpcTimeoutMs<1 || c.rpcTimeoutMs>60000
  || !Number.isSafeInteger(c.maxResponseBytes) || c.maxResponseBytes<32 || c.maxResponseBytes>900000)throw new ReportError('unavailable');
 const signal=AbortSignal.timeout(c.rpcTimeoutMs);signal.throwIfAborted();
 const headers=await withinDeadline(identity(c.workerAudience,signal),signal);
 if(env.METRICS_UAT_OPERATOR_RECONCILE_ENABLED!=='true' || env.METRICS_UAT_SERVICE_CONFIG!==raw)throw new ReportError('unavailable');
 signal.throwIfAborted();
 const response=await withinDeadline(fetcher(c.workerAudience+'/internal/metrics/uat-detail/dispatch',{method:'POST',redirect:'error',cache:'no-store',signal,
  headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({jobId})}),signal);
 if(!response.ok || response.redirected || !response.headers.get('content-type')?.includes('application/json') || Number(response.headers.get('content-length'))>1024)throw new ReportError('unavailable');
 const reader=response.body?.getReader();if(!reader)throw new ReportError('unavailable');let size=0,text='';const decoder=new TextDecoder();
 try {while(true){const part=await withinDeadline(reader.read(),signal);if(part.done)break;size+=part.value.byteLength;if(size>1024)throw new ReportError('unavailable');text+=decoder.decode(part.value,{stream:true});}}
 finally{void reader.cancel().catch(()=>{});}
 let value:any;try{value=JSON.parse(text+decoder.decode());}catch{throw new ReportError('unavailable');}
 signal.throwIfAborted();if(env.METRICS_UAT_OPERATOR_RECONCILE_ENABLED!=='true' || env.METRICS_UAT_SERVICE_CONFIG!==raw)throw new ReportError('unavailable');
 if(!value || Object.keys(value).join()!=='state' || !['delayed','blocked','settled','skipped'].includes(value.state))throw new ReportError('unavailable');
 return {state:value.state as 'delayed'|'blocked'|'settled'|'skipped'};
}
