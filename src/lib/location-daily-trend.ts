import type { OneAppSummary } from './types';

/** Failed behavior data or a missing payload day is a chart gap. */
export function locationDailyTrend(one: OneAppSummary | null) {
  const sharing = one?.locationAnalytics?.features.find(feature => feature.key === 'live_sharing');
  const byDate = new Map((sharing?.daily ?? []).map(row => [row.eventDate, row.users]));
  return (one?.daily ?? []).map(point => ({
    date: point.eventDate.slice(5), active: point.locationUsers,
    sharing: one?.locationBehaviorAvailable ? byDate.get(point.eventDate) ?? null : null,
  }));
}
