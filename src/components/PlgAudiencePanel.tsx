import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { PlgAudienceFilters, PlgAudiencePage, PlgState } from '../lib/plg';
import { dashboardCard } from '../lib/theme';
import { cn } from '../lib/utils';
import { audienceFilterScan, audiencePageCursors, findAudiencePage, outcomeCoverage } from '../lib/plg-audience';
import { PlgPagination } from './PlgPagination';

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
  const [pages, setPages] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [scanned, setScanned] = useState(0);
  const [paused, setPaused] = useState(false);
  const [includeTechnicalAgents, setIncludeTechnicalAgents] = useState(false);
  const sequence = useRef(0), controller = useRef<AbortController | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmed = useRef<{ request: number; page: PlgAudiencePage; scanned: number; start: string | null;
    index: number; reset: boolean } | null>(null);
  function display(record: NonNullable<typeof confirmed.current>) {
    setData(record.page); setSourceCatalog(record.page.catalog); setPageIndex(record.index); setScanned(record.scanned); setDirty(false);
    setPages(before => audiencePageCursors(record.reset ? [null] : before, record.index, record.page.nextCursor));
  }
  function pause() {
    const request = sequence.current++;
    controller.current?.abort(); setBusy(false); setPaused(true);
    if (confirmed.current?.request === request) display(confirmed.current);
  }
  async function read(next: string | null, index = 0, reset = true) {
    const request = ++sequence.current;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    confirmed.current = null;
    setBusy(true); setDirty(false); setError(''); setData(null); setScanned(0); setPaused(false);
    try {
      const { page: result, scanned: checked } = await findAudiencePage(load, { ...filters, cursor: next }, active.signal,
        (count, page) => { if (request === sequence.current) {
          setScanned(count); confirmed.current = { request, page, scanned: count, start: next, index, reset };
        } }, Date.now, audienceFilterScan);
      if (request !== sequence.current) return;
      display({ request, page: result, scanned: checked, start: next, index, reset });
    } catch (e) {
      if (request === sequence.current && !active.signal.aborted) setError((e as Error).message);
    } finally { if (request === sequence.current) setBusy(false); }
  }
  useEffect(() => {
    void read(null);
    return () => { sequence.current++; controller.current?.abort(); };
  }, [load]);
  useEffect(() => {
    if (!dirty) return;
    searchTimer.current = setTimeout(() => void read(null), 350);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [filters, dirty]);
  function change(patch: Partial<PlgAudienceFilters>) {
    sequence.current++; controller.current?.abort(); confirmed.current = null; setBusy(false); setDirty(true); setError(''); setPaused(false);
    setPages([null]); setPageIndex(0); setData(null); setFilters((before) => ({ ...before, ...patch }));
  }
  function submit(event: FormEvent) { event.preventDefault(); void read(null); }
  const catalog = sourceCatalog ?? state.catalog;
  const selectedAgent = catalog?.agents.find((agent) => agent.id === filters.agentId);
  const resultCoverage = data ? outcomeCoverage(data) : null;
  const selectableAgents = catalog?.agents.filter((agent) =>
    includeTechnicalAgents || (agent.public && agent.available) || agent.id === filters.agentId);
  return <section className="min-w-0 space-y-5" aria-label="Agent people">
    <div className={cn(dashboardCard, 'p-5 sm:p-6')}>
      <h3 className="text-lg font-semibold text-ink">Users and agent drop-offs</h3>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">Find registered accounts and their recorded activity in the last seven days. Results update as you change your filters. Campaign enrollment is separate.</p>
      <p className="mt-2 text-xs leading-5 text-muted">{data?.environment === 'uat'
        ? 'UAT registered accounts include team and test accounts. These records are separate from Production.'
        : data?.environment === 'production' ? 'Production account counts exclude confirmed staff, test and reviewer accounts.' : 'The connected environment is shown when the directory loads.'} Accounts are distinct; they are not proven unique people.</p>
      <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="grid gap-1.5 text-xs font-semibold text-muted">Agent<select className={control} value={filters.agentId} onChange={(e) => change({ agentId: e.target.value as PlgAudienceFilters['agentId'] })}>
          {!catalog?.agents.some((a) => a.id === 'agent_one') && <option value="agent_one">One</option>}
          {selectableAgents?.map((a) => <option key={a.id} value={a.id}>{a.label}{a.public ? a.available ? '' : ' (unavailable)' : ' (internal)'}</option>)}
        </select></label>
        <label className="grid gap-1.5 text-xs font-semibold text-muted">Task status<select className={control} value={filters.segment} onChange={(e) => change({ segment: e.target.value as PlgAudienceFilters['segment'] })}>
          <option value="all">All registered contacts</option><option value="possible_incomplete">Possible incomplete attempts</option>
          <option value="failed">Observed failures</option><option value="blocked">Blocked attempts</option><option value="cancelled">Cancelled attempts</option>
          <option value="returned">Return observations</option><option value="verified">Verified value observed</option>
          <option value="unknown">Unknown or partial evidence</option><option value="in_progress">Recent starts</option>
        </select></label>
        <label className="grid gap-1.5 text-xs font-semibold text-muted">Search name, email or phone<input className={control} value={filters.query} maxLength={100} onChange={(e) => change({ query: e.target.value })} placeholder="Name, email or +country code" /></label>
        {filters.segment === 'possible_incomplete' && <label className="grid gap-1.5 text-xs font-semibold text-muted">Time since start<select className={control} value={filters.graceMinutes} onChange={(e) => change({ graceMinutes: Number(e.target.value) })}>
          <option value={15}>15 minutes</option><option value={60}>1 hour</option><option value={240}>4 hours</option><option value={1440}>24 hours</option>
        </select></label>}
        <button className={cn(button, 'sm:col-span-2 lg:col-span-1')} disabled={busy} type="submit">{busy ? 'Loading people…' : 'Apply filters'}</button>
        {busy && <button className={button} type="button" onClick={pause}>Pause search</button>}
        <button className={button} type="button" disabled={busy} onClick={() => change(defaults)}>Reset filters</button>
      </form>
      <label className="mt-4 flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={includeTechnicalAgents} onChange={(e) => setIncludeTechnicalAgents(e.target.checked)} />Include internal and unavailable agents</label>
      {dirty && <p role="status" className="mt-4 text-sm font-medium text-ink">Updating results…</p>}
      {selectedAgent && (selectedAgent.outcome ? selectedAgent.outcome.status !== 'supported' :
        !['agent_personal_information', 'agent_email'].includes(selectedAgent.id)) && <div role="status" className="mt-4 rounded-xl border border-stroke bg-canvas p-4 text-sm text-ink">
          This connection does not provide verified completion tracking for {selectedAgent.label}. Recorded usage remains visible below. This does not mean nobody used the agent.
        </div>}
      <details className="mt-4 text-xs leading-5 text-muted"><summary className="cursor-pointer font-medium text-ink">How to read activity and completions</summary><p className="mt-2">A return means an execution was observed. A verified completion requires the agent's specific saved or provider-confirmed result. Possible incomplete means a start has no matching finish after the selected interval; it may still be running or missing telemetry. App and server observations can overlap, so their counts are not unique attempts. One's execution counts cover One itself, while its supported completion count combines distinct domain outcomes.</p>
        {selectedAgent?.outcome && <p className="mt-2"><strong>Completion definition for {selectedAgent.label}:</strong> {selectedAgent.outcome.label}. {selectedAgent.outcome.reason}</p>}
      </details>
      {error && <p role="alert" className="mt-4 rounded-xl bg-canvas p-4 text-sm text-ink">{error}</p>}
      {busy && <p role="status" className="mt-4 text-sm text-muted">{scanned ? `Searching more accounts… ${scanned} checked so far.` : 'Loading registered accounts…'}</p>}
      {paused && <p role="status" className="mt-4 text-sm text-muted">Search paused. {data?.nextCursor ? 'Continue with the next source page below.' : 'Apply filters to start again.'}</p>}
    </div>
    {data && !dirty && <div className={cn(dashboardCard, 'min-w-0 p-5 sm:p-6')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h4 className="font-semibold text-ink">{data.rows.length} {data.rows.length === 1 ? 'account' : 'accounts'} in this result</h4>
          <p className="mt-1 text-xs leading-5 text-muted">Checked {scanned} source accounts for this result. {data.nextCursor ? 'More accounts remain; continue searching below.' : 'Reached the end of this directory traversal.'} This is not a global audience total.</p>
          <p className="mt-1 text-xs text-muted">Activity as of {time(data.asOf)} · possible incomplete after {data.graceMinutes} minutes</p></div>
        <button className={button} disabled={busy} onClick={() => void read(null)}>Refresh from first page</button>
      </div>
      {resultCoverage?.legacy && <p className="mt-4 rounded-xl bg-canvas p-3 text-sm text-muted">Connected tracking: verified completions supported for {resultCoverage.measured} of {resultCoverage.agents} available public agents. Usage collection and completion tracking are separate.</p>}
      {data.rows.length > 0 && data.rows.every((person) => ['not_started', 'unavailable'].includes(person.activity.coverage)) &&
        <p role="status" className="mt-4 rounded-xl border border-stroke p-4 text-sm text-ink">These accounts are registered, but activity collection has not started or is disabled for them. This result cannot establish zero usage. Historical actions before collection started cannot be reconstructed here.</p>}
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm"><thead className="border-b border-stroke text-xs text-muted"><tr>
          <th className="p-3">Account</th><th className="p-3">Agent usage</th><th className="p-3">Last activity</th><th className="p-3">Follow-up</th>
        </tr></thead><tbody>{data.rows.map((person) => {
          const activity = person.activity, counts = activity.counts;
          const agent = data.catalog.agents.find((a) => a.id === person.agentId);
          const action = data.catalog.actions.find((a) => a.id === activity.lastActionId);
          const enrolledId = Object.hasOwn(person, 'campaignContactId') ? person.campaignContactId :
            state.contacts.find((c) => c.accountId === person.accountId)?.id;
          return <tr key={person.accountId} className="border-b border-stroke align-top last:border-0">
            <td className="min-w-[180px] max-w-[240px] break-words p-3"><p className="font-semibold text-ink">{person.identity.name || 'Name not provided'}</p>
              <p className="mt-1 break-all text-xs text-muted">{person.identity.email || 'Email not provided'}</p>
              {person.identity.phoneNumber && <p className="mt-1 font-mono text-xs">{person.identity.phoneNumber}</p>}
              <details className="mt-2 text-xs text-muted"><summary className="cursor-pointer">Contact details</summary><p>{person.identity.source === 'canonical' ? 'Saved One identity' : 'Current sign-in identity'}</p>{person.identity.email && <p>{person.identity.emailVerified ? 'Verified email' : 'Email verification not confirmed'}</p>}{!person.identity.phoneNumber && <p>Verified phone not provided</p>}</details>
            </td>
            <td className="min-w-[280px] p-3"><p className="font-semibold text-ink">{agent?.label || person.agentId}</p>
              {['observed', 'limited'].includes(activity.coverage) ? <><p className="mt-2 text-xs">Starts {counts.started} · Returns {counts.returned} · Failures {counts.failed}</p>
              <p className="mt-1 text-xs">Possible incomplete {counts.possibleIncomplete} · Recent starts {counts.inProgress}</p></> : <p className="mt-2 text-xs text-muted">{coverage[activity.coverage]}</p>}
              {activity.coverage === 'limited' && <p className="mt-2 text-xs text-muted">Activity collection limit reached; these counts are partial.</p>}
              {(counts.blocked > 0 || counts.cancelled > 0) && <p className="mt-1 text-xs">Blocked {counts.blocked} · Cancelled {counts.cancelled}</p>}
              {counts.uncorrelated > 0 && <p className="mt-1 text-xs text-muted">{counts.uncorrelated} observations cannot be paired with an attempt.</p>}
              {counts.otherObservations > 0 && <p className="mt-1 text-xs text-muted">{counts.otherObservations} tool observations; these do not establish completed attempts.</p>}
              {person.verified.supported && <p className="mt-2 text-xs text-muted">{person.verified.count ? `${person.verified.count}${person.verified.limited ? '+' : ''} verified outcomes observed` : 'No verified value observed'}</p>}
              {person.verified.limited && <p className="mt-1 text-xs text-muted">Outcome evidence is partial; additional results may be outside retained bounds.</p>}
            </td>
            <td className="max-w-[200px] p-3 text-xs"><p>{activity.lastObservedAt ? time(activity.lastObservedAt) : '—'}</p>{action && <p className="mt-1 text-muted">{action.label}</p>}{activity.firstAttemptAt && <p className="mt-2 text-muted">First start: {time(activity.firstAttemptAt)}</p>}</td>
            <td className="p-3">{data.environment === 'uat' ? <span className="text-xs text-muted">Activity emails use each owner's separate preference in One UAT.</span> : enrolledId ? <button className={button} onClick={() => openContact(enrolledId)}>Open follow-up</button> : <span className="text-xs text-muted">Not enrolled in campaigns</span>}</td>
          </tr>;
        })}</tbody></table>
      </div>
      {!data.rows.length && <p role="status" className="mt-5 rounded-xl bg-canvas p-4 text-sm text-muted">{data.nextCursor ? 'No matches in the accounts checked so far. More accounts remain to search.' : 'No matching accounts were found in this directory traversal.'} Missing activity is not proof of inactivity.</p>}
      <div className="mt-5 space-y-2">
        <PlgPagination label="User result pages" page={pageIndex} count={pages.length} busy={busy}
          select={index => void read(pages[index], index, false)} />
        <p className="text-xs text-muted">Page {pageIndex + 1}. {data.nextCursor ? 'More page numbers appear as you browse.' : 'End of results.'} Page sizes vary with the matching accounts.</p>
      </div>
    </div>}
  </section>;
}
