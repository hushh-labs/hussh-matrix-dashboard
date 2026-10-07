/** Bounded aggregate snapshots. Auth remains outside this cache. */
export class AggregateCache<T> {
  private entries = new Map<string, { value: T; at: number; usedAt: number; load: () => Promise<T> }>();
  private pending = new Map<string, Promise<{ value: T; at: number }>>();
  private retryAt = new Map<string, number>();
  private refreshing = false;

  constructor(private options: {
    freshMs: number; maxAgeMs: number; maxEntries: number; now?: () => number;
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
      this.entries.set(key, { value, at, usedAt: previous?.usedAt ?? at, load: loader });
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
    if (hit && now - hit.at <= this.options.maxAgeMs) {
      hit.usedAt = now;
      hit.load = loader;
      this.entries.delete(key);
      this.entries.set(key, hit);
      if ((force || now - hit.at >= this.options.freshMs) && (this.retryAt.get(key) ?? 0) <= now) {
        void this.load(key, loader).catch(() => {});
      }
      return { value: hit.value, at: hit.at, state: this.pending.has(key) ? 'REFRESHING' : 'HIT', refreshing: this.pending.has(key), refreshError: (this.retryAt.get(key) ?? 0) > now };
    }
    const joined = this.pending.has(key);
    const result = await this.load(key, loader);
    return { ...result, state: joined ? 'COALESCED' : 'MISS', refreshing: false, refreshError: false };
  }

  async refreshActive() {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
    const now = this.now();
    const due = [...this.entries.entries()].filter(([key, entry]) =>
      now - entry.usedAt <= 120_000 && now - entry.at >= this.options.freshMs
      && !this.pending.has(key) && (this.retryAt.get(key) ?? 0) <= now,
    );
    // Avoid multiplying dozens of warehouse jobs for every active range at once.
    let cursor = 0;
    await Promise.all([0, 1].map(async () => {
      while (cursor < due.length) {
        const [key, entry] = due[cursor++];
        try { await this.load(key, entry.load); } catch { /* Preserve the dated snapshot. */ }
      }
    }));
    } finally { this.refreshing = false; }
  }

  async warm(key: string, loader: () => Promise<T>) {
    const hit = this.entries.get(key);
    if (hit) hit.usedAt = this.now();
    if (!hit || this.now() - hit.at >= this.options.freshMs) await this.load(key, loader);
  }

  get size() { return this.entries.size; }
}

export function canonicalAnalyticsKey(originalUrl: string) {
  const url = new URL(originalUrl, 'http://analytics.internal');
  if (url.pathname === '/api/analytics/all' && url.searchParams.get('view') === 'platforms') url.searchParams.set('view', 'overview');
  url.searchParams.sort();
  return `${url.pathname}${url.search}`;
}
