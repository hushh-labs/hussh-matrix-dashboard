import { useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  CircleDot,
  ContactRound,
  Info,
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
  OneAppSummary,
  OneLocationBehaviorMetric,
  OneLocationJourneyMetric,
} from '../lib/types';

type DetailTab = 'overview' | 'features' | 'circles' | 'journey';

const tabs: Array<{ key: DetailTab; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'features', label: 'Features' },
  { key: 'circles', label: 'Circles' },
  { key: 'journey', label: 'Journey' },
];

const featureIcon: Record<string, typeof MapPin> = {
  live_sharing: Radio,
  check_in: CheckCircle2,
  sms_safety: MessageCircleMore,
  request_location: MapPin,
  public_sharing: ShieldCheck,
  contact_sync: ContactRound,
  invitations: UsersRound,
  circle_engagement: CircleDot,
};

function ratio(numerator: number | null, denominator: number | null): string {
  if (numerator === null || denominator === null || denominator <= 0) return '—';
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function MetricValue({ value, waiting = false }: { value: number | null; waiting?: boolean }) {
  if (waiting || value === null) {
    return <span className="text-xs font-semibold text-[#86868b]">Measuring after rollout</span>;
  }
  return <>{formatNumber(value)}</>;
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

function FeatureTable({ features }: { features: OneLocationBehaviorMetric[] }) {
  return (
    <div className={cn(applePanel, 'overflow-hidden')}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left">
          <thead>
            <tr className="border-b border-black/[0.06] bg-white/55 text-[11px] font-bold uppercase tracking-[0.08em] text-[#86868b]">
              <th className="px-5 py-3">Feature</th>
              <th className="px-4 py-3 text-right">Devices</th>
              <th className="px-4 py-3 text-right">Signals</th>
              <th className="px-4 py-3 text-right">Successful</th>
              <th className="px-4 py-3 text-right">Failed</th>
              <th className="px-5 py-3 text-right">Non-error share</th>
            </tr>
          </thead>
          <tbody>
            {features.map((feature) => {
              const Icon = featureIcon[feature.key] ?? Activity;
              const waiting = !feature.instrumented;
              return (
                <tr key={feature.key} className="border-b border-black/[0.05] last:border-b-0">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#f2f2f7] text-[#007aff]">
                        <Icon className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="text-sm font-bold text-[#1d1d1f]">{feature.label}</p>
                        <p className="mt-0.5 text-xs font-medium text-[#86868b]">
                          {waiting ? 'Waiting for first production event' : 'Event-level outcomes · not funnel conversion'}
                        </p>
                      </div>
                    </div>
                  </td>
                  {[feature.users, feature.events, feature.successes, feature.failures].map((value, index) => (
                    <td key={index} className="px-4 py-4 text-right text-sm font-semibold text-[#1d1d1f]">
                      <MetricValue value={value} waiting={waiting} />
                    </td>
                  ))}
                  <td className="px-5 py-4 text-right text-sm font-bold text-[#1d1d1f]">
                    {waiting ? '—' : ratio(feature.successes, feature.events)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
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
          const width = row.instrumented ? Math.max(2, ((row.users ?? 0) / max) * 100) : 0;
          return (
            <li key={row.key} className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#f2f2f7] text-[11px] font-bold text-[#6e6e73]">
                {index + 1}
              </span>
              <div className="min-w-0">
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <p className="truncate text-sm font-semibold text-[#1d1d1f]">{row.label}</p>
                  {!row.instrumented && (
                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-[#8a5a04]">Rolling out</span>
                  )}
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[#ececf0]">
                  <div className="h-full rounded-full bg-[#007aff]" style={{ width: `${width}%` }} />
                </div>
              </div>
              <p className="min-w-12 text-right text-sm font-bold text-[#1d1d1f]">
                <MetricValue value={row.users} waiting={!row.instrumented} />
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

function SourceCompleteness({ one }: { one: OneAppSummary }) {
  const seen = new Set(
    one.locationAnalytics.platforms
      .filter((row) => row.events > 0)
      .map((row) => row.platform.toUpperCase()),
  );
  const sources = [
    { platform: 'WEB', label: 'Web app' },
    { platform: 'IOS', label: 'iOS app' },
    { platform: 'ANDROID', label: 'Android app' },
  ];
  return (
    <div className={cn(applePanel, 'flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between')}>
      <div>
        <p className="text-sm font-bold text-[#1d1d1f]">Combined platform total</p>
        <p className="mt-1 text-xs font-medium leading-5 text-[#6e6e73]">
          Every headline and feature row combines all supported One surfaces; no platform is scored separately.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {sources.map((source) => {
          const included = seen.has(source.platform);
          return (
            <span
              key={source.platform}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold',
                included ? 'bg-[#e9f8ee] text-[#1f7a3c]' : 'bg-[#f2f2f7] text-[#86868b]',
              )}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {source.label} {included ? 'included' : 'waiting for events'}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function OneLocationAnalyticsPanel({
  one,
  rangeLabel,
  dateControl,
  onBack,
}: {
  one: OneAppSummary;
  rangeLabel: string;
  dateControl: ReactNode;
  onBack: () => void;
}): ReactElement {
  const [tab, setTab] = useState<DetailTab>('overview');
  const locationCapability = one.capabilities.find((capability) => capability.key === 'location');
  const byKey = useMemo(
    () => new Map(one.locationAnalytics.features.map((feature) => [feature.key, feature])),
    [one.locationAnalytics.features],
  );
  const requestFulfilled = one.locationAnalytics.journey.find((row) => row.key === 'request_fulfilled');
  const circleEngaged = one.locationAnalytics.journey.find((row) => row.key === 'circle_engaged');
  const trend = one.daily.map((point) => ({
    date: point.eventDate.slice(5),
    active: point.locationUsers,
    sharing: byKey.get('live_sharing')?.daily.find((row) => row.eventDate === point.eventDate)?.users ?? 0,
  }));

  return (
    <main className="space-y-8">
      <section className={dashboardBand}>
        <button
          type="button"
          onClick={onBack}
          className="mb-4 inline-flex min-h-10 items-center gap-2 rounded-full px-3 text-sm font-semibold text-[#007aff] transition hover:bg-white/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#007aff]"
        >
          <ArrowLeft className="h-4 w-4" />
          All One agents
        </button>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className={appleLabel}>one.hushh.ai · One Location · {rangeLabel}</p>
            <h2 className="mt-1 text-3xl font-semibold tracking-tight text-[#1d1d1f] sm:text-4xl">One Location analytics</h2>
            <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-[#6e6e73]">
              Behaviour across web, iPhone and Android—from Connect and Circles through requests, sharing and Check-In.
            </p>
          </div>
          {dateControl}
        </div>
        <div className="mt-5 flex max-w-full gap-1 overflow-x-auto rounded-xl bg-black/[0.035] p-1" role="tablist" aria-label="One Location analytics sections">
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              onClick={() => setTab(item.key)}
              className={cn(
                'min-h-10 shrink-0 rounded-lg px-4 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#007aff]',
                tab === item.key ? 'bg-white text-[#1d1d1f] shadow-sm' : 'text-[#6e6e73] hover:text-[#1d1d1f]',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active Location devices" value={locationCapability?.humanUsers ?? 0} detail="deliberate One Location use in this range" icon={MapPin} />
        <StatCard label="Successful share actions" value={byKey.get('live_sharing')?.successes ?? 0} detail="completed live-location share events" icon={Radio} />
        <StatCard label="Request fulfilment" value={requestFulfilled?.users ?? null} detail="requests answered with an encrypted update" icon={CheckCircle2} waiting={!requestFulfilled?.instrumented} />
        <StatCard label="Circle engagement" value={circleEngaged?.users ?? null} detail="devices reaching a Circle action" icon={UsersRound} waiting={!circleEngaged?.instrumented} />
      </div>

      {!one.locationAnalytics.journeyActionSeen && (
        <div className="flex items-start gap-3 rounded-2xl border border-[#f0d8a8] bg-[#fff8ea] p-4 text-[#6a4600]">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="text-sm font-semibold leading-5">{one.locationAnalytics.instrumentationNote}</p>
        </div>
      )}

      {(tab === 'overview' || tab === 'features') && (
        <section className="space-y-4">
          <div>
            <p className={appleLabel}>Feature adoption</p>
            <h3 className="mt-1 text-2xl font-semibold text-[#1d1d1f]">What people actually use</h3>
          </div>
          <FeatureTable features={one.locationAnalytics.features} />
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
                  <Area type="monotone" dataKey="active" name="Active Location devices" stroke="#007aff" strokeWidth={2.4} fill="url(#location-active)" isAnimationActive={false} />
                  <Area type="monotone" dataKey="sharing" name="Live sharing devices" stroke="#34c759" strokeWidth={2} fill="transparent" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
          <JourneyReach rows={one.locationAnalytics.journey.slice(0, 7)} />
        </section>
      )}

      {(tab === 'overview' || tab === 'circles') && (
        <section className="space-y-4">
          <div>
            <p className={appleLabel}>Circles</p>
            <h3 className="mt-1 text-2xl font-semibold text-[#1d1d1f]">Creation mix and engagement</h3>
          </div>
          <CircleBreakdown one={one} />
        </section>
      )}

      {(tab === 'overview' || tab === 'journey') && (
        <section className="space-y-4">
          <div>
            <p className={appleLabel}>Cross-surface journey</p>
            <h3 className="mt-1 text-2xl font-semibold text-[#1d1d1f]">Connect to Circle to location value</h3>
          </div>
          <JourneyReach rows={one.locationAnalytics.journey} />
        </section>
      )}

      {(tab === 'overview' || tab === 'features') && (
        <section className="space-y-4">
          <div>
            <p className={appleLabel}>Coverage</p>
            <h3 className="mt-1 text-2xl font-semibold text-[#1d1d1f]">All platforms, one total</h3>
          </div>
          <SourceCompleteness one={one} />
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
    </main>
  );
}
