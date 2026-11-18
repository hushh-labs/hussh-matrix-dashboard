import { digest, ReportError, type ReportJob } from './contracts';
import { validateOneAgentDetail } from './one-agent-detail-contract';

/** Validates a proposed combined envelope against independently loaded,
 * authoritative draft/proofs. A caller must also check current authority,
 * approved policy and the published head in its own transaction. */
export function validateUatCombinedPublication(value:unknown, draft:any, proofs:{feature:any;location:any}, job:ReportJob, now:number, maxBytes:number) {
  const fail=()=>{throw new ReportError('unavailable');};
  if (!value || typeof value!=='object' || Array.isArray(value) || !draft || !proofs?.feature || !proofs?.location) return fail();
  const p=value as any;
  if (Object.keys(p).sort().join()!=='computedAt,control,coverage,detail,draftDigest,freshness,id,key,kind,manifestDigest,policyDigest,proofDigests,publishedAt,request,rowDigests,schema,servicePolicyDigest'
    || p.schema!==1 || p.kind!=='uat-combined' || p.coverage!=='partial' || p.freshness!=='unknown' || p.id!==job.id || p.key!==job.key
    || String(job.request.reportId)!=='one.agent-detail-uat' || digest(p.request)!==digest(job.request) || digest(p.control)!==digest(job.control)
    || !Number.isSafeInteger(now) || !Number.isSafeInteger(p.computedAt) || !Number.isSafeInteger(p.publishedAt)
    || p.computedAt<job.acceptedAt || p.computedAt>p.publishedAt || p.publishedAt>now
    || !Number.isSafeInteger(maxBytes) || maxBytes<1 || Buffer.byteLength(JSON.stringify(p))>maxBytes
    || draft.schema!==1 || draft.kind!=='uat-combined-draft' || draft.parentId!==job.id || draft.key!==job.key
    || digest(draft.request)!==digest(job.request) || digest(draft.control)!==digest(job.control) || p.draftDigest!==digest(draft)
    || p.computedAt!==draft.computedAt || p.manifestDigest!==draft.manifestDigest || p.policyDigest!==draft.policyDigest
    || p.servicePolicyDigest!==draft.servicePolicyDigest || digest(p.detail)!==digest(draft.detail)
    || digest(p.proofDigests)!==digest(draft.proofDigests) || digest(p.rowDigests)!==digest(draft.rowDigests)) return fail();
  for(const role of ['feature','location'] as const) {
    const proof=proofs[role];
    if (proof.parentId!==job.id || proof.role!==role || proof.manifestDigest!==p.manifestDigest || proof.policyDigest!==p.policyDigest
      || digest(proof)!==p.proofDigests?.[role] || typeof p.rowDigests?.[role]!=='string' || !/^[a-f0-9]{64}$/.test(p.rowDigests[role])) return fail();
  }
  if (p.proofDigests.feature===p.proofDigests.location) return fail();
  const detail=validateOneAgentDetail(p.detail,{environment:'uat',scopeDigest:job.control.scopeDigest,
    period:{startDate:job.request.startDate,endDate:job.request.endDate,timezone:job.request.timezone}});
  if (detail.source.checkedAt!==null || detail.source.watermark!==null || detail.source.coverage!=='intraday_or_unknown') return fail();
  return p;
}
