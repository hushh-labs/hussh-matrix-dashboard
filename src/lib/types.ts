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
  kaiProd: number;
  kaiUat: number;
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

export type ProductSourceStatus =
  | 'live'
  | 'near_live'
  | 'delayed'
  | 'waiting'
  | 'unavailable'
  | 'not_configured'
  | 'collecting_not_ingested'
  | string;

export interface ProductSourceCardMetric {
  key: string;
  label: string;
  value: number | null;
  displayValue?: string;
}

export interface ProductSourceCardSection {
  key: string;
  label: string;
  status?: ProductSourceStatus;
  stateClass?: string;
  source?: string;
  freshness?: {
    generatedAt: string;
    expectedLagSeconds: number | null;
  };
  metrics: ProductSourceCardMetric[];
  blocker?: string | null;
}

export interface ProductSourceCard {
  key: 'search_console' | 'ga4' | 'product_events' | string;
  label: string;
  status: ProductSourceStatus;
  stateClass?: string;
  source: string;
  freshness: {
    generatedAt: string;
    expectedLagSeconds: number | null;
  };
  metrics: ProductSourceCardMetric[];
  sections?: ProductSourceCardSection[];
  blocker?: string | null;
}

export interface ProductSourceGroup {
  productKey: 'hushh_ai' | 'kai' | 'hushhtech' | string;
  productName: string;
  domain: string;
  primaryEnvironment: 'production' | 'uat' | string;
  sourceCards: ProductSourceCard[];
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
  sourceLabel?: string;
  available: boolean;
  realtime: boolean;
  dataState: string;
  searchType: string;
  overview: SearchPerformance;
  range?: {
    startDate: string;
    endDate: string;
    days: number;
  };
  rangeTotals?: SearchPerformance;
  daily?: Array<SearchPerformanceMetric & { date: string; label: string }>;
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
  processedMetricsVerified?: boolean;
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
  sourceCards?: ProductSourceCard[];
  stale?: boolean;
}

export interface KaiGa4DailyMetric {
  eventDate: string;
  events: number | null;
  users: number | null;
  sessions: number | null;
  engagedSessions?: number | null;
  engagementRate?: number | null;
  averageSessionDuration?: number | null;
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

export interface Ga4AcquisitionMetric {
  channel?: string;
  sourceMedium?: string;
  landingPage?: string;
  country?: string;
  deviceCategory?: string;
  sessions: number | null;
  users: number | null;
  newUsers?: number | null;
  engagedSessions?: number | null;
  averageSessionDuration?: number | null;
  events: number | null;
}

export interface Ga4SessionTimingMetric {
  dateHour?: string;
  hour?: string;
  label: string;
  sessions: number | null;
  engagedSessions?: number | null;
  averageSessionDuration?: number | null;
  events: number | null;
  users: number | null;
}

export interface KaiGa4Summary {
  sourceLabel?: string;
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
    users: number | null;
    sessions: number | null;
    events: number | null;
    engagedSessions?: number | null;
    engagementRate?: number | null;
    averageSessionDuration?: number | null;
  };
  sections?: ProductSourceCardSection[];
  daily: KaiGa4DailyMetric[];
  topEvents: KaiGa4EventMetric[];
  topPages?: Array<{
    path: string;
    title?: string;
    views: number | null;
    users: number | null;
    events: number | null;
  }>;
  acquisition?: {
    sessionChannels?: Ga4AcquisitionMetric[];
    sessionSourceMedium?: Ga4AcquisitionMetric[];
    landingPages?: Ga4AcquisitionMetric[];
    geoDevice?: Ga4AcquisitionMetric[];
  };
  sessionTiming?: {
    timezoneLabel?: string;
    hourly?: Ga4SessionTimingMetric[];
    hourOfDay?: Ga4SessionTimingMetric[];
    topDateHours?: Ga4SessionTimingMetric[];
  };
  warnings?: string[];
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
  sourceLabel?: string;
  generatedAt?: string;
  realtimeMode?: string;
  expectedLagSeconds?: number | null;
  startDate?: string;
  endDate?: string;
  range?: {
    startDate: string;
    endDate: string;
    days: number;
  };
  rangeTotals?: SearchPerformanceMetric;
  available: boolean;
  clicks: number;
  impressions: number;
  ctr: number | null;
  averagePosition: number | null;
  daily?: Array<SearchPerformanceMetric & { date: string; label: string }>;
  queries: Array<SearchPerformanceMetric & { query: string }>;
  pages: Array<SearchPerformanceMetric & { pageUrl: string }>;
  countries: Array<SearchPerformanceMetric & { country: string }>;
  devices?: Array<SearchPerformanceMetric & { device: string }>;
  source?: string;
  siteUrl?: string;
  note?: string;
}

export interface SupabaseMetricSummary {
  metricKey: string;
  label: string;
  value: number;
  detail: string;
}

export interface HushhTechSupabaseSummary {
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
  ga4?: KaiGa4Summary | null;
  productEvents?: Record<string, unknown> | null;
  freshness?: HushhAiFreshness | null;
  sourceCards?: ProductSourceCard[];
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
  searchConsole?: SearchConsoleSummary | null;
  productionSearchConsole?: SearchConsoleSummary | null;
  uatSearchConsole?: SearchConsoleSummary | null;
  gcp: CloudRunSummary | null;
  freshness?: ProductFreshness | null;
  sourceCards?: ProductSourceCard[];
  uatSourceCards?: ProductSourceCard[];
}

export interface KaiDailyStatusPoint {
  date: string;
  label: string;
  users: number | null;
  sessions: number | null;
  events: number | null;
  requests: number;
  errors: number;
  errorRate: number | null;
  p95LatencyMs: number | null;
  instanceCount: number | null;
}

export interface KaiUatDailyStatusPoint {
  date: string;
  label: string;
  ga4Users: number | null;
  ga4Sessions: number | null;
  ga4Events: number | null;
  feedDau: number | null;
  feedSessions: number | null;
  feedEvents: number | null;
}

// ---------------------------------------------------------------------------
// one.hushh.ai — the One app
// ---------------------------------------------------------------------------

/**
 * One step of the One Location activation funnel. Unlike the bare `FunnelStep`
 * used by the older investor/RIA funnels, this carries its own drop-off so the
 * UI never has to recompute it from a list that may be missing steps.
 */
export interface OneLocationFunnelStep {
  step: string;
  label: string;
  users: number;
  /** Against the previous step that had users; null when there is no basis. */
  conversionFromPrevious: number | null;
  dropoffFromPrevious: number | null;
}

export interface OneAgentDailyPoint {
  eventDate: string;
  users: number;
}

/**
 * One capability, reported twice.
 *
 * `humanUsers` counts people who did something deliberate. `totalUsers` counts
 * everyone the old event-name-prefix bucket would have counted, including
 * retries, prefetches and health pings. Both are shown, because the drop
 * between them is the point: it is the size of the error the page used to
 * publish, and hiding it would make a correction look like a regression.
 *
 * `instrumented: false` means the capability emits no usage event at all. Then
 * `humanUsers` is null, never 0 -- "nobody used it" and "nobody can measure it"
 * are different facts and only one of them is about the product.
 */
export interface OneCapabilityUsage {
  key: string;
  label: string;
  instrumented: boolean;
  /** Why it cannot be measured. Non-null only when `instrumented` is false. */
  note: string | null;
  humanUsers: number | null;
  humanEvents: number | null;
  totalUsers: number;
  totalEvents: number;
  /** Date-spined, so every capability chart shares one x-axis. */
  daily: OneAgentDailyPoint[];
}

export interface OneActiveUsers {
  dau: number;
  wau: number;
  mau: number;
  /** DAU/MAU. Null rather than 0 when MAU is 0, so no-data never reads as collapse. */
  stickiness: number | null;
  /** The day DAU is measured on -- the end of the selected range, not "today". */
  asOf: string;
}

export interface OneGrowthSplit {
  newUsers: number;
  returningUsers: number;
  /** First touch missing. Named rather than folded into `newUsers`. */
  unknownUsers: number;
}

export interface OneRetentionCohort {
  cohortWeek: string;
  cohortSize: number;
  returnedW1: number;
  rateW1: number | null;
}

export interface OneActivationStage {
  key: string;
  label: string;
  users: number;
}

/**
 * What the surface filter counted and what it left out. Shown rather than
 * hidden: this dashboard's headline number was once inflated by marketing-site
 * traffic, and the cheapest guard against that recurring is to keep the
 * exclusions visible on the page.
 */
export interface OneSurfaceRow {
  surface: string;
  host: string;
  users: number;
}

export interface OneLocationFeatureUsage {
  eventName: string;
  users: number;
  events: number;
}

export interface OnePlatformUsage {
  platform: string;
  users: number;
  events: number;
}

export interface OneAcquisitionRow {
  source: string;
  medium: string;
  users: number;
}

export interface OneDailyPoint {
  eventDate: string;
  users: number;
  locationUsers: number;
  events: number;
}

export interface OneAppSummary {
  sourceLabel?: string;
  generatedAt?: string;
  realtimeMode?: string;
  expectedLagSeconds?: number | null;
  available: boolean;
  windowDays: number;
  range?: { startDate: string; endDate: string; days: number };
  rangeTotals: { users: number; sessions: number; events: number };
  last24Hours?: {
    users: number;
    sessions: number;
    events: number;
    available: boolean;
  };
  activation: {
    activatedUsers: number;
    sharingUsers: number;
  };
  funnel: OneLocationFunnelStep[];
  activeUsers: OneActiveUsers;
  growth: OneGrowthSplit;
  retention: OneRetentionCohort[];
  activationStages: OneActivationStage[];
  capabilities: OneCapabilityUsage[];
  surfaces: OneSurfaceRow[];
  locationFeatures: OneLocationFeatureUsage[];
  platforms: OnePlatformUsage[];
  acquisition: OneAcquisitionRow[];
  daily: OneDailyPoint[];
  reliability: {
    locationRetries: number;
    locationRetryUsers: number;
    /** High values mean the geolocation fix is failing repeatedly per person. */
    retriesPerAffectedUser: number | null;
  };
}

// ---------------------------------------------------------------------------
// Organisation-level growth
// ---------------------------------------------------------------------------

export interface OrgUserPoint {
  week: string;
  newUsers: number;
  cumulative: number;
}

export interface OrgCostByProduct {
  product: string;
  production: number;
  nonProduction: number;
}

export interface OrgTtfvBucket {
  bucket: string;
  users: number;
}

export interface OrgSearchPoint {
  week: string;
  clicks: number;
  impressions: number;
}

export interface GrowthSummary {
  generatedAt?: string;
  range?: { startDate: string; endDate: string; days: number };
  users: {
    series: OrgUserPoint[];
    totalEverSeen: number;
    note: string;
  };
  crossProduct: {
    siteVisitors: number;
    appWebVisitors: number;
    siteThenApp: number;
    conversionRate: number | null;
    note: string;
  };
  timeToFirstValue: {
    activatedUsers: number;
    medianMinutes: number | null;
    fastestMinutes: number | null;
    slowestMinutes: number | null;
    distribution: OrgTtfvBucket[];
  };
  cost: {
    total: number;
    production: number;
    nonProduction: number;
    unattributed: number;
    byProduct: OrgCostByProduct[];
    available: boolean;
  };
  organicSearch: {
    available: boolean;
    clicks: number;
    impressions: number;
    ctr: number | null;
    avgPosition: number | null;
    latestDay: string | null;
    series: OrgSearchPoint[];
  };
  instrumentation: {
    governedEvents: number;
    ungovernedEvents: number;
    distinctEvents: number;
    ungovernedEventNames: number;
    declaredNotEmitted: string[];
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
  kaiUatFreshness: ProductFreshness | null;
  kaiUatDailyStatus: KaiUatDailyStatusPoint[];
  kaiUatDailySummaryMetrics: BreakdownMetric[];

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
  hushhAiEngagementMetrics: BreakdownMetric[];
  hushhAiTopPageMetrics: BreakdownMetric[];
  hushhAiTopEventMetrics: BreakdownMetric[];
  hushhAiProductEventMetrics: BreakdownMetric[];
  hushhAiAcquisitionMetrics: BreakdownMetric[];
  hushhAiSourceMediumMetrics: BreakdownMetric[];
  hushhAiLandingPageMetrics: BreakdownMetric[];
  hushhAiGeoDeviceMetrics: BreakdownMetric[];
  hushhAiSessionTimingMetrics: BreakdownMetric[];
  hushhAiDailyStatus: HushhAiDailyStatusPoint[];
  hushhAiDailySummaryMetrics: BreakdownMetric[];
  // one.hushh.ai — the One app (all agents + the One Location growth funnel)
  one: OneAppSummary | null;
  oneUat: OneAppSummary | null;
  oneAgentMetrics: BreakdownMetric[];
  oneHealthMetrics: BreakdownMetric[];
  growth: GrowthSummary | null;
  /** Monthly cloud cost divided by monthly active devices. Null when either side is missing. */
  costPerActiveUser: number | null;
  oneLocationFeatureMetrics: BreakdownMetric[];
  onePlatformMetrics: BreakdownMetric[];
  oneAcquisitionMetrics: BreakdownMetric[];
  oneHeadlineMetrics: BreakdownMetric[];

  dataQualityWarnings: string[];
  feedWarnings: string[];
  sourceGroups: ProductSourceGroup[];

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
