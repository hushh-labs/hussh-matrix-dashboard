import { describe, it, expect, vi } from 'vitest';
import { resolveReferralRankings } from '../src/server/referrals';
import type { ReferralQuery, ReferralSourcePage } from '../src/lib/referrals';

const query: ReferralQuery = {board:'individual',afterRank:0};
const page: ReferralSourcePage = {state:'available',snapshotId:'c22bf6bb-c6d2-4d87-b2d6-31e17498a2e4',
  snapshotGeneratedAt:'2026-10-19T12:00:00Z',entryCount:21,
  entries:[{rank:1,handle:'Public member',points:730}],nextAfterRank:20};

describe('published referral source selection', () => {
  it('offers both sources only when both have stored standings', async () => {
    const result = await resolveReferralRankings(query,async()=>page);
    expect(result.environments).toEqual(['production','uat']);
    expect(result.environment).toBe('production');
  });
  it('automatically selects UAT if production is genuinely empty', async () => {
    const result = await resolveReferralRankings(query,async env=>env==='uat'?page:{...page,entryCount:0,entries:[],nextAfterRank:null});
    expect(result.environment).toBe('uat'); expect(result.environments).toEqual(['uat']);
  });
  it('never describes an inaccessible environment as empty', async () => {
    const read = vi.fn(async(env:string)=>{if(env==='production') throw new Error('no access');return page;});
    const result = await resolveReferralRankings(query,read);
    expect(result.environment).toBe('uat');
    expect(result.sources[0]).toEqual({environment:'production',state:'unavailable'});
    await expect(resolveReferralRankings({...query,environment:'production'},read)).rejects.toThrow();
    await expect(resolveReferralRankings(query,async()=>{throw new Error('offline');})).rejects.toThrow();
  });
  it('preserves missing and expired snapshots as explicit states', async () => {
    for(const state of ['waiting','expired'] as const) {
      const result=await resolveReferralRankings(query,async()=>({...page,state,entryCount:null,entries:[],nextAfterRank:null}));
      expect(result.state).toBe(state); expect(result.entryCount).toBeNull();
    }
  });
  it('pins only the selected source when browsing later pages',async()=>{
    const read=vi.fn(async()=>page);
    const pinned={...query,environment:'uat' as const,afterRank:20,snapshotId:page.snapshotId!};
    await resolveReferralRankings(pinned,read);
    expect(read).toHaveBeenCalledWith('uat',pinned);
    expect(read).toHaveBeenCalledWith('production',{...query,environment:'uat',snapshotId:undefined});
  });
  it('keeps circles in the app preview state without fabricating standings', async()=>{
    const result=await resolveReferralRankings({...query,board:'circles'},async()=>page);
    expect(result.state).toBe('preview');expect(result.entries).toEqual([]);
    expect(result.entryCount).toBeNull();expect(result.nextAfterRank).toBeNull();
  });
});
