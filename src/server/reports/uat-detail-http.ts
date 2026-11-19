import { createServer } from 'node:http';
import { ReportError, validateAccess, type ReportAccess } from './contracts';
import type { UatDetailDispatcher, UatDetailExecutor } from './uat-detail-executor';

/** Explicitly constructed private listener only; no deployment or startup hook.
 * Slow/incomplete request-body behavior requires separate qualification before
 * runtime wiring. A response deadline does not prove upstream work stopped. */
export function uatDetailServer(config:{enabled:boolean;maxRequestBytes:number;maxResponseBytes:number;timeoutMs:number},
  executor:Pick<UatDetailExecutor,'execute'>, dispatcher:Pick<UatDetailDispatcher,'deliver'>,
  web?:{readDatesForWeb(token:string,access:ReportAccess,input:unknown,signal:AbortSignal):Promise<unknown>;requestDatesForWeb(token:string,access:ReportAccess,input:unknown,signal:AbortSignal):Promise<unknown>;readForWeb(token:string,access:ReportAccess,input:unknown,signal:AbortSignal):Promise<unknown>;requestForWeb(token:string,access:ReportAccess,input:unknown,signal:AbortSignal):Promise<unknown>;statusForWeb(token:string,access:ReportAccess,id:string,signal:AbortSignal):Promise<unknown>}) {
  const local=Object.freeze({...config});
  if (local.enabled!==true || !Number.isSafeInteger(local.maxRequestBytes) || local.maxRequestBytes<1 || local.maxRequestBytes>8192
    || !Number.isSafeInteger(local.maxResponseBytes) || local.maxResponseBytes<32 || local.maxResponseBytes>900000
    || !Number.isSafeInteger(local.timeoutMs) || local.timeoutMs<1 || local.timeoutMs>60000) throw new ReportError('unavailable');
  const active = new Set<AbortController>(); let draining = false;
  const server=createServer(async(req,res)=>{
    const abort=new AbortController(); active.add(abort);
    const timer=setTimeout(()=>{
      abort.abort();
      // The response deadline does not prove a dispatched provider operation stopped.
      if (!res.destroyed && !res.writableEnded) {
        res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'private, no-store'});
        res.end('{"state":"unavailable"}');
      }
    },local.timeoutMs);
    const disconnected=()=>{ if (!res.writableEnded) abort.abort(); };
    req.on('aborted',disconnected); res.on('close',disconnected);
    try {
      if (draining) throw new ReportError('unavailable');
      if (req.method!=='POST' || !['/internal/metrics/uat-detail/collect','/internal/metrics/uat-detail/dispatch','/internal/metrics/uat-detail/read','/internal/metrics/uat-detail/request','/internal/metrics/uat-detail/status','/internal/metrics/uat-detail/read-dates','/internal/metrics/uat-detail/request-dates'].includes(req.url??'')) throw new ReportError('invalid');
      const header=req.headers.authorization;
      if (!header?.startsWith('Bearer ') || header.length>16384) throw new ReportError('unauthorized');
      if (req.headers['content-type']?.split(';')[0]!=='application/json' || Number(req.headers['content-length'])>local.maxRequestBytes) throw new ReportError('invalid');
      let size=0,text=''; const decoder=new TextDecoder();
      for await (const part of req) { size+=part.length; if (size>local.maxRequestBytes) throw new ReportError('invalid'); text+=decoder.decode(part,{stream:true}); }
      let body:any; try { body=JSON.parse(text+decoder.decode()); } catch { throw new ReportError('invalid'); }
      if (!body || typeof body!=='object' || Array.isArray(body)) throw new ReportError('invalid');
      abort.signal.throwIfAborted();
      let result:unknown;
      if (req.url!.endsWith('/read') || req.url!.endsWith('/request') || req.url!.endsWith('/status') || req.url!.endsWith('/read-dates') || req.url!.endsWith('/request-dates')) {
        const status=req.url!.endsWith('/status');
        if (!web || Object.keys(body).sort().join()!==(status?'access,jobId':'access,request')) throw new ReportError('unavailable');
        validateAccess(body.access); const access=Object.freeze({...body.access}) as ReportAccess;
        result=req.url!.endsWith('/read-dates') ? await web.readDatesForWeb(header.slice(7),access,body.request,abort.signal) : req.url!.endsWith('/request-dates') ? await web.requestDatesForWeb(header.slice(7),access,body.request,abort.signal) : status ? await web.statusForWeb(header.slice(7),access,body.jobId,abort.signal) : req.url!.endsWith('/read') ? await web.readForWeb(header.slice(7),access,body.request,abort.signal)
          : await web.requestForWeb(header.slice(7),access,body.request,abort.signal);
      } else {
        if (Object.keys(body).join()!=='jobId' || !/^[a-f0-9]{64}$/.test(body.jobId)) throw new ReportError('invalid');
        result=req.url!.endsWith('/collect') ? await executor.execute(header.slice(7),body.jobId,abort.signal)
          : await dispatcher.deliver(header.slice(7),body.jobId,abort.signal);
      }
      abort.signal.throwIfAborted(); const serialized=JSON.stringify(result);
      if (typeof serialized!=='string' || Buffer.byteLength(serialized)>local.maxResponseBytes) throw new ReportError('unavailable');
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'private, no-store'}); res.end(serialized);
    } catch(error) {
      const code=error instanceof ReportError?error.code:'unavailable';
      if (!res.destroyed && !res.writableEnded) { res.writeHead(code==='unauthorized'?401:code==='invalid'?400:503,
        {'Content-Type':'application/json','Cache-Control':'private, no-store'}); res.end(JSON.stringify({state:code})); }
    } finally { active.delete(abort); clearTimeout(timer); req.off('aborted',disconnected); res.off('close',disconnected); }
  });
  server.on('uat-drain',()=>{draining=true;for(const abort of active)abort.abort();});
  server.requestTimeout=local.timeoutMs; server.headersTimeout=local.timeoutMs; return server;
}

/** Bounded drain closes sockets even when an operation ignores cancellation.
 * Dispatched work remains uncertain until its own durable reconciliation. */
export function shutdownUatDetailServer(server:ReturnType<typeof uatDetailServer>,timeoutMs:number) {
 if(!Number.isSafeInteger(timeoutMs) || timeoutMs<1 || timeoutMs>60000)throw new ReportError('invalid');
 server.emit('uat-drain');
 return new Promise<void>(resolve=>{
  let done=false;const finish=()=>{if(done)return;done=true;clearTimeout(timer);resolve();};
  const timer=setTimeout(()=>{server.closeAllConnections();finish();},timeoutMs);
  server.close(()=>finish());
 });
}
