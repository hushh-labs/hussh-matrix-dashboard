import 'server-only';
import { Firestore } from '@google-cloud/firestore';
import { MetricsReports } from '../../../src/server/reports/service';
import { FirestoreReportStore } from '../../../src/server/reports/store';

let service: MetricsReports | null = null;
export function reportsRuntime(): MetricsReports | null {
  const projectId = process.env.METRICS_REPORTING_PROJECT ?? '';
  const databaseId = process.env.METRICS_REPORTING_DATABASE ?? '';
  // Explicit isolated reporting database; PLG's database is never a fallback.
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId)
    || !/^metrics-[a-z0-9-]{1,50}$/.test(databaseId) || process.env.FIRESTORE_EMULATOR_HOST) return null;
  service ??= new MetricsReports(new FirestoreReportStore(new Firestore({ projectId, databaseId })));
  return service;
}
