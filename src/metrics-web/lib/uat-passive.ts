import { GoogleAuth } from 'google-auth-library';
import { currentAccess } from './access';
import { reportFailure } from './http';
import { ReportError } from '../../../src/server/reports/contracts';
import { reportingIdentityHeaders, validateReportWebConfig } from '../../../src/server/reports/web-client';
import { UatDetailWebClient } from '../../../src/server/reports/uat-detail-web-client';
import { readUatManualBody } from '../../../src/server/reports/uat-manual-body';
import { withCurrentStaff } from '../../../src/server/reports/uat-web-session';

/** Read and status use the retained publication only; no source collection. */
export async function uatPassive(request:Request,operation:'read'|'status') {
 try {
  if(process.env.METRICS_UAT_WEB_ENABLED!=='true' || !process.env.METRICS_WEB_ORIGIN || request.headers.get('origin')!==process.env.METRICS_WEB_ORIGIN
   || request.headers.get('content-type')?.split(';')[0]!=='application/json')throw new ReportError('unavailable');
  const signal=AbortSignal.any([request.signal,AbortSignal.timeout(5000)]),input=await readUatManualBody(request,signal);signal.throwIfAborted();
  const client=new UatDetailWebClient(validateReportWebConfig(JSON.parse(process.env.METRICS_UAT_WEB_CONFIG??'')),reportingIdentityHeaders(new GoogleAuth()));
  const result=operation==='read' ? await withCurrentStaff(currentAccess,access=>client.read(input,access,signal))
   : await withCurrentStaff(currentAccess,access=>client.status(String(input),access,signal));
  signal.throwIfAborted();return Response.json(result,{headers:{'Cache-Control':'private, no-store'}});
 }catch(error){return reportFailure(error instanceof SyntaxError?new ReportError('invalid'):error);}
}
