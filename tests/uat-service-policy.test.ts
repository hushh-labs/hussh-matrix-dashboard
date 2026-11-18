import { expect, it } from 'vitest';
import { validateUatServicePolicy } from '../src/server/reports/uat-service-policy';
import { uatTwoSourceManifest } from '../src/server/reports/uat-two-source-manifest';
it('requires an approved UAT manifest, matching scope, source and fixed service identity',()=>{
 const now=Date.parse('2026-11-19T00:00:00Z'),scopeDigest='a'.repeat(64),sourceGeneration='b'.repeat(64);
 const config={project:'hushh-pda-uat',dataset:'analytics_533362555',webHost:'uat.one.hushh.ai',timezone:'UTC',startDate:'2026-11-18',endDate:'2026-11-18',maxPeriodDays:7};
 const {manifest,manifestDigest}=uatTwoSourceManifest(config,scopeDigest,sourceGeneration);
 const base={approved:true,enabled:true,environment:'uat',project:'hushh-ai-prod',location:'US',referenceDigest:'c'.repeat(64),scopeDigest,sourceGeneration,startDate:config.startDate,endDate:config.endDate,timezone:'UTC',expiresAt:now+1000,maxBytes:1000};
 const source={approved:true,enabled:true,config,scopeDigest,sourceGeneration,manifestDigest,feature:{...base,queryHash:manifest.featureQueryHash},location:{...base,queryHash:manifest.locationQueryHash}};
 const policy={approved:true,enabled:true,expiresAt:now+1000,manifestDigest,scopeDigest,sourceGeneration,reportingProject:'project-test',reportingDatabase:'metrics-reporting',workerAudience:'https://detail-worker.run.app',taskInvoker:'metrics-report-task-invoker@project-test.iam.gserviceaccount.com',webInvoker:'metrics-report-web@project-test.iam.gserviceaccount.com',queueParent:'projects/project-test/locations/us-central1/queues/metrics-uat-detail-manual',rpcTimeoutMs:1000,maxResponseBytes:10000};
 expect(validateUatServicePolicy(policy,source,now)).toMatchObject({manifestDigest});
 for(const change of [{enabled:false},{scopeDigest:'d'.repeat(64)},{taskInvoker:'other@example.com'},{workerAudience:'https://evil.example.com'}])
  expect(()=>validateUatServicePolicy({...policy,...change},source,now)).toThrow();
 expect(()=>validateUatServicePolicy(policy,{...source,enabled:false},now)).toThrow();
});

