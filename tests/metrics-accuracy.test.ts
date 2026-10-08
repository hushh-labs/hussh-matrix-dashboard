import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { oneRetentionCohort, oneRetentionSql } from '../src/server/one-retention.mjs';
import { hushhTechWindowMatches, hushhTechPeriodValue } from '../src/server/hushhtech-window.mjs';
import { ga4RecentCalendarRange } from '../src/server/ga4-windows.mjs';
import { Retention } from '../src/components/OneAppPanel';
import { buildHushhTechSevenDayMetrics, buildHushhTechReportTotals } from '../src/lib/analytics-service';
import type { OneAppSummary, HushhTechMetricsSummary } from '../src/lib/types';

describe('retention measurement availability', () => {
  const complete = {cohortWeek:'2026-09-20',cohortSize:10,returnedW1:0,completeDays:14,incompleteSourceDevices:0,dataThrough:'2026-10-06'};
  it('keeps complete zero separate from partial, missing, malformed and invalid counts', () => {
    expect(oneRetentionCohort(complete)).toMatchObject({rateW1:0,returnedW1:0,windowComplete:true,state:'available'});
    for (const change of [{completeDays:13},{completeDays:null},{incompleteSourceDevices:1},{incompleteSourceDevices:null}]) {
      expect(oneRetentionCohort({...complete,...change})).toMatchObject({rateW1:null,returnedW1:null,windowComplete:false});
    }
    for (const change of [{cohortSize:null},{returnedW1:null},{returnedW1:11},{returnedW1:-1},{returnedW1:''}]) {
      expect(oneRetentionCohort({...complete,...change})).toMatchObject({rateW1:null,state:'unavailable'});
    }
  });
  it('includes a mature last cohort and weights cohort sizes, rather than averaging rates', () => {
    const retention = [oneRetentionCohort(complete),oneRetentionCohort({...complete,cohortWeek:'2026-09-27',cohortSize:90,returnedW1:45})];
    const html=renderToStaticMarkup(createElement(Retention,{one:{retention} as OneAppSummary}));
    expect(html).toContain('45%'); expect(html).toContain('50.0%'); expect(html).not.toContain('Awaiting complete data');
    const pending=renderToStaticMarkup(createElement(Retention,{one:{retention:[oneRetentionCohort({...complete,completeDays:13,returnedW1:0})]} as OneAppSummary}));
    expect(pending).toContain('Awaiting complete data'); expect(pending).not.toMatch(/>0(?:\.0)?%</);
  });
  it('withholds rates from older API schemas without coverage proof', () => {
    const html=renderToStaticMarkup(createElement(Retention,{one:{retention:[{cohortWeek:'2026-09-20',cohortSize:10,returnedW1:0,rateW1:0}]} as OneAppSummary}));
    expect(html).toContain('Awaiting complete data'); expect(html).not.toMatch(/>0(?:\.0)?%</);
  });
  it('distinguishes a failed query from an empty observed cohort history', () => {
    const render=(available:boolean)=>renderToStaticMarkup(createElement(Retention,{one:{retention:[],retentionAvailable:available} as OneAppSummary}));
    expect(render(false)).toContain('temporarily unavailable');
    expect(render(true)).toContain('No observed first-visit');
  });
  it('anchors cohorts to observed acquisition, not lifetime first touch on surviving activity', () => {
    const sql=oneRetentionSql({table:'events',tables:'tables',suffixFilter:'TRUE',surfaceFilter:'scope',meaningful:'activity',deviceKeySql:'device',startDate:'2026-07-17',endDate:'2026-10-08',androidCompleteFrom:'2026-10-08'});
    expect(sql).toContain("event_name = 'first_visit'"); expect(sql).toContain("event_name = 'first_open'");
    expect(sql).not.toContain('user_first_touch_timestamp'); expect(sql).toContain('INTERVAL 13 DAY');
    expect(sql).toContain("r'^events_[0-9]{8}$'"); expect(sql).toContain('LIMIT 8');
  });
});

describe('HushhTech reporting truth', () => {
  it('does not copy selected-month totals into one-day or seven-day source cards', () => {
    const month={window:{startDate:'2026-09-01',endDate:'2026-09-30',days:30}};
    expect(hushhTechPeriodValue(month, 250, 1)).toBeNull();
    expect(hushhTechPeriodValue(month, 250, 7)).toBeNull();
    const week={window:{startDate:'2026-09-24',endDate:'2026-09-30',days:7}};
    expect(hushhTechPeriodValue(week, 0, 7)).toBe(0);
    expect(hushhTechPeriodValue(week, null, 7)).toBeNull();
    expect(hushhTechPeriodValue(week, 250, 1)).toBeNull();
  });
  it('requires valid provider boundaries, not merely a claimed period length', () => {
    for(const window of [{days:7},{startDate:'2026-09-01',endDate:'2026-09-30',days:7},{startDate:'2026-02-30',endDate:'2026-03-06',days:7}]) {
      expect(hushhTechPeriodValue({window}, 100, 7)).toBeNull();
    }
  });
  it('does not relabel a rolling response as a historical interval', () => {
    const range={startDate:'2026-09-01',endDate:'2026-09-30'};
    expect(hushhTechWindowMatches({window:range},range)).toBe(true);
    expect(hushhTechWindowMatches({window:{startDate:'2026-09-09',endDate:'2026-10-08'}},range)).toBe(false);
    expect(hushhTechWindowMatches({},range)).toBe(false);
  });
  it('does not present failed funnel or infrastructure reads as zero in the selected-range report', () => {
    const report={businessFunnel:{source:'unavailable',overview:{signups:0,persistedUsers:0}},traffic:{available:false,source:'unavailable',overview:{}},gcp:{available:false,requestCount:0}} as HushhTechMetricsSummary;
    const rows=buildHushhTechSevenDayMetrics(report);
    expect(rows.find(row=>row.label==='Signups')?.displayValue).toBe('Unavailable');
    expect(rows.find(row=>row.label==='Persisted Users')?.displayValue).toBe('Unavailable');
    expect(rows.find(row=>row.label==='Cloud Run Requests')?.displayValue).toBe('Waiting');
    expect(rows.some(row=>row.label.startsWith('7d'))).toBe(false);
    report.businessFunnel.source='verified business source';
    expect(buildHushhTechSevenDayMetrics(report).find(row=>row.label==='Signups')).toMatchObject({value:0,displayValue:undefined});
  });
  it('does not use monthly activity or period persisted users as registered account totals', () => {
    const report={window:{startDate:'2026-09-01',endDate:'2026-09-30',days:30},audience:{mau:100},businessFunnel:{source:'unavailable',overview:{signups:0,persistedUsers:0}}} as HushhTechMetricsSummary;
    const rows=buildHushhTechReportTotals(report);
    for(const label of ['Total Users','Signups','Persisted Users','Cloud Run Requests','Collected Events','Search Clicks']) expect(rows.find(row=>row.label===label)?.displayValue).toBe('Unavailable');
    report.supabase={rangeTotals:{totalUsers:0},metrics:[]} as HushhTechMetricsSummary['supabase'];
    expect(buildHushhTechReportTotals(report).find(row=>row.label==='Total Users')).toMatchObject({value:0,displayValue:undefined});
  });
});

describe('GA4 inclusive reporting days', () => {
  it('requests exactly the labelled calendar-day count, including today', () => {
    for(const days of [1,7,30,90]) {
      const range=ga4RecentCalendarRange(days);
      const daysBack=range.startDate==='today'?0:Number(range.startDate.replace('daysAgo',''));
      expect(daysBack+1).toBe(days); expect(range.endDate).toBe('today');
    }
    for(const invalid of [0,91,1.5,NaN]) expect(()=>ga4RecentCalendarRange(invalid)).toThrow();
  });
});
