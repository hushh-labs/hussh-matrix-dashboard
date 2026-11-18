import { expect, it, vi } from 'vitest';
import { UatDetailDispatcher, UatDetailExecutor } from '../src/server/reports/uat-detail-executor';
const config={enabled:true,audience:'https://detail-worker.run.app',taskEmail:'metrics-report-task-invoker@project-test.iam.gserviceaccount.com'};
const job={id:'a'.repeat(64),request:{reportId:'one.agent-detail-uat'},lane:'custom'} as any;
const signal=()=>new AbortController().signal;
function fixture(enabled=true) {
 const verify=vi.fn(async()=>({email:config.taskEmail,emailVerified:true}));
 const claims={inspect:vi.fn(async()=>job),claim:vi.fn(async()=>({job,recoverOnly:false})),uncertain:vi.fn(async()=>{})};
 const worker={advance:vi.fn(async(_job:any,_signal:AbortSignal,_recoverOnly:boolean)=>({state:'complete',proof:{}}))}, partial={publish:vi.fn(async()=>({state:'partial',id:job.id}))};
 const lifecycle={complete:vi.fn(async()=>({state:'partial',id:job.id}))}, accessFor=vi.fn(async()=>({subjectHash:'b'.repeat(64),scopeDigest:'c'.repeat(64)}));
 return {verify,claims,worker,partial,lifecycle,accessFor,executor:new UatDetailExecutor({...config,enabled},verify,claims as any,worker as any,partial as any,lifecycle as any,accessFor)};
}
it('is default closed and rejects unverified identity before job access',async()=>{
 const f=fixture(false); await expect(f.executor.execute('token',job.id,signal())).rejects.toThrow(); expect(f.verify).not.toHaveBeenCalled();
 const g=fixture(); g.verify.mockResolvedValue({email:'other@example.com',emailVerified:true});
 await expect(g.executor.execute('token',job.id,signal())).rejects.toThrow('unauthorized'); expect(g.claims.inspect).not.toHaveBeenCalled();
});
it('dispatcher checks its own identity and fixed UAT job before queue delivery',async()=>{
 const dispatcherEmail='metrics-report-dispatcher@project-test.iam.gserviceaccount.com';
 const verify=vi.fn(async()=>({email:dispatcherEmail,emailVerified:true})), inspect=vi.fn(async()=>job), deliver=vi.fn(async()=>({state:'delayed' as const}));
 const d=new UatDetailDispatcher({enabled:true,audience:config.audience,dispatcherEmail},verify,{inspect} as any,{deliver});
 expect(await d.deliver('token',job.id,signal())).toEqual({state:'delayed'}); expect(deliver).toHaveBeenCalledOnce();
 verify.mockResolvedValue({email:'other@example.com',emailVerified:true});
 await expect(d.deliver('token',job.id,signal())).rejects.toThrow('unauthorized'); expect(deliver).toHaveBeenCalledOnce();
});
it('completes only a fixed UAT job and retains uncertain failures',async()=>{
 const f=fixture(); await expect(f.executor.execute('token',job.id,signal())).resolves.toMatchObject({state:'partial'});
 expect(f.partial.publish).toHaveBeenCalledOnce(); expect(f.lifecycle.complete).toHaveBeenCalledOnce();
 const g=fixture(); g.worker.advance.mockRejectedValue(new Error('lost acknowledgement'));
 await expect(g.executor.execute('token',job.id,signal())).rejects.toThrow(); expect(g.claims.uncertain).toHaveBeenCalledOnce(); expect(g.lifecycle.complete).not.toHaveBeenCalled();
 const u=fixture(); (u.worker.advance as any).mockResolvedValue({state:'uncertain'});
 await expect(u.executor.execute('token',job.id,signal())).rejects.toThrow(); expect(u.worker.advance).toHaveBeenCalledOnce(); expect(u.claims.uncertain).toHaveBeenCalledOnce();
 const h=fixture(); h.claims.inspect.mockResolvedValue({...job,request:{reportId:'one.adoption'}} as any);
 await expect(h.executor.execute('token',job.id,signal())).rejects.toThrow(); expect(h.claims.claim).not.toHaveBeenCalled();
 const r=fixture(); r.claims.claim.mockResolvedValue({job,recoverOnly:true});
 await r.executor.execute('token',job.id,signal()); expect(r.worker.advance.mock.calls[0][2]).toBe(true);
});
