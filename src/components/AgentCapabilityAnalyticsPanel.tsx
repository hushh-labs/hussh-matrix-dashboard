import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  Info,
  ShieldCheck,
  Zap,
  Users,
  BarChart3,
  Calendar,
  Lock,
  Mail,
  Wallet,
  Briefcase,
  Layers,
  Database,
  UserCheck,
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
import type { OneAppSummary, OneCapabilityUsage } from '../lib/types';

interface AgentCapabilityAnalyticsPanelProps {
  capabilityKey: string;
  one: OneAppSummary | null;
  uat: OneAppSummary | null;
  rangeLabel: string;
  dateControl: ReactNode;
  onBack: () => void;
}

const capabilityMetadata: Record<
  string,
  {
    title: string;
    description: string;
    icon: typeof Activity;
    auditExplanation: string;
  }
> = {
  location: {
    title: 'Location Agent',
    description: 'Real-time location sharing, SOS safety, check-in, request location, and contact sync.',
    icon: Activity,
    auditExplanation: 'Location sharing and SOS events are verified active in production GA4 export. Check-in and invitation handoffs are monitored.',
  },
  finance: {
    title: 'Finance Agent',
    description: 'Portfolio tracking, AI financial recommendations, analysis streaming, and transaction parsing.',
    icon: BarChart3,
    auditExplanation: 'Human events (portfolio_viewed, recommendation_viewed, analysis_stream_started) measure deliberate user interaction. Background market pings are separated.',
  },
  consent: {
    title: 'Consent Agent',
    description: 'User data consent preferences, permission grants, and data unlock requests.',
    icon: ShieldCheck,
    auditExplanation: 'Consent action submissions are logged when users confirm or update privacy preferences. Screen loads are split from warm prefetches.',
  },
  gmail: {
    title: 'Gmail Agent',
    description: 'Gmail account connection, email receipt syncing, and Hushh Mail integration.',
    icon: Mail,
    auditExplanation: 'Tracks sign-in screen views, connection attempts, and receipt sync requests.',
  },
  ria: {
    title: 'RIA Agent',
    description: 'Registered Investment Advisor onboarding, verification status, and workspace interaction.',
    icon: Briefcase,
    auditExplanation: 'Tracks advisor verification changes, workspace visits, and request creation.',
  },
  marketplace: {
    title: 'Information Marketplace Agent',
    description: 'Data marketplace browsing, profile views, and data catalog interaction.',
    icon: Layers,
    auditExplanation: 'Marketplace profile views measure user exploration of data deals.',
  },
  memory: {
    title: 'Memory Agent',
    description: 'Personal Knowledge Model (PKM) context resolution and memory persistence.',
    icon: Database,
    auditExplanation: 'Only PKM agent-turn reliability diagnostics are currently emitted. User-facing memory management telemetry is pending.',
  },
  wallet: {
    title: 'Wallet Agent',
    description: 'Hushh identity wallet, card credentials, and asset management.',
    icon: Wallet,
    auditExplanation: 'No wallet event is emitted in current app code. Telemetry instrumentation pending.',
  },
  calendar: {
    title: 'Calendar Agent',
    description: 'Schedule management, event syncing, and availability checks.',
    icon: Calendar,
    auditExplanation: 'No calendar event is emitted in current app code. Telemetry instrumentation pending.',
  },
  kyc: {
    title: 'KYC Agent',
    description: 'Identity verification, document upload, and compliance checks.',
    icon: Lock,
    auditExplanation: 'No KYC event is emitted in current app code. Telemetry instrumentation pending.',
  },
  connected_systems: {
    title: 'CRM / Connected Systems Agent',
    description: 'Integration with Salesforce, HubSpot, and enterprise CRMs.',
    icon: Layers,
    auditExplanation: 'No CRM event is emitted in current app code. Telemetry instrumentation pending.',
  },
  onboarding: {
    title: 'Sign-up & Onboarding Agent',
    description: 'Authentication flow, phone verification, and onboarding steps.',
    icon: UserCheck,
    auditExplanation: 'Tracks auth start/success, Google sign-in, phone verification, and step completions.',
  },
};

export function AgentCapabilityAnalyticsPanel({
  capabilityKey,
  one,
  uat,
  rangeLabel,
  dateControl,
  onBack,
}: AgentCapabilityAnalyticsPanelProps) {
  const [environment, setEnvironment] = useState<'production' | 'uat'>('production');

  const activeSummary = environment === 'production' ? one : uat;
  const capability = activeSummary?.capabilities?.find((c) => c.key === capabilityKey);

  const meta = capabilityMetadata[capabilityKey] || {
    title: `${capabilityKey.toUpperCase()} Agent`,
    description: `Detailed analytics and telemetry for ${capabilityKey}`,
    icon: Activity,
    auditExplanation: `Telemetry and event tracking for ${capabilityKey}`,
  };

  const Icon = meta.icon;

  const humanUsers = capability?.humanUsers ?? 0;
  const humanEvents = capability?.humanEvents ?? 0;
  const totalUsers = capability?.totalUsers ?? 0;
  const totalEvents = capability?.totalEvents ?? 0;
  const instrumented = capability?.instrumented ?? false;
  const daily = capability?.daily ?? [];

  const backgroundEvents = Math.max(0, totalEvents - humanEvents);
  const backgroundRatio = humanEvents > 0 ? (totalEvents / humanEvents).toFixed(1) : null;

  return (
    <div className="space-y-8">
      {/* Top Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-black/5 pb-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-black/5 text-[#1d1d1f] hover:bg-black/10 transition-colors"
            aria-label="Back to One App"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#007aff]/10 text-[#007aff]">
                <Icon className="h-4 w-4" />
              </span>
              <p className={appleLabel}>{meta.title} &middot; Detailed Analytics</p>
            </div>
            <h1 className="mt-1 text-2xl font-bold text-[#1d1d1f] sm:text-3xl">
              {meta.title} Deep-Dive
            </h1>
            <p className="mt-1 text-sm font-medium text-[#6e6e73] max-w-2xl">
              {meta.description}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Environment Switcher */}
          <div className="flex rounded-lg bg-[#f5f5f7] p-1 text-xs font-bold">
            <button
              type="button"
              onClick={() => setEnvironment('production')}
              className={cn(
                'rounded-md px-3 py-1.5 transition',
                environment === 'production'
                  ? 'bg-white text-[#1d1d1f] shadow-sm'
                  : 'text-[#6e6e73] hover:text-[#1d1d1f]'
              )}
            >
              Production
            </button>
            <button
              type="button"
              onClick={() => setEnvironment('uat')}
              className={cn(
                'rounded-md px-3 py-1.5 transition',
                environment === 'uat'
                  ? 'bg-white text-[#1d1d1f] shadow-sm'
                  : 'text-[#6e6e73] hover:text-[#1d1d1f]'
              )}
            >
              UAT / Beta
            </button>
          </div>

          {dateControl}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className={cn(appleCard, 'p-5')}>
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-[#6e6e73]">Deliberate Users</p>
            <Users className="h-4 w-4 text-[#007aff]" />
          </div>
          <p className="mt-3 text-4xl font-bold text-[#1d1d1f]">
            {instrumented ? formatNumber(humanUsers) : '—'}
          </p>
          <p className="mt-1 text-xs font-semibold text-[#86868b]">
            {instrumented ? 'Unique people taking deliberate action' : 'Not instrumented'}
          </p>
        </div>

        <div className={cn(appleCard, 'p-5')}>
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-[#6e6e73]">Deliberate Actions</p>
            <Zap className="h-4 w-4 text-[#1f7a36]" />
          </div>
          <p className="mt-3 text-4xl font-bold text-[#1d1d1f]">
            {instrumented ? formatNumber(humanEvents) : '—'}
          </p>
          <p className="mt-1 text-xs font-semibold text-[#86868b]">
            {instrumented ? 'User-initiated capability events' : 'Not instrumented'}
          </p>
        </div>

        <div className={cn(appleCard, 'p-5')}>
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-[#6e6e73]">Total Telemetry Events</p>
            <Activity className="h-4 w-4 text-[#6e6e73]" />
          </div>
          <p className="mt-3 text-4xl font-bold text-[#1d1d1f]">
            {formatNumber(totalEvents)}
          </p>
          <p className="mt-1 text-xs font-semibold text-[#86868b]">
            {backgroundEvents > 0 ? `${formatNumber(backgroundEvents)} background/diagnostic pings` : 'All events deliberate'}
          </p>
        </div>

        <div className={cn(appleCard, 'p-5')}>
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-[#6e6e73]">Telemetry Status</p>
            {instrumented ? (
              <CheckCircle2 className="h-4 w-4 text-[#1f7a36]" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-[#8a5a04]" />
            )}
          </div>
          <div className="mt-3">
            <span
              className={cn(
                'inline-block rounded-full px-2.5 py-1 text-xs font-bold',
                instrumented
                  ? 'bg-[#34c759]/10 text-[#1f7a36]'
                  : 'bg-[#ff9500]/10 text-[#b36b00]'
              )}
            >
              {instrumented ? 'Instrumented' : 'Telemetry Pending'}
            </span>
          </div>
          <p className="mt-2 text-xs font-semibold text-[#86868b]">
            {instrumented ? 'Events actively exported to GA4 BigQuery' : capability?.note || 'No event emitted in app code'}
          </p>
        </div>
      </div>

      {/* Daily Active Trend Chart */}
      {instrumented && daily.length > 0 && (
        <div className={cn(appleCard, 'p-6')}>
          <div className="mb-4">
            <h3 className="text-lg font-bold text-[#1d1d1f]">Daily Deliberate Active Users</h3>
            <p className="mt-0.5 text-xs font-semibold text-[#6e6e73]">
              Daily count of users deliberately interacting with {meta.title} ({rangeLabel})
            </p>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={daily} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="agentCapGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#007aff" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#007aff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e8e8ed" vertical={false} />
                <XAxis dataKey="eventDate" stroke="#86868b" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#86868b" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{
                    borderRadius: 10,
                    border: '1px solid rgba(0,0,0,0.06)',
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                  formatter={(value: number) => [formatNumber(value), 'Active Users']}
                />
                <Area
                  type="monotone"
                  dataKey="users"
                  stroke="#007aff"
                  strokeWidth={2.5}
                  fill="url(#agentCapGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Telemetry Audit & Explanation */}
      <div className={cn(appleCard, 'p-6')}>
        <div className="flex items-start gap-3">
          <Info className="h-5 w-5 text-[#007aff] shrink-0 mt-0.5" />
          <div>
            <h3 className="text-base font-bold text-[#1d1d1f]">Telemetry Audit & Instrumentation Justification</h3>
            <p className="mt-1 text-xs font-semibold leading-5 text-[#6e6e73]">
              {meta.auditExplanation}
            </p>
            {capability?.note && (
              <p className="mt-2 rounded-lg bg-[#fff7e6] p-3 text-xs font-semibold text-[#8a5a04] border border-[#ff9500]/20">
                <strong>Notice:</strong> {capability.note}
              </p>
            )}
            {backgroundRatio && parseFloat(backgroundRatio) > 1.5 && (
              <p className="mt-2 text-xs font-medium text-[#6e6e73]">
                💡 <strong>Background Ratio:</strong> {backgroundRatio}× total events relative to deliberate human actions. Background pings (retries, pre-fetches, diagnostics) are filtered out from DAU metrics to maintain data integrity.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
