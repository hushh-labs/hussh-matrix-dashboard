export interface FounderPeriod {
  startDate: string;
  endDate: string;
  days: number;
}

export interface FounderMeasure {
  current: number | null;
  previous: number | null;
}

export interface FounderBriefingData {
  generatedAt: string;
  period: FounderPeriod;
  previousPeriod: FounderPeriod;
  one: {
    available: boolean;
    activeAccounts: FounderMeasure;
    firstObservedAccounts: FounderMeasure;
    activatedAccounts: FounderMeasure;
    accountCoverage: number | null;
    hasNativeEnvironmentConflict: boolean;
  };
  hushhTech: {
    available: boolean;
    totalAccounts: number | null;
    newAccounts: FounderMeasure;
  };
  hushhAi: {
    available: boolean;
    organicClicks: FounderMeasure;
    latestSearchDay: string | null;
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
  if (trend === 'new') return 'New activity · previous period was 0';
  if (trend === 'flat') return 'No change vs previous 30 days';
  return `${percent! > 0 ? '+' : ''}${percent!.toFixed(1)}% vs previous 30 days`;
}
