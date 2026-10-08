/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Client-side analytics service for the Hussh Matrix Dashboard.
 * Fetches modeled aggregate analytics from the Express proxy and normalizes
 * One BigQuery rows plus hushhtech.com public metrics into one UI model.
 */

import type {
  GrowthCompare,
  GrowthSummary,
  FeedRow,
  FeedStatus,
  UsageSummary,
  FunnelStep,
  DailyActiveUser,
  BreakdownMetric,
  HushhTechMetricsSummary,
  HushhAiSummary,
  KaiGa4Summary,
  KaiProductionSummary,
  PlatformStatus,
  KpiStat,
  TrafficPoint,
  AcquisitionChannel,
  CountryData,
  DashboardData,
  HushhAiDailyStatusPoint,
  KaiDailyStatusPoint,
  KaiUatDailyStatusPoint,
  ProductFreshness,
  ProductSourceCard,
  ProductSourceGroup,
  OneAppSummary,
  AppStoreConnectEnvironments,
} from './types';

const API_BASE = '/api';

export interface AllAnalyticsResponse {
  kai: {
    uat: { environment: string; rows: FeedRow[]; error?: string | null };
    production: { environment: string; rows: FeedRow[]; error?: string | null };
    ga4?: { platform: string; data: KaiGa4Summary | null; error?: string | null };
    productionProduct?: { platform: string; data: KaiProductionSummary | null; error?: string | null };
  };
  hushhAi?: { platform: string; data: HushhAiSummary | null; error?: string | null };
  hushhTech: { platform: string; data: HushhTechMetricsSummary | null; error?: string | null };
  one?: {
    platform: string;
    data: { production: OneAppSummary | null; uat: OneAppSummary | null } | null;
    error?: string | null;
  };
  growth?: { platform: string; data: GrowthSummary | null; error?: string | null };
  appStoreConnect?: { platform: string; data: AppStoreConnectEnvironments | null; error?: string | null };
  fetchedAt: string;
}

export interface FetchAllAnalyticsOptions {
  view?: 'one' | 'growth' | 'apps' | 'overview' | 'platforms';
  hushhAiStartDate?: string;
  hushhAiEndDate?: string;
  kaiStartDate?: string;
  kaiEndDate?: string;
  oneStartDate?: string;
  oneEndDate?: string;
}

export function buildAnalyticsUrl(options?: FetchAllAnalyticsOptions): string {
  const params = new URLSearchParams();
  if (options?.view) params.set('view', options.view === 'platforms' ? 'overview' : options.view);
  if (options?.hushhAiStartDate) params.set('hushh_ai_start_date', options.hushhAiStartDate);
  if (options?.hushhAiEndDate) params.set('hushh_ai_end_date', options.hushhAiEndDate);
  if (options?.kaiStartDate) params.set('kai_start_date', options.kaiStartDate);
  if (options?.kaiEndDate) params.set('kai_end_date', options.kaiEndDate);
  if (options?.oneStartDate) params.set('one_start_date', options.oneStartDate);
  if (options?.oneEndDate) params.set('one_end_date', options.oneEndDate);
  const query = params.toString();
  return `${API_BASE}/analytics/all${query ? `?${query}` : ''}`;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Cache-Control': 'no-cache',
    };

    const res = await fetch(url, {
      cache: 'no-store',
      headers,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

function formatPercent(value: number | null | undefined, decimals = 1): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(decimals)}%`;
}

function formatDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '—';
  const rounded = Math.round(seconds);
  if (rounded < 60) return `${rounded}s`;
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (minutes < 60) return `${minutes}m ${remainder}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatLatency(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function asNumber(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function firstNumber(...values: Array<number | null | undefined>): number {
  return asNumber(values.find((value) => typeof value === 'number' && Number.isFinite(value)));
}

function firstOptionalNumber(...values: Array<number | null | undefined>): number | null {
  return values.find((value) => typeof value === 'number' && Number.isFinite(value)) ?? null;
}

function strongestNumber(...values: Array<number | null | undefined>): number {
  return values.reduce((max, value) => Math.max(max, asNumber(value)), 0);
}

function sourceCardByKey(cards: ProductSourceCard[] | undefined, key: string): ProductSourceCard | undefined {
  return cards?.find((card) => card.key === key);
}

function sourceCardText(card: ProductSourceCard | undefined): string {
  if (!card) return '';
  const sectionText = (card.sections ?? [])
    .flatMap((section) => [section.blocker, section.source])
    .filter(Boolean)
    .join(' ');
  return [card.blocker, card.source, sectionText].filter(Boolean).join(' ');
}

function verifiedHushhTechTrafficOverview(hushhTech: HushhTechMetricsSummary | null): HushhTechMetricsSummary['traffic']['overview'] | null {
  if (!hushhTech?.traffic?.available) return null;
  if (hushhTech.traffic.processedMetricsVerified === false) return null;
  const ga4Card = sourceCardByKey(hushhTech.sourceCards, 'ga4');
  const sourceText = sourceCardText(ga4Card);
  if (/processed traffic is all zero|processed GA4 traffic as unverified/i.test(sourceText)) return null;
  return hushhTech.traffic.overview;
}

function formatMetricLabel(value: string): string {
  return value
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function metricNumber(row: FeedRow | undefined): number {
  return Number(row?.metric_count ?? row?.metric_value ?? 0) || 0;
}

function optionalMetricNumber(row: FeedRow | undefined): number | null {
  return row ? metricNumber(row) : null;
}

function metricDateValue(row: FeedRow | undefined): string | null {
  const date = row?.metric_date;
  if (typeof date === 'string') return date;
  if (date && typeof date === 'object' && typeof date.value === 'string') return date.value;
  return null;
}

function latestRowsForGroup(rows: FeedRow[], group: string): FeedRow[] {
  const groupRows = rows.filter((r) => r.metric_group === group && metricDateValue(r));
  const latestDate = groupRows
    .map(metricDateValue)
    .filter((date): date is string => Boolean(date))
    .sort()
    .at(-1);

  if (!latestDate) return rows.filter((r) => r.metric_group === group);
  return groupRows.filter((r) => metricDateValue(r) === latestDate);
}

function metric(
  label: string,
  value: number,
  detail?: string,
  displayValue?: string,
): BreakdownMetric {
  return { label, value, detail, displayValue };
}

function emptyDashboard(error: string | null, lastUpdated: string | null): DashboardData {
  return {
    loading: false,
    error,
    lastUpdated,
    kaiFeed: null,
    kaiUsage: null,
    kaiInvestorFunnel: [],
    kaiRiaFunnel: [],
    kaiDailyUsage: [],
    kaiActivationMetrics: [],
    kaiUsageMetrics: [],
    kaiEventMetrics: [],
    kaiGeoMetrics: [],
    platformMix: [],
    featureEngagement: [],
    instrumentationHealth: [],
    kaiGa4: null,
    kaiProduction: null,
    kaiProductionDailyStatus: [],
    kaiProductionDailySummaryMetrics: [],
    kaiProductionReadinessMetrics: [],
    kaiUatFreshness: null,
    kaiUatDailyStatus: [],
    kaiUatDailySummaryMetrics: [],
    hushhTech: null,
    hushhTechAudienceMetrics: [],
    hushhTechBusinessMetrics: [],
    hushhTechOpsMetrics: [],
    hushhTechReportTotals: [],
    hushhTechSevenDayMetrics: [],
    hushhTechCoverageMetrics: [],
    hushhTechActivityMetrics: [],
    hushhTechFunnelMetrics: [],
    hushhTechDatabaseMetrics: [],
    hushhTechDailyStatus: [],
    hushhTechDailySummaryMetrics: [],
    hushhAi: null,
    hushhAiOpsMetrics: [],
    hushhAiSearchMetrics: [],
    hushhAiEngagementMetrics: [],
    hushhAiTopPageMetrics: [],
    hushhAiTopEventMetrics: [],
    hushhAiProductEventMetrics: [],
    hushhAiAcquisitionMetrics: [],
    hushhAiSourceMediumMetrics: [],
    hushhAiLandingPageMetrics: [],
    hushhAiGeoDeviceMetrics: [],
    hushhAiSessionTimingMetrics: [],
    hushhAiDailyStatus: [],
    hushhAiDailySummaryMetrics: [],
    one: null,
    oneUat: null,
    oneAgentMetrics: [],
    oneHealthMetrics: [],
    growth: null,
    costPerActiveUser: null,
    appStoreConnect: null,
    oneLocationFeatureMetrics: [],
    onePlatformMetrics: [],
    oneAcquisitionMetrics: [],
    oneHeadlineMetrics: [],
    dataQualityWarnings: [],
    feedWarnings: [],
    sourceGroups: [],
    platforms: buildPlatforms(null, null, null, null, null),
    kpiStats: buildKpiStats(null, null, null, null, null),
    trafficData: [],
    acquisitionChannels: [],
    topCountries: [],
  };
}

// ---------------------------------------------------------------------------
// one.hushh.ai builders
// ---------------------------------------------------------------------------

/**
 * Human labels for the raw One Location event names. The dashboard is read by
 * the founder, not only by the engineers who named these events, so
 * `one_location_share_confirmed` has no place on the screen.
 */
const ONE_LOCATION_EVENT_LABELS: Record<string, string> = {
  one_location_share_confirmed: 'Shared their live location',
  one_location_check_in_completed: 'Checked in somewhere',
  one_location_check_out_completed: 'Checked out from location',
  one_location_sos_triggered: 'Sent an emergency SMS',
  one_location_request_sent: "Asked for someone's location",
  one_location_circle_created: 'Created a Circle',
  one_location_circle_invite_created: 'Invited people to a Circle',
  one_location_public_link_created: 'Created a public link',
  one_location_share_review_opened: 'Opened share review',
  one_location_contact_signal_synced: 'Synced contacts',
  one_location_recommendation_selected: 'Picked a suggested person',
  one_location_onboarding_completed: 'Finished onboarding',
  one_location_setup_completed: 'Finished full setup',
  one_location_activation_completed: 'Activated',
  one_location_foreground_retry: 'Location fix retried (reliability)',
};

/**
 * Events that describe something a person chose to do, in the order we care
 * about them. `foreground_retry` is deliberately absent — it is a reliability
 * signal that fires hundreds of times per person and would dominate a list
 * meant to answer "which features do people use".
 */
const ONE_LOCATION_FEATURE_ORDER = [
  'one_location_share_confirmed',
  'one_location_check_in_completed',
  'one_location_check_out_completed',
  'one_location_sos_triggered',
  'one_location_request_sent',
  'one_location_circle_created',
  'one_location_circle_invite_created',
  'one_location_public_link_created',
  'one_location_setup_completed',
  'one_location_onboarding_completed',
];

function oneLocationEventLabel(eventName: string): string {
  return (
    ONE_LOCATION_EVENT_LABELS[eventName] ??
    eventName.replace(/^one_location_/, '').replaceAll('_', ' ')
  );
}

/**
 * Capability usage for the compact list view.
 *
 * Ranked and sized by deliberate use, not by total traffic -- ranking by total
 * would put the noisiest capability on top, which is how a geolocation retry
 * loop came to look like the most-used feature in the product. A capability
 * with no usage event carries its reason instead of a number.
 */
function buildOneAgentMetrics(one: OneAppSummary | null): BreakdownMetric[] {
  if (!one) return [];
  const total = one.capabilities.reduce((sum, cap) => sum + (cap.devices ?? 0), 0);
  return one.capabilities.map((cap) => ({
    label: cap.label,
    value: cap.devices ?? 0,
    displayValue: cap.instrumented ? `${formatNumber(cap.devices ?? 0)} devices` : 'Not instrumented',
    detail: cap.instrumented
      ? `${formatNumber(cap.deliberateEvents ?? 0)} deliberate of ${formatNumber(cap.totalEvents)} events`
      : cap.note ?? 'No usage event is emitted.',
    // Share of capability-attributed people, not of all people: one person can
    // use several capabilities, so these deliberately do not sum to 100%.
    percentage: cap.instrumented && total > 0 ? ((cap.devices ?? 0) / total) * 100 : undefined,
  }));
}

/**
 * Feature usage as "how many distinct people did this", listed in a fixed order
 * so a feature nobody has used yet still appears as a zero rather than silently
 * vanishing. A missing row and a zero row answer different questions, and the
 * question here is "is anyone using Check-In / SMS / Request Location?".
 */
function buildOneLocationFeatureMetrics(one: OneAppSummary | null): BreakdownMetric[] {
  if (!one) return [];
  const byEvent = new Map(one.locationFeatures.map((f) => [f.eventName, f]));

  const ordered = ONE_LOCATION_FEATURE_ORDER.map((eventName) => {
    const feature = byEvent.get(eventName);
    byEvent.delete(eventName);
    return {
      label: oneLocationEventLabel(eventName),
      value: feature?.users ?? 0,
      displayValue: feature ? `${formatNumber(feature.users)} devices` : 'no devices yet',
      detail: feature ? `${formatNumber(feature.events)} times` : undefined,
    };
  });

  // Anything instrumented later that this list has not been taught about still
  // shows up, rather than being dropped on the floor.
  const remaining = Array.from(byEvent.values())
    .filter((feature) => feature.eventName !== 'one_location_foreground_retry')
    .map((feature) => ({
      label: oneLocationEventLabel(feature.eventName),
      value: feature.users,
      displayValue: `${formatNumber(feature.users)} devices`,
      detail: `${formatNumber(feature.events)} times`,
    }));

  return [...ordered, ...remaining];
}

function buildOnePlatformMetrics(one: OneAppSummary | null): BreakdownMetric[] {
  if (!one) return [];
  const total = one.platforms.reduce((sum, row) => sum + row.users, 0);
  const label: Record<string, string> = {
    WEB: 'Web',
    IOS: 'iPhone (App Store)',
    ANDROID: 'Android (Play Store)',
  };
  return one.platforms.map((row) => ({
    label: label[row.platform] ?? row.platform,
    value: row.users,
    displayValue: `${formatNumber(row.users)} users`,
    percentage: total > 0 ? (row.users / total) * 100 : undefined,
  }));
}

function buildOneAcquisitionMetrics(one: OneAppSummary | null): BreakdownMetric[] {
  if (!one) return [];
  return one.acquisition.map((row) => ({
    label: row.source === '(direct)' ? 'Direct / untagged' : row.source,
    value: row.users,
    displayValue: `${formatNumber(row.users)} users`,
    detail: row.medium,
  }));
}

/**
 * The four numbers the founder should be able to read in one glance, in the
 * order the question is actually asked: how many people, how many reached the
 * product, how many did the thing, and are we on track.
 */
function buildOneHeadlineMetrics(one: OneAppSummary | null): BreakdownMetric[] {
  if (!one) return [];
  const locationUsers =
    one.capabilities.find((cap) => cap.key === 'location')?.devices ?? 0;
  const activated = one.activation.activatedUsers || one.activation.sharingUsers;

  return [
    {
      label: 'Devices using the One app',
      value: one.rangeTotals.users,
      displayValue: formatNumber(one.rangeTotals.users),
      detail: `over ${one.windowDays} days`,
    },
    {
      label: 'Devices that opened One Location',
      value: locationUsers,
      displayValue: formatNumber(locationUsers),
      detail:
        one.rangeTotals.users > 0
          ? `${formatPercent(locationUsers / one.rangeTotals.users)} of all users`
          : undefined,
    },
    {
      label: 'Devices that actually shared a location',
      value: activated,
      displayValue: formatNumber(activated),
      detail:
        locationUsers > 0
          ? `${formatPercent(activated / locationUsers)} of those who opened it`
          : undefined,
    },
    {
      // Was "Progress to 1.0k". A fixed goal as a headline tile reports the
      // goal on every render and the product on none of them; this answers "is
      // it alive right now", which is the thing a stale dashboard hides.
      label: 'Devices using it in the last 24 hours',
      value: one.last24Hours.users,
      displayValue: formatNumber(one.last24Hours.users),
      detail: one.last24Hours.available
        ? `${formatNumber(one.last24Hours.events)} events`
        : 'no fresh export yet',
    },
  ];
}

function parseStatus(rows: FeedRow[]): FeedStatus | null {
  const statusRows = rows.filter((r) => r.metric_group === 'status');
  if (statusRows.length === 0) return null;

  const get = (name: string) => statusRows.find((r) => r.metric_name === name);

  return {
    sourceEnvironment: get('source_environment')?.metric_string_value ?? '',
    sourceProjectId: get('source_project_id')?.metric_string_value ?? '',
    sourceDataset: get('source_dataset')?.metric_string_value ?? '',
    productionReady: get('production_ready')?.metric_string_value === 'true',
    knownBlockers: get('known_blockers')?.metric_string_value ?? null,
    latestEventAt: get('latest_event_at')?.metric_timestamp ?? null,
    freshnessLagMinutes: get('freshness_lag_minutes') ? metricNumber(get('freshness_lag_minutes')) : null,
    sourceEventRows: metricNumber(get('source_event_rows')),
  };
}

function parseUsageSummary(rows: FeedRow[]): UsageSummary | null {
  const summaryRows = rows.filter((r) => r.metric_group === 'summary');
  if (summaryRows.length === 0) return null;

  const get = (name: string) => summaryRows.find((r) => r.metric_name === name);
  const statusRows = rows.filter((r) => r.metric_group === 'status');
  const getStatus = (name: string) => statusRows.find((r) => r.metric_name === name);

  return {
    dau: metricNumber(get('current_dau')),
    wau: metricNumber(get('current_wau')),
    mau: metricNumber(get('current_mau')),
    dauMauStickiness: metricNumber(get('current_dau_mau_stickiness')),
    sessions: metricNumber(get('current_sessions')),
    totalEvents: metricNumber(get('current_total_events')),
    latestEventAt: getStatus('latest_event_at')?.metric_timestamp ?? null,
    freshnessLagMinutes: getStatus('freshness_lag_minutes') ? metricNumber(getStatus('freshness_lag_minutes')) : null,
    sourceEventRows: metricNumber(getStatus('source_event_rows')),
  };
}

function parseFunnel(rows: FeedRow[], group: string): FunnelStep[] {
  const steps = group === 'investor_funnel'
    ? ['entered', 'auth_completed', 'vault_ready', 'onboarding_completed', 'portfolio_ready', 'activated']
    : ['entered', 'auth_completed', 'profile_submitted', 'request_created', 'workspace_ready', 'activated'];
  const groupRows = latestRowsForGroup(rows, group);
  const byName = new Map(groupRows.map((r) => [r.metric_name, r]));

  return steps.map((step) => ({
    step: formatMetricLabel(step),
    users: metricNumber(byName.get(step)),
  }));
}

function parseDailyUsage(rows: FeedRow[]): DailyActiveUser[] {
  const usageRows = rows.filter(
    (r) => r.metric_group === 'usage' && r.metric_name === 'daily_active_users' && metricDateValue(r),
  );

  const sorted = usageRows
    .sort((a, b) => (metricDateValue(a) ?? '').localeCompare(metricDateValue(b) ?? ''))
    .slice(-7);

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return sorted.map((r) => {
    const d = new Date(`${metricDateValue(r)}T00:00:00Z`);
    return { day: dayNames[d.getUTCDay()], users: metricNumber(r) };
  });
}

function parsePlatformMix(rows: FeedRow[]): BreakdownMetric[] {
  const groupRows = latestRowsForGroup(rows, 'platform_mix');
  const byPlatform = new Map<string, { users: number; events: number }>();

  for (const row of groupRows) {
    const platform = row.dimension_value ?? '(not set)';
    const current = byPlatform.get(platform) ?? { users: 0, events: 0 };
    if (row.metric_name === 'users') current.users = metricNumber(row);
    if (row.metric_name === 'events') current.events = metricNumber(row);
    byPlatform.set(platform, current);
  }

  const totalUsers = Array.from(byPlatform.values()).reduce((sum, item) => sum + item.users, 0);
  const colors = ['#12b5cb', '#1a73e8', '#34a853', '#fbbc04'];

  return Array.from(byPlatform.entries())
    .map(([platform, item], index) => ({
      label: formatMetricLabel(platform),
      value: item.users,
      detail: `${formatNumber(item.events)} events`,
      percentage: totalUsers > 0 ? Math.round((item.users / totalUsers) * 100) : 0,
      color: colors[index % colors.length],
    }))
    .sort((a, b) => b.value - a.value);
}

function parseFeatureEngagement(rows: FeedRow[]): BreakdownMetric[] {
  const byFeature = new Map<string, number>();
  for (const row of rows.filter((r) => r.metric_group === 'feature_engagement')) {
    byFeature.set(row.metric_name, (byFeature.get(row.metric_name) ?? 0) + metricNumber(row));
  }

  return Array.from(byFeature.entries())
    .map(([feature, value]) => ({
      label: formatMetricLabel(feature),
      value,
      detail: 'last 8 feed days',
    }))
    .sort((a, b) => b.value - a.value);
}

function parseInstrumentationHealth(rows: FeedRow[]): BreakdownMetric[] {
  const groupRows = latestRowsForGroup(rows, 'instrumentation_health');
  const get = (name: string) => groupRows.find((r) => r.metric_name === name);

  return [
    'governed_events',
    'missing_event_category_events',
    'missing_app_version_events',
    'missing_journey_events',
    'missing_step_events',
    'missing_entry_surface_events',
    'platforms_seen',
    'streams_seen',
  ].map((name) => metric(formatMetricLabel(name), metricNumber(get(name))));
}

function parseActivationMetrics(rows: FeedRow[]): BreakdownMetric[] {
  return latestRowsForGroup(rows, 'activation').map((row) => {
    const value = metricNumber(row);
    const measured = row.metric_value != null || row.metric_count != null;
    return metric(
      formatMetricLabel(row.metric_name),
      value,
      measured
        ? `${metricDateValue(row) ?? 'latest finalized export'} · trailing 30 days`
        : `${metricDateValue(row) ?? 'latest finalized export'} · no entered-device denominator`,
      measured ? formatPercent(value) : 'Waiting',
    );
  });
}

function parseUsageMetrics(rows: FeedRow[]): BreakdownMetric[] {
  const latestUsageRows = latestRowsForGroup(rows, 'usage');
  const preferredOrder = [
    'daily_active_users',
    'weekly_active_users',
    'monthly_active_users',
    'sessions',
    'total_events',
    'dau_mau_stickiness',
  ];
  const byName = new Map(latestUsageRows.map((row) => [row.metric_name, row]));

  return preferredOrder
    .filter((name) => byName.has(name))
    .map((name) => {
      const row = byName.get(name);
      const value = metricNumber(row);
      return metric(
        formatMetricLabel(name),
        value,
        metricDateValue(row) ?? undefined,
        name.includes('stickiness') ? formatPercent(value) : undefined,
      );
    });
}

function buildKaiEventMetrics(kaiGa4: KaiGa4Summary | null): BreakdownMetric[] {
  return (kaiGa4?.topEvents ?? []).map((row) => metric(
    formatMetricLabel(row.eventName),
    row.events,
    `${formatNumber(row.users)} users`,
  ));
}

function buildKaiGeoMetrics(kaiGa4: KaiGa4Summary | null): BreakdownMetric[] {
  return (kaiGa4?.geo ?? []).map((row) => metric(
    `${row.country || 'Unknown'} · ${formatMetricLabel(row.deviceCategory || 'unknown')}`,
    row.events,
    `${formatNumber(row.users)} users · ${row.platform || 'unknown'}`,
  ));
}

function buildKaiProductionDailyStatus(kaiProduction: KaiProductionSummary | null): KaiDailyStatusPoint[] {
  const byDate = new Map<string, KaiDailyStatusPoint>();
  const ensurePoint = (date: string, label = date.slice(5)) => {
    const current = byDate.get(date) ?? {
      date,
      label,
      users: null,
      sessions: null,
      events: null,
      requests: 0,
      errors: 0,
      errorRate: null,
      p95LatencyMs: null,
      instanceCount: null,
    };
    byDate.set(date, current);
    return current;
  };

  if (kaiProduction?.productionGa4?.available) {
    for (const row of kaiProduction.productionGa4.daily ?? []) {
      const date = String(row.eventDate);
      const point = ensurePoint(date);
      point.users = row.users;
      point.sessions = row.sessions;
      point.events = row.events;
    }
  }

  for (const row of kaiProduction?.gcp?.daily ?? []) {
    const point = ensurePoint(row.date, row.label);
    point.requests = row.requests;
    point.errors = row.errors;
    point.errorRate = row.errorRate;
    point.p95LatencyMs = row.p95LatencyMs;
    point.instanceCount = row.instanceCount;
  }

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function buildKaiUatDailyStatus(rows: FeedRow[], kaiGa4: KaiGa4Summary | null): KaiUatDailyStatusPoint[] {
  const byDate = new Map<string, KaiUatDailyStatusPoint>();
  const rangeStart = kaiGa4?.range?.startDate ?? null;
  const rangeEnd = kaiGa4?.range?.endDate ?? null;
  const inGa4Range = (date: string) => !rangeStart || !rangeEnd || (date >= rangeStart && date <= rangeEnd);
  const ensurePoint = (date: string, label = date.slice(5)) => {
    const current = byDate.get(date) ?? {
      date,
      label,
      ga4Users: null,
      ga4Sessions: null,
      ga4Events: null,
      feedDau: null,
      feedSessions: null,
      feedEvents: null,
    };
    byDate.set(date, current);
    return current;
  };

  if (kaiGa4?.available) {
    for (const row of kaiGa4.daily ?? []) {
      const date = String(row.eventDate);
      const point = ensurePoint(date);
      point.ga4Users = row.users;
      point.ga4Sessions = row.sessions;
      point.ga4Events = row.events;
    }
  }

  for (const row of rows.filter((item) => item.metric_group === 'usage' && metricDateValue(item))) {
    const date = metricDateValue(row);
    if (!date) continue;
    if (!inGa4Range(date)) continue;
    const point = ensurePoint(date);
    if (row.metric_name === 'daily_active_users') point.feedDau = optionalMetricNumber(row);
    if (row.metric_name === 'sessions') point.feedSessions = optionalMetricNumber(row);
    if (row.metric_name === 'total_events') point.feedEvents = optionalMetricNumber(row);
  }

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function buildKaiProductionDailySummaryMetrics(kaiProduction: KaiProductionSummary | null): BreakdownMetric[] {
  const ga4 = kaiProduction?.productionGa4;
  const gcp = kaiProduction?.gcp;
  const ga4Ready = Boolean(ga4?.available);
  const ga4Source = ga4?.sourceLabel ?? 'GA4 export';
  return [
    metric('Production Users', asNumber(ga4?.rangeTotals?.users), ga4Source, ga4Ready ? undefined : 'Waiting'),
    metric('Production Sessions', asNumber(ga4?.rangeTotals?.sessions), ga4Source, ga4Ready ? undefined : 'Waiting'),
    metric('Production Events', asNumber(ga4?.rangeTotals?.events), ga4Source, ga4Ready ? undefined : 'Waiting'),
    metric('Cloud Run Requests', asNumber(gcp?.requestCount), gcp?.serviceName),
    metric('Cloud Run 5xx', asNumber(gcp?.errorCount), gcp?.serviceName),
    metric('Cloud Run Error Rate', asNumber(gcp?.errorRate), gcp?.serviceName, formatPercent(gcp?.errorRate)),
    metric('Cloud Run P95 Latency', asNumber(gcp?.p95LatencyMs), gcp?.serviceName, formatLatency(gcp?.p95LatencyMs)),
  ];
}

/**
 * Operational context for the One readout.
 *
 * The One app is served by the same Cloud Run service as the rest of the web
 * app, so this is the app's availability, not a separate One deployment. It
 * sits at the bottom of the page on purpose: request counts are not people,
 * and putting them near the active-user tiles invites exactly that confusion.
 */
function buildOneHealthMetrics(kaiProduction: KaiProductionSummary | null): BreakdownMetric[] {
  const gcp = kaiProduction?.gcp;
  // No requests at all means the monitoring read failed or the window is empty.
  // Either way it is absence of data, not perfect availability, so report
  // nothing rather than a flattering 100%.
  if (!gcp || asNumber(gcp.requestCount) <= 0) return [];
  const errorRate = asNumber(gcp.errorRate);
  return [
    {
      label: 'Request success rate',
      value: 1 - errorRate,
      displayValue: formatPercent(1 - errorRate, 2),
      detail: `${formatNumber(asNumber(gcp.errorCount))} failed of ${formatNumber(asNumber(gcp.requestCount))}`,
    },
    {
      label: 'P95 latency',
      value: asNumber(gcp.p95LatencyMs),
      displayValue: formatLatency(gcp.p95LatencyMs),
      detail: gcp.serviceName ?? 'Cloud Run',
    },
    {
      label: 'Requests served',
      value: asNumber(gcp.requestCount),
      displayValue: formatNumber(asNumber(gcp.requestCount)),
      // Said out loud, because this is the exact number people mistake for usage.
      detail: 'HTTP requests, not people',
    },
  ];
}

function formatMinutes(minutes: number | null | undefined): string {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes)) return '—';
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m`;
}

function buildKaiUatDailySummaryMetrics(kaiUsage: UsageSummary | null, kaiGa4: KaiGa4Summary | null): BreakdownMetric[] {
  const ga4Ready = Boolean(kaiGa4?.available);
  const ga4Source = kaiGa4?.sourceLabel ?? 'UAT GA4 export';
  return [
    metric('UAT GA4 Users', asNumber(kaiGa4?.rangeTotals?.users), ga4Source, ga4Ready ? undefined : 'Waiting'),
    metric('UAT GA4 Sessions', asNumber(kaiGa4?.rangeTotals?.sessions), ga4Source, ga4Ready ? undefined : 'Waiting'),
    metric('UAT GA4 Events', asNumber(kaiGa4?.rangeTotals?.events), ga4Source, ga4Ready ? undefined : 'Waiting'),
    metric('UAT DB DAU', asNumber(kaiUsage?.dau), 'UAT DB aggregate'),
    metric('UAT DB WAU', asNumber(kaiUsage?.wau), 'UAT DB aggregate'),
    metric('UAT DB Sessions', asNumber(kaiUsage?.sessions), 'UAT DB aggregate'),
    metric('UAT DB Events', asNumber(kaiUsage?.totalEvents), 'UAT DB aggregate'),
    metric('UAT Freshness Lag', asNumber(kaiUsage?.freshnessLagMinutes), 'minutes', formatMinutes(kaiUsage?.freshnessLagMinutes)),
  ];
}

function buildFreshnessFromSourceCards(
  cards: ProductSourceCard[] | undefined,
  fetchedAt: string,
  title: string,
): ProductFreshness | null {
  if (!cards?.length) return null;
  return {
    mode: 'polling',
    refreshIntervalSeconds: 30,
    fetchedAt,
    sources: cards.map((card) => ({
      key: `${title}_${card.key}`,
      label: card.label,
      state: card.status,
      realtimeLevel: card.stateClass ?? card.status,
      generatedAt: card.freshness.generatedAt,
      expectedLagSeconds: card.freshness.expectedLagSeconds,
      detail: card.blocker ?? card.source,
    })),
  };
}

function buildKaiProductionReadinessMetrics(kaiProduction: KaiProductionSummary | null): BreakdownMetric[] {
  const feed = kaiProduction?.productionFeed?.status;
  const ga4 = kaiProduction?.productionGa4;
  return [
    metric('Production Ready', feed?.productionReady ? 1 : 0, 'Production feed', feed?.productionReady ? 'Ready' : 'Waiting'),
    metric('Production Source Rows', asNumber(feed?.sourceEventRows), 'Production feed'),
    metric('Production Freshness Lag', asNumber(feed?.freshnessLagMinutes), 'minutes', feed?.freshnessLagMinutes == null ? '—' : `${feed.freshnessLagMinutes}m`),
    metric('Production GA4 Export', ga4?.available ? 1 : 0, ga4?.sourceLabel ?? 'GA4 export', ga4?.available ? 'Available' : 'Waiting'),
  ];
}

function buildPlatforms(
  kaiFeed: FeedStatus | null,
  kaiUsage: UsageSummary | null,
  kaiProduction: KaiProductionSummary | null,
  hushhAi: HushhAiSummary | null,
  hushhTech: HushhTechMetricsSummary | null,
): PlatformStatus[] {
  const aiGcp = hushhAi?.gcp;
  const aiSearch = hushhAi?.searchConsole;
  const techAuthUsers = hushhTech?.supabase?.metrics.find((row) => row.metricKey === 'auth_users');
  const traffic = verifiedHushhTechTrafficOverview(hushhTech);
  const audience = hushhTech?.audience;
  const search = hushhTech?.searchPerformance;
  // Upstream warnings come first. The product's own statement about its health
  // is more specific than anything inferred from which fields arrived -- and
  // without it, an endpoint returning 503 was being reported on the card as
  // "Search Console coverage waiting", which sent the reader to the wrong
  // system entirely.
  const hushhTechSourceWarnings = [
    ...(hushhTech?.dataQualityWarnings ?? []),
    !hushhTech?.gcp ? 'Cloud Monitoring coverage waiting' : null,
    !search ? 'Search Console coverage waiting' : null,
  ].filter(Boolean).join('; ') || null;
  const kaiProdFeed = kaiProduction?.productionFeed?.status;
  const kaiProdGcp = kaiProduction?.gcp;
  const hushhTechSessions = firstOptionalNumber(audience?.sessions, traffic?.sessions);
  const hushhTechMau = firstOptionalNumber(audience?.mau, traffic?.active28DayUsers);
  const hushhTechVisitors = strongestNumber(techAuthUsers?.value, audience?.mau, traffic?.active28DayUsers, hushhTech?.businessFunnel.overview.persistedUsers);
  const hushhTechAvailable = Boolean(
    hushhTech && (hushhTech.businessFunnel || hushhTech.gcp?.available || hushhTech.traffic?.available || hushhTech.audience || hushhTech.supabase),
  );

  return [
    {
      name: 'hushh.ai',
      url: 'hushh.ai',
      color: '#1a73e8',
      available: Boolean(aiGcp || aiSearch?.available),
      environment: 'production',
      productionReady: Boolean(aiGcp),
      knownBlockers: null,
      visitors: aiGcp ? formatNumber(aiGcp.requestCount) : aiSearch?.available ? formatNumber(aiSearch.clicks) : '—',
      change: aiSearch?.available
        ? `${formatNumber(aiSearch.impressions)} impressions`
        : `${formatNumber(aiGcp?.errorCount ?? 0)} 5xx`,
      avgSession: aiGcp?.p95LatencyMs != null ? `${formatLatency(aiGcp.p95LatencyMs)} p95` : '—',
      bounceRate: formatPercent(aiGcp?.errorRate),
    },
    {
      name: 'one.hushh.ai',
      url: 'one.hushh.ai',
      color: '#12b5cb',
      available: Boolean(kaiProdGcp),
      environment: 'production',
      productionReady: kaiProdFeed?.productionReady ?? false,
      knownBlockers: kaiProdFeed?.knownBlockers ?? null,
      visitors: kaiProdGcp ? formatNumber(kaiProdGcp.requestCount) : '—',
      change: kaiProdGcp ? `${formatNumber(kaiProdGcp.errorCount)} 5xx` : 'Production traffic waiting',
      avgSession: kaiProdGcp?.p95LatencyMs != null ? `${formatLatency(kaiProdGcp.p95LatencyMs)} p95` : '—',
      bounceRate: kaiProdGcp ? formatPercent(kaiProdGcp.errorRate) : '—',
    },
    {
      name: 'uat.one.hushh.ai',
      url: 'uat.one.hushh.ai',
      color: '#34c759',
      available: Boolean(kaiUsage),
      environment: 'uat',
      productionReady: false,
      knownBlockers: kaiFeed?.knownBlockers ?? null,
      visitors: kaiUsage ? formatNumber(kaiUsage.dau) : '—',
      change: kaiUsage ? `${formatNumber(kaiUsage.wau)} WAU` : 'UAT feed waiting',
      avgSession: kaiUsage ? `${formatNumber(kaiUsage.sessions)} sessions` : '—',
      bounceRate: kaiUsage ? `${formatNumber(kaiUsage.sourceEventRows)} feed rows` : '—',
    },
    {
      name: 'hushhtech.com',
      url: 'hushhtech.com',
      color: '#9334e6',
      available: hushhTechAvailable,
      environment: 'production',
      // `businessFunnel` is present even when the upstream could not build it,
      // so its mere existence is not readiness -- that is what let a 503 render
      // as a ready product reporting zero signups.
      productionReady: Boolean(
        hushhTech?.businessFunnel
        && !isHushhTechSourceUnavailable(hushhTech?.businessFunnel?.source)
        && traffic,
      ),
      knownBlockers: hushhTechSourceWarnings ?? hushhTech?.traffic?.note ?? search?.note ?? null,
      visitors: hushhTechVisitors ? formatNumber(hushhTechVisitors) : hushhTechMau ? formatNumber(hushhTechMau) : '—',
      change: !hushhTech
        ? '—'
        : isHushhTechSourceUnavailable(hushhTech.businessFunnel.source)
          ? 'Business summary unavailable'
          : `${formatNumber(hushhTech.businessFunnel.overview.signups)} signups`,
      avgSession: hushhTechSessions != null ? `${formatNumber(hushhTechSessions)} sessions` : 'GA4 traffic waiting',
      bounceRate: formatPercent(traffic?.engagementRate),
    },
  ];
}

function buildKpiStats(
  kaiUsage: UsageSummary | null,
  kaiGa4: KaiGa4Summary | null,
  kaiProduction: KaiProductionSummary | null,
  hushhAi: HushhAiSummary | null,
  hushhTech: HushhTechMetricsSummary | null,
): KpiStat[] {
  const business = hushhTech?.businessFunnel.overview;
  const traffic = verifiedHushhTechTrafficOverview(hushhTech);
  const audience = hushhTech?.audience;
  const search = hushhTech?.searchPerformance?.overview;
  const gcp = hushhTech?.gcp;
  const aiGcp = hushhAi?.gcp;
  const aiSearch = hushhAi?.searchConsole;
  const hushhTechDatabaseMetric = (key: string) => hushhTech?.supabase?.metrics.find((row) => row.metricKey === key);
  const authUsers = hushhTechDatabaseMetric('auth_users');
  const userProfileSync = hushhTechDatabaseMetric('user_profile_sync');
  const kaiTopEvent = kaiGa4?.topEvents?.[0];
  const kaiProdGcp = kaiProduction?.gcp;
  const kaiProdGa4 = kaiProduction?.productionGa4;
  const hushhTechSessions = firstOptionalNumber(audience?.sessions, traffic?.sessions);
  const hushhTechPageViews = firstOptionalNumber(audience?.pageViews, traffic?.screenPageViews);

  return [
    {
      label: 'One Prod Requests',
      value: kaiProdGcp ? formatNumber(kaiProdGcp.requestCount) : '—',
      icon: 'Users',
      change: kaiProdGcp?.p95LatencyMs != null ? `${formatLatency(kaiProdGcp.p95LatencyMs)} p95` : undefined,
    },
    {
      label: 'One Prod GA4 Events',
      value: kaiProdGa4?.available ? formatNumber(kaiProdGa4.rangeTotals?.events ?? 0) : '—',
      icon: 'Activity',
      change: kaiProdGa4?.available ? `${formatNumber(kaiProdGa4.rangeTotals?.users ?? 0)} users` : 'GA4 waiting',
    },
    {
      label: 'One UAT Top Event',
      value: kaiTopEvent ? formatNumber(kaiTopEvent.events) : '—',
      icon: 'BarChart3',
      change: kaiTopEvent ? formatMetricLabel(kaiTopEvent.eventName) : undefined,
    },
    {
      label: 'hushh.ai Requests',
      value: aiGcp ? formatNumber(aiGcp.requestCount) : '—',
      icon: 'Server',
      change: aiGcp?.p95LatencyMs != null ? `${formatLatency(aiGcp.p95LatencyMs)} p95` : undefined,
    },
    {
      label: 'hushhtech.com Users',
      value: authUsers ? formatNumber(authUsers.value) : '—',
      icon: 'ShieldCheck',
      change: userProfileSync ? `${formatNumber(userProfileSync.value)} profile sync` : undefined,
    },
    {
      label: 'hushh.ai Search',
      value: aiSearch?.available ? formatNumber(aiSearch.clicks) : '—',
      icon: 'Search',
      change: aiSearch?.available ? `${formatNumber(aiSearch.impressions)} impressions` : undefined,
    },
    {
      label: 'hushhtech.com Signups',
      value: business ? formatNumber(business.signups) : '—',
      icon: 'MousePointerClick',
      change: business ? `${formatNumber(business.persistedUsers)} persisted` : undefined,
    },
    {
      label: 'hushhtech.com GA4 Sessions',
      value: hushhTech ? (hushhTechSessions != null ? formatNumber(hushhTechSessions) : 'Waiting') : '—',
      icon: 'Globe',
      change: hushhTech ? (hushhTechSessions != null ? `${formatNumber(hushhTechPageViews ?? 0)} page views` : 'GA4 unverified') : undefined,
    },
    {
      label: 'hushhtech.com Requests',
      value: gcp ? formatNumber(gcp.requestCount) : '—',
      icon: 'TrendingUp',
      suffix: gcp?.available ? 'Cloud Run' : 'pending',
    },
    {
      label: 'hushhtech.com Search',
      value: search ? formatNumber(search.clicks) : '—',
      icon: 'MapPin',
      change: search ? `${formatNumber(search.impressions)} impressions` : undefined,
    },
    {
      label: 'One UAT Freshness',
      value: kaiUsage?.freshnessLagMinutes != null
        ? `${Math.floor(kaiUsage.freshnessLagMinutes / 60)}h ${kaiUsage.freshnessLagMinutes % 60}m`
        : '—',
      icon: 'Clock',
      suffix: 'UAT lag',
    },
  ];
}

function buildSourceGroups(
  kaiProduction: KaiProductionSummary | null,
  hushhAi: HushhAiSummary | null,
  hushhTech: HushhTechMetricsSummary | null,
): ProductSourceGroup[] {
  return [
    {
      productKey: 'hushh_ai',
      productName: 'Hushh AI',
      domain: 'hushh.ai',
      primaryEnvironment: 'production',
      sourceCards: hushhAi?.sourceCards ?? [],
    },
    {
      productKey: 'kai_production',
      productName: 'One Production',
      domain: 'one.hushh.ai',
      primaryEnvironment: 'production',
      sourceCards: kaiProduction?.sourceCards ?? [],
    },
    {
      productKey: 'kai_uat',
      productName: 'One UAT',
      domain: 'uat.one.hushh.ai',
      primaryEnvironment: 'uat',
      sourceCards: kaiProduction?.uatSourceCards ?? [],
    },
    {
      productKey: 'hushhtech',
      productName: 'HushhTech',
      domain: 'hushhtech.com',
      primaryEnvironment: 'production',
      sourceCards: hushhTech?.sourceCards ?? [],
    },
  ];
}

function buildTrafficData(
  rows: FeedRow[],
  hushhAi: HushhAiSummary | null,
  hushhTech: HushhTechMetricsSummary | null,
): TrafficPoint[] {
  const byDate = new Map<string, TrafficPoint & { sortKey: string }>();

  const ensurePoint = (date: string) => {
    const label = date.includes('-') ? date.slice(5) : date;
    const current = byDate.get(date) ?? { sortKey: date, time: label, kaiProd: 0, kaiUat: 0, tech: 0, ai: 0 };
    byDate.set(date, current);
    return current;
  };

  for (const row of rows.filter(
    (r) => r.metric_group === 'usage' && r.metric_name === 'total_events' && metricDateValue(r),
  )) {
    const date = metricDateValue(row);
    if (!date) continue;
    const point = ensurePoint(date);
    if (row.source_environment === 'production') {
      point.kaiProd = metricNumber(row);
    } else {
      point.kaiUat = metricNumber(row);
    }
  }

  if (verifiedHushhTechTrafficOverview(hushhTech)) {
    for (const row of hushhTech?.traffic?.series ?? []) {
      const point = ensurePoint(row.date);
      point.tech = firstNumber(row.sessions, row.activeUsers, row.screenPageViews);
    }
  }

  for (const row of hushhAi?.gcp?.series ?? []) {
    if (!row.label) continue;
    const point = ensurePoint(row.label);
    point.ai = row.value;
  }

  return Array.from(byDate.values())
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    .slice(-14)
    .map(({ sortKey: _sortKey, ...point }) => point);
}

function buildHushhAiOpsMetrics(hushhAi: HushhAiSummary | null): BreakdownMetric[] {
  const gcp = hushhAi?.gcp;
  if (!gcp) return [];

  return [
    metric('Cloud Run Requests', gcp.requestCount, gcp.serviceName),
    metric('Cloud Run 5xx', gcp.errorCount, gcp.serviceName),
    metric('Cloud Run 5xx Rate', gcp.errorRate ?? 0, gcp.serviceName, formatPercent(gcp.errorRate)),
    metric('Cloud Run P95 Latency', gcp.p95LatencyMs ?? 0, gcp.serviceName, formatLatency(gcp.p95LatencyMs)),
    metric('Cloud Run Max Instances', gcp.instanceCount ?? 0, gcp.sourceProjectId),
  ];
}

function buildHushhAiSearchMetrics(hushhAi: HushhAiSummary | null): BreakdownMetric[] {
  const search = hushhAi?.searchConsole;
  if (!search) return [];

  return [
    metric('Search Clicks', search.clicks, search.sourceLabel ?? 'Search Console'),
    metric('Search Impressions', search.impressions, search.sourceLabel ?? 'Search Console'),
    metric('Search CTR', search.ctr ?? 0, search.sourceLabel ?? 'Search Console', formatPercent(search.ctr)),
    metric('Search Avg Position', search.averagePosition ?? 0, search.sourceLabel ?? 'Search Console', search.averagePosition?.toFixed(1) ?? '—'),
    ...search.queries.slice(0, 6).map((row) => metric(
      row.query,
      firstNumber(row.clicks, row.impressions),
      `${formatNumber(asNumber(row.impressions))} impressions`,
    )),
  ];
}

function waitingMetric(label: string, detail: string, value: number | null | undefined, displayValue?: string): BreakdownMetric {
  return value == null
    ? metric(label, 0, detail, displayValue ?? 'Waiting')
    : metric(label, value, detail, displayValue);
}

function buildHushhAiEngagementMetrics(hushhAi: HushhAiSummary | null): BreakdownMetric[] {
  const ga4 = hushhAi?.ga4;
  const totals = ga4?.rangeTotals;
  const source = ga4?.sourceLabel ?? 'GA4 Data API';
  if (!ga4) return [];

  return [
    waitingMetric('GA4 Users', source, totals?.users, undefined),
    waitingMetric('GA4 Sessions', 'Visits started on hushh.ai; one user can create multiple sessions.', totals?.sessions),
    waitingMetric('GA4 Events', 'Aggregate tracked interactions such as page views, clicks, and GA4 automatic events.', totals?.events),
    waitingMetric('Engaged Sessions', 'Sessions with meaningful engagement by GA4 rules.', totals?.engagedSessions),
    waitingMetric(
      'Engagement Rate',
      'Share of sessions that were engaged.',
      totals?.engagementRate,
      totals?.engagementRate == null ? undefined : formatPercent(totals.engagementRate),
    ),
    waitingMetric(
      'Avg Session Duration',
      'Average engagement time per session.',
      totals?.averageSessionDuration,
      totals?.averageSessionDuration == null ? undefined : formatDuration(totals.averageSessionDuration),
    ),
  ];
}

function buildHushhAiTopPageMetrics(hushhAi: HushhAiSummary | null): BreakdownMetric[] {
  return (hushhAi?.ga4?.topPages ?? []).slice(0, 8).map((row) => metric(
    row.path || row.title || '(not set)',
    asNumber(row.views),
    `${formatNumber(asNumber(row.users))} users · ${formatNumber(asNumber(row.events))} events`,
  ));
}

function buildHushhAiTopEventMetrics(hushhAi: HushhAiSummary | null): BreakdownMetric[] {
  return (hushhAi?.ga4?.topEvents ?? []).slice(0, 8).map((row) => metric(
    formatMetricLabel(row.eventName),
    row.events,
    `${formatNumber(row.users)} users`,
  ));
}

function buildHushhAiProductEventMetrics(hushhAi: HushhAiSummary | null): BreakdownMetric[] {
  const productEvents = hushhAi?.productEvents && typeof hushhAi.productEvents === 'object'
    ? hushhAi.productEvents as { expectedEvents?: Array<{ label?: string; eventName?: string; status?: string }> }
    : null;
  return (productEvents?.expectedEvents ?? []).map((row) => metric(
    row.label ?? formatMetricLabel(row.eventName ?? 'Product Event'),
    0,
    'Waiting for a real hushh.ai product-event aggregate source',
    row.status === 'not_configured' ? 'Not configured' : 'Waiting',
  ));
}

function buildHushhAiAcquisitionMetrics(hushhAi: HushhAiSummary | null): BreakdownMetric[] {
  const channels = hushhAi?.ga4?.acquisition?.sessionChannels ?? [];
  return channels.slice(0, 8).map((row) => metric(
    row.channel ?? '(not set)',
    asNumber(row.sessions),
    `${formatNumber(asNumber(row.users))} users · ${formatNumber(asNumber(row.engagedSessions))} engaged · ${formatDuration(row.averageSessionDuration)}`,
  ));
}

function buildHushhAiSourceMediumMetrics(hushhAi: HushhAiSummary | null): BreakdownMetric[] {
  const sources = hushhAi?.ga4?.acquisition?.sessionSourceMedium ?? [];
  return sources.slice(0, 8).map((row) => metric(
    row.sourceMedium ?? '(not set)',
    asNumber(row.sessions),
    `${formatNumber(asNumber(row.users))} users · ${formatNumber(asNumber(row.events))} events`,
  ));
}

function buildHushhAiLandingPageMetrics(hushhAi: HushhAiSummary | null): BreakdownMetric[] {
  const landingPages = hushhAi?.ga4?.acquisition?.landingPages ?? [];
  return landingPages.slice(0, 8).map((row) => metric(
    row.landingPage ?? '(not set)',
    asNumber(row.sessions),
    `${row.channel ?? 'Unknown'} · ${formatNumber(asNumber(row.users))} users · ${formatNumber(asNumber(row.events))} events`,
  ));
}

function buildHushhAiGeoDeviceMetrics(hushhAi: HushhAiSummary | null): BreakdownMetric[] {
  const rows = hushhAi?.ga4?.acquisition?.geoDevice ?? [];
  return rows.slice(0, 8).map((row) => metric(
    `${row.country ?? '(not set)'} · ${row.deviceCategory ?? '(not set)'}`,
    asNumber(row.sessions),
    `${formatNumber(asNumber(row.users))} users · ${formatNumber(asNumber(row.engagedSessions))} engaged`,
  ));
}

function buildHushhAiSessionTimingMetrics(hushhAi: HushhAiSummary | null): BreakdownMetric[] {
  const timing = hushhAi?.ga4?.sessionTiming;
  const timezone = timing?.timezoneLabel ?? 'GA4 property timezone';
  return (timing?.topDateHours ?? []).slice(0, 8).map((row) => metric(
    row.label,
    asNumber(row.sessions),
    `${timezone} · ${formatNumber(asNumber(row.engagedSessions))} engaged · ${formatDuration(row.averageSessionDuration)}`,
  ));
}

function emptyDailyPoint(date: string, label = date.slice(5)): HushhAiDailyStatusPoint {
  return {
    date,
    label,
    totalUsers: 0,
    newUsers: 0,
    confirmedUsers: 0,
    activeUsers: 0,
    returningUsers: 0,
    deletedUsers: 0,
    deleteRequests: 0,
    sessionsStarted: 0,
    sessionUsers: 0,
    avgSessionMinutes: 0,
    productActiveUsers: 0,
    analyticsEvents: 0,
    analyticsEventUsers: 0,
    requests: 0,
    errors: 0,
    errorRate: null,
    p95LatencyMs: null,
    instanceCount: null,
  };
}

function buildHushhTechDatabaseMetrics(hushhTech: HushhTechMetricsSummary | null): BreakdownMetric[] {
  return (hushhTech?.supabase?.metrics ?? []).slice(0, 10).map((row) => metric(
    row.label,
    row.value,
    row.detail,
  ));
}

function buildHushhAiDailyStatus(hushhAi: HushhAiSummary | null): HushhAiDailyStatusPoint[] {
  const byDate = new Map<string, HushhAiDailyStatusPoint>();
  const ensurePoint = (date: string, label = date.slice(5)) => {
    const current = byDate.get(date) ?? emptyDailyPoint(date, label);
    byDate.set(date, current);
    return current;
  };

  for (const row of hushhAi?.gcp?.daily ?? []) {
    const point = ensurePoint(row.date, row.label);
    point.requests = row.requests;
    point.errors = row.errors;
    point.errorRate = row.errorRate;
    point.p95LatencyMs = row.p95LatencyMs;
    point.instanceCount = row.instanceCount;
  }

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function buildHushhAiDailySummaryMetrics(hushhAi: HushhAiSummary | null): BreakdownMetric[] {
  const gcp = hushhAi?.gcp;
  if (!gcp) return [];
  return [
    metric('Cloud Run Requests', asNumber(gcp?.requestCount), gcp?.serviceName),
    metric('Cloud Run Error Rate', asNumber(gcp?.errorRate), gcp?.serviceName, formatPercent(gcp?.errorRate)),
    metric('Cloud Run P95 Latency', asNumber(gcp?.p95LatencyMs), gcp?.serviceName, formatLatency(gcp?.p95LatencyMs)),
  ];
}

function buildHushhTechDailyStatus(hushhTech: HushhTechMetricsSummary | null): HushhAiDailyStatusPoint[] {
  const byDate = new Map<string, HushhAiDailyStatusPoint>();
  const ensurePoint = (date: string, label = date.slice(5)) => {
    const current = byDate.get(date) ?? emptyDailyPoint(date, label);
    byDate.set(date, current);
    return current;
  };

  for (const row of hushhTech?.supabase?.daily ?? []) {
    Object.assign(ensurePoint(row.date, row.label), row);
  }

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function buildHushhTechDailySummaryMetrics(hushhTech: HushhTechMetricsSummary | null): BreakdownMetric[] {
  const totals = hushhTech?.supabase?.rangeTotals;
  if (!totals) return [];
  const exitSignals = asNumber(totals.deletedUsers) + asNumber(totals.deleteRequests);
  return [
    metric('Total Users', asNumber(totals.totalUsers), 'hushhtech.com Supabase auth.users at range end'),
    metric('New Users', asNumber(totals.newUsers), 'hushhtech.com auth.users created in range'),
    metric('Active Users', asNumber(totals.activeUsers), 'hushhtech.com distinct last sign-ins in range'),
    metric('Sessions Started', asNumber(totals.sessionsStarted), 'hushhtech.com auth.sessions created in range'),
    metric('Session Users', asNumber(totals.sessionUsers), 'hushhtech.com distinct session users in range'),
    metric('Avg Session Age', asNumber(totals.avgSessionMinutes), 'created_at to refreshed_at', formatDuration(asNumber(totals.avgSessionMinutes) * 60)),
    metric('Exit Signals', exitSignals, 'deleted users + delete requests'),
    metric('Product Active Users', asNumber(totals.productActiveUsers), 'user_product_usage.last_used_at'),
  ];
}

function buildAcquisitionChannels(hushhTech: HushhTechMetricsSummary | null): AcquisitionChannel[] {
  const colors = ['#1a73e8', '#12b5cb', '#9334e6', '#fbbc04', '#34a853'];
  const surfaces = (hushhTech?.search?.bySurface ?? [])
    .map((row) => ({ name: formatMetricLabel(row.surface), count: asNumber(row.searches) }))
    .filter((row) => row.count > 0);
  const sourceRows = surfaces.length > 0
    ? surfaces
    : (hushhTech?.searchPerformance?.devices ?? [])
      .map((row) => ({ name: formatMetricLabel(row.device), count: firstNumber(row.clicks, row.impressions) }))
      .filter((row) => row.count > 0);
  const total = sourceRows.reduce((sum, row) => sum + row.count, 0);

  if (total === 0) return [];
  return sourceRows.slice(0, 5).map((row, index) => ({
    name: row.name,
    value: Math.round((row.count / total) * 100),
    color: colors[index % colors.length],
  }));
}

function buildTopCountries(hushhTech: HushhTechMetricsSummary | null): CountryData[] {
  const countryRows = (hushhTech?.searchPerformance?.countries ?? [])
    .map((row) => ({
      name: row.country.toUpperCase(),
      count: firstNumber(row.clicks, row.impressions),
      detail: firstNumber(row.clicks, row.impressions) === asNumber(row.clicks) ? 'clicks' : 'impressions',
    }))
    .filter((row) => row.count > 0);
  const regionRows = (hushhTech?.searchPerformance?.state?.byRegion ?? [])
    .map((row) => ({
      name: row.state,
      count: firstNumber(row.activeUsers, row.sessions),
      detail: 'users',
    }))
    .filter((row) => row.count > 0);
  const rows = countryRows.length > 0 ? countryRows : regionRows;
  const total = rows.reduce((sum, row) => sum + row.count, 0);

  if (total === 0) return [];
  return rows.slice(0, 5).map((row) => ({
    name: row.name,
    visitors: `${formatNumber(row.count)} ${row.detail}`,
    percentage: Math.round((row.count / total) * 100),
  }));
}

function buildHushhTechAudienceMetrics(hushhTech: HushhTechMetricsSummary | null): BreakdownMetric[] {
  if (!hushhTech) return [];
  const audience = hushhTech.audience;
  const traffic = verifiedHushhTechTrafficOverview(hushhTech);
  const search = hushhTech.search;
  const source = audience?.source ?? (traffic ? hushhTech.traffic.source : 'GA4 traffic unverified');
  const trafficMetric = (label: string, audienceValue: number | null | undefined, trafficValue: number | null | undefined, metricSource = source) => {
    const value = firstOptionalNumber(audienceValue, trafficValue);
    return value == null ? metric(label, 0, metricSource, 'Waiting') : metric(label, value, metricSource);
  };
  const optionalMetric = (label: string, value: number | null | undefined, detail: string) => (
    value == null ? metric(label, 0, detail, 'Waiting') : metric(label, value, detail)
  );

  return [
    trafficMetric('DAU', audience?.dau, traffic?.active1DayUsers),
    trafficMetric('WAU', audience?.wau, traffic?.active7DayUsers),
    trafficMetric('MAU', audience?.mau, traffic?.active28DayUsers),
    trafficMetric('Sessions', audience?.sessions, traffic?.sessions, traffic ? hushhTech.traffic.source : 'GA4 traffic unverified'),
    trafficMetric('Page Views', audience?.pageViews, traffic?.screenPageViews, traffic ? hushhTech.traffic.source : 'GA4 traffic unverified'),
    optionalMetric('Events', audience?.events, audience?.source ?? 'first-party analytics waiting'),
    optionalMetric('Searches', search?.totalSearches, 'first-party safe search events waiting'),
    trafficMetric('Realtime Active', null, traffic?.realtimeActiveUsers, traffic ? 'GA4 realtime' : 'GA4 realtime waiting'),
  ];
}

/**
 * The upstream summary marks a section it could not build with
 * `source: 'unavailable'` and leaves the counts at their zero defaults.
 *
 * Reading those zeros as data is the specific failure this dashboard is meant
 * to prevent: "nobody signed up" and "we could not ask" are opposite facts, and
 * only one of them is a product problem. hushhtech.com's summary endpoint has
 * been returning 503 and the funnel rendered six confident zeros for it.
 */
export function isHushhTechSourceUnavailable(source: string | null | undefined): boolean {
  return String(source ?? '').toLowerCase() === 'unavailable';
}

function buildHushhTechBusinessMetrics(hushhTech: HushhTechMetricsSummary | null): BreakdownMetric[] {
  if (!hushhTech) return [];
  const { overview, conversionRates } = hushhTech.businessFunnel;
  const source = hushhTech.businessFunnel.source;

  // Rows are kept rather than dropped. A vanished section reads as "there is
  // nothing to show here"; a row that says Unavailable reads as "we owe you
  // this number", which is the truth.
  if (isHushhTechSourceUnavailable(source)) {
    const unavailable = (label: string) => ({
      label,
      value: 0,
      displayValue: 'Unavailable',
      detail: 'Business summary endpoint is not responding',
    });
    return [
      unavailable('Signups'),
      unavailable('Persisted Users'),
      unavailable('Onboarding Started'),
      unavailable('Onboarding Completed'),
      unavailable('Profiles Created'),
      unavailable('Profiles Confirmed'),
      unavailable('Signup -> Persisted'),
      unavailable('Onboarding Completion'),
    ];
  }

  return [
    metric('Signups', overview.signups, source),
    metric('Persisted Users', overview.persistedUsers, source),
    metric('Onboarding Started', overview.onboardingStarted, source),
    metric('Onboarding Completed', overview.onboardingCompleted, source),
    metric('Profiles Created', overview.profilesCreated, source),
    metric('Profiles Confirmed', overview.profilesConfirmed, source),
    metric('Signup -> Persisted', asNumber(conversionRates.signupToPersistedUsers), undefined, formatPercent(conversionRates.signupToPersistedUsers)),
    metric('Onboarding Completion', asNumber(conversionRates.onboardingCompletionRate), undefined, formatPercent(conversionRates.onboardingCompletionRate)),
  ];
}

function buildHushhTechOpsMetrics(hushhTech: HushhTechMetricsSummary | null): BreakdownMetric[] {
  if (!hushhTech) return [];
  const gcp = hushhTech.gcp;
  const search = hushhTech.searchPerformance;
  const traffic = verifiedHushhTechTrafficOverview(hushhTech);
  const successRate = gcp?.errorRate != null ? 1 - gcp.errorRate : null;

  return [
    metric('Cloud Run Requests', asNumber(gcp?.requestCount), gcp?.source),
    metric('Cloud Run Success Rate', asNumber(successRate), gcp?.source, formatPercent(successRate)),
    metric('Cloud Run P95 Latency', asNumber(gcp?.p95LatencyMs), gcp?.source, formatLatency(gcp?.p95LatencyMs)),
    metric('Cloud Run Instances', asNumber(gcp?.instanceCount), gcp?.source),
    metric('Search Clicks', asNumber(search?.overview.clicks), search?.source),
    metric('Search Impressions', asNumber(search?.overview.impressions), search?.source),
    metric('Search CTR', asNumber(search?.overview.ctr), search?.source, formatPercent(search?.overview.ctr)),
    metric('Search Avg Position', asNumber(search?.overview.averagePosition), search?.source, search?.overview.averagePosition?.toFixed(1) ?? '—'),
    metric('Avg Session Duration', asNumber(traffic?.averageSessionDuration), traffic ? hushhTech.traffic.source : 'GA4 traffic unverified', traffic ? formatDuration(traffic.averageSessionDuration) : 'Waiting'),
  ];
}

export function buildHushhTechReportTotals(hushhTech: HushhTechMetricsSummary | null): BreakdownMetric[] {
  if (!hushhTech) return [];
  const business = hushhTech.businessFunnel.overview;
  const coverage = hushhTech.dataCoverage ?? {};
  const search = hushhTech.searchPerformance?.overview;
  const legacyUsers = hushhTech.legacy?.overview.usersCreated;
  const supabaseTotals = hushhTech.supabase?.rangeTotals;
  const authUsers = hushhTech.supabase?.metrics.find((row) => row.metricKey === 'auth_users');
  const totalUsers = firstOptionalNumber(
    supabaseTotals?.totalUsers,
    authUsers?.value,
    legacyUsers,
  );
  const windowLabel = `${hushhTech.window.startDate} to ${hushhTech.window.endDate}`;
  const totalUsersDetail = supabaseTotals?.totalUsers != null || authUsers?.value != null
    ? 'hushhtech.com Supabase auth.users at range end'
    : legacyUsers != null
      ? 'all-time user aggregate'
      : 'Registered account total unavailable';
  const businessDisplay = isHushhTechSourceUnavailable(hushhTech.businessFunnel.source) ? 'Unavailable' : undefined;
  const collectedAvailable = !isHushhTechSourceUnavailable(hushhTech.businessFunnel.source);
  const optionalMetric = (label: string, value: number | null | undefined, detail: string) =>
    value == null ? metric(label, 0, detail, 'Unavailable') : metric(label, value, detail);

  return [
    optionalMetric('Total Users', totalUsers, totalUsersDetail),
    metric('Signups', business.signups, windowLabel, businessDisplay),
    metric('Persisted Users', business.persistedUsers, windowLabel, businessDisplay),
    metric('Onboarding Started', business.onboardingStarted, windowLabel, businessDisplay),
    metric('Onboarding Completed', business.onboardingCompleted, windowLabel, businessDisplay),
    metric('Profiles Created', business.profilesCreated, windowLabel, businessDisplay),
    metric('Profiles Confirmed', business.profilesConfirmed, windowLabel, businessDisplay),
    optionalMetric('Cloud Run Requests', hushhTech.gcp?.available ? hushhTech.gcp.requestCount : null, windowLabel),
    optionalMetric('Collected Events', collectedAvailable ? coverage.collectedEvents as number | undefined : null, 'first-party analytics'),
    optionalMetric('Collected Sessions', collectedAvailable ? coverage.collectedSessions as number | undefined : null, 'first-party analytics'),
    optionalMetric('Search Clicks', hushhTech.searchPerformance?.available ? search?.clicks : null, 'Search Console'),
    optionalMetric('Search Impressions', hushhTech.searchPerformance?.available ? search?.impressions : null, 'Search Console'),
    optionalMetric('Supabase Aggregate Tables', hushhTech.supabase ? coverage.supabaseAggregateTables as number | undefined : null, 'public-safe tables'),
  ];
}

export function buildHushhTechSevenDayMetrics(hushhTech: HushhTechMetricsSummary | null): BreakdownMetric[] {
  if (!hushhTech) return [];
  const audience = hushhTech.audience;
  const traffic = verifiedHushhTechTrafficOverview(hushhTech);
  const business = hushhTech.businessFunnel.overview;
  const search = hushhTech.searchPerformance?.overview;
  const source = audience?.source ?? (traffic ? hushhTech.traffic.source : 'GA4 traffic unverified');
  const trafficMetric = (label: string, audienceValue: number | null | undefined, trafficValue: number | null | undefined, metricSource = source) => {
    const value = firstOptionalNumber(audienceValue, trafficValue);
    return value == null ? metric(label, 0, metricSource, 'Waiting') : metric(label, value, metricSource);
  };
  const optionalMetric = (label: string, value: number | null | undefined, detail: string) => (
    value == null ? metric(label, 0, detail, 'Waiting') : metric(label, value, detail)
  );

  return [
    trafficMetric('DAU', audience?.dau, traffic?.active1DayUsers),
    trafficMetric('WAU', audience?.wau, traffic?.active7DayUsers),
    trafficMetric('MAU', audience?.mau, traffic?.active28DayUsers),
    trafficMetric('Sessions', audience?.sessions, traffic?.sessions, traffic ? hushhTech.traffic.source : 'GA4 traffic unverified'),
    trafficMetric('Engaged Sessions', null, traffic?.engagedSessions, traffic ? hushhTech.traffic.source : 'GA4 traffic unverified'),
    trafficMetric('Page Views', audience?.pageViews, traffic?.screenPageViews, traffic ? hushhTech.traffic.source : 'GA4 traffic unverified'),
    trafficMetric('New Users', null, traffic?.newUsers, traffic ? hushhTech.traffic.source : 'GA4 traffic unverified'),
    optionalMetric('Events', audience?.events, audience?.source ?? 'first-party analytics waiting'),
    metric('Signups', business.signups, hushhTech.businessFunnel.source, isHushhTechSourceUnavailable(hushhTech.businessFunnel.source) ? 'Unavailable' : undefined),
    metric('Persisted Users', business.persistedUsers, hushhTech.businessFunnel.source, isHushhTechSourceUnavailable(hushhTech.businessFunnel.source) ? 'Unavailable' : undefined),
    optionalMetric('Cloud Run Requests', hushhTech.gcp?.available ? hushhTech.gcp.requestCount : null, hushhTech.gcp?.source),
    metric('Engagement Rate', asNumber(traffic?.engagementRate), traffic ? hushhTech.traffic.source : 'GA4 traffic unverified', traffic ? formatPercent(traffic.engagementRate) : 'Waiting'),
    metric('Avg Session Duration', asNumber(traffic?.averageSessionDuration), traffic ? hushhTech.traffic.source : 'GA4 traffic unverified', traffic ? formatDuration(traffic.averageSessionDuration) : 'Waiting'),
    metric('Search CTR', asNumber(search?.ctr), 'Search Console', formatPercent(search?.ctr)),
  ];
}

function buildHushhTechCoverageMetrics(hushhTech: HushhTechMetricsSummary | null): BreakdownMetric[] {
  if (!hushhTech) return [];
  const coverage = hushhTech.dataCoverage ?? {};
  const connectedProviders = [
    coverage.firstPartyEventsAvailable,
    coverage.ga4Available,
    coverage.gcpAvailable,
    coverage.searchConsoleAvailable,
    coverage.ga4RegionAvailable,
  ].filter(Boolean).length;

  return [
    metric('Connected Providers', connectedProviders, 'analytics, search, and infra feeds'),
    metric('Collected Events', asNumber(coverage.collectedEvents as number | undefined), 'site_analytics_events'),
    metric('Collected Sessions', asNumber(coverage.collectedSessions as number | undefined), 'site_analytics_sessions'),
    metric('Supabase Aggregate Tables', asNumber(coverage.supabaseAggregateTables as number | undefined), 'public-safe tables'),
    metric('Suppression Threshold', asNumber(coverage.suppressedMinimumCount as number | undefined), 'minimum public count'),
  ];
}

function buildHushhTechActivityMetrics(hushhTech: HushhTechMetricsSummary | null): BreakdownMetric[] {
  if (!hushhTech?.activity) return [];
  const topPages = hushhTech.activity.topPages.map((row) => metric(
    row.path,
    asNumber(row.views),
    'top page',
  ));
  const routeGroups = hushhTech.activity.byRouteGroup.map((row) => metric(
    formatMetricLabel(row.routeGroup),
    asNumber(row.events),
    'route group',
  ));
  const events = hushhTech.activity.byEvent.map((row) => metric(
    formatMetricLabel(row.eventName),
    asNumber(row.events),
    'event',
  ));

  return [...topPages, ...routeGroups, ...events].slice(0, 16);
}

function buildHushhTechFunnelMetrics(hushhTech: HushhTechMetricsSummary | null): BreakdownMetric[] {
  if (!hushhTech?.funnels) return [];
  const metrics: BreakdownMetric[] = [];
  for (const [funnelName, steps] of Object.entries(hushhTech.funnels)) {
    for (const step of steps.slice(0, 4)) {
      metrics.push(metric(
        `${formatMetricLabel(funnelName)} · ${formatMetricLabel(step.step)}`,
        asNumber(step.count),
        step.conversionFromPrevious != null ? `conversion ${formatPercent(step.conversionFromPrevious)}` : step.eventName,
      ));
    }
  }
  for (const [funnelName, steps] of Object.entries(hushhTech.dropoff ?? {})) {
    for (const step of steps.slice(0, 2)) {
      metrics.push(metric(
        `${formatMetricLabel(funnelName)} · ${formatMetricLabel(step.step)} dropoff`,
        asNumber(step.dropoffRate),
        step.eventName,
        formatPercent(step.dropoffRate),
      ));
    }
  }
  return metrics.slice(0, 18);
}

export async function fetchGrowthCompare(): Promise<GrowthCompare | null> {
  const result = await fetchJson<GrowthCompare>(`${API_BASE}/analytics/growth/compare`);
  if (!result || !Array.isArray(result.windows)) return null;
  return result;
}

export async function fetchAllAnalytics(options?: FetchAllAnalyticsOptions): Promise<DashboardData> {
  const result = await fetchJson<AllAnalyticsResponse>(buildAnalyticsUrl(options));

  if (!result) {
    return emptyDashboard('Failed to fetch analytics data. Is the server running?', null);
  }

  return normalizeAnalytics(result);
}

export function normalizeAnalytics(result: AllAnalyticsResponse): DashboardData {
  const uatRows = result.kai.uat.rows ?? [];
  const prodRows = result.kai.production.rows ?? [];
  // Production only.
  //
  // This used to read `uatRows.length > 0 ? uatRows : prodRows`, so every
  // aggregate below -- active users, platform mix, feature engagement,
  // instrumentation health, both funnels -- silently reported UAT whenever UAT
  // had any rows at all, and fell back to production only when it was empty.
  // That is how the overview came to show 1,595 monthly actives beside One's
  // 358, and 41 governed events beside the growth tab's 8,625. The labels
  // never said which environment the reader was looking at.
  const activeRows = prodRows;
  const allKaiRows = [...uatRows, ...prodRows];
  const kaiGa4 = result.kai.ga4?.data ?? null;
  const kaiProduction = result.kai.productionProduct?.data ?? null;
  const hushhAi = result.hushhAi?.data ?? null;
  const hushhTech = result.hushhTech.data;
  const one = result.one?.data?.production ?? null;
  const growth = result.growth?.data ?? null;
  // Computed here rather than server-side because it needs both the org cost
  // roll-up and the One active-user count, and neither query should pay for the
  // other.
  //
  // Agent One's OWN production spend, not the organisation's. The denominator
  // is One's monthly actives, so charging hushh.ai's and the fund's
  // infrastructure to them overstated the figure roughly fourfold -- $910
  // across three products divided by One's 358 people, when One's own
  // production spend is $235.
  //
  // Production only: spend on environments no customer touches is a real
  // problem, but it is not what serving a person costs.
  const monthlyActive = one?.activeUsers?.mau ?? 0;
  const oneProductionCost =
    growth?.cost?.byProduct?.find((entry) => entry.key === 'one')?.production ?? null;
  const costPerActiveUser =
    growth?.cost?.available && monthlyActive > 0 && oneProductionCost !== null
      ? oneProductionCost / monthlyActive
      : null;
  const oneUat = result.one?.data?.uat ?? null;
  const feedWarnings = [
    result.kai.uat.error,
    result.kai.production.error,
    result.kai.ga4?.error,
    result.kai.productionProduct?.error,
    result.hushhAi?.error,
    result.hushhTech.error,
    result.one?.error,
    result.appStoreConnect?.error,
  ].filter((value): value is string => Boolean(value));

  if (activeRows.length === 0 && !hushhTech && !one && !oneUat && !growth && !result.appStoreConnect?.data) {
    return {
      ...emptyDashboard('Analytics feeds are unavailable. Check BigQuery ADC/IAM, the hushhtech.com endpoint, and the Express server logs.', result.fetchedAt),
      feedWarnings,
    };
  }

  const kaiFeed = parseStatus(activeRows);
  const kaiUsage = parseUsageSummary(activeRows);
  const kaiInvestorFunnel = parseFunnel(activeRows, 'investor_funnel');
  const kaiRiaFunnel = parseFunnel(activeRows, 'ria_funnel');
  const kaiDailyUsage = parseDailyUsage(activeRows);
  const kaiActivationMetrics = parseActivationMetrics(activeRows);
  const kaiUsageMetrics = parseUsageMetrics(activeRows);
  const platformMix = parsePlatformMix(activeRows);
  const featureEngagement = parseFeatureEngagement(activeRows);
  const instrumentationHealth = parseInstrumentationHealth(activeRows);

  return {
    loading: false,
    error: null,
    lastUpdated: result.fetchedAt,
    kaiFeed,
    kaiUsage,
    kaiInvestorFunnel,
    kaiRiaFunnel,
    kaiDailyUsage,
    kaiActivationMetrics,
    kaiUsageMetrics,
    kaiEventMetrics: buildKaiEventMetrics(kaiGa4),
    kaiGeoMetrics: buildKaiGeoMetrics(kaiGa4),
    platformMix,
    featureEngagement,
    instrumentationHealth,
    kaiGa4,
    kaiProduction,
    kaiProductionDailyStatus: buildKaiProductionDailyStatus(kaiProduction),
    kaiProductionDailySummaryMetrics: buildKaiProductionDailySummaryMetrics(kaiProduction),
    kaiProductionReadinessMetrics: buildKaiProductionReadinessMetrics(kaiProduction),
    kaiUatFreshness: buildFreshnessFromSourceCards(kaiProduction?.uatSourceCards, result.fetchedAt, 'kai_uat'),
    kaiUatDailyStatus: buildKaiUatDailyStatus(uatRows, kaiGa4),
    kaiUatDailySummaryMetrics: buildKaiUatDailySummaryMetrics(kaiUsage, kaiGa4),
    hushhTech: hushhTech,
    hushhTechAudienceMetrics: buildHushhTechAudienceMetrics(hushhTech),
    hushhTechBusinessMetrics: buildHushhTechBusinessMetrics(hushhTech),
    hushhTechOpsMetrics: buildHushhTechOpsMetrics(hushhTech),
    hushhTechReportTotals: buildHushhTechReportTotals(hushhTech),
    hushhTechSevenDayMetrics: buildHushhTechSevenDayMetrics(hushhTech),
    hushhTechCoverageMetrics: buildHushhTechCoverageMetrics(hushhTech),
    hushhTechActivityMetrics: buildHushhTechActivityMetrics(hushhTech),
    hushhTechFunnelMetrics: buildHushhTechFunnelMetrics(hushhTech),
    hushhTechDatabaseMetrics: buildHushhTechDatabaseMetrics(hushhTech),
    hushhTechDailyStatus: buildHushhTechDailyStatus(hushhTech),
    hushhTechDailySummaryMetrics: buildHushhTechDailySummaryMetrics(hushhTech),
    hushhAi,
    hushhAiOpsMetrics: buildHushhAiOpsMetrics(hushhAi),
    hushhAiSearchMetrics: buildHushhAiSearchMetrics(hushhAi),
    hushhAiEngagementMetrics: buildHushhAiEngagementMetrics(hushhAi),
    hushhAiTopPageMetrics: buildHushhAiTopPageMetrics(hushhAi),
    hushhAiTopEventMetrics: buildHushhAiTopEventMetrics(hushhAi),
    hushhAiProductEventMetrics: buildHushhAiProductEventMetrics(hushhAi),
    hushhAiAcquisitionMetrics: buildHushhAiAcquisitionMetrics(hushhAi),
    hushhAiSourceMediumMetrics: buildHushhAiSourceMediumMetrics(hushhAi),
    hushhAiLandingPageMetrics: buildHushhAiLandingPageMetrics(hushhAi),
    hushhAiGeoDeviceMetrics: buildHushhAiGeoDeviceMetrics(hushhAi),
    hushhAiSessionTimingMetrics: buildHushhAiSessionTimingMetrics(hushhAi),
    hushhAiDailyStatus: buildHushhAiDailyStatus(hushhAi),
    hushhAiDailySummaryMetrics: buildHushhAiDailySummaryMetrics(hushhAi),
    one,
    oneUat,
    oneAgentMetrics: buildOneAgentMetrics(one),
    oneHealthMetrics: buildOneHealthMetrics(kaiProduction),
    growth,
    costPerActiveUser,
    appStoreConnect: result.appStoreConnect?.data ?? null,
    oneLocationFeatureMetrics: buildOneLocationFeatureMetrics(one),
    onePlatformMetrics: buildOnePlatformMetrics(one),
    oneAcquisitionMetrics: buildOneAcquisitionMetrics(one),
    oneHeadlineMetrics: buildOneHeadlineMetrics(one),
    dataQualityWarnings: hushhTech?.dataQualityWarnings ?? [],
    feedWarnings,
    sourceGroups: buildSourceGroups(kaiProduction, hushhAi, hushhTech),
    platforms: buildPlatforms(kaiFeed, kaiUsage, kaiProduction, hushhAi, hushhTech),
    kpiStats: buildKpiStats(kaiUsage, kaiGa4, kaiProduction, hushhAi, hushhTech),
    trafficData: buildTrafficData(allKaiRows, hushhAi, hushhTech),
    acquisitionChannels: buildAcquisitionChannels(hushhTech),
    topCountries: buildTopCountries(hushhTech),
  };
}
