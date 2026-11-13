import { FieldPath, type Firestore } from '@google-cloud/firestore';
import { FirestoreReportStore } from './store';
import { ReportError } from './contracts';
import type { ReportMaintenanceStore } from './maintenance';

/** Bounded, cursor-based scan over reporting collections only. */
export class FirestoreReportMaintenanceStore extends FirestoreReportStore<ReturnType<Firestore['doc']>> implements ReportMaintenanceStore {
  constructor(private maintenanceDb: Firestore) { super(maintenanceDb); }
  async scan(collection: 'jobs' | 'quotas', afterId: string | null, limit: number) {
    if (!['jobs', 'quotas'].includes(collection) || afterId !== null && !/^[a-f0-9]{64}$/.test(afterId)
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new ReportError('invalid');
    let query = this.maintenanceDb.collection(`metricsReporting/v1/${collection}`).orderBy(FieldPath.documentId()).limit(limit);
    if (afterId) query = query.startAfter(afterId);
    return (await query.get()).docs.map(doc => doc.id);
  }
}
