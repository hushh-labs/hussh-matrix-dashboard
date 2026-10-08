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
      .toMatchObject({state:'observed',firstOpens:0,identifiedAccounts:1});
    expect(androidCaptureResult({rows:[{events:5,boundAppIds:0,identifiedAccounts:0}]},range).identifiedAccounts).toBeNull();
    const releases = androidCaptureResult({rows:[{events:5,releases:[{events:null},{events:undefined},{events:''},{events:'0'},{events:'5'}]}]},range).releases;
    expect(releases.map(row=>row.events)).toEqual([null,null,null,0,5]);
  });
});
