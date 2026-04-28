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
  metric_date: string | { value: string } | null;
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
  displayValue?: string;
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
// hushhtech.com public metrics endpoint response
// ---------------------------------------------------------------------------

export interface HushhTechWindow {
  days: number;
  startDate: string;
  endDate: string;
  dates?: string[];
}

export interface HushhTechBusinessFunnel {
  source: string;
  overview: {
    signups: number;
    persistedUsers: number;
    onboardingStarted: number;
    onboardingCompleted: number;
    profilesCreated: number;
    profilesConfirmed: number;
  };
  conversionRates: {
    signupToPersistedUsers: number | null;
    signupToOnboardingStarted: number | null;
    onboardingCompletionRate: number | null;
    profileConfirmationRate: number | null;
  };
  onboardingStepBreakdown: Array<{ step: string; users: number }>;
  series: Array<{
    date: string;
    signups: number;
    persistedUsers: number;
    onboardingStarted: number;
    onboardingCompleted: number;
    profilesCreated: number;
    profilesConfirmed: number;
  }>;
}

export interface HushhTechAudience {
  source: string;
  dau: number;
  wau: number;
  mau: number;
  sessions: number;
  pageViews: number;
  events: number;
  note?: string;
}

export interface HushhTechSearch {
  totalSearches: number;
  resultClickRate: number | null;
  noResultRate: number | null;
  bySurface: Array<{ surface: string; searches: number | null }>;
}

export interface SearchPerformanceMetric {
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  averagePosition: number | null;
}

export interface SearchPerformance extends SearchPerformanceMetric {
  clicks: number;
  impressions: number;
}

export interface HushhTechRegionalTraffic {
  source: string;
  available: boolean;
  byRegion: Array<{
    state: string;
    activeUsers: number | null;
    sessions: number | null;
  }>;
  note?: string;
}

export interface HushhTechSearchPerformance {
  source: string;
  available: boolean;
  realtime: boolean;
  dataState: string;
  searchType: string;
  overview: SearchPerformance;
  queries: Array<SearchPerformanceMetric & { query: string }>;
  pages: Array<SearchPerformanceMetric & { pageUrl: string }>;
  countries: Array<SearchPerformanceMetric & { country: string }>;
  devices: Array<SearchPerformanceMetric & { device: string }>;
  searchAppearance: Array<SearchPerformanceMetric & { appearance: string }>;
  state: HushhTechRegionalTraffic;
  metadata?: Record<string, unknown>;
  note?: string;
}

export interface HushhTechActivity {
  topPages: Array<{ path: string; views: number | null }>;
  byRouteGroup: Array<{ routeGroup: string; events: number | null }>;
  byEvent: Array<{ eventName: string; events: number | null }>;
}

export interface HushhTechFunnelStep {
  step: string;
  eventName: string;
  count: number | null;
  conversionFromPrevious: number | null;
  dropoffFromPrevious: number | null;
}

export interface HushhTechFunnels {
  signup: HushhTechFunnelStep[];
  onboarding: HushhTechFunnelStep[];
  kyc: HushhTechFunnelStep[];
  profile: HushhTechFunnelStep[];
  chat: HushhTechFunnelStep[];
}

export interface HushhTechGcp {
  source: string;
  available: boolean;
  services: Array<{
    name: string;
    region?: string;
    available: boolean;
    requestCount?: number;
    errorRate?: number | null;
    p95LatencyMs?: number | null;
    instanceCount?: number | null;
  }>;
  requestCount: number;
  errorRate: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  instanceCount: number | null;
  uptimeAvailability: number | null;
  note?: string;
}

export interface HushhTechTraffic {
  source: string;
  available: boolean;
  overview: {
    active1DayUsers: number;
    active7DayUsers: number;
    active28DayUsers: number;
    sessions: number;
    engagedSessions: number;
    screenPageViews: number;
    newUsers: number;
    engagementRate: number | null;
    averageSessionDuration: number | null;
    realtimeActiveUsers: number | null;
  };
  series: Array<{
    date: string;
    activeUsers: number;
    sessions: number;
    screenPageViews: number;
    engagedSessions: number;
    newUsers: number;
  }>;
  note?: string;
  lookerStudioReportUrl?: string;
}

export interface HushhTechMetricsSummary {
  generatedAt: string;
  timezone: string;
  window: HushhTechWindow;
  businessFunnel: HushhTechBusinessFunnel;
  supabase?: HushhTechSupabaseSummary | null;
  audience?: HushhTechAudience;
  search?: HushhTechSearch;
  searchPerformance?: HushhTechSearchPerformance;
  activity?: HushhTechActivity;
  funnels?: HushhTechFunnels;
  dropoff?: Record<string, Array<{
    step: string;
    eventName: string;
    dropoffRate: number | null;
    conversionRate: number | null;
  }>>;
  traffic: HushhTechTraffic;
  gcp?: HushhTechGcp;
  systemHealth?: Record<string, unknown>;
  legacy?: {
    source: string;
    available: boolean;
    overview: { usersCreated: number };
    series: Array<{ date: string; usersCreated: number }>;
    note?: string;
  };
  dataCoverage?: Record<string, unknown>;
  dataQualityWarnings?: string[];
  stale?: boolean;
}

export interface KaiGa4DailyMetric {
  eventDate: string;
  events: number;
  users: number;
  sessions: number;
}

export interface KaiGa4EventMetric {
  eventName: string;
  events: number;
  users: number;
}

export interface KaiGa4GeoMetric {
  platform: string;
  deviceCategory: string;
  country: string;
  events: number;
  users: number;
}

export interface KaiGa4Summary {
  sourceProjectId: string;
  sourceDataset: string;
  generatedAt?: string;
  realtimeMode?: string;
  expectedLagSeconds?: number | null;
  available?: boolean;
  windowDays: number;
  range?: {
    startDate: string;
    endDate: string;
    days: number;
  };
  rangeTotals?: {
    users: number;
    sessions: number;
    events: number;
  };
  daily: KaiGa4DailyMetric[];
  topEvents: KaiGa4EventMetric[];
  geo: KaiGa4GeoMetric[];
}

export interface CloudRunMetricPoint {
  label: string;
  value: number;
}

export interface CloudRunDailyMetric {
  date: string;
  label: string;
  requests: number;
  errors: number;
  errorRate: number | null;
  p95LatencyMs: number | null;
  instanceCount: number | null;
}

export interface CloudRunSummary {
  sourceProjectId: string;
  serviceName: string;
  generatedAt?: string;
  realtimeMode?: string;
  expectedLagSeconds?: number | null;
  windowDays: number;
  startDate?: string;
  endDate?: string;
  requestCount: number;
  errorCount: number;
  errorRate: number | null;
  p95LatencyMs: number | null;
  instanceCount: number | null;
  series: CloudRunMetricPoint[];
  daily?: CloudRunDailyMetric[];
}

export interface SearchConsoleSummary {
  sourceProjectId: string;
  sourceDataset: string;
  generatedAt?: string;
  realtimeMode?: string;
  expectedLagSeconds?: number | null;
  startDate?: string;
  endDate?: string;
  available: boolean;
  clicks: number;
  impressions: number;
  ctr: number | null;
  averagePosition: number | null;
  queries: Array<SearchPerformanceMetric & { query: string }>;
  pages: Array<SearchPerformanceMetric & { pageUrl: string }>;
  countries: Array<SearchPerformanceMetric & { country: string }>;
}

export interface SupabaseMetricSummary {
  metricKey: string;
  label: string;
  value: number;
  sourceTable: string;
  detail: string;
}

export interface HushhTechSupabaseSummary {
  sourceProjectRef: string;
  sourceProjectName: string;
  sourceDatabaseName?: string;
  generatedAt: string;
  range?: {
    startDate: string;
    endDate: string;
    days: number;
  };
  metrics: SupabaseMetricSummary[];
  daily?: HushhTechSupabaseDailyMetric[];
  rangeTotals?: HushhTechSupabaseRangeTotals;
}

export interface HushhTechSupabaseDailyMetric {
  date: string;
  label: string;
  totalUsers: number;
  newUsers: number;
  confirmedUsers: number;
  activeUsers: number;
  returningUsers: number;
  deletedUsers: number;
  deleteRequests: number;
  sessionsStarted: number;
  sessionUsers: number;
  avgSessionMinutes: number;
  productActiveUsers: number;
  analyticsEvents: number;
  analyticsEventUsers: number;
}

export interface HushhTechSupabaseRangeTotals {
  totalUsers: number;
  newUsers: number;
  confirmedUsers: number;
  activeUsers: number;
  returningUsers: number;
  deletedUsers: number;
  deleteRequests: number;
  sessionsStarted: number;
  sessionUsers: number;
  avgSessionMinutes: number;
  productActiveUsers: number;
  analyticsEvents: number;
  analyticsEventUsers: number;
}

export interface HushhAiSummary {
  gcp: CloudRunSummary | null;
  searchConsole: SearchConsoleSummary | null;
  freshness?: HushhAiFreshness | null;
}

export interface HushhAiFreshnessSource {
  key: string;
  label: string;
  state: 'live' | 'near_live' | 'delayed' | 'waiting' | 'unavailable' | 'collecting_not_ingested' | string;
  realtimeLevel: string;
  generatedAt: string;
  expectedLagSeconds: number | null;
  detail: string;
}

export interface HushhAiFreshness {
  mode: 'polling' | string;
  refreshIntervalSeconds: number;
  fetchedAt: string;
  sources: HushhAiFreshnessSource[];
}

export type ProductFreshness = HushhAiFreshness;

export interface KaiProductionFeedSummary {
  rows: FeedRow[];
  status: FeedStatus;
}

export interface KaiProductionSummary {
  productionFeed: KaiProductionFeedSummary;
  uatFeed: KaiProductionFeedSummary;
  uatGa4: KaiGa4Summary | null;
  productionGa4: KaiGa4Summary | null;
  gcp: CloudRunSummary | null;
  freshness?: ProductFreshness | null;
}

export interface KaiDailyStatusPoint {
  date: string;
  label: string;
  users: number;
  sessions: number;
  events: number;
  requests: number;
  errors: number;
  errorRate: number | null;
  p95LatencyMs: number | null;
  instanceCount: number | null;
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
  kaiActivationMetrics: BreakdownMetric[];
  kaiUsageMetrics: BreakdownMetric[];
  kaiEventMetrics: BreakdownMetric[];
  kaiGeoMetrics: BreakdownMetric[];
  platformMix: BreakdownMetric[];
  featureEngagement: BreakdownMetric[];
  instrumentationHealth: BreakdownMetric[];
  kaiGa4: KaiGa4Summary | null;
  kaiProduction: KaiProductionSummary | null;
  kaiProductionDailyStatus: KaiDailyStatusPoint[];
  kaiProductionDailySummaryMetrics: BreakdownMetric[];
  kaiProductionReadinessMetrics: BreakdownMetric[];

  // hushhtech.com public metrics
  hushhTech: HushhTechMetricsSummary | null;
  hushhTechAudienceMetrics: BreakdownMetric[];
  hushhTechBusinessMetrics: BreakdownMetric[];
  hushhTechOpsMetrics: BreakdownMetric[];
  hushhTechReportTotals: BreakdownMetric[];
  hushhTechSevenDayMetrics: BreakdownMetric[];
  hushhTechCoverageMetrics: BreakdownMetric[];
  hushhTechActivityMetrics: BreakdownMetric[];
  hushhTechFunnelMetrics: BreakdownMetric[];
  hushhTechDatabaseMetrics: BreakdownMetric[];
  hushhTechDailyStatus: HushhAiDailyStatusPoint[];
  hushhTechDailySummaryMetrics: BreakdownMetric[];
  hushhAi: HushhAiSummary | null;
  hushhAiOpsMetrics: BreakdownMetric[];
  hushhAiSearchMetrics: BreakdownMetric[];
  hushhAiDailyStatus: HushhAiDailyStatusPoint[];
  hushhAiDailySummaryMetrics: BreakdownMetric[];
  dataQualityWarnings: string[];
  feedWarnings: string[];

  // Aggregate KPIs (computed from all sources)
  platforms: PlatformStatus[];
  kpiStats: KpiStat[];
  trafficData: TrafficPoint[];
  acquisitionChannels: AcquisitionChannel[];
  topCountries: CountryData[];
}

export interface HushhAiDailyStatusPoint {
  date: string;
  label: string;
  totalUsers: number;
  newUsers: number;
  confirmedUsers: number;
  activeUsers: number;
  returningUsers: number;
  deletedUsers: number;
  deleteRequests: number;
  sessionsStarted: number;
  sessionUsers: number;
  avgSessionMinutes: number;
  productActiveUsers: number;
  analyticsEvents: number;
  analyticsEventUsers: number;
  requests: number;
  errors: number;
  errorRate: number | null;
  p95LatencyMs: number | null;
  instanceCount: number | null;
}
