import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { fetchHushhTechSearchConsole, parseProductDateRange } from '../server';
import { withContinuation, type LegacyContinuation } from '../src/server/legacy-continuation';
import { withDailyOneRefresh, type DailyOneRefresh } from '../src/server/daily-one-refresh';

const source = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../src/server/bigquery-cost-control', () => ({
  guardedBigQuery: async (_project: string, request: { query: string }) => source.query(request.query),
  guardedBigQueryDryRun: vi.fn(),
}));
afterEach(() => { vi.useRealTimers(); source.query.mockReset(); });

it('anchors default report dates and generated Search SQL to the sealed period across UTC midnight', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-14T23:59:59.999Z'));
  source.query.mockImplementation(async (sql: string) => sql.includes('INFORMATION_SCHEMA.TABLES')
    ? [[{ tableName: 'searchdata_site_impression' }]] : sql.includes('SUM(clicks) AS clicks') && !sql.includes('GROUP BY') ? [[{ clicks: 1, impressions: 2 }]] : [[]]);
  const store = {} as LegacyContinuation;
  await fetchHushhTechSearchConsole(parseProductDateRange({}, 'hushhtech', 30));
  const queries = source.query.mock.calls.map(([sql]) => sql as string).filter(sql => sql.includes('data_date BETWEEN'));
  expect(queries.length).toBeGreaterThan(0);
  const originalHashes = queries.map(sql => createHash('sha256').update(sql).digest('hex'));
  expect(originalHashes[0]).toBe('20b6b6909e8091c5df90e8bf15bfc10aa8cdfc246399ed58ce9983ef264a4ffb');
  source.query.mockClear(); vi.setSystemTime(new Date('2026-11-15T00:00:00.001Z'));
  const result = await withContinuation(store, async () => {
    const range = parseProductDateRange({ kai_start_date: '2026-10-16', kai_end_date: '2026-11-14' }, 'hushhtech', 30);
    const response = await fetchHushhTechSearchConsole(range);
    return { range, response, kai: parseProductDateRange({}, 'kai', 7), one: parseProductDateRange({}, 'one', 14), actualNow: new Date().toISOString() };
  }, '2026-11-14T21:34:55.606Z');
  expect(result.value.range).toMatchObject({ startDate: '2026-10-16', endDate: '2026-11-14', days: 30 });
  expect(result.value.kai).toMatchObject({ startDate: '2026-11-08', endDate: '2026-11-14' });
  expect(result.value.one).toMatchObject({ startDate: '2026-11-01', endDate: '2026-11-14' });
  expect(result.value.actualNow).toBe('2026-11-15T00:00:00.001Z');
  expect(result.value.response.data).toMatchObject({ metadata: { generatedAt: '2026-11-15T00:00:00.001Z' } });
  // Cache keys contain the complete SQL hash. Reusing every prior entry proves
  // the generated statements match the immediately preceding UTC day.
  expect(source.query).not.toHaveBeenCalled();
  for (const sql of queries) {
    expect(sql).toContain("data_date BETWEEN DATE '2026-10-16' AND DATE '2026-11-14'");
    expect(sql).not.toContain('2026-11-15');
  }
  expect(parseProductDateRange({}, 'hushhtech', 30).endDate).toBe('2026-11-15');
  const explicit = await withContinuation(store, async () => parseProductDateRange({ hushhtech_end_date: '2026-11-05' }, 'hushhtech', 7), '2026-11-14T21:34:55.606Z');
  expect(explicit.value).toMatchObject({ startDate: '2026-10-30', endDate: '2026-11-05' });
});

it('keeps the sealed clock isolated from concurrent ordinary requests', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-15T00:00:01.000Z'));
  let resume!: () => void; const barrier = new Promise<void>(resolve => { resume = resolve; });
  const pending = withContinuation({} as LegacyContinuation, async () => {
    await barrier; return parseProductDateRange({}, 'one', 1).endDate;
  }, '2026-11-14T21:34:55.606Z');
  expect(parseProductDateRange({}, 'one', 1).endDate).toBe('2026-11-15');
  expect(Date.now()).toBe(Date.parse('2026-11-15T00:00:01.000Z'));
  resume(); expect((await pending).value).toBe('2026-11-14');
});


it('uses only the admitted daily report clock without freezing ordinary time', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-15T07:00:00.000Z'));
  const store = { requireOpen: async (report: string) => {
    if (report !== '/fixed') throw new Error('unapproved');
    return { run: { logicalAsOf: '2026-11-14T23:59:59.999Z' } };
  } } as unknown as DailyOneRefresh;
  const result = await withDailyOneRefresh(store, '/fixed', async () => ({
    range: parseProductDateRange({}, 'one', 7), actual: new Date().toISOString(),
  }));
  expect(result.range).toMatchObject({ startDate: '2026-11-08', endDate: '2026-11-14' });
  expect(result.actual).toBe('2026-11-15T07:00:00.000Z');
  expect(parseProductDateRange({}, 'one', 1).endDate).toBe('2026-11-15');
  await expect(withDailyOneRefresh(store, '/other', async () => 1)).rejects.toThrow('unapproved');
});
