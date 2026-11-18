import { createServer } from 'node:http';
import { ReportError } from './contracts';
import type { UatDetailDispatcher, UatDetailExecutor } from './uat-detail-executor';

/** Explicitly constructed private listener only; no deployment or startup hook.
 * Slow/incomplete request-body behavior requires separate qualification before
 * runtime wiring. A response deadline does not prove upstream work stopped. */
export function uatDetailServer(config:{enabled:boolean;maxRequestBytes:number;timeoutMs:number},
  executor:Pick<UatDetailExecutor,'execute'>, dispatcher:Pick<UatDetailDispatcher,'deliver'>) {
  const local=Object.freeze({...config});
  if (local.enabled!==true || !Number.isSafeInteger(local.maxRequestBytes) || local.maxRequestBytes<1 || local.maxRequestBytes>8192
    || !Number.isSafeInteger(local.timeoutMs) || local.timeoutMs<1 || local.timeoutMs>60000) throw new ReportError('unavailable');
  const server=createServer(async(req,res)=>{
    const abort=new AbortController(), timer=setTimeout(()=>{
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
      if (req.method!=='POST' || !['/internal/metrics/uat-detail/collect','/internal/metrics/uat-detail/dispatch'].includes(req.url??'')) throw new ReportError('invalid');
      const header=req.headers.authorization;
      if (!header?.startsWith('Bearer ') || header.length>16384) throw new ReportError('unauthorized');
      if (req.headers['content-type']?.split(';')[0]!=='application/json' || Number(req.headers['content-length'])>local.maxRequestBytes) throw new ReportError('invalid');
      let size=0,text=''; const decoder=new TextDecoder();
      for await (const part of req) { size+=part.length; if (size>local.maxRequestBytes) throw new ReportError('invalid'); text+=decoder.decode(part,{stream:true}); }
      let body:any; try { body=JSON.parse(text+decoder.decode()); } catch { throw new ReportError('invalid'); }
      if (!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).join()!=='jobId' || !/^[a-f0-9]{64}$/.test(body.jobId)) throw new ReportError('invalid');
      abort.signal.throwIfAborted();
      const result=req.url!.endsWith('/collect') ? await executor.execute(header.slice(7),body.jobId,abort.signal)
        : await dispatcher.deliver(header.slice(7),body.jobId,abort.signal);
      abort.signal.throwIfAborted(); res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'private, no-store'}); res.end(JSON.stringify(result));
    } catch(error) {
      const code=error instanceof ReportError?error.code:'unavailable';
      if (!res.destroyed && !res.writableEnded) { res.writeHead(code==='unauthorized'?401:code==='invalid'?400:503,
        {'Content-Type':'application/json','Cache-Control':'private, no-store'}); res.end(JSON.stringify({state:code})); }
    } finally { clearTimeout(timer); req.off('aborted',disconnected); res.off('close',disconnected); }
  });
  server.requestTimeout=local.timeoutMs; server.headersTimeout=local.timeoutMs; return server;
}
