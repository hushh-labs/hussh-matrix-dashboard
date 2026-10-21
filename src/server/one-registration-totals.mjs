import { oneIdentityAuthorityId } from './one-account-scope.mjs';

/** The shared directory is measured separately from PROD/UAT membership. */
export function registrationTotals(range, project, counts, generatedAt = new Date().toISOString()) {
  return {
    available: counts !== null,
    scope: /** @type {const} */ ('all_one_accounts'),
    sourceLabel: 'Firebase Authentication',
    identityAuthorityId: oneIdentityAuthorityId(project),
    countingUnit: /** @type {const} */ ('account'),
    deduplication: 'One immutable Firebase account ID counted once',
    totalAccounts: counts?.totalAccounts ?? null,
    newAccounts: counts?.newAccounts ?? null,
    accountsCreatedByRangeEnd: counts?.accountsCreatedByRangeEnd ?? null,
    disabledAccounts: counts?.disabledAccounts ?? null,
    startDate: range.startDate, endDate: range.endDate, generatedAt,
    daily: counts?.daily ?? [],
    note: counts
      ? 'Registration totals cover the shared One account registry across Main and Test. New registrations use the original account creation date. Disabled accounts are included; deleted accounts are absent. Activity counts follow the selected environment separately.'
      : 'All-One registration totals are temporarily unavailable from the account registry.',
  };
}

export function registrationTotalsIssues(summary) {
  if (!summary || summary.scope !== 'all_one_accounts' || summary.countingUnit !== 'account' ||
      typeof summary.available !== 'boolean' || !/^sha256:[a-f0-9]{64}$/.test(summary.identityAuthorityId || '') ||
      ['environment', 'registryScope', 'sharedAcrossEnvironments'].some(key => key in summary)) return ['Invalid global registration scope'];
  const fields = ['totalAccounts', 'newAccounts', 'accountsCreatedByRangeEnd', 'disabledAccounts'];
  if (!Array.isArray(summary.daily)) return ['Registration daily counts are missing'];
  if (!summary.available) return fields.every(key => summary[key] === null) && summary.daily?.length === 0
    ? [] : ['Unavailable registration totals must not report counts'];
  if (!fields.every(key => Number.isSafeInteger(summary[key]) && summary[key] >= 0)) return ['Invalid registration counts'];
  if (!summary.daily.every(row => typeof row.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.date) &&
      row.date >= summary.startDate && row.date <= summary.endDate && Number.isSafeInteger(row.newAccounts) && row.newAccounts >= 0)) return ['Invalid daily registrations'];
  if (summary.newAccounts > summary.accountsCreatedByRangeEnd || summary.accountsCreatedByRangeEnd > summary.totalAccounts ||
      summary.disabledAccounts > summary.totalAccounts ||
      summary.daily?.reduce((n, row) => n + row.newAccounts, 0) !== summary.newAccounts) return ['Registration totals do not reconcile'];
  return [];
}
