'use client';
import { useEffect,useRef,useState } from 'react';
import type { OneAgentDetailV1 } from '../../../src/lib/one-agent-detail-types';
import { UatPartialDetail } from './uat-partial-detail';

/** This control performs no network work until the user selects Refresh. */
let reloadConsumed = false;
export function UatManualRefresh({request,enabled,autoReload=false}:{request:{startDate:string;endDate:string;reportId?:'one.agent-detail-uat';timezone?:string};enabled:boolean;autoReload?:boolean}) {
 const active=useRef<AbortController|null>(null),[message,setMessage]=useState(''),[report,setReport]=useState<{detail:OneAgentDetailV1;computedAt:number;selection:string}|null>(null);
 const selection=JSON.stringify(request);
 useEffect(()=>{active.current?.abort();active.current=null;setReport(null);setMessage('');return ()=>{active.current?.abort();active.current=null;};},[selection,enabled]);
 async function run(preserve=false){if(!enabled||active.current)return;const controller=new AbortController();active.current=controller;if(!preserve)setReport(null);setMessage('Updating…');
  const call=async(path:string,body:unknown)=>{const requestController=new AbortController(),cancel=()=>requestController.abort();
   const timer=setTimeout(cancel,10000);controller.signal.addEventListener('abort',cancel,{once:true});
   try {if(controller.signal.aborted)cancel();const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:requestController.signal,cache:'no-store'});
    if(!r.ok)throw Object.assign(Error('unavailable'),{status:r.status});const value=await r.json();if(requestController.signal.aborted)throw Error('aborted');return value;
   } finally {clearTimeout(timer);controller.signal.removeEventListener('abort',cancel);}};
  try {if(preserve){const prior=await call('/api/uat-detail-read',request);if(prior.state==='partial')setReport({detail:prior.detail,computedAt:prior.computedAt,selection});else if(prior.state!=='unavailable')throw Error('unavailable');}
   const started=await call('/api/uat-detail-refresh',request);let ready=started.state==='completed';
   for(let i=0;!ready&&i<4;i++){if(!started.jobId)break;await new Promise<void>((resolve,reject)=>{const t=setTimeout(resolve,2000);controller.signal.addEventListener('abort',()=>{clearTimeout(t);reject(Error('aborted'));},{once:true});});
    const status=await call('/api/uat-detail-status',started.jobId);if(status.needsAttention)break;ready=status.state==='partial';if(['failed','invalidated'].includes(status.state))break;}
   if(!ready){setMessage('Update is still pending or needs attention.');return;}
   const view=await call('/api/uat-detail-read',request);if(view.state!=='partial')throw Error('unavailable');setReport({detail:view.detail,computedAt:view.computedAt,selection});setMessage('Partial report loaded; source freshness is unknown.');
  }catch(error){if(!controller.signal.aborted){setReport(null);setMessage('Report refresh is unavailable.');const status=(error as {status?:number})?.status;
   if(preserve && status!==401 && status!==403){try{const prior=await call('/api/uat-detail-read',request);if(prior.state==='partial' && !controller.signal.aborted)setReport({detail:prior.detail,computedAt:prior.computedAt,selection});}catch{/* Keep unavailable if authorization or proof cannot be revalidated. */}}
  }}finally{if(active.current===controller)active.current=null;}
 }
 useEffect(()=>{if(!enabled || !autoReload || reloadConsumed)return;const timer=setTimeout(()=>{if(!reloadConsumed){reloadConsumed=true;void run(true);}},0);return ()=>clearTimeout(timer);},[enabled,autoReload,selection]);
 return <section><button type="button" disabled={!enabled} onClick={()=>void run()}>Refresh UAT agent activity</button><p>A recent report may be reused. Newly recorded activity can take time to reach the export, and source freshness is unknown.</p><p role="status">{message}</p>{enabled && report?.selection===selection && <UatPartialDetail detail={report.detail} computedAt={report.computedAt}/>}</section>;
}

