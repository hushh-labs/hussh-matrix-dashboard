import { AlertTriangle, MapPin, Smartphone, Users } from 'lucide-react';
import { motion } from 'motion/react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { cn } from '../lib/utils';
import { appleCard, appleLabel, applePanel, dashboardBand } from '../lib/theme';
import { formatNumber } from '../lib/analytics-service';
import type { BreakdownMetric, OneAppSummary } from '../lib/types';

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
}: {
  one: OneAppSummary | null;
  headlineMetrics: BreakdownMetric[];
  agentMetrics: BreakdownMetric[];
  locationFeatureMetrics: BreakdownMetric[];
  platformMetrics: BreakdownMetric[];
  acquisitionMetrics: BreakdownMetric[];
}) {
  if (!one || !one.available) {
    return (
      <main className="space-y-10">
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
        <div className="mb-4">
          <p className={appleLabel}>one.hushh.ai · production</p>
          <h2 className="mt-1 text-2xl font-semibold text-[#1d1d1f] sm:text-3xl">
            Are we winning?
          </h2>
        </div>
        <Scoreboard one={one} />
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
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <RankedList
            title="Agents by people who used them"
            subtitle="One person can use several, so these do not add up to 100%"
            items={agentMetrics}
            emptyText="No agent activity in this window."
          />
          <RankedList
            title="What people do inside One Location"
            subtitle="Counted as distinct people, not raw events"
            items={locationFeatureMetrics}
            emptyText="No One Location activity in this window."
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
