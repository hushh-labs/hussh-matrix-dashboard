import { motion } from 'motion/react';
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Clock,
  ExternalLink,
  Globe,
  Loader2,
  MapPin,
  MousePointerClick,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  TrendingUp,
  Users,
  XCircle,
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
import type { BreakdownMetric, DashboardData, FunnelStep, KpiStat, PlatformStatus } from './lib/types';

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
                  <XCircle className="h-3.5 w-3.5 text-[#b25000]" />
                  <span className="text-[#b25000]">{platform.environment.toUpperCase()} pending</span>
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

      {platform.knownBlockers && (
        <p className="mt-4 rounded-lg border border-[#ffd8a8] bg-[#fff8eb] px-3 py-2 text-xs font-semibold text-[#9a4f00]">
          {platform.knownBlockers}
        </p>
      )}
    </div>
  );
}

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<'overview' | 'platforms'>('overview');
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [usingMock, setUsingMock] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    const result = await fetchAllAnalytics();
    setUsingMock(Boolean(result.error));
    setData(result);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const platforms = data?.platforms ?? [];
  const kpiStats = data?.kpiStats ?? [];
  const trafficData = data?.trafficData ?? [];
  const acquisitionChannels = data?.acquisitionChannels ?? [];
  const topCountries = data?.topCountries ?? [];
  const dailyActiveUsers = data?.kaiDailyUsage ?? [];
  const investorFunnel = data?.kaiInvestorFunnel ?? [];
  const riaFunnel = data?.kaiRiaFunnel ?? [];
  const platformMix = data?.platformMix ?? [];
  const featureEngagement = data?.featureEngagement ?? [];
  const instrumentationHealth = data?.instrumentationHealth ?? [];
  const hushhTechAudienceMetrics = data?.hushhTechAudienceMetrics ?? [];
  const hushhTechBusinessMetrics = data?.hushhTechBusinessMetrics ?? [];
  const hushhTechOpsMetrics = data?.hushhTechOpsMetrics ?? [];
  const hushhTechCoverageMetrics = data?.hushhTechCoverageMetrics ?? [];
  const warnings = [...(data?.feedWarnings ?? []), ...(data?.dataQualityWarnings ?? [])];
  const statusText = usingMock
    ? data?.error ?? 'No live aggregate metrics are available.'
    : `Live from Kai public feed and hushhtech.com metrics${data?.kaiFeed?.productionReady === false ? ' - production not ready' : ''}`;

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
              usingMock ? 'bg-[#fff8eb] text-[#9a4f00]' : 'bg-[#ecfdf3] text-[#1f7a36]',
            )}>
              {usingMock ? <AlertCircle className="h-4 w-4 shrink-0" /> : <CheckCircle2 className="h-4 w-4 shrink-0" />}
              <span className="min-w-0">{statusText}</span>
            </div>
            <button
              onClick={loadData}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#007aff] px-4 text-sm font-bold text-white shadow-[0_6px_18px_rgba(0,122,255,0.25)] transition hover:bg-[#006adc]"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </div>

        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-lg border border-black/5 bg-white shadow-sm">
              <span className="text-2xl font-bold text-[#007aff]">H</span>
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

            <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <MetricListCard title="hushhtech.com Funnel" subtitle="Supabase business funnel aggregates" items={hushhTechBusinessMetrics} />
              <MetricListCard title="Data Coverage" subtitle="Provider availability and collection status" items={hushhTechCoverageMetrics} />
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
              <MetricListCard title="Platform Mix" subtitle="Users by platform, latest feed day" items={platformMix} />
              <MetricListCard title="Feature Engagement" subtitle="Governed feature events" items={featureEngagement} />
              <MetricListCard title="Instrumentation Health" subtitle="Missing params and stream coverage" items={instrumentationHealth} />
            </section>
          </main>
        )}

        {warnings.length > 0 && (
          <section className="mt-8 rounded-lg border border-[#ffd8a8] bg-[#fff8eb] p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <AlertCircle className="h-5 w-5 shrink-0 text-[#9a4f00]" />
              <div>
                <h3 className="text-sm font-bold text-[#6b3700]">Live data warnings</h3>
                <div className="mt-3 space-y-2">
                  {warnings.map((warning) => (
                    <p key={warning} className="text-sm font-semibold leading-6 text-[#7a4300]">{warning}</p>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
