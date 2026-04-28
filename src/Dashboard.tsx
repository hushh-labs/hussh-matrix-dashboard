import { motion } from 'motion/react';
import { Activity, Users, Globe, ExternalLink, ArrowUpRight, Clock, MousePointerClick, MapPin, TrendingUp, AlertCircle, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar } from 'recharts';
import { cn } from './lib/utils';
import { useState, useEffect, useCallback } from 'react';
import { fetchAllAnalytics, formatNumber } from './lib/analytics-service';
import type { DashboardData, PlatformStatus, KpiStat, TrafficPoint, AcquisitionChannel, CountryData, DailyActiveUser, FunnelStep, BreakdownMetric } from './lib/types';

// --- ICON MAP (for dynamic KPI rendering) ---
const iconMap: Record<string, typeof Activity> = {
  Activity, Users, Globe, Clock, MousePointerClick, MapPin, TrendingUp,
};

const formatAxisValue = (value: number) => value >= 1000 ? `${value / 1000}k` : `${value}`;

// --- FALLBACK MOCK DATA (used when API is unavailable) ---
const MOCK_PERFORMANCE: TrafficPoint[] = [
  { time: '00:00', kai: 120, tech: 80, ai: 200 },
  { time: '04:00', kai: 140, tech: 60, ai: 220 },
  { time: '08:00', kai: 450, tech: 150, ai: 500 },
  { time: '12:00', kai: 600, tech: 300, ai: 850 },
  { time: '16:00', kai: 550, tech: 400, ai: 900 },
  { time: '20:00', kai: 300, tech: 200, ai: 600 },
  { time: '23:59', kai: 180, tech: 100, ai: 300 },
];

const MOCK_PLATFORMS: PlatformStatus[] = [
  {
    name: 'hushh.ai', url: 'hushh.ai', visitors: '42.5k', change: '+12.5%',
    avgSession: '4m 12s', bounceRate: '32%', color: '#1a73e8',
    available: false, environment: 'production', productionReady: false,
    knownBlockers: 'Production GA4 export not materialized',
  },
  {
    name: 'kai.hushh.ai', url: 'kai.hushh.ai', visitors: '18.2k', change: '+34.2%',
    avgSession: '8m 45s', bounceRate: '21%', color: '#12b5cb',
    available: false, environment: 'uat', productionReady: false,
    knownBlockers: null,
  },
  {
    name: 'hushhtech.com', url: 'hushhtech.com', visitors: '9.8k', change: '+5.1%',
    avgSession: '2m 30s', bounceRate: '45%', color: '#9334e6',
    available: false, environment: 'production', productionReady: false,
    knownBlockers: 'Needs numeric GA4 property ID',
  },
];

const MOCK_KPI: KpiStat[] = [
  { label: 'Total Engagement', value: '70.5k', icon: 'Activity', change: '+18.2%' },
  { label: 'Active Sessions', value: '1,248', icon: 'Users', change: '+5.4%' },
  { label: 'Monthly Users', value: '142', icon: 'Globe', suffix: 'MAU' },
  { label: 'Data Freshness', value: '—', icon: 'Clock', suffix: 'lag' },
  { label: 'DAU/MAU Stickiness', value: '4.2%', icon: 'MousePointerClick' },
  { label: 'Source Events', value: '2.4M', icon: 'MapPin' },
];

const MOCK_CHANNELS: AcquisitionChannel[] = [
  { name: 'Organic Search', value: 45, color: '#1a73e8' },
  { name: 'Direct', value: 30, color: '#12b5cb' },
  { name: 'Social', value: 15, color: '#9334e6' },
  { name: 'Referral', value: 10, color: '#fbbc04' },
];

const MOCK_COUNTRIES: CountryData[] = [
  { name: 'United States', visitors: '24.5k', percentage: 35 },
  { name: 'India', visitors: '18.2k', percentage: 26 },
  { name: 'United Kingdom', visitors: '8.4k', percentage: 12 },
  { name: 'Germany', visitors: '4.2k', percentage: 6 },
  { name: 'Others', visitors: '15.2k', percentage: 21 },
];

const MOCK_DAU: DailyActiveUser[] = [
  { day: 'Mon', users: 12400 },
  { day: 'Tue', users: 14200 },
  { day: 'Wed', users: 13800 },
  { day: 'Thu', users: 15600 },
  { day: 'Fri', users: 16800 },
  { day: 'Sat', users: 18500 },
  { day: 'Sun', users: 19200 },
];

const MOCK_INVESTOR_FUNNEL: FunnelStep[] = [
  { step: 'Entered', users: 7 },
  { step: 'Auth Completed', users: 0 },
  { step: 'Vault Ready', users: 0 },
  { step: 'Onboarding Completed', users: 0 },
  { step: 'Portfolio Ready', users: 0 },
  { step: 'Activated', users: 0 },
];

const MOCK_RIA_FUNNEL: FunnelStep[] = [
  { step: 'Entered', users: 1 },
  { step: 'Auth Completed', users: 1 },
  { step: 'Profile Submitted', users: 0 },
  { step: 'Request Created', users: 0 },
  { step: 'Workspace Ready', users: 0 },
  { step: 'Activated', users: 0 },
];

const MOCK_PLATFORM_MIX: BreakdownMetric[] = [
  { label: 'Web', value: 8, detail: '12 events', percentage: 100, color: '#12b5cb' },
];

const MOCK_FEATURE_ENGAGEMENT: BreakdownMetric[] = [
  { label: 'Market Insights Loaded', value: 62, detail: 'last 8 feed days' },
  { label: 'Portfolio Viewed', value: 6, detail: 'last 8 feed days' },
];

const MOCK_INSTRUMENTATION_HEALTH: BreakdownMetric[] = [
  { label: 'Governed Events', value: 12 },
  { label: 'Missing Event Category Events', value: 0 },
  { label: 'Missing App Version Events', value: 0 },
  { label: 'Missing Journey Events', value: 0 },
  { label: 'Missing Step Events', value: 0 },
  { label: 'Missing Entry Surface Events', value: 0 },
  { label: 'Platforms Seen', value: 1 },
  { label: 'Streams Seen', value: 1 },
];

// --- COMPONENTS ---

// Custom Tooltip for Recharts to match the clean theme
const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white border border-gray-100 p-3 rounded-lg shadow-lg">
        {label && <p className="text-gray-500 text-sm font-medium mb-2">{label}</p>}
        {payload.map((entry: any, index: number) => {
          // Resolve color correctly for pie charts vs other charts
          const color = entry.color || entry.payload.fill || entry.stroke;
          return (
            <div key={index} className="flex items-center gap-2 text-sm">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-gray-600 font-medium">{entry.name}:</span>
              <span className="font-semibold text-gray-900">{entry.value}{entry.name === 'value' ? '' : ''}</span>
            </div>
          );
        })}
      </div>
    );
  }
  return null;
};

function FunnelCard({ title, steps }: { title: string; steps: FunnelStep[] }) {
  const maxUsers = Math.max(...steps.map((step) => step.users), 1);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900 tracking-tight">{title}</h3>
        <p className="text-xs font-medium text-gray-500 mt-1">Latest feed day</p>
      </div>
      <div className="space-y-4">
        {steps.map((step) => {
          const width = step.users > 0 ? Math.max((step.users / maxUsers) * 100, 6) : 0;
          return (
            <div key={step.step}>
              <div className="flex items-center justify-between gap-4 mb-2">
                <span className="text-sm font-medium text-gray-600">{step.step}</span>
                <span className="text-sm font-semibold text-gray-900">{formatNumber(step.users)}</span>
              </div>
              <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-[#12b5cb] transition-all duration-700"
                  style={{ width: `${width}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
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
    <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm flex flex-col">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900 tracking-tight">{title}</h3>
        <p className="text-xs font-medium text-gray-500 mt-1">{subtitle}</p>
      </div>
      <div className="space-y-4 mt-auto">
        {items.map((item) => {
          const isMissingMetric = item.label.startsWith('Missing');
          const valueColor = isMissingMetric && item.value > 0 ? 'text-amber-700' : 'text-gray-900';
          return (
            <div key={`${item.label}-${item.detail ?? ''}`} className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {item.color && <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />}
                  <p className="text-sm font-medium text-gray-700 truncate">{item.label}</p>
                </div>
                {item.detail && <p className="text-xs text-gray-500 mt-1">{item.detail}</p>}
              </div>
              <div className="text-right shrink-0">
                <p className={cn("text-sm font-semibold", valueColor)}>{formatNumber(item.value)}</p>
                {item.percentage != null && <p className="text-xs text-gray-500">{item.percentage}%</p>}
              </div>
            </div>
          );
        })}
      </div>
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
    if (result.error) {
      setUsingMock(true);
    } else {
      setUsingMock(false);
    }
    setData(result);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Resolve data with fallback to mock
  const platforms = data?.platforms ?? MOCK_PLATFORMS;
  const kpiStats = data?.kpiStats ?? MOCK_KPI;
  const trafficData = data?.trafficData ?? MOCK_PERFORMANCE;
  const acquisitionChannels = data?.acquisitionChannels ?? MOCK_CHANNELS;
  const topCountries = data?.topCountries ?? MOCK_COUNTRIES;
  const dailyActiveUsers = data?.kaiDailyUsage?.length ? data.kaiDailyUsage : MOCK_DAU;
  const investorFunnel = data?.kaiInvestorFunnel?.length ? data.kaiInvestorFunnel : MOCK_INVESTOR_FUNNEL;
  const riaFunnel = data?.kaiRiaFunnel?.length ? data.kaiRiaFunnel : MOCK_RIA_FUNNEL;
  const platformMix = data?.platformMix?.length ? data.platformMix : MOCK_PLATFORM_MIX;
  const featureEngagement = data?.featureEngagement?.length ? data.featureEngagement : MOCK_FEATURE_ENGAGEMENT;
  const instrumentationHealth = data?.instrumentationHealth?.length ? data.instrumentationHealth : MOCK_INSTRUMENTATION_HEALTH;

  return (
    <div className="min-h-screen bg-[#f8f9fa] text-gray-900 selection:bg-blue-100 selection:text-blue-900 p-4 md:p-8 font-sans">
      {/* Loading overlay */}
      {loading && (
        <div className="fixed inset-0 bg-white/80 z-50 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
            <p className="text-gray-600 font-medium text-sm">Loading analytics...</p>
          </div>
        </div>
      )}

      {/* Data source banner */}
      {!loading && (
        <div className={cn(
          "max-w-7xl mx-auto mb-4 px-4 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2",
          usingMock
            ? "bg-amber-50 border border-amber-200 text-amber-800"
            : "bg-green-50 border border-green-200 text-green-800"
        )}>
          {usingMock ? (
            <>
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{data?.error ?? 'Showing demo data — API server or analytics feed unavailable.'} Run <code className="bg-amber-100 px-1 rounded">npm start</code> for live metrics.</span>
            </>
          ) : (
            <>
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>
                Live data from {data?.kaiFeed?.sourceEnvironment ?? 'unknown'} feed
                {data?.lastUpdated && ` • Updated ${new Date(data.lastUpdated).toLocaleTimeString()}`}
                {data?.kaiFeed?.productionReady === false && ' • Production not ready'}
              </span>
              <button onClick={loadData} className="ml-auto text-green-600 hover:text-green-800 underline text-xs">Refresh</button>
            </>
          )}
        </div>
      )}

      {/* Header */}
      <header className="max-w-7xl mx-auto mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3"
        >
          <div className="w-10 h-10 bg-white border border-gray-200 flex items-center justify-center rounded-lg shadow-sm">
            <span className="text-blue-600 font-bold text-xl">H</span>
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Hussh Analytics</h1>
            <p className="text-gray-500 text-sm flex items-center gap-2 font-medium">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
              System Online • Powered by Hussh
            </p>
          </div>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex items-center gap-1 bg-gray-100/80 p-1 rounded-lg border border-gray-200/60"
        >
          <button 
            onClick={() => setActiveTab('overview')}
            className={cn(
              "px-4 py-2 rounded-md text-sm font-medium transition-all",
              activeTab === 'overview' 
                ? "bg-white text-gray-900 shadow-sm border border-gray-200/50" 
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-200/50"
            )}
          >
            Overview
          </button>
          <button 
            onClick={() => setActiveTab('platforms')}
            className={cn(
              "px-4 py-2 rounded-md text-sm font-medium transition-all",
              activeTab === 'platforms' 
                ? "bg-white text-gray-900 shadow-sm border border-gray-200/50" 
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-200/50"
            )}
          >
            Platforms
          </button>
        </motion.div>
      </header>

      <main className="max-w-7xl mx-auto space-y-6">
        {/* KPI Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {kpiStats.map((stat, i) => {
            const IconComponent = iconMap[stat.icon] ?? Activity;
            return (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow group flex flex-col"
            >
              <div className="flex justify-between items-start mb-4">
                <div className="p-2.5 bg-blue-50 text-blue-600 rounded-lg group-hover:bg-blue-100 transition-colors">
                  <IconComponent className="w-5 h-5" strokeWidth={2.5} />
                </div>
                {stat.change && (
                  <span className="flex items-center text-xs font-semibold text-green-700 bg-green-50 border border-green-100 px-2 py-0.5 rounded-md mt-1">
                    <ArrowUpRight className="w-3 h-3 mr-0.5" strokeWidth={3} />
                    {stat.change}
                  </span>
                )}
              </div>
              <div className="mt-auto">
                <p className="text-gray-500 text-sm font-medium mb-1">{stat.label}</p>
                <div className="flex items-baseline gap-1">
                  <h3 className="text-2xl font-semibold text-gray-900 tracking-tight">{stat.value}</h3>
                  {stat.suffix && <span className="text-gray-500 font-medium text-sm ml-1">{stat.suffix}</span>}
                </div>
              </div>
            </motion.div>
            );
          })}
        </div>

        {/* Chart Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm"
        >
          <div className="mb-8 flex flex-col sm:flex-row sm:justify-between sm:items-end gap-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Network Traffic</h2>
              <p className="text-gray-500 text-sm font-medium">Real-time engagement across the Hussh ecosystem</p>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm font-medium text-gray-600">
              {platforms.map((p) => (
                <div key={p.name} className="flex items-center gap-2 flex-nowrap">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color }}></div>
                  <span className="whitespace-nowrap">{p.name}</span>
                </div>
              ))}
            </div>
          </div>
          
          <div className="h-[360px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trafficData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorAi" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#1a73e8" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#1a73e8" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorKai" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#12b5cb" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#12b5cb" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorTech" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#9334e6" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#9334e6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 4" stroke="#f3f4f6" vertical={false} />
                <XAxis 
                  dataKey="time" 
                  stroke="#9ca3af" 
                  fontSize={12} 
                  fontWeight={500}
                  tickLine={false} 
                  axisLine={false} 
                  dy={10}
                />
                <YAxis 
                  stroke="#9ca3af" 
                  fontSize={12} 
                  fontWeight={500}
                  tickLine={false} 
                  axisLine={false} 
                  tickFormatter={(value) => `${value}`} 
                  dx={-10}
                />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="ai" name="hushh.ai" stroke="#1a73e8" strokeWidth={2.5} fillOpacity={1} fill="url(#colorAi)" />
                <Area type="monotone" dataKey="kai" name="kai.hushh.ai" stroke="#12b5cb" strokeWidth={2.5} fillOpacity={1} fill="url(#colorKai)" />
                <Area type="monotone" dataKey="tech" name="hushhtech.com" stroke="#9334e6" strokeWidth={2.5} fillOpacity={1} fill="url(#colorTech)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* Secondary Metrics Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Acquisition Channels */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
             className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm flex flex-col"
          >
             <h3 className="text-lg font-semibold text-gray-900 tracking-tight mb-6">Traffic Sources</h3>
             <div className="h-[200px] w-full mb-6 relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={acquisitionChannels}
                      innerRadius={65}
                      outerRadius={90}
                      paddingAngle={2}
                      dataKey="value"
                      stroke="none"
                    >
                      {acquisitionChannels.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex items-center justify-center flex-col pointer-events-none">
                   <span className="text-2xl font-semibold text-gray-900">100%</span>
                   <span className="text-xs font-medium text-gray-500">Total</span>
                </div>
             </div>
             <div className="space-y-4 mt-auto">
                {acquisitionChannels.map((channel) => (
                  <div key={channel.name} className="flex items-center justify-between group">
                    <div className="flex items-center gap-2">
                       <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: channel.color }}></div>
                       <span className="text-sm font-medium text-gray-600 group-hover:text-gray-900 transition-colors">{channel.name}</span>
                    </div>
                    <span className="text-sm font-semibold text-gray-900">{channel.value}%</span>
                  </div>
                ))}
             </div>
          </motion.div>

          {/* Top Countries */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
             className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm flex flex-col"
          >
             <h3 className="text-lg font-semibold text-gray-900 tracking-tight mb-6">Top Regions</h3>
             <div className="space-y-6 mt-auto">
                {topCountries.map((country) => (
                  <div key={country.name} className="group">
                    <div className="flex justify-between items-end mb-2">
                      <span className="text-sm font-medium text-gray-600 group-hover:text-gray-900 transition-colors">{country.name}</span>
                      <span className="text-sm font-semibold text-gray-900">{country.visitors}</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                      <div className="bg-blue-500 h-1.5 rounded-full transition-all duration-1000 ease-in-out" style={{ width: `${country.percentage}%` }}></div>
                    </div>
                  </div>
                ))}
             </div>
          </motion.div>

          {/* Daily Active Users */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7 }}
             className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm flex flex-col"
          >
             <div className="flex justify-between items-start mb-6">
                 <div>
                   <h3 className="text-lg font-semibold text-gray-900 tracking-tight">Active Users</h3>
                   <p className="text-xs font-medium text-gray-500 mt-1">Past 7 Days</p>
                 </div>
                 <span className="text-xs font-semibold text-green-700 bg-green-50 border border-green-100 px-2 py-1 rounded-md flex items-center gap-1">
                   <TrendingUp className="w-3 h-3" strokeWidth={2.5} />
                   +14.2%
                 </span>
             </div>
             <div className="h-[250px] w-full mt-auto">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyActiveUsers} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="4 4" stroke="#f3f4f6" vertical={false} />
                    <XAxis 
                      dataKey="day" 
                      stroke="#9ca3af" 
                      fontSize={12} 
                      fontWeight={500} 
                      tickLine={false} 
                      axisLine={false} 
                      dy={10} 
                    />
                    <YAxis 
                      stroke="#9ca3af" 
                      fontSize={12} 
                      fontWeight={500} 
                      tickLine={false} 
                      axisLine={false} 
                      tickFormatter={(value) => formatAxisValue(value)} 
                      dx={-10} 
                    />
                    <Tooltip 
                      cursor={{ fill: '#f8f9fa' }} 
                      content={<CustomTooltip />} 
                    />
                    <Bar 
                      dataKey="users" 
                      name="Users" 
                      fill="#12b5cb" 
                      radius={[4, 4, 0, 0]} 
                      barSize={24}
                    />
                  </BarChart>
                </ResponsiveContainer>
             </div>
          </motion.div>
        </div>

        {/* Growth Funnels */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8 }}
          className="grid grid-cols-1 lg:grid-cols-2 gap-6"
        >
          <FunnelCard title="Investor Funnel" steps={investorFunnel} />
          <FunnelCard title="RIA Funnel" steps={riaFunnel} />
        </motion.div>

        {/* Feed Health */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.9 }}
          className="grid grid-cols-1 lg:grid-cols-3 gap-6"
        >
          <MetricListCard title="Platform Mix" subtitle="Users by platform, latest feed day" items={platformMix} />
          <MetricListCard title="Feature Engagement" subtitle="Governed feature events" items={featureEngagement} />
          <MetricListCard title="Instrumentation Health" subtitle="Missing params and stream coverage" items={instrumentationHealth} />
        </motion.div>

        {/* Platform Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {platforms.map((platform, i) => (
            <motion.div
              key={platform.name}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.8 + (i * 0.1) }}
              className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden flex flex-col"
            >
              {/* Top color indicator */}
              <div 
                className="absolute top-0 left-0 w-full h-1" 
                style={{ backgroundColor: platform.color }}
              />
              
              <div className="flex justify-between items-center mb-8 mt-1">
                <h3 className="text-lg font-semibold text-gray-900 tracking-tight">{platform.name}</h3>
                <a href={`https://${platform.url}`} target="_blank" rel="noopener noreferrer" className="p-1.5 bg-gray-50 text-gray-400 rounded-md hover:text-gray-600 hover:bg-gray-100 transition-colors">
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>

              <div className="space-y-5 mt-auto">
                <div className="flex justify-between items-end pb-5 border-b border-gray-100">
                  <div>
                    <p className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1.5">Visitors</p>
                    <p className="text-3xl font-semibold text-gray-900 tracking-tight">{platform.visitors}</p>
                  </div>
                  <span className="text-green-700 bg-green-50 border border-green-100 font-semibold text-sm px-2.5 py-1 rounded-md">
                    {platform.change}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-1">
                  <div>
                    <p className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <Clock className="w-3 h-3" strokeWidth={2.5} /> Avg Session
                    </p>
                    <p className="font-semibold text-gray-900">{platform.avgSession}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <Activity className="w-3 h-3" strokeWidth={2.5} /> Bounce Rate
                    </p>
                    <p className="font-semibold text-gray-900">{platform.bounceRate}</p>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </main>
    </div>
  );
}
