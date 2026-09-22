import HusshInsightsAgent from './components/HusshInsightsAgent';
import { motion } from 'motion/react';
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Clock,
  ExternalLink,
  Globe,
  Loader2,
  MapPin,
  MousePointerClick,
  Pause,
  Play,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  TrendingUp,
  Users,
  X,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { fetchAllAnalytics, fetchGrowthCompare, formatNumber } from './lib/analytics-service';
import {
  locationAnalyticsPath,
  parseLocationAnalyticsPath,
  type LocationAnalyticsRoute,
} from './lib/location-analytics-route';
import { cn } from './lib/utils';
import type {
  GrowthCompare,
  BreakdownMetric,
  DashboardData,
  FunnelStep,
  HushhAiDailyStatusPoint,
  HushhAiFreshness,
  HushhAiFreshnessSource,
  KaiDailyStatusPoint,
  KaiUatDailyStatusPoint,
  KpiStat,
  PlatformStatus,
  ProductSourceCard,
  ProductSourceCardMetric,
  ProductSourceCardSection,
  ProductSourceGroup,
  ProductSourceStatus,
} from './lib/types';

const iconMap: Record<string, typeof Activity> = {
  Activity,
  BarChart3,
  Clock,
  Globe,
  MapPin,
  MousePointerClick,
  Search,
  Server,
  ShieldCheck,
  TrendingUp,
  Users,
};

import { appleCard, applePanel, appleLabel, dashboardBand } from './lib/theme';
import { ComparePanel } from './components/ComparePanel';
import { GrowthPanel } from './components/GrowthPanel';
import { OneAppPanel } from './components/OneAppPanel';
import { AppsPanel } from './components/AppsPanel';
const formatAxisValue = (value: number) => (value >= 1000 ? `${value / 1000}k` : `${value}`);
const oneDayMs = 86_400_000;

type DatePreset = 7 | 14 | 30 | 90;
type DashboardTab = 'growth' | 'compare' | 'one' | 'apps' | 'overview' | 'platforms';

const dashboardTabs: DashboardTab[] = ['growth', 'compare', 'one', 'apps', 'overview', 'platforms'];

function isDashboardTab(value: unknown): value is DashboardTab {
  return typeof value === 'string' && dashboardTabs.includes(value as DashboardTab);
}

interface HushhAiDateRangeState {
  preset: DatePreset | 'custom';
  startDate: string;
  endDate: string;
}

interface DetailRow {
  label: string;
  value: string;
  detail?: string;
  meta?: string;
}

interface DetailSection {
  title: string;
  subtitle?: string;
  rows: DetailRow[];
}

interface MetricDetailState {
  title: string;
  subtitle: string;
  badge?: string;
  summary?: DetailRow[];
  sections: DetailSection[];
  caveats?: string[];
}

interface SourceMetricClickPayload {
  productKey: string;
  card: ProductSourceCard;
  section?: ProductSourceCardSection;
  metric: ProductSourceCardMetric;
}

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function rangeForPreset(days: DatePreset): HushhAiDateRangeState {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end.getTime() - (days - 1) * oneDayMs);
  return { preset: days, startDate: toDateInputValue(start), endDate: toDateInputValue(end) };
}

function normalizeCustomRange(range: HushhAiDateRangeState): HushhAiDateRangeState {
  const start = new Date(`${range.startDate}T00:00:00Z`);
  const end = new Date(`${range.endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return rangeForPreset(7);
  const orderedStart = start <= end ? start : end;
  const orderedEnd = start <= end ? end : start;
  const limitedStart = orderedEnd.getTime() - orderedStart.getTime() > 89 * oneDayMs
    ? new Date(orderedEnd.getTime() - 89 * oneDayMs)
    : orderedStart;
  return {
    preset: range.preset,
    startDate: toDateInputValue(limitedStart),
    endDate: toDateInputValue(orderedEnd),
  };
}

function formatDurationFromMinutes(minutes: number | null | undefined): string {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes)) return '—';
  if (minutes < 1) return `${Math.round(minutes * 60)}s`;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = Math.round(minutes % 60);
  return `${hours}h ${remainder}m`;
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatAge(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ago`;
}

function freshnessLabel(source: HushhAiFreshnessSource): string {
  if (source.state === 'live') return 'Live';
  if (source.state === 'near_live') return 'Near-live';
  if (source.state === 'delayed') return 'Delayed';
  if (source.state === 'waiting') return 'Waiting';
  if (source.state === 'collecting_not_ingested') return 'Collecting';
  return 'Unavailable';
}

function freshnessClass(source: HushhAiFreshnessSource): string {
  if (source.state === 'live') return 'border border-[#1f7a36]/15 bg-[#ecfdf3]/80 text-[#1f7a36]';
  if (source.state === 'near_live') return 'border border-[#005eb8]/15 bg-[#e8f2ff]/80 text-[#005eb8]';
  if (source.state === 'collecting_not_ingested') return 'border border-[#6d38a8]/15 bg-[#f4edff]/80 text-[#6d38a8]';
  if (source.state === 'delayed' || source.state === 'waiting') return 'border border-[#9a5b00]/15 bg-[#fff7e6]/80 text-[#9a5b00]';
  return 'border border-black/[0.06] bg-[#f5f5f7] text-[#6e6e73]';
}

function sourceStatusLabel(status: string, sourceKey?: string): string {
  if (status === 'live') return 'Live';
  if (status === 'near_live') return 'Near-live';
  if (sourceKey === 'search_console' && status === 'delayed') return 'Daily';
  if (status === 'delayed') return 'Delayed';
  if (status === 'waiting') return 'Waiting';
  if (status === 'not_configured') return 'Not configured';
  if (status === 'collecting_not_ingested') return 'Collecting';
  return 'Unavailable';
}

function sourceStatusClass(status: string): string {
  if (status === 'live' || status === 'near_live') return 'border border-[#1f7a36]/15 bg-[#ecfdf3]/80 text-[#1f7a36]';
  if (status === 'delayed') return 'border border-[#005eb8]/15 bg-[#e8f2ff]/80 text-[#005eb8]';
  if (status === 'collecting_not_ingested') return 'border border-[#6d38a8]/15 bg-[#f4edff]/80 text-[#6d38a8]';
  if (status === 'waiting' || status === 'not_configured') return 'border border-[#9a5b00]/15 bg-[#fff7e6]/80 text-[#9a5b00]';
  return 'border border-black/[0.06] bg-[#f5f5f7] text-[#6e6e73]';
}

function formatOptionalNumber(value: number | null | undefined, fallback = '—'): string {
  return typeof value === 'number' && Number.isFinite(value) ? formatNumber(value) : fallback;
}

function formatOptionalPercent(value: number | null | undefined, decimals = 1): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(decimals)}%` : '—';
}

function formatDurationFromSeconds(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '—';
  const rounded = Math.round(seconds);
  if (rounded < 60) return `${rounded}s`;
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (minutes < 60) return `${minutes}m ${remainder}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatSourceMetricValue(status: ProductSourceStatus | undefined, value: number | null, displayValue?: string): string {
  if (displayValue) return displayValue;
  if (value == null) return status === 'waiting' || status === 'not_configured' ? 'Waiting' : '—';
  return formatNumber(value);
}

function eventDescription(eventName: string): string {
  const normalized = eventName.toLowerCase();
  if (normalized === 'page_view') return 'GA4 page-view event fired when a page/screen is viewed.';
  if (normalized === 'session_start') return 'GA4 automatic event fired when a new session starts.';
  if (normalized === 'first_visit') return 'GA4 automatic event fired for a first-time visitor/device.';
  if (['fcp', 'lcp', 'cls', 'inp', 'ttfb'].includes(normalized)) {
    return 'Web-vitals performance telemetry, not a product conversion event.';
  }
  return 'GA4 aggregate event. Product meaning depends on site instrumentation.';
}

function readableMetricLabel(value: string): string {
  return value
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function safeUrlLabel(value: string): string {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return value.split('?')[0].split('#')[0];
  }
}

function detailRow(label: string, value: string, detail?: string, meta?: string): DetailRow {
  return { label, value, detail, meta };
}

function metricRows(items: BreakdownMetric[], limit = 24): DetailRow[] {
  return items.slice(0, limit).map((item) => detailRow(
    item.label,
    item.displayValue ?? formatNumber(item.value),
    item.detail,
    item.percentage == null ? undefined : `${item.percentage}%`,
  ));
}

function focusMetricSummary(items: BreakdownMetric[], focus?: BreakdownMetric, limit = 4): DetailRow[] {
  const rows = metricRows(items);
  if (!focus) return rows.slice(0, limit);
  return [
    detailRow('Clicked Metric', focus.displayValue ?? formatNumber(focus.value), focus.detail, focus.label),
    ...rows.filter((row) => row.label !== focus.label).slice(0, Math.max(0, limit - 1)),
  ];
}

function kaiProductionDailyRows(rows: KaiDailyStatusPoint[]): DetailRow[] {
  return rows.map((row) => detailRow(
    row.date,
    `${formatNumber(row.requests)} requests`,
    `${formatNumber(row.errors)} 5xx · ${row.errorRate == null ? '—' : `${(row.errorRate * 100).toFixed(3)}%`} error rate · ${row.p95LatencyMs == null ? '—' : `${Math.round(row.p95LatencyMs)}ms`} p95`,
    `GA4 users/sessions/events: ${formatOptionalNumber(row.users, 'Waiting')} / ${formatOptionalNumber(row.sessions, 'Waiting')} / ${formatOptionalNumber(row.events, 'Waiting')}`,
  ));
}


function hushhTechDailyRows(rows: HushhAiDailyStatusPoint[]): DetailRow[] {
  return rows.map((row) => detailRow(
    row.date,
    `${formatNumber(row.totalUsers)} total users`,
    `${formatNumber(row.newUsers)} new · ${formatNumber(row.activeUsers)} active · ${formatNumber(row.sessionsStarted)} sessions`,
    `${formatNumber(row.deletedUsers + row.deleteRequests)} exit signals`,
  ));
}

function sourceCardRows(card: ProductSourceCard): DetailRow[] {
  const topRows = card.metrics.map((metricItem) => detailRow(
    metricItem.label,
    formatSourceMetricValue(card.status, metricItem.value, metricItem.displayValue),
    card.source,
    metricItem.key,
  ));
  const sectionRows = (card.sections ?? []).flatMap((section) => section.metrics.map((metricItem) => detailRow(
    `${section.label} · ${metricItem.label}`,
    formatSourceMetricValue(section.status ?? card.status, metricItem.value, metricItem.displayValue),
    section.source ?? card.source,
    metricItem.key,
  )));
  return [...topRows, ...sectionRows];
}

function sourceCardSections(cards: ProductSourceCard[] | undefined, titlePrefix = 'Source'): DetailSection[] {
  return (cards ?? []).map((card) => ({
    title: `${titlePrefix}: ${card.label}`,
    subtitle: `${card.source} · ${sourceStatusLabel(card.status, card.key)} · refreshed ${formatAge(card.freshness.generatedAt)}`,
    rows: sourceCardRows(card),
  })).filter((section) => section.rows.length > 0);
}

function sourceCardDetail(payload: SourceMetricClickPayload): MetricDetailState {
  const { productKey, card, section, metric } = payload;
  const productLabel = productKey === 'kai_production'
    ? 'One Production'
    : productKey === 'kai_uat'
      ? 'One UAT'
      : productKey === 'hushhtech'
        ? 'HushhTech'
        : 'Hushh AI';
  const metricStatus = section?.status ?? card.status;
  return {
    title: `${productLabel} · ${section?.label ?? card.label} · ${metric.label}`,
    subtitle: `${card.label} aggregate detail from ${section?.source ?? card.source}.`,
    badge: sourceStatusLabel(metricStatus, card.key),
    summary: [
      detailRow('Clicked Metric', formatSourceMetricValue(metricStatus, metric.value, metric.displayValue), metric.key),
      detailRow('Source', section?.source ?? card.source),
      detailRow('Status', sourceStatusLabel(metricStatus, card.key)),
      detailRow('Freshness', formatAge(section?.freshness?.generatedAt ?? card.freshness.generatedAt)),
    ],
    sections: [
      {
        title: 'All Metrics In This Source',
        subtitle: card.blocker ?? section?.blocker ?? 'Aggregate-only values shown by this source card.',
        rows: sourceCardRows(card),
      },
    ],
    caveats: [
      'Aggregate-only source detail; raw user identities, emails, prompts, and person-level rows are not exposed.',
      card.blocker ?? section?.blocker ?? `${card.label} is ${sourceStatusLabel(card.status, card.key).toLowerCase()}.`,
    ],
  };
}

function DetailActionButton({ label = 'Details', onClick }: { label?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full bg-[#f5f5f7] px-3 py-1.5 text-xs font-bold text-[#007aff] transition hover:bg-[#e8f2ff] focus:outline-none focus:ring-2 focus:ring-[#007aff]/35"
    >
      {label}
    </button>
  );
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-black/10 bg-white/95 p-3 text-sm shadow-xl backdrop-blur-xl">
      {label && <p className="mb-2 font-semibold text-[#6e6e73]">{label}</p>}
      <div className="space-y-1.5">
        {payload.map((entry: any, index: number) => {
          const color = entry.color || entry.payload.fill || entry.stroke;
          return (
            <div key={`${entry.name}-${index}`} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
              <span className="font-medium text-[#6e6e73]">{entry.name}</span>
              <span className="ml-auto font-semibold text-[#1d1d1f]">{formatOptionalNumber(entry.value)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EmptyState({ children }: { children: string }) {
  return (
    <div className="flex min-h-[160px] items-center justify-center rounded-lg border border-dashed border-black/[0.08] bg-[#f6f6f8] px-4 text-center text-sm font-semibold text-[#86868b]">
      {children}
    </div>
  );
}

function SectionHeader({
  kicker,
  title,
  action,
}: {
  kicker: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className={appleLabel}>{kicker}</p>
        <h2 className="mt-1 text-2xl font-semibold text-[#1d1d1f] sm:text-3xl">{title}</h2>
      </div>
      {action}
    </div>
  );
}

function MetricCard({ stat, index }: { stat: KpiStat; index: number }) {
  const Icon = iconMap[stat.icon] ?? Activity;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className={cn(appleCard, 'min-h-[154px] p-5')}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#f5f5f7] text-[#007aff]">
          <Icon className="h-5 w-5" strokeWidth={2.4} />
        </div>
        {stat.change && (
          <span className="inline-flex min-h-7 items-center rounded-full bg-[#eaf8ef] px-2.5 text-xs font-bold text-[#248a3d]">
            <ArrowUpRight className="mr-1 h-3.5 w-3.5" strokeWidth={2.8} />
            {stat.change}
          </span>
        )}
      </div>
      <div className="mt-6">
        <p className="text-sm font-semibold text-[#6e6e73]">{stat.label}</p>
        <div className="mt-1 flex flex-wrap items-end gap-1.5">
          <p className="text-4xl font-semibold text-[#1d1d1f]">{stat.value}</p>
          {stat.suffix && <span className="pb-1 text-sm font-bold text-[#86868b]">{stat.suffix}</span>}
        </div>
      </div>
    </motion.div>
  );
}

function MetricListCard({
  title,
  subtitle,
  items,
  onItemClick,
}: {
  title: string;
  subtitle: string;
  items: BreakdownMetric[];
  onItemClick?: (item: BreakdownMetric) => void;
}) {
  return (
    <div className={cn(appleCard, 'p-5')}>
      <div className="mb-5">
        <h3 className="text-lg font-semibold text-[#1d1d1f]">{title}</h3>
        <p className="mt-1 text-sm font-medium text-[#86868b]">{subtitle}</p>
      </div>
      {items.length === 0 ? (
        <EmptyState>No aggregate rows available yet.</EmptyState>
      ) : (
        <div className="divide-y divide-black/5">
          {items.map((item) => {
            const isMissingMetric = item.label.startsWith('Missing');
            const valueColor = isMissingMetric && item.value > 0 ? 'text-[#b25000]' : 'text-[#1d1d1f]';
            const rowClass = 'flex min-h-14 w-full items-center justify-between gap-4 py-3 text-left';
            const rowContent = (
              <>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {item.color && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />}
                    <p className="truncate text-sm font-semibold text-[#1d1d1f]">{item.label}</p>
                  </div>
                  {item.detail && <p className="mt-1 truncate text-xs font-medium text-[#86868b]">{item.detail}</p>}
                </div>
                <div className="shrink-0 text-right">
                  <p className={cn('text-sm font-bold', valueColor)}>{item.displayValue ?? formatNumber(item.value)}</p>
                  {item.percentage != null && <p className="text-xs font-medium text-[#86868b]">{item.percentage}%</p>}
                </div>
              </>
            );
            return (
              onItemClick ? (
                <button
                  key={`${item.label}-${item.detail ?? ''}`}
                  type="button"
                  onClick={() => onItemClick(item)}
                  className={cn(rowClass, 'rounded-md px-2 transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-[#007aff]/35')}
                  aria-label={`Show details for ${item.label}`}
                >
                  {rowContent}
                </button>
              ) : (
                <div key={`${item.label}-${item.detail ?? ''}`} className={rowClass}>
                  {rowContent}
                </div>
              )
            );
          })}
        </div>
      )}
    </div>
  );
}

function SourceCard({
  productKey,
  card,
  onMetricClick,
}: {
  productKey: string;
  card: ProductSourceCard;
  onMetricClick?: (payload: SourceMetricClickPayload) => void;
}) {
  const metricItems = card.metrics.slice(0, 4);
  const sections = (card.sections ?? []).filter((section) => section.metrics.length > 0 || section.blocker);
  const renderMetricTile = (metricItem: ProductSourceCardMetric, section?: ProductSourceCardSection) => {
    const metricContent = (
      <>
        <p className="truncate text-[10px] font-bold uppercase text-[#86868b]">{metricItem.label}</p>
        <p className="mt-1 truncate text-base font-semibold text-[#1d1d1f]">
          {formatSourceMetricValue(section?.status ?? card.status, metricItem.value, metricItem.displayValue)}
        </p>
      </>
    );
    const className = 'min-h-[54px] rounded-md border border-black/[0.03] bg-white/80 p-2 text-left';
    if (!onMetricClick) {
      return (
        <div key={`${section?.key ?? 'card'}-${metricItem.key}`} className={className}>
          {metricContent}
        </div>
      );
    }
    return (
      <button
        key={`${section?.key ?? 'card'}-${metricItem.key}`}
        type="button"
        onClick={() => onMetricClick({ productKey, card, section, metric: metricItem })}
        className={cn(className, 'transition hover:border-[#007aff]/20 hover:bg-white focus:outline-none focus:ring-2 focus:ring-[#007aff]/35')}
        aria-label={`Show details for ${card.label} ${section?.label ? `${section.label} ` : ''}${metricItem.label}`}
      >
        {metricContent}
      </button>
    );
  };

  return (
    <div className={cn(appleCard, 'min-h-[214px] p-5')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-[#1d1d1f]">{card.label}</p>
          <p className="mt-1 truncate text-xs font-bold text-[#86868b]">{card.source}</p>
        </div>
        <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-xs font-bold', sourceStatusClass(card.status))}>
          {sourceStatusLabel(card.status, card.key)}
        </span>
      </div>

      {sections.length > 0 ? (
        <div className="mt-5 space-y-3">
          {sections.map((section) => {
            const sectionMeta = [
              section.source,
              section.freshness?.generatedAt ? `refreshed ${formatAge(section.freshness.generatedAt)}` : null,
            ].filter(Boolean).join(' · ');
            return (
              <div key={section.key} className={cn(applePanel, 'p-3')}>
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-[11px] font-bold uppercase text-[#86868b]">{section.label}</p>
                  {section.status ? (
                    <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold', sourceStatusClass(section.status))}>
                      {sourceStatusLabel(section.status, card.key)}
                    </span>
                  ) : null}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                  {section.metrics.slice(0, 4).map((metricItem) => renderMetricTile(metricItem, section))}
                </div>
                {sectionMeta ? (
                  <p className="mt-2 text-[11px] font-semibold leading-5 text-[#86868b]">{sectionMeta}</p>
                ) : null}
                {section.blocker ? (
                  <p className="mt-2 text-xs font-medium leading-5 text-[#6e6e73]">{section.blocker}</p>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-2 gap-2">
          {metricItems.length === 0 ? (
            <div className={cn(applePanel, 'col-span-2 flex min-h-[84px] items-center px-3 text-sm font-semibold text-[#86868b]')}>
              Waiting for aggregate event rows.
            </div>
          ) : (
            metricItems.map((metricItem) => {
              const content = (
                <>
                  <p className="truncate text-[11px] font-bold uppercase text-[#86868b]">{metricItem.label}</p>
                  <p className="mt-2 truncate text-lg font-semibold text-[#1d1d1f]">
                    {formatSourceMetricValue(card.status, metricItem.value, metricItem.displayValue)}
                  </p>
                </>
              );
              if (!onMetricClick) {
                return (
                  <div key={metricItem.key} className={cn(applePanel, 'min-h-[72px] p-3')}>
                    {content}
                  </div>
                );
              }
              return (
                <button
                  key={metricItem.key}
                  type="button"
                  onClick={() => onMetricClick({ productKey, card, metric: metricItem })}
                  className={cn(applePanel, 'min-h-[72px] p-3 text-left transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-[#007aff]/35')}
                  aria-label={`Show details for ${card.label} ${metricItem.label}`}
                >
                  {content}
                </button>
              );
            })
          )}
        </div>
      )}

      <div className="mt-4 min-h-[40px] text-xs font-medium leading-5 text-[#6e6e73]">
        {card.blocker ? card.blocker : `Freshness: ${formatAge(card.freshness.generatedAt)}`}
      </div>
    </div>
  );
}

function SourceMatrix({
  groups,
  onMetricClick,
}: {
  groups: ProductSourceGroup[];
  onMetricClick?: (payload: SourceMetricClickPayload) => void;
}) {
  const orderedKeys = ['search_console', 'ga4', 'product_events'];
  return (
    <section className={dashboardBand}>
      <SectionHeader kicker="Connected sources" title="Three-source metrics matrix" />
      <div className="space-y-7">
        {groups.map((group) => {
          const cards = orderedKeys
            .map((key) => group.sourceCards.find((card) => card.key === key))
            .filter((card): card is ProductSourceCard => Boolean(card));
          return (
            <div key={group.productKey} className="space-y-3">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h3 className="text-xl font-semibold text-[#1d1d1f]">{group.productName}</h3>
                  <p className="text-sm font-bold text-[#86868b]">{group.domain} · primary: {group.primaryEnvironment.toUpperCase()}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                {cards.map((card) => (
                  <div key={`${group.productKey}-${card.key}`}>
                    <SourceCard productKey={group.productKey} card={card} onMetricClick={onMetricClick} />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DateRangeControl({
  range,
  onPreset,
  onCustomRange,
  ariaLabelPrefix = 'Product',
  refreshing = false,
}: {
  range: HushhAiDateRangeState;
  onPreset: (days: DatePreset) => void;
  onCustomRange: (next: HushhAiDateRangeState) => void;
  ariaLabelPrefix?: string;
  refreshing?: boolean;
}) {
  const today = toDateInputValue(new Date());
  const presets: DatePreset[] = [7, 14, 30, 90];

  return (
    <div
      className="flex w-full flex-col gap-2 rounded-lg border border-black/[0.06] bg-white/88 p-2 shadow-sm backdrop-blur-xl md:w-auto"
      aria-busy={refreshing}
    >
      <div className="flex items-center gap-2">
        <div className="inline-flex flex-1 rounded-lg bg-[#f5f5f7] p-1 md:flex-none">
          {presets.map((days) => (
            <button
              key={days}
              type="button"
              onClick={() => onPreset(days)}
              aria-pressed={range.preset === days}
              className={cn(
                'min-h-9 flex-1 rounded-full px-3 text-xs font-bold transition md:flex-none',
                range.preset === days ? 'bg-white text-[#1d1d1f] shadow-sm' : 'text-[#6e6e73] hover:text-[#1d1d1f]',
              )}
            >
              {days}D
            </button>
          ))}
        </div>
        {/* The fetch behind a range change takes ten seconds or more. Without
            an acknowledgement right here, the click reads as ignored. */}
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 text-[11px] font-bold text-[#6e6e73] transition-opacity',
            refreshing ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
          role="status"
          aria-live="polite"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#007aff]" />
          {refreshing ? 'Updating' : ''}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex min-h-10 items-center gap-2 rounded-lg bg-[#f5f5f7] px-2 text-xs font-bold text-[#6e6e73]">
          <CalendarDays className="h-3.5 w-3.5 shrink-0" />
          <input
            type="date"
            value={range.startDate}
            max={today}
            onChange={(event) => onCustomRange(normalizeCustomRange({ ...range, preset: 'custom', startDate: event.target.value }))}
            className="min-w-0 flex-1 bg-transparent text-xs font-bold text-[#1d1d1f] outline-none"
            aria-label={`${ariaLabelPrefix} start date`}
          />
        </label>
        <label className="flex min-h-10 items-center rounded-lg bg-[#f5f5f7] px-2 text-xs font-bold text-[#6e6e73]">
          <input
            type="date"
            value={range.endDate}
            max={today}
            onChange={(event) => onCustomRange(normalizeCustomRange({ ...range, preset: 'custom', endDate: event.target.value }))}
            className="min-w-0 flex-1 bg-transparent text-xs font-bold text-[#1d1d1f] outline-none"
            aria-label={`${ariaLabelPrefix} end date`}
          />
        </label>
      </div>
    </div>
  );
}

function ChartShell({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={cn(appleCard, 'p-5')}>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-[#1d1d1f]">{title}</h3>
          <p className="mt-1 text-sm font-medium text-[#86868b]">{subtitle}</p>
        </div>
        {action}
      </div>
      <div className="h-[300px] w-full">{children}</div>
    </div>
  );
}

function MetricDetailDialog({
  detail,
  onClose,
}: {
  detail: MetricDetailState | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!detail) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [detail, onClose]);

  if (!detail) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/28 p-3 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="metric-detail-title">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close metric details" onClick={onClose} />
      <div className={cn(appleCard, 'relative max-h-[88vh] w-full max-w-5xl overflow-hidden bg-white shadow-[0_24px_80px_rgba(0,0,0,0.18)]')}>
        <div className="flex items-start justify-between gap-4 border-b border-black/[0.06] p-5 sm:p-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="metric-detail-title" className="text-2xl font-semibold text-[#1d1d1f]">{detail.title}</h2>
              {detail.badge ? (
                <span className="rounded-full border border-[#007aff]/15 bg-[#e8f2ff]/80 px-2.5 py-1 text-xs font-bold text-[#005eb8]">
                  {detail.badge}
                </span>
              ) : null}
            </div>
            <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-[#6e6e73]">{detail.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f5f5f7] text-[#6e6e73] transition hover:bg-[#e8e8ed] hover:text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#007aff]/35"
            aria-label="Close metric details"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[calc(88vh-112px)] overflow-y-auto p-5 sm:p-6">
          {detail.summary && detail.summary.length > 0 ? (
            <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {detail.summary.map((row) => (
                <div key={`${row.label}-${row.value}`} className={cn(applePanel, 'p-3')}>
                  <p className="text-[11px] font-bold uppercase text-[#86868b]">{row.label}</p>
                  <p className="mt-2 text-xl font-semibold text-[#1d1d1f]">{row.value}</p>
                  {row.detail ? <p className="mt-1 text-xs font-medium leading-5 text-[#86868b]">{row.detail}</p> : null}
                </div>
              ))}
            </div>
          ) : null}

          <div className="space-y-5">
            {detail.sections.map((section) => (
              <section key={section.title} className={cn(applePanel, 'p-4')}>
                <div className="mb-3">
                  <h3 className="text-base font-semibold text-[#1d1d1f]">{section.title}</h3>
                  {section.subtitle ? <p className="mt-1 text-xs font-semibold leading-5 text-[#86868b]">{section.subtitle}</p> : null}
                </div>
                {section.rows.length === 0 ? (
                  <EmptyState>No aggregate detail rows available for this metric yet.</EmptyState>
                ) : (
                  <div className="divide-y divide-black/5 overflow-hidden rounded-lg border border-black/[0.04] bg-white/80">
                    {section.rows.map((row) => (
                      <div key={`${section.title}-${row.label}-${row.value}-${row.meta ?? ''}`} className="grid gap-2 p-3 sm:grid-cols-[1.2fr_0.6fr_1.4fr] sm:items-center">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[#1d1d1f]">{row.label}</p>
                          {row.meta ? <p className="mt-1 truncate text-xs font-medium text-[#86868b]">{row.meta}</p> : null}
                        </div>
                        <p className="text-sm font-bold text-[#1d1d1f] sm:text-right">{row.value}</p>
                        {row.detail ? <p className="text-xs font-medium leading-5 text-[#6e6e73]">{row.detail}</p> : <span />}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>

          {detail.caveats && detail.caveats.length > 0 ? (
            <div className="mt-5 rounded-lg border border-[#9a5b00]/15 bg-[#fff7e6]/80 p-4">
              <p className="text-xs font-bold uppercase text-[#9a5b00]">Source caveats</p>
              <ul className="mt-2 space-y-1.5 text-sm font-medium leading-6 text-[#7a4a00]">
                {detail.caveats.map((caveat) => (
                  <li key={caveat}>{caveat}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ProductLivePanel({
  kicker,
  title,
  refreshingLabel,
  freshness,
  lastUpdated,
  autoRefresh,
  isRefreshing,
  onToggleAutoRefresh,
}: {
  kicker: string;
  title: string;
  refreshingLabel: string;
  freshness: HushhAiFreshness | null | undefined;
  lastUpdated: string | null | undefined;
  autoRefresh: boolean;
  isRefreshing: boolean;
  onToggleAutoRefresh: () => void;
}) {
  const sources = freshness?.sources ?? [];
  const refreshSeconds = freshness?.refreshIntervalSeconds ?? 30;

  return (
    <div className={cn(appleCard, 'p-5')}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className={appleLabel}>{kicker}</p>
          <h3 className="mt-1 text-xl font-semibold text-[#1d1d1f]">{title} · auto-updating every {refreshSeconds}s</h3>
          <p className="mt-2 text-sm font-medium leading-6 text-[#6e6e73]">
            Last dashboard pull: {formatTimestamp(lastUpdated)} · {formatAge(lastUpdated)}
          </p>
        </div>
        <button
          onClick={onToggleAutoRefresh}
          className={cn(
            'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-bold transition',
            autoRefresh
              ? 'bg-[#1d1d1f] text-white hover:bg-[#323236]'
              : 'bg-[#f5f5f7] text-[#1d1d1f] hover:bg-[#e8e8ed]',
          )}
        >
          {autoRefresh ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          {autoRefresh ? 'Pause live refresh' : 'Resume live refresh'}
        </button>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {sources.map((source) => (
          <div key={source.key} className={cn(applePanel, 'p-4')}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-[#1d1d1f]">{source.label}</p>
                <p className="mt-1 text-xs font-semibold text-[#86868b]">{formatAge(source.generatedAt)}</p>
              </div>
              <span className={cn('rounded-full px-2.5 py-1 text-xs font-bold', freshnessClass(source))}>
                {freshnessLabel(source)}
              </span>
            </div>
            <p className="mt-3 text-xs font-medium leading-5 text-[#6e6e73]">{source.detail}</p>
          </div>
        ))}
      </div>

      {isRefreshing && (
        <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#e8f2ff] px-3 py-1.5 text-xs font-bold text-[#005eb8]">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          {refreshingLabel}
        </div>
      )}
    </div>
  );
}

function DailyStatusTable({ rows }: { rows: HushhAiDailyStatusPoint[] }) {
  return (
    <div className={cn(appleCard, 'p-5')}>
      <div className="mb-5">
        <h3 className="text-lg font-semibold text-[#1d1d1f]">Daily Status</h3>
        <p className="mt-1 text-sm font-medium text-[#86868b]">Supabase users, sessions, and exits by date</p>
      </div>
      {rows.length === 0 ? (
        <EmptyState>No Hushh AI daily rows available yet.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-[920px] w-full border-separate border-spacing-0 text-left text-sm">
            <thead>
              <tr className="text-xs font-bold uppercase text-[#86868b]">
                <th className="border-b border-black/5 py-3 pr-4">Date</th>
                <th className="border-b border-black/5 px-4 py-3 text-right">Total</th>
                <th className="border-b border-black/5 px-4 py-3 text-right">New</th>
                <th className="border-b border-black/5 px-4 py-3 text-right">Active</th>
                <th className="border-b border-black/5 px-4 py-3 text-right">Sessions</th>
                <th className="border-b border-black/5 px-4 py-3 text-right">Avg Session</th>
                <th className="border-b border-black/5 px-4 py-3 text-right">Exit Signals</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.date} className="font-semibold text-[#1d1d1f]">
                  <td className="border-b border-black/5 py-3 pr-4 text-[#6e6e73]">{row.date}</td>
                  <td className="border-b border-black/5 px-4 py-3 text-right">{formatNumber(row.totalUsers)}</td>
                  <td className="border-b border-black/5 px-4 py-3 text-right">{formatNumber(row.newUsers)}</td>
                  <td className="border-b border-black/5 px-4 py-3 text-right">{formatNumber(row.activeUsers)}</td>
                  <td className="border-b border-black/5 px-4 py-3 text-right">{formatNumber(row.sessionsStarted)}</td>
                  <td className="border-b border-black/5 px-4 py-3 text-right">{formatDurationFromMinutes(row.avgSessionMinutes)}</td>
                  <td className="border-b border-black/5 px-4 py-3 text-right">{formatNumber(row.deletedUsers + row.deleteRequests)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function KaiDailyStatusTable({ rows }: { rows: KaiDailyStatusPoint[] }) {
  return (
    <div className={cn(appleCard, 'p-5')}>
      <div className="mb-5">
        <h3 className="text-lg font-semibold text-[#1d1d1f]">One Production Reliability Status</h3>
        <p className="mt-1 text-sm font-medium text-[#86868b]">Users, sessions, and events come from the delayed GA4 export when available; requests and reliability come from Cloud Run.</p>
      </div>
      {rows.length === 0 ? (
        <EmptyState>No One production daily rows available yet.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-[860px] w-full border-separate border-spacing-0 text-left text-sm">
            <thead>
              <tr className="text-xs font-bold uppercase text-[#86868b]">
                <th className="border-b border-black/5 py-3 pr-4">Date</th>
                <th className="border-b border-black/5 px-4 py-3 text-right">Users</th>
                <th className="border-b border-black/5 px-4 py-3 text-right">Sessions</th>
                <th className="border-b border-black/5 px-4 py-3 text-right">Events</th>
                <th className="border-b border-black/5 px-4 py-3 text-right">Requests</th>
                <th className="border-b border-black/5 px-4 py-3 text-right">5xx</th>
                <th className="border-b border-black/5 px-4 py-3 text-right">Error Rate</th>
                <th className="border-b border-black/5 py-3 pl-4 text-right">P95</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.date} className="font-semibold text-[#1d1d1f]">
                  <td className="border-b border-black/5 py-3 pr-4 text-[#6e6e73]">{row.date}</td>
                  <td className="border-b border-black/5 px-4 py-3 text-right">{formatOptionalNumber(row.users, 'Waiting')}</td>
                  <td className="border-b border-black/5 px-4 py-3 text-right">{formatOptionalNumber(row.sessions, 'Waiting')}</td>
                  <td className="border-b border-black/5 px-4 py-3 text-right">{formatOptionalNumber(row.events, 'Waiting')}</td>
                  <td className="border-b border-black/5 px-4 py-3 text-right">{formatNumber(row.requests)}</td>
                  <td className="border-b border-black/5 px-4 py-3 text-right">{formatNumber(row.errors)}</td>
                  <td className="border-b border-black/5 px-4 py-3 text-right">{row.errorRate == null ? '—' : `${(row.errorRate * 100).toFixed(3)}%`}</td>
                  <td className="border-b border-black/5 py-3 pl-4 text-right">{row.p95LatencyMs ? `${Math.round(row.p95LatencyMs)}ms` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


function StepReachCard({ title, steps }: { title: string; steps: FunnelStep[] }) {
  const maxUsers = Math.max(...steps.map((step) => step.users), 1);

  return (
    <div className={cn(appleCard, 'p-5')}>
      <div className="mb-5">
        <h3 className="text-lg font-semibold text-[#1d1d1f]">{title}</h3>
        <p className="mt-1 text-sm font-medium text-[#86868b]">
          Distinct devices per observed step · trailing 30 days · not a nested cohort
        </p>
      </div>
      {steps.length === 0 ? (
        <EmptyState>No journey-step rows available yet.</EmptyState>
      ) : (
        <div className="space-y-4">
          {steps.map((step) => {
            const width = step.users > 0 ? Math.max((step.users / maxUsers) * 100, 7) : 0;
            return (
              <div key={step.step}>
                <div className="mb-2 flex items-center justify-between gap-4">
                  <span className="text-sm font-semibold text-[#1d1d1f]">{step.step}</span>
                  <span className="text-sm font-bold text-[#6e6e73]">{formatNumber(step.users)}</span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-[#f5f5f7]">
                  <div className="h-full rounded-full bg-[#007aff] transition-all duration-700" style={{ width: `${width}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PlatformCard({ platform }: { platform: PlatformStatus }) {
  return (
    <div className={cn(appleCard, 'p-5')}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: platform.color }} />
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold text-[#1d1d1f]">{platform.name}</h3>
            <div className="mt-1 flex items-center gap-1.5 text-xs font-bold">
              {platform.available ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-[#248a3d]" />
                  <span className="text-[#248a3d]">Live aggregate data</span>
                </>
              ) : (
                <>
                  <Clock className="h-3.5 w-3.5 text-[#86868b]" />
                  <span className="text-[#86868b]">Syncing metrics</span>
                </>
              )}
            </div>
          </div>
        </div>
        <a
          href={`https://${platform.url}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#f5f5f7] text-[#6e6e73] transition hover:bg-[#e8e8ed] hover:text-[#1d1d1f]"
          aria-label={`Open ${platform.name}`}
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>

      <div className="mt-7 grid grid-cols-2 gap-3">
        <div className={cn(applePanel, 'p-4')}>
          <p className="text-xs font-bold uppercase text-[#86868b]">Primary Metric</p>
          <p className="mt-2 text-3xl font-semibold text-[#1d1d1f]">{platform.visitors}</p>
        </div>
        <div className={cn(applePanel, 'p-4')}>
          <p className="text-xs font-bold uppercase text-[#86868b]">Change</p>
          <p className="mt-2 text-base font-bold text-[#248a3d]">{platform.change}</p>
        </div>
        <div className={cn(applePanel, 'p-4')}>
          <p className="text-xs font-bold uppercase text-[#86868b]">Sessions</p>
          <p className="mt-2 text-base font-bold text-[#1d1d1f]">{platform.avgSession}</p>
        </div>
        <div className={cn(applePanel, 'p-4')}>
          <p className="text-xs font-bold uppercase text-[#86868b]">Health</p>
          <p className="mt-2 text-base font-bold text-[#1d1d1f]">{platform.bounceRate}</p>
        </div>
      </div>

    </div>
  );
}

export default function Dashboard() {
  // 'one' leads because the One app is the active growth focus; the founder
  // should land on the scoreboard, not on the source matrix.
  const [locationRoute, setLocationRoute] = useState<LocationAnalyticsRoute | null>(() => (
    typeof window === 'undefined' ? null : parseLocationAnalyticsPath(window.location.pathname)
  ));
  const [activeTab, setActiveTab] = useState<DashboardTab>(() => (locationRoute ? 'one' : 'growth'));
  const [kaiRange, setKaiRange] = useState<HushhAiDateRangeState>(() => rangeForPreset(7));
  // 30 days by default: the One app's agent volumes are small enough that a
  // 7-day window reads as noise rather than a trend.
  const [oneRange, setOneRange] = useState<HushhAiDateRangeState>(() => rangeForPreset(30));
  const [hushhAiRange, setHushhAiRange] = useState<HushhAiDateRangeState>(() => rangeForPreset(7));
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [usingMock, setUsingMock] = useState(false);
  const [metricDetail, setMetricDetail] = useState<MetricDetailState | null>(null);
  // Three fixed-window growth summaries for the over-time tab. Loaded on first
  // visit to that tab rather than with everything else: it is three more
  // BigQuery passes, and most sessions never open it.
  const [compare, setCompare] = useState<GrowthCompare | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  // The full-screen "Loading live metrics" overlay is for the first paint
  // only. A date-range change used to go through the same path, so every
  // preset click blurred the whole page for the ten-plus seconds the fetch
  // takes and then, on the growth tab, came back looking identical (the
  // audience curve is deliberately all-time). Once data is on screen, every
  // later load -- range change, manual refresh, auto refresh -- keeps the page
  // visible and reports through `isRefreshing` instead.
  const hasLoadedRef = useRef(false);
  // Range clicks can outrun the fetch. Without this, clicking 14D and then 30D
  // let the slower 14D response land last and overwrite the 30D data while the
  // toggle still said 30D.
  const requestSeqRef = useRef(0);

  const changeDashboardTab = useCallback((tab: DashboardTab) => {
    if (locationRoute) {
      window.history.pushState({ dashboardTab: tab }, '', '/');
      setLocationRoute(null);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      window.history.replaceState({ ...window.history.state, dashboardTab: tab }, '', window.location.href);
    }
    setActiveTab(tab);
  }, [locationRoute]);

  const changeLocationRoute = useCallback((route: LocationAnalyticsRoute) => {
    const path = locationAnalyticsPath(route);
    if (window.location.pathname !== path) {
      window.history.pushState({ dashboardTab: 'one' }, '', path);
    }
    setLocationRoute(route);
    setActiveTab('one');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const openLocationAnalytics = useCallback(() => {
    window.history.replaceState({ ...window.history.state, dashboardTab: 'one' }, '', window.location.href);
    changeLocationRoute({ environment: 'production', tab: 'overview' });
  }, [changeLocationRoute]);

  const closeLocationAnalytics = useCallback(() => {
    window.history.pushState({ dashboardTab: 'one' }, '', '/');
    setLocationRoute(null);
    setActiveTab('one');
  }, []);

  useEffect(() => {
    window.history.replaceState(
      { ...window.history.state, dashboardTab: locationRoute ? 'one' : activeTab },
      '',
      window.location.href,
    );
  }, [activeTab, locationRoute]);

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const route = parseLocationAnalyticsPath(window.location.pathname);
      setLocationRoute(route);
      setActiveTab(route ? 'one' : (isDashboardTab(event.state?.dashboardTab) ? event.state.dashboardTab : 'growth'));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (!locationRoute) {
      document.title = 'Hussh Matrix Dashboard';
      return;
    }
    const section = locationRoute.tab === 'overview'
      ? ''
      : ` · ${locationRoute.tab[0].toUpperCase()}${locationRoute.tab.slice(1)}`;
    document.title = `One Location ${locationRoute.environment === 'uat' ? 'UAT' : 'Production'}${section} | Hussh Matrix`;
  }, [locationRoute]);

  const loadData = useCallback(async () => {
    const requestId = ++requestSeqRef.current;
    if (hasLoadedRef.current) {
      setIsRefreshing(true);
    } else {
      setLoading(true);
    }
    const result = await fetchAllAnalytics({
      kaiStartDate: kaiRange.startDate,
      kaiEndDate: kaiRange.endDate,
      oneStartDate: oneRange.startDate,
      oneEndDate: oneRange.endDate,
      hushhAiStartDate: hushhAiRange.startDate,
      hushhAiEndDate: hushhAiRange.endDate,
    });
    if (requestId !== requestSeqRef.current) return;
    hasLoadedRef.current = true;
    setUsingMock(Boolean(result.error));
    setData(result);
    setLoading(false);
    setIsRefreshing(false);
  }, [hushhAiRange.endDate, hushhAiRange.startDate, kaiRange.endDate, kaiRange.startDate, oneRange.endDate, oneRange.startDate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const loadCompare = useCallback(async () => {
    setCompareLoading(true);
    const result = await fetchGrowthCompare();
    setCompare(result);
    setCompareError(result ? result.error : 'Failed to fetch the comparison. Is the server running?');
    setCompareLoading(false);
  }, []);

  useEffect(() => {
    if (activeTab !== 'compare' || compare || compareLoading) return;
    void loadCompare();
    // `compare`/`compareLoading` are read, not depended on: this should fire
    // on entering the tab, not again when the load it started resolves.
  }, [activeTab, loadCompare]);

  const liveRefreshSeconds = Math.min(
    data?.kaiProduction?.freshness?.refreshIntervalSeconds ?? 30,
    data?.hushhAi?.freshness?.refreshIntervalSeconds ?? 30,
  );

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const refreshId = window.setInterval(() => {
      void loadData();
    }, liveRefreshSeconds * 1000);
    return () => window.clearInterval(refreshId);
  }, [autoRefresh, liveRefreshSeconds, loadData]);

  const platforms = data?.platforms ?? [];
  const sourceGroups = data?.sourceGroups ?? [];
  const kpiStats = data?.kpiStats ?? [];
  const trafficData = data?.trafficData ?? [];
  const acquisitionChannels = data?.acquisitionChannels ?? [];
  const topCountries = data?.topCountries ?? [];
  const dailyActiveUsers = data?.kaiDailyUsage ?? [];
  const investorFunnel = data?.kaiInvestorFunnel ?? [];
  const riaFunnel = data?.kaiRiaFunnel ?? [];
  const kaiActivationMetrics = data?.kaiActivationMetrics ?? [];
  const kaiUsageMetrics = data?.kaiUsageMetrics ?? [];
  const kaiEventMetrics = data?.kaiEventMetrics ?? [];
  const kaiGeoMetrics = data?.kaiGeoMetrics ?? [];
  const kaiProductionDailyStatus = data?.kaiProductionDailyStatus ?? [];
  const kaiProductionDailySummaryMetrics = data?.kaiProductionDailySummaryMetrics ?? [];
  const kaiProductionReadinessMetrics = data?.kaiProductionReadinessMetrics ?? [];
  const kaiProductionFreshness = data?.kaiProduction?.freshness;
  const kaiProductionGa4Available = Boolean(data?.kaiProduction?.productionGa4?.available);
  const platformMix = data?.platformMix ?? [];
  const featureEngagement = data?.featureEngagement ?? [];
  const instrumentationHealth = data?.instrumentationHealth ?? [];
  const hushhAiOpsMetrics = data?.hushhAiOpsMetrics ?? [];
  const hushhAiSearchMetrics = data?.hushhAiSearchMetrics ?? [];
  const hushhAiEngagementMetrics = data?.hushhAiEngagementMetrics ?? [];
  const hushhAiTopPageMetrics = data?.hushhAiTopPageMetrics ?? [];
  const hushhAiTopEventMetrics = data?.hushhAiTopEventMetrics ?? [];
  const hushhAiProductEventMetrics = data?.hushhAiProductEventMetrics ?? [];
  const hushhAiAcquisitionMetrics = data?.hushhAiAcquisitionMetrics ?? [];
  const hushhAiSourceMediumMetrics = data?.hushhAiSourceMediumMetrics ?? [];
  const hushhAiLandingPageMetrics = data?.hushhAiLandingPageMetrics ?? [];
  const hushhAiGeoDeviceMetrics = data?.hushhAiGeoDeviceMetrics ?? [];
  const hushhAiSessionTimingMetrics = data?.hushhAiSessionTimingMetrics ?? [];
  const hushhAiDailyStatus = data?.hushhAiDailyStatus ?? [];
  const hushhAiDailySummaryMetrics = data?.hushhAiDailySummaryMetrics ?? [];
  const hushhAiFreshness = data?.hushhAi?.freshness;
  const hushhTechAudienceMetrics = data?.hushhTechAudienceMetrics ?? [];
  const hushhTechBusinessMetrics = data?.hushhTechBusinessMetrics ?? [];
  const hushhTechOpsMetrics = data?.hushhTechOpsMetrics ?? [];
  const hushhTechReportTotals = data?.hushhTechReportTotals ?? [];
  const hushhTechSevenDayMetrics = data?.hushhTechSevenDayMetrics ?? [];
  const hushhTechCoverageMetrics = data?.hushhTechCoverageMetrics ?? [];
  const hushhTechActivityMetrics = data?.hushhTechActivityMetrics ?? [];
  const hushhTechFunnelMetrics = data?.hushhTechFunnelMetrics ?? [];
  const hushhTechDatabaseMetrics = data?.hushhTechDatabaseMetrics ?? [];
  const hushhTechDailyStatus = data?.hushhTechDailyStatus ?? [];
  const hushhTechDailySummaryMetrics = data?.hushhTechDailySummaryMetrics ?? [];
  const hushhTechRangeLabel = data?.hushhTech?.window
    ? `${data.hushhTech.window.startDate} to ${data.hushhTech.window.endDate}`
    : 'Selected range';
  const statusText = usingMock ? 'Metrics are syncing from connected sources' : 'Live metrics loaded from connected sources';
  const closeMetricDetail = useCallback(() => setMetricDetail(null), []);

  const ga4SummaryRows = () => {
    const totals = data?.hushhAi?.ga4?.rangeTotals;
    return [
      detailRow('Users', formatOptionalNumber(totals?.users), 'GA4 active users for the selected range.'),
      detailRow('Sessions', formatOptionalNumber(totals?.sessions), 'Visits started on hushh.ai; one user can create multiple sessions.'),
      detailRow('Events', formatOptionalNumber(totals?.events), 'Aggregate GA4 event count across automatic and instrumented events.'),
      detailRow('Engaged Sessions', formatOptionalNumber(totals?.engagedSessions), `${formatOptionalPercent(totals?.engagementRate)} engagement rate`),
      detailRow('Avg Session Duration', formatDurationFromSeconds(totals?.averageSessionDuration), 'Average GA4 session duration.'),
    ];
  };

  const ga4Caveats = () => {
    const warnings = data?.hushhAi?.ga4?.warnings ?? [];
    return [
      'Privacy boundary: this dashboard uses aggregate GA4 Data API reports only, not raw user identities or person-level rows.',
      ...warnings.filter((warning) => !/user-level\/session-level/i.test(warning)),
    ];
  };

  const buildHushhAiGa4Sections = (focus: string): DetailSection[] => {
    const ga4 = data?.hushhAi?.ga4;
    const acquisition = ga4?.acquisition;
    const timing = ga4?.sessionTiming;
    const sections: DetailSection[] = [];
    const add = (section: DetailSection) => {
      if (section.rows.length === 0) return;
      if (!sections.some((existing) => existing.title === section.title)) sections.push(section);
    };

    if (focus === 'events' || focus === 'all') {
      add({
        title: 'Top GA4 Events',
        subtitle: 'Event names and counts returned by GA4 Data API. Web-vitals rows are performance telemetry, not conversion events.',
        rows: (ga4?.topEvents ?? []).map((event) => detailRow(
          readableMetricLabel(event.eventName),
          `${formatNumber(event.events)} events`,
          eventDescription(event.eventName),
          `${formatNumber(event.users)} users · ${event.eventName}`,
        )),
      });
    }

    if (focus === 'pages' || focus === 'all') {
      add({
        title: 'Top Pages / Screens',
        subtitle: 'Aggregate page/screen views. Query strings are intentionally not exposed.',
        rows: (ga4?.topPages ?? []).map((page) => detailRow(
          page.path || page.title || '(not set)',
          `${formatOptionalNumber(page.views)} views`,
          `${formatOptionalNumber(page.users)} users · ${formatOptionalNumber(page.events)} events`,
          page.title,
        )),
      });
    }

    add({
      title: 'Where Users And Sessions Came From',
      subtitle: 'GA4 session default channel group. Users are aggregate active users, not account identities.',
      rows: (acquisition?.sessionChannels ?? []).map((channel) => detailRow(
        channel.channel ?? '(not set)',
        `${formatOptionalNumber(channel.sessions)} sessions`,
        `${formatOptionalNumber(channel.users)} users · ${formatOptionalNumber(channel.newUsers)} new users · ${formatOptionalNumber(channel.engagedSessions)} engaged · ${formatDurationFromSeconds(channel.averageSessionDuration)} avg duration`,
        `${formatOptionalNumber(channel.events)} events`,
      )),
    });

    add({
      title: 'Source / Medium',
      subtitle: 'GA4 source attribution for sessions.',
      rows: (acquisition?.sessionSourceMedium ?? []).map((source) => detailRow(
        source.sourceMedium ?? '(not set)',
        `${formatOptionalNumber(source.sessions)} sessions`,
        `${formatOptionalNumber(source.users)} users · ${formatOptionalNumber(source.newUsers)} new users · ${formatOptionalNumber(source.engagedSessions)} engaged`,
        `${formatOptionalNumber(source.events)} events`,
      )),
    });

    add({
      title: 'Landing Pages',
      subtitle: 'First page in each GA4 session, grouped with channel context.',
      rows: (acquisition?.landingPages ?? []).map((page) => detailRow(
        page.landingPage ?? '(not set)',
        `${formatOptionalNumber(page.sessions)} sessions`,
        `${formatOptionalNumber(page.users)} users · ${formatOptionalNumber(page.engagedSessions)} engaged · ${formatOptionalNumber(page.events)} events`,
        page.channel,
      )),
    });

    add({
      title: 'Geo + Device',
      subtitle: 'Aggregate country/device mix from GA4.',
      rows: (acquisition?.geoDevice ?? []).map((geo) => detailRow(
        `${geo.country ?? '(not set)'} · ${geo.deviceCategory ?? '(not set)'}`,
        `${formatOptionalNumber(geo.sessions)} sessions`,
        `${formatOptionalNumber(geo.users)} users · ${formatOptionalNumber(geo.engagedSessions)} engaged`,
        `${formatOptionalNumber(geo.events)} events`,
      )),
    });

    add({
      title: 'Session Timing',
      subtitle: `Top session hours in ${timing?.timezoneLabel ?? 'GA4 property timezone'}.`,
      rows: (timing?.topDateHours ?? []).map((bucket) => detailRow(
        bucket.label,
        `${formatOptionalNumber(bucket.sessions)} sessions`,
        `${formatOptionalNumber(bucket.users)} users · ${formatOptionalNumber(bucket.engagedSessions)} engaged · ${formatDurationFromSeconds(bucket.averageSessionDuration)} avg duration`,
        `${formatOptionalNumber(bucket.events)} events`,
      )),
    });

    if (focus !== 'events') {
      add({
        title: 'Top GA4 Events',
        subtitle: 'Event context for the same selected range.',
        rows: (ga4?.topEvents ?? []).slice(0, 8).map((event) => detailRow(
          readableMetricLabel(event.eventName),
          `${formatNumber(event.events)} events`,
          eventDescription(event.eventName),
          `${formatNumber(event.users)} users · ${event.eventName}`,
        )),
      });
    }

    if (focus !== 'pages') {
      add({
        title: 'Top Pages / Screens',
        subtitle: 'Page context for the same selected range.',
        rows: (ga4?.topPages ?? []).slice(0, 8).map((page) => detailRow(
          page.path || page.title || '(not set)',
          `${formatOptionalNumber(page.views)} views`,
          `${formatOptionalNumber(page.users)} users · ${formatOptionalNumber(page.events)} events`,
          page.title,
        )),
      });
    }

    return sections;
  };

  const openHushhAiGa4Detail = (focus: 'users' | 'sessions' | 'events' | 'engagement' | 'pages' | 'acquisition' | 'source' | 'landing' | 'geo' | 'timing' | 'all', label?: string) => {
    const ga4 = data?.hushhAi?.ga4;
    if (!ga4) {
      setMetricDetail({
        title: label ?? 'Hushh AI GA4',
        subtitle: 'GA4 aggregate data is not available for hushh.ai yet.',
        badge: 'Waiting',
        sections: [],
        caveats: ['No GA4 Data API aggregate rows are currently available.'],
      });
      return;
    }
    const focusTitle: Record<typeof focus, string> = {
      users: 'Hushh AI Users',
      sessions: 'Hushh AI Sessions',
      events: 'Hushh AI GA4 Events',
      engagement: 'Hushh AI Engagement',
      pages: 'Hushh AI Pages / Screens',
      acquisition: 'Hushh AI Acquisition',
      source: 'Hushh AI Source / Medium',
      landing: 'Hushh AI Landing Pages',
      geo: 'Hushh AI Geo + Device',
      timing: 'Hushh AI Session Timing',
      all: 'Hushh AI GA4 Details',
    };
    const selectedRange = ga4.range
      ? `${ga4.range.startDate} to ${ga4.range.endDate}`
      : `${hushhAiRange.startDate} to ${hushhAiRange.endDate}`;
    const sectionFocus = focus === 'events' || focus === 'pages' ? focus : 'all';
    setMetricDetail({
      title: label ?? focusTitle[focus],
      subtitle: `hushh.ai GA4 Data API aggregate details for ${selectedRange}.`,
      badge: ga4.available === false ? 'Waiting' : 'GA4 aggregate',
      summary: ga4SummaryRows(),
      sections: buildHushhAiGa4Sections(sectionFocus),
      caveats: ga4Caveats(),
    });
  };

  const openHushhAiProductEventsDetail = (label?: string) => {
    const productEvents = data?.hushhAi?.productEvents as {
      expectedEvents?: Array<{ eventName?: string; label?: string; status?: string; count?: number | null; note?: string }>;
      note?: string;
      status?: string;
    } | null | undefined;
    setMetricDetail({
      title: label ?? 'Hushh AI Product Events',
      subtitle: 'These are the product/custom events we expect to track once a real hushh.ai aggregate source exists.',
      badge: productEvents?.status === 'not_configured' ? 'Not configured' : 'Waiting',
      summary: [
        detailRow('Source', 'DB / Product Events', 'No real hushh.ai aggregate event source is configured yet.'),
        detailRow('Status', productEvents?.status === 'not_configured' ? 'Not configured' : 'Waiting'),
      ],
      sections: [
        {
          title: 'Expected Product Events',
          subtitle: 'No numeric value is shown here until a first-party aggregate source exists.',
          rows: (productEvents?.expectedEvents ?? []).map((event) => detailRow(
            event.label ?? readableMetricLabel(event.eventName ?? 'Product Event'),
            event.count == null ? 'Not configured' : formatNumber(event.count),
            event.note ?? 'Waiting for a real hushh.ai product-event aggregate source.',
            event.eventName,
          )),
        },
      ],
      caveats: [
        productEvents?.note ?? 'Hushh AI DB aggregate source is not configured in metrics.hushh.ai yet.',
        'Until this source exists, GA4 can show traffic/events but cannot verify signup, login, CTA, demo, or contact funnel truth.',
      ],
    });
  };

  const openHushhAiSearchDetail = (label?: string) => {
    const search = data?.hushhAi?.searchConsole;
    setMetricDetail({
      title: label ?? 'Hushh AI Search Console',
      subtitle: `Search Console aggregate details for ${search?.range?.startDate ?? hushhAiRange.startDate} to ${search?.range?.endDate ?? hushhAiRange.endDate}.`,
      badge: search?.available ? 'Search aggregate' : 'Waiting',
      summary: [
        detailRow('Clicks', formatOptionalNumber(search?.clicks)),
        detailRow('Impressions', formatOptionalNumber(search?.impressions)),
        detailRow('CTR', search?.ctr == null ? '—' : `${(search.ctr * 100).toFixed(1)}%`),
        detailRow('Avg Position', search?.averagePosition == null ? '—' : search.averagePosition.toFixed(1)),
      ],
      sections: [
        {
          title: 'Top Queries',
          rows: (search?.queries ?? []).slice(0, 12).map((query) => detailRow(
            query.query,
            `${formatOptionalNumber(query.clicks)} clicks`,
            `${formatOptionalNumber(query.impressions)} impressions · ${query.ctr == null ? '—' : `${(query.ctr * 100).toFixed(1)}%`} CTR · ${query.averagePosition == null ? '—' : query.averagePosition.toFixed(1)} avg position`,
          )),
        },
        {
          title: 'Top Pages',
          rows: (search?.pages ?? []).slice(0, 12).map((page) => detailRow(
            safeUrlLabel(page.pageUrl),
            `${formatOptionalNumber(page.clicks)} clicks`,
            `${formatOptionalNumber(page.impressions)} impressions · ${page.averagePosition == null ? '—' : page.averagePosition.toFixed(1)} avg position`,
          )),
        },
        {
          title: 'Countries',
          rows: (search?.countries ?? []).slice(0, 12).map((country) => detailRow(
            country.country,
            `${formatOptionalNumber(country.clicks)} clicks`,
            `${formatOptionalNumber(country.impressions)} impressions`,
          )),
        },
      ],
      caveats: ['Search Console is daily/delayed search visibility data, not product user identity.'],
    });
  };

  const openKaiProductionDetail = (label = 'One Production Details', focus?: BreakdownMetric) => {
    const ga4Warnings = data?.kaiProduction?.productionGa4?.warnings ?? [];
    setMetricDetail({
      title: label,
      subtitle: `one.hushh.ai production aggregate details for ${kaiRange.startDate} to ${kaiRange.endDate}.`,
      badge: 'Production',
      summary: focusMetricSummary(kaiProductionDailySummaryMetrics, focus),
      sections: [
        {
          title: 'Production Range Summary',
          subtitle: 'GA4 remains Waiting until the production export is verified; Cloud Run values are live reliability aggregates.',
          rows: metricRows(kaiProductionDailySummaryMetrics),
        },
        {
          title: 'Production Reliability By Day',
          subtitle: 'Cloud Run request, 5xx, error-rate, and p95 aggregates by date.',
          rows: kaiProductionDailyRows(kaiProductionDailyStatus),
        },
        {
          title: 'Production Readiness',
          subtitle: 'Production feed and GA4 export status only. UAT is intentionally separate.',
          rows: metricRows(kaiProductionReadinessMetrics),
        },
        ...sourceCardSections(data?.kaiProduction?.sourceCards, 'One Production Source'),
      ],
      caveats: [
        'One production GA4 users/sessions/events stay Waiting until the production GA4 export is verified.',
        'Request and reliability values come from Cloud Run aggregate monitoring and use 5xx response counts.',
        'UAT validation traffic is not mixed into production truth.',
        ...ga4Warnings,
      ],
    });
  };


  const openHushhTechDetail = (label = 'HushhTech Details', focus?: BreakdownMetric) => {
    const qualityWarnings = data?.hushhTech?.dataQualityWarnings ?? [];
    setMetricDetail({
      title: label,
      subtitle: `hushhtech.com aggregate details for ${hushhTechRangeLabel}.`,
      badge: 'Production',
      summary: focusMetricSummary(hushhTechReportTotals, focus),
      sections: [
        {
          title: 'Total Report',
          subtitle: 'Users, funnel, search, infra, and stored aggregate totals.',
          rows: metricRows(hushhTechReportTotals),
        },
        {
          title: 'Last 7 Days',
          subtitle: 'Traffic values are shown only when the processed GA4 source is verified.',
          rows: metricRows(hushhTechSevenDayMetrics),
        },
        {
          title: 'Database Metrics',
          subtitle: 'Public-safe Supabase aggregate counts.',
          rows: metricRows(hushhTechDatabaseMetrics),
        },
        {
          title: 'Database Range Summary',
          subtitle: hushhTechRangeLabel,
          rows: metricRows(hushhTechDailySummaryMetrics),
        },
        {
          title: 'Daily Status',
          subtitle: 'Supabase users, sessions, and exits by date. Cloud Run daily request columns are intentionally not shown here.',
          rows: hushhTechDailyRows(hushhTechDailyStatus),
        },
        {
          title: 'Funnel',
          subtitle: 'Supabase business funnel aggregates.',
          rows: metricRows(hushhTechBusinessMetrics),
        },
        {
          title: 'Activity',
          subtitle: 'Pages, routes, and event aggregates when first-party rows exist.',
          rows: metricRows(hushhTechActivityMetrics),
        },
        {
          title: 'Funnel Detail',
          subtitle: 'Signup, onboarding, KYC, profile, and chat aggregate steps.',
          rows: metricRows(hushhTechFunnelMetrics),
        },
        {
          title: 'Audience',
          subtitle: 'GA4/audience aggregate metrics with suspicious processed traffic surfaced as Waiting.',
          rows: metricRows(hushhTechAudienceMetrics),
        },
        {
          title: 'Search + Ops',
          subtitle: 'Search Console and Cloud Run aggregate operations metrics.',
          rows: metricRows(hushhTechOpsMetrics),
        },
        {
          title: 'Data Coverage',
          subtitle: 'Connected provider coverage and public-safe collection status.',
          rows: metricRows(hushhTechCoverageMetrics),
        },
        ...sourceCardSections(data?.hushhTech?.sourceCards, 'HushhTech Source'),
      ],
      caveats: [
        'HushhTech Supabase/database values are aggregate counts only; raw auth users, emails, and session rows are not exposed.',
        'HushhTech processed GA4 traffic can be suspicious or zero; the dashboard preserves source caveats instead of treating those zeros as product truth.',
        'Cloud Run totals are aggregate infra totals, not daily database rows.',
        ...qualityWarnings,
      ],
    });
  };

  const handleSourceMetricClick = (payload: SourceMetricClickPayload) => {
    if (payload.productKey === 'hushh_ai' && payload.card.key === 'ga4') {
      if (/user/i.test(payload.metric.label)) openHushhAiGa4Detail('users', `${payload.section?.label ?? payload.card.label} · ${payload.metric.label}`);
      else if (/session/i.test(payload.metric.label) && !/engaged/i.test(payload.metric.label)) openHushhAiGa4Detail('sessions', `${payload.section?.label ?? payload.card.label} · ${payload.metric.label}`);
      else if (/event/i.test(payload.metric.label)) openHushhAiGa4Detail('events', `${payload.section?.label ?? payload.card.label} · ${payload.metric.label}`);
      else openHushhAiGa4Detail('engagement', `${payload.section?.label ?? payload.card.label} · ${payload.metric.label}`);
    } else if (payload.productKey === 'hushh_ai' && payload.card.key === 'product_events') {
      openHushhAiProductEventsDetail(payload.metric.label);
    } else if (payload.productKey === 'hushh_ai' && payload.card.key === 'search_console') {
      openHushhAiSearchDetail(`${payload.card.label} · ${payload.metric.label}`);
    } else {
      setMetricDetail(sourceCardDetail(payload));
    }
  };

  const handleHushhAiMetricListClick = (kind: 'users' | 'sessions' | 'events' | 'engagement' | 'pages' | 'acquisition' | 'source' | 'landing' | 'geo' | 'timing' | 'product') => (item: BreakdownMetric) => {
    if (kind === 'product') openHushhAiProductEventsDetail(item.label);
    else openHushhAiGa4Detail(kind, item.label);
  };

  return (
    <div className="min-h-screen bg-[#f5f5f7] text-[#1d1d1f] selection:bg-[#cce4ff] selection:text-[#003b76]">
      {loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#f5f5f7]/80 backdrop-blur-xl">
          <div className={cn(appleCard, 'flex items-center gap-3 px-5 py-3')}>
            <Loader2 className="h-5 w-5 animate-spin text-[#007aff]" />
            <p className="text-sm font-bold text-[#1d1d1f]">Loading live metrics</p>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-[1320px] px-3 pb-10 pt-3 sm:px-6 sm:pb-12 sm:pt-6 lg:px-8">
        <div className="relative z-30 mb-6 rounded-lg border border-white/70 bg-white/76 p-2 shadow-[0_8px_24px_rgba(0,0,0,0.07)] backdrop-blur-2xl sm:sticky sm:top-3 sm:mb-8">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className={cn(
              'flex min-h-10 min-w-0 items-start gap-2 rounded-lg border px-3 py-2 text-sm font-bold leading-5 sm:items-center',
              usingMock ? 'border-black/[0.06] bg-[#f5f5f7] text-[#6e6e73]' : 'border-[#1f7a36]/15 bg-[#ecfdf3]/80 text-[#1f7a36]',
            )}>
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 sm:mt-0" />
              <span className="min-w-0">{statusText}</span>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="grid min-w-0 flex-1 grid-cols-3 gap-1 rounded-lg bg-[#f5f5f7] p-1 sm:flex sm:flex-none" role="tablist" aria-label="Dashboard sections">
                {dashboardTabs.map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab}
                    onClick={() => changeDashboardTab(tab)}
                    className={cn(
                      'min-h-10 min-w-0 rounded-md px-2 text-xs font-bold capitalize leading-4 transition sm:min-h-9 sm:shrink-0 sm:px-4 sm:text-sm',
                      activeTab === tab
                        ? 'bg-white text-[#1d1d1f] shadow-sm'
                        : 'text-[#6e6e73] hover:text-[#1d1d1f]',
                    )}
                  >
                    {tab === 'one' ? 'One app' : tab === 'compare' ? 'Over time' : tab === 'apps' ? 'Hushh Connect' : tab}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  void loadData();
                  if (compare) void loadCompare();
                }}
                className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-[#1d1d1f] px-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#323236] sm:px-4"
              >
                <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />
                Refresh
              </button>
            </div>
          </div>
        </div>

        {!locationRoute && <header className="mb-10 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-lg border border-black/[0.06] bg-white/90 shadow-sm">
              <span className="text-3xl" aria-label="Hussh logo">🤫</span>
            </div>
            <p className="text-sm font-bold uppercase text-[#86868b]">Hussh Matrix</p>
            <h1 className="mt-2 max-w-3xl text-4xl font-semibold text-[#1d1d1f] sm:text-5xl lg:text-6xl">
              Analytics control center
            </h1>
            <p className="mt-4 max-w-2xl text-base font-medium leading-7 text-[#6e6e73] sm:text-lg">
              Live aggregate metrics for one.hushh.ai, hushhtech.com, and hushh.ai with provider health surfaced inline.
            </p>
          </div>
        </header>}

        {activeTab === 'growth' ? (
          <GrowthPanel
            growth={data?.growth ?? null}
            costPerActiveUser={data?.costPerActiveUser ?? null}
            monthlyActive={data?.one?.activeUsers?.mau ?? null}
            rangeLabel={`${oneRange.startDate} to ${oneRange.endDate}`}
            dateControl={(
              <DateRangeControl
                range={oneRange}
                refreshing={isRefreshing}
                onPreset={(days) => setOneRange(rangeForPreset(days))}
                onCustomRange={setOneRange}
                ariaLabelPrefix="Growth"
              />
            )}
          />
        ) : activeTab === 'compare' ? (
          <ComparePanel
            compare={compare}
            loading={compareLoading}
            error={compareError}
            onRetry={() => void loadCompare()}
          />
        ) : activeTab === 'one' ? (
          <OneAppPanel
            // `data` is null for the whole of the first load, and that load
            // takes ten seconds or more. The loading state here is an OVERLAY,
            // not an early return, so this subtree renders underneath it with
            // nothing in hand -- `data.one` threw on the very first paint and
            // took the entire dashboard down to a white screen.
            //
            // The overview tab never showed this because it reads through
            // `data?.sourceGroups ?? []`; this tab is only the default one
            // since the One app became the growth focus, which is what made a
            // pre-existing hazard the first thing every visitor hit.
            one={data?.one ?? null}
            oneUat={data?.oneUat ?? null}
            healthMetrics={data?.oneHealthMetrics ?? []}
            rangeLabel={`${oneRange.startDate} to ${oneRange.endDate}`}
            locationRoute={locationRoute}
            onOpenLocation={openLocationAnalytics}
            onCloseLocation={closeLocationAnalytics}
            onLocationRouteChange={changeLocationRoute}
            dateControl={(
              <DateRangeControl
                range={oneRange}
                refreshing={isRefreshing}
                onPreset={(days) => setOneRange(rangeForPreset(days))}
                onCustomRange={setOneRange}
                ariaLabelPrefix="One app"
              />
            )}
          />
        ) : activeTab === 'apps' ? (
          <AppsPanel
            one={data?.one ?? null}
            oneUat={data?.oneUat ?? null}
            appStoreConnect={data?.appStoreConnect ?? null}
            rangeLabel={`${oneRange.startDate} to ${oneRange.endDate}`}
            dateControl={(
              <DateRangeControl
                range={oneRange}
                refreshing={isRefreshing}
                onPreset={(days) => setOneRange(rangeForPreset(days))}
                onCustomRange={setOneRange}
                ariaLabelPrefix="Hushh Connect"
              />
            )}
          />
        ) : activeTab === 'overview' ? (
          <main className="space-y-10">
            <SourceMatrix groups={sourceGroups} onMetricClick={handleSourceMetricClick} />

            <section className={dashboardBand}>
              <SectionHeader kicker="Current selected ranges" title="Key metrics" />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {kpiStats.map((stat, index) => (
                  <div key={stat.label}>
                    <MetricCard stat={stat} index={index} />
                  </div>
                ))}
              </div>
            </section>

            <section className={dashboardBand}>
              <SectionHeader
                kicker="one.hushh.ai · production"
                title="Production traffic + readiness"
                action={(
                  <DateRangeControl
                    range={kaiRange}
                    refreshing={isRefreshing}
                    onPreset={(days) => setKaiRange(rangeForPreset(days))}
                    onCustomRange={setKaiRange}
                    ariaLabelPrefix="One production"
                  />
                )}
              />
              <div className="mb-4">
                <ProductLivePanel
                  kicker="One production live mode"
                  title="Production sources"
                  refreshingLabel="Refreshing One production sources"
                  freshness={kaiProductionFreshness}
                  lastUpdated={data?.lastUpdated}
                  autoRefresh={autoRefresh}
                  isRefreshing={isRefreshing}
                  onToggleAutoRefresh={() => setAutoRefresh((value) => !value)}
                />
              </div>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.95fr_1.45fr]">
                <MetricListCard
                  title="Production Range Summary"
                  subtitle={`${kaiRange.startDate} to ${kaiRange.endDate}`}
                  items={kaiProductionDailySummaryMetrics}
                  onItemClick={(item) => openKaiProductionDetail(`One Production · ${item.label}`, item)}
                />
                <ChartShell
                  title="Users, Sessions, Events"
                  subtitle="Production GA4 daily export; provider data may arrive with normal processing delay"
                  action={<DetailActionButton onClick={() => openKaiProductionDetail('One Production GA4 Details')} />}
                >
                  {!kaiProductionGa4Available ? (
                    <EmptyState>Production GA4 export is not ready yet. Cloud Run production traffic is shown below.</EmptyState>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={kaiProductionDailyStatus} margin={{ top: 12, right: 8, left: -18, bottom: 0 }}>
                        <CartesianGrid stroke="#ececf0" vertical={false} />
                        <XAxis dataKey="label" stroke="#86868b" fontSize={12} fontWeight={700} tickLine={false} axisLine={false} dy={10} />
                        <YAxis stroke="#86868b" fontSize={12} fontWeight={700} tickLine={false} axisLine={false} tickFormatter={formatAxisValue} dx={-10} />
                        <Tooltip cursor={{ fill: '#f5f5f7' }} content={<CustomTooltip />} />
                        <Bar dataKey="users" name="Users" fill="#12b5cb" radius={[6, 6, 0, 0]} />
                        <Bar dataKey="sessions" name="Sessions" fill="#007aff" radius={[6, 6, 0, 0]} />
                        <Bar dataKey="events" name="Events" fill="#af52de" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </ChartShell>
                <ChartShell
                  title="Production Traffic + Reliability"
                  subtitle="Cloud Run requests, 5xx responses, and latency context"
                  action={<DetailActionButton onClick={() => openKaiProductionDetail('One Production Reliability Details')} />}
                >
                  {kaiProductionDailyStatus.length === 0 ? (
                    <EmptyState>No One production traffic rows available yet.</EmptyState>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={kaiProductionDailyStatus} margin={{ top: 12, right: 8, left: -18, bottom: 0 }}>
                        <defs>
                          <linearGradient id="kaiProdRequests" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#12b5cb" stopOpacity={0.2} />
                            <stop offset="95%" stopColor="#12b5cb" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="kaiProdErrors" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#ff3b30" stopOpacity={0.16} />
                            <stop offset="95%" stopColor="#ff3b30" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="#ececf0" vertical={false} />
                        <XAxis dataKey="label" stroke="#86868b" fontSize={12} fontWeight={700} tickLine={false} axisLine={false} dy={10} />
                        <YAxis stroke="#86868b" fontSize={12} fontWeight={700} tickLine={false} axisLine={false} tickFormatter={formatAxisValue} dx={-10} />
                        <Tooltip content={<CustomTooltip />} />
                        <Area type="monotone" dataKey="requests" name="Requests" stroke="#12b5cb" strokeWidth={2.5} fill="url(#kaiProdRequests)" />
                        <Area type="monotone" dataKey="errors" name="5xx" stroke="#ff3b30" strokeWidth={2.5} fill="url(#kaiProdErrors)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </ChartShell>
                <MetricListCard
                  title="Production Readiness"
                  subtitle="Production feed and GA4 export only."
                  items={kaiProductionReadinessMetrics}
                  onItemClick={(item) => openKaiProductionDetail(`One Production Readiness · ${item.label}`, item)}
                />
                <div className="xl:col-span-2">
                  <KaiDailyStatusTable rows={kaiProductionDailyStatus} />
                </div>
              </div>
            </section>


            <section className={dashboardBand}>
              <SectionHeader
                kicker="hushh.ai"
                title="Analytics status matrix"
                action={(
                  <DateRangeControl
                    range={hushhAiRange}
                    refreshing={isRefreshing}
                    onPreset={(days) => setHushhAiRange(rangeForPreset(days))}
                    onCustomRange={setHushhAiRange}
                    ariaLabelPrefix="Hushh AI"
                  />
                )}
              />
              <div className="mb-4">
                <ProductLivePanel
                  kicker="Hushh AI live mode"
                  title="Fresh on refresh"
                  refreshingLabel="Refreshing Hushh AI sources"
                  freshness={hushhAiFreshness}
                  lastUpdated={data?.lastUpdated}
                  autoRefresh={autoRefresh}
                  isRefreshing={isRefreshing}
                  onToggleAutoRefresh={() => setAutoRefresh((value) => !value)}
                />
              </div>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.95fr_1.45fr]">
                <MetricListCard
                  title="Range Summary"
                  subtitle={`${hushhAiRange.startDate} to ${hushhAiRange.endDate}`}
                  items={hushhAiDailySummaryMetrics}
                />
                <ChartShell title="Traffic + Reliability" subtitle="Cloud Run requests, 5xx responses, and latency context">
                  {hushhAiDailyStatus.length === 0 ? (
                    <EmptyState>No Hushh AI traffic rows available yet.</EmptyState>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={hushhAiDailyStatus} margin={{ top: 12, right: 8, left: -18, bottom: 0 }}>
                        <defs>
                          <linearGradient id="hushhAiRequests" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#007aff" stopOpacity={0.2} />
                            <stop offset="95%" stopColor="#007aff" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="hushhAiErrors" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#ff3b30" stopOpacity={0.16} />
                            <stop offset="95%" stopColor="#ff3b30" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="#ececf0" vertical={false} />
                        <XAxis dataKey="label" stroke="#86868b" fontSize={12} fontWeight={700} tickLine={false} axisLine={false} dy={10} />
                        <YAxis stroke="#86868b" fontSize={12} fontWeight={700} tickLine={false} axisLine={false} tickFormatter={formatAxisValue} dx={-10} />
                        <Tooltip content={<CustomTooltip />} />
                        <Area type="monotone" dataKey="requests" name="Requests" stroke="#007aff" strokeWidth={2.5} fill="url(#hushhAiRequests)" />
                        <Area type="monotone" dataKey="errors" name="5xx" stroke="#ff3b30" strokeWidth={2.5} fill="url(#hushhAiErrors)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </ChartShell>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <MetricListCard
                  title="GA4 Engagement"
                  subtitle="Users, sessions, events, and engaged-session quality"
                  items={hushhAiEngagementMetrics}
                  onItemClick={(item) => {
                    if (/user/i.test(item.label)) openHushhAiGa4Detail('users', item.label);
                    else if (/session/i.test(item.label) && !/engaged/i.test(item.label)) openHushhAiGa4Detail('sessions', item.label);
                    else if (/event/i.test(item.label)) openHushhAiGa4Detail('events', item.label);
                    else openHushhAiGa4Detail('engagement', item.label);
                  }}
                />
                <MetricListCard
                  title="Future Product Events"
                  subtitle="Custom hushh.ai funnel events waiting for a real aggregate source"
                  items={hushhAiProductEventMetrics}
                  onItemClick={handleHushhAiMetricListClick('product')}
                />
              </div>
              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
                <MetricListCard
                  title="Where Sessions Came From"
                  subtitle="GA4 session channel groups"
                  items={hushhAiAcquisitionMetrics}
                  onItemClick={handleHushhAiMetricListClick('acquisition')}
                />
                <MetricListCard
                  title="Source / Medium"
                  subtitle="GA4 session source attribution"
                  items={hushhAiSourceMediumMetrics}
                  onItemClick={handleHushhAiMetricListClick('source')}
                />
                <MetricListCard
                  title="Landing Pages"
                  subtitle="First page in each GA4 session"
                  items={hushhAiLandingPageMetrics}
                  onItemClick={handleHushhAiMetricListClick('landing')}
                />
                <MetricListCard
                  title="Geo + Device"
                  subtitle="Aggregate country and device mix"
                  items={hushhAiGeoDeviceMetrics}
                  onItemClick={handleHushhAiMetricListClick('geo')}
                />
                <MetricListCard
                  title="Session Timing"
                  subtitle="Top session hours in GA4 property timezone"
                  items={hushhAiSessionTimingMetrics}
                  onItemClick={handleHushhAiMetricListClick('timing')}
                />
              </div>
              <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
                <ChartShell
                  title="Top Pages / Screens"
                  subtitle="GA4 aggregate page views for hushh.ai"
                  action={(
                    <button
                      type="button"
                      onClick={() => openHushhAiGa4Detail('pages')}
                      className="rounded-full bg-[#f5f5f7] px-3 py-1.5 text-xs font-bold text-[#007aff] transition hover:bg-[#e8f2ff] focus:outline-none focus:ring-2 focus:ring-[#007aff]/35"
                    >
                      Details
                    </button>
                  )}
                >
                  {hushhAiTopPageMetrics.length === 0 ? (
                    <EmptyState>Waiting for GA4 page and screen aggregates.</EmptyState>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={hushhAiTopPageMetrics} layout="vertical" margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                        <CartesianGrid stroke="#ececf0" horizontal={false} />
                        <XAxis type="number" stroke="#86868b" fontSize={12} fontWeight={700} tickLine={false} axisLine={false} tickFormatter={formatAxisValue} />
                        <YAxis type="category" dataKey="label" width={118} stroke="#86868b" fontSize={11} fontWeight={700} tickLine={false} axisLine={false} />
                        <Tooltip cursor={{ fill: '#f5f5f7' }} content={<CustomTooltip />} />
                        <Bar dataKey="value" name="Page views" fill="#007aff" radius={[0, 6, 6, 0]} onClick={() => openHushhAiGa4Detail('pages')} cursor="pointer" />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </ChartShell>
                <ChartShell
                  title="Top GA4 Events"
                  subtitle="Aggregate events that show what visitors are doing"
                  action={(
                    <button
                      type="button"
                      onClick={() => openHushhAiGa4Detail('events')}
                      className="rounded-full bg-[#f5f5f7] px-3 py-1.5 text-xs font-bold text-[#007aff] transition hover:bg-[#e8f2ff] focus:outline-none focus:ring-2 focus:ring-[#007aff]/35"
                    >
                      Details
                    </button>
                  )}
                >
                  {hushhAiTopEventMetrics.length === 0 ? (
                    <EmptyState>Waiting for GA4 event aggregates.</EmptyState>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={hushhAiTopEventMetrics} layout="vertical" margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                        <CartesianGrid stroke="#ececf0" horizontal={false} />
                        <XAxis type="number" stroke="#86868b" fontSize={12} fontWeight={700} tickLine={false} axisLine={false} tickFormatter={formatAxisValue} />
                        <YAxis type="category" dataKey="label" width={118} stroke="#86868b" fontSize={11} fontWeight={700} tickLine={false} axisLine={false} />
                        <Tooltip cursor={{ fill: '#f5f5f7' }} content={<CustomTooltip />} />
                        <Bar dataKey="value" name="Events" fill="#34c759" radius={[0, 6, 6, 0]} onClick={() => openHushhAiGa4Detail('events')} cursor="pointer" />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </ChartShell>
              </div>
            </section>

            <section className={dashboardBand}>
              <SectionHeader kicker="hushhtech.com" title="Complete report" />
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <MetricListCard
                  title="Total Report"
                  subtitle="Users, funnel, search, infra, and stored aggregates"
                  items={hushhTechReportTotals}
                  onItemClick={(item) => openHushhTechDetail(`HushhTech · ${item.label}`, item)}
                />
                <MetricListCard
                  title="Last 7 Days"
                  subtitle="DAU, WAU, MAU, sessions, views, events, and engagement"
                  items={hushhTechSevenDayMetrics}
                  onItemClick={(item) => openHushhTechDetail(`HushhTech 7D · ${item.label}`, item)}
                />
              </div>
            </section>

            <section className={dashboardBand}>
              <SectionHeader kicker="hushhtech.com Supabase" title="Database truth metrics" />
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <MetricListCard
                  title="Top 10 Database Metrics"
                  subtitle="Auth, profile, agent, onboarding, NDA, and Plaid aggregate counts"
                  items={hushhTechDatabaseMetrics}
                  onItemClick={(item) => openHushhTechDetail(`HushhTech Database · ${item.label}`, item)}
                />
                <MetricListCard
                  title="Database Range Summary"
                  subtitle={hushhTechRangeLabel}
                  items={hushhTechDailySummaryMetrics}
                  onItemClick={(item) => openHushhTechDetail(`HushhTech Database Range · ${item.label}`, item)}
                />
              </div>
              <div className="mt-4">
                <DailyStatusTable rows={hushhTechDailyStatus} />
              </div>
            </section>

            <section className={cn(dashboardBand, 'grid grid-cols-1 gap-4 xl:grid-cols-[1.55fr_0.95fr]')}>
              <div className={cn(appleCard, 'p-5')}>
                <SectionHeader kicker="Traffic" title="Ecosystem activity" />
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  {platforms.map((platform) => (
                    <span key={platform.name} className="inline-flex min-h-8 items-center gap-2 rounded-full bg-[#f5f5f7] px-3 text-xs font-bold text-[#6e6e73]">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: platform.color }} />
                      {platform.name}
                    </span>
                  ))}
                </div>
                <div className="h-[340px] w-full">
                  {trafficData.length === 0 ? (
                    <EmptyState>No time-series aggregate rows available yet.</EmptyState>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={trafficData} margin={{ top: 16, right: 8, left: -18, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorAi" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#007aff" stopOpacity={0.18} />
                            <stop offset="95%" stopColor="#007aff" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="colorKai" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#34c759" stopOpacity={0.2} />
                            <stop offset="95%" stopColor="#34c759" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="colorKaiProd" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#12b5cb" stopOpacity={0.18} />
                            <stop offset="95%" stopColor="#12b5cb" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="colorTech" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#af52de" stopOpacity={0.18} />
                            <stop offset="95%" stopColor="#af52de" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="#ececf0" vertical={false} />
                        <XAxis dataKey="time" stroke="#86868b" fontSize={12} fontWeight={700} tickLine={false} axisLine={false} dy={10} />
                        <YAxis stroke="#86868b" fontSize={12} fontWeight={700} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}`} dx={-10} />
                        <Tooltip content={<CustomTooltip />} />
                        <Area type="monotone" dataKey="ai" name="hushh.ai" stroke="#007aff" strokeWidth={2.5} fill="url(#colorAi)" />
                        <Area type="monotone" dataKey="kaiProd" name="one.hushh.ai prod events" stroke="#12b5cb" strokeWidth={2.5} fill="url(#colorKaiProd)" />
                        <Area type="monotone" dataKey="tech" name="hushhtech.com" stroke="#af52de" strokeWidth={2.5} fill="url(#colorTech)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4">
                <MetricListCard title="hushh.ai GCP" subtitle="Cloud Run service metrics" items={hushhAiOpsMetrics} />
                <MetricListCard title="hushh.ai Search" subtitle="Search Console export metrics" items={hushhAiSearchMetrics} />
                <MetricListCard
                  title="hushhtech.com Audience"
                  subtitle="Public endpoint audience and traffic"
                  items={hushhTechAudienceMetrics}
                  onItemClick={(item) => openHushhTechDetail(`HushhTech Audience · ${item.label}`, item)}
                />
                <MetricListCard
                  title="Search + Ops"
                  subtitle="Search Console, GA4, and Cloud Run"
                  items={hushhTechOpsMetrics}
                  onItemClick={(item) => openHushhTechDetail(`HushhTech Search + Ops · ${item.label}`, item)}
                />
              </div>
            </section>

            <section className={cn(dashboardBand, 'grid grid-cols-1 gap-4 lg:grid-cols-3')}>
              <div className={cn(appleCard, 'p-5')}>
                <h3 className="mb-4 text-lg font-semibold text-[#1d1d1f]">Search Surfaces</h3>
                {acquisitionChannels.length === 0 ? (
                  <EmptyState>Waiting on first-party search or Search Console dimensions.</EmptyState>
                ) : (
                  <>
                    <div className="relative mb-4 h-[210px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={acquisitionChannels} innerRadius={62} outerRadius={88} paddingAngle={2} dataKey="value" stroke="none">
                            {acquisitionChannels.map((entry) => (
                              <Cell key={entry.name} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip content={<CustomTooltip />} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-2xl font-semibold text-[#1d1d1f]">100%</span>
                        <span className="text-xs font-bold text-[#86868b]">Total</span>
                      </div>
                    </div>
                    <div className="space-y-3">
                      {acquisitionChannels.map((channel) => (
                        <div key={channel.name} className="flex items-center justify-between gap-3">
                          <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-[#1d1d1f]">
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: channel.color }} />
                            <span className="truncate">{channel.name}</span>
                          </span>
                          <span className="text-sm font-bold text-[#6e6e73]">{channel.value}%</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div className={cn(appleCard, 'p-5')}>
                <h3 className="mb-4 text-lg font-semibold text-[#1d1d1f]">Top Regions</h3>
                {topCountries.length === 0 ? (
                  <EmptyState>No public-safe country or state rows yet.</EmptyState>
                ) : (
                  <div className="space-y-5">
                    {topCountries.map((country) => (
                      <div key={country.name}>
                        <div className="mb-2 flex items-end justify-between gap-3">
                          <span className="text-sm font-semibold text-[#1d1d1f]">{country.name}</span>
                          <span className="text-sm font-bold text-[#6e6e73]">{country.visitors}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-[#f5f5f7]">
                          <div className="h-full rounded-full bg-[#007aff]" style={{ width: `${country.percentage}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className={cn(appleCard, 'p-5')}>
                <h3 className="text-lg font-semibold text-[#1d1d1f]">Daily Active Users</h3>
                <p className="mt-1 text-sm font-medium text-[#86868b]">Production public feed, past 7 days</p>
                <div className="mt-5 h-[250px]">
                  {dailyActiveUsers.length === 0 ? (
                    <EmptyState>No One daily active user rows available yet.</EmptyState>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dailyActiveUsers} margin={{ top: 12, right: 6, left: -22, bottom: 0 }}>
                        <CartesianGrid stroke="#ececf0" vertical={false} />
                        <XAxis dataKey="day" stroke="#86868b" fontSize={12} fontWeight={700} tickLine={false} axisLine={false} dy={10} />
                        <YAxis stroke="#86868b" fontSize={12} fontWeight={700} tickLine={false} axisLine={false} tickFormatter={formatAxisValue} dx={-10} />
                        <Tooltip cursor={{ fill: '#f5f5f7' }} content={<CustomTooltip />} />
                        <Bar dataKey="users" name="Users" fill="#34c759" radius={[6, 6, 0, 0]} barSize={24} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </section>

            <section className={cn(dashboardBand, 'grid grid-cols-1 gap-4 lg:grid-cols-3')}>
              <MetricListCard
                title="Usage Snapshot"
                subtitle="Latest production feed usage rows"
                items={kaiUsageMetrics}
                onItemClick={(item) => openKaiProductionDetail(`Production Usage · ${item.label}`, item)}
              />
            </section>

            <section className={cn(dashboardBand, 'grid grid-cols-1 gap-4 lg:grid-cols-2')}>
              <MetricListCard
                title="hushhtech.com Funnel"
                subtitle="Supabase business funnel aggregates"
                items={hushhTechBusinessMetrics}
                onItemClick={(item) => openHushhTechDetail(`HushhTech Funnel · ${item.label}`, item)}
              />
              <MetricListCard
                title="hushhtech.com Activity"
                subtitle="Pages, routes, and event aggregates"
                items={hushhTechActivityMetrics}
                onItemClick={(item) => openHushhTechDetail(`HushhTech Activity · ${item.label}`, item)}
              />
            </section>

            <section className={cn(dashboardBand, 'grid grid-cols-1 gap-4 lg:grid-cols-2')}>
              <MetricListCard
                title="hushhtech.com Funnel Detail"
                subtitle="Signup, onboarding, KYC, profile, and chat steps"
                items={hushhTechFunnelMetrics}
                onItemClick={(item) => openHushhTechDetail(`HushhTech Funnel Detail · ${item.label}`, item)}
              />
              <MetricListCard
                title="Data Coverage"
                subtitle="Connected provider coverage"
                items={hushhTechCoverageMetrics}
                onItemClick={(item) => openHushhTechDetail(`HushhTech Coverage · ${item.label}`, item)}
              />
            </section>
          </main>
        ) : (
          <main className="space-y-10">
            <section className={dashboardBand}>
              <SectionHeader kicker="Platforms" title="Source health" />
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                {platforms.map((platform) => (
                  <div key={platform.name}>
                    <PlatformCard platform={platform} />
                  </div>
                ))}
              </div>
            </section>

            <section className={cn(dashboardBand, 'grid grid-cols-1 gap-4 lg:grid-cols-2')}>
              <StepReachCard title="Investor Journey Step Reach" steps={investorFunnel} />
              <StepReachCard title="RIA Journey Step Reach" steps={riaFunnel} />
            </section>

            <section className={cn(dashboardBand, 'grid grid-cols-1 gap-4 lg:grid-cols-3')}>
              <MetricListCard
                title="Activation Rates"
                subtitle="Activated ÷ entered over 30 days; Waiting when the entry step is absent"
                items={kaiActivationMetrics}
                onItemClick={(item) => openKaiProductionDetail(`Production Activation · ${item.label}`, item)}
              />
              <MetricListCard
                title="Monthly Active Device Mix"
                subtitle="Distinct devices by platform · 30 days to the latest finalized export"
                items={platformMix}
                onItemClick={(item) => openKaiProductionDetail(`Production Platform Mix · ${item.label}`, item)}
              />
              <MetricListCard
                title="Feature Engagement"
                subtitle="Governed feature events"
                items={featureEngagement}
                onItemClick={(item) => openKaiProductionDetail(`Production Feature Engagement · ${item.label}`, item)}
              />
            </section>

            <section className={cn(dashboardBand, 'grid grid-cols-1 gap-4 lg:grid-cols-3')}>
              <MetricListCard
                title="Instrumentation Health"
                subtitle="Governed event schema coverage"
                items={instrumentationHealth}
                onItemClick={(item) => openKaiProductionDetail(`Production Instrumentation · ${item.label}`, item)}
              />
              <MetricListCard title="hushh.ai GCP" subtitle="Cloud Run service metrics" items={hushhAiOpsMetrics} />
              <MetricListCard
                title="hushhtech.com Database"
                subtitle="Top Supabase aggregate counts"
                items={hushhTechDatabaseMetrics}
                onItemClick={(item) => openHushhTechDetail(`HushhTech Database · ${item.label}`, item)}
              />
              <MetricListCard
                title="hushhtech.com Coverage"
                subtitle="Connected provider coverage"
                items={hushhTechCoverageMetrics}
                onItemClick={(item) => openHushhTechDetail(`HushhTech Coverage · ${item.label}`, item)}
              />
            </section>
          </main>
        )}
      </div>

      <MetricDetailDialog detail={metricDetail} onClose={closeMetricDetail} />
      <HusshInsightsAgent />
    </div>
  );
}
