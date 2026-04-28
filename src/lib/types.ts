/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TypeScript types for the Hussh Matrix Dashboard.
 * Maps to the BigQuery `kai_public_dashboard_feed` schema and
 * the hushhtech.com analytics endpoint contract.
 */

// ---------------------------------------------------------------------------
// BigQuery public feed row (long-form normalized)
// ---------------------------------------------------------------------------

export interface FeedRow {
  as_of_timestamp: string;
  source_environment: 'production' | 'uat';
  source_project_id: string;
  source_dataset: string;
  production_ready: boolean;
  known_blockers: string | null;
  metric_group: MetricGroup;
  metric_name: string;
  metric_date: string | null;
  dimension_name: string | null;
  dimension_value: string | null;
  metric_value: number | null;
  metric_count: number | null;
  metric_string_value: string | null;
  metric_timestamp: string | null;
}

export type MetricGroup =
  | 'status'
  | 'summary'
  | 'usage'
  | 'platform_mix'
  | 'investor_funnel'
  | 'ria_funnel'
  | 'activation'
  | 'feature_engagement'
  | 'instrumentation_health'
  | 'seo_search';

// ---------------------------------------------------------------------------
// Parsed dashboard data model (what the UI consumes)
// ---------------------------------------------------------------------------

export interface PlatformStatus {
  name: string;
  url: string;
  color: string;
  available: boolean;
  environment: 'production' | 'uat';
  productionReady: boolean;
  knownBlockers: string | null;
  visitors: string;
  change: string;
  avgSession: string;
  bounceRate: string;
}

export interface KpiStat {
  label: string;
  value: string;
  icon: string;
  change?: string;
  suffix?: string;
}

export interface TrafficPoint {
  time: string;
  kai: number;
  tech: number;
  ai: number;
}

export interface AcquisitionChannel {
  name: string;
  value: number;
  color: string;
}

export interface CountryData {
  name: string;
  visitors: string;
  percentage: number;
}

export interface DailyActiveUser {
  day: string;
  users: number;
}

export interface UsageSummary {
  dau: number;
  wau: number;
  mau: number;
  dauMauStickiness: number;
  sessions: number;
  totalEvents: number;
  latestEventAt: string | null;
  freshnessLagMinutes: number | null;
  sourceEventRows: number;
}

export interface FunnelStep {
  step: string;
  users: number;
}

export interface BreakdownMetric {
  label: string;
  value: number;
  detail?: string;
  percentage?: number;
  color?: string;
}

export interface FeedStatus {
  sourceEnvironment: string;
  sourceProjectId: string;
  sourceDataset: string;
  productionReady: boolean;
  knownBlockers: string | null;
  latestEventAt: string | null;
  freshnessLagMinutes: number | null;
  sourceEventRows: number;
}

// ---------------------------------------------------------------------------
// hushhtech.com analytics endpoint response
// ---------------------------------------------------------------------------

export interface HushhTechAnalytics {
  trafficAvailable: boolean;
  stateAvailable: boolean;
  searchConsoleAvailable: boolean;
  visitors?: number;
  sessions?: number;
  bounceRate?: number;
  avgSessionDuration?: number;
  topPages?: Array<{ path: string; views: number }>;
  searchMetrics?: {
    clicks: number;
    impressions: number;
    ctr: number;
    avgPosition: number;
  };
}

// ---------------------------------------------------------------------------
// Aggregated dashboard state
// ---------------------------------------------------------------------------

export interface DashboardData {
  loading: boolean;
  error: string | null;
  lastUpdated: string | null;

  // Per-platform feed status
  kaiFeed: FeedStatus | null;
  kaiUsage: UsageSummary | null;
  kaiInvestorFunnel: FunnelStep[];
  kaiRiaFunnel: FunnelStep[];
  kaiDailyUsage: DailyActiveUser[];
  platformMix: BreakdownMetric[];
  featureEngagement: BreakdownMetric[];
  instrumentationHealth: BreakdownMetric[];

  // hushhtech.com
  hushhTech: HushhTechAnalytics | null;

  // Aggregate KPIs (computed from all sources)
  platforms: PlatformStatus[];
  kpiStats: KpiStat[];
  trafficData: TrafficPoint[];
  acquisitionChannels: AcquisitionChannel[];
  topCountries: CountryData[];
}
