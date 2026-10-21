import { useMetricsResource } from '../lib/use-metrics-resource';
import { MetricsSkeleton, MetricsUpdateStatus } from './MetricsLoading';
import { ReportDetails, ReportTabs } from './ReportControls';
import { SingleDayPicker } from './SingleDayPicker';
import { ArrowDownRight, ArrowRight, ArrowUpRight, CalendarDays, Clock3, Info } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { FounderAgent, FounderBriefingData, FounderMeasure, FounderPeriod } from '../lib/founder-briefing';
import {
  FOUNDER_EARLIEST_DATE, founderChangeLabel, founderCustomRange, founderLatestCompleteDate,
  founderMonthRange, founderOutcomeHealth, founderPresetRange, founderReturningAccounts,
  founderTrend, founderWebIdentityMeasure,
} from '../lib/founder-briefing';

const agentDescriptions: Record<string, string> = {
  location: 'Sharing, circles, requests and check-ins',
  finance: 'Portfolio, analysis and imports',
  consent: 'Permissions, preferences and unlocks',
  gmail: 'Connection and receipt sync',
  ria: 'Workspace, onboarding and requests',
  marketplace: 'Marketplace profile views',
  memory: 'Preparing, saving and correcting memories',
  wallet: 'Secure card additions and removals',
  calendar: 'Connections and Calendar assistance handoffs',
  kyc: 'Access decisions and draft/reply actions',
  connected_systems: 'CRM relationships and record changes',
};

function number(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('en-US');
}

function dayLabel(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-US', {
    day: 'numeric', month: 'short', timeZone: 'UTC',
  });
}

function rangeLabel(period: FounderPeriod): string {
  return `${dayLabel(period.startDate)} – ${dayLabel(period.endDate)}`;
}

function ChangeBadge({ measure, neutralWhenNew = false }: { measure: FounderMeasure; neutralWhenNew?: boolean }) {
  const { trend } = founderTrend(measure);
  const neutral = trend === 'unavailable' || trend === 'flat' || (trend === 'new' && neutralWhenNew);
  const style = neutral ? 'is-neutral' : trend === 'down' ? 'is-down' : 'is-up';
  const Icon = trend === 'up' ? ArrowUpRight : trend === 'down' ? ArrowDownRight : Clock3;
  const label = trend === 'new' && neutralWhenNew ? 'No % · earlier period had 0' : founderChangeLabel(measure);
  return <span className={`change-badge ${style}`}>
    <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{label}
  </span>;
}

function MetricCard({ label, measure, note }: {
  label: string; measure: FounderMeasure; note: string;
}) {
  return <article className="dashboard-card founder-kpi" title={note}>

    <h3 className="mt-2">{label}</h3>
    <div className="founder-kpi-value"><p>{number(measure.current)}</p><ChangeBadge measure={measure} /></div>
    <p className="founder-kpi-note">{label === 'First-time accounts' ? 'First seen, not registrations' : label === 'Active accounts' ? 'Signed in · all platforms' : label === 'Returning accounts' ? 'First seen before this period' : 'At least one feature action'}</p>
  </article>;
}

function OutcomeHealth({ agent }: { agent: FounderAgent }) {
  const health = founderOutcomeHealth(agent);
  if (health.state === 'not_measured') return <span className="text-xs font-medium text-warning">Not measured</span>;
  if (health.state === 'unavailable') return <span className="text-xs font-medium text-muted">Source unavailable</span>;
  if (health.state === 'waiting') return <span className="text-xs font-medium text-muted">Waiting for result data</span>;
  const { successRate: rate, successes, expectedErrors: expected, failures } = health;
  const style = failures > 0 ? 'text-danger' : expected > 0 ? 'text-warning' : 'text-success';
  return <div className="min-w-40">
    <span className={`block text-sm font-semibold ${style}`}>{rate}% successful</span>
    <span className="mt-1 block text-[11px] leading-4 text-muted">
      {number(successes)} success · {number(expected)} blocked as expected · {number(failures)} failed
    </span>
  </div>;
}

function AgentRow({ agent }: { agent: FounderAgent; key?: string }) {
  return <tr className="border-t border-stroke align-top">
    <th scope="row" className="py-4 pr-5 text-left font-normal">
      <span className="block text-sm font-semibold text-ink">{agent.label}</span>
      <span className="mt-1 block text-xs leading-5 text-muted">{agent.instrumented
        ? agentDescriptions[agent.key] ?? 'Measured product interactions'
        : agent.note ?? 'Deliberate use is not measured yet'}</span>
    </th>
    <td className="py-4 pr-5 text-right text-sm font-semibold text-ink">{number(agent.identifiedAccounts.current)}</td>
    <td className="py-4 pr-5 text-right text-sm font-semibold text-ink">{number(agent.successfulAccounts.current)}</td>
    <td className="py-4 pr-5 text-right">
      <span className="block text-sm font-semibold text-ink">{number(agent.interactions.current)}</span>
      <span className="mt-1 block text-[11px] text-muted">iOS {number(agent.iosInteractions)} · Android {number(agent.androidInteractions ?? null)} · web {number(agent.webInteractions)}</span>
    </td>
    <td className="py-4 pr-5 text-right"><OutcomeHealth agent={agent} /></td>
    <td className="py-4 text-right">{agent.instrumented ? <ChangeBadge measure={agent.interactions} neutralWhenNew />
      : <span className="text-xs font-medium text-warning">Not measured</span>}</td>
  </tr>;
}

type Selection = '7d' | '30d' | '90d' | 'month' | 'custom' | 'day';
type ChartMode = 'accounts' | 'interactions';

export function FounderBriefingPanel({ refreshKey, onExploreOne }: {
  refreshKey: number;
  onExploreOne: () => void;
}) {
  const [selection, setSelection] = useState<Selection>('30d');
  const [period, setPeriod] = useState<FounderPeriod>(() => founderPresetRange(30));
  const [draftMonth, setDraftMonth] = useState(() => founderLatestCompleteDate().slice(0, 7));
  const [draftStart, setDraftStart] = useState(() => founderPresetRange(30).startDate);
  const [draftEnd, setDraftEnd] = useState(() => founderPresetRange(30).endDate);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [chartMode, setChartMode] = useState<ChartMode>('accounts');
  const latestComplete = founderLatestCompleteDate();
  const briefingUrl = (range: FounderPeriod) => '/api/analytics/founder?' + new URLSearchParams({ start_date: range.startDate, end_date: range.endDate });
  const resource = useMetricsResource<FounderBriefingData>(briefingUrl(period), { refreshKey, refreshIntervalMs: 30_000,
    prefetchUrls: [7, 30, 90].map(days => briefingUrl(founderPresetRange(days as 7 | 30 | 90))) });
  const brief = resource.data?.period && resource.data.one?.platforms && resource.data.one?.agents && resource.data.one?.daily && resource.data.search ? resource.data : null;
  const error = resource.error || Boolean(resource.data && !brief);

  const applyRange = (next: FounderPeriod | null, kind: Selection) => {
    if (!next) {
      setRangeError(`Select a valid completed range of up to 90 days, from ${FOUNDER_EARLIEST_DATE} through ${latestComplete}.`);
      return;
    }
    setRangeError(null);
    setSelection(kind);
    setPeriod(next);
    setDraftStart(next.startDate);
    setDraftEnd(next.endDate);
  };

  const rankedAgents = useMemo(() => (brief?.one.agents ?? [])
    .filter((agent) => agent.instrumented)
    .sort((a, b) => (b.identifiedAccounts.current ?? 0) - (a.identifiedAccounts.current ?? 0)
      || (b.interactions.current ?? 0) - (a.interactions.current ?? 0)), [brief]);
  const displayedAgents = [...(brief?.one.agents ?? [])].sort((a, b) => Number(b.instrumented) - Number(a.instrumented)
    || (b.identifiedAccounts.current ?? 0) - (a.identifiedAccounts.current ?? 0)
    || (b.interactions.current ?? 0) - (a.interactions.current ?? 0));
  const ios = brief?.one.platforms.find((item) => item.key === 'IOS');
  const android = brief?.one.platforms.find((item) => item.key === 'ANDROID');
  const web = brief?.one.platforms.find((item) => item.key === 'WEB');
  const { measure: webMeasure, currentGap: webIdentityGap, previousGap: webPreviousIdentityGap } = founderWebIdentityMeasure(web);
  const lowCoverage = brief?.one.accountCoverage !== null && brief?.one.accountCoverage !== undefined
    && brief.one.accountCoverage < 0.8;
  const returningAccounts = brief
    ? founderReturningAccounts(brief.one.activeAccounts, brief.one.firstObservedAccounts)
    : { current: null, previous: null };
  const chartData = (brief?.one.daily ?? []).map((point, index) => ({
    label: dayLabel(point.day),
    position: index + 1,
    current: chartMode === 'accounts' ? point.activeAccounts : point.agentInteractions,
    previous: chartMode === 'accounts' ? point.previousActiveAccounts : point.previousAgentInteractions,
  }));
  const hasPreviousLine = chartData.some((point) => point.previous !== null);

  const qualityWarning = webIdentityGap || webPreviousIdentityGap || lowCoverage || !brief?.one.available
    || !brief?.one.comparisonReady || !brief?.one.interactionComparisonReady || brief?.one.hasNativeEnvironmentConflict;

  return <main className="overview-report">
    <section className="overview-period" aria-label="Reporting period">
      <span className="text-sm font-medium text-ink">Reporting period</span>
      <ReportTabs label="Overview reporting period" value={selection}
        options={[{ value: '7d', label: '7 days' }, { value: '30d', label: '30 days' }, { value: '90d', label: '90 days' }]}
        onChange={value => applyRange(founderPresetRange(Number(value.replace('d', '')) as 7 | 30 | 90), value)} />
      <details className="overview-more-dates">
        <summary><CalendarDays size={15} aria-hidden="true" />More dates</summary>
        <div className="overview-date-fields">
          <button type="button" className="text-link" onClick={() => applyRange(founderCustomRange(latestComplete, latestComplete), 'day')}>Latest complete day</button>
          <SingleDayPicker label="Briefing specific day" value={period.days === 1 ? period.endDate : ''} min={FOUNDER_EARLIEST_DATE} max={latestComplete}
            onChange={day => applyRange(founderCustomRange(day, day), 'day')} />
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1 text-xs text-muted">Choose a month
              <input type="month" value={draftMonth} min="2026-05" max={latestComplete.slice(0, 7)} onChange={event => setDraftMonth(event.target.value)} />
            </label>
            <button type="button" className="quiet-button" onClick={() => applyRange(founderMonthRange(draftMonth), 'month')}>View month</button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1 text-xs text-muted">From<input type="date" value={draftStart} min={FOUNDER_EARLIEST_DATE} max={latestComplete} onChange={event => setDraftStart(event.target.value)} /></label>
            <label className="min-w-0 flex-1 text-xs text-muted">To<input type="date" value={draftEnd} min={FOUNDER_EARLIEST_DATE} max={latestComplete} onChange={event => setDraftEnd(event.target.value)} /></label>
            <button type="button" className="quiet-button" onClick={() => applyRange(founderCustomRange(draftStart, draftEnd), 'custom')}>Apply dates</button>
          </div>
          {rangeError && <p role="alert" className="text-xs text-danger">{rangeError}</p>}
        </div>
      </details>
      <MetricsUpdateStatus period={rangeLabel(period)} updatedAt={brief ? resource.updatedAt : null} loading={resource.loading} refreshing={resource.refreshing} error={error} />
    </section>
    <p className="overview-comparison">Compared with the previous {period.days === 1 ? 'day' : `${period.days} days`} · completed days only</p>
    {resource.loading && !brief ? <MetricsSkeleton label="Loading the selected briefing period" />
      : error && !brief ? <div role="alert" className="rounded-lg bg-warning-soft p-6 text-sm text-warning">The production briefing is temporarily unavailable. No estimate is shown.</div>
        : brief ? <>
          {error && <p role="status" className="rounded-lg bg-warning-soft p-3 text-sm text-warning">Refresh failed; the previous period remains visible.</p>}
          <div className="overview-kpis">
            <MetricCard label="Active accounts" measure={brief.one.activeAccounts} note="Distinct signed-in accounts across measured iOS, Android and web activity." />
            <MetricCard label="First-time accounts" measure={brief.one.firstObservedAccounts} note="First seen in available analytics history during this period. This is not a registration count." />
            <MetricCard label="Returning accounts" measure={returningAccounts} note="Active accounts first seen before this period." />
            <MetricCard label="Using features" measure={brief.one.agentEngagedAccounts} note="Distinct accounts with a measured feature action. Accounts are not added across features." />
          </div>
          {qualityWarning && <a className="overview-quality-note" href="#overview-data-quality" onClick={() => document.querySelector('#overview-data-quality > details')?.setAttribute('open', '')}><Info size={16} />Some data is incomplete. Review data quality before comparing totals.</a>}
          <section className="overview-trend" aria-labelledby="overview-trend-title">
            <div className="report-section-heading"><h2 id="overview-trend-title">Activity over time</h2>
              <ReportTabs label="Trend measure" value={chartMode} options={[{ value: 'accounts', label: 'Accounts' }, { value: 'interactions', label: 'Feature actions' }]} onChange={setChartMode} />
            </div>
            {brief.one.available ? <>
              <div className="overview-chart" role="img" aria-label={`Daily ${chartMode === 'accounts' ? 'identified active accounts' : 'feature actions'} trend for ${rangeLabel(brief.period)}`}>
                <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 640, height: 210 }}>
                  <AreaChart data={chartData} margin={{ top: 14, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--matrix-stroke)" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'var(--matrix-muted)', fontSize: 11 }} minTickGap={65} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: 'var(--matrix-muted)', fontSize: 11 }} />
                    <Tooltip formatter={value => number(typeof value === 'number' ? value : null)} />
                    {hasPreviousLine && <Area isAnimationActive={false} type="monotone" dataKey="previous" name="Previous period" fill="transparent" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="5 4" connectNulls={false} />}
                    <Area isAnimationActive={false} type="monotone" dataKey="current" name="Selected period" fill="#465fff" fillOpacity={0.07} stroke="#465fff" strokeWidth={2} connectNulls={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="overview-legend"><span><i />Selected period</span>{hasPreviousLine && <span><i className="is-previous" />Previous period</span>}</div>
              <ReportDetails title="View daily numbers">
                <div className="metrics-table-scroll" role="region" aria-label="Daily accounts and feature actions" tabIndex={0}>
                  <table><thead><tr><th scope="col">Date</th><th scope="col" className="text-right">Active accounts</th><th scope="col" className="text-right">Feature actions</th></tr></thead>
                    <tbody>{brief.one.daily.map(point => <tr key={point.day}><th scope="row" className="text-left font-normal">{point.day}</th><td className="text-right">{number(point.activeAccounts)}</td><td className="text-right">{number(point.agentInteractions)}</td></tr>)}</tbody>
                  </table>
                </div>
                <p className="report-footnote">Daily account counts can overlap. Adding them does not give the unique total for the period.</p>
              </ReportDetails>
            </> : <p className="py-8 text-sm text-muted">Activity data is unavailable for this period.</p>}
          </section>
          <div className="overview-breakdowns">
            <section aria-labelledby="top-features-title"><h2 id="top-features-title">Most used features</h2>
              <div className="overview-feature-list">{rankedAgents.slice(0, 3).map(agent => <div className="overview-feature-row" key={agent.key}>
                <span>{agent.label}</span><span className="feature-track" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, (agent.identifiedAccounts.current ?? 0) / Math.max(1, rankedAgents[0]?.identifiedAccounts.current ?? 1) * 100))}%` }} /></span>
                <strong>{number(agent.identifiedAccounts.current)}</strong><small>accounts</small>
              </div>)}</div>
              {!rankedAgents.length && <p className="report-footnote">Feature usage is not available yet.</p>}
              <ReportDetails title="All feature results" hint={`${displayedAgents.length} features`}>
                <p className="report-footnote">Accounts can appear in several rows. Actions include repeats.</p>
              <div className="metrics-table-scroll" role="region" aria-label="Scrollable metrics table" tabIndex={0}><table className="min-w-[760px] w-full text-left">
                <thead><tr className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted">
                  <th scope="col" className="pb-3 pr-5">Feature / behaviour</th>
                  <th scope="col" className="pb-3 pr-5 text-right">Signed-in accounts</th>
                  <th scope="col" className="pb-3 pr-5 text-right">Successful accounts</th>
                  <th scope="col" className="pb-3 pr-5 text-right">Actions by platform</th>
                  <th scope="col" className="pb-3 pr-5 text-right">Recorded results</th>
                  <th scope="col" className="pb-3 text-right">Change in actions</th>
                </tr></thead>
                <tbody>{displayedAgents.map((agent) => <AgentRow key={agent.key} agent={agent} />)}</tbody>
              </table></div>
                <p className="report-footnote">Waiting for result data means activity was recorded but its result has not arrived. Marketplace measures profile views, not purchases.</p>
              </ReportDetails>
            </section>
            <section aria-labelledby="platform-activity-title"><h2 id="platform-activity-title">Platform activity</h2>
              <div className="overview-platform-list">{[
                { label: 'iOS', measure: ios?.identifiedAccounts ?? { current: null, previous: null } },
                { label: 'Android', measure: android?.identifiedAccounts ?? { current: null, previous: null } },
                { label: 'Web', measure: webMeasure },
              ].map(platform => <div key={platform.label}><span>{platform.label}</span><strong>{number(platform.measure.current)}</strong><small>accounts</small></div>)}</div>
              <p className="report-footnote">Accounts may overlap across platforms.{webIdentityGap ? ' Web totals are withheld while identity tracking is under review.' : ''}</p>
            </section>
          </div>
          <ReportDetails title="Search performance" hint="One website">
            <div className="flex flex-wrap items-end gap-8"><div><p className="text-sm text-muted">Google clicks</p><p className="text-3xl font-semibold">{number(brief.search.clicks.current)}</p></div>
              <div><p className="text-sm text-muted">Search appearances</p><p className="text-3xl font-semibold">{number(brief.search.impressions.current)}</p></div><ChangeBadge measure={brief.search.clicks} />
            </div>
            <p className="report-footnote">Google search clicks and appearances are not unique visitors or app users.</p>
            {!brief.search.available && <p className="report-footnote text-warning">The search export is incomplete; no value is guessed.</p>}
          </ReportDetails>
          <div id="overview-data-quality"><ReportDetails title="Data quality & definitions" hint={qualityWarning ? 'Review needed' : undefined}>
              <ul className="mt-4 space-y-2 text-sm leading-6 text-ink">
                {webIdentityGap && <li>Web identity tracking needs repair: {number(web?.signInIdentifiers ?? null)} browser identifiers recorded a successful sign-in, but only {number(web?.signedInBoundIdentifiers ?? null)} of those later carried an account ID in this period. Sign-ins and browsers are <strong>not</strong> unique people. The web user total and its growth percentage are withheld.</li>}
                {!webIdentityGap && webPreviousIdentityGap && <li>The earlier web period had {number(web?.previousSignedInBoundIdentifiers ?? null)} account-bound identifiers after {number(web?.previousSignInIdentifiers ?? null)} signed-in identifiers. Its identified-account count is not a reliable baseline, so web growth is withheld.</li>}
                {lowCoverage && <li>Only {Math.round((brief.one.accountCoverage ?? 0) * 100)}% of tracked app/browser identifiers are linked to an account. Unlinked people cannot be uniquely counted.</li>}
                {brief.one.available && !brief.one.comparisonReady && <li>Account tagging or Android export coverage is incomplete for the earlier period. Account-growth percentages are withheld until both periods are fully comparable.</li>}
                {brief.one.available && !brief.one.interactionComparisonReady && <li>The earlier agent-interaction period predates reliable event history for a contributing platform. Its comparisons are withheld, not treated as zero.</li>}
                {brief.one.hasNativeEnvironmentConflict && <li>Some public iOS events still carry a test-environment label. They are not described as production-backend customers.</li>}
                {!brief.one.available && <li>The One GA4 source could not be verified for this selection.</li>}
                {!lowCoverage && brief.one.comparisonReady && !brief.one.hasNativeEnvironmentConflict && brief.one.available && <li>Account-linked coverage and comparison history meet this briefing’s checks. Anonymous activity remains outside person counts.</li>}
              </ul>
            <dl className="overview-definitions">
              <div><dt>Active accounts</dt><dd>Different signed-in accounts with measured activity. One account counts once across devices when its identifier is available.</dd></div>
              <div><dt>First-time accounts</dt><dd>First seen in available analytics history in this period. This does not mean newly registered.</dd></div>
              <div><dt>Returning accounts</dt><dd>Active accounts first seen before this period.</dd></div>
              <div><dt>Using features</dt><dd>Accounts with at least one measured feature action. Repeated actions do not add accounts.</dd></div>
              <div><dt>Missing data</dt><dd>0 means no matching activity was recorded. An em dash means unavailable or unmeasured.</dd></div>
            </dl>
            <p className="report-footnote">Android activity is included only when marked as using the live service. Test and debug activity is excluded. Accounts are not verified unique people.</p>
          </ReportDetails></div>
          <button type="button" onClick={onExploreOne} className="text-link overview-explore">Explore One app <ArrowRight size={16} /></button>
        </> : null}
  </main>;
}
