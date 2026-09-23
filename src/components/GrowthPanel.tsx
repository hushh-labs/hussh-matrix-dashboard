import { Fragment, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { cn } from '../lib/utils';
import { appleCard, appleLabel, applePanel, dashboardBand } from '../lib/theme';
import { formatNumber } from '../lib/analytics-service';
import type { GrowthSummary, OrgIdentityPlatform } from '../lib/types';

/**
 * Organisation-level growth.
 *
 * Every other tab is one product looking at itself. This one answers the
 * questions that only make sense across the whole organisation: how many people
 * we have picked up, what an active person costs, whether the website feeds the
 * app, how long first value takes, what search brings in, and whether the
 * measurement itself can be trusted.
 *
 * Deliberately systemic: every section is the same shape — one question as a
 * heading, one card, one headline figure, and the qualification directly under
 * it. No section is allowed a number without saying what the number is of.
 */

type TimeGranularity = 'weekly' | 'monthly';

function percentText(value: number | null | undefined, decimals = 1): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * Exact, thousands-separated. `formatNumber` abbreviates to "1.0k", which is
 * fine on a dense breakdown but wrong for a headline count -- rounding away 33
 * people from a total of 1,033 is exactly the precision a growth number is for.
 */
function exact(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return Math.round(value).toLocaleString('en-US');
}

function money(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

/** Minutes into the largest unit that still reads naturally. */
function duration(minutes: number | null | undefined): string {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes)) return '—';
  if (minutes < 90) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 36) return `${hours.toFixed(1)} hours`;
  return `${(hours / 24).toFixed(1)} days`;
}

function Block({
  kicker,
  title,
  hint,
  children,
}: {
  kicker: string;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className={dashboardBand}>
      <div className="mb-4">
        <p className={appleLabel}>{kicker}</p>
        <h2 className="mt-1 text-2xl font-semibold text-[#1d1d1f]">{title}</h2>
        {hint && (
          <p className="mt-1.5 max-w-2xl text-sm font-medium leading-6 text-[#6e6e73]">{hint}</p>
        )}
      </div>
      {children}
    </section>
  );
}

/** The one repeated unit on this page: a figure, what it is, and its caveat. */
function Figure({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: 'plain' | 'warn';
}): ReactElement {
  return (
    <div className={cn(appleCard, 'p-5')}>
      <p className="text-sm font-semibold text-[#6e6e73]">{label}</p>
      <p
        className={cn(
          'mt-2 text-4xl font-semibold leading-none',
          tone === 'warn' ? 'text-[#8a5a04]' : 'text-[#1d1d1f]',
        )}
      >
        {value}
      </p>
      {detail && <p className="mt-2 text-xs font-semibold leading-5 text-[#86868b]">{detail}</p>}
    </div>
  );
}

const chartTooltip = {
  borderRadius: 10,
  border: '1px solid rgba(0,0,0,0.06)',
  fontSize: 12,
  fontWeight: 600,
} as const;

/**
 * 1. Devices first seen over time (Weekly / Monthly toggle).
 *
 * The cumulative line is the "how big are we" number; the bars are the pace.
 * Both are on one chart because either alone misleads — a rising total looks
 * like health even while the weekly intake collapses.
 */
function UsersOverTime({ growth }: { growth: GrowthSummary }) {
  const [granularity, setGranularity] = useState<TimeGranularity>('weekly');
  const { series, totalEverSeen, note } = growth.users;

  const displayData = useMemo(() => {
    if (granularity === 'weekly') {
      return series.slice(-12).map((item) => ({
        label: item.week.slice(5),
        newUsers: item.newUsers,
        cumulative: item.cumulative,
        tooltipLabel: 'New that week',
      }));
    } else {
      const monthlyMap = new Map<string, { newUsers: number; cumulative: number }>();
      for (const item of series) {
        const monthKey = item.week.slice(0, 7);
        const existing = monthlyMap.get(monthKey) || { newUsers: 0, cumulative: 0 };
        existing.newUsers += item.newUsers;
        existing.cumulative = item.cumulative;
        monthlyMap.set(monthKey, existing);
      }
      return Array.from(monthlyMap.entries()).slice(-12).map(([month, data]) => ({
        label: month,
        newUsers: data.newUsers,
        cumulative: data.cumulative,
        tooltipLabel: 'New that month',
      }));
    }
  }, [series, granularity]);

  const window = growth.users.window;
  const lastFour = series.slice(-4);
  const priorFour = series.slice(-8, -4);
  const windowNew = window ? window.newUsers : lastFour.reduce((s, p) => s + p.newUsers, 0);
  const priorNew = window ? window.priorNewUsers : priorFour.reduce((s, p) => s + p.newUsers, 0);
  const windowDays = window ? window.days : lastFour.length * 7;
  const trend = priorNew > 0 ? windowNew / priorNew - 1 : null;
  const windowLabel = window ? `${windowDays} days` : '4 weeks';
  const perDay = windowDays > 0 ? windowNew / windowDays : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Figure
          label="Devices first seen in the trailing year"
          value={exact(totalEverSeen)}
          detail={`Distinct devices first seen across ${series.length} weeks`}
        />
        <Figure
          label={`New in the last ${windowLabel}`}
          value={exact(windowNew)}
          detail={
            trend === null
              ? `No prior ${windowLabel} to compare`
              : `${trend >= 0 ? '+' : ''}${(trend * 100).toFixed(0)}% versus the ${windowLabel} before`
          }
        />
        <Figure
          label="Average per day"
          value={perDay >= 10 ? formatNumber(Math.round(perDay)) : perDay.toFixed(1)}
          detail={window ? `Over ${window.startDate} to ${window.endDate}` : 'Over the last 4 weeks'}
        />
      </div>

      <div className={cn(appleCard, 'p-6')}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-xs font-semibold text-[#86868b]">
            Time aggregation: <span className="capitalize font-bold text-[#1d1d1f]">{granularity}</span>
          </p>
          <div className="flex items-center gap-1 rounded-lg bg-[#f0f0f2] p-1 text-xs font-semibold text-[#6e6e73]">
            <button
              type="button"
              onClick={() => setGranularity('weekly')}
              className={cn(
                'rounded-md px-2.5 py-1 transition-all',
                granularity === 'weekly' ? 'bg-white text-[#1d1d1f] shadow-sm' : 'hover:text-[#1d1d1f]'
              )}
            >
              Weekly
            </button>
            <button
              type="button"
              onClick={() => setGranularity('monthly')}
              className={cn(
                'rounded-md px-2.5 py-1 transition-all',
                granularity === 'monthly' ? 'bg-white text-[#1d1d1f] shadow-sm' : 'hover:text-[#1d1d1f]'
              )}
            >
              Monthly
            </button>
          </div>
        </div>

        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={displayData} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e8e8ed" vertical={false} />
              <XAxis
                dataKey="label"
                stroke="#86868b"
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <YAxis yAxisId="left" stroke="#86868b" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke="#86868b"
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={chartTooltip}
                cursor={{ fill: 'rgba(0,0,0,0.03)' }}
                formatter={(value: number, name, item) => [
                  formatNumber(value),
                  name === 'newUsers' ? (item?.payload?.tooltipLabel ?? 'New devices') : 'Running device total',
                ]}
              />
              <Bar
                yAxisId="left"
                dataKey="newUsers"
                fill="#007aff"
                radius={[6, 6, 0, 0]}
                isAnimationActive={false}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="cumulative"
                stroke="#1f7a36"
                strokeWidth={2.5}
                dot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs font-semibold text-[#86868b]">
          <span>
            <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#007aff]" />
            New ({granularity})
          </span>
          <span>
            <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#1f7a36]" />
            Running device total (right)
          </span>
          <span>{note}</span>
        </div>
      </div>
    </div>
  );
}

const IDENTITY_PLATFORM_LABELS: Record<string, string> = {
  IOS: 'iOS app',
  ANDROID: 'Android app',
  WEB: 'Web',
  UNKNOWN: 'Unknown',
};

/**
 * 1b. Devices against accounts.
 *
 * Every user figure on this dashboard counts devices. This section is why.
 * Reporting "people" anywhere would mean reporting only the identified slice
 * and silently dropping the rest -- and the rest is nearly everyone. Showing
 * the shortfall keeps the headline honest and makes the gap itself legible,
 * because right now the gap is the more interesting number.
 */
function IdentityCoverage({ identity }: { identity: GrowthSummary['identity'] }) {
  const { devices, accounts, identifiedDevices, coverage, byPlatform, windowDays } = identity;
  const rows: OrgIdentityPlatform[] = [...byPlatform].sort((a, b) => b.devices - a.devices);
  const lowCoverage = coverage !== null && coverage < 0.25;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Figure
          label="Devices seen"
          value={exact(devices)}
          detail={`Browsers and app installs, trailing ${windowDays} days`}
        />
        <Figure
          label="Accounts we can name"
          value={exact(accounts)}
          detail="Signed in at least once"
        />
        <Figure
          label="Devices we can identify"
          value={exact(identifiedDevices)}
          detail="Carry an account identity"
        />
        <Figure
          label="Identity coverage"
          value={percentText(coverage, 1)}
          tone={lowCoverage ? 'warn' : 'plain'}
          detail={
            lowCoverage
              ? 'Too low to report people instead of devices'
              : 'Share of devices we can attach to a person'
          }
        />
      </div>

      <div className={cn(appleCard, 'overflow-x-auto')}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-bold uppercase text-[#86868b]">
              <th className="border-b border-black/5 px-5 py-3">Platform</th>
              <th className="border-b border-black/5 px-5 py-3 text-right">Devices</th>
              <th className="border-b border-black/5 px-5 py-3 text-right">Accounts</th>
              <th className="border-b border-black/5 px-5 py-3">Identity</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const share = row.devices > 0 ? row.identifiedDevices / row.devices : null;
              return (
                <tr key={row.platform} className="font-semibold text-[#1d1d1f]">
                  <td className="border-b border-black/5 px-5 py-3">
                    {IDENTITY_PLATFORM_LABELS[row.platform.toUpperCase()] ?? row.platform}
                  </td>
                  <td className="border-b border-black/5 px-5 py-3 text-right tabular-nums">
                    {exact(row.devices)}
                  </td>
                  <td className="border-b border-black/5 px-5 py-3 text-right tabular-nums">
                    {row.accounts > 0 ? exact(row.accounts) : <span className="text-[#c7c7cc]">&mdash;</span>}
                  </td>
                  <td className="border-b border-black/5 px-5 py-3 text-xs font-semibold">
                    {row.accounts > 0 ? (
                      <span className="text-[#6e6e73]">{percentText(share, 0)} of devices</span>
                    ) : (
                      <span className="text-[#8a5a04]">Binds nothing</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="border-t border-black/5 px-5 py-3 text-xs font-semibold leading-5 text-[#86868b]">
          A device becomes identifiable only once someone signs in, so this ceiling is partly the
          sign-in rate and partly instrumentation. A platform marked{' '}
          <strong className="font-bold text-[#1d1d1f]">Binds nothing</strong> sends no account
          identity at all, which is a bug rather than behaviour. The headline account count is
          globally distinct; platform account rows are diagnostic and must not be added together.
        </p>
      </div>
    </div>
  );
}

/**
 * 2. Cost per active user.
 *
 * Divided by *production* spend only, because that is what serving a person
 * costs. The non-production share is shown beside it rather than folded in:
 * they are different problems and mixing them lets a bloated test environment
 * hide inside a per-user figure.
 */
function CostPerActive({
  growth,
  costPerActiveUser,
  monthlyActive,
}: {
  growth: GrowthSummary;
  costPerActiveUser: number | null;
  monthlyActive: number | null;
}) {
  const { cost } = growth;
  if (!cost.available) {
    return (
      <div className={cn(applePanel, 'p-6 text-center')}>
        <p className="text-sm font-semibold text-[#6e6e73]">
          No billing export data for this window.
        </p>
      </div>
    );
  }

  const nonProdShare = cost.total > 0 ? cost.nonProduction / cost.total : null;
  const rows = [...cost.byProduct].sort(
    (a, b) => b.production + b.nonProduction - (a.production + a.nonProduction),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Figure
          label="Cost per active device"
          value={costPerActiveUser === null ? '—' : `$${costPerActiveUser.toFixed(2)}`}
          detail={
            monthlyActive
              ? `${money(cost.production)} production spend ÷ ${formatNumber(monthlyActive)} monthly active`
              : 'Needs both a cost and an active-device count'
          }
        />
        <Figure label="Total cloud spend" value={money(cost.total)} detail="All projects, this window" />
        <Figure label="Production serving cost" value={money(cost.production)} detail="Production projects only" />
        <Figure
          label="Non-production cost"
          value={money(cost.nonProduction)}
          tone={nonProdShare !== null && nonProdShare > 0.5 ? 'warn' : 'plain'}
          detail={
            nonProdShare === null
              ? undefined
              : `${percentText(nonProdShare, 0)} of spend is UAT, dev or idle`
          }
        />
      </div>

      <div className={cn(appleCard, 'overflow-x-auto')}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-bold uppercase text-[#86868b]">
              <th className="border-b border-black/5 px-5 py-3">Product</th>
              <th className="border-b border-black/5 px-5 py-3 text-right">Production</th>
              <th className="border-b border-black/5 px-5 py-3 text-right">UAT / dev / idle</th>
              <th className="border-b border-black/5 px-5 py-3 text-right">Ratio</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const ratio = row.production > 0 ? row.nonProduction / row.production : null;
              return (
                <tr key={row.product} className="font-semibold text-[#1d1d1f]">
                  <td className="border-b border-black/5 px-5 py-3">{row.product}</td>
                  <td className="border-b border-black/5 px-5 py-3 text-right tabular-nums">
                    {money(row.production)}
                  </td>
                  <td className="border-b border-black/5 px-5 py-3 text-right tabular-nums">
                    {money(row.nonProduction)}
                  </td>
                  <td
                    className={cn(
                      'border-b border-black/5 px-5 py-3 text-right tabular-nums',
                      ratio !== null && ratio > 2 ? 'text-[#8a5a04]' : 'text-[#6e6e73]',
                    )}
                  >
                    {ratio === null ? '—' : `${ratio.toFixed(1)}× more`}
                  </td>
                </tr>
              );
            })}
            {cost.unattributed > 0 && (
              <tr className="font-semibold text-[#6e6e73]">
                <td className="px-5 py-3">Other projects</td>
                <td className="px-5 py-3 text-right tabular-nums">—</td>
                <td className="px-5 py-3 text-right tabular-nums">{money(cost.unattributed)}</td>
                <td className="px-5 py-3 text-right text-xs">Not mapped to a product</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** 3. Does the website feed the app? */
function CrossProduct({ growth }: { growth: GrowthSummary }) {
  const { siteVisitors, appWebVisitors, siteThenApp, conversionRate, note } = growth.crossProduct;
  const stages = [
    { label: 'Visited hushh.ai', users: siteVisitors },
    { label: 'Went on to the One app', users: siteThenApp },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Figure label="Website visitors" value={formatNumber(siteVisitors)} detail="Distinct browsers on hushh.ai" />
        <Figure
          label="Continued to the app"
          value={formatNumber(siteThenApp)}
          detail="Same browser, website first"
        />
        <Figure
          label="Website to app rate"
          value={percentText(conversionRate, 1)}
          detail={`Against ${formatNumber(appWebVisitors)} total web app visitors`}
        />
      </div>

      <div className={cn(appleCard, 'p-6')}>
        <ol className="flex flex-col gap-2.5">
          {stages.map((stage, index) => {
            const width = siteVisitors > 0 ? Math.max((stage.users / siteVisitors) * 100, stage.users > 0 ? 2 : 0) : 0;
            return (
              <li key={stage.label} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-sm font-semibold text-[#1d1d1f]">{stage.label}</span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-[#6e6e73]">
                    {formatNumber(stage.users)}
                    {index === 1 && (
                      <span className="ml-2 text-[#86868b]">{percentText(conversionRate, 1)}</span>
                    )}
                  </span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#f0f0f2]">
                  <div className="h-full rounded-full bg-[#007aff]" style={{ width: `${width}%` }} />
                </div>
              </li>
            );
          })}
        </ol>
        <p className="mt-4 text-xs font-semibold leading-5 text-[#86868b]">{note}</p>
      </div>
    </div>
  );
}

/** 4. How long does first value take? */
function TimeToFirstValue({ growth }: { growth: GrowthSummary }) {
  const { activatedUsers, medianMinutes, fastestMinutes, slowestMinutes, distribution } =
    growth.timeToFirstValue;

  if (activatedUsers === 0) {
    return (
      <div className={cn(applePanel, 'p-6 text-center')}>
        <p className="text-sm font-semibold text-[#6e6e73]">
          Nobody has reached first value yet, so there is no time to measure.
        </p>
      </div>
    );
  }

  const total = distribution.reduce((sum, b) => sum + b.users, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Figure
          label="Typical time to first value"
          value={duration(medianMinutes)}
          detail={`Median across ${formatNumber(activatedUsers)} ${activatedUsers === 1 ? 'device' : 'devices'}`}
        />
        <Figure label="Fastest" value={duration(fastestMinutes)} detail="First visit to first share" />
        <Figure label="Slowest" value={duration(slowestMinutes)} detail="They came back and finished" />
      </div>

      <div className={cn(appleCard, 'p-6')}>
        <ol className="flex flex-col gap-2.5">
          {distribution.map((bucket) => {
            const width = total > 0 ? Math.max((bucket.users / total) * 100, bucket.users > 0 ? 2 : 0) : 0;
            return (
              <li key={bucket.bucket} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-sm font-semibold text-[#1d1d1f]">{bucket.bucket}</span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-[#6e6e73]">
                    {formatNumber(bucket.users)}
                  </span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#f0f0f2]">
                  <div className="h-full rounded-full bg-[#007aff]" style={{ width: `${width}%` }} />
                </div>
              </li>
            );
          })}
        </ol>
        <p className="mt-4 text-xs font-semibold leading-5 text-[#86868b]">
          Measured from the device&rsquo;s very first visit, not from the start of the selected
          window — so it is the whole journey they experienced.
        </p>
      </div>
    </div>
  );
}

/** 5. What is search bringing in? */
function OrganicSearch({ growth }: { growth: GrowthSummary }) {
  const { available, clicks, impressions, ctr, avgPosition, latestDay, series } =
    growth.organicSearch;

  if (!available) {
    return (
      <div className={cn(applePanel, 'p-6 text-center')}>
        <p className="text-sm font-semibold text-[#6e6e73]">
          No Search Console data for this window.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Figure label="Visits from search" value={exact(clicks)} detail="Clicks through to hushh.ai" />
        <Figure label="Times we appeared" value={exact(impressions)} detail="Impressions in results" />
        <Figure
          label="Click-through rate"
          value={percentText(ctr, 2)}
          detail="Search-result clicks divided by impressions"
        />
        <Figure
          label="Average position"
          value={avgPosition === null ? '—' : avgPosition.toFixed(1)}
          detail={latestDay ? `Data through ${latestDay}` : undefined}
        />
      </div>

      <div className={cn(appleCard, 'p-6')}>
        <div className="h-52 w-full">
          <ResponsiveContainer width="100%" height="100%">
            {/*
              * Two axes, not one. Clicks are ~0.8% of impressions, so on a
              * shared scale the visits line sits flat on the floor and the
              * legend promises a series the reader cannot see.
              */}
            <ComposedChart data={series} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
              <defs>
                <linearGradient id="search-impr" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#007aff" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="#007aff" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e8e8ed" vertical={false} />
              <XAxis
                dataKey="week"
                stroke="#86868b"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: string) => v.slice(5)}
              />
              <YAxis yAxisId="impr" stroke="#86868b" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis
                yAxisId="clicks"
                orientation="right"
                stroke="#86868b"
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={chartTooltip}
                formatter={(value: number, name) => [
                  exact(value),
                  name === 'clicks' ? 'Visits' : 'Impressions',
                ]}
              />
              <Area
                yAxisId="impr"
                type="monotone"
                dataKey="impressions"
                stroke="#007aff"
                strokeWidth={2}
                fill="url(#search-impr)"
                isAnimationActive={false}
              />
              <Line
                yAxisId="clicks"
                type="monotone"
                dataKey="clicks"
                stroke="#1f7a36"
                strokeWidth={2.5}
                dot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs font-semibold text-[#86868b]">
          <span>
            <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#007aff]" />
            Impressions (left)
          </span>
          <span>
            <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#1f7a36]" />
            Visits (right)
          </span>
          <span>Search Console lags roughly three days.</span>
        </div>
      </div>
    </div>
  );
}

/**
 * 6. Can we trust the numbers?
 *
 * This exists because two collection paths broke silently and nobody noticed
 * for months — a feed view publishing constants, and a summary endpoint
 * returning zeros. A page that reports its own health catches the third one.
 */
function InstrumentationHealth({ growth }: { growth: GrowthSummary }) {
  const { governedEvents, ungovernedEvents, distinctEvents, ungovernedEventNames, declaredNotEmitted } =
    growth.instrumentation;
  const totalEvents = governedEvents + ungovernedEvents;
  const governedShare = totalEvents > 0 ? governedEvents / totalEvents : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Figure
          label="Events carrying required tags"
          value={percentText(governedShare, 1)}
          tone={governedShare !== null && governedShare < 0.9 ? 'warn' : 'plain'}
          detail={`${exact(ungovernedEvents)} of ${exact(totalEvents)} arrived untagged`}
        />
        <Figure
          label="Event types seen"
          value={formatNumber(distinctEvents)}
          detail={`${formatNumber(ungovernedEventNames)} of them emit outside the governed taxonomy`}
        />
        <Figure
          label="Declared but never sent"
          value={formatNumber(declaredNotEmitted.length)}
          tone={declaredNotEmitted.length > 0 ? 'warn' : 'plain'}
          detail="In the contract with no live emitter"
        />
      </div>

      {declaredNotEmitted.length > 0 && (
        <div className={cn(applePanel, 'flex flex-col gap-2 p-5')}>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-[#8a5a04]" />
            <p className="text-sm font-bold text-[#1d1d1f]">
              Events the contract promises but nothing sends
            </p>
          </div>
          <p className="text-sm font-medium leading-6 text-[#6e6e73]">
            Nothing should be built on these until they have an emitter or are removed from the
            contract: {declaredNotEmitted.join(', ')}.
          </p>
        </div>
      )}
    </div>
  );
}

export function GrowthPanel({
  growth,
  costPerActiveUser,
  monthlyActive,
  rangeLabel,
  dateControl,
}: {
  growth: GrowthSummary | null;
  costPerActiveUser: number | null;
  monthlyActive: number | null;
  rangeLabel: string;
  dateControl: ReactNode;
}) {
  if (!growth) {
    return (
      <main className="space-y-10">
        <div className="flex justify-end">{dateControl}</div>
        <div className={cn(applePanel, 'p-8 text-center')}>
          <p className="text-base font-semibold text-[#1d1d1f]">Growth data is still loading.</p>
          <p className="mx-auto mt-2 max-w-xl text-sm font-medium leading-6 text-[#6e6e73]">
            This view reads the GA4 export, the billing export and Search Console. If it stays
            empty, check that the dashboard&rsquo;s service account can read all three.
          </p>
        </div>
      </main>
    );
  }

  const sections: Array<{ kicker: string; title: string; hint?: string; body: ReactElement }> = [
    {
      kicker: 'Audience',
      title: 'How many devices have we picked up in the trailing year?',
      hint: 'Distinct One app devices first seen in the trailing 365 days, and the rate we are adding them.',
      body: <UsersOverTime growth={growth} />,
    },
    {
      kicker: 'Identity',
      title: 'How many devices are tied to accounts?',
      hint: 'Every audience number in this One growth view counts devices. This is why, and by how much.',
      body: <IdentityCoverage identity={growth.identity} />,
    },
    {
      kicker: 'Unit economics',
      title: 'What does an active device cost us?',
      hint: 'Cloud spend divided by active devices, with the spend that serves no measured device shown separately.',
      body: (
        <CostPerActive
          growth={growth}
          costPerActiveUser={costPerActiveUser}
          monthlyActive={monthlyActive}
        />
      ),
    },
    {
      kicker: 'Cross-product',
      title: 'Does the website feed the app?',
      hint: 'The only journey that connects two products, measured same-device without merging anyone.',
      body: <CrossProduct growth={growth} />,
    },
    {
      kicker: 'Onboarding',
      title: 'How long does first value take?',
      body: <TimeToFirstValue growth={growth} />,
    },
    {
      kicker: 'Acquisition',
      title: 'What is search bringing in?',
      body: <OrganicSearch growth={growth} />,
    },
    {
      kicker: 'Data quality',
      title: 'Can we trust these numbers?',
      hint: 'Two collection paths have broken silently before. This section is how the third one gets caught.',
      body: <InstrumentationHealth growth={growth} />,
    },
  ];

  return (
    <main className="space-y-10">
      <section>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className={appleLabel}>Hussh · all products · {rangeLabel}</p>
            <h2 className="mt-1 text-2xl font-semibold text-[#1d1d1f] sm:text-3xl">
              {sections[0].title}
            </h2>
            {sections[0].hint && (
              <p className="mt-1.5 max-w-2xl text-sm font-medium leading-6 text-[#6e6e73]">
                {sections[0].hint}
              </p>
            )}
          </div>
          {dateControl}
        </div>
        {sections[0].body}
      </section>

      {sections.slice(1).map((section) => (
        <Fragment key={section.kicker}>
          <Block kicker={section.kicker} title={section.title} hint={section.hint}>
            {section.body}
          </Block>
        </Fragment>
      ))}

      <section className={dashboardBand}>
        <div className={cn(applePanel, 'flex flex-col gap-2 p-5')}>
          <div className="flex items-center gap-2">
            <Info className="h-4 w-4 shrink-0 text-[#6e6e73]" />
            <p className="text-sm font-bold text-[#1d1d1f]">How to read this page</p>
          </div>
          <p className="max-w-4xl text-sm font-medium leading-6 text-[#6e6e73]">
            Activity is counted as{' '}
            <strong className="font-bold text-[#1d1d1f]">devices and browsers</strong>, not
            individuals — the analytics identity binds on iOS but not on web, so one person on a
            phone and a laptop counts twice and app and web figures cannot be added together.
            Costs come from the GCP billing export and cover every project, including ones no
            customer touches. Nothing on this page joins identities across products.
            {growth.generatedAt
              ? ` Read ${new Date(growth.generatedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC.`
              : ''}
          </p>
        </div>
      </section>
    </main>
  );
}
