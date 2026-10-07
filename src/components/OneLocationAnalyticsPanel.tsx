import { useState, useMemo } from 'react';
import type { ReactElement, ReactNode } from 'react';
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  CircleDot,
  ContactRound,
  Info,
  LogIn,
  MapPin,
  MessageCircleMore,
  Radio,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { formatNumber } from '../lib/analytics-service';
import { appleCard, appleLabel, applePanel, dashboardBand } from '../lib/theme';
import { cn } from '../lib/utils';
import type {
  LocationAnalyticsEnvironment,
  LocationAnalyticsTab,
} from '../lib/location-analytics-route';
import type {
  OneAppSummary,
  OneLocationBehaviorMetric,
  OneLocationJourneyMetric,
} from '../lib/types';
import { FeatureActivityTable } from './FeatureActivityTable';
import { MetricCalculationGuide } from './MetricCalculationGuide';
import { exactCount, eventVolumeExplanation, featureActivityLabel } from '../lib/feature-measurement';

const tabs: Array<{ key: LocationAnalyticsTab; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'features', label: 'Features' },
  { key: 'circles', label: 'Circles' },
  { key: 'journey', label: 'Journey' },
];

const environments: Array<{
  key: LocationAnalyticsEnvironment;
  label: string;
  sourceLabel: string;
  description: string;
  waitingNote: string;
}> = [
  {
    key: 'production',
    label: 'Production',
    sourceLabel: 'one.hushh.ai · One native streams',
    description: 'Production GA4 property with the exact production web host and One native app streams. Native build channel and backend environment are not verified by property selection.',
    waitingNote: 'The detailed journey event has not reached the production export yet. Existing feature events remain live while the new release rolls out.',
  },
  {
    key: 'uat',
    label: 'UAT / Test builds',
    sourceLabel: 'uat.one.hushh.ai · One native streams',
    description: 'UAT GA4 property with the exact UAT web host and native app streams when exported to this property. Build channel and backend environment are separate dimensions.',
    waitingNote: 'The detailed journey event has not reached the UAT export yet. TestFlight, Android internal and UAT web events will appear after the next GA4 export.',
  },
];

const featureIcon: Record<string, typeof MapPin> = {
  daily_signin: LogIn,
  auth_started: LogIn,
  live_sharing: Radio,
  check_in: CheckCircle2,
  sms_safety: MessageCircleMore,
  request_location: MapPin,
  public_sharing: ShieldCheck,
  contact_sync: ContactRound,
  invitations: UsersRound,
  circle_engagement: CircleDot,
};

function MetricValue({ value, waiting = false }: { value: number | null; waiting?: boolean }) {
  if (waiting || value === null) {
    return <span className="text-xs font-semibold text-[#86868b]">—</span>;
  }
  return <>{exactCount(value)}</>;
}

function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  waiting = false,
}: {
  label: string;
  value: number | null;
  detail: string;
  icon: typeof MapPin;
  waiting?: boolean;
}) {
  return (
    <div className={cn(appleCard, 'p-5')}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-[#6e6e73]">{label}</p>
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#e8f2ff] text-[#007aff]">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className={cn('mt-4 font-semibold leading-none text-[#1d1d1f]', waiting ? 'text-base' : 'text-3xl')}>
        <MetricValue value={value} waiting={waiting} />
      </p>
      <p className="mt-2 text-xs font-medium leading-5 text-[#86868b]">{detail}</p>
    </div>
  );
}

function featureAudit(feature: OneLocationBehaviorMetric, environment: LocationAnalyticsEnvironment, sourceAvailable: boolean) {
  if (!sourceAvailable) return {
    badgeLabel: 'Data unavailable', badgeClass: 'bg-amber-50 text-amber-800',
    explanation: 'We could not read this count. A dash does not mean zero activity.',
  };
  if (!feature.instrumented) {
    return {
      badgeLabel: 'Not tracked yet',
      badgeClass: 'bg-amber-50 text-amber-800',
      explanation: `No matching ${environment === 'production' ? 'production' : 'UAT/test'} event has been observed. This is not proof of zero use.`,
    };
  }
  if (!feature.events) {
    return {
      badgeLabel: 'No activity recorded',
      badgeClass: 'bg-slate-100 text-slate-600',
      explanation: 'No matching activity was recorded in this period.',
    };
  }
  return {
    badgeLabel: 'Data available',
    badgeClass: 'bg-emerald-50 text-emerald-800',
    explanation: eventVolumeExplanation(feature.events, feature.users),
  };
}

function FeatureTable({
  features,
  environment,
  summary,
}: {
  features: OneLocationBehaviorMetric[];
  environment: LocationAnalyticsEnvironment;
  summary: OneAppSummary;
}) {
  const sortedFeatures = useMemo(() => {
    const order = ['auth_started', 'daily_signin', 'live_sharing', 'location_viewed', 'request_location', 'public_sharing', 'contact_sync', 'circle_engagement', 'sms_safety', 'invitations', 'check_in', 'check_out'];
    return [...features].sort((a, b) => {
      const first = order.indexOf(a.key);
      const second = order.indexOf(b.key);
      return (first < 0 ? 99 : first) - (second < 0 ? 99 : second);
    });
  }, [features]);

  return <FeatureActivityTable rows={sortedFeatures.map(feature => {
    const audit = featureAudit(feature, environment, summary.locationBehaviorAvailable);
    return {
      key: feature.key,
      label: featureActivityLabel(feature.key, feature.label),
      icon: featureIcon[feature.key] ?? Activity,
      devices: feature.users,
      events: feature.events,
      successes: feature.successes,
      expectedErrors: feature.expectedErrors,
      failures: feature.failures,
      measured: feature.instrumented && summary.locationBehaviorAvailable,
      ...audit,
      eventBreakdown: summary.featureUsageAvailable ? summary.featureUsage[feature.key]?.eventBreakdown : undefined,
    };
  })} />;
}

function JourneyReach({ rows }: { rows: OneLocationJourneyMetric[] }) {
  const max = Math.max(1, ...rows.map((row) => row.users ?? 0));
  return (
    <div className={cn(applePanel, 'p-5 sm:p-6')}>
      <div className="mb-5">
        <p className="text-base font-bold text-[#1d1d1f]">Journey reach</p>
        <p className="mt-1 text-xs font-medium leading-5 text-[#86868b]">
          Optional branches are independent. This is reach, not a forced sequential funnel.
        </p>
      </div>
      <ol className="space-y-3">
        {rows.map((row, index) => {
          const waiting = !row.instrumented || (row.key === 'request_fulfilled' && !row.observed);
          const width = waiting ? 0 : Math.max(2, ((row.users ?? 0) / max) * 100);
          return (
            <li key={row.key} className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#f2f2f7] text-[11px] font-bold text-[#6e6e73]">
                {index + 1}
              </span>
              <div className="min-w-0">
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <p className="truncate text-sm font-semibold text-[#1d1d1f]">{row.label}</p>
                  {waiting && (
                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-[#8a5a04]">Rolling out</span>
                  )}
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[#ececf0]">
                  <div className="h-full rounded-full bg-[#007aff]" style={{ width: `${width}%` }} />
                </div>
              </div>
              <p className="min-w-12 text-right text-sm font-bold text-[#1d1d1f]">
                <MetricValue value={row.users} waiting={waiting} />
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function CircleBreakdown({ one }: { one: OneAppSummary }) {
  const total = one.locationAnalytics.circleKinds.reduce((sum, row) => sum + row.circlesCreated, 0);
  const engaged = one.locationAnalytics.journey.find((row) => row.key === 'circle_engaged');
  return (
    <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
      <div className={cn(applePanel, 'p-6')}>
        <p className={appleLabel}>Created in range</p>
        <p className="mt-3 text-5xl font-semibold tracking-tight text-[#1d1d1f]">{formatNumber(total)}</p>
        <p className="mt-2 text-sm font-medium leading-6 text-[#6e6e73]">
          Based on emitted creation events—not a claim about current active inventory.
        </p>
        <div className="mt-6 grid grid-cols-3 gap-2">
          {one.locationAnalytics.circleKinds.map((row) => (
            <div key={row.kind} className="rounded-2xl bg-white/70 p-3">
              <p className="text-xl font-bold text-[#1d1d1f]">{formatNumber(row.circlesCreated)}</p>
              <p className="mt-1 text-[11px] font-semibold text-[#86868b]">{row.label}</p>
            </div>
          ))}
        </div>
      </div>
      <div className={cn(applePanel, 'p-6')}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className={appleLabel}>Engagement</p>
            <p className="mt-2 text-3xl font-semibold text-[#1d1d1f]">
              <MetricValue value={engaged?.users ?? null} waiting={!engaged?.instrumented} />
            </p>
            <p className="mt-1 text-sm font-medium text-[#6e6e73]">devices reaching a Circle action</p>
          </div>
          <UsersRound className="h-6 w-6 text-[#007aff]" />
        </div>
        <div className="mt-6 rounded-2xl border border-black/[0.06] bg-white/60 p-4">
          <p className="text-sm font-bold text-[#1d1d1f]">Measured without personal data</p>
          <p className="mt-1 text-xs font-medium leading-5 text-[#6e6e73]">
            Tab and detail opens, joins, member invitations, removals, leaves, deletions and invite-code handoffs—never Circle names, member identities or codes.
          </p>
        </div>
      </div>
    </div>
  );
}

function SourceCompleteness({
  one,
  environment,
}: {
  one: OneAppSummary;
  environment: LocationAnalyticsEnvironment;
}) {
  const seen = new Set(
    one.locationAnalytics.platforms
      .filter((row) => row.events > 0)
      .map((row) => row.platform.toUpperCase()),
  );
  const sources = environment === 'production'
    ? [
        { platform: 'WEB', label: 'Production web' },
        { platform: 'IOS', label: 'iOS app stream' },
        { platform: 'ANDROID', label: 'Android app stream' },
      ]
    : [
        { platform: 'WEB', label: 'UAT web' },
        { platform: 'IOS', label: 'iOS app stream' },
        { platform: 'ANDROID', label: 'Android app stream' },
      ];
  const sourcesWithActivity = sources.filter((source) => seen.has(source.platform)).length;
  return (
    <div className={cn(applePanel, 'flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between')}>
      <div>
        <p className="text-sm font-bold text-[#1d1d1f]">Combined platform total</p>
        <p className="mt-1 text-xs font-medium leading-5 text-[#6e6e73]">
          Every headline and feature row combines the three platforms inside this environment only.
        </p>
        <p className="mt-1 text-xs font-semibold leading-5 text-[#86868b]">
          Qualifying Location activity observed on {sourcesWithActivity} of {sources.length} included platform streams.
          Zero-event streams remain included in the total.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {sources.map((source) => {
          return (
            <span
              key={source.platform}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#e9f8ee] px-3 py-1.5 text-xs font-bold text-[#1f7a3c]"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {source.label} included
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function OneLocationAnalyticsPanel({
  one,
  uat,
  environment,
  tab,
  rangeLabel,
  dateControl,
  onBack,
  onEnvironmentChange,
  onTabChange,
}: {
  one: OneAppSummary | null;
  uat: OneAppSummary | null;
  environment: LocationAnalyticsEnvironment;
  tab: LocationAnalyticsTab;
  rangeLabel: string;
  dateControl: ReactNode;
  onBack: () => void;
  onEnvironmentChange: (environment: LocationAnalyticsEnvironment) => void;
  onTabChange: (tab: LocationAnalyticsTab) => void;
}): ReactElement {
  const selectedOne = environment === 'production' ? one : uat;
  const environmentConfig = environments.find((item) => item.key === environment) ?? environments[0];
  const locationAnalytics = selectedOne?.locationAnalytics;
  const locationCapability = selectedOne?.capabilities.find((capability) => capability.key === 'location');
  const byKey = useMemo(
    () => new Map((locationAnalytics?.features ?? []).map((feature) => [feature.key, feature])),
    [locationAnalytics?.features],
  );
  const requestFulfilled = locationAnalytics?.journey.find((row) => row.key === 'request_fulfilled');
  const circleEngaged = locationAnalytics?.journey.find((row) => row.key === 'circle_engaged');
  const trend = (selectedOne?.daily ?? []).map((point) => ({
    date: point.eventDate.slice(5),
    active: point.locationUsers,
    sharing: byKey.get('live_sharing')?.daily.find((row) => row.eventDate === point.eventDate)?.users ?? 0,
  }));

  return (
    <main className="space-y-6 sm:space-y-8">
      <section className={dashboardBand}>
        <button
          type="button"
          onClick={onBack}
          className="mb-4 inline-flex min-h-10 items-center gap-2 rounded-full px-3 text-sm font-semibold text-[#007aff] transition hover:bg-white/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#007aff]"
        >
          <ArrowLeft className="h-4 w-4" />
          All One agents
        </button>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className={appleLabel}>{environmentConfig.sourceLabel} · One Location · {rangeLabel}</p>
            <h2 className="mt-1 text-3xl font-semibold tracking-tight text-[#1d1d1f] sm:text-4xl">One Location analytics</h2>
            <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-[#6e6e73]">
              Behaviour across web, iPhone and Android—from Connect and Circles through requests, sharing and Check-In.
            </p>
          </div>
          <div className="w-full lg:w-auto">{dateControl}</div>
        </div>
        <div className="mt-5 grid gap-3 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center">
          <div
            className="grid w-full grid-cols-2 gap-1 rounded-xl bg-black/[0.045] p-1 sm:flex sm:w-fit"
            role="tablist"
            aria-label="One Location analytics environment"
          >
            {environments.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={environment === item.key}
                onClick={() => onEnvironmentChange(item.key)}
                className={cn(
                  'min-h-10 min-w-0 rounded-lg px-3 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#007aff] sm:shrink-0 sm:px-4',
                  environment === item.key
                    ? 'bg-white text-[#1d1d1f] shadow-sm'
                    : 'text-[#6e6e73] hover:text-[#1d1d1f]',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
          <p className="text-xs font-semibold leading-5 text-[#6e6e73]">
            {environmentConfig.description} Counts never mix across environments.
          </p>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-1 rounded-xl bg-black/[0.035] p-1 sm:flex" role="tablist" aria-label="One Location analytics sections">
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              onClick={() => onTabChange(item.key)}
              className={cn(
                'min-h-10 min-w-0 rounded-lg px-3 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#007aff] sm:shrink-0 sm:px-4',
                tab === item.key ? 'bg-white text-[#1d1d1f] shadow-sm' : 'text-[#6e6e73] hover:text-[#1d1d1f]',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      {(!selectedOne || !selectedOne.available || !locationAnalytics) ? (
        <section className={cn(applePanel, 'p-8 text-center')}>
          <p className="text-base font-bold text-[#1d1d1f]">
            {environment === 'production' ? 'Production' : 'UAT/test'} analytics are unavailable.
          </p>
          <p className="mx-auto mt-2 max-w-xl text-sm font-medium leading-6 text-[#6e6e73]">
            This lane stays separate and will never fall back to the other environment. Check the matching GA4 export and dashboard access.
          </p>
        </section>
      ) : (
        <>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Devices using Location" value={locationCapability?.devices ?? null} detail="Different app or browser IDs with recorded Location use in this period" icon={MapPin} />
        <StatCard label="Sharing confirmed" value={byKey.get('live_sharing')?.successes ?? null} detail="Successful confirmation records, including Check-In shares. Views are separate." icon={Radio} waiting={!selectedOne.locationBehaviorAvailable} />
        <StatCard
          label="Location requests fulfilled"
          value={requestFulfilled?.successes ?? null}
          detail={requestFulfilled?.observed
            ? `Successful fulfilment records · ${exactCount(requestFulfilled.users)} device/browser IDs · ${exactCount(requestFulfilled.failures)} failed records`
            : 'No fulfilment records found in this period'}
          icon={CheckCircle2}
          waiting={!requestFulfilled?.observed}
        />
        <StatCard label="Devices using Circles" value={circleEngaged?.users ?? null} detail="Different app or browser IDs with Circle activity" icon={UsersRound} waiting={!circleEngaged?.instrumented} />
      </div>

      <MetricCalculationGuide summary={selectedOne} />

      {!locationAnalytics.journeyActionSeen && (
        <div className="flex items-start gap-3 rounded-2xl border border-[#f0d8a8] bg-[#fff8ea] p-4 text-[#6a4600]">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="text-sm font-semibold leading-5">{environmentConfig.waitingNote}</p>
        </div>
      )}

      {(tab === 'overview' || tab === 'features') && (
        <section className="space-y-4">
          <div>
            <p className={appleLabel}>Feature adoption</p>
            <h3 className="mt-1 text-2xl font-semibold text-[#1d1d1f]">What devices actually use</h3>
          </div>
          <FeatureTable features={locationAnalytics.features} environment={environment} summary={selectedOne} />
        </section>
      )}

      {tab === 'overview' && (
        <section className="grid gap-4 xl:grid-cols-[1.3fr_0.7fr]">
          <div className={cn(applePanel, 'p-5 sm:p-6')}>
            <p className="text-base font-bold text-[#1d1d1f]">Daily Location activity</p>
            <p className="mt-1 text-xs font-medium text-[#86868b]">Unique devices using Location versus live sharing</p>
            <div className="mt-5 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="location-active" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#007aff" stopOpacity={0.24} />
                      <stop offset="100%" stopColor="#007aff" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="rgba(0,0,0,0.06)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#86868b' }} axisLine={false} tickLine={false} minTickGap={24} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#86868b' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid rgba(0,0,0,0.08)', fontSize: 12 }} />
                  <Area type="monotone" dataKey="active" name="Devices using Location" stroke="#007aff" strokeWidth={2.4} fill="url(#location-active)" isAnimationActive={false} />
                  <Area type="monotone" dataKey="sharing" name="Live sharing devices" stroke="#34c759" strokeWidth={2} fill="transparent" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
          <JourneyReach rows={locationAnalytics.journey.slice(0, 7)} />
        </section>
      )}

      {(tab === 'overview' || tab === 'circles') && (
        <section className="space-y-4">
          <div>
            <p className={appleLabel}>Circles</p>
            <h3 className="mt-1 text-2xl font-semibold text-[#1d1d1f]">Creation mix and engagement</h3>
          </div>
          <CircleBreakdown one={selectedOne} />
        </section>
      )}

      {(tab === 'overview' || tab === 'journey') && (
        <section className="space-y-4">
          <div>
            <p className={appleLabel}>Cross-surface journey</p>
            <h3 className="mt-1 text-2xl font-semibold text-[#1d1d1f]">Connect to Circle to location value</h3>
          </div>
          <JourneyReach rows={locationAnalytics.journey} />
        </section>
      )}

      {(tab === 'overview' || tab === 'features') && (
        <section className="space-y-4">
          <div>
            <p className={appleLabel}>Coverage</p>
            <h3 className="mt-1 text-2xl font-semibold text-[#1d1d1f]">All platforms, one total</h3>
          </div>
          <SourceCompleteness one={selectedOne} environment={environment} />
        </section>
      )}

      <section className={dashboardBand}>
        <div className={cn(applePanel, 'flex flex-col gap-2 p-5')}>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[#34c759]" />
            <p className="text-sm font-bold text-[#1d1d1f]">Privacy-safe aggregate analytics</p>
          </div>
          <p className="text-sm font-medium leading-6 text-[#6e6e73]">
            Aggregate GA4 export rows only. Coordinates, Circle names, contact details, member identities, invitation codes, public-link tokens and message content never reach this dashboard. Devices and browsers are not deduplicated into people.
          </p>
        </div>
      </section>
        </>
      )}
    </main>
  );
}
