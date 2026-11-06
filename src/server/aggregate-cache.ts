/** Request-driven aggregate snapshots. Auth remains outside this cache. */
export class AggregateCache<T> {
  private entries = new Map<string, { value: T; at: number }>();
  private pending = new Map<string, Promise<{ value: T; at: number }>>();
  private retryAt = new Map<string, number>();

  constructor(private options: {
    maxAgeMs: number; maxEntries: number; now?: () => number;
  }) {}

  private now() { return this.options.now?.() ?? Date.now(); }

  private load(key: string, loader: () => Promise<T>) {
    const running = this.pending.get(key);
    if (running) return running;
    const promise = Promise.resolve().then(loader).then(value => {
      const at = this.now();
      const previous = this.entries.get(key);
      if (!previous) {
        while (this.entries.size >= this.options.maxEntries) {
          const oldest = this.entries.keys().next().value;
          if (oldest === undefined) break;
          this.entries.delete(oldest);
          this.retryAt.delete(oldest);
        }
      }
      this.entries.delete(key);
      this.entries.set(key, { value, at });
      this.retryAt.delete(key);
      return { value, at };
    }).catch(error => {
      while (this.retryAt.size >= this.options.maxEntries) this.retryAt.delete(this.retryAt.keys().next().value!);
      this.retryAt.set(key, this.now() + 15_000);
      throw error;
    }).finally(() => { this.pending.delete(key); });
    this.pending.set(key, promise);
    return promise;
  }

  async read(key: string, loader: () => Promise<T>, force = false) {
    const now = this.now();
    const hit = this.entries.get(key);
    if (!force && hit && now - hit.at <= this.options.maxAgeMs) {
      this.entries.delete(key);
      this.entries.set(key, hit);
      return { ...hit, state: 'HIT', refreshing: false, refreshError: (this.retryAt.get(key) ?? 0) > now };
    }
    const joined = this.pending.has(key);
    try {
      const result = await this.load(key, loader);
      return { ...result, state: joined ? 'COALESCED' : force ? 'REFRESHED' : 'MISS', refreshing: false, refreshError: false };
    } catch (error) {
      // Explicit refresh waits for the result. Keep a valid dated snapshot on
      // failure; never schedule a retry or start work behind a cache hit.
      if (hit && this.now() - hit.at <= this.options.maxAgeMs) {
        return { ...hit, state: 'HIT', refreshing: false, refreshError: true };
      }
      throw error;
    }
  }

  get size() { return this.entries.size; }
}

export function canonicalAnalyticsKey(originalUrl: string) {
  const url = new URL(originalUrl, 'http://analytics.internal');
  if (url.pathname === '/api/analytics/all' && url.searchParams.get('view') === 'platforms') url.searchParams.set('view', 'overview');
  url.searchParams.sort();
  return `${url.pathname}${url.search}`;
}
