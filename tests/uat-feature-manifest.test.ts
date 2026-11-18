import { expect, it } from 'vitest';
import { uatFeatureManifest, validateUatFeatureManifest } from '../src/server/reports/uat-feature-manifest';
import { AGENT_MEASUREMENTS } from '../src/lib/agent-measurement-contract.mjs';
import { digest } from '../src/server/reports/contracts';

const config = { project:'hushh-pda-uat', dataset:'analytics_533362555', webHost:'uat.one.hushh.ai', timezone:'UTC',
  startDate:'2026-11-18', endDate:'2026-11-18', maxPeriodDays:7 };

it('binds the approved UAT source, reporting period, definition and catalog', () => {
  const { manifest, manifestDigest } = uatFeatureManifest(config);
  expect(manifest.environment).toBe('uat');
  expect(manifest.report).toBe('one.agent-detail-uat');
  expect(manifest.catalogDigest).toMatch(/^[a-f0-9]{64}$/);
  const altered = structuredClone(AGENT_MEASUREMENTS);
  altered[0].events = [...altered[0].events, 'different_event'];
  expect(digest(altered)).not.toBe(manifest.catalogDefinitionDigest);
  expect(validateUatFeatureManifest(config, manifestDigest).manifest).toEqual(manifest);
  for (const change of [{dataset:'analytics_123'}, {startDate:'2026-11-17'}, {timezone:'Asia/Kolkata'}])
    expect(() => validateUatFeatureManifest({...config, ...change}, manifestDigest)).toThrow();
  expect(() => validateUatFeatureManifest({...config, project:'hushh-ai-prod'}, manifestDigest)).toThrow();
  expect(() => validateUatFeatureManifest(config, '0'.repeat(64))).toThrow();
});
