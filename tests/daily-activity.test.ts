import { describe, expect, it } from 'vitest';
import { dailyAgentRow, shiftDay } from '../src/lib/daily-activity';
import type { OneCapabilityUsage } from '../src/lib/types';

const capability = { key: 'finance', label: 'Finance', instrumented: true,
  daily: [{ eventDate: '2026-09-30', users: 10 }, { eventDate: '2026-10-01', users: 4 }, { eventDate: '2026-10-02', users: 0 }, { eventDate: '2026-10-03', users: 2 }],
} as OneCapabilityUsage;

describe('daily device comparisons', () => {
  it('compares consecutive reporting dates, including month boundaries', () => {
    expect(shiftDay('2026-10-01', -1)).toBe('2026-09-30');
    expect(dailyAgentRow(capability, '2026-10-01', true)).toMatchObject({ current: 4, previous: 10, difference: -6, percent: -60 });
  });
  it('keeps genuine zero activity distinct from missing or untracked data', () => {
    expect(dailyAgentRow(capability, '2026-10-02', true)).toMatchObject({ current: 0, difference: -4, percent: -100 });
    expect(dailyAgentRow(capability, '2026-10-03', true)).toMatchObject({ current: 2, previous: 0, difference: 2, percent: null });
    for (const row of [dailyAgentRow(capability, '2026-10-01', false), dailyAgentRow({ ...capability, instrumented: false }, '2026-10-01', true)]) {
      expect(row).toMatchObject({ current: null, previous: null, difference: null, percent: null });
    }
  });
  it('does not compare across missing days or invent a previous day outside the selected range', () => {
    expect(dailyAgentRow(capability, '2026-09-30', true)).toMatchObject({ current: 10, previous: null, difference: null });
    expect(dailyAgentRow(capability, '2026-10-05', true)).toMatchObject({ current: null, previous: null, difference: null });
    expect(dailyAgentRow(capability, '', false).difference).toBeNull();
  });
});
