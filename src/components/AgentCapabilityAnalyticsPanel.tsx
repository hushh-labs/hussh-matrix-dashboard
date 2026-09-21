import { useState, Fragment } from 'react';
import type { ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Briefcase,
  Calendar,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  ContactRound,
  Database,
  Download,
  FileText,
  Info,
  Key,
  Layers,
  Lock,
  Mail,
  MapPin,
  MessageCircleMore,
  Radio,
  RefreshCw,
  Send,
  ShieldCheck,
  Sliders,
  TrendingUp,
  User,
  UserCheck,
  Users,
  UsersRound,
  Wallet,
  Zap,
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
import { appleCard, appleLabel, applePanel } from '../lib/theme';
import { cn } from '../lib/utils';
import type { OneAppSummary } from '../lib/types';
import { FeatureUserBreakdownPanel } from './FeatureUserBreakdownPanel';

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
    auditExplanation: 'Location sharing and SOS events are verified active in GA4 export. Check-in and invitation handoffs are monitored.',
  },
  finance: {
    title: 'Finance Agent',
    description: 'Portfolio tracking, AI financial recommendations, analysis streaming, and transaction parsing.',
    icon: BarChart3,
    auditExplanation: 'Deliberate events (portfolio_viewed, recommendation_viewed, analysis_stream_started) measure device-level interaction.',
  },
  consent: {
    title: 'Consent Agent',
    description: 'User data consent preferences, permission grants, and data unlock requests.',
    icon: ShieldCheck,
    auditExplanation: 'Consent action submissions are logged when a device confirms or updates privacy preferences.',
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
    auditExplanation: 'Marketplace profile views measure device-level exploration of data deals.',
  },
  memory: {
    title: 'Memory Agent',
    description: 'Personal Knowledge Model (PKM) context resolution and memory persistence.',
    icon: Database,
    auditExplanation: 'PKM agent context resolution telemetry is emitted for device-level interactions.',
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

interface FeatureAuditSpec {
  key: string;
  label: string;
  icon: typeof Activity;
  status: 'active' | 'gap' | 'untested';
  badgeLabel: string;
  badgeClass: string;
  explanation: string;
}

const featureAuditSpecs: Record<string, FeatureAuditSpec[]> = {
  onboarding: [
    {
      key: 'auth_started',
      label: 'Auth start & Method Selection',
      icon: UserCheck,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Instrumented in hushh-webapp with trackEvent("one_auth_started"). Tracks entry point & provider choice.',
    },
    {
      key: 'phone_verified',
      label: 'Phone Verification & OTP',
      icon: Key,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Instrumented in hushh-webapp with trackEvent("one_auth_phone_verified"). Verifies SMS OTP handoffs.',
    },
    {
      key: 'google_signin',
      label: 'Google Sign-In Handoff',
      icon: User,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Instrumented in hushh-webapp with trackEvent("one_auth_google_signed_in"). OAuth 2.0 token exchange.',
    },
    {
      key: 'profile_created',
      label: 'Profile Setup & Catalog Bind',
      icon: FileText,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Instrumented in hushh-webapp with trackEvent("one_auth_profile_created"). Firebase catalog binding.',
    },
    {
      key: 'onboarding_completed',
      label: 'Onboarding Flow Completion',
      icon: CheckCircle2,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Instrumented in hushh-webapp with trackEvent("one_auth_onboarding_completed"). Full setup confirmation.',
    },
  ],
  finance: [
    {
      key: 'portfolio_view',
      label: 'Portfolio Overview',
      icon: BarChart3,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Instrumented in hushh-webapp with trackEvent("one_finance_portfolio_viewed"). Asset summary screen.',
    },
    {
      key: 'ai_recommendation',
      label: 'AI Recommendation Engine',
      icon: Zap,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Instrumented in hushh-webapp with trackEvent("one_finance_recommendation_viewed"). AI insights generation.',
    },
    {
      key: 'analysis_stream',
      label: 'Real-Time Analysis Stream',
      icon: TrendingUp,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Instrumented in hushh-webapp with trackEvent("one_finance_analysis_stream_started"). Streaming market metrics.',
    },
    {
      key: 'receipt_parsed',
      label: 'Transaction & Bank Parsing',
      icon: FileText,
      status: 'untested',
      badgeLabel: 'Partially Tested',
      badgeClass: 'bg-[#5856d6]/10 text-[#3a38a8]',
      explanation: 'Parsing engine active in test builds; requires expanded transaction sample verification.',
    },
  ],
  consent: [
    {
      key: 'preferences_updated',
      label: 'Data Consent Preferences',
      icon: ShieldCheck,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Instrumented in hushh-webapp with trackEvent("one_consent_preferences_updated"). Privacy toggle updates.',
    },
    {
      key: 'data_unlock',
      label: 'Data Unlock Requests',
      icon: Lock,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Instrumented in hushh-webapp with trackEvent("one_consent_data_unlock_requested"). Vault key unlock trigger.',
    },
    {
      key: 'permission_granted',
      label: 'Agent Permission Grants',
      icon: CheckCircle2,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Instrumented in hushh-webapp with trackEvent("one_consent_permission_granted"). Per-agent scope approval.',
    },
    {
      key: 'revocation_submitted',
      label: 'Consent Revocation Audit',
      icon: AlertTriangle,
      status: 'gap',
      badgeLabel: 'Instrumentation Gap',
      badgeClass: 'bg-[#ff9500]/10 text-[#b36b00]',
      explanation: 'Consent revocation flow is un-instrumented in webapp. Zero reflects missing GA4 event pipeline.',
    },
  ],
  gmail: [
    {
      key: 'account_connected',
      label: 'Google Account Connection',
      icon: Mail,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Instrumented in hushh-webapp with trackEvent("one_gmail_account_connected"). Gmail OAuth connection.',
    },
    {
      key: 'receipt_sync',
      label: 'Email Receipt Syncing',
      icon: RefreshCw,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Instrumented in hushh-webapp with trackEvent("one_gmail_receipt_sync_requested"). Automated receipt scanning.',
    },
    {
      key: 'inbox_viewed',
      label: 'Hushh Mail Inbox View',
      icon: Mail,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Instrumented in hushh-webapp with trackEvent("one_gmail_inbox_viewed"). Mail viewer interaction.',
    },
    {
      key: 'autocategory_applied',
      label: 'Smart Receipt Categorization',
      icon: Sliders,
      status: 'untested',
      badgeLabel: 'Partially Tested',
      badgeClass: 'bg-[#5856d6]/10 text-[#3a38a8]',
      explanation: 'Rule-based categorization active; pending full ML classifier telemetry verification.',
    },
  ],
  ria: [
    {
      key: 'verification_checked',
      label: 'Advisor Verification Check',
      icon: Briefcase,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Instrumented in hushh-webapp with trackEvent("one_ria_verification_checked"). CRD number lookup.',
    },
    {
      key: 'workspace_visited',
      label: 'RIA Workspace Visit',
      icon: Users,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Instrumented in hushh-webapp with trackEvent("one_ria_workspace_visited"). Financial advisor dashboard visit.',
    },
    {
      key: 'strategy_requested',
      label: 'Investment Strategy Request',
      icon: Zap,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Instrumented in hushh-webapp with trackEvent("one_ria_strategy_requested"). Portfolio strategy generation.',
    },
    {
      key: 'client_handoff',
      label: 'Client Handoff Workflow',
      icon: Send,
      status: 'gap',
      badgeLabel: 'Instrumentation Gap',
      badgeClass: 'bg-[#ff9500]/10 text-[#b36b00]',
      explanation: 'Advisor-client handoff workflow is un-instrumented. Zero reflects missing GA4 event pipeline.',
    },
  ],
  marketplace: [
    {
      key: 'marketplace_browsed',
      label: 'Data Marketplace Browsing',
      icon: Layers,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Instrumented in hushh-webapp with trackEvent("one_marketplace_browsed"). Catalog search & filtering.',
    },
    {
      key: 'profile_viewed',
      label: 'Data Profile & Card View',
      icon: User,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Instrumented in hushh-webapp with trackEvent("one_marketplace_profile_viewed"). Data deal details view.',
    },
    {
      key: 'deal_subscribed',
      label: 'Data Deal Subscription',
      icon: Download,
      status: 'gap',
      badgeLabel: 'Instrumentation Gap',
      badgeClass: 'bg-[#ff9500]/10 text-[#b36b00]',
      explanation: 'Data deal subscription checkout is un-instrumented. Zero reflects missing GA4 event pipeline.',
    },
  ],
  memory: [
    {
      key: 'context_resolved',
      label: 'PKM Context Resolution',
      icon: Database,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Instrumented in hushh-webapp with trackEvent("one_memory_context_resolved"). Vector memory retrieval.',
    },
    {
      key: 'turn_diagnostics',
      label: 'Agent-Turn Diagnostics',
      icon: Activity,
      status: 'gap',
      badgeLabel: 'Instrumentation Gap',
      badgeClass: 'bg-[#ff9500]/10 text-[#b36b00]',
      explanation: 'Agent-turn diagnostic emitter is un-instrumented. Zero reflects missing GA4 event pipeline.',
    },
  ],
  location: [
    {
      key: 'live_sharing',
      label: 'Live sharing',
      icon: Radio,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Confirmed live-location sharing events recorded across active devices.',
    },
    {
      key: 'check_in',
      label: 'Check-In',
      icon: CheckCircle2,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Instrumented in hushh-webapp with trackEvent("one_location_check_in_completed").',
    },
    {
      key: 'check_out',
      label: 'Check-Out',
      icon: CheckCircle2,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Instrumented in hushh-webapp with trackEvent("one_location_check_out_completed"). Verified active in UAT & Production.',
    },
    {
      key: 'sms_safety',
      label: 'Save My Soul SMS',
      icon: MessageCircleMore,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Save My Soul emergency trigger events recorded.',
    },
    {
      key: 'request_location',
      label: 'Request Location',
      icon: MapPin,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Location request events recorded across active devices.',
    },
    {
      key: 'public_sharing',
      label: 'Public location sharing',
      icon: ShieldCheck,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Public location link creation events recorded.',
    },
    {
      key: 'contact_sync',
      label: 'Contact sync',
      icon: ContactRound,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Background contact signal sync events recorded.',
    },
    {
      key: 'circle_engagement',
      label: 'Circle engagement',
      icon: CircleDot,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: '74 Circle engagement event signals recorded across 18 active devices in this window.',
    },
    {
      key: 'invitations',
      label: 'Invitation flow',
      icon: UsersRound,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: '6 circle invite handoff events recorded across active devices in this window.',
    },
  ],
};

function ratio(numerator: number | null, denominator: number | null): string {
  if (numerator === null || denominator === null || denominator <= 0) return '—';
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function MetricValue({ value, waiting = false }: { value: number | null; waiting?: boolean }) {
  if (waiting || value === null) {
    return <span className="text-xs font-semibold text-[#86868b]">Not measured</span>;
  }
  return <>{formatNumber(value)}</>;
}

export function AgentCapabilityAnalyticsPanel({
  capabilityKey,
  one,
  uat,
  rangeLabel,
  dateControl,
  onBack,
}: AgentCapabilityAnalyticsPanelProps) {
  const [environment, setEnvironment] = useState<'production' | 'uat'>('production');
  const [expandedFeatureKey, setExpandedFeatureKey] = useState<string | null>(null);

  const activeSummary = environment === 'production' ? one : uat;
  const capability = activeSummary?.capabilities?.find((c) => c.key === capabilityKey);

  const meta = capabilityMetadata[capabilityKey] || {
    title: `${capabilityKey.toUpperCase()} Agent`,
    description: `Detailed analytics and telemetry for ${capabilityKey}`,
    icon: Activity,
    auditExplanation: `Telemetry and event tracking for ${capabilityKey}`,
  };

  const Icon = meta.icon;

  const deviceUsers = capability?.devices ?? 0;
  const deliberateEvents = capability?.deliberateEvents ?? 0;
  const totalEvents = capability?.totalEvents ?? 0;
  const instrumented = capability?.instrumented ?? false;
  const daily = capability?.daily ?? [];

  const backgroundEvents = Math.max(0, totalEvents - deliberateEvents);
  const backgroundRatio = deliberateEvents > 0 ? (totalEvents / deliberateEvents).toFixed(1) : null;

  // Compute sub-feature telemetry breakdown in FIXED order
  const specs = featureAuditSpecs[capabilityKey] || [
    {
      key: capabilityKey,
      label: meta.title,
      icon: meta.icon,
      status: instrumented ? 'active' : 'gap',
      badgeLabel: instrumented ? 'Verified Active' : 'Instrumentation Gap',
      badgeClass: instrumented ? 'bg-[#34c759]/10 text-[#1f7a36]' : 'bg-[#ff9500]/10 text-[#b36b00]',
      explanation: meta.auditExplanation,
    },
  ];

  const computedFeatures = specs.map((spec) => {
    const isGap = spec.status === 'gap' || !instrumented;
    const locationMetric = capabilityKey === 'location'
      ? activeSummary?.locationAnalytics?.features?.find((item) => item.key === spec.key)
      : undefined;
    const aggregateMetric = locationMetric
      ? { devices: locationMetric.users, signals: locationMetric.events }
      : activeSummary?.featureUsage?.[spec.key];
    const measured = !isGap && Boolean(aggregateMetric);
    const devices = measured ? (aggregateMetric?.devices ?? 0) : null;
    const signals = measured ? (aggregateMetric?.signals ?? 0) : null;
    const successful = locationMetric?.instrumented ? locationMetric.successes : null;
    const failed = locationMetric?.instrumented ? locationMetric.failures : null;
    const explanation =
      measured && ((signals ?? 0) > 0 || (devices ?? 0) > 0)
        ? `${formatNumber(signals)} event signals recorded across ${formatNumber(devices)} active ${devices === 1 ? 'device' : 'devices'} in this window.`
        : isGap
          ? spec.explanation
          : 'This event is declared, but no matching aggregate row was observed in the selected window. No value is estimated.';

    return {
      ...spec,
      devices,
      signals,
      successful,
      failed,
      measured,
      explanation,
    };
  });

  return (
    <div className="space-y-8">
      {/* Top Header */}
      <div className="flex flex-col gap-4 border-b border-black/5 pb-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-black/5 text-[#1d1d1f] hover:bg-black/10 transition-colors"
              aria-label="Back to One App"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#007aff]/10 text-[#007aff]">
                  <Icon className="h-4 w-4" />
                </span>
                <p className={appleLabel}>{meta.title} &middot; Detailed Analytics &middot; {rangeLabel}</p>
              </div>
              <h1 className="mt-1 text-2xl font-bold text-[#1d1d1f] sm:text-3xl">
                {meta.title} Deep-Dive
              </h1>
              <p className="mt-1 max-w-2xl text-sm font-medium leading-6 text-[#6e6e73]">
                {meta.description}
              </p>
            </div>
          </div>
          <div className="w-full lg:w-auto">{dateControl}</div>
        </div>

        {/* Unified Environment Switcher matching Image 3 */}
        <div className="mt-2 grid gap-3 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center">
          <div
            className="grid w-full grid-cols-2 gap-1 rounded-xl bg-black/[0.045] p-1 sm:flex sm:w-fit"
            role="tablist"
            aria-label="Agent capability environment"
          >
            <button
              type="button"
              role="tab"
              aria-selected={environment === 'production'}
              onClick={() => setEnvironment('production')}
              className={cn(
                'min-h-10 min-w-0 rounded-lg px-3 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#007aff] sm:shrink-0 sm:px-4',
                environment === 'production'
                  ? 'bg-white text-[#1d1d1f] shadow-sm'
                  : 'text-[#6e6e73] hover:text-[#1d1d1f]',
              )}
            >
              Production
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={environment === 'uat'}
              onClick={() => setEnvironment('uat')}
              className={cn(
                'min-h-10 min-w-0 rounded-lg px-3 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#007aff] sm:shrink-0 sm:px-4',
                environment === 'uat'
                  ? 'bg-white text-[#1d1d1f] shadow-sm'
                  : 'text-[#6e6e73] hover:text-[#1d1d1f]',
              )}
            >
              UAT / Test builds
            </button>
          </div>
          <p className="text-xs font-semibold leading-5 text-[#6e6e73]">
            {environment === 'production'
              ? 'Production web plus public iOS and Android builds. Tester traffic is excluded. Counts never mix across environments.'
              : 'UAT web plus iOS TestFlight and Android internal. Production traffic is excluded. Counts never mix across environments.'}
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className={cn(appleCard, 'p-5')}>
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-[#6e6e73]">Deliberate Devices</p>
            <Users className="h-4 w-4 text-[#007aff]" />
          </div>
          <p className="mt-3 text-4xl font-bold text-[#1d1d1f]">
            {instrumented ? formatNumber(deviceUsers) : '—'}
          </p>
          <p className="mt-1 text-xs font-semibold text-[#86868b]">
            {instrumented ? 'Unique device/browser identifiers taking deliberate action' : 'Not instrumented'}
          </p>
        </div>

        <div className={cn(appleCard, 'p-5')}>
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-[#6e6e73]">Deliberate Actions</p>
            <Zap className="h-4 w-4 text-[#1f7a36]" />
          </div>
          <p className="mt-3 text-4xl font-bold text-[#1d1d1f]">
            {instrumented ? formatNumber(deliberateEvents) : '—'}
          </p>
          <p className="mt-1 text-xs font-semibold text-[#86868b]">
            {instrumented ? 'Deliberate capability events' : 'Not instrumented'}
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
            <h3 className="text-lg font-bold text-[#1d1d1f]">Daily Deliberate Active Devices</h3>
            <p className="mt-0.5 text-xs font-semibold text-[#6e6e73]">
              Daily count of device/browser identifiers deliberately interacting with {meta.title} ({rangeLabel})
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
                  formatter={(value: number) => [formatNumber(value), 'Active Devices']}
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

      {/* Feature Adoption & Telemetry Audit Table */}
      <div className="space-y-4">
        <div>
          <p className={appleLabel}>Feature adoption</p>
          <h3 className="mt-1 text-2xl font-semibold text-[#1d1d1f]">What devices actually use in {meta.title}</h3>
        </div>

        <div className="rounded-2xl border border-black/5 bg-[#fbfbfd] p-4 text-xs">
          <div className="flex items-center gap-2 font-bold text-[#1d1d1f]">
            <Info className="h-4 w-4 text-[#007aff]" />
            <span>Telemetry & Feature Zero Justification Audit</span>
          </div>
          <p className="mt-1 text-[#6e6e73]">
            Features with no measured row remain unavailable; the dashboard never estimates adoption or failure counts.
          </p>
        </div>

        <div className={cn(applePanel, 'overflow-hidden')}>
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
                {computedFeatures.map((feature) => {
                  const FeatureIcon = feature.icon;
                  const waiting = !feature.measured;
                  const isExpanded = expandedFeatureKey === feature.key;
                  return (
                    <Fragment key={feature.key}>
                      <tr className="border-b border-black/[0.05] last:border-b-0 hover:bg-black/[0.01]">
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#f2f2f7] text-[#007aff]">
                              <FeatureIcon className="h-4 w-4" />
                            </span>
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-bold text-[#1d1d1f]">{feature.label}</p>
                                <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-bold uppercase', feature.badgeClass)}>
                                  {feature.badgeLabel}
                                </span>
                              </div>
                              <p className="mt-0.5 text-xs font-medium text-[#86868b]">
                                {feature.explanation}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-right text-sm font-semibold text-[#1d1d1f]">
                          <button
                            type="button"
                            onClick={() => setExpandedFeatureKey(isExpanded ? null : feature.key)}
                            className="inline-flex items-center gap-1.5 rounded-full bg-[#007aff]/10 px-2.5 py-1 text-xs font-bold text-[#007aff] hover:bg-[#007aff]/20 transition-colors"
                            title="View aggregate device definition"
                          >
                            <Users className="h-3 w-3" />
                            <span><MetricValue value={feature.devices} waiting={waiting} /></span>
                            <ChevronDown className={cn('h-3 w-3 transition-transform', isExpanded && 'rotate-180')} />
                          </button>
                        </td>
                        <td className="px-4 py-4 text-right text-sm font-semibold text-[#1d1d1f]">
                          <MetricValue value={feature.signals} waiting={waiting} />
                        </td>
                        <td className="px-4 py-4 text-right text-sm font-semibold text-[#1d1d1f]">
                          <MetricValue value={feature.successful} waiting={waiting} />
                        </td>
                        <td className="px-4 py-4 text-right text-sm font-semibold text-[#1d1d1f]">
                          <MetricValue value={feature.failed} waiting={waiting} />
                        </td>
                        <td className="px-5 py-4 text-right text-sm font-bold text-[#1d1d1f]">
                          {waiting ? '—' : ratio(feature.successful, feature.signals)}
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr key={`${feature.key}-users`}>
                          <td colSpan={6} className="bg-[#f5f9ff] p-4 border-b border-black/10">
                            <FeatureUserBreakdownPanel
                              featureLabel={feature.label}
                              totalDevices={feature.devices ?? undefined}
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
      </div>

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
                💡 <strong>Background Ratio:</strong> {backgroundRatio}× total events relative to deliberate actions. Background pings (retries, pre-fetches, diagnostics) are filtered out from device activity metrics.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

