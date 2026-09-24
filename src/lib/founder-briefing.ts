export interface FounderPeriod {
  startDate: string;
  endDate: string;
  days: number;
}

export interface FounderMeasure {
  current: number | null;
  previous: number | null;
}

/** Returning identified accounts = active accounts minus first-ever observed accounts. */
export function founderReturningAccounts(active: FounderMeasure, firstObserved: FounderMeasure): FounderMeasure {
  const subtract = (total: number | null, first: number | null) => total !== null && first !== null
    && Number.isFinite(total) && Number.isFinite(first) && total >= first && first >= 0
    ? total - first : null;
  return {
    current: subtract(active.current, firstObserved.current),
    previous: subtract(active.previous, firstObserved.previous),
  };
}

export interface FounderPlatform {
  key: 'IOS' | 'WEB';
  label: string;
  identifiedAccounts: FounderMeasure;
  identityCoverage: number | null;
  /** GA4 browser/app-instance identifiers, not unique humans. */
  trackedIdentifiers: number | null;
  /** Identifiers with at least one account-tagged meaningful event. */
  boundIdentifiers: number | null;
  /** Identifiers emitting auth_succeeded, not unique sign-ins or people. */
  signInIdentifiers: number | null;
  /** Signed-in browser identifiers later observed with an account ID. */
  signedInBoundIdentifiers: number | null;
  /** Same diagnostics for the preceding equal-length period. */
  previousTrackedIdentifiers: number | null;
  previousBoundIdentifiers: number | null;
  previousSignInIdentifiers: number | null;
  previousSignedInBoundIdentifiers: number | null;
}

/** Suppress web growth when either side has untrustworthy sign-in binding. */
export function founderWebIdentityMeasure(platform: FounderPlatform | undefined): {
  measure: FounderMeasure;
  currentGap: boolean;
  previousGap: boolean;
} {
  if (!platform) return { measure: { current: null, previous: null }, currentGap: false, previousGap: false };
  const currentGap = platform.signInIdentifiers !== null && platform.signInIdentifiers > 0
    && (platform.signedInBoundIdentifiers ?? 0) / platform.signInIdentifiers < 0.8;
  const previousGap = platform.previousSignInIdentifiers !== null
    && platform.previousSignInIdentifiers > 0
    && (platform.previousSignedInBoundIdentifiers ?? 0) / platform.previousSignInIdentifiers < 0.8;
  return {
    measure: {
      current: currentGap ? null : platform.identifiedAccounts.current,
      previous: currentGap || previousGap ? null : platform.identifiedAccounts.previous,
    },
    currentGap,
    previousGap,
  };
}

export interface FounderAgent {
  key: string;
  label: string;
  instrumented: boolean;
  note: string | null;
  identifiedAccounts: FounderMeasure;
  /** Distinct signed-in accounts that emitted a verified successful outcome. */
  successfulAccounts: FounderMeasure;
  interactions: FounderMeasure;
  /** Outcome events, kept separate from repeatable deliberate interactions. */
  successes: FounderMeasure;
  expectedErrors: FounderMeasure;
  failures: FounderMeasure;
  outcomeSignals: FounderMeasure;
  iosInteractions: number | null;
  webInteractions: number | null;
}

export interface FounderOutcomeHealth {
  state: 'not_measured' | 'unavailable' | 'waiting' | 'measured';
  successRate: number | null;
  successes: number | null;
  expectedErrors: number | null;
  failures: number | null;
}

/** Convert raw governed outcomes into the small, honest summary shown to founders. */
export function founderOutcomeHealth(agent: FounderAgent): FounderOutcomeHealth {
  if (!agent.instrumented) {
    return { state: 'not_measured', successRate: null, successes: null, expectedErrors: null, failures: null };
  }
  const outcomes = agent.outcomeSignals.current;
  if (outcomes === null) {
    return { state: 'unavailable', successRate: null, successes: null, expectedErrors: null, failures: null };
  }
  if (outcomes === 0) {
    return { state: 'waiting', successRate: null, successes: 0, expectedErrors: 0, failures: 0 };
  }
  const successes = agent.successes.current ?? 0;
  return {
    state: 'measured',
    successRate: Math.round((successes / outcomes) * 100),
    successes,
    expectedErrors: agent.expectedErrors.current ?? 0,
    failures: agent.failures.current ?? 0,
  };
}

export interface FounderDailyPoint {
  day: string;
  activeAccounts: number;
  agentInteractions: number;
  previousActiveAccounts: number | null;
  previousAgentInteractions: number | null;
}

export interface FounderBriefingData {
  generatedAt: string;
  period: FounderPeriod;
  previousPeriod: FounderPeriod;
  one: {
    available: boolean;
    comparisonReady: boolean;
    interactionComparisonReady: boolean;
    identityObservedSince: string | null;
    latestEventDate: string | null;
    activeAccounts: FounderMeasure;
    firstObservedAccounts: FounderMeasure;
    activatedAccounts: FounderMeasure;
    agentEngagedAccounts: FounderMeasure;
    accountCoverage: number | null;
    hasNativeEnvironmentConflict: boolean;
    platforms: FounderPlatform[];
    agents: FounderAgent[];
    daily: FounderDailyPoint[];
  };
  search: {
    available: boolean;
    clicks: FounderMeasure;
    impressions: FounderMeasure;
    latestDataDate: string | null;
  };
}

export type FounderTrend = 'up' | 'down' | 'flat' | 'new' | 'unavailable';

export function founderTrend(measure: FounderMeasure): { trend: FounderTrend; percent: number | null } {
  const { current, previous } = measure;
  if (current === null || previous === null || !Number.isFinite(current) || !Number.isFinite(previous)) {
    return { trend: 'unavailable', percent: null };
  }
  if (previous === 0) {
    return current === 0 ? { trend: 'flat', percent: 0 } : { trend: 'new', percent: null };
  }
  const percent = ((current - previous) / previous) * 100;
  return { trend: percent > 0 ? 'up' : percent < 0 ? 'down' : 'flat', percent };
}

export function founderChangeLabel(measure: FounderMeasure): string {
  const { trend, percent } = founderTrend(measure);
  if (trend === 'unavailable') return 'Comparison unavailable';
  if (trend === 'new') return 'New activity · earlier period was 0';
  if (trend === 'flat') return 'No change vs earlier period';
  return `${percent! > 0 ? '+' : ''}${percent!.toFixed(1)}% vs earlier period`;
}

export const FOUNDER_MAX_DAYS = 90;
export const FOUNDER_EARLIEST_DATE = '2026-05-01';
export const FOUNDER_SETTLE_DAYS = 3;

function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function format(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function founderLatestCompleteDate(now = new Date()): string {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  day.setUTCDate(day.getUTCDate() - FOUNDER_SETTLE_DAYS);
  return format(day);
}

export function founderPresetRange(days: 7 | 30 | 90, now = new Date()): FounderPeriod {
  const endDate = founderLatestCompleteDate(now);
  const start = utcDate(endDate);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return { startDate: format(start), endDate, days };
}

export function founderMonthRange(month: string, now = new Date()): FounderPeriod | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const startDate = `${month}-01`;
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0));
  const endDate = [format(lastDay), founderLatestCompleteDate(now)].sort()[0];
  if (startDate > endDate || startDate < FOUNDER_EARLIEST_DATE) return null;
  return founderCustomRange(startDate, endDate, now);
}

export function founderCustomRange(startDate: string, endDate: string, now = new Date()): FounderPeriod | null {
  const valid = /^\d{4}-\d{2}-\d{2}$/;
  if (!valid.test(startDate) || !valid.test(endDate)) return null;
  const start = utcDate(startDate);
  const end = utcDate(endDate);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())
    || format(start) !== startDate || format(end) !== endDate
    || startDate > endDate || startDate < FOUNDER_EARLIEST_DATE
    || endDate > founderLatestCompleteDate(now)) return null;
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  return days <= FOUNDER_MAX_DAYS ? { startDate, endDate, days } : null;
}
