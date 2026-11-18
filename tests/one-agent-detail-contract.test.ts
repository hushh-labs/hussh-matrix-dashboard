import { describe, expect, it } from 'vitest';
import { ONE_AGENT_DETAIL_MANIFEST, ONE_AGENT_DETAIL_MANIFEST_DIGEST, validateOneAgentDetail } from '../src/server/reports/one-agent-detail-contract';
const scope = 'a'.repeat(64), period = { startDate:'2026-11-01', endDate:'2026-11-18', timezone:'UTC' };
const counts = { accounts:0, devices:0, signals:0, successes:0, expectedErrors:0, failures:0, outcomeSignals:0 };
const payload = () => ({ version:'1', environment:'uat', scopeDigest:scope, manifestDigest:ONE_AGENT_DETAIL_MANIFEST_DIGEST, period,
  source:{ kind:'ga4_export', coverage:'intraday_or_unknown', watermark:null, checkedAt:'2026-11-19T00:00:00Z' },
  rows:ONE_AGENT_DETAIL_MANIFEST.map(({agent,key}) => ({agent,key,state:'measured',counts:{...counts},eventBreakdown:null})) });
const expected = { environment:'uat' as const, scopeDigest:scope, period };
describe('proposed One agent-detail v1 contract', () => {
  it('accepts all catalogued feature rows, including measured zero and explicit unknown', () => {
    const p = payload(); expect(ONE_AGENT_DETAIL_MANIFEST).toHaveLength(64);
    p.rows[0] = { ...p.rows[0], state:'unavailable', counts:null as any, eventBreakdown:null };
    p.rows[1].counts.accounts = null as any;
    expect(validateOneAgentDetail(p, expected)).toBe(p);
  });
  it('accepts a separately scoped production payload', () => {
    const p = { ...payload(), environment:'production', scopeDigest:'b'.repeat(64) };
    expect(validateOneAgentDetail(p, { ...expected, environment:'production', scopeDigest:'b'.repeat(64) })).toBe(p);
    expect(() => validateOneAgentDetail(p, expected)).toThrow();
  });
  it('rejects missing, duplicate, mismatched and invented agent rows', () => {
    const cases = [() => { const p=payload(); p.rows.pop(); return p; }, () => { const p=payload(); p.rows[1]=p.rows[0]; return p; },
      () => { const p=payload(); p.rows[0].agent='finance'; return p; }, () => { const p=payload(); p.manifestDigest='b'.repeat(64); return p; }];
    for (const make of cases) expect(() => validateOneAgentDetail(make(), expected)).toThrow();
  });
  it('rejects mixed environment, scope, date and unknown-as-zero', () => {
    expect(() => validateOneAgentDetail(payload(), { ...expected, environment:'production' })).toThrow();
    expect(() => validateOneAgentDetail(payload(), { ...expected, scopeDigest:'b'.repeat(64) })).toThrow();
    expect(() => validateOneAgentDetail(payload(), { ...expected, period:{...period,endDate:'2026-11-17'} })).toThrow();
    const p=payload(); p.rows[0].state='unavailable'; expect(() => validateOneAgentDetail(p, expected)).toThrow();
    const q=payload(); q.rows[0].counts.signals=-1; expect(() => validateOneAgentDetail(q, expected)).toThrow();
  });
  it('rejects unsupported finalization claims and invalid source clocks', () => {
    const p=payload(); p.source.coverage='finalized_verified'; expect(() => validateOneAgentDetail(p, expected)).toThrow();
    const q=payload(); q.source.checkedAt='2026-02-30T00:00:00Z'; expect(() => validateOneAgentDetail(q, expected)).toThrow();
    const r=payload(); r.source.watermark='2026-11-19T01:00:00Z' as any; expect(() => validateOneAgentDetail(r, expected)).toThrow();
  });
});
