import { describe, expect, it } from 'vitest';
import {
  founderChangeLabel, founderCustomRange, founderLatestCompleteDate, founderMonthRange,
  founderOutcomeHealth, founderPresetRange, founderTrend, founderWebIdentityMeasure,
} from '../src/lib/founder-briefing';
import type { FounderAgent } from '../src/lib/founder-briefing';

function agent(overrides: Partial<FounderAgent> = {}): FounderAgent {
  return {
    key: 'memory', label: 'Memory', instrumented: true, note: null,
    identifiedAccounts: { current: 3, previous: 2 },
    successfulAccounts: { current: 2, previous: 1 },
    interactions: { current: 5, previous: 4 },
    successes: { current: 4, previous: 3 },
    expectedErrors: { current: 1, previous: 0 },
    failures: { current: 0, previous: 1 },
    outcomeSignals: { current: 5, previous: 4 },
    iosInteractions: 2, webInteractions: 3,
    ...overrides,
  };
}

describe('founder briefing comparisons', () => {
  it('summarizes only explicit governed outcomes', () => {
    expect(founderOutcomeHealth(agent())).toEqual({
      state: 'measured', successRate: 80, successes: 4, expectedErrors: 1, failures: 0,
    });
  });

  it('does not turn an unavailable or not-yet-exported outcome into zero success', () => {
    expect(founderOutcomeHealth(agent({ outcomeSignals: { current: null, previous: null } })).state).toBe('unavailable');
    expect(founderOutcomeHealth(agent({ outcomeSignals: { current: 0, previous: 0 } }))).toEqual({
      state: 'waiting', successRate: null, successes: 0, expectedErrors: 0, failures: 0,
    });
  });

  it('shows an increase or decrease only against the same nonzero measure', () => {
    expect(founderTrend({ current: 12, previous: 10 })).toEqual({ trend: 'up', percent: 20 });
    expect(founderTrend({ current: 8, previous: 10 })).toEqual({ trend: 'down', percent: -20 });
    expect(founderChangeLabel({ current: 8, previous: 10 })).toBe('-20.0% vs earlier period');
  });

  it('does not invent a percentage when the earlier period was zero', () => {
    expect(founderTrend({ current: 5, previous: 0 })).toEqual({ trend: 'new', percent: null });
    expect(founderChangeLabel({ current: 5, previous: 0 })).toContain('earlier period was 0');
    expect(founderTrend({ current: 0, previous: 0 })).toEqual({ trend: 'flat', percent: 0 });
  });

  it('keeps missing or invalid source values neutral', () => {
    expect(founderTrend({ current: null, previous: 10 })).toEqual({ trend: 'unavailable', percent: null });
    expect(founderTrend({ current: 10, previous: Number.NaN })).toEqual({ trend: 'unavailable', percent: null });
    expect(founderChangeLabel({ current: null, previous: null })).toBe('Comparison unavailable');
  });

  it('withholds web growth when the earlier sign-in cohort was not account-bound', () => {
    const platform = {
      key: 'WEB' as const, label: 'Web app',
      identifiedAccounts: { current: 20, previous: 1 },
      identityCoverage: 0.9,
      trackedIdentifiers: 40, boundIdentifiers: 36,
      signInIdentifiers: 10, signedInBoundIdentifiers: 9,
      previousTrackedIdentifiers: 100, previousBoundIdentifiers: 1,
      previousSignInIdentifiers: 50, previousSignedInBoundIdentifiers: 1,
    };
    expect(founderWebIdentityMeasure(platform)).toEqual({
      measure: { current: 20, previous: null },
      currentGap: false, previousGap: true,
    });
    expect(founderTrend(founderWebIdentityMeasure(platform).measure).percent).toBeNull();
  });

  it('withholds the web count when current sign-ins lack later account binding', () => {
    const platform = {
      key: 'WEB' as const, label: 'Web app',
      identifiedAccounts: { current: 1, previous: 10 },
      identityCoverage: 0.1,
      trackedIdentifiers: 100, boundIdentifiers: 1,
      signInIdentifiers: 50, signedInBoundIdentifiers: 1,
      previousTrackedIdentifiers: 20, previousBoundIdentifiers: 19,
      previousSignInIdentifiers: 10, previousSignedInBoundIdentifiers: 9,
    };
    expect(founderWebIdentityMeasure(platform)).toEqual({
      measure: { current: null, previous: null },
      currentGap: true, previousGap: false,
    });
  });

  it('keeps a fully bound earlier period comparable when nobody signs in again', () => {
    const platform = {
      key: 'WEB' as const, label: 'Web app',
      identifiedAccounts: { current: 20, previous: 10 },
      identityCoverage: 1,
      trackedIdentifiers: 20, boundIdentifiers: 20,
      signInIdentifiers: 10, signedInBoundIdentifiers: 10,
      previousTrackedIdentifiers: 10, previousBoundIdentifiers: 10,
      previousSignInIdentifiers: 0, previousSignedInBoundIdentifiers: 0,
    };
    expect(founderWebIdentityMeasure(platform)).toEqual({
      measure: { current: 20, previous: 10 },
      currentGap: false, previousGap: false,
    });
  });

  it('keeps every preset on completed UTC days', () => {
    const now = new Date('2026-09-24T23:30:00Z');
    expect(founderLatestCompleteDate(now)).toBe('2026-09-21');
    expect(founderPresetRange(7, now)).toEqual({ startDate: '2026-09-15', endDate: '2026-09-21', days: 7 });
    expect(founderPresetRange(30, now).days).toBe(30);
  });

  it('supports calendar-month and exact custom date filters without silent clamping', () => {
    const now = new Date('2026-09-24T12:00:00Z');
    expect(founderMonthRange('2026-08', now)).toEqual({ startDate: '2026-08-01', endDate: '2026-08-31', days: 31 });
    expect(founderMonthRange('2026-09', now)).toEqual({ startDate: '2026-09-01', endDate: '2026-09-21', days: 21 });
    expect(founderCustomRange('2026-08-22', '2026-09-20', now)?.days).toBe(30);
    expect(founderCustomRange('2026-09-23', '2026-09-24', now)).toBeNull();
    expect(founderCustomRange('2026-01-01', '2026-05-31', now)).toBeNull();
    expect(founderMonthRange('2026-13', now)).toBeNull();
  });
});
