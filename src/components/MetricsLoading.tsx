export function MetricsSkeleton({ label = 'Loading the selected period' }: { label?: string }) {
  return <section role="status" aria-label={label} aria-busy="true" className="space-y-5 py-4">
    <span className="sr-only">{label}</span>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-hidden="true">
      {[0, 1, 2, 3].map(key => <div key={key} className="rounded-2xl border border-stroke bg-surface p-5">
        <div className="metrics-skeleton h-3 w-28 rounded" /><div className="metrics-skeleton mt-6 h-8 w-20 rounded" />
        <div className="metrics-skeleton mt-4 h-3 w-4/5 rounded" />
      </div>)}
    </div>
    <div className="rounded-2xl border border-stroke bg-surface p-5" aria-hidden="true">
      <div className="metrics-skeleton mb-5 h-4 w-44 rounded" /><div className="metrics-skeleton h-56 rounded-xl" />
    </div>
  </section>;
}

function utcLabel(value?: string | null) {
  const time = value ? new Date(value) : null;
  return time && Number.isFinite(time.getTime()) ? `${time.toISOString().slice(0, 19).replace('T', ' ')} UTC` : null;
}

export function MetricsUpdateStatus({ period, updatedAt, cohortAsOf, refreshing, loading, error }: {
  period?: string; updatedAt?: string | null; cohortAsOf?: string | null; refreshing?: boolean; loading?: boolean; error?: boolean;
}) {
  const updated = utcLabel(updatedAt), cohort = utcLabel(cohortAsOf);
  return <p role="status" aria-live="polite" className="my-3 text-xs font-medium leading-5 text-muted" data-metrics-state={loading ? 'loading' : refreshing ? 'refreshing' : error ? 'error' : 'ready'}>
    {loading ? `Loading ${period || 'metrics'}…` : error && !updatedAt ? `Metrics unavailable for ${period || 'this selection'}` : `${period ? `Showing ${period}` : 'Showing latest metrics'}${updated ? ` · Updated ${updated}` : ''}`}
    {cohort && updated ? ` · Cohort traversal began ${cohort} (live, not atomic)` : ''}
    {refreshing && !loading ? ' · Refreshing selected metrics' : ''}
    {error && updatedAt ? ' · Refresh unavailable; showing the last successful update' : ''}
  </p>;
}
