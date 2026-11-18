import { useEffect, useRef, useState } from 'react';
import { peekMetrics, readMetrics, revalidateMetricsSelection, type MetricsSnapshot } from './metrics-resource';

/** Load only the selected resource, on selection or an explicit refresh. */
export function useMetricsResource<T>(url: string | null, options: { refreshKey?: number } = {}) {
  const [state, setState] = useState<{ url: string; refreshKey: number; snapshot: MetricsSnapshot<T> | null; error: boolean; busy: boolean } | null>(null);
  const refreshSeen = useRef(options.refreshKey ?? 0);
  useEffect(() => {
    if (!url) return;
    let active = true;
    const force = refreshSeen.current !== (options.refreshKey ?? 0);
    const refreshKey = options.refreshKey ?? 0;
    refreshSeen.current = options.refreshKey ?? 0;
    const passive = url.startsWith('/api/analytics/all?') || url === '/api/analytics/all';
    const revalidate = passive || revalidateMetricsSelection(url);
    const cached = revalidate ? null : peekMetrics<T>(url);
    setState({ url, refreshKey, snapshot: cached, error: false, busy: !cached || force });
    void readMetrics<T>(url, { refresh: force }).then(snapshot => {
      if (active) setState({ url, refreshKey, snapshot, error: snapshot.refreshError, busy: false });
    }).catch(() => {
      if (active) setState({ url, refreshKey, snapshot: revalidate ? null : peekMetrics<T>(url), error: true, busy: false });
    });
    return () => { active = false; };
  }, [url, options.refreshKey]);
  // Never paint the old period under a newly selected period, even for one frame.
  const passive = url?.startsWith('/api/analytics/all?') || url === '/api/analytics/all';
  const current = state?.url === url && state.refreshKey === (options.refreshKey ?? 0) ? state : null;
  const snapshot = current ? current.snapshot : (passive || revalidateMetricsSelection(url)) ? null : peekMetrics<T>(url);
  const observed = snapshot?.observedAt ? Date.parse(snapshot.observedAt) : NaN;
  const serverNow = Number.isFinite(observed) ? observed + Math.max(0, Date.now() - snapshot!.fetchedAt) : Date.now();
  const updated = snapshot?.updatedAt ? Date.parse(snapshot.updatedAt) : NaN;
  return { data: snapshot?.data ?? null, updatedAt: snapshot?.updatedAt ?? null, headerUpdatedAt: snapshot?.headerUpdatedAt ?? null, cohortAsOf: snapshot?.cohortAsOf ?? null,
    computedAt: snapshot?.computedAt ?? null, warehouseFrom: snapshot?.warehouseFrom ?? null, warehouseThrough: snapshot?.warehouseThrough ?? null, cacheState: snapshot?.cacheState ?? null, sourceCoverage: snapshot?.sourceCoverage ?? null, serverNow, stale: Number.isFinite(updated) && serverNow - updated > 24 * 60 * 60_000,
    loading: Boolean(url && !snapshot && !current?.error),
    refreshing: Boolean(current?.busy), error: Boolean(current?.error) };
}
