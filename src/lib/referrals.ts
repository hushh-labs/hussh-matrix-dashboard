export type ReferralEnvironment = 'production' | 'uat';
export const referralsPath = '/referral-analytics';
export const isReferralsPath = (path: string) => /^\/referral-analytics\/?$/.test(path);

export interface ReferralMetrics {
  environment: ReferralEnvironment;
  state: 'available' | 'unavailable';
  generatedAt: string;
  latestRecordAt: string | null;
  range: { startDate: string; endDate: string; timezone: 'UTC' };
  totals: null | {
    referrers: number; referredAccounts: number; qualified: number; pending: number;
    linkOpens: number; netPoints: number; netCoins: number; pointEarners: number;
    milestonesEarned: number; rewardRecipients: number; weeklyAwards: number;
  };
  daily: { date: string; referredAccounts: number; netPoints: number }[];
  points: { type: string; points: number; coins: number; events: number }[];
  rewards: { reward: string; threshold: number; earned: number; claimed: number }[];
  weeklyAwards: { status: string; awards: number }[];
}

export const referralPointLabels: Record<string, string> = {
  base_qualification: 'Qualified referral', flash_qualification: 'Flash referral',
  streak_bonus: 'Referral streak', reversal: 'Reversals', in_progress_activity: 'Referral in progress',
  qualified_activity: 'Qualified activity', app_streak_bonus: 'App streak', agent_usage: 'Agent usage',
  pkm_daily: 'Memory activity', connection_created: 'New connection',
};

export function parseReferralQuery(query: Record<string, unknown>, now = new Date()) {
  const environment = query.environment ?? 'production';
  if (environment !== 'production' && environment !== 'uat') throw new Error('Invalid environment');
  const endDate = query.endDate ?? now.toISOString().slice(0, 10);
  const startDate = query.startDate ?? new Date(new Date(`${endDate}T00:00:00Z`).getTime() - 29 * 86400000).toISOString().slice(0, 10);
  const validDate = (value: unknown): value is string => typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!validDate(startDate) || !validDate(endDate) || startDate > endDate
    || Date.parse(endDate) - Date.parse(startDate) > 365 * 86400000
    || endDate > now.toISOString().slice(0, 10)) throw new Error('Invalid date range');
  return { environment, startDate, endDate };
}
