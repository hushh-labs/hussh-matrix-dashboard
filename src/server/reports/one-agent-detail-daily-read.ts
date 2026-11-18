import { DailyOneRefresh, dailyOneManifest } from '../daily-one-refresh';
import { requireCurrentCustomerCohort } from '../one-customer-cohort';
import { adaptVerifiedDailyOneDetail } from './one-agent-detail-daily-adapter';

/** Internal, disconnected bridge. The caller must authorize the viewer and bind
 * expected digests/timezone to its policy; the existing cohort source has no
 * transactional revocation epoch. No GA4 event watermark is inferred here. */
export async function readDailyOneAgentDetail(store: DailyOneRefresh, report: string, expected: {
  environment:'production' | 'uat'; reportScopeDigest:string; manifestScopeDigest:string; cohortKey:string;
  period:{startDate:string; endDate:string; timezone:string};
}) {
  if (!expected || !/^[a-f0-9]{64}$/.test(expected.cohortKey) || !dailyOneManifest(expected.period.endDate).includes(report))
    throw new Error('One agent detail unavailable');
  const query = new URL(report, 'http://analytics.internal').searchParams;
  if (query.get('environment') !== expected.environment || query.get('one_start_date') !== expected.period.startDate
    || query.get('one_end_date') !== expected.period.endDate) throw new Error('One agent detail unavailable');
  const cohort = await requireCurrentCustomerCohort(expected.cohortKey);
  const snapshot = await store.read(report, expected.environment === 'production' ? cohort : null, true, cohort);
  if (!snapshot) throw new Error('One agent detail unavailable');
  const result = adaptVerifiedDailyOneDetail(snapshot, expected);
  await requireCurrentCustomerCohort(expected.cohortKey);
  return { ...result, logicalAsOf: snapshot.asOf };
}
