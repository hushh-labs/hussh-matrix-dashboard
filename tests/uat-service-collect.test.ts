import { afterEach, expect, it, vi } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { createServiceOwnedUatRuntime } from '../src/server/bigquery-cost-control';
import { digest, reportKey } from '../src/server/reports/contracts';
import { reportPath } from '../src/server/reports/store';
import { uatTwoSourceManifest, uatTwoSourceChildIds } from '../src/server/reports/uat-two-source-manifest';
const fake=vi.hoisted(()=>({docs:new Map<string,any>(),budgetDocs:new Map<string,any>(),tails:new Map<string,Promise<void>>(),paidEvidence:[] as boolean[],onGet:vi.fn(),construct:vi.fn(),create:vi.fn(),getTables:vi.fn(),metadata:vi.fn(),rows:vi.fn(),verify:vi.fn(),terminate:vi.fn()}));
vi.mock('google-auth-library',()=>({OAuth2Client:class {verifyIdToken=fake.verify;}}));
vi.mock('@google-cloud/firestore',()=>({Firestore:class {
 private database:string;constructor(options:any){this.database=options.databaseId;}
 doc(path:string){return {path,collection:(name:string)=>({doc:(id:string)=>({path:`${path}/${name}/${id}`})})};}
 terminate=fake.terminate;
 async runTransaction(fn:any){const prior=fake.tails.get(this.database)??Promise.resolve();let release!:()=>void;fake.tails.set(this.database,new Promise<void>(resolve=>{release=resolve;}));await prior;
  try {const data=new Map(this.database==='one-plg-production'?fake.budgetDocs:fake.docs);const snap=(ref:any)=>{fake.onGet(ref.path,data);return {exists:data.has(ref.path),data:()=>data.get(ref.path)};};
   const result=await fn({get:async(ref:any)=>snap(ref),getAll:async(...refs:any[])=>refs.map(snap),
    create:(ref:any,value:any)=>{if(data.has(ref.path))throw Error('exists');data.set(ref.path,value);},set:(ref:any,value:any)=>data.set(ref.path,value),delete:(ref:any)=>data.delete(ref.path)});
   if(this.database==='one-plg-production')fake.budgetDocs=data;else fake.docs=data;return result;} finally {release();}}
}}));
vi.mock('@google-cloud/bigquery',()=>({BigQuery:class {
 constructor(options:unknown){fake.construct(options);} createQueryJob=fake.create;dataset(){return {getTables:fake.getTables};}
 job(id:string){return {getMetadata:()=>fake.metadata(id),getQueryResults:fake.rows};}
}}));
afterEach(()=>{vi.unstubAllEnvs();fake.docs.clear();vi.clearAllMocks();});
function setup() {
 fake.docs.clear();fake.budgetDocs.clear();fake.tails.clear();fake.paidEvidence=[];fake.onGet.mockReset();fake.create.mockReset();fake.getTables.mockReset();fake.metadata.mockReset();fake.rows.mockReset();fake.construct.mockClear();
 const now=Date.now(),scopeDigest='a'.repeat(64),sourceGeneration='b'.repeat(64);
 const config={project:'hushh-pda-uat',dataset:'analytics_533362555',webHost:'uat.one.hushh.ai',timezone:'UTC',startDate:'2026-11-18',endDate:'2026-11-18',maxPeriodDays:7};
 const {manifest,manifestDigest}=uatTwoSourceManifest(config,scopeDigest,sourceGeneration);
 const refs=[{projectId:config.project,datasetId:config.dataset,tableId:'INFORMATION_SCHEMA.TABLES'},{projectId:config.project,datasetId:config.dataset,tableId:'events_*'}].sort((a,b)=>a.tableId.localeCompare(b.tableId));
 const referenceDigest=createHash('sha256').update(JSON.stringify({refs,catalog:[{id:'events_20261118',type:'TABLE'}]})).digest('hex');
 const base={approved:true,enabled:true,environment:'uat',project:'hushh-ai-prod',location:'US',referenceDigest,scopeDigest,sourceGeneration,startDate:config.startDate,endDate:config.endDate,timezone:'UTC',expiresAt:now+60000,maxBytes:30*1024**2};
 const source={approved:true,enabled:true,config,scopeDigest,sourceGeneration,manifestDigest,feature:{...base,queryHash:manifest.featureQueryHash},location:{...base,queryHash:manifest.locationQueryHash}};
 const tuple={reportingProject:'hushh-ai-prod',reportingDatabase:'metrics-reports',workerAudience:'https://detail-worker.run.app',taskInvoker:'metrics-report-task-invoker@hushh-ai-prod.iam.gserviceaccount.com',webInvoker:'metrics-report-web@hushh-ai-prod.iam.gserviceaccount.com',queueParent:'projects/hushh-ai-prod/locations/us-central1/queues/metrics-uat-detail-manual',rpcTimeoutMs:1000,maxResponseBytes:10000};
 const service={approved:true,enabled:true,expiresAt:now+180000,manifestDigest,scopeDigest,sourceGeneration,...tuple};
 const global={approved:true,computeEnabled:true,quotaWindowMs:60000,readRequests:10,statusRequests:10,computeRequests:10,customCapacity:2,scheduledCapacity:0,customPerSubjectCapacity:1,maxPeriodDays:90,leaseMs:30000,jobLifetimeMs:120000,maxSnapshotBytes:900000};
 const control={enabled:true,revision:1,scopeDigest,sourceGeneration,definitionVersion:'1',freshnessMs:1000,staleMs:120000};
 const job={id:'c'.repeat(64),key:'',request:{reportId:'one.agent-detail-uat' as const,startDate:config.startDate,endDate:config.endDate,timezone:'UTC'},control,lane:'custom',requesterHash:'e'.repeat(64),status:'accepted',acceptedAt:now,startedAt:null,completedAt:null,expiresAt:now+120000,fence:0,leaseUntil:0,nextAttemptAt:0,needsAttention:false,workerHash:null,providerJobId:'metrics_report_'+'c'.repeat(64),dispatchIntent:true,sourceStarted:false};
 job.key=reportKey(job.request,control);
 for(const [c,id,v] of [['policy','current',global],['policy','one-agent-detail-service',service],['policy','one-agent-detail-two-source',source],['controls','one.agent-detail-uat',control],['jobs',job.id,job],['heads',job.key,{sequence:1,activeJob:job.id,publication:null}],['capacity','custom',{active:1}],['subjectCapacity',digest(['custom',job.requesterHash]),{active:1}]] as any[])fake.docs.set(reportPath(c,id),v);
 for(const [name,value] of Object.entries({METRICS_UAT_SERVICE_ENABLED:'true',METRICS_BIGQUERY_ENABLED:'true',METRICS_UAT_DETAIL_ENABLED:'true',METRICS_UAT_SERVICE_CONFIG:JSON.stringify(tuple)}))vi.stubEnv(name,value);
 fake.verify.mockResolvedValue({getPayload:()=>({iss:'https://accounts.google.com',email_verified:true,email:tuple.taskInvoker})});fake.terminate.mockResolvedValue(undefined);
 fake.getTables.mockResolvedValue([[{id:'events_20261118',metadata:{type:'TABLE'}}],null]);
 fake.create.mockImplementation(async(req:any)=>{if(!req.dryRun)throw Error('lost acknowledgement');return [{metadata:{jobReference:{projectId:'hushh-ai-prod',location:'US'},configuration:{query:{query:req.query,useLegacySql:false,useQueryCache:true}},statistics:{totalBytesProcessed:'0',query:{statementType:'SELECT',totalBytesProcessedAccuracy:'PRECISE',referencedTables:refs}}}}];});
 fake.metadata.mockRejectedValue(Object.assign(Error('missing'),{code:404}));
 return {job,source,manifestDigest,scopeDigest};
}
function successfulNative() {
 const dry=fake.create.getMockImplementation()!,jobs=new Map<string,any>();
 fake.create.mockImplementation(async(req:any)=>{if(req.dryRun)return dry(req);
  fake.paidEvidence.push([...fake.budgetDocs.keys()].filter(key=>key.startsWith('metricsQueryBudgetDays/') && key.includes('/reservations/')).length===2);
  jobs.set(req.jobId,{...req,endedAt:Date.now()});return [{}];});
 fake.metadata.mockImplementation(async(id:string)=>{const q=jobs.get(id);if(!q)throw Object.assign(Error('missing'),{code:404});
  return [{jobReference:{jobId:id,projectId:'hushh-ai-prod',location:'US'},configuration:{query:{query:q.query,useLegacySql:false,useQueryCache:true,maximumBytesBilled:q.maximumBytesBilled}},
   statistics:{endTime:String(q.endedAt),query:{statementType:'SELECT',totalBytesBilled:'1'}},status:{state:'DONE'}}];});
 fake.rows.mockResolvedValue([[],null]);return jobs;
}
it('holds capacity after a lost acknowledgement without issuing a second paid create',async()=>{
 const f=setup(),runtime=await createServiceOwnedUatRuntime();
 await expect(runtime.collect('token',f.job.id,new AbortController().signal)).rejects.toThrow();
 expect(fake.create.mock.calls.filter(call=>!call[0].dryRun)).toHaveLength(1);
 expect(fake.docs.get(reportPath('jobs',f.job.id))).toMatchObject({status:'delayed',needsAttention:true});
 expect(fake.docs.get(reportPath('capacity','custom'))).toEqual({active:1});
 await runtime.close();
});
it('competing worker requests cannot claim and dispatch the same job twice',async()=>{
 const f=setup(),one=await createServiceOwnedUatRuntime(),two=await createServiceOwnedUatRuntime();
 await Promise.allSettled([one.collect('token',f.job.id,new AbortController().signal),two.collect('token',f.job.id,new AbortController().signal)]);
 expect(fake.create.mock.calls.filter(call=>!call[0].dryRun)).toHaveLength(1);
 expect(fake.docs.get(reportPath('capacity','custom'))).toEqual({active:1});await one.close();await two.close();
});
it('reconciles an interrupted started job by lookup only and holds a missing native job',async()=>{
 const f=setup(),runtime=await createServiceOwnedUatRuntime();
 await expect(runtime.collect('token',f.job.id,new AbortController().signal)).rejects.toThrow();
 // Synthetic crash fixture: an expired lease with no operator-attention marker.
 const key=reportPath('jobs',f.job.id),held=fake.docs.get(key);
 fake.docs.set(key,{...held,needsAttention:false,leaseUntil:0});
 const before=fake.create.mock.calls.length,ledger=[...fake.budgetDocs.entries()];
 await expect(runtime.collect('token',f.job.id,new AbortController().signal)).rejects.toThrow();
 expect(fake.metadata).toHaveBeenCalledOnce();expect(fake.create).toHaveBeenCalledTimes(before);
 expect([...fake.budgetDocs.entries()]).toEqual(ledger);
 expect(fake.docs.get(reportPath('capacity','custom'))).toEqual({active:1});await runtime.close();
});
it('does not claim or invoke native work for a cancelled request',async()=>{
 const f=setup(),runtime=await createServiceOwnedUatRuntime(), controller=new AbortController();controller.abort();
 await expect(runtime.collect('token',f.job.id,controller.signal)).rejects.toThrow();
 expect(fake.create).not.toHaveBeenCalled();expect(fake.docs.get(reportPath('jobs',f.job.id))).toMatchObject({status:'accepted',fence:0});
 await runtime.close();
});
it.each(['METRICS_BIGQUERY_ENABLED','METRICS_UAT_DETAIL_ENABLED'] as const)('does no source work when %s closes',async flag=>{
 const f=setup(),runtime=await createServiceOwnedUatRuntime();vi.stubEnv(flag,'false');
 await expect(runtime.collect('token',f.job.id,new AbortController().signal)).rejects.toThrow();
 expect(fake.create).not.toHaveBeenCalled();expect(fake.docs.get(reportPath('jobs',f.job.id))).toMatchObject({status:'accepted',fence:0});await runtime.close();
});
it.each(['policy','lease'] as const)('rechecks %s after service authorization before dry-run',async fault=>{
 const f=setup(),servicePath=reportPath('policy','one-agent-detail-service'),jobPath=reportPath('jobs',f.job.id);let runningChecks=0;
 fake.onGet.mockImplementation((path:string,data:Map<string,any>)=>{
  if(path===servicePath && data.get(jobPath)?.status==='running' && ++runningChecks===2) {
   if(fault==='lease')data.set(jobPath,{...data.get(jobPath),leaseUntil:0});
   else data.set(reportPath('policy','one-agent-detail-two-source'),{...f.source,enabled:false});
  }
 });
 const runtime=await createServiceOwnedUatRuntime();await expect(runtime.collect('token',f.job.id,new AbortController().signal)).rejects.toThrow();
 expect(runningChecks).toBeGreaterThanOrEqual(2);expect(fake.create).not.toHaveBeenCalled();await runtime.close();
});
it.each(['feature','location'] as const)('rejects invalid %s dry-run source, precision and statement before paid work',async role=>{
 for(const fault of ['table','accuracy','statement']) {
  const f=setup(),dry=fake.create.getMockImplementation()!;
  fake.create.mockImplementation(async(req:any)=>{const result=await dry(req);if(req.dryRun && (req.query.includes("'feature_daily'")?'location':'feature')===role) {
   const q=result[0].metadata.statistics.query;
   if(fault==='table')q.referencedTables=[{projectId:'wrong-project',datasetId:'analytics_1',tableId:'events_*'}];
   if(fault==='accuracy')q.totalBytesProcessedAccuracy='UNKNOWN';if(fault==='statement')q.statementType='SCRIPT';
  } return result;});
  const runtime=await createServiceOwnedUatRuntime();await expect(runtime.collect('token',f.job.id,new AbortController().signal)).rejects.toThrow();
  expect(fake.create.mock.calls.filter(call=>!call[0].dryRun)).toHaveLength(0);expect(fake.docs.get(reportPath('capacity','custom'))).toEqual({active:1});await runtime.close();
 }
});
it('holds on a cycling catalog without paid create',async()=>{
 const f=setup();fake.getTables.mockResolvedValue([[{id:'events_20261118',metadata:{type:'TABLE'}}],{pageToken:'same'}]);
 const runtime=await createServiceOwnedUatRuntime();await expect(runtime.collect('token',f.job.id,new AbortController().signal)).rejects.toThrow();
 expect(fake.create.mock.calls.filter(call=>!call[0].dryRun)).toHaveLength(0);await runtime.close();
});
it('rejects an incomplete catalog without paid create',async()=>{
 const f=setup();fake.getTables.mockResolvedValue([[{id:'events_20261118',metadata:{}}],null]);
 const runtime=await createServiceOwnedUatRuntime();await expect(runtime.collect('token',f.job.id,new AbortController().signal)).rejects.toThrow();
 expect(fake.create.mock.calls.filter(call=>!call[0].dryRun)).toHaveLength(0);await runtime.close();
});
it('requires both exact canonical reservations immediately before paid create',async()=>{
 const f=setup();let reads=0;
 fake.getTables.mockImplementation(async()=>{if(++reads===3){const key=[...fake.budgetDocs.keys()].find(k=>k.startsWith('metricsQueryBudgetDays/') && k.includes('/reservations/'))!;
  fake.budgetDocs.set(key,{...fake.budgetDocs.get(key),binding:'9'.repeat(64)});}return [[{id:'events_20261118',metadata:{type:'TABLE'}}],null];});
 const runtime=await createServiceOwnedUatRuntime();await expect(runtime.collect('token',f.job.id,new AbortController().signal)).rejects.toThrow();
 expect(fake.create.mock.calls.filter(call=>!call[0].dryRun)).toHaveLength(0);expect(fake.docs.get(reportPath('capacity','custom'))).toEqual({active:1});await runtime.close();
});
it.each(['revocation','abort'] as const)('stops on %s during source preflight before paid create',async fault=>{
 const f=setup(),controller=new AbortController();
 fake.getTables.mockImplementation(async()=>{if(fault==='abort')controller.abort();else fake.docs.set(reportPath('policy','one-agent-detail-two-source'),{...f.source,enabled:false});
  return [[{id:'events_20261118',metadata:{type:'TABLE'}}],null];});
 const runtime=await createServiceOwnedUatRuntime();await expect(runtime.collect('token',f.job.id,controller.signal)).rejects.toThrow();
 expect(fake.create.mock.calls.filter(call=>!call[0].dryRun)).toHaveLength(0);await runtime.close();
});
it.each(['catalog','lease'] as const)('holds on %s drift before paid create',async fault=>{
 const f=setup();let reads=0;
 fake.getTables.mockImplementation(async()=>{reads++;if(fault==='lease' && reads===2){const key=reportPath('jobs',f.job.id);fake.docs.set(key,{...fake.docs.get(key),leaseUntil:0});}
  return [fault==='catalog' && reads>=3?[{id:'events_20261118',metadata:{type:'TABLE'}},{id:'events_intraday_20261118',metadata:{type:'TABLE'}}]:[{id:'events_20261118',metadata:{type:'TABLE'}}],null];});
 const runtime=await createServiceOwnedUatRuntime();await expect(runtime.collect('token',f.job.id,new AbortController().signal)).rejects.toThrow();
 expect(fake.create.mock.calls.filter(call=>!call[0].dryRun)).toHaveLength(0);await runtime.close();
});
it('recovery-only missing journal cannot estimate, reserve or submit',async()=>{
 const f=setup(),key=reportPath('jobs',f.job.id);fake.docs.set(key,{...f.job,status:'delayed',sourceStarted:true,fence:1,leaseUntil:0});
 const runtime=await createServiceOwnedUatRuntime();await expect(runtime.collect('token',f.job.id,new AbortController().signal)).rejects.toThrow();
 expect(fake.create).not.toHaveBeenCalled();expect(fake.budgetDocs.size).toBe(0);await runtime.close();
});
it.each(['feature','location'] as const)('rejects mismatched %s native job configuration without publication',async role=>{
 for(const fault of ['query','cap']) {
  const f=setup();successfulNative();const original=fake.metadata.getMockImplementation()!,ids=uatTwoSourceChildIds(f.job.id,f.manifestDigest),target=`metrics_detail_${ids[role]}`;
  fake.metadata.mockImplementation(async(id:string)=>{const result=await original(id);if(id===target){if(fault==='query')result[0].configuration.query.query='SELECT 2';else result[0].configuration.query.maximumBytesBilled='1';}return result;});
  const runtime=await createServiceOwnedUatRuntime();await expect(runtime.collect('token',f.job.id,new AbortController().signal)).rejects.toThrow();
  expect(fake.docs.has(reportPath('uatCombinedPublications',f.job.id))).toBe(false);expect(fake.docs.get(reportPath('capacity','custom'))).toEqual({active:1});await runtime.close();
 }
});
it.each(['pagination','oversize'] as const)('rejects %s child rows without publication',async fault=>{
 const f=setup();successfulNative();
 fake.rows.mockResolvedValue(fault==='pagination'?[[],{pageToken:'next'}]:[[{payload:'x'.repeat(700001)}],null]);
 const runtime=await createServiceOwnedUatRuntime();await expect(runtime.collect('token',f.job.id,new AbortController().signal)).rejects.toThrow();
 expect(fake.docs.has(reportPath('uatCombinedPublications',f.job.id))).toBe(false);expect(fake.docs.get(reportPath('capacity','custom'))).toEqual({active:1});await runtime.close();
});
it('rejects changed native proof during result read without publication',async()=>{
 const f=setup();successfulNative();let changed=false;
 fake.rows.mockImplementation(async()=>{if(!changed){changed=true;const ids=uatTwoSourceChildIds(f.job.id,f.manifestDigest),key=reportPath('uatTwoSourceProofs',ids.feature);
  fake.docs.set(key,{...fake.docs.get(key),billed:999});}return [[],null];});
 const runtime=await createServiceOwnedUatRuntime();await expect(runtime.collect('token',f.job.id,new AbortController().signal)).rejects.toThrow();
 expect(fake.docs.has(reportPath('uatCombinedPublications',f.job.id))).toBe(false);expect(fake.docs.get(reportPath('capacity','custom'))).toEqual({active:1});await runtime.close();
});
it.each(['feature','location'] as const)('does not read %s native results when its stored proof disappears',async role=>{
 const f=setup();successfulNative();const ids=uatTwoSourceChildIds(f.job.id,f.manifestDigest),target=reportPath('uatTwoSourceProofs',ids[role]);
 let metadataAt=-1,rowsAt=-1;fake.onGet.mockImplementation((path:string,data:Map<string,unknown>)=>{
  if(path===target && data.has(path)){metadataAt=fake.metadata.mock.calls.length;rowsAt=fake.rows.mock.calls.length;data.delete(path);}
 });
 const runtime=await createServiceOwnedUatRuntime();await expect(runtime.collect('token',f.job.id,new AbortController().signal)).rejects.toThrow();
 expect(metadataAt).toBeGreaterThanOrEqual(0);expect(fake.metadata).toHaveBeenCalledTimes(metadataAt);expect(fake.rows).toHaveBeenCalledTimes(rowsAt);
 expect(fake.docs.has(reportPath('uatCombinedPublications',f.job.id))).toBe(false);await runtime.close();
});
it.each(['feature','location'] as const)('does not read %s native results when the parent intent disappears',async role=>{
 const f=setup();successfulNative();const ids=uatTwoSourceChildIds(f.job.id,f.manifestDigest),target=reportPath('uatTwoSourceIntents',f.job.id);
 let metadataAt=-1,rowsAt=-1;fake.onGet.mockImplementation((path:string,data:Map<string,unknown>)=>{
  if(path===target && data.has(reportPath('uatTwoSourceProofs',ids.feature)) && data.has(reportPath('uatTwoSourceProofs',ids.location))
    && fake.rows.mock.calls.length===(role==='feature'?0:1) && data.has(path)) {metadataAt=fake.metadata.mock.calls.length;rowsAt=fake.rows.mock.calls.length;data.delete(path);}
 });
 const runtime=await createServiceOwnedUatRuntime();await expect(runtime.collect('token',f.job.id,new AbortController().signal)).rejects.toThrow();
 expect(metadataAt).toBeGreaterThanOrEqual(0);expect(fake.metadata).toHaveBeenCalledTimes(metadataAt);expect(fake.rows).toHaveBeenCalledTimes(rowsAt);
 expect(fake.docs.has(reportPath('uatCombinedPublications',f.job.id))).toBe(false);await runtime.close();
});
it('publishes a verified combined subset and keeps reads passive, scoped and proof-bound',async()=>{
 const f=setup();successfulNative();const secret='s'.repeat(40), now=Date.now();
 vi.stubEnv('SESSION_SECRET',secret);vi.stubEnv('METRICS_SCOPE_DIGEST',f.scopeDigest);vi.stubEnv('ALLOWED_EMAIL_DOMAINS','hushh.ai');
 const body=JSON.stringify({email:'staff@hushh.ai',exp:Math.floor(now/1000)+180}),cookie=`s:${body}.${createHmac('sha256',secret).update(body).digest('base64url')}`;
 const runtime=await createServiceOwnedUatRuntime();
 expect(await runtime.collect('token',f.job.id,new AbortController().signal)).toEqual({state:'partial',id:f.job.id});
 expect(fake.docs.get(reportPath('capacity','custom'))).toEqual({active:0});
 expect(fake.paidEvidence).toEqual([true,true]);
 expect(fake.construct.mock.calls.every(([options])=>JSON.stringify(options)==='{"projectId":"hushh-ai-prod","autoRetry":false,"maxRetries":0}')).toBe(true);
 const before=fake.create.mock.calls.length,read=await runtime.read(cookie,f.job.request);
 expect(read).toMatchObject({state:'partial',freshness:'unknown'});expect((await runtime.status(cookie,f.job.id)).state).toBe('partial');
 expect(fake.create).toHaveBeenCalledTimes(before);
 vi.stubEnv('METRICS_BIGQUERY_ENABLED','false');expect(await runtime.read(cookie,f.job.request)).toMatchObject({state:'partial'});
 await expect(runtime.collect('token',f.job.id,new AbortController().signal)).rejects.toThrow();vi.stubEnv('METRICS_BIGQUERY_ENABLED','true');
 const ids=uatTwoSourceChildIds(f.job.id,f.manifestDigest),proofKey=reportPath('uatTwoSourceProofs',ids.feature),proof=fake.docs.get(proofKey);
 fake.docs.set(proofKey,{...proof,billed:proof.billed+1});await expect(runtime.read(cookie,f.job.request)).rejects.toThrow();fake.docs.set(proofKey,proof);
 const quotaId=digest([createHmac('sha256',secret).update('metrics-staff-quota-v1:staff@hushh.ai').digest('hex'),'read',Math.floor(Date.now()/60000)]);
 fake.docs.set(reportPath('quotas',quotaId),{count:10,windowEndsAt:Date.now()+60000});await expect(runtime.read(cookie,f.job.request)).rejects.toThrow();
 fake.docs.delete(reportPath('quotas',quotaId));vi.useFakeTimers();vi.setSystemTime(now+61000);
 expect(await runtime.read(cookie,f.job.request)).toMatchObject({state:'partial'}); // source execution expiry does not erase a retained report
 vi.setSystemTime(now+121000);expect(await runtime.read(cookie,f.job.request)).toEqual({state:'unavailable'});vi.useRealTimers();
 fake.docs.set(reportPath('policy','one-agent-detail-two-source'),{...f.source,enabled:false});await expect(runtime.read(cookie,f.job.request)).rejects.toThrow();
 await runtime.close();
});

it.each(['incident','policy'] as const)('holds dispatch if %s closes after durable intent',async fault=>{
 const f=setup();fake.docs.delete(reportPath('jobs',f.job.id));fake.docs.set(reportPath('heads',f.job.key),{sequence:0,activeJob:null,publication:null});
 fake.docs.set(reportPath('capacity','custom'),{active:0});fake.docs.set(reportPath('subjectCapacity',digest(['custom','e'.repeat(64)])),{active:0});
 fake.docs.set(reportPath('policy','dispatch'),{approved:true,enabled:true,leaseMs:1000,lookupDelayMs:1000,maxLookups:2});
 fake.verify.mockResolvedValue({getPayload:()=>({iss:'https://accounts.google.com',email_verified:true,email:'metrics-report-web@hushh-ai-prod.iam.gserviceaccount.com'})});
 const runtime=await createServiceOwnedUatRuntime();let changed=false;
 fake.onGet.mockImplementation((path:string,data:Map<string,any>)=>{if(!changed && path.startsWith('metricsReporting/v1/dispatches/')) {changed=true;
   if(fault==='incident')vi.stubEnv('METRICS_BIGQUERY_ENABLED','false');
   else data.set(reportPath('policy','one-agent-detail-two-source'),{...f.source,enabled:false});
 }});
 const fetcher=vi.spyOn(globalThis,'fetch');
 await expect(runtime.requestForWeb('token',{subjectHash:'e'.repeat(64),scopeDigest:f.scopeDigest},f.job.request,new AbortController().signal)).rejects.toThrow();
 expect(changed).toBe(true);expect(fetcher).not.toHaveBeenCalled();expect(fake.create).not.toHaveBeenCalled();
 fetcher.mockRestore();await runtime.close();
});




