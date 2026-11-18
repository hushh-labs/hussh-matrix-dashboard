import { expect, it } from 'vitest';
import { prepareUatCombinedDetail } from '../src/server/reports/uat-combined-detail';
import { digest } from '../src/server/reports/contracts';
const expected={scopeDigest:'a'.repeat(64),period:{startDate:'2026-11-18',endDate:'2026-11-18',timezone:'UTC'}};
const featureRows:unknown[]=[], locationRows=[{scope:'feature',metricKey:'sms_safety',users:1,events:2,successes:0,expectedErrors:0,failures:1}];
const feature={role:'feature',rows:featureRows,rowDigest:digest(featureRows),proofDigest:'b'.repeat(64),manifestDigest:'d'.repeat(64),policyDigest:'e'.repeat(64)};
const location={role:'location',rows:locationRows,rowDigest:digest(locationRows),proofDigest:'c'.repeat(64),manifestDigest:feature.manifestDigest,policyDigest:feature.policyDigest};
it('keeps role-specific evidence and labels the composed subset partial with unknown freshness',()=>{
 const value=prepareUatCombinedDetail(feature,location,expected);
 expect(value).toMatchObject({coverage:'partial',freshness:'unknown',proofDigests:{feature:feature.proofDigest,location:location.proofDigest}});
 expect(value.detail.rows.find(row=>row.key==='sms_safety')).toMatchObject({state:'measured',counts:{signals:2,accounts:null}});
 expect(value.detail.source.watermark).toBeNull();
});
it('rejects crossed roles, mismatched manifest/policy and reused proof identity',()=>{
 for(const change of [{role:'feature'},{manifestDigest:'9'.repeat(64)},{policyDigest:'9'.repeat(64)},{proofDigest:feature.proofDigest},{rowDigest:'9'.repeat(64)}])
  expect(()=>prepareUatCombinedDetail(feature,{...location,...change},expected)).toThrow();
});
