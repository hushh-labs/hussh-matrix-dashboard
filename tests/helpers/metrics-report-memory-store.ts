import type { ReportStore, ReportTransaction } from '../../src/server/reports/store';

/** Serialized test store also rejects Firestore's read-after-write anti-pattern. */
export class MemoryReportStore implements ReportStore {
  data = new Map<string, unknown>();
  private tail: Promise<unknown> = Promise.resolve();
  transaction<T>(fn: (tx: ReportTransaction) => Promise<T>): Promise<T> {
    const operation = this.tail.then(async () => {
      const next = structuredClone(this.data); let wrote = false;
      const result = await fn({
        get: async <V>(key: string) => { if (wrote) throw new Error('Read after write'); return structuredClone(next.get(key) ?? null) as V | null; },
        create: (key, value) => { if (next.has(key)) throw new Error('Already exists'); wrote = true; next.set(key, structuredClone(value)); },
        set: (key, value) => { wrote = true; next.set(key, structuredClone(value)); },
        delete: key => { wrote = true; next.delete(key); },
      });
      this.data = next; return result;
    });
    this.tail = operation.catch(() => undefined);
    return operation;
  }
  async scan(collection: 'jobs' | 'quotas', afterId: string | null, limit: number) {
    await this.tail;
    const prefix = `metricsReporting/v1/${collection}/`;
    return [...this.data.keys()].filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length))
      .sort().filter(id => !afterId || id > afterId).slice(0, limit);
  }
}
