import { expect, it } from 'vitest';
import { FirestoreQueryBudgetStore } from '../src/server/bigquery-cost-control';
class DB {
 values=new Map<string,any>();
 doc(path:string):any { return {path,collection:(n:string)=>({doc:(id:string)=>this.doc(`${path}/${n}/${id}`)})}; }
 async runTransaction<T>(fn:(tx:any)=>Promise<T>) { const next=new Map(this.values); const tx={
   getAll:async (...refs:any[])=>refs.map(r=>({exists:next.has(r.path),data:()=>next.get(r.path)})),
   set:(r:any,v:any)=>next.set(r.path,v),create:(r:any,v:any)=>{if(next.has(r.path)) throw Error('duplicate');next.set(r.path,v);}};
   const result=await fn(tx); this.values=next; return result;
 }
}
const reservation={id:'metrics_detail_'+'a'.repeat(64),day:'2026-11-19',bytes:100,statements:1,binding:'b'.repeat(64)};
it('binds and confirms a canonical reservation without changing legacy record shape', async()=>{
 const db=new DB(), store=new FirestoreQueryBudgetStore(db as any);
 await store.reserve(reservation); await store.reserve(reservation); await store.confirmBound(reservation);
 expect(db.values.get(`metricsQueryBudgetDays/${reservation.day}`)).toMatchObject({bytes:100,statements:1});
 await expect(store.reserve({...reservation,binding:'c'.repeat(64)})).rejects.toThrow();
 await expect(store.confirmBound({...reservation,binding:'c'.repeat(64)})).rejects.toThrow();
 await expect(store.reserve({...reservation,binding:undefined})).rejects.toThrow();
 const legacy={id:'metrics_legacy',day:reservation.day,bytes:10,statements:1}; await store.reserve(legacy);
 expect(db.values.get(`metricsQueryBudgetDays/${reservation.day}/reservations/metrics_legacy`)).toEqual({bytes:10,statements:1});
 await expect(store.reserve({...legacy,binding:'d'.repeat(64)})).rejects.toThrow();
});
it('rejects missing or malformed bound evidence', async()=>{
 const store=new FirestoreQueryBudgetStore(new DB() as any);
 await expect(store.confirmBound(reservation)).rejects.toThrow();
 await expect(store.confirmBound({...reservation,day:'2026-02-30'})).rejects.toThrow();
 await expect(store.reserve({...reservation,binding:'raw-id'})).rejects.toThrow();
});
