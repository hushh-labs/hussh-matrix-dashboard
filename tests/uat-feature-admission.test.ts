import { expect, it } from 'vitest';
import { digest } from '../src/server/reports/contracts';
import { MetricsReports } from '../src/server/reports/service';
import { uatFeatureManifest } from '../src/server/reports/uat-feature-manifest';
import { collectionFixture } from './helpers/metrics-collection-fixture';
import { adaptUatFeatureRows } from '../src/server/reports/uat-feature-rows';

it('admits only an explicitly enabled and approved UAT feature scope and coalesces clicks',async()=>{
  const f=collectionFixture(); await f.initialize();
  const request={reportId:'one.agent-detail-uat',startDate:'2026-11-11',endDate:'2026-11-12',timezone:'UTC'};
  const config={project:'hushh-pda-uat',dataset:'analytics_533362555',webHost:'uat.one.hushh.ai',timezone:'UTC',
    startDate:request.startDate,endDate:request.endDate,maxPeriodDays:7};
  const {manifest,manifestDigest}=uatFeatureManifest(config);
  const source={approved:true,enabled:true,environment:'uat',project:'hushh-ai-prod',location:'US',queryHash:manifest.queryHash,
    referenceDigest:digest('references'),sourceGeneration:f.control.sourceGeneration,scopeDigest:f.access.scopeDigest,
    startDate:request.startDate,endDate:request.endDate,timezone:'UTC',expiresAt:f.clock()+1000,maxBytes:1000};
  await f.put('controls',request.reportId,f.control); await f.put('policy','one-agent-detail-bq',source);
  await f.put('policy','one-agent-detail-manifest',{approved:true,enabled:true,config,manifestDigest});
  await expect(f.reports.request(request,f.access)).rejects.toMatchObject({code:'unavailable'});
  const reports=new MetricsReports(f.store,f.clock,undefined,true);
  const first=await reports.request(request,f.access); expect(first.state).toBe('accepted');
  expect((await reports.request(request,f.access)).jobId).toBe(first.jobId);
  expect((await reports.status(first.jobId!,f.access)).state).toBe('accepted');
  await expect(reports.read(request,f.access)).rejects.toMatchObject({code:'unavailable'});
  await expect(reports.requestScheduled(request,f.access)).rejects.toMatchObject({code:'unavailable'});
  const job=await f.get<any>('jobs',first.jobId!); const proof={binding:digest('proof'),policyDigest:digest(source)};
  const payload=adaptUatFeatureRows([],{scopeDigest:f.access.scopeDigest,period:{startDate:request.startDate,endDate:request.endDate,timezone:request.timezone}});
  const snapshot={schema:1,kind:'uat-feature-subset',coverage:'partial',computedAt:f.clock(),binding:digest([job.id,job.key,job.request,job.control,digest(source),digest(proof)]),detail:payload};
  await f.put('jobs',job.id,{...job,status:'completed',completedAt:f.clock()});
  await f.put('heads',job.key,{sequence:1,activeJob:null,publication:job.id});
  await f.put('uatDetailIntents',job.id,{state:'complete',jobId:job.id,binding:proof.binding,policyDigest:proof.policyDigest});
  await f.put('uatDetailNativeProofs',job.id,proof); await f.put('uatDetailPartialSnapshots',job.id,snapshot);
  await f.put('uatDetailPublications',job.id,{schema:1,id:job.id,key:job.key,kind:'uat-feature-subset',coverage:'partial',request:job.request,
    control:job.control,manifestDigest,sourcePolicyDigest:digest(source),proofDigest:digest(proof),computedAt:f.clock(),publishedAt:f.clock(),detail:payload});
  expect((await reports.status(job.id,f.access)).state).toBe('completed');
  await f.put('uatDetailNativeProofs',job.id,{...proof,binding:digest('forged')});
  await expect(reports.status(job.id,f.access)).rejects.toMatchObject({code:'unavailable'});
  await f.put('uatDetailNativeProofs',job.id,proof); f.advance(1001);
  expect((await reports.status(job.id,f.access)).state).toBe('completed'); // expiry fences new work, not retained reads
  await f.put('policy','one-agent-detail-manifest',{approved:true,enabled:true,config,manifestDigest:'0'.repeat(64)});
  await expect(reports.request(request,f.access)).rejects.toMatchObject({code:'unavailable'});
});
