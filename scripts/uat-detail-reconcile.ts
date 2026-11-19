import { GoogleAuth } from 'google-auth-library';
import { reportingIdentityHeaders } from '../src/server/reports/web-client';
import { reconcileUatTask } from '../src/server/reports/uat-reconcile-client';

// Explicit single action. ADC must already be the approved dispatcher identity;
// this command does not initiate impersonation or retry an uncertain request.
const args=process.argv.slice(2);
if(args.length!==1 || !/^[a-f0-9]{64}$/.test(args[0])) {console.error('Provide exactly one opaque job ID.');process.exitCode=1;}
else {
 try {const result=await reconcileUatTask(args[0],process.env,reportingIdentityHeaders(new GoogleAuth()));console.log(JSON.stringify(result));}
 catch {console.error('UAT task reconciliation unavailable. Existing uncertainty remains held.');process.exitCode=1;}
}
