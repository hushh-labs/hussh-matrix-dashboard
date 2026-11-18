import { validateOneAgentDetail, type OneAgentDetailV1 } from './one-agent-detail-contract';

/** Pure parser only: callers must independently bind verified native Location
 * query proof and source authority. No sparse row is interpreted as zero. */
export function mergeUatLocationFeatures(input:OneAgentDetailV1, rows:unknown):OneAgentDetailV1 {
  const detail=validateOneAgentDetail(input,{environment:'uat',scopeDigest:input.scopeDigest,period:input.period});
  if (detail.rows.some(row=>row.agent==='location' && row.state!=='unavailable')) throw new Error('Location rows unavailable');
  if (!Array.isArray(rows) || rows.length>=2000 || Buffer.byteLength(JSON.stringify(rows))>700000) throw new Error('Location rows unavailable');
  const allowed=new Set(detail.rows.filter(row=>row.agent==='location').map(row=>row.key)), seen=new Set<string>();
  const number=(v:unknown)=>{ const n=typeof v==='number'?v:typeof v==='string' && /^\d+$/.test(v)?Number(v):NaN;
    if (!Number.isSafeInteger(n) || n<0) throw new Error('Location rows unavailable'); return n; };
  const replacements=new Map<string,OneAgentDetailV1['rows'][number]>();
  for (const row of rows) {
    if (!row || typeof row!=='object' || Array.isArray(row)) throw new Error('Location rows unavailable');
    if (row.scope!=='feature' || !allowed.has(row.metricKey)) continue;
    if (seen.has(row.metricKey)) throw new Error('Location rows unavailable'); seen.add(row.metricKey);
    const devices=number(row.users), signals=number(row.events), successes=number(row.successes),
      expectedErrors=number(row.expectedErrors), failures=number(row.failures), outcomeSignals=successes+expectedErrors+failures;
    if (signals<1 || devices>signals || !Number.isSafeInteger(outcomeSignals) || outcomeSignals>signals) throw new Error('Location rows unavailable');
    replacements.set(row.metricKey,{agent:'location',key:row.metricKey,state:'measured',
      counts:{accounts:null,devices,signals,successes,expectedErrors,failures,outcomeSignals},eventBreakdown:null});
  }
  const result={...detail,rows:detail.rows.map(row=>row.agent==='location'?replacements.get(row.key)??row:row)};
  return validateOneAgentDetail(result,{environment:'uat',scopeDigest:detail.scopeDigest,period:detail.period});
}
