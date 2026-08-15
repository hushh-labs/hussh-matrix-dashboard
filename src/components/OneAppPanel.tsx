import type { ReactNode } from 'react';
import { AlertTriangle, MapPin, Smartphone, Users } from 'lucide-react';
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
  OneAgentUsage,
  OneAppSummary,
  OneSurfaceRow,
} from '../lib/types';

/**
 * one.hushh.ai — the One app.
 *
 * This panel is written to be read by someone who did not build the product.
 * Every label is a sentence a person would say out loud ("People who actually
 * shared a location"), never an event name, and every percentage states what it
 * is a percentage *of*. A founder should be able to answer "are we winning?" in
 * about five seconds from the top of this page.
 */

function percentText(value: number | null | undefined, decimals = 0): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(decimals)}%`;
}

function Scoreboard({ one }: { one: OneAppSummary }) {
  const activated = one.activation.activatedUsers || one.activation.sharingUsers;
  const target = one.activation.targetUsers;
  const progress = target > 0 ? Math.min(activated / target, 1) : 0;
  const remaining = Math.max(target - activated, 0);

  return (
    <div className={cn(appleCard, 'p-6 sm:p-8')}>
      <p className={appleLabel}>The number that matters</p>
      <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2">
        <p className="text-6xl font-semibold leading-none text-[#1d1d1f] sm:text-7xl">
          {formatNumber(activated)}
        </p>
        <p className="pb-2 text-xl font-semibold text-[#86868b]">
          of {formatNumber(target)} people sharing their location
        </p>
      </div>

      <div className="mt-6 h-3 w-full overflow-hidden rounded-full bg-[#f0f0f2]">
        <motion.div
          className="h-full rounded-full bg-[#007aff]"
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(progress * 100, progress > 0 ? 1.5 : 0)}%` }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        />
      </div>
      <p className="mt-3 text-sm font-semibold text-[#6e6e73]">
        {percentText(progress, 1)} of the way there · {formatNumber(remaining)} to go ·
        last {one.windowDays} days
      </p>
    </div>
  );
}

function HeadlineGrid({ metrics }: { metrics: BreakdownMetric[] }) {
  const icons = [Users, MapPin, MapPin, Users];
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {metrics.map((metric, index) => {
        const Icon = icons[index] ?? Users;
        return (
          <motion.div
            key={metric.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.04 }}
            className={cn(appleCard, 'min-h-[150px] p-5')}
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#f5f5f7] text-[#007aff]">
              <Icon className="h-5 w-5" strokeWidth={2.4} />
            </div>
            <div className="mt-5">
              <p className="text-sm font-semibold leading-5 text-[#6e6e73]">{metric.label}</p>
              <p className="mt-1 text-4xl font-semibold text-[#1d1d1f]">
                {metric.displayValue ?? formatNumber(metric.value)}
              </p>
              {metric.detail && (
                <p className="mt-1 text-xs font-semibold text-[#86868b]">{metric.detail}</p>
              )}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

/**
 * The activation funnel, rendered in journey order with the drop-off between
 * adjacent steps called out.
 *
 * Steps with no data render as a muted "not measured yet" row rather than a
 * zero bar, because those two things mean completely different things to
 * whoever is reading: one is "nobody got here", the other is "we are not
 * recording this yet". Conflating them would make a shipping gap look like a
 * product catastrophe.
 */
function ActivationFunnel({ one }: { one: OneAppSummary }) {
  const measured = one.funnel.filter((step) => step.users > 0);
  const peak = measured.reduce((max, step) => Math.max(max, step.users), 0);

  if (peak === 0) {
    return (
      <div className={cn(applePanel, 'p-6')}>
        <p className="text-sm font-semibold text-[#1d1d1f]">
          The One Location funnel is not reporting yet.
        </p>
        <p className="mt-2 text-sm font-medium leading-6 text-[#6e6e73]">
          These eleven steps light up once the funnel instrumentation ships in the
          webapp. Until then the feature usage below is the honest picture of who
          is using One Location.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {one.funnel.map((step) => {
        const width = peak > 0 ? Math.max((step.users / peak) * 100, step.users > 0 ? 6 : 0) : 0;
        const lost = step.dropoffFromPrevious;
        const notMeasured = step.users === 0;

        return (
          <div key={step.step} className={cn(applePanel, 'px-4 py-3')}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p
                className={cn(
                  'text-sm font-bold',
                  notMeasured ? 'text-[#a1a1a6]' : 'text-[#1d1d1f]',
                )}
              >
                {step.label}
              </p>
              <div className="flex items-baseline gap-3">
                <span
                  className={cn(
                    'text-sm font-bold tabular-nums',
                    notMeasured ? 'text-[#a1a1a6]' : 'text-[#1d1d1f]',
                  )}
                >
                  {notMeasured ? 'not measured yet' : `${formatNumber(step.users)} people`}
                </span>
                {!notMeasured && typeof lost === 'number' && lost > 0 && (
                  <span className="text-xs font-bold text-[#c1121f]">
                    −{percentText(lost)} lost here
                  </span>
                )}
              </div>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white">
              <motion.div
                className="h-full rounded-full bg-[#007aff]"
                initial={{ width: 0 }}
                animate={{ width: `${width}%` }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * One agent, with its own trend.
 *
 * A ranked list answers "which agent is biggest"; it cannot answer "which
 * agent is dying", and for a product deciding where to put its next month of
 * work the second question is the more useful one. Hence a card per agent with
 * its own 30-day shape rather than one more leaderboard.
 */
function AgentCard({
  agent,
  totalUsers,
  index,
}: {
  agent: OneAgentUsage;
  totalUsers: number;
  index: number;
}) {
  const share = totalUsers > 0 ? agent.users / totalUsers : 0;
  const data = agent.daily.map((point) => ({
    label: point.eventDate.slice(5),
    People: point.users,
  }));
  const recent = agent.daily.slice(-7).reduce((sum, p) => sum + p.users, 0);
  const prior = agent.daily.slice(-14, -7).reduce((sum, p) => sum + p.users, 0);
  const delta = prior > 0 ? (recent - prior) / prior : null;
  const gradientId = `one-agent-grad-${index}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className={cn(appleCard, 'flex flex-col p-5')}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-[#1d1d1f]">{agent.agent}</p>
          <p className="mt-0.5 text-xs font-semibold text-[#86868b]">
            {percentText(share)} of app users
          </p>
        </div>
        {delta !== null && Math.abs(delta) >= 0.01 && (
          <span
            className={cn(
              'shrink-0 rounded-full px-2 py-0.5 text-xs font-bold',
              delta >= 0 ? 'bg-[#eaf8ef] text-[#248a3d]' : 'bg-[#fdecec] text-[#c1121f]',
            )}
          >
            {delta >= 0 ? '+' : ''}
            {percentText(delta)} 7d
          </span>
        )}
      </div>

      <div className="mt-3 flex items-end gap-2">
        <p className="text-4xl font-semibold leading-none text-[#1d1d1f]">
          {formatNumber(agent.users)}
        </p>
        <p className="pb-1 text-xs font-semibold text-[#86868b]">
          people · {formatNumber(agent.events)} actions
        </p>
      </div>

      <div className="mt-4 h-[72px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#007aff" stopOpacity={0.28} />
                <stop offset="100%" stopColor="#007aff" stopOpacity={0} />
              </linearGradient>
            </defs>
            <Tooltip
              cursor={{ stroke: 'rgba(0,0,0,0.12)' }}
              contentStyle={{
                borderRadius: 10,
                border: '1px solid rgba(0,0,0,0.06)',
                fontSize: 12,
                fontWeight: 600,
              }}
            />
            <Area
              type="monotone"
              dataKey="People"
              stroke="#007aff"
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
}

/**
 * The audit trail for the surface filter.
 *
 * The production property carries one web stream shared with the hushh.ai
 * marketing site, so an unfiltered count reads more than double the truth.
 * Showing the exclusions keeps that mistake from silently returning.
 */
function SurfaceAudit({ surfaces }: { surfaces: OneSurfaceRow[] }) {
  if (!surfaces.length) return null;
  const counted = surfaces.filter((row) => row.surface !== 'Other site or environment');
  const excluded = surfaces.filter((row) => row.surface === 'Other site or environment');
  const countedUsers = counted.reduce((sum, row) => sum + row.users, 0);
  const excludedUsers = excluded.reduce((sum, row) => sum + row.users, 0);

  return (
    <div className={cn(applePanel, 'p-5')}>
      <p className="text-sm font-bold text-[#1d1d1f]">What is counted on this page</p>
      <p className="mt-1 text-sm font-medium leading-6 text-[#6e6e73]">
        The One app only — the native apps and the web app. This GA4 property shares a
        web stream with the hushh.ai marketing site, so{' '}
        <span className="font-bold text-[#1d1d1f]">
          {formatNumber(excludedUsers)} people
        </span>{' '}
        browsing other hushh.ai pages are deliberately excluded. Counting them would
        more than double the headline and make every rate on this page look better
        than it is.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <p className={appleLabel}>Counted · {formatNumber(countedUsers)}</p>
          <div className="mt-2 space-y-1">
            {counted.map((row) => (
              <div key={`${row.surface}-${row.host}`} className="flex justify-between text-sm">
                <span className="font-semibold text-[#1d1d1f]">{row.host}</span>
                <span className="font-bold tabular-nums text-[#1d1d1f]">
                  {formatNumber(row.users)}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className={appleLabel}>Excluded · {formatNumber(excludedUsers)}</p>
          <div className="mt-2 space-y-1">
            {excluded.map((row) => (
              <div key={`${row.surface}-${row.host}`} className="flex justify-between text-sm">
                <span className="font-semibold text-[#86868b]">{row.host}</span>
                <span className="font-bold tabular-nums text-[#86868b]">
                  {formatNumber(row.users)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function RankedList({
  title,
  subtitle,
  items,
  emptyText,
}: {
  title: string;
  subtitle: string;
  items: BreakdownMetric[];
  emptyText: string;
}) {
  const peak = items.reduce((max, item) => Math.max(max, item.value), 0);

  return (
    <div className={cn(appleCard, 'p-5 sm:p-6')}>
      <p className="text-base font-semibold text-[#1d1d1f]">{title}</p>
      <p className="mt-1 text-sm font-medium text-[#86868b]">{subtitle}</p>
      {items.length === 0 ? (
        <p className="mt-5 text-sm font-semibold text-[#86868b]">{emptyText}</p>
      ) : (
        <div className="mt-5 space-y-3">
          {items.map((item) => (
            <div key={item.label}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="truncate text-sm font-bold text-[#1d1d1f]">{item.label}</p>
                <p className="shrink-0 text-sm font-bold tabular-nums text-[#1d1d1f]">
                  {item.displayValue ?? formatNumber(item.value)}
                </p>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[#f0f0f2]">
                <div
                  className="h-full rounded-full bg-[#007aff]/70"
                  style={{ width: `${peak > 0 ? Math.max((item.value / peak) * 100, 2) : 0}%` }}
                />
              </div>
              {item.detail && (
                <p className="mt-1 text-xs font-semibold text-[#86868b]">{item.detail}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Surfaced as a first-class card rather than buried in a chart because a high
 * retries-per-user ratio is a live product defect, not a statistic: it means
 * the location fix is failing over and over for the handful of people who are
 * actually trying to use the feature.
 */
function ReliabilityCard({ one }: { one: OneAppSummary }) {
  const { locationRetries, locationRetryUsers, retriesPerAffectedUser } = one.reliability;
  if (!locationRetryUsers) return null;

  const severe = (retriesPerAffectedUser ?? 0) >= 10;

  return (
    <div
      className={cn(
        appleCard,
        'p-5 sm:p-6',
        severe && 'border-[#c1121f]/20 bg-[#fff5f5]/90',
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg',
            severe ? 'bg-[#ffe8e8] text-[#c1121f]' : 'bg-[#f5f5f7] text-[#007aff]',
          )}
        >
          <AlertTriangle className="h-5 w-5" strokeWidth={2.4} />
        </div>
        <div className="min-w-0">
          <p className="text-base font-semibold text-[#1d1d1f]">
            Getting a location fix is failing
          </p>
          <p className="mt-1 text-sm font-medium leading-6 text-[#6e6e73]">
            {formatNumber(locationRetries)} retries across {formatNumber(locationRetryUsers)}{' '}
            {locationRetryUsers === 1 ? 'person' : 'people'} —{' '}
            <span className={cn('font-bold', severe && 'text-[#c1121f]')}>
              {retriesPerAffectedUser === null
                ? '—'
                : `${Math.round(retriesPerAffectedUser)} retries each`}
            </span>
            . {severe
              ? 'That is high enough to be the reason people stop before sharing.'
              : 'Worth watching as usage grows.'}
          </p>
        </div>
      </div>
    </div>
  );
}

function DailyTrend({ one }: { one: OneAppSummary }) {
  const data = one.daily.map((point) => ({
    label: point.eventDate.slice(5),
    'Everyone': point.users,
    'One Location': point.locationUsers,
  }));

  return (
    <div className={cn(appleCard, 'p-5 sm:p-6')}>
      <p className="text-base font-semibold text-[#1d1d1f]">Daily active people</p>
      <p className="mt-1 text-sm font-medium text-[#86868b]">
        Everyone in the One app, and the slice using One Location
      </p>
      <div className="mt-5 h-[280px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: '#86868b', fontWeight: 600 }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={18}
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#86868b', fontWeight: 600 }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <Tooltip
              cursor={{ fill: 'rgba(0,0,0,0.03)' }}
              contentStyle={{
                borderRadius: 10,
                border: '1px solid rgba(0,0,0,0.06)',
                fontSize: 12,
                fontWeight: 600,
              }}
            />
            <Bar dataKey="Everyone" fill="#c7c7cc" radius={[3, 3, 0, 0]} />
            <Bar dataKey="One Location" fill="#007aff" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function OneAppPanel({
  one,
  headlineMetrics,
  agentMetrics,
  locationFeatureMetrics,
  platformMetrics,
  acquisitionMetrics,
  rangeLabel,
  dateControl,
}: {
  one: OneAppSummary | null;
  headlineMetrics: BreakdownMetric[];
  agentMetrics: BreakdownMetric[];
  locationFeatureMetrics: BreakdownMetric[];
  platformMetrics: BreakdownMetric[];
  acquisitionMetrics: BreakdownMetric[];
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
              Are we winning?
            </h2>
          </div>
          {dateControl}
        </div>
        <Scoreboard one={one} />
      </section>

      <section className={dashboardBand}>
        <SurfaceAudit surfaces={one.surfaces} />
      </section>

      <section className={dashboardBand}>
        <div className="mb-4">
          <p className={appleLabel}>The short version</p>
          <h2 className="mt-1 text-2xl font-semibold text-[#1d1d1f] sm:text-3xl">
            Who shows up, and who actually uses it
          </h2>
        </div>
        <HeadlineGrid metrics={headlineMetrics} />
      </section>

      <section className={dashboardBand}>
        <div className="mb-4">
          <p className={appleLabel}>One Location · step by step</p>
          <h2 className="mt-1 text-2xl font-semibold text-[#1d1d1f] sm:text-3xl">
            Where people give up
          </h2>
          <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-[#6e6e73]">
            Each row is one step of getting from opening the app to sharing a location
            with someone. The red number is the share of people lost at that step.
          </p>
        </div>
        <ActivationFunnel one={one} />
      </section>

      <section className={dashboardBand}>
        <div className="mb-4">
          <p className={appleLabel}>Every agent</p>
          <h2 className="mt-1 text-2xl font-semibold text-[#1d1d1f] sm:text-3xl">
            What people actually use
          </h2>
          <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-[#6e6e73]">
            People per agent over the selected window, each with its own trend. One
            person can use several agents, so these do not add up to 100%.
          </p>
        </div>
        {one.agents.length === 0 ? (
          <div className={cn(applePanel, 'p-6 text-center')}>
            <p className="text-sm font-semibold text-[#86868b]">
              No agent activity in this window.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {one.agents.map((agent, index) => (
              <div key={agent.agent}>
                <AgentCard
                  agent={agent}
                  totalUsers={one.rangeTotals.users}
                  index={index}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={dashboardBand}>
        <div className="mb-4">
          <p className={appleLabel}>One Location · actions</p>
          <h2 className="mt-1 text-2xl font-semibold text-[#1d1d1f] sm:text-3xl">
            Which features get used
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <RankedList
            title="What people do inside One Location"
            subtitle="Distinct people, not raw events. Zero means nobody has used it yet."
            items={locationFeatureMetrics}
            emptyText="No One Location activity in this window."
          />
          <RankedList
            title="Agents by reach"
            subtitle="The same figures as the cards above, ranked"
            items={agentMetrics}
            emptyText="No agent activity in this window."
          />
        </div>
      </section>

      <section className={dashboardBand}>
        <div className="mb-4">
          <p className={appleLabel}>Reach</p>
          <h2 className="mt-1 flex items-center gap-2 text-2xl font-semibold text-[#1d1d1f] sm:text-3xl">
            <Smartphone className="h-6 w-6 text-[#007aff]" strokeWidth={2.2} />
            Where they come from
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <RankedList
            title="App Store, Play Store, or web"
            subtitle="Distinct people per platform"
            items={platformMetrics}
            emptyText="No platform data in this window."
          />
          <RankedList
            title="How they found us"
            subtitle="Untagged traffic shows as Direct until campaign links are used"
            items={acquisitionMetrics}
            emptyText="No acquisition data in this window."
          />
        </div>
      </section>

      <section className={dashboardBand}>
        <div className="mb-4">
          <p className={appleLabel}>Health</p>
          <h2 className="mt-1 text-2xl font-semibold text-[#1d1d1f] sm:text-3xl">
            Is it working for them?
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-4">
          <ReliabilityCard one={one} />
          <DailyTrend one={one} />
        </div>
      </section>
    </main>
  );
}
