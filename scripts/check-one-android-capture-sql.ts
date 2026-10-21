import assert from 'node:assert/strict';
import { BigQuery } from '@google-cloud/bigquery';
import { onePlatformCaptureQueries, unpackPlatformCapture } from '../src/server/one-platform-capture';
import { oneSurfaceSql } from '../src/server/one-scope.mjs';

// Executes only inline synthetic rows in a UAT job project. No dataset is read or written.
const projectId=process.env.ONE_ANDROID_SQL_TEST_PROJECT || 'hushh-pda-uat';
if(projectId!=='hushh-pda-uat') throw new Error('SQL fixture must use the UAT job project');
const rows=[
  ['20261006','ANDROID','device-old','account-old','page_view','15395548050','com.hussh.app','production',0],
  ['20261007','ANDROID','device-a','account-a','page_view','15395548050','com.hussh.app','production',0],
  ['20261008','ANDROID','device-a','account-a','page_view','15395548050','com.hussh.app','production',0],
  ['20261008','ANDROID','device-b','account-a','page_view','15395548050','com.hussh.app','production',0],
  ['20261008','ANDROID','device-c','','user_engagement','15395548050','com.hussh.app','production',0],
  ['20261008','ANDROID','uat-device','uat-account','page_view','15395713075','com.hussh.app','uat',0],
  ['20261008','ANDROID','wrong-env','wrong-env','page_view','15395548050','com.hussh.app','uat',0],
  ['20261008','ANDROID','legacy','legacy','page_view','15395548050','com.hushh.app','production',0],
  ['20261008','ANDROID','debug','debug','page_view','15395548050','com.hussh.app','production',1],
  ['20261006','WEB','web-a','web-account','page_view','13695004816','','production',0],
  ['20261008','WEB','web-a','web-account','page_view','13695004816','','production',0],
  ['20261006','IOS','ios-a','ios-account','page_view','13695001361','com.hushh.app','production',0],
];
const literal=(value:unknown)=>typeof value==='number'?String(value):"'"+String(value).replaceAll("'","\\'")+"'";
const input=`(WITH fixture AS (${rows.map((r,i)=>'SELECT '+r.map((v,n)=>literal(v)+(i===0?' AS '+['event_date','platform','user_pseudo_id','user_id','event_name','stream_id','package','env','debug'][n]:'')).join(',')).join(' UNION ALL ')})
 SELECT event_date,platform,user_pseudo_id,user_id,event_name,stream_id,
 UNIX_MICROS(TIMESTAMP(PARSE_DATE('%Y%m%d',event_date))) AS event_timestamp,
 STRUCT(package AS id,'1.3.9' AS version,'com.android.vending' AS install_source) AS app_info,
 [STRUCT('env' AS key,STRUCT(env AS string_value,CAST(NULL AS INT64) AS int_value) AS value),
  STRUCT('debug_mode',STRUCT(CAST(NULL AS STRING),debug)),
  STRUCT('route_id',STRUCT('home',CAST(NULL AS INT64))),
  STRUCT('page_location',STRUCT('https://one.hushh.ai/',CAST(NULL AS INT64)))] AS event_params
 FROM fixture)`;
const query=onePlatformCaptureQueries({table:input,
 dateFilter:"event_date BETWEEN '20261006' AND '20261008' AND "+oneSurfaceSql('one.hushh.ai','production'),
 meaningful:"event_name NOT IN ('user_engagement')",androidStartDate:'2026-10-07',environment:'production'});
const bq=new BigQuery({projectId});
const read=async(sql:string)=>(await bq.query({query:sql,location:'US',maximumBytesBilled:'10000000',jobTimeoutMs:30000}))[0];
const baseline=await read(query.baseline), combined=unpackPlatformCapture({rows:await read(query.combined!),error:null});
assert.equal(combined.platforms.error,null); assert.equal(combined.androidCapture.error,null);
assert.deepEqual(combined.platforms.rows,baseline.map(r=>({...r,topProductScreens:r.topProductScreens??[]})));
const capture=combined.androidCapture.rows[0];
assert.equal(capture.events,4); assert.equal(capture.activeAppIds,2);
assert.equal(capture.identifiedAccounts,1); assert.equal(capture.boundAppIds,2);
assert.equal(capture.observedSince,'2026-10-07');
assert.deepEqual(capture.releases,[{version:'1.3.9',installer:'com.android.vending',environment:'production',events:4}]);
assert.equal(combined.platforms.rows.find(r=>r.platform==='ANDROID')?.events,5);
assert.equal(combined.platforms.rows.find(r=>r.platform==='WEB')?.events,2);
assert.equal(combined.platforms.rows.find(r=>r.platform==='IOS')?.events,1);
console.log(JSON.stringify({ok:true,job_project:projectId,inline_fixture_only:true,
 assertions:['platform_parity','range_wide_distinct_accounts_and_devices','capture_only_cutover_clamp','legacy_uat_debug_excluded','release_totals']},null,2));
