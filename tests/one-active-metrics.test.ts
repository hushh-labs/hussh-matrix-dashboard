import { describe, expect, it } from 'vitest';
import { oneActiveQueryAvailable } from '../src/server/one-active-metrics';

describe('One active query evidence', () => {
  const row = { asOf: '2026-10-19', dau: 10, wau: 20, mau: 30,
    dauAccounts: 7, wauAccounts: 17, mauAccounts: 27,
    dauIdentifiedDevices: 8, wauIdentifiedDevices: 18, mauIdentifiedDevices: 28 };
  it('accepts healthy counts, provider numeric strings and measured zeros', () => {
    expect(oneActiveQueryAvailable({ rows: [row], error: null })).toBe(true);
    expect(oneActiveQueryAvailable({ rows: [{ ...row, dau: '10' }] })).toBe(true);
    const empty = Object.fromEntries(Object.keys(row).map((key) => [key, key === 'asOf' ? row.asOf : 0]));
    expect(oneActiveQueryAvailable({ rows: [empty] })).toBe(true);
  });
  it('withholds failed, absent and malformed aggregate reads instead of confirming a fabricated zero', () => {
    for (const result of [{ rows: [], error: null }, { rows: [row], error: 'provider read failed' },
      { rows: [{}] }, { rows: [row, row] }, ...[
        { asOf: null }, { asOf: '2026-02-30' }, { dau: null }, { dau: '' }, { dau: -1 },
        { dau: 1.2 }, { dau: 21 }, { mauAccounts: 16 }, { dauIdentifiedDevices: 11 },
      ].map((change) => ({ rows: [{ ...row, ...change }] }))]) {
      expect(oneActiveQueryAvailable(result)).toBe(false);
    }
  });
});
