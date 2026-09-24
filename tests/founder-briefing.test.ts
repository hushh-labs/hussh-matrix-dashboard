import { describe, expect, it } from 'vitest';
import {
  founderChangeLabel, founderCustomRange, founderLatestCompleteDate, founderMonthRange,
  founderPresetRange, founderTrend,
} from '../src/lib/founder-briefing';

describe('founder briefing comparisons', () => {
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
