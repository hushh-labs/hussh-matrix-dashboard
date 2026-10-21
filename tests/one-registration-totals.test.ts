import { describe, expect, it } from 'vitest';
import { readOneAccountCounts, oneAccountSource } from '../src/server/one-account-scope.mjs';
import { registrationTotals, registrationTotalsIssues } from '../src/server/one-registration-totals.mjs';
import { sanitizePublicPayload } from '../server';

describe('shared One registration totals', () => {
  const range = { startDate: '2026-10-01', endDate: '2026-10-21' };
  it('restores real directory totals without declaring either environment isolated', async () => {
    const counts = await readOneAccountCounts(range, async () => ({ users: [
      { localId: 'qa-old', createdAt: String(Date.parse('2026-09-01')), email: 'private@example.invalid' },
      { localId: 'qa-new', createdAt: String(Date.parse('2026-10-02')), disabled: true },
      { localId: 'qa-new', createdAt: String(Date.parse('2026-10-02')) },
    ] }));
    const result = sanitizePublicPayload(registrationTotals(range, 'qa-directory', counts));
    expect(result).toMatchObject({ available: true, scope: 'all_one_accounts', totalAccounts: 2, newAccounts: 1, disabledAccounts: 1 });
    expect(registrationTotalsIssues(result)).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/private@|qa-new|qa-old|localId|email|qa-directory/);
    expect(oneAccountSource('production', {}).registryScope).toBe('legacy_shared');
    expect(oneAccountSource('uat', {}).registryScope).toBe('unconfigured');
  });
  it('keeps an observed zero distinct from a failed registry read', () => {
    const empty = registrationTotals(range, 'qa-directory', { totalAccounts: 0, newAccounts: 0, accountsCreatedByRangeEnd: 0, disabledAccounts: 0, daily: [] });
    expect(empty).toMatchObject({ available: true, totalAccounts: 0, newAccounts: 0 });
    expect(registrationTotalsIssues(empty)).toEqual([]);
    const failed = registrationTotals(range, 'qa-directory', null);
    expect(failed).toMatchObject({ available: false, totalAccounts: null, newAccounts: null });
    expect(registrationTotalsIssues(failed)).toEqual([]);
  });
  it('rejects mislabelled environment totals and inconsistent counts', () => {
    const good = registrationTotals(range, 'qa-directory', { totalAccounts: 5, newAccounts: 1, accountsCreatedByRangeEnd: 5, disabledAccounts: 0, daily: [{date:'2026-10-02',newAccounts:1}] });
    expect(registrationTotalsIssues({...good,environment:'uat'})).not.toEqual([]);
    expect(registrationTotalsIssues({...good,newAccounts:6})).not.toEqual([]);
    expect(registrationTotalsIssues({...good,daily:[]})).not.toEqual([]);
  });
});
