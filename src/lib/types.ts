/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TypeScript types for the hussh Matrix Dashboard.
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
  rows?: FeedRow[];
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
 * `devices` counts GA4 device/browser identifiers that did something deliberate. `totalUsers` counts
 * everyone the old event-name-prefix bucket would have counted, including
 * retries, prefetches and health pings. Both are shown, because the drop
 * between them is the point: it is the size of the error the page used to
 * publish, and hiding it would make a correction look like a regression.
 *
 * `instrumented: false` means the capability emits no usage event at all. Then
 * `devices` is null, never 0 -- "no device used it" and "nobody can measure it"
 * are different facts and only one of them is about the product.
 */
export interface OneCapabilityUsage {
  key: string;
  label: string;
  instrumented: boolean;
  /** True only after a matching aggregate row is present in the selected GA4 export window. */
  observed: boolean;
  /** Rollout, privacy or availability context for this capability. */
  note: string | null;
  /** Distinct stable GA4 user_id values; null when no matching row is observed. */
  accounts: number | null;
  devices: number | null;
  deliberateEvents: number | null;
  totalUsers: number;
  totalEvents: number;
  /** Date-spined, so every capability chart shares one x-axis. */
  daily: OneAgentDailyPoint[];
}

export interface OneActiveUsers {
  countingUnit: 'device';
  identityScope: string;
  dau: number;
  wau: number;
  mau: number;
  /** DAU/MAU. Null rather than 0 when MAU is 0, so no-data never reads as collapse. */
  stickiness: number | null;
  /** The day DAU is measured on -- the end of the selected range, not "today". */
  asOf: string;
}

/**
 * Cross-device unique signed-in accounts observed in GA4.
 *
 * These are exact distinct stable account identifiers for the identified
 * slice. `deviceCoverage` keeps anonymous/unbound devices visible so this can
 * never be mistaken for a complete unique-human count.
 */
export interface OneIdentifiedUsers {
  countingUnit: 'account';
  identityScope: string;
  selectedRange: {
    /** False when the account-history query failed; null counts never mean zero. */
    available: boolean;
    /** Every distinct stable account active in the selected range, counted once. */
    totalUsers: number | null;
    /** Accounts whose first observed One event falls inside the selected range. */
    newUsers: number | null;
    /** Selected-range accounts first observed before the selected range. */
    returningUsers: number | null;
    startDate: string;
    endDate: string;
    newUserDefinition: string;
  };
  dau: number;
  wau: number;
  mau: number;
  identifiedDevices: { dau: number; wau: number; mau: number };
  deviceCoverage: { dau: number | null; wau: number | null; mau: number | null };
  complete: boolean;
  asOf: string;
}

/**
 * Authoritative registered-account counts from Firebase Authentication.
 * Production and UAT builds share this identity realm even though their
 * backend routing and GA4 properties remain separate.
 */
export interface OneRegisteredAccounts {
  available: boolean;
  sourceLabel: string;
  identityRealm: string;
  sharedAcrossEnvironments: boolean;
  countingUnit: 'account';
  deduplication: string;
  /** Current unique account records in Firebase Authentication. */
  totalAccounts: number | null;
  /** Current account records created inside the selected date range. */
  newAccounts: number | null;
  /** Current account records whose creation date is on or before the range end. */
  accountsCreatedByRangeEnd: number | null;
  /** Included in totalAccounts, but surfaced so the scope stays auditable. */
  disabledAccounts: number | null;
  startDate: string;
  endDate: string;
  generatedAt: string;
  daily: Array<{ date: string; newAccounts: number }>;
  note: string;
}

/**
 * Actives for one platform. Deliberately has no "total" sibling: web, iOS and
 * Android are separate device-id spaces and the account key that would join
 * them is bound on iOS only, so the rows must not be added.
 */
export interface OnePlatformActives {
  platform: string;
  dauDevices: number;
  wauDevices: number;
  mauDevices: number;
  /** Null when this platform never binds an account, rather than 0. */
  accounts: number | null;
  /** Distinct stable accounts active inside each fixed window. */
  dauAccounts: number | null;
  wauAccounts: number | null;
  mauAccounts: number | null;
  /** Share of this platform's devices that ever bound an account. */
  signedInShare: number | null;
  identityBound: boolean;
}

/** Signed-in accounts observed in the shipped One iOS bundle, not registrations. */
export interface OneIosIdentifiedUsers {
  available: boolean;
  countingUnit: 'account';
  bundleId: string;
  totalUsers: number | null;
  firstObservedUsers: number | null;
  previouslyObservedUsers: number | null;
  /** Earliest account-tagged iOS export date; limits first-observed interpretation. */
  identityObservedSince: string | null;
  startDate: string;
  endDate: string;
  note: string;
}

/** Selected-range iOS app-instance, product-route and controller-view totals, never people. */
export interface OneIosUsage {
  available: boolean;
  bundleId: string;
  activeInstallIds: number | null;
  screenViews: number | null;
  namedScreenViews: number | null;
  distinctScreenNames: number | null;
  /** One's own route-level page_view events, not automatic UIKit controller events. */
  productScreenVisits: number | null;
  namedProductScreenVisits: number | null;
  distinctProductScreens: number | null;
  topProductScreens: Array<{ routeId: string; visits: number }>;
  startDate: string;
  endDate: string;
  note: string;
}

export interface OneInstallStage {
  key: string;
  label: string;
  users: number;
  /** Share of the install cohort, not of the previous stage. */
  shareOfInstalls: number | null;
}

/**
 * What happens to people who install the native app.
 *
 * A true cohort funnel: every stage counts the same set of devices that
 * installed inside the window, so the stages nest. Web has no install to
 * cohort on and is excluded.
 */
export interface OneInstallFunnel {
  platform: string;
  installed: number;
  /** False means the selected export has not observed every cohort's full week. */
  retentionWindowComplete?: boolean;
  retentionDataThrough?: string | null;
  stages: OneInstallStage[];
}

export interface OneGrowthSplit {
  newUsers: number;
  returningUsers: number;
  /** First touch missing. Named rather than folded into `newUsers`. */
  unknownUsers: number;
}

export interface OneRetentionCohort {
  cohortWeek: string;
  cohortSize: number | null;
  returnedW1: number | null;
  rateW1: number | null;
  windowComplete?: boolean;
  state?: 'available' | 'pending' | 'unavailable';
  dataThrough?: string | null;
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

export interface OneLocationMetricPoint {
  eventDate: string;
  users: number;
  events: number;
}

/**
 * A product-level One Location behaviour, normalized from the older dedicated
 * events and the newer journey-action event. `instrumented` is explicit so a
 * feature waiting for its first shipped event never masquerades as zero use.
 */
export interface OneLocationBehaviorMetric {
  key: string;
  label: string;
  instrumented: boolean;
  users: number | null;
  events: number | null;
  successes: number | null;
  expectedErrors: number | null;
  failures: number | null;
  daily: OneLocationMetricPoint[];
}

/** Aggregate source-event composition. Repeated records are retained. */
export interface OneFeatureEventCount {
  eventName: string;
  signals: number;
  successes: number;
  expectedErrors: number;
  failures: number;
}

export interface OneLocationJourneyMetric {
  key: string;
  label: string;
  instrumented: boolean;
  /** Whether this exact action has emitted in the selected environment/range. */
  observed: boolean;
  users: number | null;
  events: number | null;
  successes: number | null;
  failures: number | null;
}

export interface OneLocationCircleKindMetric {
  kind: string;
  label: string;
  creators: number;
  circlesCreated: number;
}

export interface OneLocationPlatformBehaviorMetric {
  platform: string;
  feature: string;
  users: number;
  events: number;
}

export interface OneLocationBehaviorAnalytics {
  /** First export date on which the richer journey-action event was observed. */
  instrumentationStartedAt: string | null;
  journeyActionSeen: boolean;
  instrumentationNote: string;
  features: OneLocationBehaviorMetric[];
  journey: OneLocationJourneyMetric[];
  circleKinds: OneLocationCircleKindMetric[];
  platforms: OneLocationPlatformBehaviorMetric[];
}

export interface OnePlatformUsage {
  platform: string;
  /** All-event app-instance/browser IDs; retained for existing diagnostics. */
  users: number;
  events: number;
  /** Distinct identifiers with meaningful activity during the selected range. */
  activeDeviceIds: number;
  /** Signed-in account IDs in this platform's selected-range activity. */
  activeAccounts: number;
  /** Typed route events, including callbacks and routes without usable names. */
  routeVisits: number;
  namedRouteVisits: number;
  /** Null when no named product route was observed. */
  distinctScreens: number | null;
  topProductScreens: Array<{ routeId: string; visits: number }>;
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
  sourceWebHost?: string;
  generatedAt?: string;
  realtimeMode?: string;
  expectedLagSeconds?: number | null;
  available: boolean;
  surfaceScope?: {
    webHost: string;
    strictWebHost: boolean;
    nativeFromSameProperty: boolean;
  };
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
  identifiedUsers: OneIdentifiedUsers;
  iosIdentifiedUsers?: OneIosIdentifiedUsers;
  iosUsage?: OneIosUsage;
  registeredAccounts: OneRegisteredAccounts;
  activeByPlatformAvailable?: boolean;
  activeByPlatform: OnePlatformActives[];
  installFunnel: OneInstallFunnel[];
  growth: OneGrowthSplit;
  retention: OneRetentionCohort[];
  retentionRange?: { startDate: string; endDate: string; timezone: string };
  retentionAvailable?: boolean;
  activationStages: OneActivationStage[];
  capabilitiesAvailable: boolean;
  /** Health of the existing daily agent query; absent on older API revisions. */
  capabilityDailyAvailable?: boolean;
  capabilities: OneCapabilityUsage[];
  surfaces: OneSurfaceRow[];
  androidCapture?: {
    state: 'unavailable' | 'waiting' | 'observed';
    packageId: string; source: string; reportingTimezone: string;
    startDate: string; endDate: string; observedSince: string | null; latestEventAt: string | null;
    events: number | null; activeAppIds: number | null; identifiedAccounts: number | null;
    firstOpens: number | null; routeVisits: number | null;
    releases: Array<{version: string; installer: string; environment: string; events: number | null}>;
    note: string;
  };
  nativeEnvironments?: Array<{
    platform: string;
    environment: string;
    devices: number;
    events: number;
  }>;
  locationFeatures: OneLocationFeatureUsage[];
  /** Whether the dedicated Location behaviour aggregate completed successfully. */
  locationBehaviorAvailable: boolean;
  locationAnalytics: OneLocationBehaviorAnalytics;
  featureUsageAvailable: boolean;
  featureUsage: Record<string, {
    accounts: number;
    devices: number;
    signals: number;
    successes: number;
    expectedErrors: number;
    failures: number;
    outcomeSignals: number;
    /** Optional while older API revisions are still in use. */
    eventBreakdown?: OneFeatureEventCount[];
  }>;
  platformsAvailable: boolean;
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

export interface OrgUserWindow {
  startDate: string;
  endDate: string;
  days: number;
  newUsers: number;
  priorStartDate: string;
  priorEndDate: string;
  priorNewUsers: number;
}

export interface OrgIdentityPlatform {
  platform: string;
  devices: number;
  accounts: number;
  identifiedDevices: number;
}

/**
 * How much of the audience the analytics can actually identify.
 *
 * Reported as a shortfall rather than resolved into a single "people" number:
 * only the identified slice could honestly be called people, and it is small
 * enough that publishing it as the headline would erase most of the audience.
 */
export interface OrgIdentity {
  devices: number;
  accounts: number;
  identifiedDevices: number;
  windowDays: number;
  /** Share of devices carrying any account identity. */
  coverage: number | null;
  byPlatform: OrgIdentityPlatform[];
}

export interface OrgCostByProduct {
  key: string;
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
    /** New devices inside the selected range, with the equal-length window before it. */
    window?: OrgUserWindow;
    note: string;
  };
  identity: OrgIdentity;
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

/** One column of the over-time comparison: the growth summary over a fixed window. */
export interface GrowthCompareWindow {
  key: '30d' | '90d' | 'all';
  label: string;
  range: { startDate: string; endDate: string; days: number };
  data: GrowthSummary | null;
  error: string | null;
}

export interface GrowthCompare {
  windows: GrowthCompareWindow[];
  error: string | null;
  fetchedAt: string;
}

// ---------------------------------------------------------------------------
// App Store Connect — Hussh 1 iOS (official Analytics Reports API)
// ---------------------------------------------------------------------------

export interface AppStoreConnectMetrics {
  impressions: number | null;
  productPageViews: number | null;
  firstTimeDownloads: number | null;
  redownloads: number | null;
  totalDownloads: number | null;
  /** Total downloads over product page views. Null when either side is unavailable. */
  conversionRate: number | null;
  sessions: number | null;
  activeDevices: number | null;
  installations: number | null;
  crashes: number | null;
  deletions: number | null;
}

export interface AppStoreConnectSummary {
  available: boolean;
  /** Set whenever `available` is false: why (not connected, not applicable, or the request failed). */
  note: string | null;
  generatedAt?: string;
  range?: { startDate: string; endDate: string; days: number };
  metrics: AppStoreConnectMetrics | null;
}

/**
 * TestFlight has no bulk Analytics Reports API (no product page, so no
 * impressions, page views, downloads or conversion rate), but it does have
 * real, documented metrics -- confirmed against Apple's published OpenAPI
 * spec, not assumed:
 *
 * - `testerCount` / `testersByState`: the beta tester roster and
 *   `BetaTester.attributes.state` (NOT_INVITED / INVITED / ACCEPTED /
 *   INSTALLED / REVOKED -- a documented enum; per-tester accepted/installed
 *   state is real, not a gap).
 * - `sessions` / `crashes` / `feedback`: Apple's own trailing-period rollup
 *   for the app (`GET /v1/apps/{id}/metrics/betaTesterUsages`), over the
 *   nearest fixed period to the selected window -- Apple's metrics API takes
 *   no arbitrary date range.
 * - `invites` / `installs`: each build's lifetime-to-date total (`GET
 *   /v1/builds/{id}/metrics/betaBuildUsages`), summed across builds uploaded
 *   in the selected window. Apple has no app-level total for either, and no
 *   windowed one either -- per build is the only granularity, and each
 *   build's number is cumulative, not scoped to any date range.
 */
export interface AppStoreConnectTestFlightMetrics {
  testerCount: number | null;
  testersByState: {
    notInvited: number;
    invited: number;
    accepted: number;
    installed: number;
    revoked: number;
  } | null;
  invites: number | null;
  installs: number | null;
  sessions: number | null;
  crashes: number | null;
  feedback: number | null;
}

export interface AppStoreConnectTestFlightSummary {
  available: boolean;
  /** Present whether or not `available` is true: a real reading still names what it doesn't cover. */
  note: string | null;
  generatedAt?: string;
  range?: { startDate: string; endDate: string; days: number };
  metrics: AppStoreConnectTestFlightMetrics | null;
}

/**
 * Production (App Store) and UAT (TestFlight) are reported separately and
 * never summed -- they are different distribution channels, fetched from two
 * unrelated Apple APIs, with different metric shapes.
 */
export interface AppStoreConnectEnvironments {
  appAppleId: string;
  production: AppStoreConnectSummary;
  testflight: AppStoreConnectTestFlightSummary;
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
  appStoreConnect: AppStoreConnectEnvironments | null;
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
