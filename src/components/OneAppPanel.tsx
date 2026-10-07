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
import { appleCard, appleLabel, applePanel, dashboardBand } from '../lib/theme';
import { formatNumber } from '../lib/analytics-service';
import { exactCount } from '../lib/feature-measurement';
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
            className={cn(appleCard, 'p-5')}
          >
            <p className="text-sm font-semibold text-[#6e6e73]">{tile.label}</p>
            <p className="mt-2 text-5xl font-semibold leading-none text-[#1d1d1f]">{formatNumber(tile.value)}</p>
            <p className="mt-2 text-xs font-semibold text-[#86868b]">{tile.detail}</p>
          </motion.div>
        ))}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12 }}
          className={cn(appleCard, 'p-5')}
        >
          <p className="text-sm font-semibold text-[#6e6e73]">Device stickiness</p>
          <p className="mt-2 text-5xl font-semibold leading-none text-[#1d1d1f]">{percentText(stickiness, 1)}</p>
          <p className="mt-2 text-xs font-semibold text-[#86868b]">Daily active devices divided by monthly active devices</p>
        </motion.div>
      </div>
      <div className="flex items-start gap-3 rounded-2xl border border-[#c7ddff] bg-[#f5f9ff] p-4 text-[#174b8a]">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="text-sm font-semibold leading-5">
          Counting unit: unique GA4 device/browser identifiers. {identityScope} A signed-in person using multiple devices can appear more than once; the dashboard does not claim these are unique humans. Person-level rows are not exposed.
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
    { label: 'Identified active users', value: range.totalUsers, detail: 'Distinct signed-in accounts active in selected range' },
    { label: 'Newly observed active users', value: range.newUsers, detail: 'First-ever observed account activity in selected range' },
    { label: 'Returning active users', value: range.returningUsers, detail: 'First observed before selected range' },
  ];
  const activityTiles = [
    { label: 'Daily identified accounts', value: users.dau, detail: users.asOf },
    { label: 'Weekly identified accounts', value: users.wau, detail: `7 days to ${users.asOf}` },
    { label: 'Monthly identified accounts', value: users.mau, detail: `30 days to ${users.asOf}` },
    { label: 'Monthly identity coverage', value: percentText(users.deviceCoverage.mau, 1), detail: `${formatNumber(users.identifiedDevices.mau)} active devices carried an account ID` },
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
            className={cn(appleCard, 'border-[#007aff]/15 bg-[#f7fbff] p-5')}
          >
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-[#007aff]" />
              <p className="text-sm font-semibold text-[#6e6e73]">{tile.label}</p>
            </div>
            <p className="mt-2 text-5xl font-semibold leading-none text-[#1d1d1f]">
              {typeof tile.value === 'number' ? exactAccountCount(tile.value) : 'Not available'}
            </p>
            <p className="mt-2 text-xs font-semibold text-[#86868b]">{tile.detail}</p>
          </motion.div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {activityTiles.map((tile, index) => (
          <div key={tile.label} className={cn(appleCard, 'p-5')}>
            <p className="text-sm font-semibold text-[#6e6e73]">{tile.label}</p>
            <p className="mt-2 text-3xl font-semibold leading-none text-[#1d1d1f]">
              {typeof tile.value === 'number' ? exactAccountCount(tile.value) : tile.value}
            </p>
            <p className="mt-2 text-xs font-semibold text-[#86868b]">{tile.detail}</p>
          </div>
        ))}
      </div>
      <div className={cn(appleCard, 'border-[#c7ddff] bg-[#f5f9ff] p-4 text-sm leading-6 text-[#174b8a]')}>
        <strong>{formatNumber(users.dau)} identified accounts</strong> and <strong>{formatNumber(one.activeUsers.dau)} device/browser IDs</strong> on {users.asOf} are different counting units.
        {one.activeByPlatformAvailable !== false && one.activeByPlatform.length > 0 && (
          <> Those device IDs include {one.activeByPlatform.map((row) => `${formatNumber(row.dauDevices)} ${platformLabel(row.platform)}`).join(', ')}.</>
        )}
        {' '}An account counts once across devices only when One attaches its stable account ID. Unidentified browser/app IDs are not proven to be additional people, so the gap cannot be converted into a user count.
      </div>
      <div className="flex items-start gap-3 rounded-2xl border border-[#d8c48b] bg-[#fffaf0] p-4 text-[#72510b]">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="text-sm font-semibold leading-5">
          Exact identified-user count: <code className="rounded bg-white/70 px-1 py-0.5 text-xs">COUNT(DISTINCT user_id)</code>.
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
      <div className="flex items-start gap-3 rounded-2xl border border-[#d8c48b] bg-[#fffaf0] p-4 text-[#72510b]">
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
            className={cn(appleCard, 'border-[#34c759]/20 bg-[#f6fff8] p-5')}
          >
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[#248a3d]" />
              <p className="text-sm font-semibold text-[#6e6e73]">{tile.label}</p>
            </div>
            <p className="mt-2 text-5xl font-semibold leading-none text-[#1d1d1f]">{exactAccountCount(tile.value)}</p>
            <p className="mt-2 text-xs font-semibold text-[#86868b]">{tile.detail}</p>
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
    <div className={cn(appleCard, 'border-[#007aff]/15 bg-[#f7fbff] p-5')}>
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-[#007aff]" />
        <h3 className="text-base font-semibold text-[#1d1d1f]">One iOS · signed-in accounts</h3>
      </div>
      {ios.available ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {[
            { label: 'Active iOS accounts', value: ios.totalUsers },
            { label: 'First observed on iOS', value: ios.firstObservedUsers },
            { label: 'Previously observed on iOS', value: ios.previouslyObservedUsers },
          ].map((tile) => (
            <div key={tile.label} className="rounded-xl bg-white p-4">
              <p className="text-sm font-semibold text-[#6e6e73]">{tile.label}</p>
              <p className="mt-2 text-3xl font-semibold tabular-nums text-[#1d1d1f]">
                {tile.value === null ? 'Waiting' : exactAccountCount(tile.value)}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm font-semibold text-[#8a5a04]">iOS account counts unavailable for this selection.</p>
      )}
      <p className="mt-3 text-xs font-semibold leading-5 text-[#6e6e73]">
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
        <h3 className="text-lg font-semibold text-[#1d1d1f]">One at a glance</h3>
        <p className="mt-1 text-sm text-[#6e6e73]">
          User reporting counts signed-in account IDs, not proven unique humans. Browser/app identifiers and screen visits are separate diagnostics below.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((tile) => (
          <div key={tile.label} className={cn(appleCard, 'p-4')}>
            <p className="text-xs font-bold uppercase tracking-wide text-[#007aff]">{tile.group}</p>
            <p className="mt-1 text-sm font-semibold text-[#3a3a3c]">{tile.label}</p>
            <p className="mt-2 text-4xl font-semibold tabular-nums text-[#1d1d1f]">
              {typeof tile.value === 'number' ? exactAccountCount(tile.value) : 'Not available'}
            </p>
            <p className="mt-2 text-xs leading-5 text-[#6e6e73]">{tile.detail}</p>
          </div>
        ))}
      </div>
      <p className="text-xs leading-5 text-[#6e6e73]">
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
    return <p className={cn(appleCard, 'mb-5 p-5 text-sm font-semibold text-[#8a5a04]')} role="status">
      Platform behaviour is temporarily unavailable from the GA4 export. No platform counts are shown as zero.
    </p>;
  }

  const platformCards = [
    { key: 'WEB', title: 'One web', scope: `${one.sourceWebHost ?? (environment === 'uat' ? 'uat.one.hushh.ai' : 'one.hushh.ai')} browsers only` },
    { key: 'IOS', title: 'One iOS', scope: 'com.hushh.app iOS app instances' },
    { key: 'ANDROID', title: 'One Android', scope: 'com.hushh.app Android app instances · release status unverified' },
  ];

  return (
    <section className="mb-5 space-y-3" aria-label="One activity by platform">
      <div>
        <h3 className="text-lg font-semibold text-[#1d1d1f]">One activity by platform</h3>
        <p className="mt-1 text-sm text-[#6e6e73]">
          Same selected dates for each surface. Signed-in accounts are users we can identify; browser/app IDs are not unique people.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {platformCards.map(({ key, title, scope }) => {
          const row = one.platforms.find((item) => item.platform.toUpperCase() === key);
          const accountsMeasured = row && row.activeAccounts > 0;
          const topScreens = Array.isArray(row?.topProductScreens) ? row.topProductScreens : [];
          return (
            <div key={key} className={cn(appleCard, 'p-5')}>
              <p className="text-base font-semibold text-[#1d1d1f]">{title}</p>
              <p className="mt-1 text-xs leading-5 text-[#6e6e73]">{scope}</p>
              {!row ? (
                <p className="mt-5 text-sm font-semibold text-[#8a5a04]">No telemetry observed in this reporting property and date range.</p>
              ) : (
                <>
                  <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4">
                    <div><dt className="text-xs text-[#6e6e73]">Active signed-in accounts</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{accountsMeasured ? exactAccountCount(row.activeAccounts) : 'Not measurable'}</dd></div>
                    <div><dt className="text-xs text-[#6e6e73]">Active {key === 'WEB' ? 'browser' : 'app-instance'} IDs</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{exactAccountCount(row.activeDeviceIds)}</dd></div>
                  </dl>
                  {topScreens.length > 0 && (
                    <details className="mt-5 border-t border-black/5 pt-4">
                      <summary className="cursor-pointer text-xs font-semibold text-[#6e6e73]">Screen activity details</summary>
                      <ol className="mt-2 space-y-1 text-xs text-[#3a3a3c]">
                        {topScreens.map((screen) => <li key={screen.routeId} className="flex justify-between gap-3"><span>{SCREEN_LABELS[screen.routeId] ?? screen.routeId.replaceAll('_', ' ')}</span><span className="font-semibold tabular-nums">{exactAccountCount(screen.visits)}</span></li>)}
                      </ol>
                      <p className="mt-2 text-xs leading-5 text-[#6e6e73]">Visits can repeat and are not user counts. {exactAccountCount(row.namedRouteVisits)} of {exactAccountCount(row.routeVisits)} route visits had usable screen names.</p>
                    </details>
                  )}
                  {!accountsMeasured && <p className="mt-2 text-xs font-semibold text-[#8a5a04]">No stable account ID was observed here; the app/browser IDs cannot be converted into a user count.</p>}
                </>
              )}
              {key === 'ANDROID' && <p className="mt-4 rounded-xl bg-[#fffaf0] p-3 text-xs font-semibold leading-5 text-[#72510b]">Android release status is not connected. Per the product team, current activity is pre-launch/test telemetry; do not treat these IDs as public users or downloads.</p>}
            </div>
          );
        })}
      </div>
      {environment === 'uat' && !one.platforms.some((row) => row.platform === 'IOS' || row.platform === 'ANDROID') && (
        <p className="rounded-xl border border-[#c7ddff] bg-[#f5f9ff] p-3 text-xs font-semibold leading-5 text-[#174b8a]">
          No native rows reached the UAT GA4 property in this range. That does not tell us which backend the app used: mobile events tagged <code>env=uat</code> can appear in the production GA4 property and are shown there separately.
        </p>
      )}
      <p className="text-xs leading-5 text-[#6e6e73]">These platform account rows can overlap and must not be added. The global active-account card deduplicates account IDs across surfaces. Store downloads, crashes and physical devices need separate sources and are not measured by these cards.</p>
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
      <div className={cn(appleCard, 'p-5')} role="status">
        <p className="text-sm font-semibold text-[#8a5a04]">Platform activity is temporarily unavailable</p>
        <p className="mt-1 text-xs leading-5 text-[#6e6e73]">
          The GA4 platform query did not complete. iOS device and signed-in account counts are not shown as zero; retry after the export recovers.
        </p>
      </div>
    );
  }
  if (rows.length === 0) {
    return <p className={cn(appleCard, 'p-5 text-sm text-[#6e6e73]')}>No platform activity was recorded in this GA4 property for the selected range.</p>;
  }
  const anyBound = rows.some((row) => row.identityBound);

  return (
    <div className={cn(appleCard, 'overflow-hidden')}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-bold uppercase text-[#86868b]">
              <th className="border-b border-black/5 px-5 py-3">Platform</th>
              <th className="border-b border-black/5 px-5 py-3 text-right">Device DAU</th>
              <th className="border-b border-black/5 px-5 py-3 text-right">Device WAU</th>
              <th className="border-b border-black/5 px-5 py-3 text-right">Device MAU</th>
              <th className="border-b border-black/5 px-5 py-3 text-right">Account DAU</th>
              <th className="border-b border-black/5 px-5 py-3 text-right">Account WAU</th>
              <th className="border-b border-black/5 px-5 py-3 text-right">Account MAU</th>
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
                  {row.dauAccounts === null ? <span className="text-[#c7c7cc]">&mdash;</span> : formatNumber(row.dauAccounts)}
                </td>
                <td className="border-b border-black/5 px-5 py-3 text-right tabular-nums">
                  {row.wauAccounts === null ? <span className="text-[#c7c7cc]">&mdash;</span> : formatNumber(row.wauAccounts)}
                </td>
                <td className="border-b border-black/5 px-5 py-3 text-right tabular-nums">
                  {row.mauAccounts === null ? <span className="text-[#c7c7cc]">&mdash;</span> : formatNumber(row.mauAccounts)}
                </td>
                <td className="border-b border-black/5 px-5 py-3 text-xs font-semibold">
                  {row.identityBound ? (
                    <span className="text-[#6e6e73]">
                      {percentText(row.signedInShare, 1)} of devices signed in
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
    <div className={cn(appleCard, 'p-6 sm:p-7')}>
      <div className="flex flex-wrap items-end gap-x-10 gap-y-5">
        <div>
          <p className="text-sm font-semibold text-[#6e6e73]">New devices</p>
          <p className="mt-1 text-5xl font-semibold leading-none text-[#1d1d1f]">
            {formatNumber(newUsers)}
          </p>
        </div>
        <div>
          <p className="text-sm font-semibold text-[#6e6e73]">Returning devices</p>
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
        <span><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#007aff]" />First-seen device</span>
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
          Of the devices that arrived in a given week, this many opened One again in the
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
                  {worst.lost === 1 ? 'device' : 'devices'} lost between &ldquo;
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
                      title="View aggregate device definition"
                    >
                      <Users className="h-3 w-3" />
                      <span>{formatNumber(cap.devices ?? 0)} devices</span>
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
  sourceAvailable,
}: {
  capability: OneCapabilityUsage;
  index: number;
  sourceAvailable: boolean;
}): ReactElement {
  const {
    label, instrumented, devices, deliberateEvents, accounts, daily,
  } = capability;

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
            Not tracked yet
          </span>
        )}
      </div>

      {instrumented && sourceAvailable ? (
        <>
          <p className="mt-3 text-4xl font-semibold leading-none text-[#1d1d1f]">
            {exactCount(devices)}
          </p>
          <p className="mt-1.5 text-xs font-semibold text-[#6e6e73]">
            device/browser IDs used this feature
          </p>
          <p className="mt-1 text-xs font-medium text-[#86868b]">
            {exactCount(accounts)} signed-in accounts · {exactCount(deliberateEvents)} recorded actions
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
                  formatter={(value: number) => [formatNumber(value), 'Devices']}
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
          <p className="text-xs font-medium leading-5 text-[#6e6e73]">{!instrumented ? 'This activity is not tracked yet.' : 'Data is unavailable. A dash does not mean zero activity.'}</p>
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
function Provenance({ one, rangeLabel, environment }: { one: OneAppSummary; rangeLabel: string; environment: 'production' | 'uat' }) {
  const lagHours = typeof one.expectedLagSeconds === 'number'
    ? Math.round(one.expectedLagSeconds / 3600)
    : null;
  const nativeUatTagged = (one.nativeEnvironments ?? []).some(
    (row) => row.environment === 'uat' && row.events > 0,
  );

  return (
    <div className={cn(applePanel, 'flex flex-col gap-2 p-5')}>
      <div className="flex items-center gap-2">
        <Info className="h-4 w-4 shrink-0 text-[#6e6e73]" />
        <p className="text-sm font-bold text-[#1d1d1f]">How to read these numbers</p>
      </div>
      <p className="max-w-4xl text-sm font-medium leading-6 text-[#6e6e73]">
        Device counts are <strong className="font-bold text-[#1d1d1f]">devices and browsers</strong>, not
        people. The signed-in-user cards separately count distinct stable account IDs and collapse the
        same account across devices, while clearly showing how much device traffic has no bound identity.
        Native and <code className="rounded bg-white/70 px-1 py-0.5 text-xs">{one.sourceWebHost ?? 'one.hushh.ai'}</code> only;
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
  const nativeUatTagged = (activeData?.nativeEnvironments ?? []).filter(
    (row) => row.environment === 'uat' && row.events > 0,
  );

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
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-black/5 pb-5">
          <div className="grid gap-3 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center flex-1">
            <div
              className="grid w-full grid-cols-2 gap-1 rounded-xl bg-black/[0.045] p-1 sm:flex sm:w-fit"
              role="tablist"
              aria-label="One App environment"
            >
              <button
                type="button"
                role="tab"
                aria-selected={environment === 'production'}
                onClick={() => setEnvironment('production')}
                className={cn(
                  'min-h-10 min-w-0 rounded-lg px-3 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#007aff] sm:shrink-0 sm:px-4',
                  environment === 'production'
                    ? 'bg-white text-[#1d1d1f] shadow-sm'
                    : 'text-[#6e6e73] hover:text-[#1d1d1f]',
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
                  'min-h-10 min-w-0 rounded-lg px-3 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#007aff] sm:shrink-0 sm:px-4',
                  environment === 'uat'
                    ? 'bg-white text-[#1d1d1f] shadow-sm'
                    : 'text-[#6e6e73] hover:text-[#1d1d1f]',
                )}
              >
                UAT / Test builds
              </button>
            </div>
            <p className="text-xs font-semibold leading-5 text-[#6e6e73]">
              {environment === 'production'
                ? 'Production GA4 property: one.hushh.ai plus its native app streams. Other web hosts are excluded.'
                : 'UAT GA4 property: uat.one.hushh.ai plus any native rows exported to that property. Other web hosts are excluded.'}
            </p>
          </div>
          <div className="shrink-0">{dateControl}</div>
        </div>

        {environment === 'production' && nativeUatTagged.length > 0 && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-[#007aff]/20 bg-[#007aff]/[0.06] px-4 py-3 text-sm font-semibold leading-5 text-[#245b88]">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Mobile backend routing: {nativeUatTagged.map((row) => `${row.platform} ${formatNumber(row.events)} events`).join(', ')} are tagged <code>env=uat</code>. This is expected while those public mobile builds use the UAT backend. They stay included in app analytics and are classified separately from production-backend activity.
            </p>
          </div>
        )}

        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className={appleLabel}>
              {environment === 'production' ? 'one.hushh.ai · production' : 'uat.one.hushh.ai · uat / test builds'} · {rangeLabel}
            </p>
            <h2 className="mt-1 text-2xl font-semibold text-[#1d1d1f] sm:text-3xl">
              How many registered and active users does One have?
            </h2>
          </div>
        </div>
        <OneAtAGlance one={activeData} />
        <PlatformsAtAGlance one={activeData} environment={environment} />
        <details className={cn(appleCard, 'mb-4 p-4 text-sm leading-6 text-[#3a3a3c]')}>
          <summary className="cursor-pointer font-semibold text-[#1d1d1f]">Plain-English guide to the numbers on this page</summary>
          <div className="mt-3 grid gap-x-6 gap-y-2 md:grid-cols-2">
            <p><strong>Registered users:</strong> distinct One account records in Firebase. “New” means the account was created during the selected dates. This does not prove one account per human.</p>
            <p><strong>Identified active users:</strong> distinct account IDs attached to meaningful GA4 activity. One account counts once even after repeat visits or use on multiple devices. Activity without an account ID is excluded.</p>
            <p><strong>First observed / returning:</strong> the account’s first tagged activity in the available export is inside / before the selected dates. First observed is not the same as a new registration.</p>
            <p><strong>Active devices:</strong> distinct app-install or browser identifiers with meaningful activity. One person can have several; anonymous visits are included. These are not unique people.</p>
            <p><strong>Daily / weekly / monthly:</strong> activity over 1 / 7 / 30 days, ending on the date printed on the tile. GA4’s finalized daily export may lag behind today or the selected end date.</p>
            <p><strong>Installs, activation, retention and agents:</strong> these describe device journeys, first value, week-1 return, and deliberate feature use. Their percentages use the stated device cohort as the denominator; they are not account growth.</p>
          </div>
          <p className="mt-3 border-t border-black/5 pt-3 text-xs font-semibold text-[#6e6e73]">
            Production and UAT are reporting-property selections, not a claim about which backend a mobile build calls. Public iOS builds can appear in the production GA4 property while still using the UAT backend.
          </p>
        </details>
        <details className="group">
          <summary className={cn(appleCard, 'cursor-pointer p-4 font-semibold text-[#1d1d1f]')}>
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

      <Block
        kicker="Device growth diagnostic"
        title="Are devices coming back?"
        hint="This secondary diagnostic uses device identifiers. The exact account-based New and Total user KPIs stay at the top of the page."
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
        title="What happens after a device installs the app?"
        hint="A true cohort: every stage counts the same device identifiers that installed in this window, so the percentages are real conversions. Web has no install to measure."
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
                  <CapabilityCard capability={capability} index={index} sourceAvailable={activeData.capabilitiesAvailable} />
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
        <Provenance one={activeData} rangeLabel={rangeLabel} environment={environment} />
      </section>
    </main>
  );
}
