import { useEffect, useRef, useState } from 'react';
import type { PlgActivity, PlgCatalog, PlgState } from '../lib/plg';
import { dashboardCard } from '../lib/theme';
import { cn } from '../lib/utils';

export interface PlgActivityInspection { catalog: PlgCatalog; activity: PlgActivity | null; deleted: boolean }
const control = 'rounded-xl border border-stroke bg-surface px-3 py-2.5 text-sm text-ink';

export function PlgAgentActivityPanel({ state, busy, refresh, inspect }: {
  state: PlgState; busy: boolean; refresh: () => void;
  inspect: (contactId: string) => Promise<PlgActivityInspection>;
}) {
  const [agent, setAgent] = useState('all');
  const [account, setAccount] = useState('');
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);
  const [includeInternal, setIncludeInternal] = useState(false);
  const [detail, setDetail] = useState<PlgActivityInspection | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const request = useRef(0);
  useEffect(() => () => { request.current++; }, []);
  const catalog = state.catalog;
  const actions = catalog?.actions.filter((a) => (agent === 'all' || a.agentId === agent) &&
    `${a.id} ${a.label}`.toLowerCase().includes(query.toLowerCase())) ?? [];
  async function load() {
    const current = ++request.current;
    setLoading(true); setError(''); setDetail(null);
    try {
      const value = await inspect(account);
      if (request.current === current) setDetail(value);
    } catch (e) { if (request.current === current) setError((e as Error).message); }
    finally { if (request.current === current) setLoading(false); }
  }
  return <section className="min-w-0 space-y-5" aria-label="All agent activity">
    <div className={cn(dashboardCard, 'p-5 sm:p-6')}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h3 className="text-lg font-semibold text-ink">Tracking details</h3>
          <p className="mt-2 text-sm leading-6 text-muted">Review activity across enrolled accounts. App reports and agent/tool returns show observed usage; they do not establish a successful business outcome or app-wide DAU.</p>
        </div>
        <button className={control} disabled={busy} onClick={refresh}>Refresh agent activity</button>
      </div>
      {!state.contacts.length && <p role="status" className="mt-4 rounded-xl bg-canvas p-4 text-sm text-ink">No accounts are enrolled in campaign tracking. The table describes tracking coverage; its empty counts are not app-wide usage. Use People and usage to browse registered accounts.</p>}
      {!catalog ? <p role="status" className="mt-5 rounded-xl bg-canvas p-4 text-sm text-muted">Connect the One backend and refresh activity to load the registered agents and actions. Collection remains unknown until connected.</p> : <>
        <p className="mt-5 text-sm font-semibold text-ink">{catalog.agents.length} authored agents · {catalog.actions.length} action and execution identifiers</p>
        <label className="mt-3 flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={includeInternal} onChange={(e) => setIncludeInternal(e.target.checked)} />Show internal and unavailable agents</label>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-stroke text-xs text-muted"><tr><th className="p-3">Agent</th><th className="p-3">Availability</th><th className="p-3">Verified value definition</th><th className="p-3">Observed accounts</th><th className="p-3">Execution returns</th><th className="p-3">App reports</th><th className="p-3">Errors</th></tr></thead>
            <tbody>{catalog.agents.filter((a) => includeInternal || (a.public && a.available)).map((a) => {
              const reports = state.contacts.flatMap((c) => c.activity?.agents.filter((row) => row.agentId === a.id) ?? []);
              const connected = state.contacts.some((c) => c.activity?.enabled && c.activity.epoch);
              return <tr key={a.id} className="border-b border-stroke last:border-0">
                <td className="p-3"><button className="font-semibold text-ink underline-offset-4 hover:underline" onClick={() => setAgent(a.id)}>{a.label}</button></td>
                <td className="p-3 text-muted">{!a.public ? 'Internal' : a.available ? 'Available' : 'Unavailable'}</td>
                <td className="min-w-[240px] max-w-sm p-3 text-xs text-muted"><p className="font-medium text-ink">{a.outcome?.label ?? (['agent_personal_information', 'agent_email'].includes(a.id) ? 'Verified task completion' : !a.public ? 'Internal stage' : 'Verified completion tracking not provided by this connection')}</p>{a.outcome && <details className="mt-1 leading-5"><summary className="cursor-pointer">Completion definition</summary>{a.outcome.reason}</details>}</td>
                <td className="p-3">{connected ? reports.length : 'Not collected'}</td>
                <td className="p-3">{connected ? reports.reduce((n, row) => n + row.executed, 0) : '—'}</td>
                <td className="p-3">{connected ? reports.reduce((n, row) => n + row.reported, 0) : '—'}</td>
                <td className="p-3">{connected ? reports.reduce((n, row) => n + row.failed, 0) : '—'}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </>}
    </div>
    {catalog && <div className={cn(dashboardCard, 'min-w-0 p-5 sm:p-6')}>
      <h3 className="text-lg font-semibold text-ink">Action-level activity</h3>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="grid gap-1 text-xs font-semibold text-muted">Agent filter<select className={control} value={agent} onChange={(e) => { setAgent(e.target.value); setAll(false); }}><option value="all">All agents</option>{catalog.agents.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
        <label className="grid gap-1 text-xs font-semibold text-muted">Search actions<input className={control} value={query} onChange={(e) => { setQuery(e.target.value); setAll(false); }} placeholder="Action name or identifier" /></label>
        <label className="grid gap-1 text-xs font-semibold text-muted">Inspect account<select className={control} value={account} onChange={(e) => { request.current++; setAccount(e.target.value); setDetail(null); setLoading(false); }}><option value="">Choose an enrolled account</option>{state.contacts.map((c) => <option key={c.id} value={c.id}>{c.name || c.email}</option>)}</select></label>
        <button className={cn(control, 'self-end')} disabled={!account || loading} onClick={() => void load()}>{loading ? 'Loading activity…' : 'View action activity'}</button>
      </div>
      {error && <p role="alert" className="mt-4 text-sm text-muted">{error}</p>}
      {detail && <p role="status" className="mt-4 rounded-xl bg-canvas p-4 text-sm text-muted">{detail.deleted ? 'The source reports this account was deleted; its PLG records were erased.' : !detail.activity?.enabled || !detail.activity.epoch ? 'Activity collection is unavailable or has not started for this account.' : detail.activity.limited ? 'The collection limit was reached. These are retained observations; missing actions cannot establish inactivity.' : 'Showing retained observations from the requested window. Collection is best effort; a return is not a verified business result.'}</p>}
      {!account && <p role="status" className="mt-4 rounded-xl bg-canvas p-4 text-sm text-ink">Choose an enrolled account to load its action counts. Until then this is the action catalog, not a usage report.</p>}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[680px] text-left text-sm"><thead className="border-b border-stroke text-xs text-muted"><tr><th className="p-3">Registered action</th><th className="p-3">Evidence</th><th className="p-3">Started</th><th className="p-3">Returned</th><th className="p-3">Failed / blocked</th></tr></thead>
          <tbody>{(all ? actions : actions.slice(0, 50)).map((action) => {
            const rows = detail?.activity?.rollups.filter((r) => r.actionId === action.id) ?? [];
            const count = (...phases: string[]) => detail?.activity?.enabled && detail.activity.epoch
              ? rows.filter((r) => phases.includes(r.phase)).reduce((n, row) => n + row.count, 0) : '—';
            return <tr key={action.id} className="border-b border-stroke last:border-0"><td className="max-w-sm p-3"><p className="font-medium text-ink">{action.label}</p><p className="mt-1 break-all text-xs text-muted">{action.id}</p></td><td className="p-3 text-muted">{action.proof === 'client_reported' ? 'App report' : 'Execution observation'}</td><td className="p-3">{count('started')}</td><td className="p-3">{count('returned')}</td><td className="p-3">{count('failed', 'blocked', 'cancelled')}</td></tr>;
          })}</tbody>
        </table>
      </div>
      {!all && actions.length > 50 && <button className={cn(control, 'mt-4')} onClick={() => setAll(true)}>Show all {actions.length} actions</button>}
      {!actions.length && <p className="mt-4 text-sm text-muted">No registered actions match this filter.</p>}
    </div>}
  </section>;
}
