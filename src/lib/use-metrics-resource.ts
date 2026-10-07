import { useEffect, useRef, useState } from 'react';
import { peekMetrics, prefetchMetrics, readMetrics, type MetricsSnapshot } from './metrics-resource';

export function useMetricsResource<T>(url: string | null, options: {
  refreshKey?: number; refreshIntervalMs?: number; prefetchUrls?: string[];
} = {}) {
  const [state, setState] = useState<{ url: string; snapshot: MetricsSnapshot<T> | null; error: boolean; busy: boolean } | null>(null);
  const refreshSeen = useRef(options.refreshKey ?? 0);
  const prefetchKey = (options.prefetchUrls ?? []).join('\n');
  useEffect(() => {
    if (!url) return;
    let active = true;
    let poll: ReturnType<typeof setTimeout> | undefined;
    const force = refreshSeen.current !== (options.refreshKey ?? 0);
    refreshSeen.current = options.refreshKey ?? 0;
    const load = async (refresh = false, network = false) => {
      if (!active) return;
      clearTimeout(poll);
      const cached = peekMetrics<T>(url);
      setState({ url, snapshot: cached, error: false, busy: !cached || refresh });
      try {
        const snapshot = await readMetrics<T>(url, { refresh, network });
        if (!active) return;
        setState({ url, snapshot, error: snapshot.refreshError, busy: snapshot.refreshing });
        if (snapshot.refreshing) poll = setTimeout(() => { void load(false, true); }, 1500);
        else if (prefetchKey) void prefetchMetrics(prefetchKey.split('\n'));
      } catch {
        if (active) setState({ url, snapshot: peekMetrics<T>(url), error: true, busy: false });
      }
    };
    void load(force);
    const interval = options.refreshIntervalMs
      ? setInterval(() => { if (document.visibilityState !== 'hidden') void load(false, true); }, options.refreshIntervalMs)
      : undefined;
    return () => { active = false; clearTimeout(poll); clearInterval(interval); };
  }, [url, options.refreshKey, options.refreshIntervalMs, prefetchKey]);
  // Never paint the old period under a newly selected period, even for one frame.
  const snapshot = state?.url === url ? state.snapshot : peekMetrics<T>(url);
  return { data: snapshot?.data ?? null, updatedAt: snapshot?.updatedAt ?? null,
    loading: Boolean(url && !snapshot && !(state?.url === url && state.error)),
    refreshing: Boolean(state?.url === url && state.busy), error: Boolean(state?.url === url && state.error) };
}
