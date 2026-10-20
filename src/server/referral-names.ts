import type { ReferralSourcePage } from '../lib/referrals';

export interface DirectoryAccount {
  localId: string; disabled?: boolean; email?: string; emailVerified?: boolean;
  displayName?: string; providerUserInfo?: { displayName?: string }[];
}
export type DirectoryLookup = (criteria: { email?: string[]; localId?: string[] }) => Promise<DirectoryAccount[]>;
export interface ReferralDirectoryPage extends Omit<ReferralSourcePage, 'entries'> {
  entries: (ReferralSourcePage['entries'][number] & { profileUserId?: string | null; profileName?: string | null })[];
}
const anonymous = 'Anonymous referrer';

/** Same technical-name guard as One's directory, without email/phone fallbacks. */
export function safeReferralName(value: unknown, userId: string): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (!name || name === userId || name.includes('@') || /^ria:/i.test(name)
    || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name)
    || (!name.includes(' ') && name.length >= 20) || /^\+?[\d\s().-]{6,}$/.test(name)) return null;
  return name;
}

/** A verified dashboard email is mapped only to its enabled, verified Firebase account. */
export async function referralViewer(email: string, lookup: DirectoryLookup): Promise<string | null> {
  const expected = email.trim().toLowerCase();
  if (!expected || expected.length > 254 || !expected.includes('@')) return null;
  try {
    const accounts = await lookup({ email: [expected] });
    const matches = accounts.filter(account => account.email?.trim().toLowerCase() === expected
      && account.emailVerified === true && !account.disabled && typeof account.localId === 'string'
      && account.localId.length > 0 && account.localId.length <= 128);
    return matches.length === 1 ? matches[0].localId : null;
  } catch { return null; }
}

/** SQL supplies only viewer-eligible candidates; Firebase verifies their current lifecycle. */
export async function hydrateReferralNames(page: ReferralDirectoryPage, lookup: DirectoryLookup): Promise<ReferralSourcePage> {
  if (page.entries.length > 20) throw new Error('Referral page exceeds its bound');
  const ids = [...new Set(page.entries.filter(row => row.handle === anonymous && row.profileUserId)
    .map(row => row.profileUserId!).filter(id => typeof id === 'string' && id.length <= 128))];
  let accounts = new Map<string, DirectoryAccount>();
  if (ids.length) {
    try {
      accounts = new Map((await lookup({localId: ids})).filter(account => ids.includes(account.localId) && !account.disabled)
        .map(account => [account.localId, account]));
    } catch { /* No visibility/lifecycle proof means no profile name. Scores stay available. */ }
  }
  return { state: page.state, snapshotId: page.snapshotId, snapshotGeneratedAt: page.snapshotGeneratedAt,
    entryCount: page.entryCount, nextAfterRank: page.nextAfterRank,
    entries: page.entries.map(({ rank, handle, points, profileUserId, profileName }) => {
      const account = profileUserId ? accounts.get(profileUserId) : undefined;
      const name = account ? safeReferralName(profileName, profileUserId!)
        ?? [account.displayName, ...(Array.isArray(account.providerUserInfo) ? account.providerUserInfo : []).map(provider => provider.displayName)]
          .map(value => safeReferralName(value, profileUserId!)).find(Boolean) : null;
      return { rank, handle: handle === anonymous && name ? name : handle, points };
    }) };
}
