import { describe,it,expect,vi } from 'vitest';
import { parsePlayCsv,summarizePlayReports,fetchPlayDownloads,fetchPlayVitals,fetchAndroidHistory,boundedReportingCache } from '../src/server/android-reporting';
const range={startDate:'2026-09-28',endDate:'2026-10-05'};
describe('Android provider reporting',()=>{
  it('parses UTF16 and quoted CSV fields without retaining unneeded source fields',()=>{
    const data=Buffer.concat([Buffer.from([255,254]),Buffer.from('Date,Package Name,Country,Daily User Installs,Notes\r\n2026-09-28,com.hussh.app,US,0,"quoted, value\nwith ""quotes"""\r\n','utf16le')]);
    const rows=parsePlayCsv(data);
    expect(rows[0]['daily user installs']).toBe('0');expect(rows[0].notes).toContain('"quotes"');
    const summary=summarizePlayReports(rows,range,'installs');
    expect(summary.totals['daily user installs']).toBe(0);expect(summary.totals['daily device installs']).toBeNull();
    expect(JSON.stringify(summary)).not.toContain('quoted');
  });
  it('rejects duplicated logical country rows instead of inflating install counts',()=>{
    const row={date:'2026-09-28','package name':'com.hussh.app',country:'US','daily user installs':'3'};
    expect(()=>summarizePlayReports([row,row],range,'installs')).toThrow('Duplicate');
    expect(summarizePlayReports([{...row,'package name':'com.hushh.app'}],range,'installs').totals['daily user installs']).toBeNull();
  });
  it('does not contact arbitrary report buckets or interpret missing access as zero',async()=>{
    const send=vi.fn();expect((await fetchPlayDownloads(send,'https://evil.example/token',range)).installs.state).toBe('sync_failed');expect(send).not.toHaveBeenCalled();
    send.mockRejectedValue({response:{status:403,data:{token:'secret'}}});
    const result=await fetchPlayDownloads(send,'gs://pubsite_prod_rev_fixture',range);
    expect(result.installs.state).toBe('permission_missing');expect(JSON.stringify(result)).not.toContain('secret');
  });
  it('accepts private config whitespace and only requests the company package',async()=>{
    const send=vi.fn().mockRejectedValue({response:{status:404}});
    const result=await fetchPlayDownloads(send,'  gs://pubsite_prod_fixture\r\n',range);
    expect(result.installs.state).toBe('not_yet_available');
    expect(result.store.state).toBe('not_yet_available');
    for(const [url] of send.mock.calls){
      expect(new URL(url).hostname).toBe('storage.googleapis.com');
      expect(decodeURIComponent(url)).toContain('com.hussh.app_');
      expect(url).not.toMatch(/\s/);
    }
  });
  it('distinguishes absent reports from denied access using only an exact company object listing',async()=>{
    const send=vi.fn(async(url:string)=>url.includes('alt=media')
      ? Promise.reject({response:{status:403}}) : {items:[]});
    const result=await fetchPlayDownloads(send,'gs://pubsite_prod_fixture',range);
    expect(result.installs.state).toBe('not_yet_available');
    expect(result.store.state).toBe('not_yet_available');
    const listings=send.mock.calls.filter(([url])=>!url.includes('alt=media'));
    expect(listings).toHaveLength(2);
    for(const [url] of listings){
      const params=new URL(url).searchParams;
      expect(params.get('prefix')).toMatch(/^stats\/(installs|store_performance)\/.*_com\.hussh\.app_202609_country\.csv$/);
      expect(params.get('maxResults')).toBe('1');
      expect(params.get('fields')).toBe('items(name)');
    }
    send.mockImplementation(async(url:string)=>url.includes('alt=media')
      ? Promise.reject({response:{status:403}}) : {items:[{name:new URL(url).searchParams.get('prefix')}]});
    expect((await fetchPlayDownloads(send,'gs://pubsite_prod_fixture',range)).installs.state).toBe('permission_missing');
  });
  it('bounds vitals to freshness and currently serving production versions, preserving zero and missing rates',async()=>{
    const send=vi.fn().mockResolvedValueOnce({tracks:[{type:'Production',displayName:'production',servingReleases:[{versionCodes:['10']}]}]})
      .mockResolvedValueOnce({freshnessInfo:{freshnesses:[{aggregationPeriod:'DAILY',latestEndTime:{year:2026,month:10,day:5}}]}})
      .mockResolvedValueOnce({rows:[{startTime:{year:2026,month:10,day:4},metrics:[{metric:'userPerceivedCrashRate',decimalValue:{value:'0'}}]}]})
      .mockResolvedValueOnce({freshnessInfo:{freshnesses:[{aggregationPeriod:'DAILY',latestEndTime:{year:2026,month:10,day:5}}]}})
      .mockResolvedValueOnce({});
    const result=await fetchPlayVitals(send,range);
    expect(send.mock.calls[2][1].filter).toBe('versionCode = 10');expect(send.mock.calls[2][1].timelineSpec.endTime.day).toBe(5);
    expect(result.metrics.userPerceivedCrashRate.daily[0].rate).toBe(0);expect(result.metrics.userPerceivedAnrRate.state).toBe('not_yet_available');
    expect(result.state).toBe('available');expect(result.metrics.userPerceivedAnrRate.dataThrough).toBeNull();
  });
  it.each(['"1"0','1"0','"1""'])('rejects malformed quoted numeric cells %s',cell=>{
    expect(()=>parsePlayCsv(Buffer.from(`Date,Package Name,Daily User Installs\n2026-09-28,com.hussh.app,${cell}`))).toThrow('Malformed');
  });
  it.each([['not_yet_available',null],['permission_missing',403],['sync_failed',503]])('does not claim vitals available when both children are %s',async(state,status)=>{
    const send=vi.fn(async(url:string,_body?:any)=>url.includes('fetchRelease') ? {tracks:[{type:'Production',displayName:'production',servingReleases:[{versionCodes:['10','11']}]}]}
      : url.endsWith(':query') ? status ? Promise.reject({response:{status}}) : {}
        : {freshnessInfo:{freshnesses:[{aggregationPeriod:'DAILY',latestEndTime:{year:2026,month:10,day:5}}]}});
    const result=await fetchPlayVitals(send,range);
    expect(result.state).toBe(state);expect(result.metrics.userPerceivedCrashRate.dataThrough).toBeNull();
    expect(send.mock.calls.find(call=>call[0].endsWith(':query'))?.[1]?.filter).toBe('(versionCode = 10 OR versionCode = 11)');
  });
  it('requests range users once and keeps historical provider thresholds/source separate',async()=>{
    const send=vi.fn().mockResolvedValueOnce({rows:[{metricValues:[{value:'5'},{value:'6'},{value:'30'}]}],metadata:{timeZone:'Etc/GMT+8',subjectToThresholding:true}})
      .mockResolvedValueOnce({rows:[{dimensionValues:[{value:'20260928'},{value:'first_open'}],metricValues:[{value:'2'}]}]});
    const result=await fetchAndroidHistory(send,range);expect(result.activeUsers).toBe(5);expect(result.state).toBe('privacy_limited');expect(result.daily[0].date).toBe('2026-09-28');
    expect(send.mock.calls[0][1].dimensionFilter.filter.stringFilter.value).toBe('15395548050');
  });
  it('coalesces overlapping requests and enforces a finite report budget',async()=>{
    const worker=vi.fn(async()=>({ok:true}));const cached=boundedReportingCache(worker);
    await Promise.all([cached(range),cached(range)]);expect(worker).toHaveBeenCalledTimes(1);
    for(let n=1;n<12;n++)await cached({...range,startDate:`2026-09-${String(n).padStart(2,'0')}`});
    await expect(cached({...range,startDate:'2026-08-01'})).rejects.toThrow('budget');
  });
});
