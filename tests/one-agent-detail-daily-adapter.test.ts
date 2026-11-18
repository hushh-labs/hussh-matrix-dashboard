import { expect, it } from 'vitest';
import { adaptVerifiedDailyOneDetail } from '../src/server/reports/one-agent-detail-daily-adapter';
const period={startDate:'2026-11-18',endDate:'2026-11-18',timezone:'UTC'};
const expected={environment:'uat' as const,reportScopeDigest:'a'.repeat(64),manifestScopeDigest:'b'.repeat(64),period};
const snapshot=()=>({computedAt:Date.parse('2026-11-18T12:00:00Z'),warehouseThrough:Date.parse('2026-11-18T11:59:00Z'),
  scopeProvenance:{reportScopeDigest:expected.reportScopeDigest,manifestScopeDigest:expected.manifestScopeDigest},
  value:{status:200,body:{one:{error:null,data:{production:null,uat:{reportingEnvironment:'uat',reportingScopeVersion:'one-environment-v1',
    range:{...period,days:1},activeUsers:{countingUnit:'device'},identifiedUsers:{countingUnit:'account',selectedRange:period},
    featureUsageAvailable:true,featureUsage:{},locationBehaviorAvailable:true,locationAnalytics:{features:[]}}}}}}});
it('adapts a scope-bound UAT snapshot without inventing a source timestamp or watermark', () => {
  const p=adaptVerifiedDailyOneDetail(snapshot(),expected);
  expect(p.detail.source.checkedAt).toBeNull(); expect(p.detail.source.watermark).toBeNull();
  expect(p.computedAt).toBe(snapshot().computedAt); expect(p.detail.rows.every(row=>row.state==='unavailable')).toBe(true);
});
it('rejects mixed-lane and mismatched scope or manifest bindings', () => {
  const mixed=snapshot(); mixed.value.body.one.data.production={} as any;
  expect(()=>adaptVerifiedDailyOneDetail(mixed,expected)).toThrow();
  expect(()=>adaptVerifiedDailyOneDetail(snapshot(),{...expected,reportScopeDigest:'c'.repeat(64)})).toThrow();
  expect(()=>adaptVerifiedDailyOneDetail(snapshot(),{...expected,manifestScopeDigest:'d'.repeat(64)})).toThrow();
});
