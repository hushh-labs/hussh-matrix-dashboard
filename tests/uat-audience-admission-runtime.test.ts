import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { bindUatAudienceStore, uatAudienceAdmissionRuntime } from '../src/server/plg/uat-audience-admission-runtime';
import { reportPath } from '../src/server/reports/store';
import { MemoryReportStore } from './helpers/metrics-report-memory-store';
const project = 'hushh-ai-prod', database = 'metrics-reporting', key = 'k'.repeat(40);
it('fails closed on absent, mismatched or unapproved binding before transaction writes', async () => {
  const base = new MemoryReportStore(), bound = bindUatAudienceStore(base, project, database, key);
  const write = () => bound.transaction(async tx => { tx.set(reportPath('synthetic','one'), { ok:true }); });
  await expect(write()).rejects.toThrow();
  const binding = { approved:true, project, database, keyDigest:createHash('sha256').update(key).digest('hex') };
  for (const changed of [{ ...binding, approved:false }, { ...binding, database:'metrics-other' }, { ...binding, keyDigest:'0'.repeat(64) }]) {
    base.data.set(reportPath('policy','uat-audience-binding'), changed); await expect(write()).rejects.toThrow();
  }
  expect(base.data.has(reportPath('synthetic','one'))).toBe(false);
  base.data.set(reportPath('policy','uat-audience-binding'), binding); await write();
  expect(base.data.get(reportPath('synthetic','one'))).toEqual({ ok:true });
});
it('requires explicit enabled canonical project and database', () => {
  expect(() => uatAudienceAdmissionRuntime({})).toThrow();
  expect(() => uatAudienceAdmissionRuntime({ METRICS_UAT_AUDIENCE_ADMISSION_ENABLED:'true', METRICS_UAT_AUDIENCE_PROJECT:project,
    METRICS_UAT_AUDIENCE_DATABASE:database, METRICS_UAT_AUDIENCE_DIGEST_KEY:key,
    METRICS_REPORTING_PROJECT:'another-project', METRICS_REPORTING_DATABASE:database })).toThrow();
});

it('reuses one client and rejects config changes within a process', () => {
  const env = { METRICS_UAT_AUDIENCE_ADMISSION_ENABLED:'true', METRICS_UAT_AUDIENCE_PROJECT:project,
    METRICS_UAT_AUDIENCE_DATABASE:database, METRICS_UAT_AUDIENCE_DIGEST_KEY:key,
    METRICS_REPORTING_PROJECT:project, METRICS_REPORTING_DATABASE:database };
  let creations = 0; const factory = () => { creations++; return new MemoryReportStore(); };
  const first = uatAudienceAdmissionRuntime(env, factory), second = uatAudienceAdmissionRuntime(env, factory);
  expect(first.store).toBe(second.store); expect(creations).toBe(1);
  expect(() => uatAudienceAdmissionRuntime({ ...env, METRICS_UAT_AUDIENCE_DIGEST_KEY:'z'.repeat(40) }, factory)).toThrow();
  expect(creations).toBe(1);
});
