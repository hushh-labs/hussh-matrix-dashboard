export interface ReportTransaction {
  get<T>(path: string): Promise<T | null>;
  create(path: string, value: unknown): void;
  set(path: string, value: unknown): void;
}
export interface ReportStore { transaction<T>(fn: (tx: ReportTransaction) => Promise<T>): Promise<T> }
export const reportPath = (collection: string, id: string) => `metricsReporting/v1/${collection}/${id}`;

/** Inject an explicitly configured database. No default project or credentials. */
export interface FirestoreReportDriver<Reference> {
  doc(path: string): Reference;
  runTransaction<T>(fn: (tx: {
    get(ref: Reference): Promise<{ exists: boolean; data(): unknown }>;
    create(ref: Reference, value: Record<string, unknown>): unknown;
    set(ref: Reference, value: Record<string, unknown>): unknown;
  }) => Promise<T>): Promise<T>;
}
export class FirestoreReportStore<Reference> implements ReportStore {
  constructor(private readonly db: FirestoreReportDriver<Reference>) {}
  transaction<T>(fn: (tx: ReportTransaction) => Promise<T>): Promise<T> {
    return this.db.runTransaction(async tx => fn({
      get: async <V>(path: string) => {
        const doc = await tx.get(this.db.doc(path));
        return doc.exists ? doc.data() as V : null;
      },
      create: (path, value) => { tx.create(this.db.doc(path), value as Record<string, unknown>); },
      set: (path, value) => { tx.set(this.db.doc(path), value as Record<string, unknown>); },
    }));
  }
}
