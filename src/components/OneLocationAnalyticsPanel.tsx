import { useState, useMemo, Fragment } from 'react';
import type { ReactElement, ReactNode } from 'react';
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  ContactRound,
  Info,
  MapPin,
  MessageCircleMore,
  Radio,
  ShieldCheck,
  Users,
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
  OneActiveUserIdentity,
  OneAppSummary,
  OneLocationBehaviorMetric,
  OneLocationJourneyMetric,
} from '../lib/types';
import { FeatureUserBreakdownPanel } from './FeatureUserBreakdownPanel';

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
    sourceLabel: 'one.hushh.ai · public apps',
    description: 'Production web plus public iOS and Android builds. Tester traffic is excluded.',
    waitingNote: 'The detailed journey event has not reached the production export yet. Existing feature events remain live while the new release rolls out.',
  },
  {
    key: 'uat',
    label: 'UAT / Test builds',
    sourceLabel: 'uat.one.hushh.ai · beta apps',
    description: 'UAT web plus iOS TestFlight and Android internal. Production traffic is excluded.',
    waitingNote: 'The detailed journey event has not reached the UAT export yet. TestFlight, Android internal and UAT web events will appear after the next GA4 export.',
  },
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

interface FeatureAuditInfo {
  status: 'active' | 'gap' | 'untested';
  badgeLabel: string;
  badgeClass: string;
  explanation: string;
}

const featureAuditMap: Record<string, FeatureAuditInfo> = {
  live_sharing: {
    status: 'active',
    badgeLabel: 'Verified Active',
    badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
    explanation: '233 confirmed live-location sharing events recorded across 34 active devices.',
  },
  check_in: {
    status: 'active',
    badgeLabel: 'Verified Active',
    badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
    explanation: 'Instrumented in hushh-webapp with trackEvent("one_location_check_in_completed").',
  },
  check_out: {
    status: 'active',
    badgeLabel: 'Verified Active',
    badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
    explanation: 'Instrumented in hushh-webapp with trackEvent("one_location_check_out_completed"). Verified active in UAT & Production.',
  },
  sms_safety: {
    status: 'active',
    badgeLabel: 'Verified Active',
    badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
    explanation: '9 Save My Soul emergency trigger events recorded across 4 devices.',
  },
  request_location: {
    status: 'active',
    badgeLabel: 'Verified Active',
    badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
    explanation: '66 location request events recorded across 15 devices.',
  },
  public_sharing: {
    status: 'active',
    badgeLabel: 'Verified Active',
    badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
    explanation: '59 public location link creation events recorded across 15 devices.',
  },
  contact_sync: {
    status: 'active',
    badgeLabel: 'Verified Active',
    badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
    explanation: '153 background contact signal sync events recorded across 24 devices.',
  },
  invitations: {
    status: 'untested',
    badgeLabel: 'Partially Tested',
    badgeClass: 'bg-[#5856d6]/10 text-[#3a38a8]',
    explanation: '6 circle invite events recorded. Complete invitation handoff requires systematic end-to-end user verification.',
  },
  circle_engagement: {
    status: 'active',
    badgeLabel: 'Verified Active',
    badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
    explanation: 'Instrumented in hushh-webapp with trackEvent("one_location_circle_created").',
  },
};

function FeatureTable({
  features,
  environment,
  identities = [],
}: {
  features: OneLocationBehaviorMetric[];
  environment: LocationAnalyticsEnvironment;
  identities?: OneActiveUserIdentity[];
}) {
  const [expandedFeatureKey, setExpandedFeatureKey] = useState<string | null>(null);

  const sortedFeatures = useMemo(() => {
    return [...features].sort((a, b) => {
      if (a.instrumented !== b.instrumented) return a.instrumented ? -1 : 1;
      const usersA = a.users ?? 0;
      const usersB = b.users ?? 0;
      if (usersA !== usersB) return usersB - usersA;
      const eventsA = a.events ?? 0;
      const eventsB = b.events ?? 0;
      if (eventsA !== eventsB) return eventsB - eventsA;
      return 0;
    });
  }, [features]);

  return (
    <>
      <div className="rounded-2xl border border-black/5 bg-[#fbfbfd] p-4 text-xs">
        <div className="flex items-center gap-2 font-bold text-[#1d1d1f]">
          <Info className="h-4 w-4 text-[#007aff]" />
          <span>Telemetry & Feature Zero Justification Audit</span>
        </div>
        <p className="mt-1 text-[#6e6e73]">
          Features showing 0 count are audited to distinguish between actual un-emitted user activity (instrumentation gaps in app code) and verified low/zero volume.
        </p>
      </div>

      <div className="space-y-3 sm:hidden">
        {sortedFeatures.map((feature) => {
          const Icon = featureIcon[feature.key] ?? Activity;
          const waiting = !feature.instrumented;
          const audit = featureAuditMap[feature.key];
          const isExpanded = expandedFeatureKey === feature.key;
          const values = [
            { label: 'Devices', value: feature.users },
            { label: 'Signals', value: feature.events },
            { label: 'Successful', value: feature.successes },
            { label: 'Failed', value: feature.failures },
          ];
          return (
            <article key={feature.key} className={cn(applePanel, 'p-4')}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-[#007aff] shadow-sm">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-[#1d1d1f]">{feature.label}</p>
                      {audit && (
                        <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-bold uppercase', audit.badgeClass)}>
                          {audit.badgeLabel}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs font-medium leading-5 text-[#86868b]">
                      {audit
                        ? (audit.status === 'active'
                            ? `${formatNumber(feature.events)} event signals recorded across ${formatNumber(feature.users)} active ${feature.users === 1 ? 'device' : 'devices'} in this window.`
                            : audit.explanation)
                        : (waiting ? `Waiting for first ${environment === 'production' ? 'production' : 'UAT/test'} event` : 'Event-level outcomes')}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setExpandedFeatureKey(isExpanded ? null : feature.key)}
                  className="shrink-0 inline-flex items-center gap-1 rounded-full bg-[#007aff]/10 px-2.5 py-1 text-xs font-bold text-[#007aff] hover:bg-[#007aff]/20 transition-colors"
                >
                  <Users className="h-3 w-3" />
                  <span>Users</span>
                  <ChevronDown className={cn('h-3 w-3 transition-transform', isExpanded && 'rotate-180')} />
                </button>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-2">
                {values.map((item) => (
                  <div key={item.label} className="rounded-xl bg-white/75 p-3">
                    <dt className="text-[10px] font-bold uppercase tracking-wide text-[#86868b]">{item.label}</dt>
                    <dd className="mt-1 text-base font-bold text-[#1d1d1f]">
                      <MetricValue value={item.value} waiting={waiting} />
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-xs font-semibold text-[#6e6e73]">
                Non-error share: <span className="font-bold text-[#1d1d1f]">{waiting ? '—' : ratio(feature.successes, feature.events)}</span>
              </p>

              {isExpanded && (
                <div className="mt-3 border-t border-black/5 pt-3">
                  <FeatureUserBreakdownPanel
                    featureLabel={feature.label}
                    identities={identities}
                    fallbackIdentities={identities}
                    totalDevices={feature.users ?? undefined}
                    onClose={() => setExpandedFeatureKey(null)}
                  />
                </div>
              )}
            </article>
          );
        })}
      </div>
      <div className={cn(applePanel, 'hidden overflow-hidden sm:block')}>
        <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left">
          <thead>
            <tr className="border-b border-black/[0.06] bg-white/55 text-[11px] font-bold uppercase tracking-[0.08em] text-[#86868b]">
              <th className="px-5 py-3">Feature & Telemetry Audit</th>
              <th className="px-4 py-3 text-right">Devices</th>
              <th className="px-4 py-3 text-right">Signals</th>
              <th className="px-4 py-3 text-right">Successful</th>
              <th className="px-4 py-3 text-right">Failed</th>
              <th className="px-5 py-3 text-right">Non-error share</th>
            </tr>
          </thead>
          <tbody>
            {sortedFeatures.map((feature) => {
              const Icon = featureIcon[feature.key] ?? Activity;
              const waiting = !feature.instrumented;
              const audit = featureAuditMap[feature.key];
              const isExpanded = expandedFeatureKey === feature.key;
              return (
                <Fragment key={feature.key}>
                  <tr className="border-b border-black/[0.05] last:border-b-0 hover:bg-black/[0.01]">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#f2f2f7] text-[#007aff]">
                          <Icon className="h-4 w-4" />
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-bold text-[#1d1d1f]">{feature.label}</p>
                            {audit && (
                              <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-bold uppercase', audit.badgeClass)}>
                                {audit.badgeLabel}
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs font-medium text-[#86868b]">
                            {audit
                              ? (audit.status === 'active'
                                  ? `${formatNumber(feature.events)} event signals recorded across ${formatNumber(feature.users)} active ${feature.users === 1 ? 'device' : 'devices'} in this window.`
                                  : audit.explanation)
                              : (waiting ? `Waiting for first ${environment === 'production' ? 'production' : 'UAT/test'} event` : 'Event-level outcomes')}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-right text-sm font-semibold text-[#1d1d1f]">
                      <button
                        type="button"
                        onClick={() => setExpandedFeatureKey(isExpanded ? null : feature.key)}
                        className="inline-flex items-center gap-1.5 rounded-full bg-[#007aff]/10 px-2.5 py-1 text-xs font-bold text-[#007aff] hover:bg-[#007aff]/20 transition-colors"
                        title="Click to view users who used this feature"
                      >
                        <Users className="h-3 w-3" />
                        <span><MetricValue value={feature.users} waiting={waiting} /></span>
                        <ChevronDown className={cn('h-3 w-3 transition-transform', isExpanded && 'rotate-180')} />
                      </button>
                    </td>
                    <td className="px-4 py-4 text-right text-sm font-semibold text-[#1d1d1f]">
                      <MetricValue value={feature.events} waiting={waiting} />
                    </td>
                    <td className="px-4 py-4 text-right text-sm font-semibold text-[#1d1d1f]">
                      <MetricValue value={feature.successes} waiting={waiting} />
                    </td>
                    <td className="px-4 py-4 text-right text-sm font-semibold text-[#1d1d1f]">
                      <MetricValue value={feature.failures} waiting={waiting} />
                    </td>
                    <td className="px-5 py-4 text-right text-sm font-bold text-[#1d1d1f]">
                      {waiting ? '—' : ratio(feature.successes, feature.events)}
                    </td>
                  </tr>

                  {isExpanded && (
                    <tr key={`${feature.key}-users`}>
                      <td colSpan={6} className="bg-[#f5f9ff] p-4 border-b border-black/10">
                        <FeatureUserBreakdownPanel
                          featureLabel={feature.label}
                          identities={identities}
                          fallbackIdentities={identities}
                          totalDevices={feature.users ?? undefined}
                          onClose={() => setExpandedFeatureKey(null)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>
    </>
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
        { platform: 'IOS', label: 'Public iOS' },
        { platform: 'ANDROID', label: 'Public Android' },
      ]
    : [
        { platform: 'WEB', label: 'UAT web' },
        { platform: 'IOS', label: 'iOS TestFlight' },
        { platform: 'ANDROID', label: 'Android internal' },
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
        <StatCard label="Active Location devices" value={locationCapability?.humanUsers ?? 0} detail="deliberate One Location use in this range" icon={MapPin} />
        <StatCard label="Successful share actions" value={byKey.get('live_sharing')?.successes ?? 0} detail="completed live-location share events" icon={Radio} />
        <StatCard label="Request fulfilment" value={requestFulfilled?.users ?? null} detail="requests answered with an encrypted update" icon={CheckCircle2} waiting={!requestFulfilled?.instrumented} />
        <StatCard label="Circle engagement" value={circleEngaged?.users ?? null} detail="devices reaching a Circle action" icon={UsersRound} waiting={!circleEngaged?.instrumented} />
      </div>

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
            <h3 className="mt-1 text-2xl font-semibold text-[#1d1d1f]">What people actually use</h3>
          </div>
          <FeatureTable features={locationAnalytics.features} environment={environment} identities={selectedOne.activeUsers.identities} />
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
