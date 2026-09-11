import { Loader2 } from 'lucide-react';
import { Fragment } from 'react';
import type { ReactNode } from 'react';
import type { GrowthCompare, GrowthCompareWindow, GrowthSummary } from '../lib/types';
import { cn } from '../lib/utils';
import { appleCard, applePanel, appleLabel, dashboardBand } from '../lib/theme';

/**
 * Over time.
 *
 * The growth tab answers "how are we doing in the window I picked". This tab
 * answers the question that comes straight after: "and is that better or
 * worse than usual?" -- the same organisation-level figures over the last 30
 * days, the last 90, and everything since the feeds began, in one table so
 * the eye can run across a row.
 *
 * Nothing here is derived from the growth tab's range. The three windows are
 * fixed on purpose: a comparison only means something if the columns stay
 * put between visits.
 */

function exact(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return Math.round(value).toLocaleString('en-US');
}

function money(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function percent(value: number | null | undefined, decimals = 1): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(decimals)}%`;
}

function decimal(value: number | null | undefined, digits = 1): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

function perDay(value: number | null | undefined, days: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || days <= 0) return '—';
  const rate = value / days;
  return rate >= 10 ? exact(rate) : rate.toFixed(1);
}

interface CompareRow {
  label: string;
  /** What the figure is, shown under the label. Keep it to one clause. */
  hint?: string;
  value: (growth: GrowthSummary, window: GrowthCompareWindow) => string;
  /** Rows that are only meaningful as a rate get the muted treatment. */
  muted?: boolean;
}

interface CompareSection {
  title: string;
  rows: CompareRow[];
}

const SECTIONS: CompareSection[] = [
  {
    title: 'Audience',
    rows: [
      {
        label: 'New devices picked up',
        hint: 'Distinct devices first seen on the One app in the window',
        value: (g) => exact(g.users.window?.newUsers),
      },
      {
        label: 'New devices per day',
        value: (g, w) => perDay(g.users.window?.newUsers, w.range.days),
        muted: true,
      },
    ],
  },
  {
    title: 'Cross-product',
    rows: [
      { label: 'Website visitors', hint: 'hushh.ai, same analytics property', value: (g) => exact(g.crossProduct.siteVisitors) },
      { label: 'App web visitors', value: (g) => exact(g.crossProduct.appWebVisitors) },
      { label: 'Site → app journeys', hint: 'Same device, site first', value: (g) => exact(g.crossProduct.siteThenApp) },
      { label: 'Site → app rate', value: (g) => percent(g.crossProduct.conversionRate), muted: true },
    ],
  },
  {
    title: 'Organic search',
    rows: [
      { label: 'Clicks', value: (g) => (g.organicSearch.available ? exact(g.organicSearch.clicks) : '—') },
      { label: 'Impressions', value: (g) => (g.organicSearch.available ? exact(g.organicSearch.impressions) : '—') },
      { label: 'Click-through rate', value: (g) => (g.organicSearch.available ? percent(g.organicSearch.ctr, 2) : '—'), muted: true },
      { label: 'Average position', value: (g) => (g.organicSearch.available ? decimal(g.organicSearch.avgPosition) : '—'), muted: true },
    ],
  },
  {
    title: 'Cloud spend',
    rows: [
      { label: 'Total', hint: 'All projects', value: (g) => (g.cost.available ? money(g.cost.total) : '—') },
      { label: 'Serving real users', hint: 'Production projects only', value: (g) => (g.cost.available ? money(g.cost.production) : '—') },
      { label: 'UAT, dev and idle', value: (g) => (g.cost.available ? money(g.cost.nonProduction) : '—') },
      { label: 'Spend per day', value: (g, w) => (g.cost.available ? `$${perDay(g.cost.total, w.range.days)}` : '—'), muted: true },
    ],
  },
  {
    title: 'Instrumentation',
    rows: [
      { label: 'Governed events', hint: 'Carry the shared event_category param', value: (g) => exact(g.instrumentation.governedEvents) },
      { label: 'Ungoverned events', value: (g) => exact(g.instrumentation.ungovernedEvents) },
      { label: 'Distinct event names', value: (g) => exact(g.instrumentation.distinctEvents), muted: true },
    ],
  },
];

function WindowHeader({ window }: { window: GrowthCompareWindow }) {
  return (
    <div className={cn(appleCard, 'p-4')}>
      <p className={appleLabel}>{window.label}</p>
      <p className="mt-1 text-sm font-bold text-[#1d1d1f]">
        {window.range.startDate} to {window.range.endDate}
      </p>
      <p className="mt-0.5 text-xs font-semibold text-[#86868b]">
        {window.range.days} days
        {window.key === 'all' ? ' · since the feeds began' : ''}
      </p>
      {window.error && (
        <p className="mt-2 text-xs font-semibold leading-5 text-[#8a5a04]">{window.error}</p>
      )}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className={cn(applePanel, 'p-8 text-center')}>
      <div className="mx-auto max-w-xl text-sm font-medium leading-6 text-[#6e6e73]">{children}</div>
    </div>
  );
}

export function ComparePanel({
  compare,
  loading,
  error,
  onRetry,
}: {
  compare: GrowthCompare | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const windows = compare?.windows ?? [];

  return (
    <main className="space-y-10">
      <section>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className={appleLabel}>Hussh · all products · three fixed windows</p>
            <h2 className="mt-1 text-2xl font-semibold text-[#1d1d1f] sm:text-3xl">
              Is this better or worse than usual?
            </h2>
            <p className="mt-1.5 max-w-2xl text-sm font-medium leading-6 text-[#6e6e73]">
              The same figures over the last 30 days, the last 90, and everything since the feeds
              began. Read across a row; the windows never move.
            </p>
          </div>
          {loading && compare && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#6e6e73]" role="status">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#007aff]" />
              Updating
            </span>
          )}
        </div>

        {!compare && loading ? (
          <Empty>
            <span className="inline-flex items-center gap-2 font-semibold text-[#1d1d1f]">
              <Loader2 className="h-4 w-4 animate-spin text-[#007aff]" />
              Reading three windows from BigQuery
            </span>
            <p className="mt-2">Usually under ten seconds.</p>
          </Empty>
        ) : !compare ? (
          <Empty>
            <p className="font-semibold text-[#1d1d1f]">The comparison could not be loaded.</p>
            <p className="mt-2">{error ?? 'The server did not return a comparison.'}</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-4 inline-flex min-h-9 items-center rounded-lg bg-[#1d1d1f] px-4 text-sm font-bold text-white transition hover:bg-[#323236]"
            >
              Try again
            </button>
          </Empty>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {windows.map((window) => (
                <Fragment key={window.key}>
                  <WindowHeader window={window} />
                </Fragment>
              ))}
            </div>

            <div className={cn(appleCard, 'mt-4 overflow-x-auto')}>
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-left text-xs font-bold uppercase text-[#86868b]">
                    <th className="border-b border-black/5 px-5 py-3">Metric</th>
                    {windows.map((window) => (
                      <th key={window.key} className="border-b border-black/5 px-5 py-3 text-right">
                        {window.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SECTIONS.map((section) => (
                    <Fragment key={section.title}>
                      <SectionRows section={section} windows={windows} />
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {compare && (
        <section className={dashboardBand}>
          <p className="max-w-3xl text-xs font-semibold leading-5 text-[#86868b]">
            People are counted as devices, not individuals. &ldquo;All time&rdquo; starts where the
            One app GA4 export does; billing begins a month later, so the all-time spend column
            covers slightly less than the audience columns.
            {compare.fetchedAt
              ? ` Read ${new Date(compare.fetchedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC.`
              : ''}
          </p>
        </section>
      )}
    </main>
  );
}

function SectionRows({ section, windows }: { section: CompareSection; windows: GrowthCompareWindow[] }) {
  return (
    <>
      <tr>
        <td colSpan={windows.length + 1} className="border-b border-black/5 bg-[#f5f5f7]/70 px-5 py-2">
          <span className={appleLabel}>{section.title}</span>
        </td>
      </tr>
      {section.rows.map((row) => (
        <tr key={row.label} className={cn('font-semibold', row.muted ? 'text-[#6e6e73]' : 'text-[#1d1d1f]')}>
          <td className="border-b border-black/5 px-5 py-3">
            <span>{row.label}</span>
            {row.hint && <span className="mt-0.5 block text-xs font-semibold text-[#86868b]">{row.hint}</span>}
          </td>
          {windows.map((window) => (
            <td key={window.key} className="border-b border-black/5 px-5 py-3 text-right tabular-nums">
              {window.data ? row.value(window.data, window) : '—'}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
