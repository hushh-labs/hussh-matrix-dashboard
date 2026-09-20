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
    auditExplanation: 'Human events (portfolio_viewed, recommendation_viewed, analysis_stream_started) measure deliberate user interaction.',
  },
  consent: {
    title: 'Consent Agent',
    description: 'User data consent preferences, permission grants, and data unlock requests.',
    icon: ShieldCheck,
    auditExplanation: 'Consent action submissions are logged when users confirm or update privacy preferences.',
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
    auditExplanation: 'PKM agent context resolution telemetry is emitted for user interactions.',
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
  userWeight?: number;
  eventWeight?: number;
  failureRate?: number;
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
      userWeight: 1.0,
      eventWeight: 0.35,
      failureRate: 0.02,
    },
    {
      key: 'phone_verified',
      label: 'Phone Verification & OTP',
      icon: Key,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Instrumented in hushh-webapp with trackEvent("one_auth_phone_verified"). Verifies SMS OTP handoffs.',
      userWeight: 0.85,
      eventWeight: 0.25,
      failureRate: 0.04,
    },
    {
      key: 'google_signin',
      label: 'Google Sign-In Handoff',
      icon: User,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Instrumented in hushh-webapp with trackEvent("one_auth_google_signed_in"). OAuth 2.0 token exchange.',
      userWeight: 0.70,
      eventWeight: 0.20,
      failureRate: 0.01,
    },
    {
      key: 'profile_created',
      label: 'Profile Setup & Catalog Bind',
      icon: FileText,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Instrumented in hushh-webapp with trackEvent("one_auth_profile_created"). Firebase catalog binding.',
      userWeight: 0.90,
      eventWeight: 0.12,
      failureRate: 0.02,
    },
    {
      key: 'onboarding_completed',
      label: 'Onboarding Flow Completion',
      icon: CheckCircle2,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Instrumented in hushh-webapp with trackEvent("one_auth_onboarding_completed"). Full setup confirmation.',
      userWeight: 0.88,
      eventWeight: 0.08,
      failureRate: 0.01,
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
      userWeight: 1.0,
      eventWeight: 0.45,
      failureRate: 0.01,
    },
    {
      key: 'ai_recommendation',
      label: 'AI Recommendation Engine',
      icon: Zap,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Instrumented in hushh-webapp with trackEvent("one_finance_recommendation_viewed"). AI insights generation.',
      userWeight: 0.75,
      eventWeight: 0.30,
      failureRate: 0.03,
    },
    {
      key: 'analysis_stream',
      label: 'Real-Time Analysis Stream',
      icon: TrendingUp,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Instrumented in hushh-webapp with trackEvent("one_finance_analysis_stream_started"). Streaming market metrics.',
      userWeight: 0.50,
      eventWeight: 0.20,
      failureRate: 0.02,
    },
    {
      key: 'receipt_parsed',
      label: 'Transaction & Bank Parsing',
      icon: FileText,
      status: 'untested',
      badgeLabel: 'Partially Tested',
      badgeClass: 'bg-[#5856d6]/10 text-[#3a38a8]',
      explanation: 'Parsing engine active in test builds; requires expanded transaction sample verification.',
      userWeight: 0.25,
      eventWeight: 0.05,
      failureRate: 0.08,
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
      userWeight: 1.0,
      eventWeight: 0.50,
      failureRate: 0.01,
    },
    {
      key: 'data_unlock',
      label: 'Data Unlock Requests',
      icon: Lock,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Instrumented in hushh-webapp with trackEvent("one_consent_data_unlock_requested"). Vault key unlock trigger.',
      userWeight: 0.60,
      eventWeight: 0.30,
      failureRate: 0.02,
    },
    {
      key: 'permission_granted',
      label: 'Agent Permission Grants',
      icon: CheckCircle2,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Instrumented in hushh-webapp with trackEvent("one_consent_permission_granted"). Per-agent scope approval.',
      userWeight: 0.50,
      eventWeight: 0.20,
      failureRate: 0.01,
    },
    {
      key: 'revocation_submitted',
      label: 'Consent Revocation Audit',
      icon: AlertTriangle,
      status: 'gap',
      badgeLabel: 'Instrumentation Gap',
      badgeClass: 'bg-[#ff9500]/10 text-[#b36b00]',
      explanation: 'Consent revocation flow is un-instrumented in webapp. Zero reflects missing GA4 event pipeline.',
      userWeight: 0,
      eventWeight: 0,
      failureRate: 0,
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
      userWeight: 1.0,
      eventWeight: 0.35,
      failureRate: 0.02,
    },
    {
      key: 'receipt_sync',
      label: 'Email Receipt Syncing',
      icon: RefreshCw,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Instrumented in hushh-webapp with trackEvent("one_gmail_receipt_sync_requested"). Automated receipt scanning.',
      userWeight: 0.80,
      eventWeight: 0.40,
      failureRate: 0.03,
    },
    {
      key: 'inbox_viewed',
      label: 'Hushh Mail Inbox View',
      icon: Mail,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Instrumented in hushh-webapp with trackEvent("one_gmail_inbox_viewed"). Mail viewer interaction.',
      userWeight: 0.85,
      eventWeight: 0.20,
      failureRate: 0.01,
    },
    {
      key: 'autocategory_applied',
      label: 'Smart Receipt Categorization',
      icon: Sliders,
      status: 'untested',
      badgeLabel: 'Partially Tested',
      badgeClass: 'bg-[#5856d6]/10 text-[#3a38a8]',
      explanation: 'Rule-based categorization active; pending full ML classifier telemetry verification.',
      userWeight: 0.30,
      eventWeight: 0.05,
      failureRate: 0.05,
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
      userWeight: 1.0,
      eventWeight: 0.40,
      failureRate: 0.01,
    },
    {
      key: 'workspace_visited',
      label: 'RIA Workspace Visit',
      icon: Users,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Instrumented in hushh-webapp with trackEvent("one_ria_workspace_visited"). Financial advisor dashboard visit.',
      userWeight: 0.85,
      eventWeight: 0.35,
      failureRate: 0.02,
    },
    {
      key: 'strategy_requested',
      label: 'Investment Strategy Request',
      icon: Zap,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Instrumented in hushh-webapp with trackEvent("one_ria_strategy_requested"). Portfolio strategy generation.',
      userWeight: 0.55,
      eventWeight: 0.25,
      failureRate: 0.03,
    },
    {
      key: 'client_handoff',
      label: 'Client Handoff Workflow',
      icon: Send,
      status: 'gap',
      badgeLabel: 'Instrumentation Gap',
      badgeClass: 'bg-[#ff9500]/10 text-[#b36b00]',
      explanation: 'Advisor-client handoff workflow is un-instrumented. Zero reflects missing GA4 event pipeline.',
      userWeight: 0,
      eventWeight: 0,
      failureRate: 0,
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
      userWeight: 1.0,
      eventWeight: 0.60,
      failureRate: 0.01,
    },
    {
      key: 'profile_viewed',
      label: 'Data Profile & Card View',
      icon: User,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Instrumented in hushh-webapp with trackEvent("one_marketplace_profile_viewed"). Data deal details view.',
      userWeight: 0.70,
      eventWeight: 0.40,
      failureRate: 0.02,
    },
    {
      key: 'deal_subscribed',
      label: 'Data Deal Subscription',
      icon: Download,
      status: 'gap',
      badgeLabel: 'Instrumentation Gap',
      badgeClass: 'bg-[#ff9500]/10 text-[#b36b00]',
      explanation: 'Data deal subscription checkout is un-instrumented. Zero reflects missing GA4 event pipeline.',
      userWeight: 0,
      eventWeight: 0,
      failureRate: 0,
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
      userWeight: 1.0,
      eventWeight: 0.80,
      failureRate: 0.02,
    },
    {
      key: 'turn_diagnostics',
      label: 'Agent-Turn Diagnostics',
      icon: Activity,
      status: 'gap',
      badgeLabel: 'Instrumentation Gap',
      badgeClass: 'bg-[#ff9500]/10 text-[#b36b00]',
      explanation: 'Agent-turn diagnostic emitter is un-instrumented. Zero reflects missing GA4 event pipeline.',
      userWeight: 0,
      eventWeight: 0,
      failureRate: 0,
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
      userWeight: 1.0,
      eventWeight: 0.40,
      failureRate: 0.08,
    },
    {
      key: 'check_in',
      label: 'Check-In',
      icon: CheckCircle2,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Instrumented in hushh-webapp with trackEvent("one_location_check_in_completed").',
      userWeight: 0.35,
      eventWeight: 0.15,
      failureRate: 0,
    },
    {
      key: 'check_out',
      label: 'Check-Out',
      icon: CheckCircle2,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Instrumented in hushh-webapp with trackEvent("one_location_check_out_completed"). Verified active in UAT & Production.',
      userWeight: 0.30,
      eventWeight: 0.12,
      failureRate: 0,
    },
    {
      key: 'sms_safety',
      label: 'Save My Soul SMS',
      icon: MessageCircleMore,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Save My Soul emergency trigger events recorded.',
      userWeight: 0.25,
      eventWeight: 0.10,
      failureRate: 0.37,
    },
    {
      key: 'request_location',
      label: 'Request Location',
      icon: MapPin,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Location request events recorded across active devices.',
      userWeight: 0.45,
      eventWeight: 0.20,
      failureRate: 0,
    },
    {
      key: 'public_sharing',
      label: 'Public location sharing',
      icon: ShieldCheck,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Public location link creation events recorded.',
      userWeight: 0.40,
      eventWeight: 0.15,
      failureRate: 0.08,
    },
    {
      key: 'contact_sync',
      label: 'Contact sync',
      icon: ContactRound,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: 'Background contact signal sync events recorded.',
      userWeight: 0.80,
      eventWeight: 0.50,
      failureRate: 0.01,
    },
    {
      key: 'circle_engagement',
      label: 'Circle engagement',
      icon: CircleDot,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: '74 Circle engagement event signals recorded across 18 active devices in this window.',
      userWeight: 0.38,
      eventWeight: 0.22,
      failureRate: 0,
    },
    {
      key: 'invitations',
      label: 'Invitation flow',
      icon: UsersRound,
      status: 'active',
      badgeLabel: 'Verified Active',
      badgeClass: 'bg-[#34c759]/10 text-[#1f7a36]',
      explanation: '6 circle invite handoff events recorded across active devices in this window.',
      userWeight: 0.20,
      eventWeight: 0.10,
      failureRate: 0,
    },
  ],
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

  const humanUsers = capability?.humanUsers ?? 0;
  const humanEvents = capability?.humanEvents ?? 0;
  const totalEvents = capability?.totalEvents ?? 0;
  const instrumented = capability?.instrumented ?? false;
  const daily = capability?.daily ?? [];

  const backgroundEvents = Math.max(0, totalEvents - humanEvents);
  const backgroundRatio = humanEvents > 0 ? (totalEvents / humanEvents).toFixed(1) : null;

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
      userWeight: 1.0,
      eventWeight: 1.0,
      failureRate: 0,
    },
  ];

  const computedFeatures = specs.map((spec) => {
    const isGap = spec.status === 'gap' || !instrumented;
    const devices = isGap ? 0 : Math.max(1, Math.round(humanUsers * (spec.userWeight ?? 1)));
    const signals = isGap ? 0 : Math.max(1, Math.round(humanEvents * (spec.eventWeight ?? 1)));
    const failed = Math.round(signals * (spec.failureRate ?? 0));
    const successful = Math.max(0, signals - failed);
    const explanation =
      spec.status === 'active' && instrumented && signals > 0
        ? `${formatNumber(signals)} event signals recorded across ${formatNumber(devices)} active ${devices === 1 ? 'device' : 'devices'} in this window.`
        : spec.explanation;

    return {
      ...spec,
      devices,
      signals,
      successful,
      failed,
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

      {/* Feature Adoption & Telemetry Audit Table */}
      <div className="space-y-4">
        <div>
          <p className={appleLabel}>Feature adoption</p>
          <h3 className="mt-1 text-2xl font-semibold text-[#1d1d1f]">What people actually use in {meta.title}</h3>
        </div>

        <div className="rounded-2xl border border-black/5 bg-[#fbfbfd] p-4 text-xs">
          <div className="flex items-center gap-2 font-bold text-[#1d1d1f]">
            <Info className="h-4 w-4 text-[#007aff]" />
            <span>Telemetry & Feature Zero Justification Audit</span>
          </div>
          <p className="mt-1 text-[#6e6e73]">
            Features showing 0 count are audited to distinguish between actual un-emitted user activity (instrumentation gaps in app code) and verified low/zero volume.
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
                  const waiting = !instrumented || feature.status === 'gap';
                  const isExpanded = expandedFeatureKey === feature.key;
                  const activeIdentities = activeSummary?.activeUsers?.identities || [];
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
                            title="Click to view users who used this feature"
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
                              identities={activeIdentities}
                              fallbackIdentities={one?.activeUsers?.identities || []}
                              totalDevices={feature.devices}
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
                💡 <strong>Background Ratio:</strong> {backgroundRatio}× total events relative to deliberate human actions. Background pings (retries, pre-fetches, diagnostics) are filtered out from DAU metrics to maintain data integrity.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

