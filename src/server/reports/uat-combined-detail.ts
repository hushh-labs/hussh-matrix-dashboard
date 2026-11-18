import { digest, ReportError } from './contracts';
import { adaptUatFeatureRows } from './uat-feature-rows';
import { mergeUatLocationFeatures } from './uat-location-feature-rows';

/** Internal composition shape only. The caller must compare both proof and
 * policy digests against authoritative records in its publication transaction. */
export function prepareUatCombinedDetail(feature:{role:string;rows:unknown;rowDigest:string;proofDigest:string;manifestDigest:string;policyDigest:string},
  location:{role:string;rows:unknown;rowDigest:string;proofDigest:string;manifestDigest:string;policyDigest:string},
  expected:{scopeDigest:string;period:{startDate:string;endDate:string;timezone:string}}) {
  const hash=(v:unknown)=>typeof v==='string' && /^[a-f0-9]{64}$/.test(v);
  if (!feature || !location || feature.role!=='feature' || location.role!=='location'
    || !hash(feature.rowDigest) || !hash(location.rowDigest) || feature.rowDigest!==digest(feature.rows) || location.rowDigest!==digest(location.rows)
    || !hash(feature.proofDigest) || !hash(location.proofDigest) || feature.proofDigest===location.proofDigest
    || !hash(feature.manifestDigest) || feature.manifestDigest!==location.manifestDigest
    || !hash(feature.policyDigest) || feature.policyDigest!==location.policyDigest) throw new ReportError('invalid');
  const detail=mergeUatLocationFeatures(adaptUatFeatureRows(feature.rows,expected),location.rows);
  return {coverage:'partial' as const, freshness:'unknown' as const, manifestDigest:feature.manifestDigest,
    policyDigest:feature.policyDigest,proofDigests:{feature:feature.proofDigest,location:location.proofDigest},
    rowDigests:{feature:feature.rowDigest,location:location.rowDigest},detail};
}
