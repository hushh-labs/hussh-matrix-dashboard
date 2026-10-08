#!/usr/bin/env node
/** Read-only audit of every displayed One feature in both reporting properties. */
import { BigQuery } from '@google-cloud/bigquery';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { AGENT_MEASUREMENTS } from '../src/lib/agent-measurement-contract.mjs';
import { oneSurfaceSql } from '../src/server/one-scope.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const end = option('--end-date', new Date(Date.now() - 86400000).toISOString().slice(0,10));
const start = option('--start-date', new Date(Date.parse(end) - 29 * 86400000).toISOString().slice(0,10));
const repeats = Number(option('--repeat', '1'));
if (![start,end].every(date => /^\d{4}-\d{2}-\d{2}$/.test(date) && new Date(date).toISOString().slice(0,10) === date)
  || start > end || (Date.parse(end)-Date.parse(start))/86400000 > 365
  || !Number.isInteger(repeats) || repeats < 1 || repeats > 3) throw new Error('Invalid bounded audit dates or repetition count');
const jobProject = process.env.BQ_JOB_PROJECT || 'hushh-ai-prod';
const dashboardUrl = option('--dashboard-url', process.env.METRICS_DASHBOARD_URL || 'https://metrics.hushh.ai');
const appRepo = option('--app-repo', null);
const appRef = option('--app-ref', 'HEAD');
if (appRef.startsWith('-')) throw new Error('Invalid app ref');
const targets = [
  ['production',process.env.ONE_APP_GA4_PROJECT || process.env.KAI_PROD_GA4_PROJECT || 'hushh-pda',process.env.ONE_APP_GA4_DATASET || process.env.KAI_PROD_GA4_DATASET || 'analytics_526603671',process.env.ONE_APP_WEB_HOST || 'one.hushh.ai'],
  ['uat',process.env.ONE_APP_UAT_GA4_PROJECT || 'hushh-pda-uat',process.env.ONE_APP_UAT_GA4_DATASET || 'analytics_533362555',process.env.ONE_APP_UAT_WEB_HOST || 'uat.one.hushh.ai'],
];
if (![jobProject,...targets.flatMap(t=>t.slice(1,3))].every(part=>/^[A-Za-z0-9_-]+$/.test(part))) throw new Error('Invalid BigQuery target');
const run = promisify(execFile);
const fields = ['accounts','devices','signals','successes','expectedErrors','failures','outcomeSignals'];
const zero = Object.fromEntries(fields.map(key=>[key,0]));
const panelSource = readFileSync(new URL('../src/components/AgentCapabilityAnalyticsPanel.tsx',import.meta.url),'utf8');
const displayedKeys = [...panelSource.matchAll(/(?:key:|actionSpec\()\s*'([a-z_]+)'/g)].map(m=>m[1]);
const missingContract = [...new Set(displayedKeys)].filter(key=>!AGENT_MEASUREMENTS.some(m=>m.key===key));
if(missingContract.length) throw new Error('Audit inventory missing displayed features: '+missingContract.join(', '));
// Read event membership as configuration; recompute counts independently of
// the server's aggregation SQL, including distinct unions and the daily chart.
const serverSource=readFileSync(new URL('../server.ts',import.meta.url),'utf8');
const catalogue=serverSource.match(/const ONE_CAPABILITIES: OneCapabilitySpec\[\] = \[([\s\S]*?)\n\];/)?.[1]??'';
const names=text=>[...text.matchAll(/'([a-z_]+)'/g)].map(match=>match[1]);
const capabilities=[...catalogue.matchAll(/\{\s*key: '([a-z_]+)',[\s\S]*?deliberate: \[([\s\S]*?)\],[\s\S]*?background: \[([\s\S]*?)\],[\s\S]*?instrumented: (true|false)/g)]
  .map(match=>({key:match[1],deliberate:names(match[2]),background:names(match[3]),instrumented:match[4]==='true'}));
if(capabilities.length!==12) throw new Error('Incomplete capability inventory');
const literalList=values=>values.map(value=>`'${value}'`).join(',');

async function sourceEvidence() {
  if(!appRepo) return null;
  const {stdout: sha} = await run('git',['rev-parse',appRef],{cwd:appRepo,timeout:30000,windowsHide:true});
  const evidence = {};
  // References identify candidate callers, not deployment or a completed journey.
  for(const measurement of AGENT_MEASUREMENTS) {
    if (!measurement.events.length) { evidence[measurement.key]=[]; continue; }
    try {
      const {stdout}=await run('git',['grep','-l','-F',...measurement.events.flatMap(name=>['-e',`"${name}"`]),sha.trim(),'--','hushh-webapp',
        ':!*test*',':!*spec*',':!hushh-webapp/e2e/*',':!hushh-webapp/docs/*',':!hushh-webapp/contracts/*',':!hushh-webapp/lib/generated/*',
        ':!hushh-webapp/lib/observability/events.ts',':!hushh-webapp/lib/observability/schema.ts'],{cwd:appRepo,timeout:30000,maxBuffer:1000000,windowsHide:true});
      evidence[measurement.key]=stdout.trim().split('\n').filter(Boolean).map(path=>path.replace(/^[0-9a-f]+:/,''));
    } catch(error) { if(error.code!==1) throw new Error('Source inventory could not be read'); evidence[measurement.key]=[]; }
  }
  return {commit:sha.trim(),note:'Candidate runtime references; event/action call sites require code review. A definition is not proof that an installed app emits it.',features:evidence};
}

async function aggregate([environment,project,dataset,host]) {
  const suffix = date=>date.replaceAll('-','');
  const query=`WITH preferred AS (
    SELECT REGEXP_REPLACE(table_name,r'^events_','') AS suffix FROM \`${project}.${dataset}.INFORMATION_SCHEMA.TABLES\`
    WHERE REGEXP_CONTAINS(table_name,r'^events_(intraday_)?[0-9]{8}$')
      AND REGEXP_EXTRACT(table_name,r'([0-9]{8})$') BETWEEN '${suffix(start)}' AND '${suffix(end)}'
    QUALIFY ROW_NUMBER() OVER(PARTITION BY REGEXP_EXTRACT(table_name,r'([0-9]{8})$') ORDER BY STARTS_WITH(table_name,'events_intraday_'))=1
  ), scoped AS (
    SELECT event_name, platform, user_pseudo_id, event_date, NULLIF(user_id,'') AS accountKey,
      (SELECT value.string_value FROM UNNEST(event_params) WHERE key='action') AS action,
      (SELECT value.string_value FROM UNNEST(event_params) WHERE key='result') AS result,
      (SELECT value.string_value FROM UNNEST(event_params) WHERE key='load_surface') AS load_surface
    FROM \`${project}.${dataset}.events_*\`
    WHERE (_TABLE_SUFFIX BETWEEN '${suffix(start)}' AND '${suffix(end)}' OR _TABLE_SUFFIX BETWEEN 'intraday_${suffix(start)}' AND 'intraday_${suffix(end)}')
      AND _TABLE_SUFFIX IN(SELECT suffix FROM preferred) AND ${oneSurfaceSql(host,environment)}
  ), base AS (
    SELECT *, CASE ${AGENT_MEASUREMENTS.map(m=>`WHEN ${m.predicate} THEN '${m.key}'`).join('\n')} ELSE NULL END AS featureKey FROM scoped
  ), classified AS (
    SELECT * FROM base
    ${AGENT_MEASUREMENTS.filter(m=>m.extraPredicate).map(m=>`UNION ALL SELECT * REPLACE ('${m.key}' AS featureKey) FROM base WHERE ${m.extraPredicate}`).join('\n')}
  ), feature_totals AS (SELECT featureKey, COUNT(DISTINCT accountKey) AS accounts,
    COUNT(DISTINCT CONCAT(COALESCE(platform,'UNKNOWN'),':',user_pseudo_id)) AS devices,
    COUNT(*) AS signals, COUNTIF(result='success') AS successes,
    COUNTIF(result='expected_error') AS expectedErrors, COUNTIF(result='error') AS failures,
    COUNTIF(result IN('success','expected_error','error')) AS outcomeSignals
  FROM classified WHERE featureKey IS NOT NULL GROUP BY featureKey), cap_base AS (
    SELECT *, CASE ${capabilities.map(c=>`WHEN event_name IN (${literalList([...c.deliberate,...c.background])}) THEN '${c.key}'`).join('\n')} ELSE NULL END AS capability,
    (event_name IN (${literalList(capabilities.flatMap(c=>c.deliberate))}) OR (event_name='consent_pending_loaded' AND load_surface='screen')) AS deliberate
    FROM scoped
  ), cap_totals AS (
    SELECT capability, COUNT(DISTINCT IF(deliberate,accountKey,NULL)) AS accounts,
      COUNT(DISTINCT IF(deliberate,CONCAT(COALESCE(platform,'UNKNOWN'),':',user_pseudo_id),NULL)) AS devices,
      COUNTIF(deliberate) AS signals, COUNT(*) AS totalEvents,
      COUNT(DISTINCT CONCAT(COALESCE(platform,'UNKNOWN'),':',user_pseudo_id)) AS totalUsers
    FROM cap_base WHERE capability IS NOT NULL GROUP BY capability
  ), cap_days AS (
    SELECT capability, event_date AS day, COUNT(DISTINCT CONCAT(COALESCE(platform,'UNKNOWN'),':',user_pseudo_id)) AS users
    FROM cap_base WHERE capability IS NOT NULL AND deliberate GROUP BY capability,day
  ), cap_daily AS (
    SELECT capability, TO_JSON_STRING(ARRAY_AGG(STRUCT(day,users) ORDER BY day)) AS daily FROM cap_days GROUP BY capability
  ) SELECT 'feature' AS kind, featureKey AS key, accounts,devices,signals,successes,expectedErrors,failures,outcomeSignals,
    CAST(NULL AS INT64) AS totalEvents, CAST(NULL AS INT64) AS totalUsers, CAST(NULL AS STRING) AS daily FROM feature_totals
  UNION ALL SELECT 'capability' AS kind, capability AS key, accounts,devices,signals,NULL,NULL,NULL,NULL,totalEvents,totalUsers,daily
    FROM cap_totals LEFT JOIN cap_daily USING(capability)`;
  let rows;
  if(args.includes('--cli')) {
    const {stdout}=await run('bq',[`--project_id=${jobProject}`,'--format=json','query','--use_legacy_sql=false','--use_cache=false','--max_rows=500',query],{timeout:180000,maxBuffer:2000000,windowsHide:true});
    rows=JSON.parse(stdout);
  } else [rows]=await new BigQuery({projectId:jobProject}).query({query,useQueryCache:false,jobTimeoutMs:180000});
  return {features:Object.fromEntries(rows.filter(row=>row.kind==='feature').map(row=>[row.key,Object.fromEntries(fields.map(key=>[key,Number(row[key])]))])),
    capabilities:Object.fromEntries(rows.filter(row=>row.kind==='capability').map(row=>[row.key,{accounts:Number(row.accounts),devices:Number(row.devices),signals:Number(row.signals),totalEvents:Number(row.totalEvents),totalUsers:Number(row.totalUsers),daily:JSON.parse(row.daily||'[]')}]))};
}

const evidence=await sourceEvidence();
const runs=[];
for(let iteration=1;iteration<=repeats;iteration++) {
  const aggregates=await Promise.all(targets.map(aggregate));
  const url=new URL('/api/analytics/one/app',dashboardUrl);
  url.searchParams.set('one_start_date',start); url.searchParams.set('one_end_date',end);
  const response=await fetch(url,{signal:AbortSignal.timeout(180000)});
  if(!response.ok) throw new Error('Aggregate dashboard unavailable, HTTP '+response.status);
  const payload=await response.json();
  const environments=targets.map(([environment,project,dataset],index)=>{
    const summary=payload.data?.[environment];
    const available=summary?.featureUsageAvailable===true && summary?.range?.startDate===start && summary?.range?.endDate===end;
    const unknownFeatures=Object.keys(summary?.featureUsage??{}).filter(key=>!AGENT_MEASUREMENTS.some(m=>m.key===key));
    const features=AGENT_MEASUREMENTS.map(m=>{
      const expected=aggregates[index].features[m.key]??zero;
      const actual=summary?.featureUsage?.[m.key]??zero;
      const matches=available && fields.every(key=>Number(actual[key])===expected[key]);
      return {key:m.key,agent:m.agent,state:expected.signals>0?'observed':m.gap?'tracking_missing':'no_exported_records',
        matches,source:expected,dashboard:Object.fromEntries(fields.map(key=>[key,actual[key]])),gap:m.gap};
    });
    const agentCounts=capabilities.map(c=>{
      const expected=aggregates[index].capabilities[c.key]??{accounts:0,devices:0,signals:0,totalEvents:0,totalUsers:0,daily:[]};
      const actual=summary?.capabilities?.find(item=>item.key===c.key);
      const instrumented=c.instrumented||expected.signals>0;
      const numbersMatch=actual?.instrumented===instrumented && actual?.observed===(expected.signals>0)
        && ['accounts','devices'].every(key=>instrumented?Number(actual?.[key])===expected[key]:actual?.[key]===null)
        && (instrumented?Number(actual?.deliberateEvents)===expected.signals:actual?.deliberateEvents===null)
        && ['totalEvents','totalUsers'].every(key=>Number(actual?.[key])===expected[key]);
      const daily=new Map(expected.daily.map(point=>[point.day,Number(point.users)]));
      const dayCount=(Date.parse(end)-Date.parse(start))/86400000+1;
      const days=new Set(actual?.daily?.map(point=>point.eventDate));
      const dailyMatches=actual?.daily?.length===dayCount && days.size===dayCount && actual.daily.every(point=>point.eventDate>=start&&point.eventDate<=end&&Number(point.users)===(daily.get(point.eventDate.replaceAll('-',''))??0));
      return {key:c.key,matches:available&&summary?.capabilitiesAvailable===true&&numbersMatch&&dailyMatches,dailyMatches,source:expected};
    });
    return {environment,target:`${project}.${dataset}`,available,unknownFeatures,features,agentCounts};
  });
  runs.push({iteration,ok:environments.every(e=>e.available&&!e.unknownFeatures.length&&e.features.every(f=>f.matches)&&e.agentCounts.every(c=>c.matches)),environments});
}
const report={ok:runs.every(r=>r.ok),checkedAt:new Date().toISOString(),range:{startDate:start,endDate:end},
  featureCount:AGENT_MEASUREMENTS.length,displayedFeatureCount:new Set(displayedKeys).size,sourceEvidence:evidence,
  note:'Reconciliation verifies exported counts, not every installed build or workflow. Missing tracking remains a gap even when both source and dashboard contain no records. Reporting properties do not establish native backend environment. Distinct device/account counts cannot be added across features.',runs};
console.log(JSON.stringify(report,null,2));
if(!report.ok) process.exitCode=1;
