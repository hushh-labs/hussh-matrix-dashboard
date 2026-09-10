import { Fragment } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { motion } from 'motion/react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { cn } from '../lib/utils';
import { appleCard, appleLabel, applePanel, dashboardBand } from '../lib/theme';
import { formatNumber } from '../lib/analytics-service';
import type {
  BreakdownMetric,
  OneAppSummary,
  OneCapabilityUsage,
  OnePlatformActives,
} from '../lib/types';

/**
 * one.hushh.ai — the One app.
 *
 * Organised by question, not by data source. The page answers six in order:
 * how many people are active, is that growth or churn, do they come back, do
 * they reach first value, which capabilities do they use, and is the app up.
 * Everything that was here before and answered none of those — the source
 * matrix, per-provider status cards, sessions and page-view totals, acquisition
 * source breakdowns — moved off this tab.
 *
 * Two rules the page is built to keep. Every label is a sentence a person would
 * say out loud, never an event name. And nothing that is unmeasured is drawn as
 * a zero: a capability with no instrumentation says so, because "nobody used
 * it" and "nobody can measure it" lead to opposite decisions.
 */

function percentText(value: number | null | undefined, decimals = 0): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(decimals)}%`;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** Shared section heading, so every block on the page starts the same way. */
function Block({
  kicker,
  title,
  hint,
  children,
  action,
}: {
  kicker: string;
  title: string;
  hint?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className={dashboardBand}>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className={appleLabel}>{kicker}</p>
          <h2 className="mt-1 text-2xl font-semibold text-[#1d1d1f]">{title}</h2>
          {hint && (
            <p className="mt-1.5 max-w-2xl text-sm font-medium leading-6 text-[#6e6e73]">{hint}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * 1. Active people.
 *
 * DAU, WAU and MAU are anchored to the end of the selected range, not to its
 * length, so "monthly" always means thirty days. Stickiness is DAU/MAU and is
 * blank rather than 0% when there is no denominator.
 */
function ActivePeople({ one }: { one: OneAppSummary }) {
  const { dau, wau, mau, stickiness, asOf } = one.activeUsers;
  const tiles = [
    { label: 'Daily active', value: dau, detail: asOf },
    { label: 'Weekly active', value: wau, detail: '7 days to ' + asOf },
    { label: 'Monthly active', value: mau, detail: '30 days to ' + asOf },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((tile, index) => (
        <motion.div
          key={tile.label}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.04 }}
          className={cn(appleCard, 'p-5')}
        >
          <p className="text-sm font-semibold text-[#6e6e73]">{tile.label}</p>
          <p className="mt-2 text-5xl font-semibold leading-none text-[#1d1d1f]">
            {formatNumber(tile.value)}
          </p>
          <p className="mt-2 text-xs font-semibold text-[#86868b]">{tile.detail}</p>
        </motion.div>
      ))}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12 }}
        className={cn(appleCard, 'p-5')}
      >
        <p className="text-sm font-semibold text-[#6e6e73]">Stickiness</p>
        <p className="mt-2 text-5xl font-semibold leading-none text-[#1d1d1f]">
          {percentText(stickiness, 1)}
        </p>
        <p className="mt-2 text-xs font-semibold text-[#86868b]">
          Daily of monthly — how much of the month a person shows up
        </p>
      </motion.div>
    </div>
  );
}

const PLATFORM_LABELS: Record<string, string> = {
  IOS: 'iOS app',
  ANDROID: 'Android app',
  WEB: 'Web',
  UNKNOWN: 'Unknown',
};

function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform.toUpperCase()] ?? platform;
}

/**
 * 1b. The same actives, split by platform.
 *
 * These rows are the honest form of the tiles above. GA4 gives web, iOS and
 * Android separate device-id spaces, and the account key that would stitch a
 * person across them is bound on iOS only -- so a person with a phone and a
 * laptop is two rows here and nothing can collapse them.
 *
 * Splitting does not fix that. What it fixes is the page implying an addition
 * that is not valid, and it puts the identity gap where you cannot miss it:
 * the platform that cannot report accounts says so on its own row.
 */
function ActivesByPlatform({ rows }: { rows: OnePlatformActives[] }) {
  if (rows.length === 0) return null;
  const anyBound = rows.some((row) => row.identityBound);

  return (
    <div className={cn(appleCard, 'overflow-hidden')}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-bold uppercase text-[#86868b]">
              <th className="border-b border-black/5 px-5 py-3">Platform</th>
              <th className="border-b border-black/5 px-5 py-3 text-right">Daily</th>
              <th className="border-b border-black/5 px-5 py-3 text-right">Weekly</th>
              <th className="border-b border-black/5 px-5 py-3 text-right">Monthly</th>
              <th className="border-b border-black/5 px-5 py-3 text-right">Accounts</th>
              <th className="border-b border-black/5 px-5 py-3">Identity</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.platform} className="font-semibold text-[#1d1d1f]">
                <td className="border-b border-black/5 px-5 py-3">{platformLabel(row.platform)}</td>
                <td className="border-b border-black/5 px-5 py-3 text-right tabular-nums">{formatNumber(row.dauDevices)}</td>
                <td className="border-b border-black/5 px-5 py-3 text-right tabular-nums">{formatNumber(row.wauDevices)}</td>
                <td className="border-b border-black/5 px-5 py-3 text-right tabular-nums">{formatNumber(row.mauDevices)}</td>
                <td className="border-b border-black/5 px-5 py-3 text-right tabular-nums">
                  {row.accounts === null ? <span className="text-[#c7c7cc]">&mdash;</span> : formatNumber(row.accounts)}
                </td>
                <td className="border-b border-black/5 px-5 py-3 text-xs font-semibold">
                  {row.identityBound ? (
                    <span className="text-[#6e6e73]">
                      {percentText(row.signedInShare, 0)} of devices signed in
                    </span>
                  ) : (
                    <span className="text-[#8a5a04]">Not bound &mdash; devices only</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-black/5 px-5 py-3 text-xs font-semibold leading-5 text-[#86868b]">
        Rows are separate populations and <strong className="font-bold text-[#1d1d1f]">must not be added</strong>.
        Each platform has its own device ids, so one person with a phone and a laptop appears twice.
        {anyBound
          ? ' Only platforms marked with a percentage can report people rather than devices, and only for that share of their devices.'
          : ' No platform is currently binding an account, so every figure here is devices.'}
      </p>
    </div>
  );
}

/**
 * 2. Growth quality.
 *
 * The tile that stops a large MAU being read as health. An active-user count
 * made almost entirely of first-timers is churn wearing growth's clothes, and
 * that distinction is invisible in the headline number.
 */
function GrowthQuality({ one }: { one: OneAppSummary }) {
  const { newUsers, returningUsers, unknownUsers } = one.growth;
  const known = newUsers + returningUsers;
  const returningShare = known > 0 ? returningUsers / known : null;

  return (
    <div className={cn(appleCard, 'p-6 sm:p-7')}>
      <div className="flex flex-wrap items-end gap-x-10 gap-y-5">
        <div>
          <p className="text-sm font-semibold text-[#6e6e73]">New to One</p>
          <p className="mt-1 text-5xl font-semibold leading-none text-[#1d1d1f]">
            {formatNumber(newUsers)}
          </p>
        </div>
        <div>
          <p className="text-sm font-semibold text-[#6e6e73]">Came back</p>
          <p className="mt-1 text-5xl font-semibold leading-none text-[#1d1d1f]">
            {formatNumber(returningUsers)}
          </p>
        </div>
        <div className="pb-1">
          <p className="text-sm font-semibold text-[#6e6e73]">Returning share</p>
          <p className="mt-1 text-3xl font-semibold leading-none text-[#1d1d1f]">
            {percentText(returningShare, 0)}
          </p>
        </div>
      </div>

      {known > 0 && (
        <div className="mt-6 flex h-3 w-full overflow-hidden rounded-full bg-[#f0f0f2]">
          <motion.div
            className="h-full bg-[#007aff]"
            initial={{ width: 0 }}
            animate={{ width: `${(newUsers / known) * 100}%` }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          />
          <motion.div
            className="h-full bg-[#1f7a36]"
            initial={{ width: 0 }}
            animate={{ width: `${(returningUsers / known) * 100}%` }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          />
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs font-semibold text-[#86868b]">
        <span><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#007aff]" />First time</span>
        <span><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#1f7a36]" />Returning</span>
        {unknownUsers > 0 && (
          <span>
            {formatNumber(unknownUsers)} {plural(unknownUsers, 'person', 'people')} had no first-touch
            date and are counted in neither
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * 3. Retention.
 *
 * Week-1 by acquisition cohort. A cohort needs to be a week old before it has a
 * week-1 number, so the newest bar is always the least meaningful — it is drawn
 * paler rather than omitted, because dropping it would make the series look
 * like it ends earlier than it does.
 */
function Retention({ one }: { one: OneAppSummary }) {
  if (one.retention.length === 0) {
    return (
      <div className={cn(applePanel, 'p-6 text-center')}>
        <p className="text-sm font-semibold text-[#6e6e73]">
          Not enough history in this window to measure return visits.
        </p>
      </div>
    );
  }

  const lastIndex = one.retention.length - 1;
  // The newest cohort has not finished its week, so it is excluded from the
  // headline average rather than dragging it down with a partial number.
  const mature = one.retention.slice(0, lastIndex);
  const averageRate = mature.length
    ? mature.reduce((sum, c) => sum + (c.rateW1 ?? 0), 0) / mature.length
    : null;

  const chartData = one.retention.map((cohort, index) => ({
    week: cohort.cohortWeek.slice(5),
    rate: cohort.rateW1 === null ? 0 : cohort.rateW1 * 100,
    cohortSize: cohort.cohortSize,
    returned: cohort.returnedW1,
    immature: index === lastIndex,
  }));

  return (
    <div className={cn(appleCard, 'p-6')}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-[#6e6e73]">
            Typical week-1 return rate
          </p>
          <p className="mt-1 text-5xl font-semibold leading-none text-[#1d1d1f]">
            {percentText(averageRate, 0)}
          </p>
        </div>
        <p className="max-w-sm text-xs font-semibold leading-5 text-[#86868b]">
          Of the people who arrived in a given week, this many opened One again in the
          following seven days.
        </p>
      </div>

      <div className="mt-6 h-52 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e8e8ed" vertical={false} />
            <XAxis dataKey="week" stroke="#86868b" fontSize={11} tickLine={false} axisLine={false} />
            <YAxis
              stroke="#86868b"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              unit="%"
            />
            <Tooltip
              cursor={{ fill: 'rgba(0,0,0,0.03)' }}
              contentStyle={{
                borderRadius: 10,
                border: '1px solid rgba(0,0,0,0.06)',
                fontSize: 12,
                fontWeight: 600,
              }}
              formatter={(value: number, _name, entry) => {
                const point = entry?.payload as (typeof chartData)[number] | undefined;
                return [
                  `${value.toFixed(0)}% — ${formatNumber(point?.returned ?? 0)} of ${formatNumber(point?.cohortSize ?? 0)}`,
                  point?.immature ? 'Week 1 (still running)' : 'Returned in week 1',
                ];
              }}
            />
            {/*
              * `isAnimationActive={false}` is load-bearing, not a preference.
              * Recharts builds a group per datum and only draws the shape once
              * its entry animation ticks, so an un-ticked chart renders axes
              * with no bars -- an empty chart under a non-zero average, which
              * is the worst way for a chart to fail. A dashboard read at a
              * glance gains nothing from bars growing in, and this also spares
              * anyone who asked for reduced motion.
              */}
            <Bar dataKey="rate" fill="#007aff" radius={[6, 6, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs font-semibold text-[#86868b]">
        Cohort by week of first visit. The most recent week is still inside its own
        seven days, so its bar will only rise.
      </p>
    </div>
  );
}

/**
 * 4. Activation.
 *
 * Stages are absolute counts with the conversion stated between them, rather
 * than a chart of ratios. A stage whose emitter has not shipped shows as zero
 * people with the conversion suppressed, so a missing event cannot be misread
 * as a catastrophic drop-off.
 */
function Activation({ one }: { one: OneAppSummary }) {
  const stages = one.activationStages;
  const first = stages[0]?.users ?? 0;
  const last = stages[stages.length - 1]?.users ?? 0;

  return (
    <div className={cn(appleCard, 'p-6')}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-[#6e6e73]">Reached first value</p>
          <div className="mt-1 flex flex-wrap items-end gap-x-3">
            <p className="text-5xl font-semibold leading-none text-[#1d1d1f]">
              {formatNumber(last)}
            </p>
            <p className="pb-1 text-base font-semibold text-[#86868b]">
              of {formatNumber(first)} who opened the app · {percentText(first > 0 ? last / first : null, 1)}
            </p>
          </div>
        </div>
      </div>

      <ol className="mt-6 flex flex-col gap-2.5">
        {stages.map((stage, index) => {
          const previous = index > 0 ? stages[index - 1].users : null;
          const conversion = previous && previous > 0 ? stage.users / previous : null;
          const width = first > 0 ? Math.max((stage.users / first) * 100, stage.users > 0 ? 2 : 0) : 0;
          return (
            <li key={stage.key} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-sm font-semibold text-[#1d1d1f]">{stage.label}</span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-[#6e6e73]">
                  {formatNumber(stage.users)}
                  {conversion !== null && (
                    <span className="ml-2 text-[#86868b]">{percentText(conversion, 0)} of previous</span>
                  )}
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#f0f0f2]">
                <motion.div
                  className="h-full rounded-full bg-[#007aff]"
                  initial={{ width: 0 }}
                  animate={{ width: `${width}%` }}
                  transition={{ duration: 0.55, ease: 'easeOut', delay: index * 0.05 }}
                />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * 5. Capabilities.
 *
 * Two numbers each: people who did something deliberate, and the total the
 * event-name-prefix bucket used to report. The gap between them is the size of
 * the error this page used to publish, so it is shown rather than quietly
 * corrected.
 */
function CapabilityCard({
  capability,
  index,
}: {
  capability: OneCapabilityUsage;
  index: number;
}): ReactElement {
  const {
    label, instrumented, note, humanUsers, humanEvents, totalUsers, totalEvents, daily,
  } = capability;
  const inflation = instrumented && (humanEvents ?? 0) > 0 && totalEvents > (humanEvents ?? 0)
    ? totalEvents / (humanEvents ?? 1)
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
      className={cn(appleCard, 'flex flex-col p-5')}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-base font-semibold text-[#1d1d1f]">{label}</p>
        {!instrumented && (
          <span className="shrink-0 rounded-md bg-[#fff4e5] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#8a5a04]">
            Not instrumented
          </span>
        )}
      </div>

      {instrumented ? (
        <>
          <p className="mt-3 text-4xl font-semibold leading-none text-[#1d1d1f]">
            {formatNumber(humanUsers ?? 0)}
          </p>
          <p className="mt-1.5 text-xs font-semibold text-[#6e6e73]">
            {plural(humanUsers ?? 0, 'person', 'people')} used it deliberately
          </p>
          <p className="mt-1 text-xs font-medium text-[#86868b]">
            {formatNumber(totalUsers)} seen in total
            {inflation && inflation >= 1.5 && (
              <> · {inflation.toFixed(1)}× the events are background</>
            )}
          </p>

          <div className="mt-4 h-14 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={daily} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id={`cap-${capability.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#007aff" stopOpacity={0.32} />
                    <stop offset="100%" stopColor="#007aff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Tooltip
                  contentStyle={{
                    borderRadius: 10,
                    border: '1px solid rgba(0,0,0,0.06)',
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                  labelFormatter={(value) => String(value)}
                  formatter={(value: number) => [formatNumber(value), 'People']}
                />
                <Area
                  type="monotone"
                  dataKey="users"
                  stroke="#007aff"
                  strokeWidth={2}
                  fill={`url(#cap-${capability.key})`}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </>
      ) : (
        <div className="mt-3 flex flex-1 flex-col justify-between gap-3">
          <p className="text-4xl font-semibold leading-none text-[#c7c7cc]">—</p>
          <p className="text-xs font-medium leading-5 text-[#6e6e73]">{note}</p>
        </div>
      )}
    </motion.div>
  );
}

/**
 * Agents claimed has no source at all — not a zero, not a stale number. It is
 * given the same prominence as a real tile so the gap is impossible to skim
 * past, and names what would have to exist for it to be filled in.
 */
function AgentsClaimed() {
  return (
    <div className={cn(applePanel, 'flex flex-col gap-2 p-6')}>
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 text-[#8a5a04]" />
        <p className="text-sm font-bold text-[#1d1d1f]">Agents claimed — no source yet</p>
      </div>
      <p className="max-w-3xl text-sm font-medium leading-6 text-[#6e6e73]">
        Claiming an agent emits no event and writes no record the dashboard can read.
        Reporting a number here would mean inventing one. Filling this in needs a decision
        about what counts as a claim — account creation, first sign-in, or a provisioned
        pod — and then either an event or a read of the authoritative record.
      </p>
    </div>
  );
}

/** 6. Operational health. Deliberately last, and deliberately labelled. */
function Health({ metrics }: { metrics: BreakdownMetric[] }) {
  if (metrics.length === 0) {
    return (
      <div className={cn(applePanel, 'p-6 text-center')}>
        <p className="text-sm font-semibold text-[#6e6e73]">
          No Cloud Run monitoring data for this window.
        </p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {metrics.map((metric) => (
        <div key={metric.label} className={cn(appleCard, 'p-5')}>
          <p className="text-sm font-semibold text-[#6e6e73]">{metric.label}</p>
          <p className="mt-2 text-3xl font-semibold text-[#1d1d1f]">
            {metric.displayValue ?? formatNumber(metric.value)}
          </p>
          {metric.detail && (
            <p className="mt-1 text-xs font-semibold text-[#86868b]">{metric.detail}</p>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * The provenance line.
 *
 * One row, not a panel. It carries the two things that decide whether any
 * number above can be trusted: what an active "person" actually is, and how old
 * the data is. Both used to be absent from the page entirely.
 */
function Provenance({ one, rangeLabel }: { one: OneAppSummary; rangeLabel: string }) {
  const lagHours = typeof one.expectedLagSeconds === 'number'
    ? Math.round(one.expectedLagSeconds / 3600)
    : null;

  return (
    <div className={cn(applePanel, 'flex flex-col gap-2 p-5')}>
      <div className="flex items-center gap-2">
        <Info className="h-4 w-4 shrink-0 text-[#6e6e73]" />
        <p className="text-sm font-bold text-[#1d1d1f]">How to read these numbers</p>
      </div>
      <p className="max-w-4xl text-sm font-medium leading-6 text-[#6e6e73]">
        Counts are <strong className="font-bold text-[#1d1d1f]">devices and browsers</strong>, not
        people. One account signed in on a phone and a laptop counts twice, because the analytics
        identity binds on iOS but not on web — so app and web figures also cannot be added together.
        Native and <code className="rounded bg-white/70 px-1 py-0.5 text-xs">one.hushh.ai</code> only;
        marketing pages and UAT are excluded. Source {one.sourceLabel ?? 'GA4 export'} ·{' '}
        {rangeLabel}
        {lagHours ? ` · data lands about ${lagHours}h behind` : ''}
        {one.generatedAt ? ` · read ${new Date(one.generatedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC` : ''}.
      </p>
    </div>
  );
}

export function OneAppPanel({
  one,
  healthMetrics,
  rangeLabel,
  dateControl,
}: {
  one: OneAppSummary | null;
  healthMetrics: BreakdownMetric[];
  rangeLabel: string;
  /**
   * Owned by Dashboard so the range state lives with every other product's,
   * and rendered here so it sits with the numbers it governs.
   */
  dateControl: ReactNode;
}) {
  if (!one || !one.available) {
    return (
      <main className="space-y-10">
        <div className="flex justify-end">{dateControl}</div>
        <div className={cn(applePanel, 'p-8 text-center')}>
          <p className="text-base font-semibold text-[#1d1d1f]">
            No One app data for this window yet.
          </p>
          <p className="mx-auto mt-2 max-w-xl text-sm font-medium leading-6 text-[#6e6e73]">
            This view reads the production GA4 export. If it stays empty, check that the
            dashboard&rsquo;s service account can read the analytics dataset.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="space-y-10">
      <section>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className={appleLabel}>one.hushh.ai · production · {rangeLabel}</p>
            <h2 className="mt-1 text-2xl font-semibold text-[#1d1d1f] sm:text-3xl">
              How many people are using One?
            </h2>
          </div>
          {dateControl}
        </div>
        <div className="flex flex-col gap-4">
          <ActivePeople one={one} />
          <ActivesByPlatform rows={one.activeByPlatform} />
        </div>
      </section>

      <Block
        kicker="Growth quality"
        title="Is that growth, or churn?"
        hint="An active-user count made mostly of first-timers is not the same product story as one made of people coming back."
      >
        <GrowthQuality one={one} />
      </Block>

      <Block
        kicker="Retention"
        title="Do they come back?"
      >
        <Retention one={one} />
      </Block>

      <Block
        kicker="Activation"
        title="Do they reach first value?"
        hint="First value is a location actually moving between two people — sent or received."
      >
        <Activation one={one} />
      </Block>

      <Block
        kicker="Agents"
        title="Which agents do people use?"
        hint="Ranked by deliberate use. Retries, prefetches, health pings and diagnostics are counted separately, not as usage."
      >
        <div className="flex flex-col gap-4">
          <AgentsClaimed />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/*
              * Fragment carries the key instead of the component itself. This
              * project has no @types/react installed, so TS does not recognise
              * `key` on a custom component; Dashboard.tsx works around the same
              * gap with a wrapper div. Fragment is used here because a wrapper
              * element would become the grid item and the cards would stop
              * sharing a row height.
              */}
            {one.capabilities.map((capability, index) => (
              <Fragment key={capability.key}>
                <CapabilityCard capability={capability} index={index} />
              </Fragment>
            ))}
          </div>
        </div>
      </Block>

      <Block
        kicker="Operational health"
        title="Is the app up?"
        hint="Served by the same Cloud Run service as the rest of the web app."
      >
        <Health metrics={healthMetrics} />
      </Block>

      <section className={dashboardBand}>
        <Provenance one={one} rangeLabel={rangeLabel} />
      </section>
    </main>
  );
}
