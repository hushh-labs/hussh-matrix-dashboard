/** Session-only browser cache; never persist private dashboard responses. */
export interface MetricsSnapshot<T> { data: T; fetchedAt: number; updatedAt: string | null; refreshing: boolean; refreshError: boolean }
const values = new Map<string, MetricsSnapshot<unknown>>();
const pending = new Map<string, Promise<MetricsSnapshot<unknown>>>();
const MAX_ENTRIES = 48;
const MAX_AGE_MS = 10 * 60_000;

let generation = 0;
export function clearMetricsCache() { generation++; values.clear(); pending.clear(); }
export function peekMetrics<T>(url: string | null): MetricsSnapshot<T> | null {
  if (!url) return null;
  const hit = values.get(url);
  if (!hit || Date.now() - hit.fetchedAt > MAX_AGE_MS) return null;
  return hit as MetricsSnapshot<T>;
}

export async function readMetrics<T>(url: string, options: { refresh?: boolean; network?: boolean } = {}): Promise<MetricsSnapshot<T>> {
  const existing = peekMetrics<T>(url);
  if (!options.refresh && !options.network && existing && Date.now() - existing.fetchedAt < 30_000) return existing;
  const running = pending.get(url);
  if (running) return running as Promise<MetricsSnapshot<T>>;
  const requestGeneration = generation;
  const request = (async () => {
    const response = await fetch(url, {
      cache: 'no-store', credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(options.refresh ? { 'X-Metrics-Refresh': '1' } : {}) },
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) clearMetricsCache();
      throw new Error('Metrics temporarily unavailable');
    }
    const data = await response.json();
    const snapshot: MetricsSnapshot<T> = { data, fetchedAt: Date.now(),
      updatedAt: response.headers.get('X-Metrics-Updated-At') || data.generatedAt || data.fetchedAt || null,
      refreshing: response.headers.get('X-Metrics-Refreshing') === '1', refreshError: response.headers.get('X-Metrics-Refresh-Error') === '1' };
    if (requestGeneration !== generation) throw new Error('Session changed');
    while (values.size >= MAX_ENTRIES && !values.has(url)) values.delete(values.keys().next().value!);
    values.set(url, snapshot);
    return snapshot;
  })().finally(() => { if (pending.get(url) === request) pending.delete(url); });
  pending.set(url, request);
  return request;
}

export async function prefetchMetrics(urls: string[]) {
  // A single worker avoids a burst of expensive queries on older deployments.
  for (const url of urls) {
    if (peekMetrics(url)) continue;
    try { await readMetrics(url); } catch { /* An optional prefetch must not block the page. */ }
  }
}
