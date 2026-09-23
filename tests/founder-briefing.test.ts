import { describe, expect, it } from 'vitest';
import { founderChangeLabel, founderTrend } from '../src/lib/founder-briefing';

describe('founder briefing comparisons', () => {
  it('shows an increase or decrease only against the same nonzero measure', () => {
    expect(founderTrend({ current: 12, previous: 10 })).toEqual({ trend: 'up', percent: 20 });
    expect(founderTrend({ current: 8, previous: 10 })).toEqual({ trend: 'down', percent: -20 });
    expect(founderChangeLabel({ current: 8, previous: 10 })).toBe('-20.0% vs previous 30 days');
  });

  it('does not invent a percentage when the earlier period was zero', () => {
    expect(founderTrend({ current: 5, previous: 0 })).toEqual({ trend: 'new', percent: null });
    expect(founderChangeLabel({ current: 5, previous: 0 })).toContain('previous period was 0');
    expect(founderTrend({ current: 0, previous: 0 })).toEqual({ trend: 'flat', percent: 0 });
  });

  it('keeps missing or invalid source values neutral', () => {
    expect(founderTrend({ current: null, previous: 10 })).toEqual({ trend: 'unavailable', percent: null });
    expect(founderTrend({ current: 10, previous: Number.NaN })).toEqual({ trend: 'unavailable', percent: null });
    expect(founderChangeLabel({ current: null, previous: null })).toBe('Comparison unavailable');
  });
});
