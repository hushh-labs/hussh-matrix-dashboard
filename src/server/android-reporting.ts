import { GoogleAuth, Impersonated } from 'google-auth-library';
import { ONE_ANDROID_PACKAGE, ONE_ANDROID_STREAMS } from './one-scope.mjs';

export type ReportingState = 'available' | 'not_configured' | 'permission_missing' | 'not_yet_available' | 'sync_failed' | 'privacy_limited';
export interface ReportingRange { startDate: string; endDate: string }
type Send = (url: string, body?: Record<string, unknown>, binary?: boolean) => Promise<any>;
const DAY = 86_400_000;
const dateValue = (date: string) => ({year:Number(date.slice(0,4)),month:Number(date.slice(5,7)),day:Number(date.slice(8,10)),timeZone:{id:'America/Los_Angeles'}});
const iso = (date: any) => date && Number.isInteger(date.year) && Number.isInteger(date.month) && Number.isInteger(date.day)
  ? `${date.year}-${String(date.month).padStart(2,'0')}-${String(date.day).padStart(2,'0')}` : null;
const number = (value: unknown): number | null => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
function failed(error: any): ReportingState {
  const status = error?.response?.status ?? error?.status;
  return status === 401 || status === 403 ? 'permission_missing' : status === 404 ? 'not_yet_available' : 'sync_failed';
}
const safeRequestError = (error:any) => Object.assign(new Error('Google reporting request unavailable'),{status:error?.response?.status ?? error?.status});

/** No keys: workload identity mints a short-lived, read-scoped token for the configured reader. */
export function googleReader(principal: string, scopes: string[]): Send {
  let client: Promise<any> | null = null;
  return async (url, body, binary) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443') || !['analyticsdata.googleapis.com','playdeveloperreporting.googleapis.com','storage.googleapis.com'].includes(parsed.hostname)) throw new Error('Untrusted reporting host');
    client ??= new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']}).getClient().then(sourceClient => new Impersonated({sourceClient,targetPrincipal:principal,targetScopes:scopes,lifetime:600}));
    let reader;
    try {reader = await client;} catch(error) {client=null;throw safeRequestError(error);}
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await reader.request({url,method:body ? 'POST' : 'GET',data:body,timeout:10_000,
          retry:false, maxRedirects:0, size:10*1024*1024, maxContentLength:10*1024*1024, ...(binary ? {responseType:'arraybuffer'} : {})});
        return result.data;
      } catch (error: any) {
        const status = error?.response?.status;
        if (attempt >= 1 || ![429,500,502,503,504].includes(status)) throw safeRequestError(error);
        // Bounded provider guidance; errors and URLs never leave this function.
        const retryAfter = Number(error?.response?.headers?.['retry-after']);
        await new Promise(resolve => setTimeout(resolve, Number.isFinite(retryAfter) ? Math.min(Math.max(retryAfter,1),3)*1000 : 1000));
      }
    }
  };
}

export async function fetchAndroidHistory(send: Send, range: ReportingRange) {
  const request = (body: Record<string, unknown>) => send('https://analyticsdata.googleapis.com/v1beta/properties/526603671:runReport', {
    dateRanges:[{startDate:range.startDate,endDate:range.endDate}],
    dimensionFilter:{filter:{fieldName:'streamId',stringFilter:{matchType:'EXACT',value:ONE_ANDROID_STREAMS.production}}},
    ...body,
  });
  try {
    // Range totals are requested once; daily users are never added into a unique range total.
    const totals = await request({metrics:[{name:'activeUsers'},{name:'totalUsers'},{name:'eventCount'}],limit:1});
    const daily = await request({dimensions:[{name:'date'},{name:'eventName'}],metrics:[{name:'eventCount'}],limit:2000,
      dimensionFilter:{andGroup:{expressions:[
        {filter:{fieldName:'streamId',stringFilter:{matchType:'EXACT',value:ONE_ANDROID_STREAMS.production}}},
        {filter:{fieldName:'eventName',inListFilter:{values:['first_open','page_view','auth_succeeded','onboarding_completed','one_location_activation_completed','growth_funnel_step_completed']}}},
      ]}}});
    const values = totals.rows?.[0]?.metricValues ?? [];
    const thresholded = totals.metadata?.subjectToThresholding === true || daily.metadata?.subjectToThresholding === true;
    const rows = (daily.rows ?? []).map((row: any) => ({date:String(row.dimensionValues?.[0]?.value ?? '').replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'),
      event:String(row.dimensionValues?.[1]?.value ?? ''),events:number(row.metricValues?.[0]?.value)}));
    return {state:(thresholded ? 'privacy_limited' : values.length ? 'available' : 'not_yet_available') as ReportingState,
      source:'GA4 Data API · aggregate history',timezone:totals.metadata?.timeZone ?? 'Unknown',
      activeUsers:number(values[0]?.value),trackedUsers:number(values[1]?.value),events:number(values[2]?.value),daily:rows,
      truncated:Number(daily.rowCount ?? 0)>rows.length,
      note:'GA4 reported app users and event counts. These are not signed-in account counts, store downloads or reconstructed raw BigQuery events. Daily event counts can repeat; sign-in events are not unique signups.'};
  } catch (error) {
    return {state:failed(error),source:'GA4 Data API · aggregate history',timezone:null,activeUsers:null,trackedUsers:null,events:null,daily:[],truncated:false,
      note:'Historical Android aggregate reporting is unavailable. No count is inferred.'};
  }
}

/** RFC 4180-style CSV including quoted newlines, escaped quotes and UTF-16 Play exports. */
export function parsePlayCsv(bytes: Uint8Array): Record<string,string>[] {
  if (bytes.byteLength > 10*1024*1024) throw new Error('Play report exceeds the 10 MiB bound');
  const encoding = bytes[0]===0xff && bytes[1]===0xfe ? 'utf-16le' : bytes[0]===0xfe && bytes[1]===0xff ? 'utf-16be' : 'utf-8';
  const source = new TextDecoder(encoding,{fatal:true}).decode(bytes).replace(/^\uFEFF/,'');
  const records: string[][] = []; let record: string[] = []; let field=''; let quoted=false; let closed=false;
  for (let i=0;i<source.length;i++) {
    const char=source[i];
    if (char==='"') {
      if (quoted && source[i+1]==='"') {field+='"';i++;}
      else if (quoted) {quoted=false;closed=true;}
      else {if(field.length || closed)throw new Error('Malformed Play CSV quote');quoted=true;}
    }
    else if (char===',' && !quoted) {record.push(field);field='';closed=false;}
    else if ((char==='\n'||char==='\r') && !quoted) {if(char==='\r'&&source[i+1]==='\n')i++;record.push(field);if(record.some(Boolean))records.push(record);record=[];field='';closed=false;}
    else {if(closed)throw new Error('Malformed Play CSV quote');field+=char;}
    if (records.length>100_000 || field.length>16_384) throw new Error('Play report exceeds row/field bounds');
  }
  if (quoted) throw new Error('Malformed Play CSV');
  record.push(field);if(record.some(Boolean))records.push(record);
  const headers=records.shift()?.map(value=>value.trim().toLowerCase()) ?? [];
  if (new Set(headers).size!==headers.length || !headers.includes('date') || !headers.includes('package name')) throw new Error('Unsupported Play report schema');
  return records.map(row=>{if(row.length!==headers.length)throw new Error('Malformed Play CSV row');return Object.fromEntries(headers.map((header,i)=>[header,row[i]]));});
}

export function summarizePlayReports(rows: Record<string,string>[], range: ReportingRange, kind: 'installs' | 'store') {
  const metrics=kind==='installs' ? ['daily user installs','daily user uninstalls','daily device installs','daily device uninstalls','daily device upgrades']
    : ['store listing acquisitions','store listing visitors'];
  const byDate=new Map<string,Record<string,number|null>>(); const keys=new Set<string>();
  for (const row of rows) {
    if(row['package name']!==ONE_ANDROID_PACKAGE || row.date<range.startDate || row.date>range.endDate)continue;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(row.date))throw new Error('Invalid Play date');
    const key=`${row.date}:${row.country ?? row['country/region'] ?? ''}`;
    if(keys.has(key))throw new Error('Duplicate Play country/date row');keys.add(key);
    const total=byDate.get(row.date) ?? Object.fromEntries(metrics.map(name=>[name,0]));
    for(const name of metrics){const value=number(row[name]);total[name]=value===null||total[name]===null ? null : total[name]+value;}
    byDate.set(row.date,total);
  }
  const daily=Array.from(byDate,([date,metrics])=>({date,metrics})).sort((a,b)=>a.date.localeCompare(b.date));
  const totals=Object.fromEntries(metrics.map(name=>[name,daily.length && daily.every(row=>row.metrics[name]!==null) ? daily.reduce((sum,row)=>sum+row.metrics[name]!,0) : null]));
  return {state:(daily.length ? 'available':'not_yet_available') as ReportingState,totals,daily,dataThrough:daily.at(-1)?.date ?? null,
    note:kind==='installs' ? 'Sum of daily user/device install and uninstall flows; not a current installed-base snapshot or deduplicated people.' : 'Sum of daily store listing acquisitions and visitor measurements. Repeated daily visitors are not unique range visitors; conversion rates are not averaged.'};
}

export async function fetchPlayDownloads(send: Send, bucket: string, range: ReportingRange) {
  const none={state:'not_configured' as ReportingState,totals:{},daily:[],dataThrough:null,note:'Play Console report bucket is not configured. Firebase first opens are not used as downloads.'};
  const match=/^(?:gs:\/\/)?(pubsite_prod(?:_rev)?_[a-zA-Z0-9_-]+)\/?$/.exec(bucket);
  if(!bucket)return {installs:none,store:none};
  if(!match)return {installs:{...none,state:'sync_failed' as ReportingState},store:{...none,state:'sync_failed' as ReportingState}};
  const months=new Set<string>();
  for(let time=Date.parse(range.startDate);time<=Date.parse(range.endDate);time+=DAY)months.add(new Date(time).toISOString().slice(0,7).replace('-',''));
  if(months.size>4)throw new Error('Play monthly report bound exceeded');
  const output:any={};
  for(const kind of ['installs','store'] as const){
    const rows:Record<string,string>[]=[];let state:ReportingState|null=null;
    for(const month of months){
      const prefix=kind==='installs'?'installs':'store_performance';
      const object=`stats/${prefix}/${prefix}_${ONE_ANDROID_PACKAGE}_${month}_country.csv`;
      try{const data=await send(`https://storage.googleapis.com/storage/v1/b/${match[1]}/o/${encodeURIComponent(object)}?alt=media`,undefined,true);rows.push(...parsePlayCsv(new Uint8Array(data)));}
      catch(error){state=failed(error);break;}
    }
    try{output[kind]=state ? {...none,state,note:'Play report access or availability is incomplete; no total is inferred.'} : summarizePlayReports(rows,range,kind);}
    catch{output[kind]={...none,state:'sync_failed',note:'Play report schema or duplicate rows need review; no total is inferred.'};}
  }
  return output;
}

export async function fetchPlayVitals(send: Send, range: ReportingRange) {
  const result:any={timezone:'America/Los_Angeles',cohort:'OS_PUBLIC',tracks:[],metrics:{}};
  let filter:string|undefined;
  try {
    const options=await send(`https://playdeveloperreporting.googleapis.com/v1beta1/apps/${ONE_ANDROID_PACKAGE}:fetchReleaseFilterOptions`);
    const codes=[...new Set<string>((options.tracks ?? []).filter((track:any)=>track.type==='Production'&&track.displayName==='production')
      .flatMap((track:any)=>(track.servingReleases ?? []).flatMap((release:any)=>release.versionCodes ?? [])))];
    if(!codes.length || codes.length>20 || codes.some(code=>!/^\d{1,12}$/.test(code)))throw new Error('No bounded production release filter');
    result.tracks=codes;
    filter=codes.length===1 ? `versionCode = ${codes[0]}` : `(${codes.map(code=>`versionCode = ${code}`).join(' OR ')})`;
  } catch(error) {
    return {...result,state:failed(error),note:'Production release metadata is unavailable; rates are not mixed with unknown releases.'};
  }
  for(const [set,metric] of [['crashRateMetricSet','userPerceivedCrashRate'],['anrRateMetricSet','userPerceivedAnrRate']] as const){
    try{
      const url=`https://playdeveloperreporting.googleapis.com/v1beta1/apps/${ONE_ANDROID_PACKAGE}/${set}`;
      const meta=await send(url);
      const boundary=meta.freshnessInfo?.freshnesses?.find((entry:any)=>entry.aggregationPeriod==='DAILY')?.latestEndTime;
      const latest=iso(boundary);
      const requestedEnd=new Date(Date.parse(range.endDate)+DAY).toISOString().slice(0,10);
      const end=latest && latest<requestedEnd ? latest : requestedEnd;
      if(!latest || end<=range.startDate){result.metrics[metric]={state:'not_yet_available',daily:[],dataThrough:null};continue;}
      const report=await send(url+':query',{timelineSpec:{aggregationPeriod:'DAILY',startTime:dateValue(range.startDate),endTime:dateValue(end)},metrics:[metric,'distinctUsers'],filter,userCohort:'OS_PUBLIC',pageSize:1000});
      const rows=(report.rows ?? []).map((row:any)=>({date:iso(row.startTime),rate:number(row.metrics?.find((value:any)=>value.metric===metric)?.decimalValue?.value),
        normalizationUsers:number(row.metrics?.find((value:any)=>value.metric==='distinctUsers')?.decimalValue?.value)}));
      const usable=rows.filter((row:any)=>row.date && row.rate!==null);
      result.metrics[metric]={state:report.nextPageToken?'sync_failed':usable.length?'available':'not_yet_available',daily:report.nextPageToken?[]:rows,
        dataThrough:report.nextPageToken?null:usable.map((row:any)=>row.date).sort().at(-1) ?? null,
        providerAvailableThrough:new Date(Date.parse(end)-DAY).toISOString().slice(0,10)};
    }catch(error){result.metrics[metric]={state:failed(error),daily:[],dataThrough:null};}
  }
  const states=Object.values(result.metrics).map((item:any)=>item.state);
  const state:ReportingState=states.includes('available') ? 'available' : states.includes('permission_missing') ? 'permission_missing' : states.includes('sync_failed') ? 'sync_failed' : 'not_yet_available';
  return {...result,state,note:'Daily provider rates for version codes currently serving on production. Each metric has its own availability. The same version can also serve testers; OS_PUBLIC is an Android cohort, not proof of install track. Rates and rounded daily normalization users must not be added.'};
}

/** Coalesce requests; finite memory, per-process budgets and no provider-error caching leaks. */
export function boundedReportingCache<T>(fetcher:(range:ReportingRange)=>Promise<T>, ttl=3_600_000) {
  const cache=new Map<string,{at:number,promise:Promise<T>}>();let window=0;let attempts=0;
  return (range:ReportingRange) => {
    const key=`${range.startDate}:${range.endDate}`;const now=Date.now();const hit=cache.get(key);
    if(hit && now-hit.at<ttl)return hit.promise;
    if(now-window>600_000){window=now;attempts=0;}
    if(++attempts>12)return Promise.reject(new Error('Reporting request budget reached'));
    while(cache.size>=32)cache.delete(cache.keys().next().value!);
    const promise=fetcher(range);cache.set(key,{at:now,promise});
    promise.catch(()=>cache.delete(key));return promise;
  };
}
