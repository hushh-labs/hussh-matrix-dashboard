import { expect, it, vi } from 'vitest';
import { DailyOneRefresh, dailyOneManifest } from '../src/server/daily-one-refresh';
import * as cohorts from '../src/server/one-customer-cohort';
import { readDailyOneAgentDetail } from '../src/server/reports/one-agent-detail-daily-read';
const report = dailyOneManifest('2026-11-18')[5], period={startDate:'2026-11-18',endDate:'2026-11-18',timezone:'UTC'};
const expected={environment:'uat' as const, reportScopeDigest:'a'.repeat(64),manifestScopeDigest:'b'.repeat(64),cohortKey:'c'.repeat(64),period};
const cohort={cacheKey:expected.cohortKey} as any;
const snapshot=()=>({asOf:'2026-11-18T10:00:00Z',computedAt:Date.parse('2026-11-18T12:00:00Z'),warehouseFrom:1,warehouseThrough:2,
 scopeProvenance:{reportScopeDigest:expected.reportScopeDigest,manifestScopeDigest:expected.manifestScopeDigest},
 value:{status:200,body:{one:{error:null,data:{production:null,uat:{reportingEnvironment:'uat',reportingScopeVersion:'one-environment-v1',
 range:{...period,days:1},activeUsers:{countingUnit:'device'},identifiedUsers:{countingUnit:'account',selectedRange:period},
 featureUsageAvailable:true,featureUsage:{},locationBehaviorAvailable:true,locationAnalytics:{features:[]}}}}}}});
function store() { return new DailyOneRefresh({} as any,'refresh_20261118_'+'a'.repeat(16),'b'.repeat(40)); }
it('uses the verified UAT read path and retains unknown source freshness', async () => {
 const s=store(), read=vi.spyOn(s,'read').mockResolvedValue(snapshot() as any), check=vi.spyOn(cohorts,'requireCurrentCustomerCohort').mockResolvedValue(cohort);
 const result=await readDailyOneAgentDetail(s,report,expected);
 expect(read).toHaveBeenCalledWith(report,null,true,cohort); expect(check).toHaveBeenCalledTimes(2);
 expect(result.detail.source).toMatchObject({checkedAt:null,watermark:null,coverage:'intraday_or_unknown'});
 expect(result.logicalAsOf).toBe(snapshot().asOf); vi.restoreAllMocks();
});
it('does not return a snapshot if authority recheck fails or scope changes', async () => {
 const s=store(); vi.spyOn(s,'read').mockResolvedValue(snapshot() as any);
 vi.spyOn(cohorts,'requireCurrentCustomerCohort').mockResolvedValueOnce(cohort).mockRejectedValueOnce(new Error('unavailable'));
 await expect(readDailyOneAgentDetail(s,report,expected)).rejects.toThrow(); vi.restoreAllMocks();
 const other=store(); vi.spyOn(other,'read').mockResolvedValue(snapshot() as any); vi.spyOn(cohorts,'requireCurrentCustomerCohort').mockResolvedValue(cohort);
 await expect(readDailyOneAgentDetail(other,report,{...expected,reportScopeDigest:'d'.repeat(64)})).rejects.toThrow(); vi.restoreAllMocks();
});
it('rejects an unexpected range before any read', async () => {
 const s=store(), read=vi.spyOn(s,'read'), check=vi.spyOn(cohorts,'requireCurrentCustomerCohort');
 await expect(readDailyOneAgentDetail(s,report,{...expected,period:{...period,startDate:'2026-11-17'}})).rejects.toThrow();
 expect(read).not.toHaveBeenCalled(); expect(check).not.toHaveBeenCalled(); vi.restoreAllMocks();
});
