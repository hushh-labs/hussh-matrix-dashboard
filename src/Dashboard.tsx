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
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { fetchAllAnalytics, formatNumber } from './lib/analytics-service';
import { cn } from './lib/utils';
import type {
  BreakdownMetric,
  DashboardData,
  FunnelStep,
  HushhAiDailyStatusPoint,
  HushhAiFreshness,
  HushhAiFreshnessSource,
  KaiDailyStatusPoint,
  KpiStat,
  PlatformStatus,
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

const formatAxisValue = (value: number) => (value >= 1000 ? `${value / 1000}k` : `${value}`);
const oneDayMs = 86_400_000;

type DatePreset = 7 | 14 | 30 | 90;

interface HushhAiDateRangeState {
  preset: DatePreset | 'custom';
  startDate: string;
  endDate: string;
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
  if (source.state === 'live') return 'bg-[#ecfdf3] text-[#1f7a36]';
  if (source.state === 'near_live') return 'bg-[#e8f2ff] text-[#005eb8]';
  if (source.state === 'collecting_not_ingested') return 'bg-[#f4edff] text-[#6d38a8]';
  if (source.state === 'delayed' || source.state === 'waiting') return 'bg-[#fff7e6] text-[#9a5b00]';
  return 'bg-[#f5f5f7] text-[#6e6e73]';
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
              <span className="ml-auto font-semibold text-[#1d1d1f]">{entry.value}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EmptyState({ children }: { children: string }) {
  return (
    <div className="flex min-h-[160px] items-center justify-center rounded-lg border border-dashed border-black/10 bg-[#f5f5f7] px-4 text-center text-sm font-semibold text-[#86868b]">
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
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#86868b]">{kicker}</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-[-0.01em] text-[#1d1d1f]">{title}</h2>
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
      className="min-h-[154px] rounded-lg border border-black/5 bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_12px_32px_rgba(0,0,0,0.05)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#f5f5f7] text-[#007aff]">
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
          <p className="text-4xl font-semibold tracking-[-0.04em] text-[#1d1d1f]">{stat.value}</p>
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
}: {
  title: string;
  subtitle: string;
  items: BreakdownMetric[];
}) {
  return (
    <div className="rounded-lg border border-black/5 bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
      <div className="mb-5">
        <h3 className="text-lg font-semibold tracking-[-0.01em] text-[#1d1d1f]">{title}</h3>
        <p className="mt-1 text-sm font-medium text-[#86868b]">{subtitle}</p>
      </div>
      {items.length === 0 ? (
        <EmptyState>No aggregate rows available yet.</EmptyState>
      ) : (
        <div className="divide-y divide-black/5">
          {items.map((item) => {
            const isMissingMetric = item.label.startsWith('Missing');
            const valueColor = isMissingMetric && item.value > 0 ? 'text-[#b25000]' : 'text-[#1d1d1f]';
            return (
              <div key={`${item.label}-${item.detail ?? ''}`} className="flex min-h-14 items-center justify-between gap-4 py-3">
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
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DateRangeControl({
  range,
  onPreset,
  onCustomRange,
  ariaLabelPrefix = 'Product',
}: {
  range: HushhAiDateRangeState;
  onPreset: (days: DatePreset) => void;
  onCustomRange: (next: HushhAiDateRangeState) => void;
  ariaLabelPrefix?: string;
}) {
  const today = toDateInputValue(new Date());
  const presets: DatePreset[] = [7, 14, 30, 90];

  return (
    <div className="flex w-full flex-col gap-2 rounded-lg border border-black/5 bg-white p-2 shadow-sm md:w-auto">
      <div className="inline-flex rounded-full bg-[#f5f5f7] p-1">
        {presets.map((days) => (
          <button
            key={days}
            onClick={() => onPreset(days)}
            className={cn(
              'min-h-9 flex-1 rounded-full px-3 text-xs font-bold transition md:flex-none',
              range.preset === days ? 'bg-white text-[#1d1d1f] shadow-sm' : 'text-[#6e6e73] hover:text-[#1d1d1f]',
            )}
          >
            {days}D
          </button>
        ))}
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
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-black/5 bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
      <div className="mb-5">
        <h3 className="text-lg font-semibold tracking-[-0.01em] text-[#1d1d1f]">{title}</h3>
        <p className="mt-1 text-sm font-medium text-[#86868b]">{subtitle}</p>
      </div>
      <div className="h-[300px] w-full">{children}</div>
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
    <div className="rounded-lg border border-black/5 bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#86868b]">{kicker}</p>
          <h3 className="mt-1 text-xl font-semibold tracking-[-0.02em] text-[#1d1d1f]">{title} · auto-updating every {refreshSeconds}s</h3>
          <p className="mt-2 text-sm font-medium leading-6 text-[#6e6e73]">
            Last dashboard pull: {formatTimestamp(lastUpdated)} · {formatAge(lastUpdated)}
          </p>
        </div>
        <button
          onClick={onToggleAutoRefresh}
          className={cn(
            'inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-bold transition',
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
          <div key={source.key} className="rounded-lg border border-black/5 bg-[#fbfbfd] p-4">
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
    <div className="rounded-lg border border-black/5 bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
      <div className="mb-5">
        <h3 className="text-lg font-semibold tracking-[-0.01em] text-[#1d1d1f]">Daily Status</h3>
        <p className="mt-1 text-sm font-medium text-[#86868b]">Users, sessions, exits, traffic, and latency by date</p>
      </div>
      {rows.length === 0 ? (
        <EmptyState>No Hushh AI daily rows available yet.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-[920px] w-full border-separate border-spacing-0 text-left text-sm">
            <thead>
              <tr className="text-xs font-bold uppercase tracking-[0.1em] text-[#86868b]">
                <th className="border-b border-black/5 py-3 pr-4">Date</th>
                <th className="border-b border-black/5 px-4 py-3 text-right">Total</th>
                <th className="border-b border-black/5 px-4 py-3 text-right">New</th>
                <th className="border-b border-black/5 px-4 py-3 text-right">Active</th>
                <th className="border-b border-black/5 px-4 py-3 text-right">Sessions</th>
                <th className="border-b border-black/5 px-4 py-3 text-right">Avg Session</th>
                <th className="border-b border-black/5 px-4 py-3 text-right">Exit Signals</th>
                <th className="border-b border-black/5 px-4 py-3 text-right">Requests</th>
                <th className="border-b border-black/5 py-3 pl-4 text-right">P95</th>
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
                  <td className="border-b border-black/5 px-4 py-3 text-right">{formatNumber(row.requests)}</td>
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

function KaiDailyStatusTable({ rows }: { rows: KaiDailyStatusPoint[] }) {
  return (
    <div className="rounded-lg border border-black/5 bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
      <div className="mb-5">
        <h3 className="text-lg font-semibold tracking-[-0.01em] text-[#1d1d1f]">Kai Daily Status</h3>
        <p className="mt-1 text-sm font-medium text-[#86868b]">Production users, sessions, events, requests, and reliability by date</p>
      </div>
      {rows.length === 0 ? (
        <EmptyState>No Kai production daily rows available yet.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-[860px] w-full border-separate border-spacing-0 text-left text-sm">
            <thead>
              <tr className="text-xs font-bold uppercase tracking-[0.1em] text-[#86868b]">
                <th className="border-b border-black/5 py-3 pr-4">Date</th>
                <th className="border-b border-black/5 px-4 py-3 text-right">Users</th>
                <th className="border-b border-black/5 px-4 py-3 text-right">Sessions</th>
                <th className="border-b border-black/5 px-4 py-3 text-right">Events</th>
                <th className="border-b border-black/5 px-4 py-3 text-right">Requests</th>
                <th className="border-b border-black/5 px-4 py-3 text-right">Non-2xx</th>
                <th className="border-b border-black/5 px-4 py-3 text-right">Error Rate</th>
                <th className="border-b border-black/5 py-3 pl-4 text-right">P95</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.date} className="font-semibold text-[#1d1d1f]">
                  <td className="border-b border-black/5 py-3 pr-4 text-[#6e6e73]">{row.date}</td>
                  <td className="border-b border-black/5 px-4 py-3 text-right">{formatNumber(row.users)}</td>
                  <td className="border-b border-black/5 px-4 py-3 text-right">{formatNumber(row.sessions)}</td>
                  <td className="border-b border-black/5 px-4 py-3 text-right">{formatNumber(row.events)}</td>
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

function FunnelCard({ title, steps }: { title: string; steps: FunnelStep[] }) {
  const maxUsers = Math.max(...steps.map((step) => step.users), 1);

  return (
    <div className="rounded-lg border border-black/5 bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
      <div className="mb-5">
        <h3 className="text-lg font-semibold tracking-[-0.01em] text-[#1d1d1f]">{title}</h3>
        <p className="mt-1 text-sm font-medium text-[#86868b]">Latest feed day</p>
      </div>
      {steps.length === 0 ? (
        <EmptyState>No funnel rows available yet.</EmptyState>
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
    <div className="rounded-lg border border-black/5 bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: platform.color }} />
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold tracking-[-0.01em] text-[#1d1d1f]">{platform.name}</h3>
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
        <div className="rounded-lg bg-[#f5f5f7] p-4">
          <p className="text-xs font-bold uppercase tracking-[0.1em] text-[#86868b]">Visitors</p>
          <p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-[#1d1d1f]">{platform.visitors}</p>
        </div>
        <div className="rounded-lg bg-[#f5f5f7] p-4">
          <p className="text-xs font-bold uppercase tracking-[0.1em] text-[#86868b]">Change</p>
          <p className="mt-2 text-base font-bold text-[#248a3d]">{platform.change}</p>
        </div>
        <div className="rounded-lg bg-[#f5f5f7] p-4">
          <p className="text-xs font-bold uppercase tracking-[0.1em] text-[#86868b]">Sessions</p>
          <p className="mt-2 text-base font-bold text-[#1d1d1f]">{platform.avgSession}</p>
        </div>
        <div className="rounded-lg bg-[#f5f5f7] p-4">
          <p className="text-xs font-bold uppercase tracking-[0.1em] text-[#86868b]">Health</p>
          <p className="mt-2 text-base font-bold text-[#1d1d1f]">{platform.bounceRate}</p>
        </div>
      </div>

    </div>
  );
}

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<'overview' | 'platforms'>('overview');
  const [kaiRange, setKaiRange] = useState<HushhAiDateRangeState>(() => rangeForPreset(7));
  const [hushhAiRange, setHushhAiRange] = useState<HushhAiDateRangeState>(() => rangeForPreset(7));
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [usingMock, setUsingMock] = useState(false);

  const loadData = useCallback(async (options: { background?: boolean } = {}) => {
    if (options.background) {
      setIsRefreshing(true);
    } else {
      setLoading(true);
    }
    const result = await fetchAllAnalytics({
      kaiStartDate: kaiRange.startDate,
      kaiEndDate: kaiRange.endDate,
      hushhAiStartDate: hushhAiRange.startDate,
      hushhAiEndDate: hushhAiRange.endDate,
    });
    setUsingMock(Boolean(result.error));
    setData(result);
    setLoading(false);
    setIsRefreshing(false);
  }, [hushhAiRange.endDate, hushhAiRange.startDate, kaiRange.endDate, kaiRange.startDate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const liveRefreshSeconds = Math.min(
    data?.kaiProduction?.freshness?.refreshIntervalSeconds ?? 30,
    data?.hushhAi?.freshness?.refreshIntervalSeconds ?? 30,
  );

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const refreshId = window.setInterval(() => {
      void loadData({ background: true });
    }, liveRefreshSeconds * 1000);
    return () => window.clearInterval(refreshId);
  }, [autoRefresh, liveRefreshSeconds, loadData]);

  const platforms = data?.platforms ?? [];
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

  return (
    <div className="min-h-screen bg-[#f5f5f7] text-[#1d1d1f] selection:bg-[#cce4ff] selection:text-[#003b76]">
      {loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#f5f5f7]/80 backdrop-blur-xl">
          <div className="flex items-center gap-3 rounded-full border border-black/5 bg-white px-5 py-3 shadow-xl">
            <Loader2 className="h-5 w-5 animate-spin text-[#007aff]" />
            <p className="text-sm font-bold text-[#1d1d1f]">Loading live metrics</p>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-[1180px] px-4 pb-10 pt-4 sm:px-6 sm:pb-12 sm:pt-6 lg:px-8">
        <div className="sticky top-3 z-30 mb-6 rounded-lg border border-white/70 bg-white/78 p-2 shadow-[0_8px_24px_rgba(0,0,0,0.08)] backdrop-blur-2xl">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className={cn(
              'flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-bold',
              usingMock ? 'bg-[#f5f5f7] text-[#6e6e73]' : 'bg-[#ecfdf3] text-[#1f7a36]',
            )}>
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span className="min-w-0">{statusText}</span>
            </div>
            <button
              onClick={() => loadData()}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#007aff] px-4 text-sm font-bold text-white shadow-[0_6px_18px_rgba(0,122,255,0.25)] transition hover:bg-[#006adc]"
            >
              <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />
              Refresh
            </button>
          </div>
        </div>

        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-lg border border-black/5 bg-white shadow-sm">
              <span className="text-3xl" aria-label="Hussh logo">🤫</span>
            </div>
            <p className="text-sm font-bold uppercase tracking-[0.14em] text-[#86868b]">Hussh Matrix</p>
            <h1 className="mt-2 max-w-3xl text-4xl font-semibold tracking-[-0.05em] text-[#1d1d1f] sm:text-5xl lg:text-6xl">
              Analytics control center
            </h1>
            <p className="mt-4 max-w-2xl text-base font-medium leading-7 text-[#6e6e73] sm:text-lg">
              Live aggregate metrics for kai.hushh.ai, hushhtech.com, and hushh.ai with provider health surfaced inline.
            </p>
          </div>

          <div className="inline-flex w-full rounded-full bg-[#e8e8ed] p-1 md:w-auto" role="tablist" aria-label="Dashboard sections">
            {(['overview', 'platforms'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'min-h-11 flex-1 rounded-full px-5 text-sm font-bold capitalize transition md:flex-none',
                  activeTab === tab
                    ? 'bg-white text-[#1d1d1f] shadow-sm'
                    : 'text-[#6e6e73] hover:text-[#1d1d1f]',
                )}
              >
                {tab}
              </button>
            ))}
          </div>
        </header>

        {activeTab === 'overview' ? (
          <main className="space-y-8">
            <section>
              <SectionHeader kicker="Today" title="Key metrics" />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {kpiStats.map((stat, index) => (
                  <div key={stat.label}>
                    <MetricCard stat={stat} index={index} />
                  </div>
                ))}
              </div>
            </section>

            <section>
              <SectionHeader
                kicker="kai.hushh.ai"
                title="Production daily status matrix"
                action={(
                  <DateRangeControl
                    range={kaiRange}
                    onPreset={(days) => setKaiRange(rangeForPreset(days))}
                    onCustomRange={setKaiRange}
                    ariaLabelPrefix="Kai production"
                  />
                )}
              />
              <div className="mb-4">
                <ProductLivePanel
                  kicker="Kai live mode"
                  title="Fresh on refresh"
                  refreshingLabel="Refreshing Kai production sources"
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
                />
                <ChartShell title="Users, Sessions, Events" subtitle="Production GA4 export; shows waiting until analytics_526603671 materializes">
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
                <ChartShell title="Production Traffic + Reliability" subtitle="Cloud Run requests, non-2xx responses, and latency context">
                  {kaiProductionDailyStatus.length === 0 ? (
                    <EmptyState>No Kai production traffic rows available yet.</EmptyState>
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
                        <Area type="monotone" dataKey="errors" name="Non-2xx" stroke="#ff3b30" strokeWidth={2.5} fill="url(#kaiProdErrors)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </ChartShell>
                <MetricListCard title="Production Readiness" subtitle="GA4 export, production feed, and UAT validation context" items={kaiProductionReadinessMetrics} />
                <div className="xl:col-span-2">
                  <KaiDailyStatusTable rows={kaiProductionDailyStatus} />
                </div>
              </div>
            </section>

            <section>
              <SectionHeader
                kicker="hushh.ai"
                title="Analytics status matrix"
                action={(
                  <DateRangeControl
                    range={hushhAiRange}
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
                <ChartShell title="Traffic + Reliability" subtitle="Cloud Run requests, non-2xx responses, and latency context">
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
                        <Area type="monotone" dataKey="errors" name="Non-2xx" stroke="#ff3b30" strokeWidth={2.5} fill="url(#hushhAiErrors)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </ChartShell>
              </div>
            </section>

            <section>
              <SectionHeader kicker="hushhtech.com" title="Complete report" />
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <MetricListCard title="Total Report" subtitle="Users, funnel, search, infra, and stored aggregates" items={hushhTechReportTotals} />
                <MetricListCard title="Last 7 Days" subtitle="DAU, WAU, MAU, sessions, views, events, and engagement" items={hushhTechSevenDayMetrics} />
              </div>
            </section>

            <section>
              <SectionHeader kicker="hushhtech.com Supabase" title="Database truth metrics" />
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <MetricListCard title="Top 10 Database Metrics" subtitle="Auth, profile, agent, onboarding, NDA, and Plaid aggregate counts" items={hushhTechDatabaseMetrics} />
                <MetricListCard title="Database Range Summary" subtitle={hushhTechRangeLabel} items={hushhTechDailySummaryMetrics} />
              </div>
              <div className="mt-4">
                <DailyStatusTable rows={hushhTechDailyStatus} />
              </div>
            </section>

            <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.55fr_0.95fr]">
              <div className="rounded-lg border border-black/5 bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
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
                        <Area type="monotone" dataKey="kai" name="kai.hushh.ai" stroke="#34c759" strokeWidth={2.5} fill="url(#colorKai)" />
                        <Area type="monotone" dataKey="tech" name="hushhtech.com" stroke="#af52de" strokeWidth={2.5} fill="url(#colorTech)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4">
                <MetricListCard title="hushh.ai GCP" subtitle="Cloud Run service metrics" items={hushhAiOpsMetrics} />
                <MetricListCard title="hushh.ai Search" subtitle="Search Console export metrics" items={hushhAiSearchMetrics} />
                <MetricListCard title="hushhtech.com Audience" subtitle="Public endpoint audience and traffic" items={hushhTechAudienceMetrics} />
                <MetricListCard title="Search + Ops" subtitle="Search Console, GA4, and Cloud Run" items={hushhTechOpsMetrics} />
              </div>
            </section>

            <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="rounded-lg border border-black/5 bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
                <h3 className="mb-4 text-lg font-semibold tracking-[-0.01em] text-[#1d1d1f]">Search Surfaces</h3>
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
                        <span className="text-2xl font-semibold tracking-[-0.04em] text-[#1d1d1f]">100%</span>
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

              <div className="rounded-lg border border-black/5 bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
                <h3 className="mb-4 text-lg font-semibold tracking-[-0.01em] text-[#1d1d1f]">Top Regions</h3>
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

              <div className="rounded-lg border border-black/5 bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
                <h3 className="text-lg font-semibold tracking-[-0.01em] text-[#1d1d1f]">Kai Active Users</h3>
                <p className="mt-1 text-sm font-medium text-[#86868b]">Past 7 days</p>
                <div className="mt-5 h-[250px]">
                  {dailyActiveUsers.length === 0 ? (
                    <EmptyState>No Kai daily active user rows available yet.</EmptyState>
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

            <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <MetricListCard title="Kai GA4 Events" subtitle="Raw GA4 export, top events" items={kaiEventMetrics} />
              <MetricListCard title="Kai Geo + Device" subtitle="Country, device, and platform mix" items={kaiGeoMetrics} />
              <MetricListCard title="Kai Usage Snapshot" subtitle="Latest public feed usage rows" items={kaiUsageMetrics} />
            </section>

            <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <MetricListCard title="hushhtech.com Funnel" subtitle="Supabase business funnel aggregates" items={hushhTechBusinessMetrics} />
              <MetricListCard title="hushhtech.com Activity" subtitle="Pages, routes, and event aggregates" items={hushhTechActivityMetrics} />
            </section>

            <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <MetricListCard title="hushhtech.com Funnel Detail" subtitle="Signup, onboarding, KYC, profile, and chat steps" items={hushhTechFunnelMetrics} />
              <MetricListCard title="Data Coverage" subtitle="Connected provider coverage" items={hushhTechCoverageMetrics} />
            </section>
          </main>
        ) : (
          <main className="space-y-8">
            <section>
              <SectionHeader kicker="Platforms" title="Source health" />
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                {platforms.map((platform) => (
                  <div key={platform.name}>
                    <PlatformCard platform={platform} />
                  </div>
                ))}
              </div>
            </section>

            <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <FunnelCard title="Investor Funnel" steps={investorFunnel} />
              <FunnelCard title="RIA Funnel" steps={riaFunnel} />
            </section>

            <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <MetricListCard title="Activation Rates" subtitle="Investor and RIA activation" items={kaiActivationMetrics} />
              <MetricListCard title="Platform Mix" subtitle="Users by platform, latest feed day" items={platformMix} />
              <MetricListCard title="Feature Engagement" subtitle="Governed feature events" items={featureEngagement} />
            </section>

            <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <MetricListCard title="Instrumentation Health" subtitle="Governed event schema coverage" items={instrumentationHealth} />
              <MetricListCard title="hushh.ai GCP" subtitle="Cloud Run service metrics" items={hushhAiOpsMetrics} />
              <MetricListCard title="hushhtech.com Database" subtitle="Top Supabase aggregate counts" items={hushhTechDatabaseMetrics} />
              <MetricListCard title="hushhtech.com Coverage" subtitle="Connected provider coverage" items={hushhTechCoverageMetrics} />
            </section>
          </main>
        )}
      </div>
    </div>
  );
}
