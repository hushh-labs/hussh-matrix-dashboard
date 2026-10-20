export type ReferralEnvironment = 'production' | 'uat';
export type ReferralBoard = 'individual' | 'circles';
export const referralsPath = '/referral-analytics';
export const isReferralsPath = (path: string) => /^\/referral-analytics\/?$/.test(path);

export const referralPageSize = 20;
export interface ReferralEntry { rank: number; handle: string; points: number }
export interface ReferralSourcePage {
  state: 'available' | 'waiting' | 'expired';
  snapshotId: string | null;
  snapshotGeneratedAt: string | null;
  entryCount: number | null;
  entries: ReferralEntry[];
  nextAfterRank: number | null;
}
export interface ReferralRankings extends Omit<ReferralSourcePage, 'state'> {
  state: ReferralSourcePage['state'] | 'preview';
  board: ReferralBoard;
  environment: ReferralEnvironment | null;
  environments: ReferralEnvironment[];
  sources: { environment: ReferralEnvironment; state: ReferralSourcePage['state'] | 'unavailable' }[];
}
export interface ReferralQuery {
  environment?: ReferralEnvironment;
  board: ReferralBoard;
  afterRank: number;
  snapshotId?: string;
}
export function parseReferralQuery(query: Record<string, unknown>): ReferralQuery {
  const environment = query.environment;
  const board = query.board ?? 'individual';
  const afterRank = query.afterRank ?? '0';
  const snapshotId = query.snapshotId;
  if (environment !== undefined && environment !== 'production' && environment !== 'uat') throw new Error('Invalid environment');
  if (board !== 'individual' && board !== 'circles') throw new Error('Invalid leaderboard');
  if (typeof afterRank !== 'string' || !/^(0|[1-9]\d{0,8})$/.test(afterRank)) throw new Error('Invalid cursor');
  if (snapshotId !== undefined && (typeof snapshotId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(snapshotId))) throw new Error('Invalid snapshot');
  if ((Number(afterRank) > 0 || snapshotId !== undefined) && (!environment || !snapshotId)) throw new Error('A cursor needs its source snapshot');
  if (board === 'circles' && (Number(afterRank) > 0 || snapshotId !== undefined)) throw new Error('Circle standings are not published');
  return { environment: environment as ReferralEnvironment | undefined, board, afterRank: Number(afterRank), snapshotId: snapshotId as string | undefined };
}
