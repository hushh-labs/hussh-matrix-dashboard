import { useMetricsResource } from '../lib/use-metrics-resource';
import { MetricsSkeleton, MetricsUpdateStatus } from './MetricsLoading';
import { SingleDayPicker } from './SingleDayPicker';
import { ArrowDownRight, ArrowRight, ArrowUpRight, CalendarDays, Clock3, Info, RefreshCw, ShieldAlert, Sparkles } from 'lucide-react';
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

function MetricCard({ eyebrow, label, measure, note }: {
  eyebrow: string; label: string; measure: FounderMeasure; note: string;
}) {
  return <article className="dashboard-card founder-kpi">
    <p className="dashboard-label">{eyebrow}</p>
    <h3 className="mt-2">{label}</h3>
    <div className="founder-kpi-value"><p>{number(measure.current)}</p><ChangeBadge measure={measure} /></div>
    <details><summary>How this is counted</summary><p>{note}</p></details>
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
  const loading = resource.loading || resource.refreshing;
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
  const mostAccounts = rankedAgents.find((agent) => (agent.identifiedAccounts.current ?? 0) > 0);
  const mostInteractions = [...rankedAgents].sort((a, b) => (b.interactions.current ?? 0) - (a.interactions.current ?? 0))[0];
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

  return <main className="space-y-5 pb-10">
    <section className="dashboard-card report-filter" aria-label="Founder reporting period">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-ink"><CalendarDays className="h-4 w-4 text-brand-600" /> Reporting period</p>
          <p className="mt-1 text-xs text-muted">Live product data through {dayLabel(latestComplete)} · compared with the preceding equal-length period</p>
        </div>
        {loading && <span role="status" className="inline-flex items-center gap-2 text-xs text-brand-600"><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Updating</span>}
      </div>
      <div className="filter-presets">
        {([7, 30, 90] as const).map((days) => <button key={days} type="button"
          aria-pressed={selection === `${days}d`}
          onClick={() => applyRange(founderPresetRange(days), `${days}d`)}
          className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${selection === `${days}d` ? 'bg-subtle text-ink' : 'bg-transparent text-muted'}`}>
          Last {days} days
        </button>)}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => applyRange(founderCustomRange(latestComplete, latestComplete), 'day')}
          aria-pressed={selection === 'day' && period.endDate === latestComplete}
          className="min-h-10 rounded-lg bg-brand-50 px-3 text-sm font-semibold text-brand-600">Latest complete day</button>
        <SingleDayPicker label="Briefing specific day" value={period.days === 1 ? period.endDate : ''} min={FOUNDER_EARLIEST_DATE} max={latestComplete}
          onChange={day => applyRange(founderCustomRange(day, day), 'day')} />
      </div>
      <details className="filter-custom"><summary>Custom dates or calendar month</summary>
      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-40 flex-1 text-xs font-semibold text-muted">Choose a month
            <input type="month" value={draftMonth} min="2026-05" max={latestComplete.slice(0, 7)} onChange={(event) => setDraftMonth(event.target.value)}
              className="mt-1 block min-h-10 w-full rounded-lg border border-stroke bg-surface px-3 text-sm text-ink" />
          </label>
          <button type="button" onClick={() => applyRange(founderMonthRange(draftMonth), 'month')}
            className={`min-h-10 rounded-lg px-3 text-sm font-semibold ${selection === 'month' ? 'bg-brand-500 text-white' : 'bg-brand-50 text-brand-600'}`}>View month</button>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-32 flex-1 text-xs font-semibold text-muted">From
            <input type="date" value={draftStart} min={FOUNDER_EARLIEST_DATE} max={latestComplete} onChange={(event) => setDraftStart(event.target.value)}
              className="mt-1 block min-h-10 w-full rounded-lg border border-stroke bg-surface px-3 text-sm text-ink" />
          </label>
          <label className="min-w-32 flex-1 text-xs font-semibold text-muted">To
            <input type="date" value={draftEnd} min={FOUNDER_EARLIEST_DATE} max={latestComplete} onChange={(event) => setDraftEnd(event.target.value)}
              className="mt-1 block min-h-10 w-full rounded-lg border border-stroke bg-surface px-3 text-sm text-ink" />
          </label>
          <button type="button" onClick={() => applyRange(founderCustomRange(draftStart, draftEnd), 'custom')}
            className={`min-h-10 rounded-lg px-3 text-sm font-semibold ${selection === 'custom' ? 'bg-brand-500 text-white' : 'bg-brand-50 text-brand-600'}`}>Apply dates</button>
        </div>
      </div>
      </details>
      {rangeError && <p role="alert" className="mt-3 text-xs font-medium text-danger">{rangeError}</p>}
    </section>

    <MetricsUpdateStatus period={rangeLabel(period)} updatedAt={brief ? resource.updatedAt : null} loading={resource.loading} refreshing={resource.refreshing} error={error} />
    {resource.loading && !brief ? <MetricsSkeleton label="Loading the selected briefing period" />
      : error && !brief ? <div role="alert" className="rounded-2xl border border-amber-200 bg-warning-soft p-6 text-sm text-warning">The production briefing is temporarily unavailable. No estimate is shown.</div>
        : brief ? <>
          {error && <p role="status" className="rounded-xl bg-warning-soft p-3 text-sm text-warning">Refresh failed; the previous period remains visible.</p>}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard eyebrow="One · all platforms" label="Active signed-in accounts" measure={brief.one.activeAccounts}
              note="A signed-in account is counted once across iOS, Android and web when an account identifier is available." />
            <MetricCard eyebrow="One · audience growth" label="Accounts first seen in this period" measure={brief.one.firstObservedAccounts}
              note="Signed-in accounts seen for the first time in available One analytics history. This is not a registration count." />
            <MetricCard eyebrow="One · audience loyalty" label="Returning active accounts" measure={returningAccounts}
              note="Active signed-in accounts first observed before this period. Repeat actions and extra devices do not add users." />
            <MetricCard eyebrow="One · feature adoption" label="Accounts using features" measure={brief.one.agentEngagedAccounts}
              note="Distinct signed-in accounts with at least one measured feature action—not a sum of agent rows." />

          </div>

          <section className="grid gap-4 lg:grid-cols-[1.45fr_1fr]">
            <div className="dashboard-card p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-600">Audience over time</p>
                  <h2 className="mt-1 text-xl font-semibold text-ink">The trend, day by day</h2></div>
                <div className="flex rounded-lg bg-subtle p-1" role="group" aria-label="Trend measure">
                  <button type="button" aria-pressed={chartMode === 'accounts'} onClick={() => setChartMode('accounts')}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold ${chartMode === 'accounts' ? 'bg-surface text-ink shadow-sm' : 'text-muted'}`}>Accounts</button>
                  <button type="button" aria-pressed={chartMode === 'interactions'} onClick={() => setChartMode('interactions')}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold ${chartMode === 'interactions' ? 'bg-surface text-ink shadow-sm' : 'text-muted'}`}>Feature actions</button>
                </div>
              </div>
              {brief.one.available ? <>
                <div className="mt-5 h-60 w-full" role="img" aria-label={`Daily ${chartMode === 'accounts' ? 'identified active accounts' : 'feature actions'} trend for ${rangeLabel(brief.period)}`}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 8, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: '#64748b', fontSize: 11 }} minTickGap={25} />
                      <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#64748b', fontSize: 11 }} />
                      <Tooltip formatter={(value) => number(typeof value === 'number' ? value : null)} />
                      {hasPreviousLine && <Area type="monotone" dataKey="previous" name="Earlier period" fill="#cbd5e1" fillOpacity={0.12} stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="5 4" />}
                      <Area type="monotone" dataKey="current" name="Selected period" fill="#465fff" fillOpacity={0.16} stroke="#3641f5" strokeWidth={2.5} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted">
                  <span><i className="mr-1 inline-block h-2 w-4 rounded bg-brand-500" /> Selected period</span>
                  {hasPreviousLine && <span><i className="mr-1 inline-block h-2 w-4 rounded bg-slate-400" /> Earlier equal-length period</span>}
                </div>
                <details className="mt-4 border-t border-stroke pt-3"><summary className="cursor-pointer text-sm font-semibold text-brand-600">View daily numbers</summary>
                  <div className="metrics-table-scroll mt-3" role="region" aria-label="Daily accounts and feature actions" tabIndex={0}>
                    <table className="w-full text-left text-xs"><thead><tr className="text-muted"><th scope="col" className="py-3">Date</th><th scope="col" className="px-3 text-right">Active signed-in accounts</th><th scope="col" className="pl-3 text-right">Feature actions</th></tr></thead>
                      <tbody>{brief.one.daily.map(point => <tr key={point.day} className="border-t border-stroke"><th scope="row" className="py-3 font-medium">{point.day}</th><td className="px-3 text-right">{number(point.activeAccounts)}</td><td className="pl-3 text-right">{number(point.agentInteractions)}</td></tr>)}</tbody>
                    </table>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted">An account can appear on several days. Adding daily counts does not give the unique total for the period. Repeated feature actions count again.</p>
                </details>
              </> : <p className="mt-6 text-sm text-muted">One activity source is unavailable; a trend cannot be shown.</p>}
            </div>
            <div className="dashboard-card p-5 sm:p-6">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-600">Founder readout</p>
              <h2 className="mt-1 text-xl font-semibold text-ink">What stands out</h2>
              <ul className="mt-5 space-y-4 text-sm leading-6 text-ink">
                <li><strong className="text-ink">iOS:</strong> {number(ios?.identifiedAccounts.current ?? null)} signed-in accounts; <strong className="text-ink">web:</strong> {webIdentityGap ? 'user total unverified' : `${number(web?.identifiedAccounts.current ?? null)} signed-in accounts`}. <strong className="text-ink"> Android:</strong> {number(android?.identifiedAccounts.current ?? null)} signed-in accounts. These platform populations can overlap.</li>
                <li>{mostAccounts ? <><strong className="text-ink">Most signed-in accounts used {mostAccounts.label}:</strong> {number(mostAccounts.identifiedAccounts.current)} in this period.</>
                  : 'No agent has a verifiable signed-in audience in this range yet.'}</li>
                <li>{mostInteractions ? <><strong className="text-ink">Most recorded actions:</strong> {mostInteractions.label} had {number(mostInteractions.interactions.current)}. Repeats count; this is not a user count.</>
                  : 'Agent interaction data is not available yet.'}</li>
                <li><strong className="text-ink">First useful action:</strong> {number(brief.one.activatedAccounts.current)} signed-in accounts completed the measured Location activation action.</li>
              </ul>
            </div>
          </section>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <MetricCard eyebrow="One · iOS" label="Active iOS accounts" measure={ios?.identifiedAccounts ?? { current: null, previous: null }}
              note="Distinct signed-in accounts active in the public iOS build. Unidentified activity is excluded." />
            <MetricCard eyebrow="One · Android" label="Active Android accounts · live service"
              measure={android?.identifiedAccounts ?? {current:null,previous:null}}
              note={android?.captureState === 'observed' ? 'Distinct signed-in Android accounts with a production backend tag. Platform audiences overlap.' : 'Awaiting exported Android activity with a production backend tag. The current public build used UAT; missing history is not zero.'} />
            <MetricCard eyebrow="One · web" label={webIdentityGap ? 'Web user count under review' : 'Active web accounts'}
              measure={webMeasure}
              note={webIdentityGap
                ? `${number(web?.identifiedAccounts.current ?? null)} account IDs reached analytics, but only ${number(web?.signedInBoundIdentifiers ?? null)} of ${number(web?.signInIdentifiers ?? null)} sign-in browser identifiers later carried an account ID. This is not a reliable total of web users.`
                : webPreviousIdentityGap
                  ? 'Current signed-in accounts are shown, but growth is withheld: the earlier period did not reliably bind signed-in web activity to accounts.'
                  : 'Distinct signed-in accounts active on one.hushh.ai. A person on both platforms is not added twice above.'} />
          </div>

          <section className="dashboard-card p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-600">Inside One</p>
                <h2 className="mt-1 text-xl font-semibold text-ink">What do people use most?</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">See which agents people use and whether recorded steps succeed. Accounts are counted once within each row; actions can repeat. The same account can appear in several rows.</p></div>
              <button type="button" onClick={onExploreOne} className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:text-sky-900">Explore full One analytics <ArrowRight className="h-4 w-4" /></button>
            </div>
            <div className="mt-5 overflow-x-auto">
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
            </div>
            <p className="mt-4 text-xs leading-5 text-muted">Waiting for result data means activity was recorded, but its result has not arrived yet. Marketplace counts profile views; it does not count completed purchases.</p>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="dashboard-card p-5 sm:p-6">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-600">Acquisition · One web</p>
              <h2 className="mt-1 text-xl font-semibold text-ink">Discovery from Google Search</h2>
              <div className="mt-4 flex flex-wrap items-end gap-7">
                <div><p className="text-xs text-muted">Clicks</p><p className="text-3xl font-semibold text-ink">{number(brief.search.clicks.current)}</p></div>
                <div><p className="text-xs text-muted">Impressions</p><p className="text-3xl font-semibold text-ink">{number(brief.search.impressions.current)}</p></div>
                <ChangeBadge measure={brief.search.clicks} />
              </div>
              <p className="mt-4 text-sm leading-6 text-muted">Google Search Console counts search-result clicks and appearances for One’s production website. Clicks are neither unique visitors nor app users.</p>
              {!brief.search.available && <p className="mt-2 text-xs font-medium text-warning">The selected Search Console export is incomplete; no value is guessed.</p>}
            </div>
            <div className="rounded-2xl border border-amber-200 bg-warning-soft p-5 sm:p-6">
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-warning"><ShieldAlert className="h-4 w-4" /> Data quality</p>
              <h2 className="mt-1 text-xl font-semibold text-ink">What to keep in mind</h2>
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
              <p className="mt-3 flex items-start gap-1.5 text-xs leading-5 text-warning"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> This briefing includes Android activity only when it is marked as using the live service. Test and debug Android activity is excluded.</p>
            </div>
          </section>
        </> : null}
  </main>;
}
