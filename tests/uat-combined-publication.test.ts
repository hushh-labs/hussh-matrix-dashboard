import { expect, it } from 'vitest';
import { digest } from '../src/server/reports/contracts';
import { prepareUatCombinedDetail } from '../src/server/reports/uat-combined-detail';
import { validateUatCombinedPublication } from '../src/server/reports/uat-combined-publication';
const now=Date.parse('2026-11-19T12:00:00Z'), scopeDigest='a'.repeat(64),job={id:'b'.repeat(64),key:'c'.repeat(64),acceptedAt:now-1000,
 control:{scopeDigest},request:{reportId:'one.agent-detail-uat',startDate:'2026-11-18',endDate:'2026-11-18',timezone:'UTC'}} as any;
function fixture(){
 const proof={feature:{parentId:job.id,role:'feature',manifestDigest:'d'.repeat(64),policyDigest:'e'.repeat(64)},location:{parentId:job.id,role:'location',manifestDigest:'d'.repeat(64),policyDigest:'e'.repeat(64)}};
 const rows:unknown[]=[], feature={role:'feature',rows,rowDigest:digest(rows),proofDigest:digest(proof.feature),manifestDigest:'d'.repeat(64),policyDigest:'e'.repeat(64)},
  location={...feature,role:'location',proofDigest:digest(proof.location)};
 const detail=prepareUatCombinedDetail(feature,location,{scopeDigest,period:{startDate:job.request.startDate,endDate:job.request.endDate,timezone:'UTC'}});
 const draft={schema:1,kind:'uat-combined-draft',parentId:job.id,key:job.key,request:job.request,control:job.control,servicePolicyDigest:'f'.repeat(64),computedAt:now,...detail};
 const publication={schema:1,kind:'uat-combined',id:job.id,key:job.key,request:job.request,control:job.control,servicePolicyDigest:draft.servicePolicyDigest,
  draftDigest:digest(draft),computedAt:now,publishedAt:now,...detail};return {proof,draft,publication};
}
it('binds a partial UAT publication to both same-parent authoritative proofs and draft',()=>{
 const f=fixture();expect(validateUatCombinedPublication(f.publication,f.draft,f.proof,job,now,900000)).toMatchObject({coverage:'partial',freshness:'unknown'});
});
it('rejects proof, row, scope, time and draft drift',()=>{
 const f=fixture();
 expect(()=>validateUatCombinedPublication(f.publication,f.draft,{...f.proof,feature:{...f.proof.feature,parentId:'9'.repeat(64)}},job,now,900000)).toThrow();
 expect(()=>validateUatCombinedPublication({...f.publication,rowDigests:{...f.publication.rowDigests,feature:'9'.repeat(64)}},f.draft,f.proof,job,now,900000)).toThrow();
 expect(()=>validateUatCombinedPublication(f.publication,{...f.draft,computedAt:now-1},f.proof,job,now,900000)).toThrow();
 expect(()=>validateUatCombinedPublication(f.publication,f.draft,f.proof,{...job,control:{scopeDigest:'9'.repeat(64)}},now,900000)).toThrow();
 expect(()=>validateUatCombinedPublication({...f.publication,publishedAt:now+1},f.draft,f.proof,job,now,900000)).toThrow();
});
