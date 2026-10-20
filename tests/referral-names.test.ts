import {describe,it,expect,vi} from 'vitest';
import {hydrateReferralNames,referralViewer,safeReferralName,type ReferralDirectoryPage} from '../src/server/referral-names';
const anonymous='Anonymous referrer';
const page:ReferralDirectoryPage={state:'available',snapshotId:'snapshot',snapshotGeneratedAt:'2026-10-20T12:00:00Z',
  entryCount:2,nextAfterRank:null,entries:[
    {rank:1,handle:anonymous,points:730,profileUserId:'first-id',profileName:'First Person'},
    {rank:2,handle:anonymous,points:700,profileUserId:'second-id',profileName:null},
  ]};

describe('referral profile names',()=>{
  it('associates unordered Firebase records by UID and strips all private metadata',async()=>{
    const result=await hydrateReferralNames(page,async()=>[
      {localId:'second-id',displayName:'Second Person'},
      {localId:'first-id',displayName:'Provider First'},
    ]);
    expect(result.entries).toEqual([{rank:1,handle:'First Person',points:730},{rank:2,handle:'Second Person',points:700}]);
    expect(JSON.stringify(result)).not.toMatch(/first-id|second-id|profileUserId|profileName/);
  });
  it('keeps aliases first and never fetches profiles denied by SQL visibility',async()=>{
    const lookup=vi.fn(async()=>[]);
    const result=await hydrateReferralNames({...page,entries:[
      {...page.entries[0],handle:'Chosen alias'},
      {...page.entries[1],profileUserId:null,profileName:'Hidden name'},
    ]},lookup);
    expect(lookup).not.toHaveBeenCalled();
    expect(result.entries.map(row=>row.handle)).toEqual(['Chosen alias',anonymous]);
  });
  it('does not reveal cached names for deleted or disabled accounts',async()=>{
    const result=await hydrateReferralNames(page,async()=>[{localId:'first-id',disabled:true,displayName:'Disabled Person'}]);
    expect(result.entries.every(row=>row.handle===anonymous)).toBe(true);
  });
  it('uses a valid provider name for an unnamed legacy profile without using email or phone',async()=>{
    const result=await hydrateReferralNames({...page,entries:[{...page.entries[0],profileName:'first-id'}]},async()=>[
      {localId:'first-id',displayName:'first-id',providerUserInfo:[{displayName:'Actual Person'}]},
    ]);
    expect(result.entries[0].handle).toBe('Actual Person');
    for(const name of ['first-id','ria:123','private@example.com','+91 98765 43210','0123456789abcdef0123456789abcdef','c22bf6bb-c6d2-4d87-b2d6-31e17498a2e4']) expect(safeReferralName(name,'first-id')).toBeNull();
  });
  it('keeps scores available when identity checks fail and ignores unrelated provider records',async()=>{
    const failed=await hydrateReferralNames(page,async()=>{throw new Error('private provider details');});
    expect(failed.entries.map(row=>row.points)).toEqual([730,700]);
    expect(failed.entries.every(row=>row.handle===anonymous)).toBe(true);
    const unrelated=await hydrateReferralNames(page,async()=>[{localId:'unrequested-id',displayName:'Unrelated Person'}]);
    expect(unrelated.entries.every(row=>row.handle===anonymous)).toBe(true);
  });
  it('bounds identity lookups to the current page',async()=>{
    const lookup=vi.fn(async()=>[]);
    await expect(hydrateReferralNames({...page,entries:Array(21).fill(page.entries[0])},lookup)).rejects.toThrow();
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe('verified dashboard viewer mapping',()=>{
  it('uses only the matching, verified and enabled Firebase account',async()=>{
    const lookup=vi.fn(async()=>[{localId:'viewer-id',email:'Person@hushh.ai',emailVerified:true}]);
    expect(await referralViewer('person@hushh.ai',lookup)).toBe('viewer-id');
    expect(lookup).toHaveBeenCalledWith({email:['person@hushh.ai']});
    for(const account of [
      {localId:'viewer-id',email:'person@hushh.ai',emailVerified:false},
      {localId:'viewer-id',email:'person@hushh.ai',emailVerified:true,disabled:true},
      {localId:'viewer-id',email:'different@hushh.ai',emailVerified:true},
    ]) expect(await referralViewer('person@hushh.ai',async()=>[account])).toBeNull();
  });
  it('fails closed for missing, ambiguous or unavailable viewer identities',async()=>{
    expect(await referralViewer('person@hushh.ai',async()=>[])).toBeNull();
    expect(await referralViewer('person@hushh.ai',async()=>{throw new Error('no access');})).toBeNull();
    const account={localId:'viewer-id',email:'person@hushh.ai',emailVerified:true};
    expect(await referralViewer('person@hushh.ai',async()=>[account,account])).toBeNull();
  });
});
