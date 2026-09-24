import { ArrowDownRight, ArrowRight, ArrowUpRight, CalendarDays, Clock3, Info, RefreshCw, ShieldAlert, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { FounderAgent, FounderBriefingData, FounderMeasure, FounderPeriod } from '../lib/founder-briefing';
import {
  FOUNDER_EARLIEST_DATE, founderChangeLabel, founderCustomRange, founderLatestCompleteDate,
  founderMonthRange, founderPresetRange, founderTrend,
} from '../lib/founder-briefing';

const agentDescriptions: Record<string, string> = {
  location: 'Sharing, circles, requests and check-ins',
  finance: 'Portfolio, analysis and imports',
  consent: 'Permissions, preferences and unlocks',
  gmail: 'Connection and receipt sync',
  ria: 'Workspace, onboarding and requests',
  marketplace: 'Marketplace profile views',
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
  const style = neutral ? 'bg-slate-100 text-slate-600 ring-slate-200'
    : trend === 'down' ? 'bg-rose-50 text-rose-800 ring-rose-200'
      : 'bg-emerald-50 text-emerald-800 ring-emerald-200';
  const Icon = trend === 'up' ? ArrowUpRight : trend === 'down' ? ArrowDownRight : Clock3;
  const label = trend === 'new' && neutralWhenNew ? 'No % · earlier period had 0' : founderChangeLabel(measure);
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${style}`}>
    <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{label}
  </span>;
}

function MetricCard({ eyebrow, label, measure, note }: {
  eyebrow: string; label: string; measure: FounderMeasure; note: string;
}) {
  return <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_12px_36px_rgba(15,23,42,0.05)]">
    <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-sky-700">{eyebrow}</p>
    <h3 className="mt-3 text-sm font-semibold text-slate-700">{label}</h3>
    <p className="mt-1 text-4xl font-semibold tracking-tight text-slate-950">{number(measure.current)}</p>
    <div className="mt-3"><ChangeBadge measure={measure} /></div>
    <p className="mt-4 text-sm leading-6 text-slate-600">{note}</p>
  </article>;
}

function AgentRow({ agent }: { agent: FounderAgent; key?: string }) {
  return <tr className="border-t border-slate-100 align-top">
    <th scope="row" className="py-4 pr-5 text-left font-normal">
      <span className="block text-sm font-semibold text-slate-900">{agent.label}</span>
      <span className="mt-1 block text-xs leading-5 text-slate-500">{agent.instrumented
        ? agentDescriptions[agent.key] ?? 'Measured product interactions'
        : 'Deliberate use is not instrumented yet'}</span>
    </th>
    <td className="py-4 pr-5 text-right text-sm font-semibold text-slate-900">{number(agent.identifiedAccounts.current)}</td>
    <td className="py-4 pr-5 text-right text-sm font-semibold text-slate-900">{number(agent.interactions.current)}</td>
    <td className="py-4 pr-5 text-right text-xs text-slate-600">{agent.instrumented
      ? `${number(agent.iosInteractions)} / ${number(agent.webInteractions)}` : '—'}</td>
    <td className="py-4 text-right">{agent.instrumented
      ? <ChangeBadge measure={agent.interactions} neutralWhenNew />
      : <span className="text-xs font-medium text-amber-800">Not measured</span>}</td>
  </tr>;
}

type Selection = '7d' | '30d' | '90d' | 'month' | 'custom';
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
  const [brief, setBrief] = useState<FounderBriefingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [chartMode, setChartMode] = useState<ChartMode>('accounts');
  const latestComplete = founderLatestCompleteDate();

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    const query = new URLSearchParams({ start_date: period.startDate, end_date: period.endDate });
    fetch(`/api/analytics/founder?${query}`, {
      cache: 'no-store', headers: { Accept: 'application/json' }, signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Briefing source unavailable');
        return response.json() as Promise<FounderBriefingData>;
      })
      .then((result) => {
        if (!result?.period || !result.one?.platforms || !result.one?.agents || !result.one?.daily || !result.search) {
          throw new Error('Briefing response incomplete');
        }
        setBrief(result);
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [period.startDate, period.endDate, refreshKey]);

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
  const web = brief?.one.platforms.find((item) => item.key === 'WEB');
  const lowCoverage = brief?.one.accountCoverage !== null && brief?.one.accountCoverage !== undefined
    && brief.one.accountCoverage < 0.8;
  const chartData = (brief?.one.daily ?? []).map((point, index) => ({
    label: dayLabel(point.day),
    position: index + 1,
    current: chartMode === 'accounts' ? point.activeAccounts : point.agentInteractions,
    previous: chartMode === 'accounts' ? point.previousActiveAccounts : point.previousAgentInteractions,
  }));
  const hasPreviousLine = chartData.some((point) => point.previous !== null);

  return <main className="space-y-5 pb-10">
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-label="Founder reporting period">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-900"><CalendarDays className="h-4 w-4 text-sky-700" /> Reporting period</p>
          <p className="mt-1 text-xs text-slate-500">Production data through {dayLabel(latestComplete)} · compared with the preceding equal-length period</p>
        </div>
        {loading && <span role="status" className="inline-flex items-center gap-2 text-xs text-sky-700"><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Updating</span>}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {([7, 30, 90] as const).map((days) => <button key={days} type="button"
          aria-pressed={selection === `${days}d`}
          onClick={() => applyRange(founderPresetRange(days), `${days}d`)}
          className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${selection === `${days}d` ? 'bg-[#112034] text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
          Last {days} days
        </button>)}
      </div>
      <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-40 flex-1 text-xs font-semibold text-slate-600">Choose a month
            <input type="month" value={draftMonth} min="2026-05" max={latestComplete.slice(0, 7)} onChange={(event) => setDraftMonth(event.target.value)}
              className="mt-1 block min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900" />
          </label>
          <button type="button" onClick={() => applyRange(founderMonthRange(draftMonth), 'month')}
            className={`min-h-10 rounded-lg px-3 text-sm font-semibold ${selection === 'month' ? 'bg-sky-700 text-white' : 'bg-sky-50 text-sky-800'}`}>View month</button>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-32 flex-1 text-xs font-semibold text-slate-600">From
            <input type="date" value={draftStart} min={FOUNDER_EARLIEST_DATE} max={latestComplete} onChange={(event) => setDraftStart(event.target.value)}
              className="mt-1 block min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900" />
          </label>
          <label className="min-w-32 flex-1 text-xs font-semibold text-slate-600">To
            <input type="date" value={draftEnd} min={FOUNDER_EARLIEST_DATE} max={latestComplete} onChange={(event) => setDraftEnd(event.target.value)}
              className="mt-1 block min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900" />
          </label>
          <button type="button" onClick={() => applyRange(founderCustomRange(draftStart, draftEnd), 'custom')}
            className={`min-h-10 rounded-lg px-3 text-sm font-semibold ${selection === 'custom' ? 'bg-sky-700 text-white' : 'bg-sky-50 text-sky-800'}`}>Apply dates</button>
        </div>
      </div>
      {rangeError && <p role="alert" className="mt-3 text-xs font-medium text-rose-700">{rangeError}</p>}
    </section>

    <section className="relative overflow-hidden rounded-[28px] bg-[#112034] px-6 py-8 text-white shadow-[0_24px_70px_rgba(17,32,52,0.18)] sm:px-9 sm:py-9">
      <div className="pointer-events-none absolute -right-10 -top-20 h-72 w-72 rounded-full bg-sky-400/15 blur-3xl" />
      <div className="relative">
        <p className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.17em] text-sky-100">
          <Sparkles className="h-3.5 w-3.5" /> One app · founder briefing
        </p>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight sm:text-5xl">Who is using One—and what do they do?</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-200 sm:text-base">A clear production view of identifiable users on iOS and web, the agents they use, and how behaviour changes over time.</p>
        {brief && <div className="mt-6 flex flex-wrap gap-2 text-xs font-medium text-slate-200">
          <span className="rounded-full bg-white/10 px-3 py-1.5">{rangeLabel(brief.period)} · {brief.period.days} days</span>
          <span className="rounded-full bg-white/10 px-3 py-1.5">vs {rangeLabel(brief.previousPeriod)}</span>
          <span className="rounded-full bg-white/10 px-3 py-1.5">GA4 export · updated {new Date(brief.generatedAt).toLocaleString('en-US')}</span>
        </div>}
      </div>
    </section>

    {loading && !brief ? <div role="status" className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">Preparing the One briefing…</div>
      : error && !brief ? <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">The production briefing is temporarily unavailable. No estimate is shown.</div>
        : brief ? <>
          {error && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Refresh failed; the previous period remains visible.</p>}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard eyebrow="One · all platforms" label="Identifiable active accounts" measure={brief.one.activeAccounts}
              note="A signed-in account is counted once across iOS and web, even if it uses both." />
            <MetricCard eyebrow="One · iOS" label="iOS app users we can identify" measure={ios?.identifiedAccounts ?? { current: null, previous: null }}
              note="Distinct signed-in accounts active in the public iOS build. Unidentified activity is excluded." />
            <MetricCard eyebrow="One · web" label="Web users we can identify" measure={web?.identifiedAccounts ?? { current: null, previous: null }}
              note="Distinct signed-in accounts active on one.hushh.ai. A person on both platforms is not added twice above." />
            <MetricCard eyebrow="One · agents" label="Accounts using a measured agent" measure={brief.one.agentEngagedAccounts}
              note="Distinct signed-in accounts with at least one measured agent interaction—not a sum of agent rows." />
          </div>

          <section className="grid gap-4 lg:grid-cols-[1.45fr_1fr]">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-sky-700">Audience over time</p>
                  <h2 className="mt-1 text-xl font-semibold text-slate-950">The trend, day by day</h2></div>
                <div className="flex rounded-lg bg-slate-100 p-1" role="group" aria-label="Trend measure">
                  <button type="button" aria-pressed={chartMode === 'accounts'} onClick={() => setChartMode('accounts')}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold ${chartMode === 'accounts' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}>Accounts</button>
                  <button type="button" aria-pressed={chartMode === 'interactions'} onClick={() => setChartMode('interactions')}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold ${chartMode === 'interactions' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}>Agent interactions</button>
                </div>
              </div>
              {brief.one.available ? <>
                <div className="mt-5 h-60 w-full" role="img" aria-label={`Daily ${chartMode === 'accounts' ? 'identified active accounts' : 'agent interactions'} trend for ${rangeLabel(brief.period)}`}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 8, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: '#64748b', fontSize: 11 }} minTickGap={25} />
                      <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#64748b', fontSize: 11 }} />
                      <Tooltip formatter={(value) => number(typeof value === 'number' ? value : null)} />
                      {hasPreviousLine && <Area type="monotone" dataKey="previous" name="Earlier period" fill="#cbd5e1" fillOpacity={0.12} stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="5 4" />}
                      <Area type="monotone" dataKey="current" name="Selected period" fill="#0ea5e9" fillOpacity={0.16} stroke="#0369a1" strokeWidth={2.5} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-500">
                  <span><i className="mr-1 inline-block h-2 w-4 rounded bg-sky-600" /> Selected period</span>
                  {hasPreviousLine && <span><i className="mr-1 inline-block h-2 w-4 rounded bg-slate-400" /> Earlier equal-length period</span>}
                </div>
              </> : <p className="mt-6 text-sm text-slate-600">One activity source is unavailable; a trend cannot be shown.</p>}
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-sky-700">Founder readout</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-950">What stands out</h2>
              <ul className="mt-5 space-y-4 text-sm leading-6 text-slate-700">
                <li><strong className="text-slate-900">iOS:</strong> {number(ios?.identifiedAccounts.current ?? null)} identified accounts; <strong className="text-slate-900">web:</strong> {number(web?.identifiedAccounts.current ?? null)}. These platform populations can overlap.</li>
                <li>{mostAccounts ? <><strong className="text-slate-900">Most identified accounts used {mostAccounts.label}:</strong> {number(mostAccounts.identifiedAccounts.current)} in this period.</>
                  : 'No agent has a verifiable signed-in audience in this range yet.'}</li>
                <li>{mostInteractions ? <><strong className="text-slate-900">Most measured interactions:</strong> {mostInteractions.label} had {number(mostInteractions.interactions.current)}. Repeats count; this is not a user count.</>
                  : 'Agent interaction data is not available yet.'}</li>
                <li><strong className="text-slate-900">First value:</strong> {number(brief.one.activatedAccounts.current)} identified accounts completed the measured Location activation action.</li>
              </ul>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-sky-700">Agent behaviour</p>
                <h2 className="mt-1 text-xl font-semibold text-slate-950">Which agents do people choose?</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Accounts are deduplicated separately for each agent. Interactions count catalogued actions and selected views, so the same person can contribute more than once. Agent rows must not be added together.</p></div>
              <button type="button" onClick={onExploreOne} className="inline-flex items-center gap-1 text-sm font-semibold text-sky-700 hover:text-sky-900">Explore full One analytics <ArrowRight className="h-4 w-4" /></button>
            </div>
            <div className="mt-5 overflow-x-auto">
              <table className="min-w-[760px] w-full text-left">
                <thead><tr className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">
                  <th scope="col" className="pb-3 pr-5">Agent / behaviour</th>
                  <th scope="col" className="pb-3 pr-5 text-right">Known accounts</th>
                  <th scope="col" className="pb-3 pr-5 text-right">Interactions</th>
                  <th scope="col" className="pb-3 pr-5 text-right">iOS / web</th>
                  <th scope="col" className="pb-3 text-right">Change in actions</th>
                </tr></thead>
                <tbody>{displayedAgents.map((agent) => <AgentRow key={agent.key} agent={agent} />)}</tbody>
              </table>
            </div>
            <p className="mt-4 text-xs leading-5 text-slate-500">Not measured means no deliberate-use event exists for that agent; it does not mean zero use. The Marketplace event is a profile view, not a completed transaction.</p>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-sky-700">Acquisition · One web</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-950">Discovery from Google Search</h2>
              <div className="mt-4 flex flex-wrap items-end gap-7">
                <div><p className="text-xs text-slate-500">Clicks</p><p className="text-3xl font-semibold text-slate-950">{number(brief.search.clicks.current)}</p></div>
                <div><p className="text-xs text-slate-500">Impressions</p><p className="text-3xl font-semibold text-slate-950">{number(brief.search.impressions.current)}</p></div>
                <ChangeBadge measure={brief.search.clicks} />
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-600">Google Search Console counts search-result clicks and appearances for One’s production website. Clicks are neither unique visitors nor app users.</p>
              {!brief.search.available && <p className="mt-2 text-xs font-medium text-amber-800">The selected Search Console export is incomplete; no value is guessed.</p>}
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 sm:p-6">
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-amber-800"><ShieldAlert className="h-4 w-4" /> Measurement confidence</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-950">What we can—and cannot—claim</h2>
              <ul className="mt-4 space-y-2 text-sm leading-6 text-slate-700">
                {lowCoverage && <li>Only {Math.round((brief.one.accountCoverage ?? 0) * 100)}% of tracked app/browser identifiers are linked to an account. Unlinked people cannot be uniquely counted.</li>}
                {brief.one.available && !brief.one.comparisonReady && <li>Account tagging began within the earlier period. Account-growth percentages are withheld until both periods are fully comparable.</li>}
                {brief.one.available && !brief.one.interactionComparisonReady && <li>The earlier agent-interaction period predates reliable event history. Its comparisons are withheld, not treated as zero.</li>}
                {brief.one.hasNativeEnvironmentConflict && <li>Some public iOS events still carry a test-environment label. They are not described as production-backend customers.</li>}
                {!brief.one.available && <li>The One GA4 source could not be verified for this selection.</li>}
                {!lowCoverage && brief.one.comparisonReady && !brief.one.hasNativeEnvironmentConflict && brief.one.available && <li>Account-linked coverage and comparison history meet this briefing’s checks. Anonymous activity remains outside person counts.</li>}
              </ul>
              <p className="mt-3 flex items-start gap-1.5 text-xs leading-5 text-amber-900"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Android testing traffic is not included in the public iOS/web founder audience.</p>
            </div>
          </section>
        </> : null}
  </main>;
}
