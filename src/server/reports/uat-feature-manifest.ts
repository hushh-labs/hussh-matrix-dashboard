import { digest, ReportError } from './contracts';
import { ONE_AGENT_DETAIL_MANIFEST_DIGEST, ONE_AGENT_DETAIL_VERSION } from './one-agent-detail-contract';
import { buildUatFeaturePlan } from '../uat-one-feature-plan';
import { AGENT_MEASUREMENTS } from '../../lib/agent-measurement-contract.mjs';

/** Internal policy binding for the feature-only report. Approval and source
 * ownership must be established independently; this digest is not that proof. */
export function uatFeatureManifest(config: Parameters<typeof buildUatFeaturePlan>[0]) {
  const plan = buildUatFeaturePlan(config);
  const manifest = Object.freeze({ schema: 1, report: 'one.agent-detail-uat', environment: 'uat',
    project: plan.sourceProject, dataset: plan.dataset, webHost: config.webHost,
    reportingScopeVersion: plan.reportingScopeVersion, startDate: plan.startDate, endDate: plan.endDate,
    timezone: plan.timezone, definitionVersion: ONE_AGENT_DETAIL_VERSION,
    catalogDigest: ONE_AGENT_DETAIL_MANIFEST_DIGEST, catalogDefinitionDigest: digest(AGENT_MEASUREMENTS), queryHash: plan.queryHash });
  return { manifest, manifestDigest: digest(manifest) };
}

/** Compare against an independently approved policy value, never a request body. */
export function validateUatFeatureManifest(config: Parameters<typeof buildUatFeaturePlan>[0], approvedDigest: string) {
  const result = uatFeatureManifest(config);
  if (!/^[a-f0-9]{64}$/.test(approvedDigest) || result.manifestDigest !== approvedDigest)
    throw new ReportError('unavailable');
  return result;
}
