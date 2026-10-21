import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import ts from 'typescript';
import { AggregateCache } from '../src/server/aggregate-cache';
import { describe, it, expect } from 'vitest';
import { oneAndroidSql, oneSurfaceSql, oneFounderSurfaceSql, androidCaptureResult, androidComparisonCoverage, androidCaptureQueryRange, nativeRetentionWindowComplete } from '../src/server/one-scope.mjs';

describe('One Android reporting contract', () => {
  it('withholds a week-1 rate until seven complete reporting days follow every first open', () => {
    expect(nativeRetentionWindowComplete('2026-10-07', '2026-10-13', 0)).toBe(false);
    expect(nativeRetentionWindowComplete('2026-10-07', '2026-10-14', 0)).toBe(true);
    expect(nativeRetentionWindowComplete('2026-10-08', '2026-10-14', 0)).toBe(false);
    expect(nativeRetentionWindowComplete('2026-10-07', '2026-10-14', 1)).toBe(false);
    expect(nativeRetentionWindowComplete('2026-10-07', '2026-10-14', null)).toBe(false);
    expect(nativeRetentionWindowComplete('2026-10-07', null, 0)).toBe(false);
    expect(nativeRetentionWindowComplete(null, '2026-10-14', 0)).toBe(false);
    expect(nativeRetentionWindowComplete('2026-02-30', '2026-03-20', 0)).toBe(false);
  });
  it('bounds production raw reads to the repaired export history without changing the requested reporting window',()=>{
    const before={startDate:'2026-09-28',endDate:'2026-10-04'};
    const spanning={startDate:'2026-07-10',endDate:'2026-10-07'};
    expect(androidCaptureQueryRange(before)).toBeNull();
    expect(androidCaptureQueryRange(spanning)).toEqual({startDate:'2026-10-07',endDate:'2026-10-07'});
    expect(spanning.startDate).toBe('2026-07-10');
    expect(androidCaptureQueryRange(before,'uat')).toEqual(before);
    expect(androidCaptureQueryRange({startDate:'2026-10-08',endDate:'2026-10-09'})).toEqual({startDate:'2026-10-08',endDate:'2026-10-09'});
  });
  it('guards incomplete Android history when either period contributes, including the partial cutover day',()=>{
    expect(androidComparisonCoverage(0,3,'2026-10-06')).toBe(false);
    expect(androidComparisonCoverage(3,0,'2026-10-07')).toBe(false);
    expect(androidComparisonCoverage(3,0,'2026-10-08')).toBe(true);
    expect(androidComparisonCoverage(0,0,'2026-09-28')).toBe(true);
  });
  it('separates new Android package and stream from iOS and legacy Android', () => {
    expect(oneAndroidSql()).toContain("app_info.id = 'com.hussh.app'");
    expect(oneAndroidSql()).toContain("stream_id = '15395548050'");
    expect(oneAndroidSql('uat')).toContain("stream_id = '15395713075'");
    expect(oneAndroidSql()).not.toContain("'com.hushh.app'");
    expect(oneAndroidSql()).toContain("key = 'debug_mode'");
    expect(oneSurfaceSql('one.hushh.ai')).toContain("platform = 'IOS' AND app_info.id = 'com.hushh.app'");
    expect(() => oneAndroidSql('invalid')).toThrow();
    expect(oneFounderSurfaceSql('one.hushh.ai')).toContain("key = 'env') = 'production'");
  });
  it('does not invent zero accounts or recovered history for an empty/failed export', () => {
    const range = {startDate:'2026-09-28',endDate:'2026-10-07'};
    expect(androidCaptureResult({rows:[{events:0}]}, range)).toMatchObject({state:'waiting',events:null,identifiedAccounts:null});
    expect(androidCaptureResult({rows:[],error:'failure'},range)).toMatchObject({state:'unavailable',firstOpens:null});
    expect(androidCaptureResult({rows:[{events:5,firstOpens:0,boundAppIds:1,identifiedAccounts:1,activeAppIds:1}]},range))
      .toMatchObject({state:'observed',firstOpens:null,firstOpenCoverage:'unverified_backend_environment',identifiedAccounts:1});
    expect(androidCaptureResult({rows:[{events:5,boundAppIds:0,identifiedAccounts:0}]},range).identifiedAccounts).toBeNull();
    const releases = androidCaptureResult({rows:[{events:5,releases:[{events:null},{events:undefined},{events:''},{events:'0'},{events:'5'}]}]},range).releases;
    expect(releases.map(row=>row.events)).toEqual([null,null,null,0,5]);
  });
});
import { readPlatformCapture, unpackPlatformCapture } from '../src/server/one-platform-capture';
import { vi } from 'vitest';

const platform = {platform:'WEB',users:1,events:2,activeDeviceIds:1,activeAccounts:1,routeVisits:1,namedRouteVisits:1,distinctScreens:1,topProductScreens:[{routeId:'home',visits:1}]};
const envelope = {platforms:[platform],androidCapture:{events:2,activeAppIds:1,identifiedAccounts:1,boundAppIds:1,firstOpens:0,routeVisits:1,observedSince:'2026-10-07',latestEventAt:{value:'2026-10-07T12:00:00Z'},releases:[{version:'1.3.9',installer:'com.android.vending',environment:'production',events:2}]}};
const queries = {baseline:'baseline',combined:'combined'};
const estimate = (bytes:number) => [{metadata:{statistics:{totalBytesProcessed:String(bytes)}}}];

describe('Android shared aggregate read regression',()=>{
  it('bounds the combined scan and preserves exact response without leaking extra fields',async()=>{
    const reader={createQueryJob:vi.fn().mockResolvedValueOnce(estimate(1000)).mockResolvedValueOnce(estimate(2000)),query:vi.fn().mockResolvedValue([[{...envelope,privateIdentity:'sentinel'}]])};
    const result=unpackPlatformCapture(await readPlatformCapture(reader,queries));
    expect(result.platforms.rows).toEqual([platform]);
    expect(result.androidCapture.rows[0]).toMatchObject({events:2,activeAppIds:1,identifiedAccounts:1});
    expect(JSON.stringify(result)).not.toContain('sentinel');
    expect(reader.query).toHaveBeenCalledExactlyOnceWith({query:'combined',location:'US',maximumBytesBilled:'100001000',jobTimeoutMs:30000});
  });
  it.each(['over_budget','estimate_failed'])('keeps platforms after optional %s without a second paid scan',async(kind)=>{
    const dry=vi.fn().mockResolvedValueOnce(estimate(1000));
    if(kind==='over_budget') dry.mockResolvedValueOnce(estimate(100001001)); else dry.mockRejectedValueOnce(new Error('private provider error'));
    const reader={createQueryJob:dry,query:vi.fn().mockResolvedValue([[platform]])};
    const result=unpackPlatformCapture(await readPlatformCapture(reader,queries));
    expect(result.platforms.rows).toEqual([platform]);
    expect(result.androidCapture.error).toBeTruthy();
    expect(reader.query).toHaveBeenCalledTimes(1);
    expect(reader.query.mock.calls[0][0]).toMatchObject({query:'baseline',maximumBytesBilled:'100001000',jobTimeoutMs:30000});
  });
  it('does not run a second scan after a paid query failure',async()=>{
    const reader={createQueryJob:vi.fn().mockResolvedValue(estimate(1000)),query:vi.fn().mockRejectedValue(new Error('private error'))};
    const result=unpackPlatformCapture(await readPlatformCapture(reader,queries));
    expect(reader.query).toHaveBeenCalledTimes(1);
    expect(result.platforms.error).toBeTruthy();
    expect(JSON.stringify(result)).not.toContain('private error');
  });
  it('uses the job deadline before capture history and returns explicit waiting',async()=>{
    const reader={createQueryJob:vi.fn(),query:vi.fn().mockResolvedValue([[platform]])};
    const result=unpackPlatformCapture(await readPlatformCapture(reader,{...queries,combined:null}));
    expect(reader.createQueryJob).not.toHaveBeenCalled();
    expect(reader.query.mock.calls[0][0].jobTimeoutMs).toBe(30000);
    expect(result.androidCapture).toEqual({rows:[{events:0}],error:null});
  });
  it('bounds hung dry-runs and never schedules a late scan',async()=>{
    vi.useFakeTimers();
    try {
      const reader={createQueryJob:vi.fn().mockImplementation(()=>new Promise(()=>{})),query:vi.fn()};
      const pending=readPlatformCapture(reader,queries);
      await vi.advanceTimersByTimeAsync(40001);
      expect((await pending).error).toBeTruthy();
      expect(reader.query).not.toHaveBeenCalled();
    } finally {vi.useRealTimers();}
  });
  it.each([new Error('auth failure'),null,{rows:[]}, {rows:[{platforms:[{platform:'WEB'}],androidCapture:{events:0}}]}, {rows:[{...envelope,platforms:[platform,platform]}]}])('rejects malformed platform envelopes',value=>{
    expect(unpackPlatformCapture(value).platforms.error).toBeTruthy();
  });
  it.each(['',false,null,undefined,-1,'NaN',1.5])('never converts malformed capture count %s into zero',events=>{
    const result=unpackPlatformCapture({rows:[{...envelope,androidCapture:{...envelope.androidCapture,events}}],error:null});
    expect(result.platforms.error).toBeNull();
    expect(result.androidCapture.error).toBeTruthy();
  });
});

it('refreshes platform rows through one cache owner while reusing bounded capture metadata',async()=>{
  vi.useFakeTimers();
  try {
    const source=readFileSync(new URL('../server.ts',import.meta.url),'utf8');
    const seam=source.slice(source.indexOf('const platformCaptureCache ='),source.indexOf('async function fetchOneAppSummary('));
    expect(seam).toContain('queryOnePlatformCapture');
    const uncached=vi.fn().mockResolvedValue({rows:[{...platform,events:3}],error:null});
    const nestedCache=vi.fn().mockResolvedValue({rows:[platform],error:null});
    const captureRead=vi.fn().mockResolvedValue({rows:[envelope],error:null});
    const read=new Function('crypto','analyticsQueryContext','queryCache','queryBigQuerySqlUncached','queryBigQuerySql','bigQueryClient','readPlatformCapture',
      ts.transpile(seam,{target:ts.ScriptTarget.ES2022})+';return queryOnePlatformCapture;')(
        crypto,{getStore:()=>({refresh:false})},new AggregateCache({freshMs:30000,maxAgeMs:30000,maxEntries:128}),
        uncached,nestedCache,async()=>({}),captureRead);
    const first=unpackPlatformCapture(await read('project',queries));
    expect(first.platforms.rows[0].events).toBe(2);
    await vi.advanceTimersByTimeAsync(30001);
    const second=unpackPlatformCapture(await read('project',queries));
    expect(second.platforms.rows[0].events).toBe(3);
    expect(second.androidCapture).toEqual(first.androidCapture);
    expect(captureRead).toHaveBeenCalledTimes(1);
    expect(uncached).toHaveBeenCalledTimes(1);
    expect(nestedCache).not.toHaveBeenCalled();
  } finally {vi.useRealTimers();}
});
