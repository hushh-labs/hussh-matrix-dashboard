import { describe, expect, it } from 'vitest';
import { aggregateSearchDays, buildSearchConsoleDailyRows, latestCompleteSearchDay, searchConsoleCoverageNote } from '../src/server/search-console-daily';

describe('Search Console daily coverage', () => {
  it('labels the latest complete row rather than a newer incomplete source date', () => {
    const rows = [{ date: '2026-11-01', clicks: 4, impressions: 30 }, { date: '2026-11-02', clicks: null, impressions: 7 }];
    expect(latestCompleteSearchDay(rows)).toEqual({ row: rows[0], source: 'GCP daily aggregate · data date 2026-11-01' });
    expect(latestCompleteSearchDay([rows[1]])).toEqual({ row: undefined, source: 'GCP daily aggregate' });
  });
  it('keeps missing dates unknown while preserving observed zero and nonzero rows', () => {
    const dates = ['2026-11-01', '2026-11-02', '2026-11-03'];
    const rows = [{ date: dates[0], clicks: 0, impressions: 0 }, { date: dates[2], clicks: 4, impressions: 30 }];
    expect(buildSearchConsoleDailyRows(dates, rows, row => ({ clicks: row.clicks, impressions: row.impressions, ctr: null, averagePosition: null })))
      .toEqual([
        { date: dates[0], label: '11-01', clicks: 0, impressions: 0, ctr: null, averagePosition: null },
        { date: dates[1], label: '11-02', clicks: null, impressions: null, ctr: null, averagePosition: null },
        { date: dates[2], label: '11-03', clicks: 4, impressions: 30, ctr: null, averagePosition: null },
      ]);
    expect(searchConsoleCoverageNote(dates, rows)).toContain('period totals may be incomplete');
  });
  it('does not invent zeros for missing metric fields in a present row', () => {
    expect(buildSearchConsoleDailyRows(['2026-11-01'], [{ date: '2026-11-01', clicks: null, impressions: null }], () => ({ clicks: 0, impressions: 0, ctr: null, averagePosition: null }))[0])
      .toMatchObject({ clicks: null, impressions: null });
  });
  it('requires a complete consecutive seven-day window and valid position coverage', () => {
    const rows = Array.from({ length: 7 }, (_, index) => ({ date: `2026-11-0${index + 1}`, clicks: 0, impressions: 10, averagePosition: 2 }));
    expect(aggregateSearchDays(rows.slice(0, 1), 7)).toMatchObject({ clicks: null, impressions: null });
    expect(aggregateSearchDays(rows.map((row, index) => index === 2 ? { ...row, clicks: null } : row), 7)).toMatchObject({ clicks: null });
    expect(aggregateSearchDays(rows.map((row, index) => index === 2 ? { ...row, date: rows[1].date } : row), 7)).toMatchObject({ clicks: null });
    expect(aggregateSearchDays(rows.map((row, index) => index === 2 ? { ...row, averagePosition: null } : row), 7)).toMatchObject({ clicks: 0, impressions: 70, averagePosition: null });
    expect(aggregateSearchDays(rows, 7)).toMatchObject({ clicks: 0, impressions: 70, averagePosition: 2 });
  });
});
