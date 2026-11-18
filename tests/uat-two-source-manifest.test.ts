import { expect, it } from 'vitest';
import { uatTwoSourceChildIds, uatTwoSourceManifest, validateUatTwoSourcePolicies } from '../src/server/reports/uat-two-source-manifest';
const config={project:'hushh-pda-uat',dataset:'analytics_533362555',webHost:'uat.one.hushh.ai',timezone:'UTC',startDate:'2026-11-18',endDate:'2026-11-18',maxPeriodDays:7};
it('binds both distinct queries and scope to separate deterministic child identities',()=>{
 const scope='a'.repeat(64), generation='b'.repeat(64), job='c'.repeat(64);
 const {manifest,manifestDigest}=uatTwoSourceManifest(config,scope,generation), ids=uatTwoSourceChildIds(job,manifestDigest);
 expect(manifest.featureQueryHash).not.toBe(manifest.locationQueryHash); expect(ids.feature).not.toBe(ids.location);
 expect(uatTwoSourceChildIds(job,manifestDigest)).toEqual(ids);
 expect(uatTwoSourceManifest({...config,startDate:'2026-11-17'},scope,generation).manifestDigest).not.toBe(manifestDigest);
 expect(uatTwoSourceManifest(config,'d'.repeat(64),generation).manifestDigest).not.toBe(manifestDigest);
 expect(()=>uatTwoSourceManifest({...config,project:'hushh-ai-prod'},scope,generation)).toThrow();
});
it('requires two separately approved, manifest-matching query policies',()=>{
 const now=Date.parse('2026-11-19T00:00:00Z'),scopeDigest='a'.repeat(64),sourceGeneration='b'.repeat(64);
 const {manifest,manifestDigest}=uatTwoSourceManifest(config,scopeDigest,sourceGeneration);
 const base={approved:true,enabled:true,environment:'uat',project:'hushh-ai-prod',location:'US',referenceDigest:'c'.repeat(64),scopeDigest,sourceGeneration,
  startDate:config.startDate,endDate:config.endDate,timezone:'UTC',expiresAt:now+1000,maxBytes:1000};
 const policy={approved:true,enabled:true,config,scopeDigest,sourceGeneration,manifestDigest,
  feature:{...base,queryHash:manifest.featureQueryHash},location:{...base,queryHash:manifest.locationQueryHash}};
 expect(validateUatTwoSourcePolicies(policy,now).manifestDigest).toBe(manifestDigest);
 expect(()=>validateUatTwoSourcePolicies({...policy,location:{...policy.location,queryHash:manifest.featureQueryHash}},now)).toThrow();
 expect(()=>validateUatTwoSourcePolicies({...policy,feature:{...policy.feature,enabled:false}},now)).toThrow();
 expect(()=>validateUatTwoSourcePolicies(policy,now+1000)).toThrow();
});
