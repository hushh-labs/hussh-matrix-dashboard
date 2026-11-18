import { AGENT_MEASUREMENTS } from '../../lib/agent-measurement-contract.mjs';
import { ONE_AGENT_DETAIL_MANIFEST, ONE_AGENT_DETAIL_MANIFEST_DIGEST, validateOneAgentDetail } from './one-agent-detail-contract';

export const FEATURE_ONLY_LOCATION_KEYS = new Set(['sms_contact_add','sms_contact_remove']);

/** Aggregate-only feature query rows. Location's UI uses a separate source,
 * so this feature-only result cannot assert Location values or full coverage. */
export function adaptUatFeatureRows(rows:unknown, expected:{scopeDigest:string;period:{startDate:string;endDate:string;timezone:string}}) {
  if (!Array.isArray(rows) || rows.length>=2000) throw new Error('One feature rows unavailable');
  const allowed=new Set(ONE_AGENT_DETAIL_MANIFEST.filter(v=>v.agent!=='location' || FEATURE_ONLY_LOCATION_KEYS.has(v.key)).map(v=>v.key));
  const mapped=new Map<string,{counts:Record<string,number>;eventBreakdown:Array<{eventName:string;signals:number;successes:number;expectedErrors:number;failures:number}>}>();
  const names=['accounts','devices','signals','successes','expectedErrors','failures','outcomeSignals'] as const;
  const number=(v:unknown)=>{
    const n=typeof v==='number' ? v : typeof v==='string' && /^\d+$/.test(v) ? Number(v) : NaN;
    if (!Number.isSafeInteger(n) || n<0) throw new Error('One feature rows unavailable'); return n;
  };
  for (const row of rows) {
    if (!row || typeof row!=='object' || Array.isArray(row) || typeof row.featureKey!=='string') throw new Error('One feature rows unavailable');
    if (!allowed.has(row.featureKey)) continue; // unknown/Location keys do not establish a supported feature metric
    if (mapped.has(row.featureKey)) throw new Error('One feature rows unavailable');
    const value=Object.fromEntries(names.map(name=>[name,number(row[name])]));
    if (value.signals<1 || value.accounts>value.signals || value.devices>value.signals || value.successes+value.expectedErrors+value.failures!==value.outcomeSignals
      || value.outcomeSignals>value.signals) throw new Error('One feature rows unavailable');
    const spec=AGENT_MEASUREMENTS.find(item=>item.key===row.featureKey);
    if (!spec || !Array.isArray(row.eventBreakdown) || row.eventBreakdown.length>256) throw new Error('One feature rows unavailable');
    const eventBreakdown=row.eventBreakdown.map((event:any)=>{
      if (!event || typeof event!=='object' || !spec.events.includes(event.eventName)) throw new Error('One feature rows unavailable');
      return {eventName:event.eventName,signals:number(event.signals),successes:number(event.successes),
        expectedErrors:number(event.expectedErrors),failures:number(event.failures)};
    });
    mapped.set(row.featureKey,{counts:value,eventBreakdown});
  }
  const result={version:'1',environment:'uat',scopeDigest:expected.scopeDigest,manifestDigest:ONE_AGENT_DETAIL_MANIFEST_DIGEST,
    period:expected.period,source:{kind:'ga4_export',coverage:'intraday_or_unknown',checkedAt:null,watermark:null},
    rows:ONE_AGENT_DETAIL_MANIFEST.map(({agent,key})=>mapped.has(key) && (agent!=='location' || FEATURE_ONLY_LOCATION_KEYS.has(key))
      ? {agent,key,state:'measured',counts:mapped.get(key)!.counts,eventBreakdown:mapped.get(key)!.eventBreakdown}
      : {agent,key,state:'unavailable',counts:null,eventBreakdown:null})};
  return validateOneAgentDetail(result,{environment:'uat',scopeDigest:expected.scopeDigest,period:expected.period});
}
