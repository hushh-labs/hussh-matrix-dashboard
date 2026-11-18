import { digest, ReportError } from './contracts';
import { uatFeatureManifest } from './uat-feature-manifest';
import { buildUatLocationPlan, type buildUatFeaturePlan } from '../uat-one-feature-plan';
import { BIGQUERY_COST_LIMITS } from '../bigquery-cost-limits';
import { validateUatDetailPolicy } from './staged-uat-detail-query';

/** Proposal only: approval and the two independent canonical reservations are
 * external requirements. The two native jobs must never share an intent ID. */
export function uatTwoSourceManifest(config:Parameters<typeof buildUatFeaturePlan>[0], scopeDigest:string, sourceGeneration:string) {
  if (!/^[a-f0-9]{64}$/.test(scopeDigest) || !/^[a-f0-9]{64}$/.test(sourceGeneration)) throw new ReportError('invalid');
  const feature=uatFeatureManifest(config), location=buildUatLocationPlan(config);
  if (location.queryHash===feature.manifest.queryHash) throw new ReportError('invalid');
  const manifest=Object.freeze({schema:1,kind:'uat-feature-and-location',environment:'uat',scopeDigest,sourceGeneration,
    featureManifestDigest:feature.manifestDigest,featureQueryHash:feature.manifest.queryHash,locationQueryHash:location.queryHash,
    startDate:location.startDate,endDate:location.endDate,timezone:location.timezone});
  return {manifest,manifestDigest:digest(manifest)};
}
export function uatTwoSourceChildIds(jobId:string, manifestDigest:string) {
  if (!/^[a-f0-9]{64}$/.test(jobId) || !/^[a-f0-9]{64}$/.test(manifestDigest)) throw new ReportError('invalid');
  return {feature:digest(['uat-detail-child-v1',jobId,manifestDigest,'feature']),location:digest(['uat-detail-child-v1',jobId,manifestDigest,'location'])};
}

/** Validates two independently bounded policies against one approved manifest.
 * Validation is not reservation: each child must reserve in the canonical ledger. */
export function validateUatTwoSourcePolicies(value:unknown, now:number, recovery=false) {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new ReportError('unavailable');
  const v=value as any;
  if (Object.keys(v).sort().join()!=='approved,config,enabled,feature,location,manifestDigest,scopeDigest,sourceGeneration'
    || v.approved!==true || v.enabled!==true) throw new ReportError('unavailable');
  const binding=uatTwoSourceManifest(v.config,v.scopeDigest,v.sourceGeneration);
  if (binding.manifestDigest!==v.manifestDigest) throw new ReportError('unavailable');
  const feature=validateUatDetailPolicy(v.feature,now,recovery), location=validateUatDetailPolicy(v.location,now,recovery), m=binding.manifest;
  if (feature.queryHash!==m.featureQueryHash || location.queryHash!==m.locationQueryHash
    || [feature,location].some(p=>p.scopeDigest!==m.scopeDigest || p.sourceGeneration!==m.sourceGeneration
      || p.environment!=='uat' || p.startDate!==m.startDate || p.endDate!==m.endDate || p.timezone!==m.timezone)
    || feature.maxBytes+location.maxBytes>BIGQUERY_COST_LIMITS.bytesPerUtcDay) throw new ReportError('unavailable');
  return { ...binding, feature, location };
}
