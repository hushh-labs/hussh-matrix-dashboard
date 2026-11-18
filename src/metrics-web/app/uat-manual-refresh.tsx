'use client';
import { useEffect,useRef,useState } from 'react';
import type { OneAgentDetailV1 } from '../../../src/lib/one-agent-detail-types';
import { UatPartialDetail } from './uat-partial-detail';

/** This control performs no network work until the user selects Refresh. */
export function UatManualRefresh({request,enabled}:{request:{reportId:'one.agent-detail-uat';startDate:string;endDate:string;timezone:string};enabled:boolean}) {
 const active=useRef<AbortController|null>(null),[message,setMessage]=useState(''),[report,setReport]=useState<{detail:OneAgentDetailV1;computedAt:number;selection:string}|null>(null);
 const selection=JSON.stringify(request);
 useEffect(()=>{active.current?.abort();active.current=null;setReport(null);setMessage('');return ()=>{active.current?.abort();active.current=null;};},[selection,enabled]);
 async function run(){if(!enabled||active.current)return;const controller=new AbortController();active.current=controller;setReport(null);setMessage('Updating…');
  const call=async(path:string,body:unknown)=>{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal,cache:'no-store'});if(!r.ok)throw Error('unavailable');const value=await r.json();controller.signal.throwIfAborted();return value;};
  try {const started=await call('/api/uat-detail-refresh',request);let ready=started.state==='completed';
   for(let i=0;!ready&&i<4;i++){if(!started.jobId)break;await new Promise<void>((resolve,reject)=>{const t=setTimeout(resolve,2000);controller.signal.addEventListener('abort',()=>{clearTimeout(t);reject(Error('aborted'));},{once:true});});
    const status=await call('/api/uat-detail-status',started.jobId);if(status.needsAttention)break;ready=status.state==='partial';if(['failed','invalidated'].includes(status.state))break;}
   if(!ready){setMessage('Update is still pending or needs attention.');return;}
   const view=await call('/api/uat-detail-read',request);if(view.state!=='partial')throw Error('unavailable');setReport({detail:view.detail,computedAt:view.computedAt,selection});setMessage('Partial report loaded; source freshness is unknown.');
  }catch{if(!controller.signal.aborted){setReport(null);setMessage('Report refresh is unavailable.');}}finally{if(active.current===controller)active.current=null;}
 }
 return <section><button type="button" disabled={!enabled} onClick={run}>Refresh UAT agent activity</button><p role="status">{message}</p>{enabled && report?.selection===selection && <UatPartialDetail detail={report.detail} computedAt={report.computedAt}/>}</section>;
}

