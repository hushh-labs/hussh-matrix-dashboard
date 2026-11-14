/** Only immutable aggregate JSON bodies. Current authority/pointer checks belong
 * outside this cache on every request. Expiry never executes a loader. */
export class ReportBodyCache {
  private values = new Map<string, { body: string; bytes: number }>();
  private bytes = 0;
  constructor(private maxEntries: number, private maxBytes: number) {
    if (![maxEntries, maxBytes].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('Invalid Metrics cache bounds.');
  }
  get<T>(key: string): T | null {
    const entry = this.values.get(key);
    if (!entry) return null;
    this.values.delete(key); this.values.set(key, entry);
    return JSON.parse(entry.body) as T;
  }
  put(key: string, value: unknown) {
    const body = JSON.stringify(value), bytes = Buffer.byteLength(body);
    if (bytes > this.maxBytes) return;
    this.remove(key);
    while (this.values.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) {
      const oldest = this.values.keys().next().value;
      if (oldest === undefined) break;
      this.remove(oldest);
    }
    this.values.set(key, { body, bytes }); this.bytes += bytes;
  }
  private remove(key: string) {
    const entry = this.values.get(key);
    if (entry) { this.bytes -= entry.bytes; this.values.delete(key); }
  }
  get usage() { return { entries: this.values.size, bytes: this.bytes }; }
}
