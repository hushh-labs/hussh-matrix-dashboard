import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { PlgAudienceFilters, PlgAudiencePage, PlgState } from '../lib/plg';
import { dashboardCard } from '../lib/theme';
import { cn } from '../lib/utils';

const control = 'w-full rounded-xl border border-stroke bg-surface px-3 py-2.5 text-sm text-ink';
const button = 'rounded-xl border border-stroke bg-surface px-4 py-2.5 text-sm font-semibold text-ink disabled:opacity-50';
const defaults: PlgAudienceFilters = { agentId: 'agent_one', segment: 'all', query: '', graceMinutes: 60 };
const time = (value: string | null) => value ? new Date(value).toLocaleString() : 'Not observed';
const coverage = {
  observed: 'Collection available', not_started: 'No collection baseline', unavailable: 'Activity collection off',
  limited: 'Collection limit reached', reset_during_traversal: 'Account reset during browsing',
};

export function PlgAudiencePanel({ state, load, openContact }: {
  state: PlgState;
  load: (filters: PlgAudienceFilters, signal: AbortSignal) => Promise<PlgAudiencePage>;
  openContact: (contactId: string) => void;
}) {
  const [filters, setFilters] = useState<PlgAudienceFilters>(defaults);
  const [data, setData] = useState<PlgAudiencePage | null>(null);
  const [sourceCatalog, setSourceCatalog] = useState<PlgAudiencePage['catalog'] | null>(null);
  const [history, setHistory] = useState<(string | null)[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sequence = useRef(0), controller = useRef<AbortController | null>(null);
  async function read(next: string | null, direction: 'reset' | 'next' | 'previous' = 'reset') {
    const request = ++sequence.current;
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    setBusy(true); setError(''); setData(null);
    try {
      const result = await load({ ...filters, cursor: next }, active.signal);
      if (request !== sequence.current) return;
      setData(result); setSourceCatalog(result.catalog); setCursor(next);
      setHistory((before) => direction === 'next' ? [...before, cursor] : direction === 'previous' ? before.slice(0, -1) : []);
    } catch (e) {
      if (request === sequence.current && !active.signal.aborted) setError((e as Error).message);
    } finally { if (request === sequence.current) setBusy(false); }
  }
  useEffect(() => {
    void read(null);
    return () => { sequence.current++; controller.current?.abort(); };
  }, [load]);
  function change(patch: Partial<PlgAudienceFilters>) {
    sequence.current++; controller.current?.abort(); setBusy(false); setData(null); setError('');
    setHistory([]); setCursor(null); setFilters((before) => ({ ...before, ...patch }));
  }
  function submit(event: FormEvent) { event.preventDefault(); void read(null); }
  const catalog = sourceCatalog ?? state.catalog;
  return <section className="min-w-0 space-y-5" aria-label="Agent people">
    <div className={cn(dashboardCard, 'p-5 sm:p-6')}>
      <h3 className="text-lg font-semibold text-ink">People by agent and attempt</h3>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">Read current One contact details and retained activity from the last seven days. Missing contact fields stay visible. Viewing a person does not enroll them or record messaging permission.</p>
      <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="grid gap-1.5 text-xs font-semibold text-muted">People agent<select className={control} value={filters.agentId} onChange={(e) => change({ agentId: e.target.value as PlgAudienceFilters['agentId'] })}>
          {!catalog?.agents.some((a) => a.id === 'agent_one') && <option value="agent_one">One</option>}
          {catalog?.agents.map((a) => <option key={a.id} value={a.id}>{a.label}{a.public ? a.available ? '' : ' (unavailable)' : ' (internal)'}</option>)}
        </select></label>
        <label className="grid gap-1.5 text-xs font-semibold text-muted">Attempt evidence<select className={control} value={filters.segment} onChange={(e) => change({ segment: e.target.value as PlgAudienceFilters['segment'] })}>
          <option value="all">All registered accounts</option><option value="possible_incomplete">Possible incomplete attempts</option>
          <option value="failed">Observed failures</option><option value="blocked">Blocked attempts</option><option value="cancelled">Cancelled attempts</option>
          <option value="returned">Return observations</option><option value="verified">Verified value observed</option>
          <option value="unknown">Unknown or partial evidence</option><option value="in_progress">Recent starts</option>
        </select></label>
        <label className="grid gap-1.5 text-xs font-semibold text-muted">Search name, email or phone<input className={control} value={filters.query} maxLength={100} onChange={(e) => change({ query: e.target.value })} placeholder="Name, email or +country code" /></label>
        <label className="grid gap-1.5 text-xs font-semibold text-muted">No terminal observation after<select className={control} value={filters.graceMinutes} onChange={(e) => change({ graceMinutes: Number(e.target.value) })}>
          <option value={15}>15 minutes</option><option value={60}>1 hour</option><option value={240}>4 hours</option><option value={1440}>24 hours</option>
        </select></label>
        <button className={cn(button, 'sm:col-span-2 lg:col-span-1')} disabled={busy} type="submit">{busy ? 'Loading people…' : 'Apply filters'}</button>
      </form>
      <p className="mt-4 text-xs leading-5 text-muted">Possible incomplete means a start has no matching terminal observation after the selected interval. A call may still be running or telemetry may be missing. Counts include browser reports and server SDK observations; one user action can produce both. They are not unique user attempts or proof of a completed business task.</p>
      {error && <p role="alert" className="mt-4 rounded-xl bg-canvas p-4 text-sm text-ink">{error}</p>}
      {busy && <p role="status" className="mt-4 text-sm text-muted">Loading the current source page…</p>}
    </div>
    {data && <div className={cn(dashboardCard, 'min-w-0 p-5 sm:p-6')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h4 className="font-semibold text-ink">{data.rows.length} matches on source page {history.length + 1}</h4>
          <p className="mt-1 text-xs leading-5 text-muted">Checked {data.scanned} source accounts. Filters apply as the live directory is traversed; later pages may contain more matches. No global total is inferred.</p>
          <p className="mt-1 text-xs text-muted">Activity as of {time(data.asOf)} · possible incomplete after {data.graceMinutes} minutes</p></div>
        <button className={button} disabled={busy} onClick={() => void read(null)}>Refresh from first page</button>
      </div>
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[1040px] text-left text-sm"><thead className="border-b border-stroke text-xs text-muted"><tr>
          <th className="p-3">Name</th><th className="p-3">Email</th><th className="p-3">Verified international phone</th><th className="p-3">Agent and evidence</th><th className="p-3">Last observation</th><th className="p-3">Follow-up</th>
        </tr></thead><tbody>{data.rows.map((person) => {
          const activity = person.activity, counts = activity.counts;
          const agent = data.catalog.agents.find((a) => a.id === person.agentId);
          const action = data.catalog.actions.find((a) => a.id === activity.lastActionId);
          const enrolled = state.contacts.find((c) => c.accountId === person.accountId);
          return <tr key={person.accountId} className="border-b border-stroke align-top last:border-0">
            <td className="max-w-[180px] break-words p-3"><p className="font-semibold text-ink">{person.identity.name || 'Name not provided'}</p><p className="mt-1 text-xs text-muted">{person.identity.source === 'canonical' ? 'Saved One identity' : 'Current sign-in identity'}</p></td>
            <td className="min-w-[180px] max-w-[220px] break-all p-3">{person.identity.email || <span className="whitespace-nowrap">Not provided</span>}{person.identity.email && <p className="mt-1 text-xs text-muted">{person.identity.emailVerified ? 'Verified email' : 'Verification not confirmed'}</p>}</td>
            <td className="whitespace-nowrap p-3 font-mono text-xs">{person.identity.phoneNumber || 'Not provided'}</td>
            <td className="min-w-[280px] p-3"><p className="font-semibold text-ink">{agent?.label || person.agentId}</p>
              <p className="mt-1 text-xs text-muted">{coverage[activity.coverage]}</p>
              {['observed', 'limited'].includes(activity.coverage) ? <><p className="mt-2 text-xs">Start observations {counts.started} · Returns {counts.returned} · Failures {counts.failed}</p>
              <p className="mt-1 text-xs">Possible incomplete {counts.possibleIncomplete} · Recent starts {counts.inProgress}</p></> : <p className="mt-2 text-xs">No execution evidence for this collection window</p>}
              {(counts.blocked > 0 || counts.cancelled > 0) && <p className="mt-1 text-xs">Blocked {counts.blocked} · Cancelled {counts.cancelled}</p>}
              {counts.uncorrelated > 0 && <p className="mt-1 text-xs text-muted">{counts.uncorrelated} observations cannot be paired with an attempt.</p>}
              {counts.otherObservations > 0 && <p className="mt-1 text-xs text-muted">{counts.otherObservations} tool observations; these do not establish completed attempts.</p>}
              <p className="mt-2 text-xs text-muted">{person.verified.supported ? person.verified.count ? `${person.verified.count}${person.verified.limited ? '+' : ''} verified outcomes observed` : 'No verified value observed' : 'Business completion is not measured for this agent'}</p>
            </td>
            <td className="max-w-[220px] p-3 text-xs"><p>{time(activity.lastObservedAt)}</p>{action && <p className="mt-1 text-muted">{action.label}</p>}<p className="mt-2 text-muted">First start: {time(activity.firstAttemptAt)}</p></td>
            <td className="p-3">{enrolled ? <button className={button} onClick={() => openContact(enrolled.id)}>Open follow-up</button> : <span className="text-xs text-muted">Not enrolled in campaigns</span>}</td>
          </tr>;
        })}</tbody></table>
      </div>
      {!data.rows.length && <p role="status" className="mt-5 rounded-xl bg-canvas p-4 text-sm text-muted">No matches on this source page.{data.nextCursor ? ' Continue to check later pages.' : ' This is the final page of this traversal.'}</p>}
      <div className="mt-5 flex flex-wrap gap-3"><button className={button} disabled={busy || !history.length} onClick={() => void read(history.at(-1) ?? null, 'previous')}>Previous source page</button>
        <button className={button} disabled={busy || !data.nextCursor} onClick={() => void read(data.nextCursor, 'next')}>Next source page</button></div>
    </div>}
  </section>;
}
