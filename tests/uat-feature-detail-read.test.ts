import { expect, it, vi } from 'vitest';
import { readUatFeatureDetail } from '../src/server/reports/uat-feature-detail-read';
const job={id:'a'.repeat(64),control:{scopeDigest:'b'.repeat(64)},request:{reportId:'one.agent-detail-uat',startDate:'2026-11-18',endDate:'2026-11-18',timezone:'UTC'}} as any;
const row={featureKey:'daily_signin',accounts:'2',devices:'3',signals:'4',successes:'1',expectedErrors:'0',failures:'1',outcomeSignals:'2',
 eventBreakdown:[{eventName:'auth_completed',signals:'4',successes:'1',expectedErrors:'0',failures:'1'}]};
it('parses a verified feature-only source without inventing Location data',async()=>{
 const native={readVerifiedRows:vi.fn(async()=>[row])} as any;
 const detail=await readUatFeatureDetail(job,native,new AbortController().signal);
 expect(detail.rows.find(r=>r.key==='daily_signin')).toMatchObject({state:'measured',counts:{signals:4},eventBreakdown:[{eventName:'auth_completed',signals:4}]});
 expect(detail.rows.find(r=>r.key==='sms_safety')).toMatchObject({state:'unavailable',counts:null});
 expect(detail.source.watermark).toBeNull();
});
it('rejects wrong report before reading any source',async()=>{
 const native={readVerifiedRows:vi.fn()} as any;
 await expect(readUatFeatureDetail({...job,request:{...job.request,reportId:'one.adoption'}},native,new AbortController().signal)).rejects.toThrow();
 expect(native.readVerifiedRows).not.toHaveBeenCalled();
});
