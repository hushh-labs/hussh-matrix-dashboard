import { describe, it, expect, vi } from 'vitest';
import { resolveReferralRankings, resolveReferralRankingsForViewer } from '../src/server/referrals';
import { hydrateReferralNames, type DirectoryLookup } from '../src/server/referral-names';
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
  it('keeps empty production separate from populated UAT unless UAT is selected', async () => {
    const result = await resolveReferralRankings(query,async env=>env==='uat'?page:{...page,entryCount:0,entries:[],nextAfterRank:null});
    expect(result.environment).toBe('production'); expect(result.environments).toEqual(['uat']);
    expect(result.entries).toEqual([]); expect(result.entryCount).toBe(0);
    expect((await resolveReferralRankings({...query,environment:'uat'},async()=>page)).environment).toBe('uat');
  });
  it('never describes an inaccessible environment as empty', async () => {
    const read = vi.fn(async(env:string)=>{if(env==='production') throw new Error('no access');return page;});
    await expect(resolveReferralRankings(query,read)).rejects.toThrow();
    const result = await resolveReferralRankings({...query,environment:'uat'},read);
    expect(result.environment).toBe('uat');
    expect(result.sources[0]).toEqual({environment:'production',state:'unavailable'});
    await expect(resolveReferralRankings({...query,environment:'production'},read)).rejects.toThrow();
    await expect(resolveReferralRankings(query,async()=>{throw new Error('offline');})).rejects.toThrow();
  });
  it('binds viewer IDs and identical opaque member IDs to their own environment directory', async () => {
    const directory = (environment: string): DirectoryLookup => async criteria => criteria.email
      ? [{localId:`${environment}-viewer`,email:'viewer@example.invalid',emailVerified:true}]
      : [{localId:'same-member-id',displayName:`${environment} member`}];
    const directories = {production:directory('production'),uat:directory('uat')};
    const read = vi.fn<NonNullable<Parameters<typeof resolveReferralRankingsForViewer>[3]>>(async (environment, _query, viewerId, lookup) => {
      expect(viewerId).toBe(`${environment}-viewer`);
      return hydrateReferralNames({...page,entries:[{rank:1,handle:'Anonymous referrer',points:730,profileUserId:'same-member-id'}]},lookup);
    });
    for (const environment of ['production','uat'] as const) {
      const result = await resolveReferralRankingsForViewer({...query,environment},'viewer@example.invalid',directories,read);
      expect(result.entries[0].handle).toBe(`${environment} member`);
    }
    directories.uat = async () => [];
    const anonymous = await resolveReferralRankingsForViewer({...query,environment:'uat'},'viewer@example.invalid',directories,
      async (_environment,_query,viewerId,lookup) => {
        expect(viewerId).toBeNull();
        return hydrateReferralNames({...page,entries:[{rank:1,handle:'Anonymous referrer',points:730,profileUserId:'same-member-id'}]},lookup);
      });
    expect(anonymous.entries[0].handle).toBe('Anonymous referrer');
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
    expect(read).toHaveBeenCalledWith('production',{...query,environment:'production',snapshotId:undefined});
  });
  it('keeps circles in the app preview state without fabricating standings', async()=>{
    const result=await resolveReferralRankings({...query,board:'circles'},async()=>page);
    expect(result.state).toBe('preview');expect(result.entries).toEqual([]);
    expect(result.entryCount).toBeNull();expect(result.nextAfterRank).toBeNull();
  });
});
