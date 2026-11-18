import { ReportError } from './contracts';
import { validateOneAgentDetail, type OneAgentDetailV1 } from './one-agent-detail-contract';

/** Disconnected proposed result variant. Validation cannot establish source
 * authority, native job status, billing or publication; those require the
 * existing job/worker fences and a future reviewed BigQuery integration. */
export type ProposedOneDetailJob = { environment:'production' | 'uat'; reportScopeDigest:string; manifestScopeDigest:string;
  sourceGeneration:string; definitionVersion:'1'; acceptedAt:number;
  period:{startDate:string;endDate:string;timezone:string} };
export type ProposedOneDetailResult = { definitionVersion:'1'; sourceGeneration:string; manifestScopeDigest:string;
  computedAt:number; detail:OneAgentDetailV1 };
export function validateProposedOneDetailResult(value:unknown, job:ProposedOneDetailJob, now:number, maxBytes:number): ProposedOneDetailResult {
  const fail = () => { throw new ReportError('invalid'); };
  if (!job || !['production','uat'].includes(job.environment) || job.definitionVersion !== '1'
    || !/^[a-f0-9]{64}$/.test(job.reportScopeDigest) || !/^[a-f0-9]{64}$/.test(job.manifestScopeDigest)
    || !/^[a-f0-9]{64}$/.test(job.sourceGeneration) || !Number.isSafeInteger(job.acceptedAt) || job.acceptedAt < 0
    || !Number.isSafeInteger(now) || now < job.acceptedAt || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 900_000
    || !value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join() !== 'computedAt,definitionVersion,detail,manifestScopeDigest,sourceGeneration') return fail();
  const result=value as ProposedOneDetailResult;
  if (result.definitionVersion !== job.definitionVersion || result.sourceGeneration !== job.sourceGeneration
    || result.manifestScopeDigest !== job.manifestScopeDigest || !Number.isSafeInteger(result.computedAt)
    || result.computedAt < job.acceptedAt || result.computedAt > now) return fail();
  const detail=validateOneAgentDetail(result.detail, {environment:job.environment,scopeDigest:job.reportScopeDigest,period:job.period});
  // The actual legacy source has no verified source check or event watermark.
  if (detail.source.checkedAt !== null || detail.source.watermark !== null || Buffer.byteLength(JSON.stringify(value)) > maxBytes) return fail();
  return result;
}
