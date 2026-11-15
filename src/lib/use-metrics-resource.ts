import { useEffect, useRef, useState } from 'react';
import { peekMetrics, readMetrics, type MetricsSnapshot } from './metrics-resource';

/** Load only the selected resource, on selection or an explicit refresh. */
export function useMetricsResource<T>(url: string | null, options: { refreshKey?: number } = {}) {
  const [state, setState] = useState<{ url: string; snapshot: MetricsSnapshot<T> | null; error: boolean; busy: boolean } | null>(null);
  const refreshSeen = useRef(options.refreshKey ?? 0);
  useEffect(() => {
    if (!url) return;
    let active = true;
    const force = refreshSeen.current !== (options.refreshKey ?? 0);
    refreshSeen.current = options.refreshKey ?? 0;
    const cached = peekMetrics<T>(url);
    setState({ url, snapshot: cached, error: false, busy: !cached || force });
    void readMetrics<T>(url, { refresh: force }).then(snapshot => {
      if (active) setState({ url, snapshot, error: snapshot.refreshError, busy: false });
    }).catch(() => {
      if (active) setState({ url, snapshot: peekMetrics<T>(url), error: true, busy: false });
    });
    return () => { active = false; };
  }, [url, options.refreshKey]);
  // Never paint the old period under a newly selected period, even for one frame.
  const snapshot = state?.url === url ? state.snapshot : peekMetrics<T>(url);
  const observed = snapshot?.observedAt ? Date.parse(snapshot.observedAt) : NaN;
  const serverNow = Number.isFinite(observed) ? observed + Math.max(0, Date.now() - snapshot!.fetchedAt) : Date.now();
  const updated = snapshot?.updatedAt ? Date.parse(snapshot.updatedAt) : NaN;
  return { data: snapshot?.data ?? null, updatedAt: snapshot?.updatedAt ?? null, headerUpdatedAt: snapshot?.headerUpdatedAt ?? null, cohortAsOf: snapshot?.cohortAsOf ?? null,
    computedAt: snapshot?.computedAt ?? null, warehouseFrom: snapshot?.warehouseFrom ?? null, warehouseThrough: snapshot?.warehouseThrough ?? null, cacheState: snapshot?.cacheState ?? null, serverNow, stale: Number.isFinite(updated) && serverNow - updated > 24 * 60 * 60_000,
    loading: Boolean(url && !snapshot && !(state?.url === url && state.error)),
    refreshing: Boolean(state?.url === url && state.busy), error: Boolean(state?.url === url && state.error) };
}
