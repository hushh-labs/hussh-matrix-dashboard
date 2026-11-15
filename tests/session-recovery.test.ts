import { afterEach, expect, it, vi } from 'vitest';
import { clearOneSelection, readOneSelection, saveOneSelection } from '../src/lib/session-recovery';
afterEach(() => vi.unstubAllGlobals());
it('keeps only a bounded One selection for same-tab sign-in and tolerates disabled storage', () => {
  const values = new Map<string, string>();
  vi.stubGlobal('sessionStorage', { setItem: (key: string, value: string) => values.set(key, value), getItem: (key: string) => values.get(key) ?? null, removeItem: (key: string) => values.delete(key) });
  const selection = { tab: 'one' as const, environment: 'uat' as const, range: { preset: 30 as const, startDate: '2026-10-16', endDate: '2026-11-14' } };
  saveOneSelection(selection); expect(readOneSelection()).toEqual(selection); expect(readOneSelection()).toEqual(selection);
  clearOneSelection(); expect(readOneSelection()).toBeNull();
  saveOneSelection({ ...selection, range: { ...selection.range, startDate: '2020-01-01' } }); expect(readOneSelection()).toBeNull();
  vi.stubGlobal('sessionStorage', { setItem() { throw new Error('disabled'); }, getItem() { throw new Error('disabled'); }, removeItem() { throw new Error('disabled'); } });
  expect(() => saveOneSelection(selection)).not.toThrow(); expect(readOneSelection()).toBeNull(); expect(() => clearOneSelection()).not.toThrow();
});
