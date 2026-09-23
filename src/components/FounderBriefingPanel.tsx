import { ArrowDownRight, ArrowRight, ArrowUpRight, CheckCircle2, Clock3, RefreshCw, ShieldAlert, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { FounderBriefingData, FounderMeasure } from '../lib/founder-briefing';
import { founderChangeLabel, founderTrend } from '../lib/founder-briefing';

function number(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('en-US');
}

function date(dateString: string): string {
  return new Date(`${dateString}T00:00:00Z`).toLocaleDateString('en-US', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

function Change({ measure }: { measure: FounderMeasure }) {
  const { trend } = founderTrend(measure);
  const color = trend === 'up' || trend === 'new'
    ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
    : trend === 'down'
      ? 'bg-rose-50 text-rose-800 ring-rose-200'
      : 'bg-slate-100 text-slate-600 ring-slate-200';
  const Icon = trend === 'up' ? ArrowUpRight : trend === 'down' ? ArrowDownRight : Clock3;
  return (
    <span className={`inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${color}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {founderChangeLabel(measure)}
    </span>
  );
}

function MeasureCard({ eyebrow, label, measure, explanation, prominent = false }: {
  eyebrow: string;
  label: string;
  measure: FounderMeasure;
  explanation: string;
  prominent?: boolean;
}) {
  return (
    <article className={`rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_12px_36px_rgba(15,23,42,0.05)] ${prominent ? 'sm:p-6' : ''}`}>
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">{eyebrow}</p>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{label}</h3>
          <p className="mt-1 text-4xl font-semibold tracking-tight text-slate-950">{number(measure.current)}</p>
        </div>
        <Change measure={measure} />
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-600">{explanation}</p>
    </article>
  );
}

function SourceUnavailable({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950" role="status">
      {label} is not complete enough for a trustworthy comparison. No estimate is shown.
    </div>
  );
}

export function FounderBriefingPanel({ refreshKey, onExploreOne }: {
  refreshKey: number;
  onExploreOne: () => void;
}) {
  const [brief, setBrief] = useState<FounderBriefingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    fetch('/api/analytics/founder', {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Briefing source unavailable');
        return response.json() as Promise<FounderBriefingData>;
      })
      .then((result) => {
        if (!result?.period || !result.one || !result.hushhTech || !result.hushhAi) {
          throw new Error('Briefing response incomplete');
        }
        setBrief(result);
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refreshKey]);

  const signals = useMemo(() => {
    if (!brief) return [];
    return [
      { label: 'One signed-in activity', measure: brief.one.activeAccounts, available: brief.one.available },
      { label: 'First-time One activity', measure: brief.one.firstObservedAccounts, available: brief.one.available },
      { label: 'HushhTech new accounts', measure: brief.hushhTech.newAccounts, available: brief.hushhTech.available },
      { label: 'Hushh AI search clicks', measure: brief.hushhAi.organicClicks, available: brief.hushhAi.available },
    ].filter((signal) => signal.available);
  }, [brief]);
  const improving = signals.filter((signal) => ['up', 'new'].includes(founderTrend(signal.measure).trend));
  const declining = signals.filter((signal) => founderTrend(signal.measure).trend === 'down');
  const lowCoverage = brief?.one.accountCoverage !== null && brief?.one.accountCoverage !== undefined
    && brief.one.accountCoverage < 0.8;

  return (
    <main className="space-y-6 pb-10">
      <section className="relative overflow-hidden rounded-[28px] bg-[#112034] px-6 py-8 text-white shadow-[0_24px_70px_rgba(17,32,52,0.18)] sm:px-9 sm:py-10">
        <div className="pointer-events-none absolute -right-10 -top-20 h-72 w-72 rounded-full bg-sky-400/15 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 right-32 h-40 w-40 rounded-full bg-emerald-300/10 blur-3xl" />
        <div className="relative">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.17em] text-sky-100">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Founder briefing · production
          </p>
          <h1 className="mt-5 max-w-3xl text-3xl font-semibold tracking-tight sm:text-5xl">The business, at a glance.</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200 sm:text-base">
            Customer activity, new accounts and market discovery—compared with the previous equal period.
            Only production-connected sources are used. Data-confidence gaps are called out below.
          </p>
          {brief && (
            <div className="mt-6 flex flex-wrap gap-2 text-xs font-medium text-slate-200">
              <span className="rounded-full bg-white/10 px-3 py-1.5">{date(brief.period.startDate)} – {date(brief.period.endDate)}</span>
              <span className="rounded-full bg-white/10 px-3 py-1.5">30 complete days vs previous 30</span>
              <span className="rounded-full bg-white/10 px-3 py-1.5">Updated {new Date(brief.generatedAt).toLocaleString('en-US')}</span>
            </div>
          )}
        </div>
      </section>

      {loading && !brief ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600" role="status">
          <RefreshCw className="mx-auto mb-3 h-5 w-5 animate-spin text-sky-600" />
          Preparing the production briefing…
        </div>
      ) : error && !brief ? (
        <SourceUnavailable label="The production briefing" />
      ) : brief ? (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <MeasureCard eyebrow="One · customers" label="Signed-in accounts active" measure={brief.one.activeAccounts}
              explanation="Each identifiable One account is counted once in this period, even if it returned many times." prominent />
            <MeasureCard eyebrow="HushhTech · customers" label="New registered accounts" measure={brief.hushhTech.newAccounts}
              explanation="Accounts created in the production HushhTech customer database." prominent />
            <MeasureCard eyebrow="Hushh AI · market discovery" label="Google Search clicks" measure={brief.hushhAi.organicClicks}
              explanation="Clicks from Google results to our site. Repeat clicks count again; this is not a customer count." prominent />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.45fr_1fr]">
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_12px_36px_rgba(15,23,42,0.05)]">
              <div className="flex items-center gap-2 text-emerald-700">
                <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
                <h2 className="text-lg font-semibold text-slate-900">What moved</h2>
              </div>
              {improving.length === 0 && declining.length === 0 ? (
                <p className="mt-4 text-sm leading-6 text-slate-600">No trustworthy up-or-down movement is available yet. We will not turn missing data into a green or red signal.</p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {[...improving, ...declining].map((signal) => (
                    <li key={signal.label} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                      <span className="text-sm font-medium text-slate-800">{signal.label}</span>
                      <Change measure={signal.measure} />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_12px_36px_rgba(15,23,42,0.05)]">
              <div className="flex items-center gap-2 text-amber-700">
                <ShieldAlert className="h-5 w-5" aria-hidden="true" />
                <h2 className="text-lg font-semibold text-slate-900">What needs attention</h2>
              </div>
              <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
                {lowCoverage && <li>Only {Math.round((brief.one.accountCoverage ?? 0) * 100)}% of One activity is linked to an account. Unique customers outside that known slice cannot be verified yet.</li>}
                {brief.one.available && !brief.one.comparisonReady && <li>One account tagging has not covered both full periods yet. Current account counts are shown, but a growth percentage would be misleading.</li>}
                {brief.one.hasNativeEnvironmentConflict && <li>Some public One app activity still carries a test-environment label. Treat One trends as directional until this labeling is corrected.</li>}
                {declining.slice(0, 2).map((signal) => <li key={signal.label}>{signal.label} declined from the previous period; review the detailed journey before drawing a cause-and-effect conclusion.</li>)}
                {!brief.one.available && <li>One customer activity could not be verified from the production source.</li>}
                {!brief.hushhTech.available && <li>HushhTech account data is currently unavailable.</li>}
                {!brief.hushhAi.available && <li>Search reporting is incomplete or delayed, so no market-reach change is claimed.</li>}
                {!lowCoverage && brief.one.comparisonReady && !brief.one.hasNativeEnvironmentConflict && declining.length === 0 && brief.one.available && brief.hushhTech.available && brief.hushhAi.available
                  && <li>No measured decline or coverage warning in this reporting period. Continue watching first-time customers and repeat engagement.</li>}
              </ul>
            </section>
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_12px_36px_rgba(15,23,42,0.05)]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-sky-700">One · deeper customer signal</p>
                <h2 className="mt-1 text-xl font-semibold text-slate-950">Are people reaching value?</h2>
              </div>
              <button type="button" onClick={onExploreOne} className="inline-flex items-center gap-1 text-sm font-semibold text-sky-700 hover:text-sky-900">
                Explore One details <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <MeasureCard eyebrow="Acquisition" label="Accounts seen for the first time" measure={brief.one.firstObservedAccounts}
                explanation="First observed activity, not a new registration. The same account is counted only once." />
              <MeasureCard eyebrow="First value" label="Accounts completing location activation" measure={brief.one.activatedAccounts}
                explanation="Signed-in accounts that completed the measured activation action. Other unlinked activity is not guessed." />
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-6 text-sm leading-6 text-slate-600">
            <h2 className="text-base font-semibold text-slate-900">How to read this briefing</h2>
            <p className="mt-2">Green and red compare the same measure across two equal 30-day periods; when the earlier value was zero, no misleading percentage is calculated. One is a partial, account-linked view of public app activity—not every customer. HushhTech accounts come from its production customer database. Search clicks show interest in our own site, not our share of the wider market.</p>
            <p className="mt-2">The periods end a few days before today so delayed reports can settle. Missing or incomplete sources show as unavailable, never as a fake zero.</p>
            {brief.hushhTech.totalAccounts !== null && <p className="mt-2">HushhTech has {number(brief.hushhTech.totalAccounts)} registered accounts through {date(brief.period.endDate)}.</p>}
          </section>
        </>
      ) : null}
      {error && brief && <p role="status" className="text-sm text-amber-800">The latest refresh did not complete; the previous briefing remains visible.</p>}
      {loading && brief && <p role="status" className="text-xs text-slate-500">Refreshing the production briefing…</p>}
    </main>
  );
}
