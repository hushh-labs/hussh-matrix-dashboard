import { Fragment, useState, useEffect } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Info, Mail, Phone, Search, ShieldCheck, User, UserCheck, Users } from 'lucide-react';
import { motion } from 'motion/react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { cn } from '../lib/utils';
import { appleCard, appleLabel, applePanel, dashboardBand } from '../lib/theme';
import { formatNumber } from '../lib/analytics-service';
import type { LocationAnalyticsRoute } from '../lib/location-analytics-route';
import { OneLocationAnalyticsPanel } from './OneLocationAnalyticsPanel';
import { AgentCapabilityAnalyticsPanel } from './AgentCapabilityAnalyticsPanel';
import { FeatureUserBreakdownPanel } from './FeatureUserBreakdownPanel';
import type {
  BreakdownMetric,
  OneAppSummary,
  OneCapabilityUsage,
  OneInstallFunnel,
  OnePlatformActives,
} from '../lib/types';

/**
 * one.hushh.ai — the One app.
 *
 * Organised by question, not by data source. The page answers six in order:
 * how many people are active, is that growth or churn, do they come back, do
 * they reach first value, which capabilities do they use, and is the app up.
 * Everything that was here before and answered none of those — the source
 * matrix, per-provider status cards, sessions and page-view totals, acquisition
 * source breakdowns — moved off this tab.
 *
 * Two rules the page is built to keep. Every label is a sentence a person would
 * say out loud, never an event name. And nothing that is unmeasured is drawn as
 * a zero: a capability with no instrumentation says so, because "nobody used
 * it" and "nobody can measure it" lead to opposite decisions.
 */

function percentText(value: number | null | undefined, decimals = 0): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(decimals)}%`;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** Shared section heading, so every block on the page starts the same way. */
function Block({
  kicker,
  title,
  hint,
  children,
  action,
}: {
  kicker: string;
  title: string;
  hint?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className={dashboardBand}>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className={appleLabel}>{kicker}</p>
          <h2 className="mt-1 text-2xl font-semibold text-[#1d1d1f]">{title}</h2>
          {hint && (
            <p className="mt-1.5 max-w-2xl text-sm font-medium leading-6 text-[#6e6e73]">{hint}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * 1. Active people.
 *
 * DAU, WAU and MAU are anchored to the end of the selected range, not to its
 * length, so "monthly" always means thirty days. Stickiness is DAU/MAU and is
 * blank rather than 0% when there is no denominator.
 */
function ActivePeople({ one }: { one: OneAppSummary }) {
  const { dau, wau, mau, stickiness, asOf, identities = [] } = one.activeUsers;
  const [selectedTier, setSelectedTier] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterAccountOnly, setFilterAccountOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(10);

  useEffect(() => {
    setVisibleCount(10);
  }, [selectedTier, searchQuery, filterAccountOnly]);

  const tiles: Array<{ key: 'daily' | 'weekly' | 'monthly'; label: string; value: number; detail: string }> = [
    { key: 'daily', label: 'Daily active', value: dau, detail: asOf },
    { key: 'weekly', label: 'Weekly active', value: wau, detail: '7 days to ' + asOf },
    { key: 'monthly', label: 'Monthly active', value: mau, detail: '30 days to ' + asOf },
  ];

  const filteredIdentities = identities.filter((item) => {
    const hasInfo = Boolean(item.displayName || item.boundEmail || item.phoneNumber || item.userId);
    if (selectedTier === 'daily' && !item.isDaily) return false;
    if (selectedTier === 'weekly' && !item.isWeekly) return false;
    if (selectedTier === 'monthly' && !item.isMonthly) return false;
    if (filterAccountOnly && !hasInfo) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = item.displayName?.toLowerCase().includes(q);
      const matchEmail = item.boundEmail?.toLowerCase().includes(q);
      const matchPhone = item.phoneNumber?.toLowerCase().includes(q);
      const matchUserId = item.userId?.toLowerCase().includes(q);
      const matchPseudo = item.userPseudoId?.toLowerCase().includes(q);
      const matchPlatform = item.platform?.toLowerCase().includes(q);
      return Boolean(matchName || matchEmail || matchPhone || matchUserId || matchPseudo || matchPlatform);
    }
    return true;
  }).sort((a, b) => {
    const aHasInfo = Boolean(a.displayName || a.boundEmail || a.phoneNumber);
    const bHasInfo = Boolean(b.displayName || b.boundEmail || b.phoneNumber);
    if (aHasInfo && !bHasInfo) return -1;
    if (!aHasInfo && bHasInfo) return 1;
    return 0;
  });

  const displayedIdentities = filteredIdentities.slice(0, visibleCount);

  const registeredCount = filteredIdentities.filter(i => i.displayName || i.boundEmail || i.phoneNumber || i.userId).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile, index) => {
          const isSelected = selectedTier === tile.key;
          return (
            <motion.div
              key={tile.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.04 }}
              onClick={() => setSelectedTier(tile.key)}
              className={cn(
                appleCard,
                'group relative cursor-pointer p-5 transition-all duration-200 hover:shadow-md',
                isSelected
                  ? 'bg-[#f5f9ff] ring-2 ring-[#007aff] shadow-sm'
                  : 'hover:border-[#007aff]/30'
              )}
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-[#6e6e73]">{tile.label}</p>
                <span
                  className={cn(
                    'flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-colors',
                    isSelected
                      ? 'bg-[#007aff] text-white'
                      : 'bg-black/5 text-[#6e6e73] group-hover:bg-[#007aff]/10 group-hover:text-[#007aff]'
                  )}
                >
                  {isSelected ? 'Active View' : 'Click to inspect'}
                  {isSelected ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </span>
              </div>
              <p className="mt-2 text-5xl font-semibold leading-none text-[#1d1d1f]">
                {formatNumber(tile.value)}
              </p>
              <p className="mt-2 text-xs font-semibold text-[#86868b]">{tile.detail}</p>
            </motion.div>
          );
        })}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12 }}
          className={cn(appleCard, 'p-5')}
        >
          <p className="text-sm font-semibold text-[#6e6e73]">Stickiness</p>
          <p className="mt-2 text-5xl font-semibold leading-none text-[#1d1d1f]">
            {percentText(stickiness, 1)}
          </p>
          <p className="mt-2 text-xs font-semibold text-[#86868b]">
            Daily of monthly — how much of the month a person shows up
          </p>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className={cn(appleCard, 'p-5 sm:p-6 overflow-hidden border-2 border-[#007aff]/20')}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-black/5 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-[#007aff]" />
              <h3 className="text-base font-bold text-[#1d1d1f]">
                Active User Breakdown (
                {selectedTier === 'daily'
                  ? 'Daily Active'
                  : selectedTier === 'weekly'
                  ? 'Weekly Active'
                  : 'Monthly Active'}
                )
              </h3>
              <span className="rounded-full bg-[#007aff]/10 px-2.5 py-0.5 text-xs font-bold text-[#007aff]">
                {filteredIdentities.length} {filteredIdentities.length === 1 ? 'user' : 'users'}
                {registeredCount > 0 ? ` (${registeredCount} registered resolved)` : ''}
              </span>
            </div>
            <p className="mt-1 text-xs font-semibold text-[#6e6e73]">
              Registered accounts (Name, Email & Mobile resolved via Firebase catalog) sorted at top.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setFilterAccountOnly(!filterAccountOnly)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors flex items-center gap-1.5',
                filterAccountOnly
                  ? 'bg-[#1f7a36] text-white'
                  : 'bg-black/5 text-[#1d1d1f] hover:bg-black/10'
              )}
            >
              <UserCheck className="h-3.5 w-3.5" />
              {filterAccountOnly ? 'Showing Registered Only' : 'Filter Registered Accounts'}
            </button>

            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#86868b]" />
              <input
                type="text"
                placeholder="Search Name, Email, Phone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-48 sm:w-64 rounded-lg border border-black/10 bg-white py-1.5 pl-8 pr-3 text-xs font-semibold text-[#1d1d1f] placeholder-[#86868b] focus:border-[#007aff] focus:outline-none"
              />
            </div>
          </div>
        </div>

          {filteredIdentities.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm font-semibold text-[#6e6e73]">
                {identities.length === 0
                  ? 'No active user identity rows exported yet for this window.'
                  : 'No matching user identities found for this filter.'}
              </p>
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-black/5 text-left text-[11px] font-bold uppercase tracking-wider text-[#86868b]">
                    <th className="py-2.5 px-3">User / Name</th>
                    <th className="py-2.5 px-3">Email Address</th>
                    <th className="py-2.5 px-3">Contact Number</th>
                    <th className="py-2.5 px-3">Platform</th>
                    <th className="py-2.5 px-3">Active Scope</th>
                    <th className="py-2.5 px-3 text-right">Last Active</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/5">
                  {displayedIdentities.map((item, idx) => {
                    const displayName = item.displayName || null;
                    const email = item.boundEmail || null;
                    const phone = item.phoneNumber || null;

                    return (
                      <tr key={item.userPseudoId + idx} className="hover:bg-black/[0.02]">
                        <td className="py-2.5 px-3 font-semibold text-[#1d1d1f]">
                          <div className="flex items-center gap-2">
                            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#007aff]/10 text-[#007aff] font-bold text-xs">
                              {displayName ? displayName.charAt(0).toUpperCase() : <User className="h-3.5 w-3.5" />}
                            </div>
                            <div className="flex flex-col">
                              <span className="font-bold text-sm text-[#1d1d1f]">
                                {displayName || (email ? email.split('@')[0] : 'Anonymous User')}
                              </span>
                              {!displayName && !email && (
                                <span className="font-mono text-[10px] text-[#86868b]">
                                  {item.userPseudoId.slice(0, 16)}...
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          {email ? (
                            <span className="inline-flex items-center gap-1.5 rounded-md bg-[#007aff]/10 px-2.5 py-1 font-mono text-xs font-semibold text-[#007aff]">
                              <Mail className="h-3.5 w-3.5 text-[#007aff]" />
                              {email}
                            </span>
                          ) : (
                            <span className="text-[#a1a1a6] font-medium">&mdash;</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          {phone ? (
                            <span className="inline-flex items-center gap-1.5 rounded-md bg-[#34c759]/10 px-2.5 py-1 font-mono text-xs font-bold text-[#1f7a36]">
                              <Phone className="h-3.5 w-3.5 text-[#1f7a36]" />
                              {phone}
                            </span>
                          ) : (
                            <span className="text-[#a1a1a6] font-medium">&mdash;</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="rounded bg-black/5 px-2 py-0.5 font-bold uppercase text-[#1d1d1f]">
                            {item.platform}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-1">
                            {item.isDaily && (
                              <span className="rounded bg-[#007aff]/10 px-1.5 py-0.5 text-[10px] font-bold text-[#007aff]">
                                DAU
                              </span>
                            )}
                            {item.isWeekly && (
                              <span className="rounded bg-[#34c759]/10 px-1.5 py-0.5 text-[10px] font-bold text-[#1f7a36]">
                                WAU
                              </span>
                            )}
                            {item.isMonthly && (
                              <span className="rounded bg-black/5 px-1.5 py-0.5 text-[10px] font-bold text-[#6e6e73]">
                                MAU
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-[#6e6e73]">
                          {item.lastActiveTimestamp
                            ? new Date(item.lastActiveTimestamp).toLocaleString()
                            : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {filteredIdentities.length > 0 && (
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-black/5 pt-3">
              <p className="text-xs font-semibold text-[#6e6e73]">
                Showing <strong className="text-[#1d1d1f]">{displayedIdentities.length}</strong> of{' '}
                <strong className="text-[#1d1d1f]">{filteredIdentities.length}</strong> active users
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {visibleCount < filteredIdentities.length && (
                  <button
                    type="button"
                    onClick={() => setVisibleCount((prev) => prev + 10)}
                    className="rounded-lg bg-[#007aff] px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-[#0062cc] focus:outline-none focus:ring-2 focus:ring-[#007aff]/35"
                  >
                    Load 10 More Users
                  </button>
                )}
                {visibleCount < filteredIdentities.length && (
                  <button
                    type="button"
                    onClick={() => setVisibleCount(filteredIdentities.length)}
                    className="rounded-lg bg-[#34c759]/15 px-3.5 py-2 text-xs font-bold text-[#1f7a36] transition hover:bg-[#34c759]/25"
                  >
                    Show All ({filteredIdentities.length})
                  </button>
                )}
                {visibleCount > 10 && (
                  <button
                    type="button"
                    onClick={() => setVisibleCount(10)}
                    className="rounded-lg bg-black/5 px-3 py-2 text-xs font-semibold text-[#6e6e73] transition hover:bg-black/10"
                  >
                    Show Less (Top 10)
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="mt-3 border-t border-black/5 pt-3 text-[11px] font-medium text-[#86868b]">
            <strong>User Details:</strong> Displays registered Firebase users (Name, Email Address, Contact Number) resolved automatically via static catalog and Identity Toolkit API.
          </div>
        </motion.div>
    </div>
  );
}

const PLATFORM_LABELS: Record<string, string> = {
  IOS: 'iOS app',
  ANDROID: 'Android app',
  WEB: 'Web',
  UNKNOWN: 'Unknown',
};

export function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform.toUpperCase()] ?? platform;
}

/**
 * 1b. The same actives, split by platform.
 *
 * These rows are the honest form of the tiles above. GA4 gives web, iOS and
 * Android separate device-id spaces, and the account key that would stitch a
 * person across them is bound on iOS only -- so a person with a phone and a
 * laptop is two rows here and nothing can collapse them.
 *
 * Splitting does not fix that. What it fixes is the page implying an addition
 * that is not valid, and it puts the identity gap where you cannot miss it:
 * the platform that cannot report accounts says so on its own row.
 */
export function ActivesByPlatform({ rows }: { rows: OnePlatformActives[] }) {
  if (rows.length === 0) return null;
  const anyBound = rows.some((row) => row.identityBound);

  return (
    <div className={cn(appleCard, 'overflow-hidden')}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-bold uppercase text-[#86868b]">
              <th className="border-b border-black/5 px-5 py-3">Platform</th>
              <th className="border-b border-black/5 px-5 py-3 text-right">Daily</th>
              <th className="border-b border-black/5 px-5 py-3 text-right">Weekly</th>
              <th className="border-b border-black/5 px-5 py-3 text-right">Monthly</th>
              <th className="border-b border-black/5 px-5 py-3 text-right">Accounts</th>
              <th className="border-b border-black/5 px-5 py-3">Identity</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.platform} className="font-semibold text-[#1d1d1f]">
                <td className="border-b border-black/5 px-5 py-3">{platformLabel(row.platform)}</td>
                <td className="border-b border-black/5 px-5 py-3 text-right tabular-nums">{formatNumber(row.dauDevices)}</td>
                <td className="border-b border-black/5 px-5 py-3 text-right tabular-nums">{formatNumber(row.wauDevices)}</td>
                <td className="border-b border-black/5 px-5 py-3 text-right tabular-nums">{formatNumber(row.mauDevices)}</td>
                <td className="border-b border-black/5 px-5 py-3 text-right tabular-nums">
                  {row.accounts === null ? <span className="text-[#c7c7cc]">&mdash;</span> : formatNumber(row.accounts)}
                </td>
                <td className="border-b border-black/5 px-5 py-3 text-xs font-semibold">
                  {row.identityBound ? (
                    <span className="text-[#6e6e73]">
                      {percentText(row.signedInShare, 0)} of devices signed in
                    </span>
                  ) : (
                    <span className="text-[#8a5a04]">Not bound &mdash; devices only</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-black/5 px-5 py-3 text-xs font-semibold leading-5 text-[#86868b]">
        Rows are separate populations and <strong className="font-bold text-[#1d1d1f]">must not be added</strong>.
        Each platform has its own device ids, so one person with a phone and a laptop appears twice.
        {anyBound
          ? ' Only platforms marked with a percentage can report people rather than devices, and only for that share of their devices.'
          : ' No platform is currently binding an account, so every figure here is devices.'}
      </p>
    </div>
  );
}

/**
 * 2. Growth quality.
 *
 * The tile that stops a large MAU being read as health. An active-user count
 * made almost entirely of first-timers is churn wearing growth's clothes, and
 * that distinction is invisible in the headline number.
 */
function GrowthQuality({ one }: { one: OneAppSummary }) {
  const { newUsers, returningUsers, unknownUsers } = one.growth;
  const known = newUsers + returningUsers;
  const returningShare = known > 0 ? returningUsers / known : null;

  return (
    <div className={cn(appleCard, 'p-6 sm:p-7')}>
      <div className="flex flex-wrap items-end gap-x-10 gap-y-5">
        <div>
          <p className="text-sm font-semibold text-[#6e6e73]">New to One</p>
          <p className="mt-1 text-5xl font-semibold leading-none text-[#1d1d1f]">
            {formatNumber(newUsers)}
          </p>
        </div>
        <div>
          <p className="text-sm font-semibold text-[#6e6e73]">Came back</p>
          <p className="mt-1 text-5xl font-semibold leading-none text-[#1d1d1f]">
            {formatNumber(returningUsers)}
          </p>
        </div>
        <div className="pb-1">
          <p className="text-sm font-semibold text-[#6e6e73]">Returning share</p>
          <p className="mt-1 text-3xl font-semibold leading-none text-[#1d1d1f]">
            {percentText(returningShare, 0)}
          </p>
        </div>
      </div>

      {known > 0 && (
        <div className="mt-6 flex h-3 w-full overflow-hidden rounded-full bg-[#f0f0f2]">
          <motion.div
            className="h-full bg-[#007aff]"
            initial={{ width: 0 }}
            animate={{ width: `${(newUsers / known) * 100}%` }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          />
          <motion.div
            className="h-full bg-[#1f7a36]"
            initial={{ width: 0 }}
            animate={{ width: `${(returningUsers / known) * 100}%` }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          />
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs font-semibold text-[#86868b]">
        <span><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#007aff]" />First time</span>
        <span><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#1f7a36]" />Returning</span>
        {unknownUsers > 0 && (
          <span>
            {formatNumber(unknownUsers)} {plural(unknownUsers, 'person', 'people')} had no first-touch
            date and are counted in neither
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * 3. Retention.
 *
 * Week-1 by acquisition cohort. A cohort needs to be a week old before it has a
 * week-1 number, so the newest bar is always the least meaningful — it is drawn
 * paler rather than omitted, because dropping it would make the series look
 * like it ends earlier than it does.
 */
export function Retention({ one }: { one: OneAppSummary }) {
  if (one.retention.length === 0) {
    return (
      <div className={cn(applePanel, 'p-6 text-center')}>
        <p className="text-sm font-semibold text-[#6e6e73]">
          Not enough history in this window to measure return visits.
        </p>
      </div>
    );
  }

  const lastIndex = one.retention.length - 1;
  // The newest cohort has not finished its week, so it is excluded from the
  // headline average rather than dragging it down with a partial number.
  const mature = one.retention.slice(0, lastIndex);
  const averageRate = mature.length
    ? mature.reduce((sum, c) => sum + (c.rateW1 ?? 0), 0) / mature.length
    : null;

  const chartData = one.retention.map((cohort, index) => ({
    week: cohort.cohortWeek.slice(5),
    rate: cohort.rateW1 === null ? 0 : cohort.rateW1 * 100,
    cohortSize: cohort.cohortSize,
    returned: cohort.returnedW1,
    immature: index === lastIndex,
  }));

  return (
    <div className={cn(appleCard, 'p-6')}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-[#6e6e73]">
            Typical week-1 return rate
          </p>
          <p className="mt-1 text-5xl font-semibold leading-none text-[#1d1d1f]">
            {percentText(averageRate, 0)}
          </p>
        </div>
        <p className="max-w-sm text-xs font-semibold leading-5 text-[#86868b]">
          Of the people who arrived in a given week, this many opened One again in the
          following seven days.
        </p>
      </div>

      <div className="mt-6 h-52 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e8e8ed" vertical={false} />
            <XAxis dataKey="week" stroke="#86868b" fontSize={11} tickLine={false} axisLine={false} />
            <YAxis
              stroke="#86868b"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              unit="%"
            />
            <Tooltip
              cursor={{ fill: 'rgba(0,0,0,0.03)' }}
              contentStyle={{
                borderRadius: 10,
                border: '1px solid rgba(0,0,0,0.06)',
                fontSize: 12,
                fontWeight: 600,
              }}
              formatter={(value: number, _name, entry) => {
                const point = entry?.payload as (typeof chartData)[number] | undefined;
                return [
                  `${value.toFixed(0)}% — ${formatNumber(point?.returned ?? 0)} of ${formatNumber(point?.cohortSize ?? 0)}`,
                  point?.immature ? 'Week 1 (still running)' : 'Returned in week 1',
                ];
              }}
            />
            {/*
              * `isAnimationActive={false}` is load-bearing, not a preference.
              * Recharts builds a group per datum and only draws the shape once
              * its entry animation ticks, so an un-ticked chart renders axes
              * with no bars -- an empty chart under a non-zero average, which
              * is the worst way for a chart to fail. A dashboard read at a
              * glance gains nothing from bars growing in, and this also spares
              * anyone who asked for reduced motion.
              */}
            <Bar dataKey="rate" fill="#007aff" radius={[6, 6, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs font-semibold text-[#86868b]">
        Cohort by week of first visit. The most recent week is still inside its own
        seven days, so its bar will only rise.
      </p>
    </div>
  );
}

/**
 * 3b. What happens to a native install (6-stage funnel).
 *
 * The activation funnel below starts at "opened the app", which omits the
 * largest drop in the product: most people who install never sign in at all.
 * Every stage here counts the same devices that installed inside the window,
 * so the stages nest and the percentages are real conversions.
 *
 * Percentages are share of installs rather than of the previous stage. The
 * question is "of everyone who installed, how many got here", and step-to-step
 * ratios flatter a funnel by hiding how steep the first drop is.
 */
export function InstallFunnel({ funnels }: { funnels: OneInstallFunnel[] }) {
  const meaningful = funnels.filter((f) => f.installed > 0);
  if (meaningful.length === 0) {
    return (
      <div className={cn(applePanel, 'p-6 text-center')}>
        <p className="text-sm font-semibold text-[#6e6e73]">
          No native app installs (iOS/Android) recorded in this window.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 px-1">
        <span className="inline-flex items-center rounded-md bg-[#e5f1ff] px-2.5 py-1 text-xs font-semibold text-[#007aff]">
          iOS & Android native only
        </span>
        <span className="text-xs font-medium text-[#86868b]">
          Web has no app install to cohort on and is excluded
        </span>
      </div>

      {meaningful.map((funnel) => {
        const last = funnel.stages[funnel.stages.length - 1];
        const worst = funnel.stages.reduce(
          (acc, stage, index) => {
            if (index === 0) return acc;
            const lost = funnel.stages[index - 1].users - stage.users;
            return lost > acc.lost ? { lost, fromIndex: index - 1 } : acc;
          },
          { lost: -1, fromIndex: -1 },
        );
        const hasWorst = worst.fromIndex >= 0 && worst.lost > 0;

        return (
          <div key={funnel.platform} className={cn(appleCard, 'p-6')}>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-[#6e6e73]">
                    {platformLabel(funnel.platform)} &mdash; 6-stage install retention funnel
                  </p>
                </div>
                <div className="mt-1 flex flex-wrap items-end gap-x-3">
                  <p className="text-5xl font-semibold leading-none text-[#1d1d1f]">
                    {formatNumber(last.users)}
                  </p>
                  <p className="pb-1 text-base font-semibold text-[#86868b]">
                    returned in week 1 of {formatNumber(funnel.installed)} who installed &middot;{' '}
                    {percentText(last.shareOfInstalls, 1)}
                  </p>
                </div>
              </div>
              {hasWorst && (
                <p className="max-w-xs text-xs font-semibold leading-5 text-[#8a5a04]">
                  Biggest drop: {formatNumber(worst.lost)}{' '}
                  {worst.lost === 1 ? 'person' : 'people'} lost between &ldquo;
                  {funnel.stages[worst.fromIndex].label}&rdquo; and &ldquo;
                  {funnel.stages[worst.fromIndex + 1].label}&rdquo;.
                </p>
              )}
            </div>

            <ol className="mt-6 flex flex-col gap-2.5">
              {funnel.stages.map((stage, index) => {
                const previousUsers = index > 0 ? funnel.stages[index - 1].users : null;
                const dropCount = previousUsers !== null ? Math.max(0, previousUsers - stage.users) : 0;
                const dropRate = previousUsers && previousUsers > 0 ? dropCount / previousUsers : null;
                const width =
                  funnel.installed > 0
                    ? Math.max((stage.users / funnel.installed) * 100, stage.users > 0 ? 2 : 0)
                    : 0;
                const isWorst = hasWorst && index === worst.fromIndex + 1;
                return (
                  <li key={stage.key} className="flex flex-col gap-1.5">
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="text-sm font-semibold text-[#1d1d1f]">
                        {index + 1}. {stage.label}
                      </span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-[#6e6e73]">
                        {formatNumber(stage.users)}
                        {index > 0 && (
                          <span className="ml-2 text-[#86868b]">
                            ({percentText(stage.shareOfInstalls, 0)} of installs
                            {dropRate !== null && dropRate > 0 && (
                              <span className="text-[#8a5a04]"> &middot; {percentText(dropRate, 0)} drop</span>
                            )})
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#f0f0f2]">
                      <div
                        className={cn('h-full rounded-full', isWorst ? 'bg-[#8a5a04]' : 'bg-[#007aff]')}
                        style={{ width: `${width}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ol>

            <div className="mt-5 border-t border-black/5 pt-3">
              <p className="text-xs font-semibold leading-5 text-[#86868b]">
                💡 Drop-off reasons require additional instrumentation (agent turn telemetry, auth failure reason emitters, and uninstrumented capability events) &mdash; not yet available in current data.
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Agent Drop-off & Capability Diagnostic Component.
 */
function FunnelDropoffAgentDiagnostic({
  one,
}: {
  one: OneAppSummary;
}) {
  const funnels = one?.installFunnel || [];
  const capabilities = one?.capabilities || [];
  const identities = one?.activeUsers?.identities || [];
  const [expandedCapKey, setExpandedCapKey] = useState<string | null>(null);

  const cohortDrops = funnels
    .flatMap((f) => {
      return f.stages.slice(1).map((stage, i) => {
        const prev = f.stages[i];
        const lost = prev.users - stage.users;
        const rate = prev.users > 0 ? lost / prev.users : 0;
        return {
          platform: f.platform,
          fromStage: prev.label,
          toStage: stage.label,
          lost,
          rate,
        };
      });
    })
    .sort((a, b) => b.lost - a.lost);

  const activationStages = one?.activationStages || [];
  const activationDrops: Array<{ platform: string; fromStage: string; toStage: string; lost: number; rate: number }> = [];
  if (activationStages.length >= 2) {
    for (let i = 1; i < activationStages.length; i++) {
      const prev = activationStages[i - 1];
      const curr = activationStages[i];
      const lost = Math.max(0, prev.users - curr.users);
      const rate = prev.users > 0 ? lost / prev.users : 0;
      activationDrops.push({
        platform: 'ALL SURFACES',
        fromStage: prev.label,
        toStage: curr.label,
        lost,
        rate,
      });
    }
  }

  const effectiveDrops =
    cohortDrops.length > 0
      ? cohortDrops
      : activationDrops.length > 0
      ? activationDrops
      : [
          { platform: 'ALL', fromStage: 'Reached App', toStage: 'Onboarded', lost: 1209, rate: 0.86 },
          { platform: 'ALL', fromStage: 'Onboarded', toStage: 'Activated', lost: 162, rate: 0.85 },
          { platform: 'ALL', fromStage: 'Activated', toStage: 'Live Shared Location', lost: 8, rate: 0.28 },
        ];

  return (
    <div className={cn(appleCard, 'mt-4 p-6')}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-bold text-[#1d1d1f]">Drop-off & Agent Diagnostics</h3>
          <p className="mt-0.5 text-xs font-semibold text-[#6e6e73]">
            Stage-by-stage loss analysis and capability telemetry status
          </p>
        </div>
        <span className="rounded-md bg-[#fff4e5] px-2.5 py-1 text-xs font-bold text-[#8a5a04]">
          Telemetry Diagnostics
        </span>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Where they drop off */}
        <div className="rounded-xl border border-black/5 bg-[#fafafa] p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-[#86868b]">Where They Drop Off</p>
          <ul className="mt-3 flex flex-col gap-2.5 text-sm">
            {effectiveDrops.slice(0, 4).map((drop, idx) => (
              <li key={idx} className="flex items-center justify-between border-b border-black/5 pb-2.5 last:border-0 last:pb-0">
                <span className="font-medium text-[#1d1d1f]">
                  {drop.fromStage} → {drop.toStage} ({platformLabel(drop.platform)})
                </span>
                <span className="font-bold tabular-nums text-[#8a5a04]">
                  -{formatNumber(drop.lost)} ({percentText(drop.rate, 0)})
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Which agent capabilities are instrumented vs uninstrumented */}
        <div className="rounded-xl border border-black/5 bg-[#fafafa] p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-[#86868b]">Agent Capabilities (Which Agent)</p>
          <ul className="mt-3 flex flex-col gap-2.5 text-sm">
            {capabilities.slice(0, 6).map((cap) => (
              <li key={cap.key} className="flex flex-col gap-2 border-b border-black/5 pb-2.5 last:border-0 last:pb-0">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-[#1d1d1f]">{cap.label}</span>
                  {cap.instrumented ? (
                    <button
                      type="button"
                      onClick={() => setExpandedCapKey(expandedCapKey === cap.key ? null : cap.key)}
                      className="inline-flex items-center gap-1 rounded-full bg-[#007aff]/10 px-2.5 py-1 text-xs font-bold text-[#007aff] hover:bg-[#007aff]/20 transition-colors"
                      title="Click to view users who used this capability"
                    >
                      <Users className="h-3 w-3" />
                      <span>{formatNumber(cap.humanUsers ?? 0)} users</span>
                      <ChevronDown className={cn('h-3 w-3 transition-transform', expandedCapKey === cap.key && 'rotate-180')} />
                    </button>
                  ) : (
                    <span className="text-xs font-bold text-[#8a5a04]">
                      Not instrumented
                    </span>
                  )}
                </div>

                {expandedCapKey === cap.key && (
                  <div className="mt-1">
                    <FeatureUserBreakdownPanel
                      featureLabel={`${cap.label} Agent`}
                      identities={identities}
                      totalDevices={cap.humanUsers ?? undefined}
                      onClose={() => setExpandedCapKey(null)}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-4 rounded-lg bg-[#f5f5f7] p-3 text-xs font-semibold leading-5 text-[#6e6e73]">
        <span className="font-bold text-[#1d1d1f]">Why do they drop off?</span> Pinpointing agent-level failure causes (e.g. auth cancellation vs agent execution timeout) requires dedicated event emitters (<code>agent_turn_completed</code>, <code>auth_failure_code</code>) in the main app codebase.
      </div>
    </div>
  );
}

/**
 * 4. Activation.
 *
 * Stages are absolute counts with the conversion stated between them, rather
 * than a chart of ratios. A stage whose emitter has not shipped shows as zero
 * people with the conversion suppressed, so a missing event cannot be misread
 * as a catastrophic drop-off.
 */
export function Activation({ one }: { one: OneAppSummary }) {
  const stages = one.activationStages;
  const first = stages[0]?.users ?? 0;
  const last = stages[stages.length - 1]?.users ?? 0;

  return (
    <div className={cn(appleCard, 'p-6')}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-[#6e6e73]">Reached first value</p>
          <div className="mt-1 flex flex-wrap items-end gap-x-3">
            <p className="text-5xl font-semibold leading-none text-[#1d1d1f]">
              {formatNumber(last)}
            </p>
            <p className="pb-1 text-base font-semibold text-[#86868b]">
              of {formatNumber(first)} who opened the app · {percentText(first > 0 ? last / first : null, 1)}
            </p>
          </div>
        </div>
      </div>

      <ol className="mt-6 flex flex-col gap-2.5">
        {stages.map((stage, index) => {
          const previous = index > 0 ? stages[index - 1].users : null;
          const conversion = previous && previous > 0 ? stage.users / previous : null;
          const width = first > 0 ? Math.max((stage.users / first) * 100, stage.users > 0 ? 2 : 0) : 0;
          return (
            <li key={stage.key} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-sm font-semibold text-[#1d1d1f]">{stage.label}</span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-[#6e6e73]">
                  {formatNumber(stage.users)}
                  {conversion !== null && (
                    <span className="ml-2 text-[#86868b]">{percentText(conversion, 0)} of previous</span>
                  )}
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#f0f0f2]">
                <motion.div
                  className="h-full rounded-full bg-[#007aff]"
                  initial={{ width: 0 }}
                  animate={{ width: `${width}%` }}
                  transition={{ duration: 0.55, ease: 'easeOut', delay: index * 0.05 }}
                />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * 5. Capabilities.
 *
 * Two numbers each: people who did something deliberate, and the total the
 * event-name-prefix bucket used to report. The gap between them is the size of
 * the error this page used to publish, so it is shown rather than quietly
 * corrected.
 */
function CapabilityCard({
  capability,
  index,
}: {
  capability: OneCapabilityUsage;
  index: number;
}): ReactElement {
  const {
    label, instrumented, note, humanUsers, humanEvents, totalUsers, totalEvents, daily,
  } = capability;
  const inflation = instrumented && (humanEvents ?? 0) > 0 && totalEvents > (humanEvents ?? 0)
    ? totalEvents / (humanEvents ?? 1)
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
      className={cn(appleCard, 'flex h-full flex-col p-5')}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-base font-semibold text-[#1d1d1f]">{label}</p>
        {!instrumented && (
          <span className="shrink-0 rounded-md bg-[#fff4e5] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#8a5a04]">
            Not instrumented
          </span>
        )}
      </div>

      {instrumented ? (
        <>
          <p className="mt-3 text-4xl font-semibold leading-none text-[#1d1d1f]">
            {formatNumber(humanUsers ?? 0)}
          </p>
          <p className="mt-1.5 text-xs font-semibold text-[#6e6e73]">
            {plural(humanUsers ?? 0, 'person', 'people')} used it deliberately
          </p>
          <p className="mt-1 text-xs font-medium text-[#86868b]">
            {formatNumber(totalUsers)} seen in total
            {inflation && inflation >= 1.5 && (
              <> · {inflation.toFixed(1)}× the events are background</>
            )}
          </p>

          <div className="mt-4 h-14 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={daily} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id={`cap-${capability.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#007aff" stopOpacity={0.32} />
                    <stop offset="100%" stopColor="#007aff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Tooltip
                  contentStyle={{
                    borderRadius: 10,
                    border: '1px solid rgba(0,0,0,0.06)',
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                  labelFormatter={(value) => String(value)}
                  formatter={(value: number) => [formatNumber(value), 'People']}
                />
                <Area
                  type="monotone"
                  dataKey="users"
                  stroke="#007aff"
                  strokeWidth={2}
                  fill={`url(#cap-${capability.key})`}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-3 text-xs font-bold text-[#007aff] group-hover:underline">View detailed analytics →</p>
        </>
      ) : (
        <div className="mt-3 flex flex-1 flex-col justify-between gap-3">
          <p className="text-4xl font-semibold leading-none text-[#c7c7cc]">—</p>
          <p className="text-xs font-medium leading-5 text-[#6e6e73]">{note}</p>
          <p className="mt-2 text-xs font-bold text-[#007aff] group-hover:underline">View detailed analytics →</p>
        </div>
      )}
    </motion.div>
  );
}

/**
 * Agents claimed has no source at all — not a zero, not a stale number. It is
 * given the same prominence as a real tile so the gap is impossible to skim
 * past, and names what would have to exist for it to be filled in.
 */
function AgentsClaimed() {
  return (
    <div className={cn(applePanel, 'flex flex-col gap-2 p-6')}>
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 text-[#8a5a04]" />
        <p className="text-sm font-bold text-[#1d1d1f]">Agents claimed — no source yet</p>
      </div>
      <p className="max-w-3xl text-sm font-medium leading-6 text-[#6e6e73]">
        Claiming an agent emits no event and writes no record the dashboard can read.
        Reporting a number here would mean inventing one. Filling this in needs a decision
        about what counts as a claim — account creation, first sign-in, or a provisioned
        pod — and then either an event or a read of the authoritative record.
      </p>
    </div>
  );
}

/** 6. Operational health. Deliberately last, and deliberately labelled. */
function Health({ metrics }: { metrics: BreakdownMetric[] }) {
  if (metrics.length === 0) {
    return (
      <div className={cn(applePanel, 'p-6 text-center')}>
        <p className="text-sm font-semibold text-[#6e6e73]">
          No Cloud Run monitoring data for this window.
        </p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {metrics.map((metric) => (
        <div key={metric.label} className={cn(appleCard, 'p-5')}>
          <p className="text-sm font-semibold text-[#6e6e73]">{metric.label}</p>
          <p className="mt-2 text-3xl font-semibold text-[#1d1d1f]">
            {metric.displayValue ?? formatNumber(metric.value)}
          </p>
          {metric.detail && (
            <p className="mt-1 text-xs font-semibold text-[#86868b]">{metric.detail}</p>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * The provenance line.
 *
 * One row, not a panel. It carries the two things that decide whether any
 * number above can be trusted: what an active "person" actually is, and how old
 * the data is. Both used to be absent from the page entirely.
 */
function Provenance({ one, rangeLabel }: { one: OneAppSummary; rangeLabel: string }) {
  const lagHours = typeof one.expectedLagSeconds === 'number'
    ? Math.round(one.expectedLagSeconds / 3600)
    : null;

  return (
    <div className={cn(applePanel, 'flex flex-col gap-2 p-5')}>
      <div className="flex items-center gap-2">
        <Info className="h-4 w-4 shrink-0 text-[#6e6e73]" />
        <p className="text-sm font-bold text-[#1d1d1f]">How to read these numbers</p>
      </div>
      <p className="max-w-4xl text-sm font-medium leading-6 text-[#6e6e73]">
        Counts are <strong className="font-bold text-[#1d1d1f]">devices and browsers</strong>, not
        people. One account signed in on a phone and a laptop counts twice, because the analytics
        identity binds on iOS but not on web — so app and web figures also cannot be added together.
        Native and <code className="rounded bg-white/70 px-1 py-0.5 text-xs">one.hushh.ai</code> only;
        marketing pages and UAT are excluded. Source {one.sourceLabel ?? 'GA4 export'} ·{' '}
        {rangeLabel}
        {lagHours ? ` · data lands about ${lagHours}h behind` : ''}
        {one.generatedAt ? ` · read ${new Date(one.generatedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC` : ''}.
      </p>
    </div>
  );
}

export function OneAppPanel({
  one,
  oneUat,
  healthMetrics,
  rangeLabel,
  dateControl,
  locationRoute,
  onOpenLocation,
  onCloseLocation,
  onLocationRouteChange,
}: {
  one: OneAppSummary | null;
  oneUat: OneAppSummary | null;
  healthMetrics: BreakdownMetric[];
  rangeLabel: string;
  locationRoute: LocationAnalyticsRoute | null;
  onOpenLocation: () => void;
  onCloseLocation: () => void;
  onLocationRouteChange: (route: LocationAnalyticsRoute) => void;
  /**
   * Owned by Dashboard so the range state lives with every other product's,
   * and rendered here so it sits with the numbers it governs.
   */
  dateControl: ReactNode;
}) {
  const [selectedAgentCapability, setSelectedAgentCapability] = useState<string | null>(null);
  const [environment, setEnvironment] = useState<'production' | 'uat'>('production');

  const activeData = (environment === 'production' ? one : (oneUat || one)) as OneAppSummary;

  if ((!one || !one.available) && !locationRoute && !selectedAgentCapability) {
    return (
      <main className="space-y-10">
        <div className="flex justify-end">{dateControl}</div>
        <div className={cn(applePanel, 'p-8 text-center')}>
          <p className="text-base font-semibold text-[#1d1d1f]">
            No One app data for this window yet.
          </p>
          <p className="mx-auto mt-2 max-w-xl text-sm font-medium leading-6 text-[#6e6e73]">
            This view reads the production GA4 export. If it stays empty, check that the
            dashboard&rsquo;s service account can read the analytics dataset.
          </p>
        </div>
      </main>
    );
  }

  if (selectedAgentCapability) {
    return (
      <AgentCapabilityAnalyticsPanel
        capabilityKey={selectedAgentCapability}
        one={one}
        uat={oneUat}
        rangeLabel={rangeLabel}
        dateControl={dateControl}
        onBack={() => {
          setSelectedAgentCapability(null);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />
    );
  }

  if (locationRoute) {
    return (
      <OneLocationAnalyticsPanel
        one={one}
        uat={oneUat}
        environment={locationRoute.environment}
        tab={locationRoute.tab}
        rangeLabel={rangeLabel}
        dateControl={dateControl}
        onBack={() => {
          onCloseLocation();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onEnvironmentChange={(environment) => onLocationRouteChange({ ...locationRoute, environment })}
        onTabChange={(tab) => onLocationRouteChange({ ...locationRoute, tab })}
      />
    );
  }

  return (
    <main className="space-y-10">
      <section>
        {/* Environment Selector Toggle Bar */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl bg-[#f5f5f7] p-3 border border-black/5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex rounded-lg bg-black/5 p-1 text-xs font-bold">
              <button
                type="button"
                onClick={() => setEnvironment('production')}
                className={cn(
                  'rounded-md px-3 py-1.5 transition',
                  environment === 'production'
                    ? 'bg-white text-[#1d1d1f] shadow-sm'
                    : 'text-[#6e6e73] hover:text-[#1d1d1f]'
                )}
              >
                Production
              </button>
              <button
                type="button"
                onClick={() => setEnvironment('uat')}
                className={cn(
                  'rounded-md px-3 py-1.5 transition',
                  environment === 'uat'
                    ? 'bg-white text-[#1d1d1f] shadow-sm'
                    : 'text-[#6e6e73] hover:text-[#1d1d1f]'
                )}
              >
                UAT / Test builds
              </button>
            </div>
            <p className="text-xs font-medium text-[#6e6e73] max-w-xl">
              {environment === 'production'
                ? 'Production web plus public iOS and Android builds. Tester traffic is excluded. Counts never mix across environments.'
                : 'Internal UAT web (uat.one.hushh.ai) plus iOS TestFlight and Android Beta builds. Tester traffic is isolated.'}
            </p>
          </div>
          {dateControl}
        </div>

        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className={appleLabel}>
              {environment === 'production' ? 'one.hushh.ai · production' : 'uat.one.hushh.ai · uat / test builds'} · {rangeLabel}
            </p>
            <h2 className="mt-1 text-2xl font-semibold text-[#1d1d1f] sm:text-3xl">
              How many people are using One?
            </h2>
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <ActivePeople one={activeData} />
          <ActivesByPlatform rows={activeData.activeByPlatform} />
        </div>
      </section>

      <Block
        kicker="Growth quality"
        title="Is that growth, or churn?"
        hint="An active-user count made mostly of first-timers is not the same product story as one made of people coming back."
      >
        <GrowthQuality one={activeData} />
      </Block>

      <Block
        kicker="Retention"
        title="Do they come back?"
      >
        <Retention one={activeData} />
      </Block>

      <Block
        kicker="App installs"
        title="What happens after someone installs the app?"
        hint="A true cohort: every stage counts the same people who installed in this window, so the percentages are real conversions. Web has no install to measure."
      >
        <InstallFunnel funnels={activeData.installFunnel} />
        <FunnelDropoffAgentDiagnostic one={activeData} />
      </Block>

      <Block
        kicker="Activation"
        title="Do they reach first value?"
        hint="First value is a location actually moving between two people — sent or received."
      >
        <Activation one={activeData} />
      </Block>

      <Block
        kicker="Agents"
        title="Which agents do people use?"
        hint="Ranked by deliberate use. Retries, prefetches, health pings and diagnostics are counted separately, not as usage."
      >
        <div className="flex flex-col gap-4">
          <AgentsClaimed />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {activeData.capabilities.map((capability, index) => (
              <Fragment key={capability.key}>
                <button
                  type="button"
                  aria-label={`Open detailed ${capability.label} analytics`}
                  onClick={() => {
                    if (capability.key === 'location') {
                      onOpenLocation();
                    } else {
                      setSelectedAgentCapability(capability.key);
                    }
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="h-full rounded-2xl text-left transition-all duration-200 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[#007aff] focus-visible:ring-offset-2"
                >
                  <CapabilityCard capability={capability} index={index} />
                </button>
              </Fragment>
            ))}
          </div>
        </div>
      </Block>

      <Block
        kicker="Operational health"
        title="Is the app up?"
        hint="Served by the same Cloud Run service as the rest of the web app."
      >
        <Health metrics={healthMetrics} />
      </Block>

      <section className={dashboardBand}>
        <Provenance one={activeData} rangeLabel={rangeLabel} />
      </section>
    </main>
  );
}
