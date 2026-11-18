import type { ReportJob } from './contracts';
import type { StagedUatDetailQuery } from './staged-uat-detail-query';
import type { UatFeatureNative } from '../uat-one-feature-native';
import { adaptUatFeatureRows } from './uat-feature-rows';

/** Internal only. The staged saga must have a valid durable DONE proof; caller
 * must authorize the worker and verify the source policy/timezone. */
export async function readUatFeatureDetail(job:ReportJob, saga:StagedUatDetailQuery, native:UatFeatureNative, signal:AbortSignal) {
  if (String(job.request.reportId)!=='one.agent-detail-uat') throw new Error('One feature detail unavailable');
  const rows=await native.readVerifiedRows(job,saga,signal); signal.throwIfAborted();
  return adaptUatFeatureRows(rows,{scopeDigest:job.control.scopeDigest,period:{startDate:job.request.startDate,
    endDate:job.request.endDate,timezone:job.request.timezone}});
}
