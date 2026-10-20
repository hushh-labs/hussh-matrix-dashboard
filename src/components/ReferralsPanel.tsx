import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { referralPageSize, type ReferralBoard, type ReferralEnvironment, type ReferralRankings } from '../lib/referrals';
import { useMetricsResource } from '../lib/use-metrics-resource';

const sourceName = (source: ReferralEnvironment) => source === 'production' ? 'Production' : 'UAT';

export function ReferralsPanel({ refreshKey }: { refreshKey: number }) {
  const [board, setBoard] = useState<ReferralBoard>('individual');
  const [environment, setEnvironment] = useState<ReferralEnvironment>();
  const [pagination, setPagination] = useState({ refreshKey, cursors: [0], snapshotId: undefined as string | undefined });
  // Reset before committing a new refresh: do not fetch an old pinned page first.
  if (pagination.refreshKey !== refreshKey) setPagination({ refreshKey, cursors: [0], snapshotId: undefined });
  const { cursors, snapshotId } = pagination;
  const [retry, setRetry] = useState(0);
  const params = new URLSearchParams({ board, afterRank: String(cursors.at(-1) ?? 0) });
  if (environment) params.set('environment', environment);
  if (snapshotId) params.set('snapshotId', snapshotId);
  // A pinned page never polls into a different snapshot halfway through browsing.
  const resource = useMetricsResource<ReferralRankings>(`/api/analytics/one/referrals?${params}`, { refreshKey: refreshKey + retry });
  const data = resource.data;
  const available = data?.state === 'available';
  const reset = () => setPagination({ refreshKey, cursors: [0], snapshotId: undefined });
  const restart = () => { reset(); setRetry(value => value + 1); };
  const loading = resource.loading || resource.refreshing;
  const pageNumber = cursors.length;

  return <main className="space-y-5" aria-label="Referral rankings">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div role="tablist" aria-label="Referral rankings" className="inline-flex rounded-lg border border-stroke bg-surface p-1">
        {(['individual', 'circles'] as const).map(key => <button key={key} type="button" role="tab"
          id={`referral-tab-${key}`} aria-controls="referral-standings" aria-selected={board === key}
          onClick={() => { setBoard(key); reset(); }}
          className={`min-h-10 rounded-md px-5 text-sm font-semibold ${board === key ? 'bg-brand-500 text-white' : 'text-muted hover:text-ink'}`}>
          {key === 'individual' ? 'Individual' : 'Circles'}</button>)}
      </div>
      {data && data.environments.length > 1 ? <div role="group" aria-label="Referral environment" className="inline-flex rounded-lg border border-stroke bg-surface p-1">
        {data.environments.map(key => <button key={key} type="button" aria-pressed={data.environment === key}
          onClick={() => { setEnvironment(key); reset(); }}
          className={`min-h-10 rounded-md px-4 text-sm font-semibold ${data.environment === key ? 'bg-brand-500 text-white' : 'text-muted hover:text-ink'}`}>
          {sourceName(key)}</button>)}
      </div> : data?.environment && <span className="text-sm text-muted">{sourceName(data.environment)}</span>}
    </div>

    <section id="referral-standings" role="tabpanel" aria-labelledby={`referral-tab-${board}`} className="dashboard-card p-5 sm:p-6" aria-busy={loading}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-ink">{board === 'individual' ? 'Individual rankings' : 'Circle rankings'}</h2>
        {available && data.snapshotGeneratedAt && <p className="text-xs text-muted">Snapshot: {new Date(data.snapshotGeneratedAt).toLocaleString()}</p>}
      </div>
      {resource.loading ? <p role="status" className="py-10 text-sm text-muted">Loading rankings…</p>
        : resource.error && !data ? <div role="status" className="py-10 text-sm text-muted">
          <p>Referral rankings temporarily unavailable.</p><button type="button" onClick={restart} className="mt-4 rounded-lg border border-stroke px-4 py-2 font-semibold text-ink">Try again</button>
        </div> : <>
          {resource.error && <p role="status" className="mb-4 text-sm text-muted">Could not refresh. Showing the last successful snapshot. <button type="button" onClick={restart} className="underline">Try again</button></p>}
          {available && data.entries.length > 0 ? <div className="metrics-table-scroll">
            <table className="w-full text-sm" style={{ minWidth: 240 }}>
              <thead><tr className="text-xs text-muted"><th scope="col" className="w-14 py-3 pr-3 text-left">Rank</th><th scope="col" className="py-3 pr-3 text-left">Member</th><th scope="col" className="py-3 text-right">Points</th></tr></thead>
              <tbody>{data.entries.map(row => <tr key={row.rank} className="border-t border-stroke">
                <td className="py-4 pr-3 tabular-nums text-muted">{row.rank}</td>
                <th scope="row" className="py-4 pr-3 text-left font-medium text-ink break-words">{row.handle}</th>
                <td className="py-4 text-right tabular-nums font-semibold text-ink">{row.points.toLocaleString('en-US')}</td>
              </tr>)}</tbody>
            </table>
          </div> : <div role="status" className="py-12 text-center text-sm text-muted">
            {data?.state === 'preview' ? 'No circle standings yet.'
              : data?.state === 'waiting' ? 'Waiting for the first published rankings.'
              : data?.state === 'expired' ? <>This snapshot is no longer available. <button type="button" onClick={restart} className="underline">Load latest rankings</button></>
              : available ? 'No individual standings yet.' : 'Referral rankings temporarily unavailable.'}
          </div>}
          <nav aria-label="Rankings pagination" className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-stroke pt-4 text-sm">
            <span className="text-muted">Page {pageNumber} · {referralPageSize} per page</span>
            <div className="flex gap-2">
              <button type="button" disabled={pageNumber === 1 || loading} onClick={() => setPagination(value => ({ ...value, cursors: value.cursors.slice(0, -1) }))}
                className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-stroke px-3 font-semibold text-ink disabled:opacity-40"><ChevronLeft size={16} aria-hidden="true" />Previous</button>
              <button type="button" disabled={!available || data.nextAfterRank == null || loading} onClick={() => {
                if (data?.environment && data.snapshotId && data.nextAfterRank != null) {
                  setEnvironment(data.environment); setPagination(value => ({ ...value, snapshotId: data.snapshotId!, cursors: [...value.cursors, data.nextAfterRank!] }));
                }
              }} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-stroke px-3 font-semibold text-ink disabled:opacity-40">Next<ChevronRight size={16} aria-hidden="true" /></button>
            </div>
          </nav>
        </>}
    </section>
  </main>;
}
