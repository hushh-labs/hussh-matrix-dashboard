import { ReportError } from './contracts';
import type { ReportTaskQueue, TaskApiRequest } from './dispatch';

/** Separate fixed detail target; no runtime constructs this adapter by default. */
export class UatDetailTaskQueue implements ReportTaskQueue {
  private origin:string;
  constructor(private config:{enabled:boolean;parent:string;workerUrl:string;invokerEmail:string;rpcTimeoutMs:number}, private request:TaskApiRequest) {
    if (config.enabled!==true) throw new ReportError('unavailable');
    const parent=/^projects\/([a-z][a-z0-9-]{4,61}[a-z0-9])\/locations\/[a-z0-9-]+\/queues\/metrics-uat-detail-[a-z0-9-]+$/.exec(config.parent);
    let url:URL; try { url=new URL(config.workerUrl); } catch { throw new ReportError('invalid'); }
    if (!parent || url.protocol!=='https:' || !url.hostname.endsWith('.run.app') || url.username || url.password || url.port || url.search || url.hash
      || url.pathname!=='/internal/metrics/uat-detail/collect' || config.invokerEmail!==`metrics-report-task-invoker@${parent[1]}.iam.gserviceaccount.com`
      || !Number.isSafeInteger(config.rpcTimeoutMs) || config.rpcTimeoutMs<1 || config.rpcTimeoutMs>0xffff_ffff) throw new ReportError('invalid');
    this.origin=url.origin; this.config=Object.freeze({...config});
  }
  taskName(jobId:string) {
    if (!/^[a-f0-9]{64}$/.test(jobId)) throw new ReportError('invalid');
    return `${this.config.parent}/tasks/${jobId}`;
  }
  async create(jobId:string):Promise<'accepted'|'rejected'> {
    const name=this.taskName(jobId);
    const response=await this.request(`https://cloudtasks.googleapis.com/v2/${this.config.parent}/tasks`,{method:'POST',signal:AbortSignal.timeout(this.config.rpcTimeoutMs),body:{responseView:'BASIC',task:{name,httpRequest:{
      url:this.config.workerUrl,httpMethod:'POST',headers:{'Content-Type':'application/json'},body:Buffer.from(JSON.stringify({jobId})).toString('base64'),
      oidcToken:{serviceAccountEmail:this.config.invokerEmail,audience:this.origin}}}}});
    // A name conflict does not prove the existing task has the approved target.
    if (response.status>=200 && response.status<300 && response.name===name) return 'accepted';
    if ([400,401,403].includes(response.status)) return 'rejected'; throw new ReportError('unavailable');
  }
  async lookup(jobId:string):Promise<'present'|'missing'|'rejected'> {
    const name=this.taskName(jobId), response=await this.request(`https://cloudtasks.googleapis.com/v2/${name}?responseView=BASIC`,
      {method:'GET',signal:AbortSignal.timeout(this.config.rpcTimeoutMs)});
    // BASIC metadata does not prove the existing task target or invoker.
    if (response.status===200 && response.name===name) return 'missing';
    if (response.status===404) return 'missing';
    if ([400,401,403].includes(response.status)) return 'rejected'; throw new ReportError('unavailable');
  }
}
