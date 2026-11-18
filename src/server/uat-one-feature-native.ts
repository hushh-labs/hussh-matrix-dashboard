import type { ReportJob } from './reports/contracts';

/** Shape used by the disconnected publisher; no native capability is exported. */
export interface UatFeatureNative {
  readVerifiedRows(job:ReportJob,signal:AbortSignal):Promise<unknown[]>;
}
