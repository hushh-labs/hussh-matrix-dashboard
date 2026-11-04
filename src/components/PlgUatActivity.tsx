import { useCallback, useEffect, useState } from 'react';
import type { PlgActivity, PlgCatalog } from '../lib/plg';
import { dashboardCard } from '../lib/theme';
import { MatrixBrand } from './MatrixBrand';

export interface UatActivityEvidence {
  environment: 'dev' | 'uat' | 'production'; checkedAt: string; catalog: PlgCatalog; activity: PlgActivity;
  deliveryAuthorized: false;
}

export function UatActivityContent({ evidence }: { evidence: UatActivityEvidence }) {
  const actions = new Map(evidence.catalog.actions.map(action => [action.id, action]));
  const agents = new Map(evidence.catalog.agents.map(agent => [agent.id, agent]));
  return <div className="mt-5 text-sm text-ink" aria-live="polite">
    <p>{{ dev: 'Dev', uat: 'UAT', production: 'Production' }[evidence.environment]} · checked {new Date(evidence.checkedAt).toLocaleString()}</p>
    <p className="mt-2 text-muted">These are captured app and server observations. Collection is best effort; missing events do not prove inactivity, and a return does not prove a successful outcome.</p>
    {evidence.activity.limited && <p role="status" className="mt-2 text-muted">The collection limit was reached; this window is incomplete.</p>}
    {evidence.activity.rollups.length ? <div className="metrics-table-scroll mt-4">
      <table className="w-full min-w-[620px] text-left text-xs">
        <caption className="pb-2 text-left text-muted">Recorded observations. App and server counts may overlap.</caption>
        <thead><tr>{['Agent', 'Action', 'Evidence', 'Phase', 'Count', 'Last observed'].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead>
        <tbody>{evidence.activity.rollups.map(row => <tr key={`${row.actionId}:${row.source}:${row.phase}`}>
          <td className="p-2">{agents.get(row.agentId)?.label ?? row.agentId}</td>
          <td className="p-2">{actions.get(row.actionId)?.label ?? row.actionId}</td>
          <td className="p-2">{row.source === 'client_reported' ? 'App report' : 'Execution observation'}</td>
          <td className="p-2">{row.phase}</td><td className="p-2 tabular-nums">{row.count}</td>
          <td className="p-2">{new Date(row.lastAt).toLocaleString()}</td>
        </tr>)}</tbody>
      </table>
    </div> : <p role="status" className="mt-4">No observations were captured in this window. Activity remains unknown.</p>}
  </div>;
}

export function PlgUatActivity({ environment = 'uat' }: { environment?: 'dev' | 'uat' | 'production' }) {
  const [evidence, setEvidence] = useState<UatActivityEvidence | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(''); setEvidence(null);
    try {
      const endpoint = environment === 'production' ? '/api/plg/my-activity' : `/api/plg/${environment}/my-behaviour`;
      const response = await fetch(endpoint, { credentials: 'same-origin', cache: 'no-store', signal });
      const data = await response.json();
      if (!response.ok || data?.environment !== environment || data.deliveryAuthorized !== false ||
        !data.catalog || !Array.isArray(data.catalog.agents) || !Array.isArray(data.catalog.actions) ||
        !data.activity || !Array.isArray(data.activity.rollups)) throw new Error();
      if (!signal?.aborted) setEvidence(data);
    } catch { if (!signal?.aborted) setError('Activity is unavailable. No activity or email outcome was inferred.'); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [environment]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  return <main className="mx-auto min-h-screen max-w-[1100px] bg-canvas p-5 sm:p-8">
    <MatrixBrand />
    <section aria-label="My agent activity" className={`${dashboardCard} mt-6 p-5 sm:p-7`}>
      <h1 className="text-xl font-semibold text-ink">My {{ dev: 'Dev ', uat: 'UAT ', production: '' }[environment]}agent activity</h1>
      <p className="mt-2 text-sm text-muted">Your signed-in account only. This view does not send email.</p>
      <button className="mt-4 rounded-xl border border-stroke px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50"
        disabled={loading} onClick={() => void load()}>{loading ? 'Checking…' : 'Refresh activity'}</button>
      {error && <p role="alert" className="mt-4 text-sm text-muted">{error}</p>}
      {evidence && <UatActivityContent evidence={evidence} />}
    </section>
  </main>;
}
