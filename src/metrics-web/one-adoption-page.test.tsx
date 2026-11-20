import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ read: vi.fn(), request: vi.fn() }));
vi.mock('./lib/access', () => ({
  currentAccess: async () => ({ subjectHash: 'a'.repeat(64), scopeDigest: 'b'.repeat(64) }),
}));
vi.mock('./lib/runtime', () => ({ reportsRuntime: () => fixture }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

it.each([
  ['uat', 'UAT test activity'],
  ['production', 'Production activity'],
  [undefined, 'Environment unverified'],
] as const)('presents One adoption counts with the source environment %s', async (sourceEnvironment, label) => {
  fixture.read.mockClear();
  fixture.request.mockClear();
  const period = { startDate: '2026-11-18', endDate: '2026-11-18', timezone: 'UTC' };
  fixture.read.mockResolvedValueOnce({
    state: 'completed',
    sourceEnvironment,
    report: {
      request: { reportId: 'one.adoption', ...period },
      control: { definitionVersion: '1' },
      result: {
        sourceWatermark: Date.parse('2026-11-20T10:00:00Z'),
        metrics: {
          activeAccounts: { value: 1, unit: 'account', coverage: 'partial', basis: 'exact' },
          confirmedOutcomes: { value: 2, unit: 'outcome', coverage: 'partial', basis: 'exact' },
        },
      },
      publishedAt: Date.parse('2026-11-20T10:00:01Z'),
    },
  });

  const { default: ReportsPage } = await import('./app/page');
  const html = renderToStaticMarkup(await ReportsPage({
    searchParams: Promise.resolve({ report: 'one.adoption', ...period }),
  }));
  expect(html).toContain('Accounts with recorded activity</h2><strong>1</strong><p>account · partial');
  expect(html).toContain('Confirmed task outcomes</h2><strong>2</strong><p>outcome · partial');
  expect(html).toContain('Coverage is partial, so some activity may be missing.');
  expect(html).toContain(`<span>${label}</span>`);
  expect(html).toContain('Source snapshot time</dt><dd>2026-11-20T10:00:00.000Z');
  expect(html).not.toContain('Source information through');
  expect(fixture.read).toHaveBeenCalledOnce();
  expect(fixture.request).not.toHaveBeenCalled();
});

it('labels website UAT event counts without initiating collection on render', async () => {
  fixture.read.mockClear();
  fixture.request.mockClear();
  const period = { startDate: '2026-11-18', endDate: '2026-11-18', timezone: 'UTC' };
  fixture.read.mockResolvedValueOnce({
    state: 'unknown_freshness',
    sourceEnvironment: 'uat',
    report: {
      request: { reportId: 'hushhai.activity', ...period },
      control: { definitionVersion: '1' },
      result: { sourceWatermark: null, metrics: { pageViews: { value: 2, unit: 'event', coverage: 'partial', basis: 'source_recorded' } } },
      publishedAt: Date.parse('2026-11-20T10:00:01Z'),
    },
  });

  const { default: ReportsPage } = await import('./app/page');
  const html = renderToStaticMarkup(await ReportsPage({ searchParams: Promise.resolve({ report: 'hushhai.activity', ...period }) }));
  expect(html).toContain('<span>UAT test activity</span>');
  expect(html).toContain('Recorded page-view events</h2><strong>2</strong><p>event · partial');
  expect(html).toContain('Source information through</dt><dd>Unknown');
  expect(fixture.read).toHaveBeenCalledOnce();
  expect(fixture.request).not.toHaveBeenCalled();
});

it('defaults to the preceding source calendar day at a UTC date boundary', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-20T02:00:00Z'));
  try {
    fixture.read.mockClear();
    fixture.request.mockClear();
    fixture.read.mockResolvedValueOnce({ state: 'unavailable', report: null });
    const { default: ReportsPage } = await import('./app/page');
    await ReportsPage({ searchParams: Promise.resolve({ report: 'one.adoption', timezone: 'America/Los_Angeles' }) });
    expect(fixture.read).toHaveBeenCalledExactlyOnceWith({ reportId: 'one.adoption', startDate: '2026-11-18',
      endDate: '2026-11-18', timezone: 'America/Los_Angeles' }, expect.anything());
    expect(fixture.request).not.toHaveBeenCalled();
  } finally { clock.mockRestore(); }
});
