import { digest, ReportError } from './contracts';

/** Separate approval for recovery dispatch; does not authorize collection itself. */
export function validateUatDispatcherPolicy(value:unknown,service:unknown,now:number) {
 if(!value || typeof value!=='object' || Array.isArray(value) || !service || typeof service!=='object')throw new ReportError('unavailable');
 const p=value as Record<string,unknown>,s=service as Record<string,unknown>;
 if(Object.keys(p).sort().join()!=='approved,dispatcher,enabled,expiresAt,serviceDigest'
  || p.approved!==true || p.enabled!==true || !Number.isSafeInteger(p.expiresAt) || (p.expiresAt as number)<=now
  || p.dispatcher!=='metrics-report-dispatcher@hushh-ai-prod.iam.gserviceaccount.com'
  || p.serviceDigest!==digest(s))throw new ReportError('unavailable');
 return Object.freeze({...p});
}
