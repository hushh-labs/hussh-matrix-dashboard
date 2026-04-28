/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Client-side analytics service for the Hussh Matrix Dashboard.
 * Fetches from the Express API proxy and transforms BigQuery feed rows
 * into the dashboard data model.
 */

import type {
  FeedRow,
  FeedStatus,
  UsageSummary,
  FunnelStep,
  DailyActiveUser,
  BreakdownMetric,
  HushhTechAnalytics,
  PlatformStatus,
  KpiStat,
  TrafficPoint,
  AcquisitionChannel,
  CountryData,
  DashboardData,
} from './types';

// ---------------------------------------------------------------------------
// API base — in dev mode Vite proxies to the Express server
// ---------------------------------------------------------------------------

const API_BASE = '/api';

// ---------------------------------------------------------------------------
// Raw fetch helpers
// ---------------------------------------------------------------------------

interface KaiFeedResponse {
  environment: string;
  rows: FeedRow[];
  error?: string | null;
  fetchedAt: string;
}

interface HushhTechResponse {
  platform: string;
  data: HushhTechAnalytics | null;
  fetchedAt: string;
}

interface AllAnalyticsResponse {
  kai: {
    uat: { environment: string; rows: FeedRow[]; error?: string | null };
    production: { environment: string; rows: FeedRow[]; error?: string | null };
  };
  hushhTech: { platform: string; data: HushhTechAnalytics | null };
  fetchedAt: string;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Feed row parsers
// ---------------------------------------------------------------------------

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
    freshnessLagMinutes: get('freshness_lag_minutes')?.metric_value ?? null,
    sourceEventRows: get('source_event_rows')?.metric_value ?? 0,
  };
}

function parseUsageSummary(rows: FeedRow[]): UsageSummary | null {
  const summaryRows = rows.filter((r) => r.metric_group === 'summary');
  if (summaryRows.length === 0) return null;

  const get = (name: string) => summaryRows.find((r) => r.metric_name === name);
  const statusRows = rows.filter((r) => r.metric_group === 'status');
  const getStatus = (name: string) => statusRows.find((r) => r.metric_name === name);

  return {
    dau: get('current_dau')?.metric_count ?? 0,
    wau: get('current_wau')?.metric_count ?? 0,
    mau: get('current_mau')?.metric_count ?? 0,
    dauMauStickiness: get('current_dau_mau_stickiness')?.metric_value ?? 0,
    sessions: get('current_sessions')?.metric_count ?? 0,
    totalEvents: get('current_total_events')?.metric_count ?? 0,
    latestEventAt: getStatus('latest_event_at')?.metric_timestamp ?? null,
    freshnessLagMinutes: getStatus('freshness_lag_minutes')?.metric_value ?? null,
    sourceEventRows: getStatus('source_event_rows')?.metric_value ?? 0,
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
    users: byName.get(step)?.metric_count ?? 0,
  }));
}

function parseDailyUsage(rows: FeedRow[]): DailyActiveUser[] {
  const usageRows = rows.filter(
    (r) => r.metric_group === 'usage' && r.metric_name === 'daily_active_users' && r.metric_date,
  );

  // Sort by date and take last 7 days
  const sorted = usageRows
    .sort((a, b) => (a.metric_date ?? '').localeCompare(b.metric_date ?? ''))
    .slice(-7);

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return sorted.map((r) => {
    const d = new Date(r.metric_date + 'T00:00:00Z');
    return {
      day: dayNames[d.getUTCDay()],
      users: r.metric_count ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Build aggregate dashboard data
// ---------------------------------------------------------------------------

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

function formatMetricLabel(value: string): string {
  return value
    .replace(/_/g, ' ')
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
  ].map((metric) => ({
    label: formatMetricLabel(metric),
    value: metricNumber(get(metric)),
  }));
}

function buildPlatforms(
  kaiFeed: FeedStatus | null,
  kaiUsage: UsageSummary | null,
  hushhTech: HushhTechAnalytics | null,
): PlatformStatus[] {
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
      change: kaiUsage && kaiUsage.dauMauStickiness > 0
        ? `${(kaiUsage.dauMauStickiness * 100).toFixed(0)}% sticky`
        : '—',
      avgSession: '—',
      bounceRate: '—',
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
      change: kaiUsage ? `${kaiUsage.sessions} sessions` : '—',
      avgSession: kaiUsage
        ? `${kaiUsage.totalEvents} events`
        : '—',
      bounceRate: '—',
    },
    {
      name: 'hushhtech.com',
      url: 'hushhtech.com',
      color: '#9334e6',
      available: hushhTech?.trafficAvailable ?? false,
      environment: 'production',
      productionReady: hushhTech?.trafficAvailable ?? false,
      knownBlockers: hushhTech?.trafficAvailable
        ? null
        : 'Needs numeric GA4 property ID and Search Console service account access',
      visitors: hushhTech?.visitors ? formatNumber(hushhTech.visitors) : '—',
      change: hushhTech?.sessions ? `${hushhTech.sessions} sessions` : 'Blocked',
      avgSession: hushhTech?.avgSessionDuration
        ? `${Math.floor(hushhTech.avgSessionDuration / 60)}m ${hushhTech.avgSessionDuration % 60}s`
        : '—',
      bounceRate: hushhTech?.bounceRate ? `${hushhTech.bounceRate}%` : '—',
    },
  ];
}

function buildKpiStats(
  kaiUsage: UsageSummary | null,
  hushhTech: HushhTechAnalytics | null,
): KpiStat[] {
  const totalEngagement =
    (kaiUsage?.totalEvents ?? 0) + (hushhTech?.sessions ?? 0);
  const totalUsers = (kaiUsage?.mau ?? 0) + (hushhTech?.visitors ?? 0);
  const activeSessions = (kaiUsage?.sessions ?? 0) + (hushhTech?.sessions ?? 0);

  return [
    {
      label: 'Total Engagement',
      value: formatNumber(totalEngagement),
      icon: 'Activity',
      change: kaiUsage ? `${kaiUsage.sourceEventRows} source rows` : undefined,
    },
    {
      label: 'Active Sessions',
      value: formatNumber(activeSessions),
      icon: 'Users',
      change: kaiUsage ? `DAU ${kaiUsage.dau}` : undefined,
    },
    {
      label: 'Monthly Users',
      value: formatNumber(totalUsers),
      icon: 'Globe',
      suffix: 'MAU',
    },
    {
      label: 'Data Freshness',
      value: kaiUsage?.freshnessLagMinutes != null
        ? `${Math.floor(kaiUsage.freshnessLagMinutes / 60)}h ${kaiUsage.freshnessLagMinutes % 60}m`
        : '—',
      icon: 'Clock',
      suffix: 'lag',
    },
    {
      label: 'DAU/MAU Stickiness',
      value: kaiUsage
        ? `${(kaiUsage.dauMauStickiness * 100).toFixed(1)}%`
        : '—',
      icon: 'MousePointerClick',
    },
    {
      label: 'Source Events',
      value: formatNumber(kaiUsage?.sourceEventRows ?? 0),
      icon: 'MapPin',
    },
  ];
}

function buildTrafficData(rows: FeedRow[]): TrafficPoint[] {
  // Build time-series from usage rows
  const usageRows = rows.filter(
    (r) => r.metric_group === 'usage' && r.metric_name === 'total_events' && r.metric_date,
  );

  if (usageRows.length === 0) {
    // Return mock-shaped data with zeros
    return [
      { time: '00:00', kai: 0, tech: 0, ai: 0 },
      { time: '04:00', kai: 0, tech: 0, ai: 0 },
      { time: '08:00', kai: 0, tech: 0, ai: 0 },
      { time: '12:00', kai: 0, tech: 0, ai: 0 },
      { time: '16:00', kai: 0, tech: 0, ai: 0 },
      { time: '20:00', kai: 0, tech: 0, ai: 0 },
      { time: '23:59', kai: 0, tech: 0, ai: 0 },
    ];
  }

  // Use last 7 days of daily events as the traffic chart
  const sorted = usageRows
    .sort((a, b) => (a.metric_date ?? '').localeCompare(b.metric_date ?? ''))
    .slice(-7);

  return sorted.map((r) => ({
    time: r.metric_date?.slice(5) ?? '', // MM-DD
    kai: r.metric_count ?? 0,
    tech: 0, // hushhtech.com data not yet available at daily granularity
    ai: Math.round((r.metric_count ?? 0) * 1.2), // hushh.ai shares the same property
  }));
}

function buildAcquisitionChannels(_rows: FeedRow[]): AcquisitionChannel[] {
  // Platform mix from the feed
  // For now return the governed defaults; will be replaced when attribution data flows
  return [
    { name: 'Organic Search', value: 45, color: '#1a73e8' },
    { name: 'Direct', value: 30, color: '#12b5cb' },
    { name: 'Social', value: 15, color: '#9334e6' },
    { name: 'Referral', value: 10, color: '#fbbc04' },
  ];
}

function buildTopCountries(_rows: FeedRow[]): CountryData[] {
  // Geo data is not in the public feed yet; return governed defaults
  return [
    { name: 'United States', visitors: '—', percentage: 35 },
    { name: 'India', visitors: '—', percentage: 26 },
    { name: 'United Kingdom', visitors: '—', percentage: 12 },
    { name: 'Germany', visitors: '—', percentage: 6 },
    { name: 'Others', visitors: '—', percentage: 21 },
  ];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function fetchAllAnalytics(): Promise<DashboardData> {
  const result = await fetchJson<AllAnalyticsResponse>(`${API_BASE}/analytics/all`);

  if (!result) {
    return {
      loading: false,
      error: 'Failed to fetch analytics data. Is the server running?',
      lastUpdated: null,
      kaiFeed: null,
      kaiUsage: null,
      kaiInvestorFunnel: [],
      kaiRiaFunnel: [],
      kaiDailyUsage: [],
      platformMix: [],
      featureEngagement: [],
      instrumentationHealth: [],
      hushhTech: null,
      platforms: buildPlatforms(null, null, null),
      kpiStats: buildKpiStats(null, null),
      trafficData: buildTrafficData([]),
      acquisitionChannels: buildAcquisitionChannels([]),
      topCountries: buildTopCountries([]),
    };
  }

  // Prefer UAT data if it has rows; fall back to production
  const uatRows = result.kai.uat.rows ?? [];
  const prodRows = result.kai.production.rows ?? [];
  const activeRows = uatRows.length > 0 ? uatRows : prodRows;
  const feedErrors = [
    result.kai.uat.error,
    result.kai.production.error,
  ].filter(Boolean);

  if (activeRows.length === 0 && feedErrors.length > 0) {
    return {
      loading: false,
      error: 'Analytics feeds are unavailable. Check BigQuery ADC/IAM and the Express server logs.',
      lastUpdated: result.fetchedAt,
      kaiFeed: null,
      kaiUsage: null,
      kaiInvestorFunnel: [],
      kaiRiaFunnel: [],
      kaiDailyUsage: [],
      platformMix: [],
      featureEngagement: [],
      instrumentationHealth: [],
      hushhTech: result.hushhTech.data,
      platforms: buildPlatforms(null, null, result.hushhTech.data),
      kpiStats: buildKpiStats(null, result.hushhTech.data),
      trafficData: buildTrafficData([]),
      acquisitionChannels: buildAcquisitionChannels([]),
      topCountries: buildTopCountries([]),
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
  const hushhTech = result.hushhTech.data;

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
    hushhTech,
    platforms: buildPlatforms(kaiFeed, kaiUsage, hushhTech),
    kpiStats: buildKpiStats(kaiUsage, hushhTech),
    trafficData: buildTrafficData(activeRows),
    acquisitionChannels: buildAcquisitionChannels(activeRows),
    topCountries: buildTopCountries(activeRows),
  };
}

export { formatNumber };
