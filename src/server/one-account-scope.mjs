import { createHash } from 'node:crypto';

/** Public stable authority reference without exposing internal project names. */
export function oneIdentityAuthorityId(project) {
  return project ? `sha256:${createHash('sha256').update(project).digest('hex')}` : '';
}

/** Environment identity authority. Never infer UAT membership from a PROD registry. */
export function oneAccountSource(environment, env = process.env) {
  if (!['production', 'uat'].includes(environment)) throw new Error('Invalid One account environment');
  const production = (env.ONE_PROD_FIREBASE_AUTH_PROJECT || env.ONE_FIREBASE_AUTH_PROJECT || 'hushh-pda').trim();
  const uat = (env.ONE_UAT_FIREBASE_AUTH_PROJECT || '').trim();
  const project = environment === 'production' ? production : uat;
  const declared = environment === 'production'
    ? env.ONE_PROD_ACCOUNT_REGISTRY_SCOPE || 'legacy_shared'
    : env.ONE_UAT_ACCOUNT_REGISTRY_SCOPE || 'unverified';
  if (!['isolated', 'legacy_shared', 'unverified'].includes(declared)) throw new Error('Invalid One account registry scope');
  const projectsSeparate = !!production && !!uat && production !== uat;
  const isolated = declared === 'isolated' && projectsSeparate;
  const registryScope = !project ? 'unconfigured' : isolated ? 'isolated' : declared === 'legacy_shared' || !projectsSeparate ? 'legacy_shared' : 'unverified';
  return {
    environment, project,
    registryScope,
    sharedAcrossEnvironments: declared === 'legacy_shared' || (!!uat && production === uat),
    identityRealm: `${environment === 'production' ? 'PROD' : 'UAT'} One account registry`,
    // Include source and scope even when date ranges match. Never share in-flight promises.
    cacheNamespace: `${environment}:${production}:${uat}:${registryScope}`,
  };
}

/** Reduce private Firebase records immediately; never return identifiers or profiles. */
export async function readOneAccountCounts(range, fetchPage, maxPages = 10_000) {
  const seen = new Set();
  const tokens = new Set();
  const daily = new Map();
  let newAccounts = 0, accountsCreatedByRangeEnd = 0, disabledAccounts = 0;
  let nextPageToken = '', pages = 0;
  do {
    if (++pages > maxPages) throw new Error('Account pagination exceeded the safety limit');
    const body = await fetchPage(nextPageToken);
    for (const account of body.users || []) {
      if (typeof account.localId !== 'string' || !account.localId || seen.has(account.localId)) continue;
      seen.add(account.localId);
      if (account.disabled === true) disabledAccounts++;
      if (!/^\d+$/.test(String(account.createdAt ?? ''))) continue;
      const date = new Date(Number(account.createdAt));
      if (!Number.isFinite(date.getTime())) continue;
      const day = date.toISOString().slice(0, 10);
      if (day <= range.endDate) accountsCreatedByRangeEnd++;
      if (day >= range.startDate && day <= range.endDate) {
        newAccounts++;
        daily.set(day, (daily.get(day) || 0) + 1);
      }
    }
    nextPageToken = typeof body.nextPageToken === 'string' ? body.nextPageToken : '';
    if (nextPageToken && tokens.has(nextPageToken)) throw new Error('Account pagination repeated a token');
    if (nextPageToken) tokens.add(nextPageToken);
  } while (nextPageToken);
  return {
    totalAccounts: seen.size, newAccounts, accountsCreatedByRangeEnd, disabledAccounts,
    daily: [...daily].map(([date, newAccounts]) => ({ date, newAccounts })),
  };
}

export function accountScopeNote(source) {
  if (!source.project) return 'UAT account reporting is not configured. Production accounts are never used as a fallback.';
  if (source.registryScope === 'legacy_shared') return 'This registry contains legacy shared-environment accounts. Environment-specific registrations are withheld until account membership is verified; moving UAT does not reclassify existing PROD accounts.';
  if (source.registryScope !== 'isolated') return 'Account-source isolation has not been verified for this environment. Registry totals are not presented as environment-specific registrations.';
  return 'Current account records in the verified environment registry. One account is not proof of one unique human; deleted records are absent and disabled records are included separately.';
}

/** Contract checks used by probes; unavailable counts must not become zeros. */
export function oneAccountSummaryIssues(summary, environment) {
  if (!summary || summary.countingUnit !== 'account' || summary.environment !== environment) return ['Missing environment account contract'];
  if (typeof summary.available !== 'boolean' || !['isolated','production_contacts','legacy_shared','unverified','unconfigured'].includes(summary.registryScope)) return ['Invalid registry availability/scope'];
  const fields = ['totalAccounts', 'newAccounts', 'accountsCreatedByRangeEnd', 'disabledAccounts'];
  if (!summary.available) {
    return fields.every(key => summary[key] === null) && (summary.daily || []).every(row => row.newAccounts === null) && !!summary.note
      ? [] : ['Unverified registry must withhold counts'];
  }
  if (summary.registryScope === 'production_contacts' ? environment !== 'production' : summary.registryScope !== 'isolated' || summary.sharedAcrossEnvironments !== false) return ['Shared/unverified registry cannot report environment registrations'];
  if (!/^sha256:[a-f0-9]{64}$/.test(summary.identityAuthorityId || '')) return ['Registry authority is missing'];
  if (!fields.every(key => Number.isSafeInteger(summary[key]) && summary[key] >= 0)) return ['Invalid account counts'];
  if (summary.newAccounts > summary.accountsCreatedByRangeEnd || summary.accountsCreatedByRangeEnd > summary.totalAccounts || summary.disabledAccounts > summary.totalAccounts) return ['Account counts do not reconcile'];
  if ((summary.daily || []).reduce((n, row) => n + row.newAccounts, 0) !== summary.newAccounts) return ['Daily registrations do not reconcile'];
  return [];
}
