import { digest, ReportError, validateAccess, type ReportAccess } from './contracts';

/** Web-only boundary: the staff session never leaves the web process. */
export async function withCurrentStaff<T>(session:()=>Promise<ReportAccess|null>, call:(access:ReportAccess)=>Promise<T>):Promise<T> {
  const first=await session(); if (!first) throw new ReportError('unauthorized');
  validateAccess(first); const access=Object.freeze({...first});
  const result=await call(access);
  const after=await session(); if (!after) throw new ReportError('unauthorized');
  validateAccess(after); if (digest(after)!==digest(access)) throw new ReportError('unauthorized');
  return result;
}
