import { describe, expect, it } from 'vitest';
import { adaptRetainedOneAgentDetail } from '../src/server/reports/one-agent-detail-retained-adapter';
const period = {startDate:'2026-11-01',endDate:'2026-11-18',timezone:'UTC'};
const context = {environment:'uat' as const,scopeDigest:'a'.repeat(64),period,checkedAt:'2026-11-19T00:00:00Z',watermark:null};
const feature = {accounts:2,devices:3,signals:4,successes:1,expectedErrors:0,failures:1,outcomeSignals:2};
const summary = () => ({reportingEnvironment:'uat',reportingScopeVersion:'one-environment-v1',
  range:{startDate:period.startDate,endDate:period.endDate,days:18},activeUsers:{countingUnit:'device'},
  identifiedUsers:{countingUnit:'account',selectedRange:{startDate:period.startDate,endDate:period.endDate}},
  featureUsageAvailable:true,locationBehaviorAvailable:true,featureUsage:{daily_signin:feature, sms_safety:{...feature,accounts:5}},
  locationAnalytics:{features:[{key:'sms_safety',users:8,events:9,successes:2,expectedErrors:null,failures:1}]}});
describe('retained One feature subset adapter', () => {
  it('preserves environment, source scope and location-versus-feature dimensions without inventing totals', () => {
    const p=adaptRetainedOneAgentDetail(summary(),context);
    expect(p.environment).toBe('uat'); expect(p.source.coverage).toBe('intraday_or_unknown');
    expect(p.rows.find(r=>r.key==='daily_signin')?.counts).toEqual(feature);
    expect(p.rows.find(r=>r.key==='sms_safety')?.counts).toMatchObject({accounts:5,devices:8,signals:9,outcomeSignals:null});
    expect(p.rows.find(r=>r.key==='inbox_viewed')).toMatchObject({state:'unavailable',counts:null});
  });
  it('fails closed across environments, ranges and malformed counts', () => {
    expect(() => adaptRetainedOneAgentDetail(summary(),{...context,environment:'production'})).toThrow();
    expect(() => adaptRetainedOneAgentDetail(summary(),{...context,period:{...period,endDate:'2026-11-17'}})).toThrow();
    const bad=summary(); bad.reportingScopeVersion='wrong'; expect(() => adaptRetainedOneAgentDetail(bad,context)).toThrow();
    const unit=summary(); unit.activeUsers.countingUnit='account'; expect(() => adaptRetainedOneAgentDetail(unit,context)).toThrow();
    const s=summary(); s.featureUsage.daily_signin={...feature,signals:-1}; expect(() => adaptRetainedOneAgentDetail(s,context)).toThrow();
  });
  it('does not turn source failure or absent sparse rows into zero', () => {
    const s=summary(); s.featureUsageAvailable=false; s.locationBehaviorAvailable=false;
    const p=adaptRetainedOneAgentDetail(s,context);
    expect(p.rows.every(r=>r.state==='unavailable' && r.counts===null)).toBe(true);
  });
  it('does not treat a zero-filled Location row as observed without a source-row witness', () => {
    const s=summary(); s.locationAnalytics.features[0].events=0;
    expect(adaptRetainedOneAgentDetail(s,context).rows.find(r=>r.key==='sms_safety')).toMatchObject({state:'unavailable',counts:null});
  });
  it('keeps source-success measured zero distinct from missing dimensions', () => {
    const s=summary(); s.featureUsage.daily_signin={...feature,accounts:0,signals:0};
    const p=adaptRetainedOneAgentDetail(s,context);
    expect(p.rows.find(r=>r.key==='daily_signin')?.counts).toMatchObject({accounts:0,signals:0});
  });
});
