import { expect, it } from 'vitest';
import { adaptUatFeatureRows } from '../src/server/reports/uat-feature-rows';
const expected={scopeDigest:'a'.repeat(64),period:{startDate:'2026-11-18',endDate:'2026-11-18',timezone:'UTC'}};
const row={featureKey:'daily_signin',accounts:'2',devices:3,signals:4,successes:1,expectedErrors:0,failures:1,outcomeSignals:2,eventBreakdown:[{eventName:'auth_completed',signals:4,successes:1,expectedErrors:0,failures:1}]};
it('maps supported UAT aggregates, retaining unknown for missing and separately sourced Location',()=>{
 const detail=adaptUatFeatureRows([row,{...row,featureKey:'sms_safety'}],expected);
 expect(detail.rows.find(x=>x.key==='daily_signin')).toMatchObject({state:'measured',counts:{accounts:2,devices:3,signals:4}});
 expect(detail.rows.find(x=>x.key==='sms_safety')).toMatchObject({state:'unavailable',counts:null});
 expect(detail.rows.find(x=>x.key==='inbox_viewed')).toMatchObject({state:'unavailable',counts:null});
 expect(detail.source).toMatchObject({checkedAt:null,watermark:null,coverage:'intraday_or_unknown'});
});
it('rejects duplicate, incomplete, unsafe or inconsistent aggregate counts',()=>{
 for(const rows of [[row,row],[{...row,signals:undefined}],[{...row,accounts:-1}],[{...row,outcomeSignals:3}],[{...row,eventBreakdown:[]}],[{...row,eventBreakdown:[{...row.eventBreakdown[0],eventName:'unapproved_event'}]}],[{...row,signals:'9007199254740993'}]])
  expect(()=>adaptUatFeatureRows(rows,expected)).toThrow();
});

it('keeps recorded Receipts workspace transitions separate from Inbox and absent rows',()=>{
 const receipt={featureKey:'receipts_workspace_viewed',accounts:1,devices:1,signals:2,successes:0,expectedErrors:0,failures:0,outcomeSignals:0,
  eventBreakdown:[{eventName:'mail_receipts_workspace_viewed',signals:2,successes:0,expectedErrors:0,failures:0}]};
 const result=adaptUatFeatureRows([receipt],expected);
 expect(result.rows.find(x=>x.key==='receipts_workspace_viewed')).toMatchObject({state:'measured',counts:{signals:2}});
 expect(result.rows.find(x=>x.key==='inbox_viewed')).toMatchObject({state:'unavailable',counts:null});
 expect(adaptUatFeatureRows([],expected).rows.find(x=>x.key==='receipts_workspace_viewed')).toMatchObject({state:'unavailable',counts:null});
 expect(()=>adaptUatFeatureRows([{...receipt,eventBreakdown:[{...receipt.eventBreakdown[0],eventName:'one_gmail_inbox_viewed'}]}],expected)).toThrow();
});

it('keeps single-contact Location results from the feature source without inventing older data',()=>{
 const event={eventName:'one_location_sms_contact_add_result',signals:2,successes:1,expectedErrors:0,failures:1};
 const row={featureKey:'sms_contact_add',accounts:1,devices:1,signals:2,successes:1,expectedErrors:0,failures:1,outcomeSignals:2,eventBreakdown:[event]};
 const result=adaptUatFeatureRows([row],expected);
 expect(result.rows.find(x=>x.key==='sms_contact_add')).toMatchObject({state:'measured',counts:{signals:2,failures:1}});
 expect(result.rows.find(x=>x.key==='sms_contact_remove')).toMatchObject({state:'unavailable',counts:null});
});

it('keeps Calendar response observations separate from connection outcomes and email delivery',()=>{
 const event={eventName:'one_calendar_invitation_response',signals:2,successes:0,expectedErrors:0,failures:0};
 const row={featureKey:'calendar_invitation_response',accounts:1,devices:1,signals:2,successes:0,expectedErrors:0,failures:0,outcomeSignals:0,eventBreakdown:[event]};
 const result=adaptUatFeatureRows([row],expected);
 expect(result.rows.find(x=>x.key==='calendar_invitation_response')).toMatchObject({state:'measured',counts:{signals:2,outcomeSignals:0}});
 expect(result.rows.find(x=>x.key==='calendar_connected')).toMatchObject({state:'unavailable',counts:null});
 expect(adaptUatFeatureRows([],expected).rows.find(x=>x.key==='calendar_invitation_response')).toMatchObject({state:'unavailable',counts:null});
});
