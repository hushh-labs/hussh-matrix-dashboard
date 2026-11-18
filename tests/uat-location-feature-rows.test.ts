import { expect, it } from 'vitest';
import { adaptUatFeatureRows } from '../src/server/reports/uat-feature-rows';
import { mergeUatLocationFeatures } from '../src/server/reports/uat-location-feature-rows';
const expected={scopeDigest:'a'.repeat(64),period:{startDate:'2026-11-18',endDate:'2026-11-18',timezone:'UTC'}};
const source=()=>adaptUatFeatureRows([],expected);
const row={scope:'feature',metricKey:'sms_safety',users:1,events:2,successes:0,expectedErrors:0,failures:1};
it('preserves absent Location as unavailable and records only verified-shaped positive rows',()=>{
 const missing=mergeUatLocationFeatures(source(),[]); expect(missing.rows.find(x=>x.key==='sms_safety')?.state).toBe('unavailable');
 const result=mergeUatLocationFeatures(source(),[row]);
 expect(result.rows.find(x=>x.key==='sms_safety')).toMatchObject({state:'measured',counts:{accounts:null,devices:1,signals:2,failures:1}});
 expect(result.source.watermark).toBeNull();
});
it('rejects duplicate, zero-spined, malformed and previously mixed Location data',()=>{
 for(const rows of [[row,row],[{...row,events:0}],[{...row,users:3}],[{...row,failures:3}]]) expect(()=>mergeUatLocationFeatures(source(),rows)).toThrow();
 expect(()=>mergeUatLocationFeatures(mergeUatLocationFeatures(source(),[row]),[])).toThrow();
});

it('preserves feature-only contact records and rejects a conflicting Location-source row',()=>{
 const event={eventName:'one_location_sms_contact_add_result',signals:2,successes:1,expectedErrors:0,failures:1};
 const detail=adaptUatFeatureRows([{featureKey:'sms_contact_add',accounts:1,devices:1,signals:2,successes:1,expectedErrors:0,failures:1,outcomeSignals:2,eventBreakdown:[event]}],expected);
 expect(mergeUatLocationFeatures(detail,[]).rows.find(x=>x.key==='sms_contact_add')).toMatchObject({state:'measured',counts:{signals:2}});
 expect(()=>mergeUatLocationFeatures(detail,[{...row,metricKey:'sms_contact_add'}])).toThrow();
});
