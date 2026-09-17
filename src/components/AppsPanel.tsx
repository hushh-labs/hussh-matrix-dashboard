import type { ReactNode } from 'react';

import { cn } from '../lib/utils';
import { appleCard, appleLabel, applePanel } from '../lib/theme';
import { formatNumber } from '../lib/analytics-service';
import {
  ActivesByPlatform,
  Activation,
  InstallFunnel,
  Retention,
  platformLabel,
} from './OneAppPanel';
import type {
  AppStoreConnectEnvironments,
  AppStoreConnectMetrics,
  AppStoreConnectSummary,
  AppStoreConnectTestFlightMetrics,
  AppStoreConnectTestFlightSummary,
  OneAppSummary,
  OneLocationPlatformBehaviorMetric,
} from '../lib/types';

/**
 * Hushh Connect → Apps: Hushh 1 on iOS, Android and Web.
 *
 * Production and UAT are two columns, never merged into one number -- for iOS,
 * Production is the App Store and UAT is TestFlight. Every metric here is
 * reused as-is from the One app tab (`ActivesByPlatform`, `InstallFunnel`,
 * `Activation`, `Retention` are the same components, imported rather than
 * re-implemented) except the App Store Connect card, which is new.
 */
interface AppsPanelProps {
  one: OneAppSummary | null;
  oneUat: OneAppSummary | null;
  appStoreConnect: AppStoreConnectEnvironments | null;
  rangeLabel: string;
  dateControl?: ReactNode;
}

export function AppsPanel({ one, oneUat, appStoreConnect, rangeLabel, dateControl }: AppsPanelProps) {
  return (
    <main className="space-y-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className={appleLabel}>Hushh Connect · Apps</p>
          <h2 className="mt-2 text-3xl font-semibold text-[#1d1d1f] sm:text-4xl">
            Hushh 1 &mdash; iOS, Android, Web
          </h2>
          <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-[#6e6e73]">
            Production and UAT are reported side by side and never added together.
            For iOS, Production is the App Store and UAT is TestFlight.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <p className="text-xs font-semibold text-[#86868b]">{rangeLabel}</p>
          {dateControl}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <EnvironmentColumn
          label="Production"
          sublabel="iOS: App Store · Android & Web: production"
          one={one}
          appStoreConnectCard={appStoreConnect?.production && (
            <AppStoreConnectCard title="Hushh 1 iOS — App Store" summary={appStoreConnect.production} />
          )}
        />
        <EnvironmentColumn
          label="UAT"
          sublabel="iOS: TestFlight · Android & Web: UAT"
          one={oneUat}
          appStoreConnectCard={appStoreConnect?.testflight && (
            <AppStoreConnectTestFlightCard title="Hushh 1 iOS — TestFlight" summary={appStoreConnect.testflight} />
          )}
        />
      </div>
    </main>
  );
}

function EnvironmentColumn({
  label,
  sublabel,
  one,
  appStoreConnectCard,
}: {
  label: string;
  sublabel: string;
  one: OneAppSummary | null;
  appStoreConnectCard?: ReactNode;
}) {
  return (
    <section className="space-y-6">
      <div className={cn(applePanel, 'p-4')}>
        <p className="text-lg font-semibold text-[#1d1d1f]">{label}</p>
        <p className="text-xs font-semibold text-[#86868b]">{sublabel}</p>
      </div>

      {appStoreConnectCard}

      {one ? (
        <>
          <ActivesByPlatform rows={one.activeByPlatform} />
          <InstallFunnel funnels={one.installFunnel} />
          <Activation one={one} />
          <Retention one={one} />
          <LocationAgentByPlatform rows={one.locationAnalytics.platforms} />
        </>
      ) : (
        <div className={cn(applePanel, 'p-6 text-center')}>
          <p className="text-sm font-semibold text-[#6e6e73]">No data for this environment yet.</p>
        </div>
      )}
    </section>
  );
}

/**
 * App Store Connect — Hushh 1 iOS Production, from the Analytics Reports API.
 *
 * `summary.available === false` covers two distinct cases, distinguished only
 * by `note`: credentials are missing (`App Store Connect analytics not
 * connected`), or the request itself failed. Neither renders a zero.
 */
function AppStoreConnectCard({ title, summary }: { title: string; summary: AppStoreConnectSummary }) {
  return (
    <div className={cn(appleCard, 'p-6')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm font-semibold text-[#6e6e73]">{title}</p>
        {summary.range && (
          <p className="text-xs font-semibold text-[#86868b]">
            {summary.range.startDate} to {summary.range.endDate}
          </p>
        )}
      </div>

      {summary.available && summary.metrics ? (
        <div className="mt-4">
          <AppStoreConnectMetricsGrid metrics={summary.metrics} />
        </div>
      ) : (
        <p className="mt-4 text-sm font-semibold leading-5 text-[#8a5a04]">
          {summary.note ?? 'App Store Connect analytics not connected'}
        </p>
      )}
    </div>
  );
}

function AppStoreConnectMetricsGrid({ metrics }: { metrics: AppStoreConnectMetrics }) {
  const tiles: Array<{ label: string; value: number | null; percent?: boolean }> = [
    { label: 'Impressions', value: metrics.impressions },
    { label: 'Product page views', value: metrics.productPageViews },
    { label: 'First-time downloads', value: metrics.firstTimeDownloads },
    { label: 'Redownloads', value: metrics.redownloads },
    { label: 'Total downloads', value: metrics.totalDownloads },
    { label: 'Conversion rate', value: metrics.conversionRate, percent: true },
    { label: 'Sessions', value: metrics.sessions },
    { label: 'Active devices', value: metrics.activeDevices },
    { label: 'Installations', value: metrics.installations },
    { label: 'Crashes', value: metrics.crashes },
    { label: 'Deletions', value: metrics.deletions },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {tiles.map((tile) => (
        <div key={tile.label} className={cn(applePanel, 'p-3')}>
          <p className="text-[10px] font-bold uppercase tracking-wide text-[#86868b]">{tile.label}</p>
          <p className="mt-1 text-xl font-semibold text-[#1d1d1f]">
            {tile.value === null ? (
              <span className="text-[#c7c7cc]">&mdash;</span>
            ) : tile.percent ? (
              `${(tile.value * 100).toFixed(1)}%`
            ) : (
              formatNumber(tile.value)
            )}
          </p>
        </div>
      ))}
    </div>
  );
}

/**
 * App Store Connect — Hushh 1 iOS TestFlight, from the beta tester roster and
 * beta build/tester usage metrics and beta tester roster (not the Analytics
 * Reports API -- TestFlight has no bulk report equivalent since a pre-release
 * build has no product page). `note` is shown even when `available` is true:
 * sessions/crashes/feedback are Apple's own trailing-period rollup rather
 * than this exact custom range, and that's worth saying every time.
 */
function AppStoreConnectTestFlightCard({
  title,
  summary,
}: {
  title: string;
  summary: AppStoreConnectTestFlightSummary;
}) {
  return (
    <div className={cn(appleCard, 'p-6')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm font-semibold text-[#6e6e73]">{title}</p>
        {summary.range && (
          <p className="text-xs font-semibold text-[#86868b]">
            {summary.range.startDate} to {summary.range.endDate}
          </p>
        )}
      </div>

      {summary.available && summary.metrics && (
        <div className="mt-4">
          <AppStoreConnectTestFlightMetricsGrid metrics={summary.metrics} />
          {summary.metrics.testersByState && (
            <AppStoreConnectTesterStateBreakdown states={summary.metrics.testersByState} />
          )}
        </div>
      )}

      {summary.note && (
        <p
          className={cn(
            'text-sm font-semibold leading-5',
            summary.available ? 'mt-3 text-[#86868b]' : 'mt-4 text-[#8a5a04]',
          )}
        >
          {summary.note}
        </p>
      )}
    </div>
  );
}

function AppStoreConnectTestFlightMetricsGrid({ metrics }: { metrics: AppStoreConnectTestFlightMetrics }) {
  const tiles: Array<{ label: string; value: number | null }> = [
    { label: 'Beta testers', value: metrics.testerCount },
    { label: 'Invites', value: metrics.invites },
    { label: 'Installs', value: metrics.installs },
    { label: 'Sessions', value: metrics.sessions },
    { label: 'Crashes', value: metrics.crashes },
    { label: 'Feedback', value: metrics.feedback },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {tiles.map((tile) => (
        <div key={tile.label} className={cn(applePanel, 'p-3')}>
          <p className="text-[10px] font-bold uppercase tracking-wide text-[#86868b]">{tile.label}</p>
          <p className="mt-1 text-xl font-semibold text-[#1d1d1f]">
            {tile.value === null ? <span className="text-[#c7c7cc]">&mdash;</span> : formatNumber(tile.value)}
          </p>
        </div>
      ))}
    </div>
  );
}

function AppStoreConnectTesterStateBreakdown({
  states,
}: {
  states: NonNullable<AppStoreConnectTestFlightMetrics['testersByState']>;
}) {
  const rows: Array<{ label: string; value: number }> = [
    { label: 'Not invited', value: states.notInvited },
    { label: 'Invited', value: states.invited },
    { label: 'Accepted', value: states.accepted },
    { label: 'Installed', value: states.installed },
    { label: 'Revoked', value: states.revoked },
  ];
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {rows.map((row) => (
        <span
          key={row.label}
          className="rounded-md bg-[#f5f5f7] px-2 py-1 text-xs font-semibold text-[#6e6e73]"
        >
          {row.label}: {formatNumber(row.value)}
        </span>
      ))}
    </div>
  );
}

/**
 * Location Agent usage, split by platform -- the one part of the One app
 * summary that is genuinely platform-scoped (unlike the activation funnel and
 * retention above, which are product-wide and shown once per environment).
 */
function LocationAgentByPlatform({ rows }: { rows: OneLocationPlatformBehaviorMetric[] }) {
  if (rows.length === 0) {
    return (
      <div className={cn(applePanel, 'p-6 text-center')}>
        <p className="text-sm font-semibold text-[#6e6e73]">
          No Location Agent activity recorded in this window.
        </p>
      </div>
    );
  }

  return (
    <div className={cn(appleCard, 'overflow-hidden')}>
      <p className="border-b border-black/5 px-5 py-3 text-sm font-semibold text-[#1d1d1f]">
        Location Agent, by platform
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-bold uppercase text-[#86868b]">
              <th className="border-b border-black/5 px-5 py-3">Platform</th>
              <th className="border-b border-black/5 px-5 py-3">Feature</th>
              <th className="border-b border-black/5 px-5 py-3 text-right">Users</th>
              <th className="border-b border-black/5 px-5 py-3 text-right">Events</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.platform}-${row.feature}-${index}`} className="font-semibold text-[#1d1d1f]">
                <td className="border-b border-black/5 px-5 py-3">{platformLabel(row.platform)}</td>
                <td className="border-b border-black/5 px-5 py-3 text-[#6e6e73]">{row.feature}</td>
                <td className="border-b border-black/5 px-5 py-3 text-right tabular-nums">
                  {formatNumber(row.users)}
                </td>
                <td className="border-b border-black/5 px-5 py-3 text-right tabular-nums">
                  {formatNumber(row.events)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
