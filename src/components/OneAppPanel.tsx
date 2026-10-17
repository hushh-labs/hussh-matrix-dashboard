import { MetricsSkeleton } from './MetricsLoading';
import { AndroidAnalyticsPanel } from './AndroidAnalyticsPanel';
import { Fragment, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { AlertTriangle, ChevronDown, Info, ShieldCheck, Users } from 'lucide-react';
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
import { dashboardCard, dashboardLabel, dashboardPanel, dashboardBand } from '../lib/theme';
import { formatNumber } from '../lib/analytics-service';
import { exactCount } from '../lib/feature-measurement';
import type { LocationAnalyticsRoute } from '../lib/location-analytics-route';
import { OneLocationAnalyticsPanel } from './OneLocationAnalyticsPanel';
import { AgentCapabilityAnalyticsPanel } from './AgentCapabilityAnalyticsPanel';
import { DailyAgentActivity } from './DailyAgentActivity';
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

/** Account KPIs stay exact on screen; compact notation is reserved for device/event diagnostics. */
function exactAccountCount(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
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
          <p className={dashboardLabel}>{kicker}</p>
          <h2 className="mt-1 text-2xl font-semibold text-ink">{title}</h2>
          {hint && (
            <p className="mt-1.5 max-w-2xl text-sm font-medium leading-6 text-muted">{hint}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function ActiveDevices({ one }: { one: OneAppSummary }) {
  const { dau, wau, mau, stickiness, asOf, identityScope } = one.activeUsers;
  const tiles = [
    { label: 'Daily active devices', value: dau, detail: asOf },
    { label: 'Weekly active devices', value: wau, detail: `7 days to ${asOf}` },
    { label: 'Monthly active devices', value: mau, detail: `30 days to ${asOf}` },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile, index) => (
          <motion.div
            key={tile.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.04 }}
            className={cn(dashboardCard, 'p-5')}
          >
            <p className="text-sm font-semibold text-muted">{tile.label}</p>
            <p className="mt-2 text-5xl font-semibold leading-none text-ink">{formatNumber(tile.value)}</p>
            <p className="mt-2 text-xs font-semibold text-muted">{tile.detail}</p>
          </motion.div>
        ))}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12 }}
          className={cn(dashboardCard, 'p-5')}
        >
          <p className="text-sm font-semibold text-muted">Daily use as a share of monthly use</p>
          <p className="mt-2 text-5xl font-semibold leading-none text-ink">{percentText(stickiness, 1)}</p>
          <p className="mt-2 text-xs font-semibold text-muted">Daily active devices divided by monthly active devices</p>
        </motion.div>
      </div>
      <div className="flex items-start gap-3 rounded-2xl border border-stroke bg-brand-50 p-4 text-brand-600">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="text-sm font-semibold leading-5">
          Each app or browser ID counts once. One signed-in person can use several devices, so devices are different from accounts.
        </p>
      </div>
    </div>
  );
}

function IdentifiedUsers({ one }: { one: OneAppSummary }) {
  const users = one.identifiedUsers;
  if (!users) return null;

  const range = users.selectedRange;
  const primaryTiles = [
    { label: 'Active signed-in accounts', value: range.totalUsers, detail: 'Distinct signed-in accounts active in selected range' },
    { label: 'Accounts first seen in this period', value: range.newUsers, detail: 'First-ever observed account activity in selected range' },
    { label: 'Returning active accounts', value: range.returningUsers, detail: 'First observed before selected range' },
  ];
  const activityTiles = [
    { label: 'Accounts active in 1 day', value: users.dau, detail: users.asOf },
    { label: 'Accounts active in 7 days', value: users.wau, detail: `7 days to ${users.asOf}` },
    { label: 'Accounts active in 30 days', value: users.mau, detail: `30 days to ${users.asOf}` },
    { label: 'Devices linked to an account', value: percentText(users.deviceCoverage.mau, 1), detail: `${formatNumber(users.identifiedDevices.mau)} active devices carried an account ID` },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {primaryTiles.map((tile, index) => (
          <motion.div
            key={tile.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.16 + index * 0.04 }}
            className={cn(dashboardCard, 'border-[#465fff]/15 bg-brand-50 p-5')}
          >
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-brand-600" />
              <p className="text-sm font-semibold text-muted">{tile.label}</p>
            </div>
            <p className="mt-2 text-5xl font-semibold leading-none text-ink">
              {typeof tile.value === 'number' ? exactAccountCount(tile.value) : 'Not available'}
            </p>
            <p className="mt-2 text-xs font-semibold text-muted">{tile.detail}</p>
          </motion.div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {activityTiles.map((tile, index) => (
          <div key={tile.label} className={cn(dashboardCard, 'p-5')}>
            <p className="text-sm font-semibold text-muted">{tile.label}</p>
            <p className="mt-2 text-3xl font-semibold leading-none text-ink">
              {typeof tile.value === 'number' ? exactAccountCount(tile.value) : tile.value}
            </p>
            <p className="mt-2 text-xs font-semibold text-muted">{tile.detail}</p>
          </div>
        ))}
      </div>
      <div className={cn(dashboardCard, 'border-stroke bg-brand-50 p-4 text-sm leading-6 text-brand-600')}>
        <strong>{formatNumber(users.dau)} identified accounts</strong> and <strong>{formatNumber(one.activeUsers.dau)} device/browser IDs</strong> on {users.asOf} are different counting units.
        {one.activeByPlatformAvailable !== false && one.activeByPlatform.length > 0 && (
          <> Those device IDs include {one.activeByPlatform.map((row) => `${formatNumber(row.dauDevices)} ${platformLabel(row.platform)}`).join(', ')}.</>
        )}
        {' '}An account counts once across devices only when One attaches its stable account ID. Unidentified browser/app IDs are not proven to be additional people, so the gap cannot be converted into a user count.
      </div>
      <div className="flex items-start gap-3 rounded-2xl border border-[#d8c48b] bg-warning-soft p-4 text-warning">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="text-sm font-semibold leading-5">
          Exact identified-user count: <code className="rounded bg-surface/70 px-1 py-0.5 text-xs">COUNT(DISTINCT user_id)</code>.
          Total, new and returning users each count the same stable account at most once, across every event, session and device.
          It de-duplicates the same signed-in account across devices. Anonymous devices and platforms that do not bind
          a stable account ID are excluded, so this is exact for the identified slice—not an estimate of unknown people.
          {' '}{users.identityScope}
        </p>
      </div>
    </div>
  );
}

function RegisteredUsers({ one }: { one: OneAppSummary }) {
  const accounts = one.registeredAccounts;
  if (!accounts) return null;

  if (!accounts.available || accounts.totalAccounts === null || accounts.newAccounts === null) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-[#d8c48b] bg-warning-soft p-4 text-warning">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="text-sm font-semibold leading-5">{accounts.note}</p>
      </div>
    );
  }

  const disabled = accounts.disabledAccounts ?? 0;
  const snapshotAt = new Date(accounts.generatedAt).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const tiles = [
    {
      label: 'Total registered users',
      value: accounts.totalAccounts,
      detail: `Current unique account records · ${exactAccountCount(disabled)} disabled · ${snapshotAt}`,
    },
    {
      label: 'New registered users',
      value: accounts.newAccounts,
      detail: `${accounts.startDate} to ${accounts.endDate}`,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {tiles.map((tile, index) => (
          <motion.div
            key={tile.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + index * 0.04 }}
            className={cn(dashboardCard, 'border-[#12b76a]/20 bg-[#f6fff8] p-5')}
          >
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-success" />
              <p className="text-sm font-semibold text-muted">{tile.label}</p>
            </div>
            <p className="mt-2 text-5xl font-semibold leading-none text-ink">{exactAccountCount(tile.value)}</p>
            <p className="mt-2 text-xs font-semibold text-muted">{tile.detail}</p>
          </motion.div>
        ))}
      </div>
      <div className="flex items-start gap-3 rounded-2xl border border-[#b8e6c2] bg-[#f2fff5] p-4 text-[#1f6d32]">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="text-sm font-semibold leading-5">
          System of record: {accounts.sourceLabel}. Production and UAT share this One identity realm, while their backend routing and GA4 reporting stay separate.
          Each immutable Firebase account ID is counted once, so repeat sign-ins, sessions, events and devices cannot inflate these values.
          New means the account creation timestamp falls inside the selected range. Separately created accounts cannot be proven to belong to different humans, and deleted accounts are not present in the current registry snapshot.
        </p>
      </div>
    </div>
  );
}

function IosIdentifiedUsers({ one }: { one: OneAppSummary }) {
  const ios = one.iosIdentifiedUsers;
  if (!ios) return null;

  return (
    <div className={cn(dashboardCard, 'border-[#465fff]/15 bg-brand-50 p-5')}>
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-brand-600" />
        <h3 className="text-base font-semibold text-ink">One iOS · signed-in accounts</h3>
      </div>
      {ios.available ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {[
            { label: 'Active iOS accounts', value: ios.totalUsers },
            { label: 'First observed on iOS', value: ios.firstObservedUsers },
            { label: 'Previously observed on iOS', value: ios.previouslyObservedUsers },
          ].map((tile) => (
            <div key={tile.label} className="rounded-xl bg-surface p-4">
              <p className="text-sm font-semibold text-muted">{tile.label}</p>
              <p className="mt-2 text-3xl font-semibold tabular-nums text-ink">
                {tile.value === null ? 'Waiting' : exactAccountCount(tile.value)}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm font-semibold text-warning">iOS account counts unavailable for this selection.</p>
      )}
      <p className="mt-3 text-xs font-semibold leading-5 text-muted">
        {ios.startDate} to {ios.endDate} · {ios.note}
        {ios.identityObservedSince && ` Account tagging is visible in this export from ${ios.identityObservedSince}; earlier iOS users may appear first-observed after tagging began.`}
        {' '}These are not iOS-only new registrations or a count of unique humans; anonymous use is excluded.
      </p>
    </div>
  );
}

function OneAtAGlance({ one }: { one: OneAppSummary }) {
  const registered = one.registeredAccounts;
  const tiles = [
    {
      group: 'Users', label: 'Total registered accounts',
      value: registered?.available ? registered.totalAccounts : null,
      detail: 'Current Firebase accounts · production and UAT share this realm',
    },
    {
      group: 'Users', label: 'New registered accounts',
      value: registered?.available ? registered.newAccounts : null,
      detail: 'Firebase accounts created during selected dates · shared production/UAT realm',
    },
    {
      group: 'Users', label: 'Active signed-in accounts',
      value: one.identifiedUsers?.selectedRange.totalUsers ?? null,
      detail: 'Across measured One web and app activity · one count per account, not a sum of platforms',
    },
  ];

  return (
    <div className="mb-5 space-y-3">
      <div>
        <h3 className="text-lg font-semibold text-ink">One at a glance</h3>
        <p className="mt-1 text-sm text-muted">
          User reporting counts signed-in account IDs, not proven unique humans. Browser/app identifiers and screen visits are separate diagnostics below.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((tile) => (
          <div key={tile.label} className={cn(dashboardCard, 'p-4')}>
            <p className="text-xs font-bold uppercase tracking-wide text-brand-600">{tile.group}</p>
            <p className="mt-1 text-sm font-semibold text-ink">{tile.label}</p>
            <p className="mt-2 text-4xl font-semibold tabular-nums text-ink">
              {typeof tile.value === 'number' ? exactAccountCount(tile.value) : 'Not available'}
            </p>
            <p className="mt-2 text-xs leading-5 text-muted">{tile.detail}</p>
          </div>
        ))}
      </div>
      <p className="text-xs leading-5 text-muted">
        Active accounts and new registrations use {one.range?.startDate} to {one.range?.endDate}; total registrations are a current shared Firebase snapshot. Anonymous activity is excluded from account counts. Production and UAT use the same Firebase identity realm.
      </p>
    </div>
  );
}

const SCREEN_LABELS: Record<string, string> = {
  one_dashboard: 'One home', chat: 'One chat', connect: 'Connect', one_location: 'Location',
  one_setup: 'Setup', feed: 'Feed', login: 'Sign in', kai_home: 'Legacy home',
};

export function PlatformsAtAGlance({ one, environment }: { one: OneAppSummary; environment: 'production' | 'uat' }) {
  // A browser can briefly pair the new UI bundle with the previous API
  // revision during a rolling deploy or rollback. Missing fields mean
  // unavailable, not an empty or zero-valued platform.
  if (one.platformsAvailable === false || !Array.isArray(one.platforms)) {
    return <p className={cn(dashboardCard, 'mb-5 p-5 text-sm font-semibold text-warning')} role="status">
      Platform activity is temporarily unavailable. Missing counts are not shown as zero.
    </p>;
  }

  const platformCards = [
    { key: 'WEB', title: 'One web', scope: `${one.sourceWebHost ?? (environment === 'uat' ? 'uat.one.hushh.ai' : 'one.hushh.ai')} browsers only` },
    { key: 'IOS', title: 'One iOS', scope: 'com.hushh.app iOS app instances' },
    { key: 'ANDROID', title: 'One Android', scope: 'com.hussh.app Android app instances · verified Firebase stream' },
  ];

  return (
    <section className="mb-5 space-y-3" aria-label="One activity by platform">
      <div>
        <h3 className="text-lg font-semibold text-ink">One activity by platform</h3>
        <p className="mt-1 text-sm text-muted">
          Same selected dates for each surface. Signed-in accounts are users we can identify; browser/app IDs are not unique people.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {platformCards.map(({ key, title, scope }) => {
          const row = one.platforms.find((item) => item.platform.toUpperCase() === key);
          const accountsMeasured = row && row.activeAccounts > 0;
          const topScreens = Array.isArray(row?.topProductScreens) ? row.topProductScreens : [];
          return (
            <div key={key} className={cn(dashboardCard, 'p-5')}>
              <p className="text-base font-semibold text-ink">{title}</p>
              <p className="mt-1 text-xs leading-5 text-muted">{scope}</p>
              {!row ? (
                <p className="mt-5 text-sm font-semibold text-warning">No activity was recorded in this reporting source during these dates.</p>
              ) : (
                <>
                  <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4">
                    <div><dt className="text-xs text-muted">Active signed-in accounts</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{accountsMeasured ? exactAccountCount(row.activeAccounts) : 'Not measurable'}</dd></div>
                    <div><dt className="text-xs text-muted">Active {key === 'WEB' ? 'browser' : 'app-instance'} IDs</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{exactAccountCount(row.activeDeviceIds)}</dd></div>
                  </dl>
                  {topScreens.length > 0 && (
                    <details className="mt-5 border-t border-stroke pt-4">
                      <summary className="cursor-pointer text-xs font-semibold text-muted">Screen activity details</summary>
                      <ol className="mt-2 space-y-1 text-xs text-ink">
                        {topScreens.map((screen) => <li key={screen.routeId} className="flex justify-between gap-3"><span>{SCREEN_LABELS[screen.routeId] ?? screen.routeId.replaceAll('_', ' ')}</span><span className="font-semibold tabular-nums">{exactAccountCount(screen.visits)}</span></li>)}
                      </ol>
                      <p className="mt-2 text-xs leading-5 text-muted">Visits can repeat and are not user counts. {exactAccountCount(row.namedRouteVisits)} of {exactAccountCount(row.routeVisits)} route visits had usable screen names.</p>
                    </details>
                  )}
                  {!accountsMeasured && <p className="mt-2 text-xs font-semibold text-warning">No stable account ID was observed here; the app/browser IDs cannot be converted into a user count.</p>}
                </>
              )}
              {key === 'ANDROID' && <p className="mt-4 rounded-xl bg-warning-soft p-3 text-xs font-semibold leading-5 text-warning">Android app activity is separate from store downloads. Check the native version, installer and backend environment below; test-labelled activity is not production-backend customer evidence.</p>}
            </div>
          );
        })}
      </div>
      {environment === 'uat' && !one.platforms.some((row) => row.platform === 'IOS' || row.platform === 'ANDROID') && (
        <p className="rounded-xl border border-stroke bg-brand-50 p-3 text-xs font-semibold leading-5 text-brand-600">
          No mobile activity reached the test analytics source during these dates. A public mobile build using the test service can still report to live-product analytics; that activity is labeled separately there.
        </p>
      )}
      <p className="text-xs leading-5 text-muted">These platform account rows can overlap and must not be added. The global active-account card deduplicates account IDs across surfaces. Store downloads, crashes and physical devices need separate sources and are not measured by these cards.</p>
    </section>
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
 * person across them is not consistently bound on every platform -- so device
 * rows still cannot be collapsed into people.
 *
 * Splitting does not fix that. What it fixes is the page implying an addition
 * that is not valid, and it puts the identity gap where you cannot miss it:
 * the platform that cannot report accounts says so on its own row.
 */
export function ActivesByPlatform({ rows, available = true }: { rows: OnePlatformActives[]; available?: boolean }) {
  if (!available) {
    return (
      <div className={cn(dashboardCard, 'p-5')} role="status">
        <p className="text-sm font-semibold text-warning">Platform activity is temporarily unavailable</p>
        <p className="mt-1 text-xs leading-5 text-muted">
          Platform data could not be loaded. Try refreshing later; missing iOS device and account counts are not shown as zero.
        </p>
      </div>
    );
  }
  if (rows.length === 0) {
    return <p className={cn(dashboardCard, 'p-5 text-sm text-muted')}>No platform activity was recorded by this analytics source during the selected dates.</p>;
  }
  const anyBound = rows.some((row) => row.identityBound);

  return (
    <div className={cn(dashboardCard, 'overflow-hidden')}>
      <div className="overflow-x-auto">
        <div className="metrics-table-scroll" role="region" aria-label="Scrollable metrics table" tabIndex={0}><table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-bold uppercase text-muted">
              <th className="border-b border-stroke px-5 py-3">Platform</th>
              <th className="border-b border-stroke px-5 py-3 text-right">Devices · 1 day</th>
              <th className="border-b border-stroke px-5 py-3 text-right">Devices · 7 days</th>
              <th className="border-b border-stroke px-5 py-3 text-right">Devices · 30 days</th>
              <th className="border-b border-stroke px-5 py-3 text-right">Accounts · 1 day</th>
              <th className="border-b border-stroke px-5 py-3 text-right">Accounts · 7 days</th>
              <th className="border-b border-stroke px-5 py-3 text-right">Accounts · 30 days</th>
              <th className="border-b border-stroke px-5 py-3">Identity</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.platform} className="font-semibold text-ink">
                <td className="border-b border-stroke px-5 py-3">{platformLabel(row.platform)}</td>
                <td className="border-b border-stroke px-5 py-3 text-right tabular-nums">{formatNumber(row.dauDevices)}</td>
                <td className="border-b border-stroke px-5 py-3 text-right tabular-nums">{formatNumber(row.wauDevices)}</td>
                <td className="border-b border-stroke px-5 py-3 text-right tabular-nums">{formatNumber(row.mauDevices)}</td>
                <td className="border-b border-stroke px-5 py-3 text-right tabular-nums">
                  {row.dauAccounts === null ? <span className="text-[#c7c7cc]">&mdash;</span> : formatNumber(row.dauAccounts)}
                </td>
                <td className="border-b border-stroke px-5 py-3 text-right tabular-nums">
                  {row.wauAccounts === null ? <span className="text-[#c7c7cc]">&mdash;</span> : formatNumber(row.wauAccounts)}
                </td>
                <td className="border-b border-stroke px-5 py-3 text-right tabular-nums">
                  {row.mauAccounts === null ? <span className="text-[#c7c7cc]">&mdash;</span> : formatNumber(row.mauAccounts)}
                </td>
                <td className="border-b border-stroke px-5 py-3 text-xs font-semibold">
                  {row.identityBound ? (
                    <span className="text-muted">
                      {percentText(row.signedInShare, 1)} of devices signed in
                    </span>
                  ) : (
                    <span className="text-warning">Not bound &mdash; devices only</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
      <p className="border-t border-stroke px-5 py-3 text-xs font-semibold leading-5 text-muted">
        Rows are separate populations and <strong className="font-bold text-ink">must not be added</strong>.
        Each platform has its own device ids, so one person with a phone and a laptop appears twice.
        {anyBound
          ? ' Percentages show identity coverage only; account counts are separate and are never substituted for cross-device unique people.'
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
    <div className={cn(dashboardCard, 'p-6 sm:p-7')}>
      <div className="flex flex-wrap items-end gap-x-10 gap-y-5">
        <div>
          <p className="text-sm font-semibold text-muted">New devices</p>
          <p className="mt-1 text-5xl font-semibold leading-none text-ink">
            {formatNumber(newUsers)}
          </p>
        </div>
        <div>
          <p className="text-sm font-semibold text-muted">Returning devices</p>
          <p className="mt-1 text-5xl font-semibold leading-none text-ink">
            {formatNumber(returningUsers)}
          </p>
        </div>
        <div className="pb-1">
          <p className="text-sm font-semibold text-muted">Returning share</p>
          <p className="mt-1 text-3xl font-semibold leading-none text-ink">
            {percentText(returningShare, 0)}
          </p>
        </div>
      </div>

      {known > 0 && (
        <div className="mt-6 flex h-3 w-full overflow-hidden rounded-full bg-subtle">
          <motion.div
            className="h-full bg-[#465fff]"
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

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs font-semibold text-muted">
        <span><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#465fff]" />First-seen device</span>
        <span><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#1f7a36]" />Returning device</span>
        {unknownUsers > 0 && (
          <span>
            {formatNumber(unknownUsers)} {plural(unknownUsers, 'device', 'devices')} had no first-touch
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
 * Week-1 by observed acquisition cohort. Availability comes from export
 * coverage, including gaps, rather than the cohort's position in the chart.
 */
export function Retention({ one }: { one: OneAppSummary }) {
  if (one.retention.length === 0) {
    return (
      <div className={cn(dashboardPanel, 'p-6 text-center')}>
        <p className="text-sm font-semibold text-muted">
          {one.retentionAvailable === false
            ? 'Return-visit reporting is temporarily unavailable.'
            : 'No observed first-visit / first-open cohorts in this reporting history.'}
        </p>
      </div>
    );
  }

  const mature = one.retention.filter(c => c.windowComplete === true && c.rateW1 != null
    && c.cohortSize != null && c.returnedW1 != null);
  const cohortTotal = mature.reduce((sum, c) => sum + c.cohortSize, 0);
  const averageRate = cohortTotal > 0
    ? mature.reduce((sum, c) => sum + c.returnedW1, 0) / cohortTotal : null;
  const pendingCount = one.retention.length - mature.length;

  const chartData = one.retention.map((cohort) => ({
    week: cohort.cohortWeek.slice(5),
    rate: cohort.windowComplete === true && cohort.rateW1 != null ? cohort.rateW1 * 100 : null,
    cohortSize: cohort.cohortSize,
    returned: cohort.returnedW1,
  }));

  return (
    <div className={cn(dashboardCard, 'p-6')}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-muted">
            Returned in week 1 rate
          </p>
          <p className="mt-1 text-5xl font-semibold leading-none text-ink">
            {percentText(averageRate, 0)}
          </p>
        </div>
        <p className="max-w-sm text-xs font-semibold leading-5 text-muted">
          Share of observed first-visit / first-open IDs that returned with activity
          during days 1–7. Weighted by cohort size; only complete weeks contribute.
        </p>
      </div>

      <div className="mt-6 h-52 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e8e8ed" vertical={false} />
            <XAxis dataKey="week" stroke="#667085" fontSize={11} tickLine={false} axisLine={false} />
            <YAxis
              stroke="#667085"
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
                  'Returned in week 1',
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
            <Bar dataKey="rate" fill="#465fff" radius={[6, 6, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs font-semibold text-muted">
        Observed cohorts start on Sunday. {one.retentionRange ? `${one.retentionRange.startDate} to ${one.retentionRange.endDate}, ${one.retentionRange.timezone} (UTC−8). ` : ''}
        Up to eight weeks from the preceding 84 reporting days; this history is wider
        than the selected range. Missing historical first arrivals are not reconstructed.
      </p>
      {pendingCount > 0 && <p className="mt-2 text-xs font-semibold text-muted">
        {pendingCount} cohort(s) await complete acquisition and return data; no rate or zero bar is inferred.
      </p>}
      <div className="mt-4 overflow-x-auto">
        <div className="metrics-table-scroll" role="region" aria-label="Scrollable metrics table" tabIndex={0}><table className="w-full text-left text-xs">
          <caption className="sr-only">Observed weekly acquisition cohorts and reporting availability</caption>
          <thead><tr className="text-muted"><th scope="col" className="py-2">Week of</th><th scope="col">First-time device IDs</th><th scope="col">Returned in week 1</th></tr></thead>
          <tbody>{one.retention.map(cohort => <tr key={cohort.cohortWeek} className="border-t border-stroke">
            <th scope="row" className="py-2 font-medium">{cohort.cohortWeek}</th>
            <td>{cohort.cohortSize == null ? 'Unavailable' : formatNumber(cohort.cohortSize)}</td>
            <td>{cohort.windowComplete === true && cohort.rateW1 != null ? percentText(cohort.rateW1, 1) : cohort.state === 'unavailable' ? 'Unavailable' : 'Awaiting complete data'}</td>
          </tr>)}</tbody>
        </table></div>
      </div>
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
 * Percentages are share of first opens rather than of the previous stage. The
 * question is "of everyone who installed, how many got here", and step-to-step
 * ratios flatter a funnel by hiding how steep the first drop is.
 */
export function InstallFunnel({ funnels }: { funnels: OneInstallFunnel[] }) {
  const meaningful = funnels.filter((f) => f.installed > 0);
  if (meaningful.length === 0) {
    return (
      <div className={cn(dashboardPanel, 'p-6 text-center')}>
        <p className="text-sm font-semibold text-muted">
          No native first-open events (iOS/Android) recorded in this window.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 px-1">
        <span className="inline-flex items-center rounded-md bg-[#e5f1ff] px-2.5 py-1 text-xs font-semibold text-brand-600">
          iOS & Android native only
        </span>
        <span className="text-xs font-medium text-muted">
          Web has no native first-open cohort and is excluded
        </span>
      </div>

      {meaningful.map((funnel) => {
        const last = funnel.stages[funnel.stages.length - 1];
        const returnPending = funnel.retentionWindowComplete === false;
        const worst = funnel.stages.reduce(
          (acc, stage, index) => {
            if (index === 0) return acc;
            const lost = funnel.stages[index - 1].users - stage.users;
            return lost > acc.lost ? { lost, fromIndex: index - 1 } : acc;
          },
          { lost: -1, fromIndex: -1 },
        );
        const hasWorst = !returnPending && worst.fromIndex >= 0 && worst.lost > 0;

        return (
          <div key={funnel.platform} className={cn(dashboardCard, 'p-6')}>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-muted">
                    {platformLabel(funnel.platform)} &mdash; 6-stage first-open retention funnel
                  </p>
                </div>
                <div className="mt-1 flex flex-wrap items-end gap-x-3">
                  <p className="text-5xl font-semibold leading-none text-ink">
                    {returnPending ? '—' : formatNumber(last.users)}
                  </p>
                  <p className="pb-1 text-base font-semibold text-muted">
                    {returnPending ? 'Week-1 return window incomplete' : <>returned in week 1 of {formatNumber(funnel.installed)} first-open app IDs &middot;{' '}{percentText(last.shareOfInstalls, 1)}</>}
                  </p>
                </div>
              </div>
              {hasWorst && (
                <p className="max-w-xs text-xs font-semibold leading-5 text-warning">
                  Biggest drop: {formatNumber(worst.lost)}{' '}
                  {worst.lost === 1 ? 'device' : 'devices'} lost between &ldquo;
                  {funnel.stages[worst.fromIndex].label}&rdquo; and &ldquo;
                  {funnel.stages[worst.fromIndex + 1].label}&rdquo;.
                </p>
              )}
            </div>

            {returnPending && <p className="mt-3 text-sm leading-5 text-muted" role="status">
              Showing progress observed so far for {formatNumber(funnel.installed)} first-open app IDs.
              A full seven-day return window is not available for every first open in these dates.
              Later steps and final drop-off are still unknown.
            </p>}

            <ol className="mt-6 flex flex-col gap-2.5">
              {funnel.stages.map((stage, index) => {
                const pendingStage = returnPending && stage.key === 'returned_w1';
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
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <span className="text-sm font-semibold text-ink">
                        {index + 1}. {stage.label}
                      </span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-muted">
                        {pendingStage ? 'Awaiting complete week' : formatNumber(stage.users)}
                        {index > 0 && !pendingStage && (
                          <span className="ml-2 text-muted">
                            ({percentText(stage.shareOfInstalls, 0)} of first opens
                            {!returnPending && dropRate !== null && dropRate > 0 && (
                              <span className="text-warning"> &middot; {percentText(dropRate, 0)} drop</span>
                            )})
                          </span>
                        )}
                      </span>
                    </div>
                    {!pendingStage && <div className="h-2.5 w-full overflow-hidden rounded-full bg-subtle">
                      <div
                        className={cn('h-full rounded-full', isWorst ? 'bg-[#8a5a04]' : 'bg-[#465fff]')}
                        style={{ width: `${width}%` }}
                      />
                    </div>}
                  </li>
                );
              })}
            </ol>

            <div className="mt-5 border-t border-stroke pt-3">
              <p className="text-xs font-semibold leading-5 text-muted">
                💡 These counts show where activity stops. The app does not yet record enough detail to explain why someone stopped.
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
  const funnels = (one?.installFunnel || []).filter(funnel => funnel.retentionWindowComplete !== false);
  const capabilities = one?.capabilities || [];
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
      : [];

  return (
    <div className={cn(dashboardCard, 'mt-4 p-6')}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-bold text-ink">Where people stop and which agents they try</h3>
          <p className="mt-0.5 text-xs font-semibold text-muted">
            See where activity drops and which agents have usable data.
          </p>
        </div>
        <span className="rounded-md bg-[#fff4e5] px-2.5 py-1 text-xs font-bold text-warning">
          Telemetry Diagnostics
        </span>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Where they drop off */}
        <div className="rounded-xl border border-stroke bg-[#fafafa] p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-muted">Where They Drop Off</p>
          <ul className="mt-3 flex flex-col gap-2.5 text-sm">
            {effectiveDrops.length === 0 && <li>Not enough observed progress to report drop-off.</li>}
            {effectiveDrops.slice(0, 4).map((drop, idx) => (
              <li key={idx} className="flex items-center justify-between border-b border-stroke pb-2.5 last:border-0 last:pb-0">
                <span className="font-medium text-ink">
                  {drop.fromStage} → {drop.toStage} ({platformLabel(drop.platform)})
                </span>
                <span className="font-bold tabular-nums text-warning">
                  -{formatNumber(drop.lost)} ({percentText(drop.rate, 0)})
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Which agent capabilities are instrumented vs uninstrumented */}
        <div className="rounded-xl border border-stroke bg-[#fafafa] p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-muted">Agent Capabilities (Which Agent)</p>
          <ul className="mt-3 flex flex-col gap-2.5 text-sm">
            {capabilities.slice(0, 6).map((cap) => (
              <li key={cap.key} className="flex flex-col gap-2 border-b border-stroke pb-2.5 last:border-0 last:pb-0">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-ink">{cap.label}</span>
                  {cap.instrumented ? (
                    <button
                      type="button"
                      onClick={() => setExpandedCapKey(expandedCapKey === cap.key ? null : cap.key)}
                      className="inline-flex items-center gap-1 rounded-full bg-[#465fff]/10 px-2.5 py-1 text-xs font-bold text-brand-600 hover:bg-[#465fff]/20 transition-colors"
                      title="View aggregate device definition"
                    >
                      <Users className="h-3 w-3" />
                      <span>{formatNumber(cap.devices ?? 0)} devices</span>
                      <ChevronDown className={cn('h-3 w-3 transition-transform', expandedCapKey === cap.key && 'rotate-180')} />
                    </button>
                  ) : (
                    <span className="text-xs font-bold text-warning">
                      Not instrumented
                    </span>
                  )}
                </div>

                {expandedCapKey === cap.key && (
                  <div className="mt-1">
                    <FeatureUserBreakdownPanel
                      featureLabel={`${cap.label} Agent`}
                      totalDevices={cap.devices ?? undefined}
                      onClose={() => setExpandedCapKey(null)}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-4 rounded-lg bg-canvas p-3 text-xs font-semibold leading-5 text-muted">
        <span className="font-bold text-ink">Why do they drop off?</span> The current data does not explain whether someone canceled sign-in, an agent took too long, or another issue occurred. More detailed app tracking is needed before we can identify the cause.
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
    <div className={cn(dashboardCard, 'p-6')}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-muted">Reached first value</p>
          <div className="mt-1 flex flex-wrap items-end gap-x-3">
            <p className="text-5xl font-semibold leading-none text-ink">
              {formatNumber(last)}
            </p>
            <p className="pb-1 text-base font-semibold text-muted">
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
                <span className="text-sm font-semibold text-ink">{stage.label}</span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-muted">
                  {formatNumber(stage.users)}
                  {conversion !== null && (
                    <span className="ml-2 text-muted">{percentText(conversion, 0)} of previous</span>
                  )}
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-subtle">
                <motion.div
                  className="h-full rounded-full bg-[#465fff]"
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
  sourceAvailable,
  dailyAvailable,
}: {
  capability: OneCapabilityUsage;
  index: number;
  sourceAvailable: boolean;
  dailyAvailable: boolean;
}): ReactElement {
  const {
    label, instrumented, devices, deliberateEvents, accounts, daily,
  } = capability;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
      className={cn(dashboardCard, 'flex h-full flex-col p-5')}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-base font-semibold text-ink">{label}</p>
        {!instrumented && (
          <span className="shrink-0 rounded-md bg-[#fff4e5] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warning">
            Not tracked yet
          </span>
        )}
      </div>

      {instrumented && sourceAvailable ? (
        <>
          <p className="mt-3 text-4xl font-semibold leading-none text-ink">
            {exactCount(devices)}
          </p>
          <p className="mt-1.5 text-xs font-semibold text-muted">
            device/browser IDs used this feature
          </p>
          <p className="mt-1 text-xs font-medium text-muted">
            {exactCount(accounts)} signed-in accounts · {exactCount(deliberateEvents)} recorded actions
          </p>

          {dailyAvailable ? <div className="mt-4 h-14 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={daily} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id={`cap-${capability.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#465fff" stopOpacity={0.32} />
                    <stop offset="100%" stopColor="#465fff" stopOpacity={0} />
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
                  formatter={(value: number) => [formatNumber(value), 'Devices']}
                />
                <Area
                  type="monotone"
                  dataKey="users"
                  stroke="#465fff"
                  strokeWidth={2}
                  fill={`url(#cap-${capability.key})`}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div> : <p className="mt-4 text-xs leading-5 text-muted">Daily trend unavailable. The period totals above are still available.</p>}
          <p className="mt-3 text-xs font-bold text-brand-600 group-hover:underline">View detailed analytics →</p>
        </>
      ) : (
        <div className="mt-3 flex flex-1 flex-col justify-between gap-3">
          <p className="text-4xl font-semibold leading-none text-[#c7c7cc]">—</p>
          <p className="text-xs font-medium leading-5 text-muted">{!instrumented ? 'This activity is not tracked yet.' : 'Data is unavailable. A dash does not mean zero activity.'}</p>
          <p className="mt-2 text-xs font-bold text-brand-600 group-hover:underline">View detailed analytics →</p>
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
    <div className={cn(dashboardPanel, 'flex flex-col gap-2 p-6')}>
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
        <p className="text-sm font-bold text-ink">Agents claimed — no source yet</p>
      </div>
      <p className="max-w-3xl text-sm font-medium leading-6 text-muted">
        Claiming an agent emits no event and writes no record the dashboard can read.
        Reporting a number here would mean inventing one. Filling this in needs a decision
        about what counts as a claim — account creation, first sign-in, or a provisioned
        pod — and then either an event or a read of the authoritative record.
      </p>
    </div>
  );
}

/** 6. App performance. Deliberately last, and deliberately labelled. */
function Health({ metrics }: { metrics: BreakdownMetric[] }) {
  if (metrics.length === 0) {
    return (
      <div className={cn(dashboardPanel, 'p-6 text-center')}>
        <p className="text-sm font-semibold text-muted">
          No Cloud Run monitoring data for this window.
        </p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {metrics.map((metric) => (
        <div key={metric.label} className={cn(dashboardCard, 'p-5')}>
          <p className="text-sm font-semibold text-muted">{metric.label}</p>
          <p className="mt-2 text-3xl font-semibold text-ink">
            {metric.displayValue ?? formatNumber(metric.value)}
          </p>
          {metric.detail && (
            <p className="mt-1 text-xs font-semibold text-muted">{metric.detail}</p>
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
function Provenance({ one, rangeLabel, environment }: { one: OneAppSummary; rangeLabel: string; environment: 'production' | 'uat' }) {
  const lagHours = typeof one.expectedLagSeconds === 'number'
    ? Math.round(one.expectedLagSeconds / 3600)
    : null;
  const nativeUatTagged = (one.nativeEnvironments ?? []).some(
    (row) => row.environment === 'uat' && row.events > 0,
  );

  return (
    <div className={cn(dashboardPanel, 'flex flex-col gap-2 p-5')}>
      <div className="flex items-center gap-2">
        <Info className="h-4 w-4 shrink-0 text-muted" />
        <p className="text-sm font-bold text-ink">How to read these numbers</p>
      </div>
      <p className="max-w-4xl text-sm font-medium leading-6 text-muted">
        Device counts are <strong className="font-bold text-ink">devices and browsers</strong>, not
        people. The signed-in-user cards separately count distinct stable account IDs and collapse the
        same account across devices, while clearly showing how much device traffic has no bound identity.
        Native and <code className="rounded bg-surface/70 px-1 py-0.5 text-xs">{one.sourceWebHost ?? 'one.hushh.ai'}</code> only;
        every other web host is excluded. {environment === 'production' && nativeUatTagged
          ? 'Public mobile-build events tagged for the UAT backend remain visible, but backend environment and GA4 property are reported separately. '
          : ''}Source {one.sourceLabel ?? 'GA4 export'} ·{' '}
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
  loading = false,
  healthMetrics,
  rangeLabel,
  dateControl,
  locationRoute,
  onOpenLocation,
  onCloseLocation,
  onLocationRouteChange,
}: {
  loading?: boolean;
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

  const activeData = (environment === 'production' ? one : oneUat) as OneAppSummary;
  const nativeUatTagged = (activeData?.nativeEnvironments ?? []).filter(
    (row) => row.environment === 'uat' && row.events > 0,
  );

  if ((loading || !activeData || !activeData.available) && !locationRoute && !selectedAgentCapability) {
    return (
      <main className="space-y-10">
        <div className="flex justify-end">{dateControl}</div>
        {loading ? <MetricsSkeleton /> : <div className={cn(dashboardPanel, 'p-8 text-center')}>
          <p className="text-base font-semibold text-ink">
            One app data is unavailable for this selection.
          </p>
          <p className="mx-auto mt-2 max-w-xl text-sm font-medium leading-6 text-muted">
            Try refreshing or choose another period. Missing data is not shown as zero.
          </p>
          {environment === 'uat' && <button type="button" onClick={() => setEnvironment('production')} className="mt-4 rounded-lg bg-brand-50 px-4 py-2 text-brand-600">Back to Production</button>}
        </div>}
      </main>
    );
  }

  if (selectedAgentCapability) {
    return (
      <AgentCapabilityAnalyticsPanel
        loading={loading}
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
        loading={loading}
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
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-stroke pb-5">
          <div className="grid gap-3 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center flex-1">
            <div
              className="grid w-full grid-cols-2 gap-1 rounded-xl bg-subtle p-1 sm:flex sm:w-fit"
              role="tablist"
              aria-label="One App environment"
            >
              <button
                type="button"
                role="tab"
                aria-selected={environment === 'production'}
                onClick={() => setEnvironment('production')}
                className={cn(
                  'min-h-10 min-w-0 rounded-lg px-3 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#465fff] sm:shrink-0 sm:px-4',
                  environment === 'production'
                    ? 'bg-surface text-ink shadow-sm'
                    : 'text-muted hover:text-ink',
                )}
              >
                Production
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={environment === 'uat'}
                onClick={() => setEnvironment('uat')}
                className={cn(
                  'min-h-10 min-w-0 rounded-lg px-3 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#465fff] sm:shrink-0 sm:px-4',
                  environment === 'uat'
                    ? 'bg-surface text-ink shadow-sm'
                    : 'text-muted hover:text-ink',
                )}
              >
                UAT / Test builds
              </button>
            </div>
            <p className="text-xs font-semibold leading-5 text-muted">
              {environment === 'production'
                ? 'Live website and mobile app activity. Other websites are excluded. Mobile test-service activity is labeled separately.'
                : 'Activity from the test website and mobile apps reporting to the test analytics source.'}
            </p>
          </div>
          <div className="shrink-0">{dateControl}</div>
        </div>

        {environment === 'production' && nativeUatTagged.length > 0 && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-[#465fff]/20 bg-[#465fff]/[0.06] px-4 py-3 text-sm font-semibold leading-5 text-brand-600">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Some public mobile builds still use the test service: {nativeUatTagged.map((row) => `${row.platform} ${formatNumber(row.events)} recorded actions`).join(', ')}. This activity remains visible here and is labeled separately from activity using the live service.
            </p>
          </div>
        )}

        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className={dashboardLabel}>
              {environment === 'production' ? 'one.hushh.ai · production' : 'uat.one.hushh.ai · uat / test builds'} · {rangeLabel}
            </p>
            <h2 className="mt-1 text-2xl font-semibold text-ink sm:text-3xl">
              How many registered and active users does One have?
            </h2>
          </div>
        </div>
        <OneAtAGlance one={activeData} />
        <PlatformsAtAGlance one={activeData} environment={environment} />
        <AndroidAnalyticsPanel one={activeData} environment={environment} />
        <details className={cn(dashboardCard, 'mb-4 p-4 text-sm leading-6 text-ink')}>
          <summary className="cursor-pointer font-semibold text-ink">Plain-English guide to the numbers on this page</summary>
          <div className="mt-3 grid gap-x-6 gap-y-2 md:grid-cols-2">
            <p><strong>Registered users:</strong> distinct One account records in Firebase. “New” means the account was created during the selected dates. This does not prove one account per human.</p>
            <p><strong>Active signed-in accounts:</strong> distinct account IDs attached to meaningful GA4 activity. One account counts once even after repeat visits or use on multiple devices. Activity without an account ID is excluded.</p>
            <p><strong>First observed / returning:</strong> the account’s first tagged activity in the available export is inside / before the selected dates. First observed is not the same as a new registration.</p>
            <p><strong>Active devices:</strong> distinct app-install or browser identifiers with meaningful activity. One person can have several; anonymous visits are included. These are not unique people.</p>
            <p><strong>Daily / weekly / monthly:</strong> activity over 1 / 7 / 30 days, ending on the date printed on the tile. GA4’s finalized daily export may lag behind today or the selected end date.</p>
            <p><strong>First opens, activation, retention and agents:</strong> these describe device journeys, first value, week-1 return, and deliberate feature use. Their percentages use the stated device cohort as the denominator; they are not account growth.</p>
          </div>
          <p className="mt-3 border-t border-stroke pt-3 text-xs font-semibold text-muted">
            Production and UAT are reporting-property selections, not a claim about which backend a mobile build calls. Public iOS builds can appear in the production GA4 property while still using the UAT backend.
          </p>
        </details>
        <details className="group">
          <summary className={cn(dashboardCard, 'cursor-pointer p-4 font-semibold text-ink')}>
            More detail: daily / weekly / monthly accounts and device counts
          </summary>
          <div className="mt-4 flex flex-col gap-4">
            <RegisteredUsers one={activeData} />
            <IosIdentifiedUsers one={activeData} />
            <IdentifiedUsers one={activeData} />
            <ActiveDevices one={activeData} />
            <ActivesByPlatform rows={activeData.activeByPlatform} available={activeData.activeByPlatformAvailable} />
          </div>
        </details>
      </section>

      <DailyAgentActivity one={activeData} onOpenAgent={key => {
        if (key === 'location') onOpenLocation();
        else setSelectedAgentCapability(key);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }} />

      <Block
        kicker="New and returning devices"
        title="Are devices coming back?"
        hint="See whether app and browser IDs are new or returning. Account totals appear at the top of this page."
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
        kicker="App first opens"
        title="What happens after the first app launch?"
        hint="Follow app installs that first opened during these dates, including reinstalls. These are app IDs, not store downloads. Web visits are excluded."
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
        title="Which agents do devices use?"
        hint="Ranked by recorded feature use. Automatic background activity is kept separate."
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
                  className="h-full rounded-2xl text-left transition-all duration-200 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[#465fff] focus-visible:ring-offset-2"
                >
                  <CapabilityCard capability={capability} index={index} sourceAvailable={activeData.capabilitiesAvailable} dailyAvailable={activeData.capabilityDailyAvailable === true} />
                </button>
              </Fragment>
            ))}
          </div>
        </div>
      </Block>

      <Block
        kicker="App performance"
        title="Is the app up?"
        hint="Availability and response times for the live web service."
      >
        <Health metrics={healthMetrics} />
      </Block>

      <section className={dashboardBand}>
        <Provenance one={activeData} rangeLabel={rangeLabel} environment={environment} />
      </section>
    </main>
  );
}
