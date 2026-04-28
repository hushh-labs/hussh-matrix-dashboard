/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Client-side analytics service for the Hussh Matrix Dashboard.
 * Fetches modeled aggregate analytics from the Express proxy and normalizes
 * Kai BigQuery rows plus hushhtech.com public metrics into one UI model.
 */

import type {
  FeedRow,
  FeedStatus,
  UsageSummary,
  FunnelStep,
  DailyActiveUser,
  BreakdownMetric,
  HushhTechMetricsSummary,
  PlatformStatus,
  KpiStat,
  TrafficPoint,
  AcquisitionChannel,
  CountryData,
  DashboardData,
} from './types';

const API_BASE = '/api';

interface AllAnalyticsResponse {
  kai: {
    uat: { environment: string; rows: FeedRow[]; error?: string | null };
    production: { environment: string; rows: FeedRow[]; error?: string | null };
  };
  hushhTech: { platform: string; data: HushhTechMetricsSummary | null; error?: string | null };
  fetchedAt: string;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
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

function formatMetricLabel(value: string): string {
  return value
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function metricNumber(row: FeedRow | undefined): number {
  return Number(row?.metric_count ?? row?.metric_value ?? 0) || 0;
}

function latestRowsForGroup(rows: FeedRow[], group: string): FeedRow[] {
  const groupRows = rows.filter((r) => r.metric_group === group && r.metric_date);
  const latestDate = groupRows
    .map((r) => r.metric_date)
    .filter(Boolean)
    .sort()
    .at(-1);

  if (!latestDate) return rows.filter((r) => r.metric_group === group);
  return groupRows.filter((r) => r.metric_date === latestDate);
}

function metric(
  label: string,
  value: number,
  detail?: string,
  displayValue?: string,
): BreakdownMetric {
  return { label, value, detail, displayValue };
}

function booleanMetric(label: string, value: unknown, detail?: string): BreakdownMetric {
  const enabled = value === true;
  return metric(label, enabled ? 1 : 0, detail, enabled ? 'Yes' : 'No');
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
    platformMix: [],
    featureEngagement: [],
    instrumentationHealth: [],
    hushhTech: null,
    hushhTechAudienceMetrics: [],
    hushhTechBusinessMetrics: [],
    hushhTechOpsMetrics: [],
    hushhTechCoverageMetrics: [],
    dataQualityWarnings: [],
    feedWarnings: [],
    platforms: buildPlatforms(null, null, null),
    kpiStats: buildKpiStats(null, null),
    trafficData: [],
    acquisitionChannels: [],
    topCountries: [],
  };
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
    (r) => r.metric_group === 'usage' && r.metric_name === 'daily_active_users' && r.metric_date,
  );

  const sorted = usageRows
    .sort((a, b) => (a.metric_date ?? '').localeCompare(b.metric_date ?? ''))
    .slice(-7);

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return sorted.map((r) => {
    const d = new Date(`${r.metric_date}T00:00:00Z`);
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

function buildPlatforms(
  kaiFeed: FeedStatus | null,
  kaiUsage: UsageSummary | null,
  hushhTech: HushhTechMetricsSummary | null,
): PlatformStatus[] {
  const traffic = hushhTech?.traffic?.overview;
  const audience = hushhTech?.audience;
  const search = hushhTech?.searchPerformance;
  const hushhTechSessions = firstNumber(audience?.sessions, traffic?.sessions);
  const hushhTechMau = firstNumber(audience?.mau, traffic?.active28DayUsers);
  const hushhTechAvailable = Boolean(
    hushhTech && (hushhTech.businessFunnel || hushhTech.gcp?.available || hushhTech.traffic?.available || hushhTech.audience),
  );

  return [
    {
      name: 'hushh.ai',
      url: 'hushh.ai',
      color: '#1a73e8',
      available: kaiFeed?.productionReady ?? false,
      environment: kaiFeed?.sourceEnvironment === 'production' ? 'production' : 'uat',
      productionReady: kaiFeed?.productionReady ?? false,
      knownBlockers: kaiFeed?.knownBlockers ?? 'Production GA4 export not materialized',
      visitors: kaiUsage ? formatNumber(kaiUsage.mau) : '—',
      change: kaiUsage ? `${formatNumber(kaiUsage.totalEvents)} events` : '—',
      avgSession: kaiUsage ? `${formatNumber(kaiUsage.sessions)} sessions` : '—',
      bounceRate: kaiUsage ? `${(kaiUsage.dauMauStickiness * 100).toFixed(1)}% sticky` : '—',
    },
    {
      name: 'kai.hushh.ai',
      url: 'kai.hushh.ai',
      color: '#12b5cb',
      available: (kaiUsage?.dau ?? 0) > 0,
      environment: kaiFeed?.sourceEnvironment === 'production' ? 'production' : 'uat',
      productionReady: kaiFeed?.productionReady ?? false,
      knownBlockers: kaiFeed?.knownBlockers ?? null,
      visitors: kaiUsage ? formatNumber(kaiUsage.dau) : '—',
      change: kaiUsage ? `${formatNumber(kaiUsage.wau)} WAU` : '—',
      avgSession: kaiUsage ? `${formatNumber(kaiUsage.sessions)} sessions` : '—',
      bounceRate: kaiUsage ? `${formatNumber(kaiUsage.sourceEventRows)} rows` : '—',
    },
    {
      name: 'hushhtech.com',
      url: 'hushhtech.com',
      color: '#9334e6',
      available: hushhTechAvailable,
      environment: 'uat',
      productionReady: Boolean(hushhTech?.traffic?.available && search?.available),
      knownBlockers: hushhTech?.dataQualityWarnings?.[0] ?? hushhTech?.traffic?.note ?? search?.note ?? null,
      visitors: hushhTechMau ? formatNumber(hushhTechMau) : '—',
      change: hushhTech ? `${formatNumber(hushhTech.businessFunnel.overview.signups)} signups` : '—',
      avgSession: hushhTechSessions ? `${formatNumber(hushhTechSessions)} sessions` : '—',
      bounceRate: formatPercent(traffic?.engagementRate),
    },
  ];
}

function buildKpiStats(
  kaiUsage: UsageSummary | null,
  hushhTech: HushhTechMetricsSummary | null,
): KpiStat[] {
  const business = hushhTech?.businessFunnel.overview;
  const traffic = hushhTech?.traffic?.overview;
  const audience = hushhTech?.audience;
  const search = hushhTech?.searchPerformance?.overview;
  const gcp = hushhTech?.gcp;
  const hushhTechSessions = firstNumber(audience?.sessions, traffic?.sessions);
  const hushhTechPageViews = firstNumber(audience?.pageViews, traffic?.screenPageViews);

  return [
    {
      label: 'Kai DAU',
      value: kaiUsage ? formatNumber(kaiUsage.dau) : '—',
      icon: 'Users',
      change: kaiUsage ? `WAU ${formatNumber(kaiUsage.wau)}` : undefined,
    },
    {
      label: 'Kai Events',
      value: kaiUsage ? formatNumber(kaiUsage.totalEvents) : '—',
      icon: 'Activity',
      change: kaiUsage ? `${formatNumber(kaiUsage.sourceEventRows)} source rows` : undefined,
    },
    {
      label: 'hushhtech.com Signups',
      value: business ? formatNumber(business.signups) : '—',
      icon: 'MousePointerClick',
      change: business ? `${formatNumber(business.persistedUsers)} persisted` : undefined,
    },
    {
      label: 'hushhtech.com Sessions',
      value: hushhTech ? formatNumber(hushhTechSessions) : '—',
      icon: 'Globe',
      change: hushhTech ? `${formatNumber(hushhTechPageViews)} page views` : undefined,
    },
    {
      label: 'Cloud Run Requests',
      value: gcp ? formatNumber(gcp.requestCount) : '—',
      icon: 'TrendingUp',
      suffix: gcp?.available ? 'requests' : 'unavailable',
    },
    {
      label: 'Search Clicks',
      value: search ? formatNumber(search.clicks) : '—',
      icon: 'MapPin',
      change: search ? `${formatNumber(search.impressions)} impressions` : undefined,
    },
    {
      label: 'Data Freshness',
      value: kaiUsage?.freshnessLagMinutes != null
        ? `${Math.floor(kaiUsage.freshnessLagMinutes / 60)}h ${kaiUsage.freshnessLagMinutes % 60}m`
        : '—',
      icon: 'Clock',
      suffix: 'Kai lag',
    },
  ];
}

function buildTrafficData(rows: FeedRow[], hushhTech: HushhTechMetricsSummary | null): TrafficPoint[] {
  const byDate = new Map<string, TrafficPoint & { sortKey: string }>();

  const ensurePoint = (date: string) => {
    const label = date.includes('-') ? date.slice(5) : date;
    const current = byDate.get(date) ?? { sortKey: date, time: label, kai: 0, tech: 0, ai: 0 };
    byDate.set(date, current);
    return current;
  };

  for (const row of rows.filter(
    (r) => r.metric_group === 'usage' && r.metric_name === 'total_events' && r.metric_date,
  )) {
    const point = ensurePoint(row.metric_date as string);
    if (row.source_environment === 'production') {
      point.ai = metricNumber(row);
    } else {
      point.kai = metricNumber(row);
    }
  }

  for (const row of hushhTech?.traffic?.series ?? []) {
    const point = ensurePoint(row.date);
    point.tech = firstNumber(row.sessions, row.activeUsers, row.screenPageViews);
  }

  return Array.from(byDate.values())
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    .slice(-14)
    .map(({ sortKey: _sortKey, ...point }) => point);
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
  const traffic = hushhTech.traffic.overview;
  const search = hushhTech.search;

  return [
    metric('DAU', firstNumber(audience?.dau, traffic.active1DayUsers), audience?.source ?? hushhTech.traffic.source),
    metric('WAU', firstNumber(audience?.wau, traffic.active7DayUsers), audience?.source ?? hushhTech.traffic.source),
    metric('MAU', firstNumber(audience?.mau, traffic.active28DayUsers), audience?.source ?? hushhTech.traffic.source),
    metric('Sessions', firstNumber(audience?.sessions, traffic.sessions), hushhTech.traffic.source),
    metric('Page Views', firstNumber(audience?.pageViews, traffic.screenPageViews), hushhTech.traffic.source),
    metric('Events', asNumber(audience?.events), audience?.note),
    metric('Searches', asNumber(search?.totalSearches), 'first-party safe search events'),
    metric('Realtime Active', asNumber(traffic.realtimeActiveUsers), hushhTech.traffic.available ? 'GA4 realtime' : hushhTech.traffic.note),
  ];
}

function buildHushhTechBusinessMetrics(hushhTech: HushhTechMetricsSummary | null): BreakdownMetric[] {
  if (!hushhTech) return [];
  const { overview, conversionRates } = hushhTech.businessFunnel;

  return [
    metric('Signups', overview.signups, hushhTech.businessFunnel.source),
    metric('Persisted Users', overview.persistedUsers, hushhTech.businessFunnel.source),
    metric('Onboarding Started', overview.onboardingStarted, hushhTech.businessFunnel.source),
    metric('Onboarding Completed', overview.onboardingCompleted, hushhTech.businessFunnel.source),
    metric('Profiles Created', overview.profilesCreated, hushhTech.businessFunnel.source),
    metric('Profiles Confirmed', overview.profilesConfirmed, hushhTech.businessFunnel.source),
    metric('Signup -> Persisted', asNumber(conversionRates.signupToPersistedUsers), undefined, formatPercent(conversionRates.signupToPersistedUsers)),
    metric('Onboarding Completion', asNumber(conversionRates.onboardingCompletionRate), undefined, formatPercent(conversionRates.onboardingCompletionRate)),
  ];
}

function buildHushhTechOpsMetrics(hushhTech: HushhTechMetricsSummary | null): BreakdownMetric[] {
  if (!hushhTech) return [];
  const gcp = hushhTech.gcp;
  const search = hushhTech.searchPerformance;
  const traffic = hushhTech.traffic.overview;

  return [
    metric('Cloud Run Requests', asNumber(gcp?.requestCount), gcp?.note),
    metric('Cloud Run Error Rate', asNumber(gcp?.errorRate), gcp?.source, formatPercent(gcp?.errorRate)),
    metric('Cloud Run P95 Latency', asNumber(gcp?.p95LatencyMs), gcp?.source, formatLatency(gcp?.p95LatencyMs)),
    metric('Cloud Run Instances', asNumber(gcp?.instanceCount), gcp?.source),
    metric('Search Clicks', asNumber(search?.overview.clicks), search?.source),
    metric('Search Impressions', asNumber(search?.overview.impressions), search?.dataState),
    metric('Search CTR', asNumber(search?.overview.ctr), search?.available ? search.source : search?.note, formatPercent(search?.overview.ctr)),
    metric('Search Avg Position', asNumber(search?.overview.averagePosition), search?.source, search?.overview.averagePosition?.toFixed(1) ?? '—'),
    metric('Avg Session Duration', asNumber(traffic.averageSessionDuration), hushhTech.traffic.source, formatDuration(traffic.averageSessionDuration)),
  ];
}

function buildHushhTechCoverageMetrics(hushhTech: HushhTechMetricsSummary | null): BreakdownMetric[] {
  if (!hushhTech) return [];
  const coverage = hushhTech.dataCoverage ?? {};

  return [
    booleanMetric('First-party Events Available', coverage.firstPartyEventsAvailable),
    metric('Collected Events', asNumber(coverage.collectedEvents as number | undefined), 'site_analytics_events'),
    metric('Collected Sessions', asNumber(coverage.collectedSessions as number | undefined), 'site_analytics_sessions'),
    booleanMetric('GA4 Available', coverage.ga4Available),
    booleanMetric('GCP Available', coverage.gcpAvailable),
    booleanMetric('Search Console Available', coverage.searchConsoleAvailable),
    booleanMetric('GA4 Region Available', coverage.ga4RegionAvailable),
    metric('Supabase Aggregate Tables', asNumber(coverage.supabaseAggregateTables as number | undefined), 'public-safe tables'),
  ];
}

export async function fetchAllAnalytics(): Promise<DashboardData> {
  const result = await fetchJson<AllAnalyticsResponse>(`${API_BASE}/analytics/all`);

  if (!result) {
    return emptyDashboard('Failed to fetch analytics data. Is the server running?', null);
  }

  const uatRows = result.kai.uat.rows ?? [];
  const prodRows = result.kai.production.rows ?? [];
  const activeRows = uatRows.length > 0 ? uatRows : prodRows;
  const hushhTech = result.hushhTech.data;
  const feedWarnings = [
    result.kai.uat.error,
    result.kai.production.error,
    result.hushhTech.error,
  ].filter((value): value is string => Boolean(value));

  if (activeRows.length === 0 && !hushhTech) {
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
    platformMix,
    featureEngagement,
    instrumentationHealth,
    hushhTech: hushhTech,
    hushhTechAudienceMetrics: buildHushhTechAudienceMetrics(hushhTech),
    hushhTechBusinessMetrics: buildHushhTechBusinessMetrics(hushhTech),
    hushhTechOpsMetrics: buildHushhTechOpsMetrics(hushhTech),
    hushhTechCoverageMetrics: buildHushhTechCoverageMetrics(hushhTech),
    dataQualityWarnings: hushhTech?.dataQualityWarnings ?? [],
    feedWarnings,
    platforms: buildPlatforms(kaiFeed, kaiUsage, hushhTech),
    kpiStats: buildKpiStats(kaiUsage, hushhTech),
    trafficData: buildTrafficData(activeRows, hushhTech),
    acquisitionChannels: buildAcquisitionChannels(hushhTech),
    topCountries: buildTopCountries(hushhTech),
  };
}
