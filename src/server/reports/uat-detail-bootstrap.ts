import { ReportError, type ReportAccess } from './contracts';
import { withinDeadline } from './deadline';
import { googleWorkerIdentityVerifier } from './worker-http';
import { uatDetailServer } from './uat-detail-http';
import { createServiceOwnedUatRuntime } from '../bigquery-cost-control';

/** Separately invoked private listener. Boot does not contact Firestore, the
 * warehouse, identity, or a queue. Runtime policy and identity are rechecked on
 * every operation; a network deadline cannot retract dispatched work. */
export function createUatDetailBootstrap(env:Record<string,string|undefined> = process.env) {
 if(env.METRICS_UAT_LISTENER_ENABLED!=='true' || env.METRICS_UAT_SERVICE_ENABLED!=='true'
  || env.METRICS_UAT_DETAIL_ENABLED!=='true' || env.FIRESTORE_EMULATOR_HOST) throw new ReportError('unavailable');
 const raw=env.METRICS_UAT_SERVICE_CONFIG; let c:any;
 try {c=JSON.parse(raw??'');} catch {throw new ReportError('unavailable');}
 let url:URL;try{url=new URL(c.workerAudience);}catch{throw new ReportError('unavailable');}
 if(!c || Object.keys(c).sort().join()!=='maxResponseBytes,queueParent,reportingDatabase,reportingProject,rpcTimeoutMs,taskInvoker,webInvoker,workerAudience'
  || c.reportingProject!=='hushh-ai-prod' || c.reportingDatabase!=='metrics-reports'
  || c.taskInvoker!=='metrics-report-task-invoker@hushh-ai-prod.iam.gserviceaccount.com'
  || c.webInvoker!=='metrics-report-web@hushh-ai-prod.iam.gserviceaccount.com'
  || !/^projects\/hushh-ai-prod\/locations\/[a-z0-9-]+\/queues\/metrics-uat-detail-[a-z0-9-]+$/.test(c.queueParent)
  || url.protocol!=='https:' || !url.hostname.endsWith('.run.app') || url.origin!==c.workerAudience
  || !Number.isSafeInteger(c.rpcTimeoutMs) || c.rpcTimeoutMs<1 || c.rpcTimeoutMs>60000
  || !Number.isSafeInteger(c.maxResponseBytes) || c.maxResponseBytes<32 || c.maxResponseBytes>900000) throw new ReportError('unavailable');
 const verify=googleWorkerIdentityVerifier(); let runtime:Promise<Awaited<ReturnType<typeof createServiceOwnedUatRuntime>>>|undefined,closed=false;
 const flags=()=>{if(closed || env.METRICS_UAT_LISTENER_ENABLED!=='true' || env.METRICS_UAT_SERVICE_ENABLED!=='true'
  || env.METRICS_UAT_DETAIL_ENABLED!=='true' || env.FIRESTORE_EMULATOR_HOST || env.METRICS_UAT_SERVICE_CONFIG!==raw) throw new ReportError('unavailable');};
 async function authorized(token:string,email:string,signal:AbortSignal) {
  flags();signal.throwIfAborted();const identity=await withinDeadline(verify(token,c.workerAudience),signal);
  flags();signal.throwIfAborted();if(!identity.emailVerified || identity.email!==email)throw new ReportError('unauthorized');
  runtime ??= createServiceOwnedUatRuntime().catch(error=>{runtime=undefined;throw error;});
  const value=await withinDeadline(runtime,signal);flags();signal.throwIfAborted();return value;
 }
 const web={
  async readForWeb(token:string,access:ReportAccess,input:unknown,signal:AbortSignal){return (await authorized(token,c.webInvoker,signal)).readForWeb(token,access,input);},
  async readDatesForWeb(token:string,access:ReportAccess,input:unknown,signal:AbortSignal){return (await authorized(token,c.webInvoker,signal)).readDatesForWeb(token,access,input);},
  async requestForWeb(token:string,access:ReportAccess,input:unknown,signal:AbortSignal){return (await authorized(token,c.webInvoker,signal)).requestForWeb(token,access,input,signal);},
  async requestDatesForWeb(token:string,access:ReportAccess,input:unknown,signal:AbortSignal){return (await authorized(token,c.webInvoker,signal)).requestDatesForWeb(token,access,input,signal);},
  async statusForWeb(token:string,access:ReportAccess,id:string,signal:AbortSignal){return (await authorized(token,c.webInvoker,signal)).statusForWeb(token,access,id);},
 };
 const server=uatDetailServer({enabled:true,maxRequestBytes:8192,maxResponseBytes:c.maxResponseBytes,timeoutMs:c.rpcTimeoutMs},
  {execute:async(token,id,signal)=>(await authorized(token,c.taskInvoker,signal)).collect(token,id,signal)},
  {deliver:async(token,id,signal)=>(await authorized(token,'metrics-report-dispatcher@hushh-ai-prod.iam.gserviceaccount.com',signal)).dispatch(token,id,signal)},web);
 server.once('close',()=>{closed=true;void runtime?.then(value=>value.close()).catch(()=>{});});
 return server;
}
