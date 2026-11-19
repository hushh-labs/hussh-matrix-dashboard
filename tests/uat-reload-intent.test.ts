import { expect, it, vi } from 'vitest';
import { uatReloadIntent } from '../src/lib/uat-reload-intent';
import { reloadOwnerDigest, saveReloadSelection, readReloadSelection, clearReloadSelection } from '../src/lib/session-recovery';
import { webcrypto } from 'node:crypto';
import { fetchCurrentUser } from '../src/lib/auth-service';

it('captures only a document reload already selected on One UAT',()=>{
 const dates={startDate:'2026-11-18',endDate:'2026-11-19'};
 expect(uatReloadIntent('reload','one','uat',dates)).toEqual(dates);
 for(const type of ['navigate','back_forward',undefined]) expect(uatReloadIntent(type,'one','uat',dates)).toBeNull();
 expect(uatReloadIntent('reload','growth','uat',dates)).toBeNull();
 expect(uatReloadIntent('reload','one','production',dates)).toBeNull();
});
it('accepts only a valid opaque server session binding',async()=>{
 const binding='a'.repeat(64);vi.stubGlobal('fetch',vi.fn(async()=>Response.json({authenticated:true,user:{email:'staff@hushh.ai',reloadSubject:binding}})));
 try {expect((await fetchCurrentUser())?.sub).toBe(binding);} finally {vi.unstubAllGlobals();}
});
it('binds the saved non-sensitive selection to the current opaque subject',async()=>{
 const values=new Map<string,string>();vi.stubGlobal('sessionStorage',{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)});vi.stubGlobal('crypto',webcrypto);
 try {const first=await reloadOwnerDigest('subject-a'),other=await reloadOwnerDigest('subject-b');expect(first).toBeTruthy();expect(first).not.toBe(other);
  saveReloadSelection({tab:'one',environment:'uat',range:{preset:1,startDate:'2026-11-18',endDate:'2026-11-18'}},first!);
  expect(readReloadSelection()?.ownerDigest).toBe(first);expect(JSON.stringify([...values.values()])).not.toContain('subject-a');clearReloadSelection();expect(readReloadSelection()).toBeNull();
 } finally {vi.unstubAllGlobals();}
});
