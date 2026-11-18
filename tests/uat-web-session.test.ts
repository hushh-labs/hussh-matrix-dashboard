import { expect,it } from 'vitest';
import { withCurrentStaff } from '../src/server/reports/uat-web-session';
const access={subjectHash:'a'.repeat(64),scopeDigest:'b'.repeat(64)};
it('rechecks session after RPC and sends only immutable scoped access',async()=>{
 let count=0, sent:unknown;
 const result=await withCurrentStaff(async()=>{count++;return {...access};},async value=>{sent=value;expect(Object.isFrozen(value)).toBe(true);return 'ok';});
 expect(result).toBe('ok');expect(count).toBe(2);expect(sent).toEqual(access);
});
it('does not return a result if staff expires or changes during RPC',async()=>{
 for(const after of [null,{...access,subjectHash:'c'.repeat(64)}]) {
  let count=0;await expect(withCurrentStaff(async()=>++count===1?access:after,async()=>42)).rejects.toMatchObject({code:'unauthorized'});
 }
});
