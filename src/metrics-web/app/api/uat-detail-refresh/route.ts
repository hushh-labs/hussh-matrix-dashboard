import { GoogleAuth } from 'google-auth-library';
import { currentAccess } from '../../../lib/access';
import { reportFailure } from '../../../lib/http';
import { ReportError } from '../../../../../src/server/reports/contracts';
import { reportingIdentityHeaders, validateReportWebConfig } from '../../../../../src/server/reports/web-client';
import { UatDetailWebClient } from '../../../../../src/server/reports/uat-detail-web-client';
import { readUatManualBody } from '../../../../../src/server/reports/uat-manual-body';
import { withCurrentStaff } from '../../../../../src/server/reports/uat-web-session';

/** Explicit manual action; disabled unless a separate private endpoint is configured. */
export async function POST(request:Request) {
 try {
  if(process.env.METRICS_UAT_WEB_ENABLED!=='true' || !process.env.METRICS_WEB_ORIGIN || request.headers.get('origin')!==process.env.METRICS_WEB_ORIGIN
    || request.headers.get('content-type')?.split(';')[0]!=='application/json') throw new ReportError('unavailable');
  const signal=AbortSignal.any([request.signal,AbortSignal.timeout(5000)]);
  const input=await readUatManualBody(request,signal);signal.throwIfAborted();
  if(!input || typeof input!=='object' || !('reportId' in input) || input.reportId!=='one.agent-detail-uat')throw new ReportError('invalid');
  const config=validateReportWebConfig(JSON.parse(process.env.METRICS_UAT_WEB_CONFIG??''));
  const client=new UatDetailWebClient(config,reportingIdentityHeaders(new GoogleAuth()));
  const result=await withCurrentStaff(currentAccess,access=>{signal.throwIfAborted();return client.request(input,access,signal);});
  signal.throwIfAborted();
  return Response.json(result,{status:result.state==='completed'?200:202,headers:{'Cache-Control':'private, no-store'}});
 } catch(error) {return reportFailure(error instanceof SyntaxError?new ReportError('invalid'):error);}
}
