import { expect, it } from 'vitest';
import { locationDailyTrend } from '../src/lib/location-daily-trend';
import type { OneAppSummary } from '../src/lib/types';

it('keeps failed behavior and missing payload days as gaps while preserving an available zero', () => {
  const one = { locationBehaviorAvailable: true, daily: [
    { eventDate: '2026-11-01', locationUsers: 3 }, { eventDate: '2026-11-02', locationUsers: 4 },
  ], locationAnalytics: { features: [{ key: 'live_sharing', daily: [{ eventDate: '2026-11-01', users: 0 }] }] } } as unknown as OneAppSummary;
  expect(locationDailyTrend(one)).toEqual([{ date: '11-01', active: 3, sharing: 0 }, { date: '11-02', active: 4, sharing: null }]);
  expect(locationDailyTrend({ ...one, locationBehaviorAvailable: false })).toEqual([
    { date: '11-01', active: 3, sharing: null }, { date: '11-02', active: 4, sharing: null },
  ]);
});
