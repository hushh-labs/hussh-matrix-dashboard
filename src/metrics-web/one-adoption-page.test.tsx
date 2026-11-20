import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ read: vi.fn(), request: vi.fn() }));
vi.mock('./lib/access', () => ({
  currentAccess: async () => ({ subjectHash: 'a'.repeat(64), scopeDigest: 'b'.repeat(64) }),
}));
vi.mock('./lib/runtime', () => ({ reportsRuntime: () => fixture }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

it('presents retained One adoption counts and distinguishes source snapshot time from coverage', async () => {
  const period = { startDate: '2026-11-18', endDate: '2026-11-18', timezone: 'UTC' };
  fixture.read.mockResolvedValueOnce({
    state: 'completed',
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
  expect(html).toContain('Source snapshot time</dt><dd>2026-11-20T10:00:00.000Z');
  expect(html).not.toContain('Source information through');
  expect(fixture.read).toHaveBeenCalledOnce();
  expect(fixture.request).not.toHaveBeenCalled();
});
