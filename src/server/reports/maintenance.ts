import { digest, ReportError, type ReportJob } from './contracts';
import { reportPath as path, type ReportStore, type ReportTransaction } from './store';

export interface ReportMaintenanceStore extends ReportStore {
  scan(collection: 'jobs' | 'quotas', afterId: string | null, limit: number): Promise<string[]>;
}
export type ReportMaintenancePolicy = { approved: boolean; enabled: boolean; batchSize: number; leaseMs: number; retentionMs: number };
type Cursor = { jobsAfter: string | null; quotasAfter: string | null; fence: number; owner: string; leaseUntil: number };
function policy(p: ReportMaintenancePolicy | null) {
  if (!p || Object.keys(p).sort().join() !== 'approved,batchSize,enabled,leaseMs,retentionMs' || p.approved !== true || p.enabled !== true
    || ![p.batchSize, p.leaseMs, p.retentionMs].every(v => Number.isSafeInteger(v) && v > 0) || p.batchSize > 100) throw new ReportError('unavailable');
  return p;
}
/** Explicit dispatcher invocation only. No timer, startup sweep or source I/O
 * in transactions. Each invocation scans at most one reviewed page per class. */
export class MetricsReportMaintenance {
  constructor(private store: ReportMaintenanceStore, private recover: (job: ReportJob) => Promise<void>, private now: () => number = Date.now) {}
  async run(owner: string) {
    if (!/^[a-f0-9]{64}$/.test(owner)) throw new ReportError('invalid');
    const claimed = await this.store.transaction(async tx => {
      const p = policy(await tx.get<ReportMaintenancePolicy>(path('policy', 'maintenance')));
      const old = await tx.get<Cursor>(path('maintenance', 'cursor'));
      if (old && old.leaseUntil > this.now()) return null;
      const cursor: Cursor = { jobsAfter: old?.jobsAfter ?? null, quotasAfter: old?.quotasAfter ?? null,
        fence: (old?.fence ?? 0) + 1, owner, leaseUntil: this.now() + p.leaseMs };
      tx.set(path('maintenance', 'cursor'), cursor); return { p, cursor };
    });
    if (!claimed) return { state: 'busy' as const, scanned: 0, deleted: 0, recovered: 0 };
    let scanned = 0, deleted = 0, recovered = 0;
    const stillOwned = () => this.store.transaction(async tx => {
      const p = policy(await tx.get<ReportMaintenancePolicy>(path('policy', 'maintenance')));
      const c = await tx.get<Cursor>(path('maintenance', 'cursor'));
      return !!c && c.fence === claimed.cursor.fence && c.owner === owner && c.leaseUntil > this.now() && digest(p) === digest(claimed.p);
    });
    const advance = async (collection: 'jobs' | 'quotas', after: string | null) => this.store.transaction(async tx => {
      const c = await tx.get<Cursor>(path('maintenance', 'cursor'));
      if (!c || c.fence !== claimed.cursor.fence || c.owner !== owner || c.leaseUntil <= this.now()) return false;
      tx.set(path('maintenance', 'cursor'), { ...c, [collection === 'jobs' ? 'jobsAfter' : 'quotasAfter']: after }); return true;
    });
    try {
      for (const collection of ['jobs', 'quotas'] as const) {
        const after = collection === 'jobs' ? claimed.cursor.jobsAfter : claimed.cursor.quotasAfter;
        if (!await stillOwned()) break;
        const ids = await this.store.scan(collection, after, claimed.p.batchSize);
        for (const id of ids) {
          if (!/^[a-f0-9]{64}$/.test(id) || !await stillOwned()) break;
          scanned++;
          if (collection === 'jobs') {
            const job = await this.store.transaction(tx => tx.get<ReportJob>(path('jobs', id)));
            if (job && !['completed', 'failed', 'invalidated'].includes(job.status) && !job.needsAttention && job.leaseUntil <= this.now() && job.nextAttemptAt <= this.now()) {
              try { await this.recover(job); recovered++; } catch { /* Keep intent and reservations; a later bounded pass can reconcile. */ }
            }
            deleted += await this.pruneJob(id, claimed);
          } else {
            deleted += await this.store.transaction(async tx => {
              if (!await this.gate(tx, claimed)) return 0;
              const q = await tx.get<{ windowEndsAt: number }>(path('quotas', id));
              if (!q || !Number.isSafeInteger(q.windowEndsAt) || q.windowEndsAt > this.now() - claimed.p.retentionMs) return 0;
              tx.delete(path('quotas', id)); return 1;
            });
          }
          if (!await advance(collection, id)) break;
        }
        if (ids.length < claimed.p.batchSize) await advance(collection, null);
      }
    } finally {
      await this.store.transaction(async tx => {
        const c = await tx.get<Cursor>(path('maintenance', 'cursor'));
        if (c?.fence === claimed.cursor.fence && c.owner === owner) tx.set(path('maintenance', 'cursor'), { ...c, leaseUntil: 0 });
      });
    }
    return { state: 'completed' as const, scanned, deleted, recovered };
  }
  private async gate(tx: ReportTransaction, claimed: { p: ReportMaintenancePolicy; cursor: Cursor }) {
    const p = policy(await tx.get<ReportMaintenancePolicy>(path('policy', 'maintenance')));
    const c = await tx.get<Cursor>(path('maintenance', 'cursor'));
    return !!c && c.fence === claimed.cursor.fence && c.owner === claimed.cursor.owner
      && c.leaseUntil > this.now() && digest(p) === digest(claimed.p);
  }
  private async pruneJob(id: string, claimed: { p: ReportMaintenancePolicy; cursor: Cursor }) {
    return this.store.transaction(async tx => {
      if (!await this.gate(tx, claimed)) return 0;
      const job = await tx.get<ReportJob>(path('jobs', id));
      if (!job || job.id !== id || !/^[a-f0-9]{64}$/.test(job.key) || !['completed', 'failed', 'invalidated'].includes(job.status)
        || job.leaseUntil > this.now() || !Number.isSafeInteger(job.completedAt) || job.completedAt! > this.now() - claimed.p.retentionMs) return 0;
      const head = await tx.get<{ activeJob: string | null; publication: string | null }>(path('heads', job.key));
      const receipt = await tx.get<{ state: string }>(path('sourceReceipts', id));
      if (!head || head.activeJob === id || head.publication === id || receipt && receipt.state !== 'completed') return 0;
      // Keep the permanent head sequence: deleting it could reuse provider/task IDs.
      for (const collection of ['snapshots', 'sourceReceipts', 'dispatches', 'jobs']) tx.delete(path(collection, id));
      return 4; // Document delete operations, not claimed reclaimed bytes or savings.
    });
  }
}
