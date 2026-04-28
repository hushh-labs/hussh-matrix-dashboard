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
} from './types';

const API_BASE = '/api';

interface AllAnalyticsResponse {
  kai: {
    uat: { environment: string; rows: FeedRow[]; error?: string | null };
    production: { environment: string; rows: FeedRow[]; error?: string | null };
    ga4?: { platform: string; data: KaiGa4Summary | null; error?: string | null };
    productionProduct?: { platform: string; data: KaiProductionSummary | null; error?: string | null };
  };
  hushhAi?: { platform: string; data: HushhAiSummary | null; error?: string | null };
  hushhTech: { platform: string; data: HushhTechMetricsSummary | null; error?: string | null };
  fetchedAt: string;
}

interface FetchAllAnalyticsOptions {
  hushhAiStartDate?: string;
  hushhAiEndDate?: string;
  kaiStartDate?: string;
  kaiEndDate?: string;
}

function buildAnalyticsUrl(options?: FetchAllAnalyticsOptions): string {
  const params = new URLSearchParams();
  if (options?.hushhAiStartDate) params.set('hushh_ai_start_date', options.hushhAiStartDate);
  if (options?.hushhAiEndDate) params.set('hushh_ai_end_date', options.hushhAiEndDate);
  if (options?.kaiStartDate) params.set('kai_start_date', options.kaiStartDate);
  if (options?.kaiEndDate) params.set('kai_end_date', options.kaiEndDate);
  const query = params.toString();
  return `${API_BASE}/analytics/all${query ? `?${query}` : ''}`;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
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

function strongestNumber(...values: Array<number | null | undefined>): number {
  return values.reduce((max, value) => Math.max(max, asNumber(value)), 0);
}

function formatMetricLabel(value: string): string {
  return value
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function metricNumber(row: FeedRow | undefined): number {
  return Number(row?.metric_count ?? row?.metric_value ?? 0) || 0;
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
    hushhTech: null,
    hushhTechAudienceMetrics: [],
    hushhTechBusinessMetrics: [],
    hushhTechOpsMetrics: [],
    hushhTechReportTotals: [],
    hushhTechSevenDayMetrics: [],
    hushhTechCoverageMetrics: [],
    hushhTechActivityMetrics: [],
    hushhTechFunnelMetrics: [],
    hushhAi: null,
    hushhAiOpsMetrics: [],
    hushhAiSearchMetrics: [],
    hushhAiDatabaseMetrics: [],
    hushhAiDailyStatus: [],
    hushhAiDailySummaryMetrics: [],
    dataQualityWarnings: [],
    feedWarnings: [],
    platforms: buildPlatforms(null, null, null, null, null),
    kpiStats: buildKpiStats(null, null, null, null, null),
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
    return metric(formatMetricLabel(row.metric_name), value, metricDateValue(row) ?? undefined, formatPercent(value));
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
      users: 0,
      sessions: 0,
      events: 0,
      requests: 0,
      errors: 0,
      errorRate: null,
      p95LatencyMs: null,
      instanceCount: null,
    };
    byDate.set(date, current);
    return current;
  };

  for (const row of kaiProduction?.productionGa4?.daily ?? []) {
    const date = String(row.eventDate);
    const point = ensurePoint(date);
    point.users = row.users;
    point.sessions = row.sessions;
    point.events = row.events;
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

function buildKaiProductionDailySummaryMetrics(kaiProduction: KaiProductionSummary | null): BreakdownMetric[] {
  const ga4 = kaiProduction?.productionGa4;
  const gcp = kaiProduction?.gcp;
  const ga4Ready = Boolean(ga4?.available);
  return [
    metric('Production Users', asNumber(ga4?.rangeTotals?.users), ga4?.sourceDataset, ga4Ready ? undefined : 'Waiting'),
    metric('Production Sessions', asNumber(ga4?.rangeTotals?.sessions), ga4?.sourceDataset, ga4Ready ? undefined : 'Waiting'),
    metric('Production Events', asNumber(ga4?.rangeTotals?.events), ga4?.sourceDataset, ga4Ready ? undefined : 'Waiting'),
    metric('Cloud Run Requests', asNumber(gcp?.requestCount), gcp?.serviceName),
    metric('Cloud Run Non-2xx', asNumber(gcp?.errorCount), gcp?.serviceName),
    metric('Cloud Run Error Rate', asNumber(gcp?.errorRate), gcp?.serviceName, formatPercent(gcp?.errorRate)),
    metric('Cloud Run P95 Latency', asNumber(gcp?.p95LatencyMs), gcp?.serviceName, formatLatency(gcp?.p95LatencyMs)),
  ];
}

function buildKaiProductionReadinessMetrics(kaiProduction: KaiProductionSummary | null): BreakdownMetric[] {
  const feed = kaiProduction?.productionFeed?.status;
  const ga4 = kaiProduction?.productionGa4;
  const uat = kaiProduction?.uatFeed?.status;
  return [
    metric('Production Ready', feed?.productionReady ? 1 : 0, feed?.sourceDataset, feed?.productionReady ? 'Ready' : 'Waiting'),
    metric('Production Source Rows', asNumber(feed?.sourceEventRows), feed?.sourceProjectId),
    metric('Production Freshness Lag', asNumber(feed?.freshnessLagMinutes), 'minutes', feed?.freshnessLagMinutes == null ? '—' : `${feed.freshnessLagMinutes}m`),
    metric('Production GA4 Export', ga4?.available ? 1 : 0, ga4?.sourceDataset, ga4?.available ? 'Available' : 'Waiting'),
    metric('UAT Validation Rows', asNumber(uat?.sourceEventRows), uat?.sourceDataset),
    metric('UAT Production Ready Flag', uat?.productionReady ? 1 : 0, uat?.sourceDataset, uat?.productionReady ? 'Ready' : 'Validation'),
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
  const aiAuthUsers = hushhAi?.supabase?.metrics.find((row) => row.metricKey === 'auth_users');
  const traffic = hushhTech?.traffic?.overview;
  const audience = hushhTech?.audience;
  const search = hushhTech?.searchPerformance;
  const kaiProdFeed = kaiProduction?.productionFeed?.status;
  const kaiProdGcp = kaiProduction?.gcp;
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
      available: Boolean(aiGcp || aiSearch?.available || aiAuthUsers),
      environment: 'production',
      productionReady: Boolean(aiGcp),
      knownBlockers: null,
      visitors: aiGcp ? formatNumber(aiGcp.requestCount) : aiAuthUsers ? formatNumber(aiAuthUsers.value) : '—',
      change: aiAuthUsers
        ? `${formatNumber(aiAuthUsers.value)} auth users`
        : aiSearch?.available
          ? `${formatNumber(aiSearch.clicks)} search clicks`
          : `${formatNumber(aiGcp?.errorCount ?? 0)} non-2xx`,
      avgSession: aiGcp?.p95LatencyMs != null ? `${formatLatency(aiGcp.p95LatencyMs)} p95` : '—',
      bounceRate: formatPercent(aiGcp?.errorRate),
    },
    {
      name: 'kai.hushh.ai',
      url: 'kai.hushh.ai',
      color: '#12b5cb',
      available: Boolean(kaiProdGcp || (kaiUsage?.dau ?? 0) > 0),
      environment: 'production',
      productionReady: kaiProdFeed?.productionReady ?? false,
      knownBlockers: kaiProdFeed?.knownBlockers ?? kaiFeed?.knownBlockers ?? null,
      visitors: kaiProdGcp ? formatNumber(kaiProdGcp.requestCount) : kaiUsage ? formatNumber(kaiUsage.dau) : '—',
      change: kaiProdGcp ? `${formatNumber(kaiProdGcp.errorCount)} non-2xx` : kaiUsage ? `${formatNumber(kaiUsage.wau)} UAT WAU` : '—',
      avgSession: kaiProdGcp?.p95LatencyMs != null ? `${formatLatency(kaiProdGcp.p95LatencyMs)} p95` : kaiUsage ? `${formatNumber(kaiUsage.sessions)} UAT sessions` : '—',
      bounceRate: kaiProdGcp ? formatPercent(kaiProdGcp.errorRate) : kaiUsage ? `${formatNumber(kaiUsage.sourceEventRows)} UAT rows` : '—',
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
  kaiGa4: KaiGa4Summary | null,
  kaiProduction: KaiProductionSummary | null,
  hushhAi: HushhAiSummary | null,
  hushhTech: HushhTechMetricsSummary | null,
): KpiStat[] {
  const business = hushhTech?.businessFunnel.overview;
  const traffic = hushhTech?.traffic?.overview;
  const audience = hushhTech?.audience;
  const search = hushhTech?.searchPerformance?.overview;
  const gcp = hushhTech?.gcp;
  const aiGcp = hushhAi?.gcp;
  const aiSearch = hushhAi?.searchConsole;
  const aiDatabaseMetric = (key: string) => hushhAi?.supabase?.metrics.find((row) => row.metricKey === key);
  const authUsers = aiDatabaseMetric('auth_users');
  const userProfileSync = aiDatabaseMetric('user_profile_sync');
  const kaiTopEvent = kaiGa4?.topEvents?.[0];
  const kaiProdGcp = kaiProduction?.gcp;
  const kaiProdGa4 = kaiProduction?.productionGa4;
  const hushhTechSessions = firstNumber(audience?.sessions, traffic?.sessions);
  const hushhTechPageViews = firstNumber(audience?.pageViews, traffic?.screenPageViews);

  return [
    {
      label: 'Kai Requests',
      value: kaiProdGcp ? formatNumber(kaiProdGcp.requestCount) : '—',
      icon: 'Users',
      change: kaiProdGcp?.p95LatencyMs != null ? `${formatLatency(kaiProdGcp.p95LatencyMs)} p95` : undefined,
    },
    {
      label: 'Kai Prod Events',
      value: kaiProdGa4?.available ? formatNumber(kaiProdGa4.rangeTotals?.events ?? 0) : '—',
      icon: 'Activity',
      change: kaiProdGa4?.available ? `${formatNumber(kaiProdGa4.rangeTotals?.users ?? 0)} users` : 'GA4 waiting',
    },
    {
      label: 'Kai UAT Top Event',
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
      label: 'Auth Users',
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
      label: 'hushhtech.com Sessions',
      value: hushhTech ? formatNumber(hushhTechSessions) : '—',
      icon: 'Globe',
      change: hushhTech ? `${formatNumber(hushhTechPageViews)} page views` : undefined,
    },
    {
      label: 'Cloud Run Requests',
      value: gcp ? formatNumber(gcp.requestCount) : '—',
      icon: 'TrendingUp',
      suffix: gcp?.available ? 'requests' : 'pending',
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

function buildTrafficData(
  rows: FeedRow[],
  hushhAi: HushhAiSummary | null,
  hushhTech: HushhTechMetricsSummary | null,
): TrafficPoint[] {
  const byDate = new Map<string, TrafficPoint & { sortKey: string }>();

  const ensurePoint = (date: string) => {
    const label = date.includes('-') ? date.slice(5) : date;
    const current = byDate.get(date) ?? { sortKey: date, time: label, kai: 0, tech: 0, ai: 0 };
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
      point.ai = metricNumber(row);
    } else {
      point.kai = metricNumber(row);
    }
  }

  for (const row of hushhTech?.traffic?.series ?? []) {
    const point = ensurePoint(row.date);
    point.tech = firstNumber(row.sessions, row.activeUsers, row.screenPageViews);
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
    metric('Cloud Run Non-2xx', gcp.errorCount, gcp.serviceName),
    metric('Cloud Run Non-2xx Rate', gcp.errorRate ?? 0, gcp.serviceName, formatPercent(gcp.errorRate)),
    metric('Cloud Run P95 Latency', gcp.p95LatencyMs ?? 0, gcp.serviceName, formatLatency(gcp.p95LatencyMs)),
    metric('Cloud Run Max Instances', gcp.instanceCount ?? 0, gcp.sourceProjectId),
  ];
}

function buildHushhAiSearchMetrics(hushhAi: HushhAiSummary | null): BreakdownMetric[] {
  const search = hushhAi?.searchConsole;
  if (!search) return [];

  return [
    metric('Search Clicks', search.clicks, search.sourceDataset),
    metric('Search Impressions', search.impressions, search.sourceDataset),
    metric('Search CTR', search.ctr ?? 0, search.sourceDataset, formatPercent(search.ctr)),
    metric('Search Avg Position', search.averagePosition ?? 0, search.sourceDataset, search.averagePosition?.toFixed(1) ?? '—'),
    ...search.queries.slice(0, 6).map((row) => metric(
      row.query,
      firstNumber(row.clicks, row.impressions),
      `${formatNumber(asNumber(row.impressions))} impressions`,
    )),
  ];
}

function buildHushhAiDatabaseMetrics(hushhAi: HushhAiSummary | null): BreakdownMetric[] {
  return (hushhAi?.supabase?.metrics ?? []).slice(0, 10).map((row) => metric(
    row.label,
    row.value,
    [row.sourceTable, row.detail].filter(Boolean).join(' · '),
  ));
}

function buildHushhAiDailyStatus(hushhAi: HushhAiSummary | null): HushhAiDailyStatusPoint[] {
  const byDate = new Map<string, HushhAiDailyStatusPoint>();
  const ensurePoint = (date: string, label = date.slice(5)) => {
    const current = byDate.get(date) ?? {
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
    byDate.set(date, current);
    return current;
  };

  for (const row of hushhAi?.supabase?.daily ?? []) {
    Object.assign(ensurePoint(row.date, row.label), row);
  }

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
  const totals = hushhAi?.supabase?.rangeTotals;
  const gcp = hushhAi?.gcp;
  if (!totals && !gcp) return [];
  const exitSignals = asNumber(totals?.deletedUsers) + asNumber(totals?.deleteRequests);
  return [
    metric('Total Users', asNumber(totals?.totalUsers), 'auth.users at range end'),
    metric('New Users', asNumber(totals?.newUsers), 'auth.users created in range'),
    metric('Active Users', asNumber(totals?.activeUsers), 'distinct last sign-ins in range'),
    metric('Sessions Started', asNumber(totals?.sessionsStarted), 'auth.sessions created in range'),
    metric('Session Users', asNumber(totals?.sessionUsers), 'distinct session users in range'),
    metric('Avg Session Age', asNumber(totals?.avgSessionMinutes), 'created_at to refreshed_at', formatDuration(asNumber(totals?.avgSessionMinutes) * 60)),
    metric('Exit Signals', exitSignals, 'deleted users + delete requests'),
    metric('Product Active Users', asNumber(totals?.productActiveUsers), 'user_product_usage.last_used_at'),
    metric('Cloud Run Requests', asNumber(gcp?.requestCount), gcp?.serviceName),
    metric('Cloud Run Error Rate', asNumber(gcp?.errorRate), gcp?.serviceName, formatPercent(gcp?.errorRate)),
    metric('Cloud Run P95 Latency', asNumber(gcp?.p95LatencyMs), gcp?.serviceName, formatLatency(gcp?.p95LatencyMs)),
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
  const traffic = hushhTech.traffic.overview;
  const search = hushhTech.search;
  const source = audience?.source ?? hushhTech.traffic.source;

  return [
    metric('DAU', firstNumber(audience?.dau, traffic.active1DayUsers), source),
    metric('WAU', firstNumber(audience?.wau, traffic.active7DayUsers), source),
    metric('MAU', firstNumber(audience?.mau, traffic.active28DayUsers), source),
    metric('Sessions', firstNumber(audience?.sessions, traffic.sessions), hushhTech.traffic.source),
    metric('Page Views', firstNumber(audience?.pageViews, traffic.screenPageViews), hushhTech.traffic.source),
    metric('Events', asNumber(audience?.events), source),
    metric('Searches', asNumber(search?.totalSearches), 'first-party safe search events'),
    metric('Realtime Active', asNumber(traffic.realtimeActiveUsers), 'GA4 realtime'),
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
    metric('Avg Session Duration', asNumber(traffic.averageSessionDuration), hushhTech.traffic.source, formatDuration(traffic.averageSessionDuration)),
  ];
}

function buildHushhTechReportTotals(hushhTech: HushhTechMetricsSummary | null): BreakdownMetric[] {
  if (!hushhTech) return [];
  const business = hushhTech.businessFunnel.overview;
  const traffic = hushhTech.traffic.overview;
  const audience = hushhTech.audience;
  const coverage = hushhTech.dataCoverage ?? {};
  const search = hushhTech.searchPerformance?.overview;
  const legacyUsers = hushhTech.legacy?.overview.usersCreated;
  const totalUsers = strongestNumber(
    legacyUsers,
    business.persistedUsers,
    audience?.mau,
    traffic.active28DayUsers,
  );
  const windowLabel = `${hushhTech.window.startDate} to ${hushhTech.window.endDate}`;
  const totalUsersDetail = asNumber(legacyUsers) > 0 ? 'all-time user aggregate' : `${hushhTech.window.days}d persisted fallback`;

  return [
    metric('Total Users', totalUsers, totalUsersDetail),
    metric('Total Signups', business.signups, windowLabel),
    metric('Persisted Users', business.persistedUsers, windowLabel),
    metric('Onboarding Started', business.onboardingStarted, windowLabel),
    metric('Onboarding Completed', business.onboardingCompleted, windowLabel),
    metric('Profiles Created', business.profilesCreated, windowLabel),
    metric('Profiles Confirmed', business.profilesConfirmed, windowLabel),
    metric('Cloud Run Requests', asNumber(hushhTech.gcp?.requestCount), windowLabel),
    metric('Collected Events', asNumber(coverage.collectedEvents as number | undefined), 'first-party analytics'),
    metric('Collected Sessions', asNumber(coverage.collectedSessions as number | undefined), 'first-party analytics'),
    metric('Search Clicks', asNumber(search?.clicks), 'Search Console'),
    metric('Search Impressions', asNumber(search?.impressions), 'Search Console'),
    metric('Supabase Aggregate Tables', asNumber(coverage.supabaseAggregateTables as number | undefined), 'public-safe tables'),
  ];
}

function buildHushhTechSevenDayMetrics(hushhTech: HushhTechMetricsSummary | null): BreakdownMetric[] {
  if (!hushhTech) return [];
  const audience = hushhTech.audience;
  const traffic = hushhTech.traffic.overview;
  const business = hushhTech.businessFunnel.overview;
  const search = hushhTech.searchPerformance?.overview;
  const source = audience?.source ?? hushhTech.traffic.source;

  return [
    metric('7d DAU', firstNumber(audience?.dau, traffic.active1DayUsers), source),
    metric('7d WAU', firstNumber(audience?.wau, traffic.active7DayUsers), source),
    metric('7d MAU', firstNumber(audience?.mau, traffic.active28DayUsers), source),
    metric('7d Sessions', firstNumber(audience?.sessions, traffic.sessions), hushhTech.traffic.source),
    metric('7d Engaged Sessions', asNumber(traffic.engagedSessions), hushhTech.traffic.source),
    metric('7d Page Views', firstNumber(audience?.pageViews, traffic.screenPageViews), hushhTech.traffic.source),
    metric('7d New Users', asNumber(traffic.newUsers), hushhTech.traffic.source),
    metric('7d Events', asNumber(audience?.events), source),
    metric('7d Signups', business.signups, hushhTech.businessFunnel.source),
    metric('7d Persisted Users', business.persistedUsers, hushhTech.businessFunnel.source),
    metric('7d Cloud Run Requests', asNumber(hushhTech.gcp?.requestCount), hushhTech.gcp?.source),
    metric('Engagement Rate', asNumber(traffic.engagementRate), hushhTech.traffic.source, formatPercent(traffic.engagementRate)),
    metric('Avg Session Duration', asNumber(traffic.averageSessionDuration), hushhTech.traffic.source, formatDuration(traffic.averageSessionDuration)),
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

export async function fetchAllAnalytics(options?: FetchAllAnalyticsOptions): Promise<DashboardData> {
  const result = await fetchJson<AllAnalyticsResponse>(buildAnalyticsUrl(options));

  if (!result) {
    return emptyDashboard('Failed to fetch analytics data. Is the server running?', null);
  }

  const uatRows = result.kai.uat.rows ?? [];
  const prodRows = result.kai.production.rows ?? [];
  const activeRows = uatRows.length > 0 ? uatRows : prodRows;
  const allKaiRows = [...uatRows, ...prodRows];
  const kaiGa4 = result.kai.ga4?.data ?? null;
  const kaiProduction = result.kai.productionProduct?.data ?? null;
  const hushhAi = result.hushhAi?.data ?? null;
  const hushhTech = result.hushhTech.data;
  const feedWarnings = [
    result.kai.uat.error,
    result.kai.production.error,
    result.kai.ga4?.error,
    result.kai.productionProduct?.error,
    result.hushhAi?.error,
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
    hushhTech: hushhTech,
    hushhTechAudienceMetrics: buildHushhTechAudienceMetrics(hushhTech),
    hushhTechBusinessMetrics: buildHushhTechBusinessMetrics(hushhTech),
    hushhTechOpsMetrics: buildHushhTechOpsMetrics(hushhTech),
    hushhTechReportTotals: buildHushhTechReportTotals(hushhTech),
    hushhTechSevenDayMetrics: buildHushhTechSevenDayMetrics(hushhTech),
    hushhTechCoverageMetrics: buildHushhTechCoverageMetrics(hushhTech),
    hushhTechActivityMetrics: buildHushhTechActivityMetrics(hushhTech),
    hushhTechFunnelMetrics: buildHushhTechFunnelMetrics(hushhTech),
    hushhAi,
    hushhAiOpsMetrics: buildHushhAiOpsMetrics(hushhAi),
    hushhAiSearchMetrics: buildHushhAiSearchMetrics(hushhAi),
    hushhAiDatabaseMetrics: buildHushhAiDatabaseMetrics(hushhAi),
    hushhAiDailyStatus: buildHushhAiDailyStatus(hushhAi),
    hushhAiDailySummaryMetrics: buildHushhAiDailySummaryMetrics(hushhAi),
    dataQualityWarnings: hushhTech?.dataQualityWarnings ?? [],
    feedWarnings,
    platforms: buildPlatforms(kaiFeed, kaiUsage, kaiProduction, hushhAi, hushhTech),
    kpiStats: buildKpiStats(kaiUsage, kaiGa4, kaiProduction, hushhAi, hushhTech),
    trafficData: buildTrafficData(allKaiRows, hushhAi, hushhTech),
    acquisitionChannels: buildAcquisitionChannels(hushhTech),
    topCountries: buildTopCountries(hushhTech),
  };
}
