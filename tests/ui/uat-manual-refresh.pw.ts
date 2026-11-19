import { test, expect, type Route } from '@playwright/test';

test('hides old UAT data during denied refresh and after date change',async({page})=>{
 const detail={environment:'uat',period:{startDate:'2026-11-18',endDate:'2026-11-18',timezone:'UTC'},rows:[{agent:'location',key:'sos',state:'measured',counts:{signals:7,devices:1}}]};
 let mode:'initial'|'hold'|'late'='initial',held:Route|undefined;const external:string[]=[];
 await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.hostname!=='127.0.0.1' && url.hostname!=='localhost'){external.push(url.origin);return route.abort();}return route.continue();});
 await page.route('**/api/uat-detail-*',async route=>{const url=route.request().url();
  if(url.endsWith('refresh')) {if(mode==='hold'){held=route;return;}return route.fulfill({json:{state:'completed',jobId:null,reportId:'c'.repeat(64)}});}
  if(url.endsWith('read')) {if(mode==='late'){held=route;return;}return route.fulfill({json:{state:'partial',computedAt:1,detail}});}
  return route.fulfill({json:{state:'partial',needsAttention:false}});
 });
 await page.goto('/tests/ui/fixtures/uat-manual/');await page.getByRole('button',{name:'Refresh UAT agent activity'}).click();await expect(page.getByText('7',{exact:true})).toBeVisible();
 mode='hold';held=undefined;await page.getByRole('button',{name:'Refresh UAT agent activity'}).click();await expect(page.getByText('Updating…')).toBeVisible();
 await expect(page.getByText('7',{exact:true})).toHaveCount(0);await expect.poll(()=>!!held).toBe(true);await held!.fulfill({status:403,json:{state:'unauthorized'}});await expect(page.getByText('Report refresh is unavailable.')).toBeVisible();
 mode='late';held=undefined;await page.getByRole('button',{name:'Refresh UAT agent activity'}).click();await expect.poll(()=>held?.request().url().endsWith('detail-read')).toBe(true);
 await page.getByRole('button',{name:'Change date'}).click();await held!.fulfill({json:{state:'partial',computedAt:1,detail}}).catch(()=>{});await expect(page.getByText('7',{exact:true})).toHaveCount(0);expect(external).toEqual([]);
});


test('stops waiting when a manual request does not answer',async({page})=>{
 await page.clock.install();
 await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.hostname!=='127.0.0.1' && url.hostname!=='localhost')return route.abort();return route.continue();});
 let count=0;await page.route('**/api/uat-detail-refresh',async()=>{count++;});
 await page.goto('/tests/ui/fixtures/uat-manual/');await page.getByRole('button',{name:'Refresh UAT agent activity'}).click();
 await expect.poll(()=>count).toBe(1);await page.clock.fastForward(10001);await expect(page.getByText('Report refresh is unavailable.')).toBeVisible();expect(count).toBe(1);
});

test('reload control reads the retained report and starts at most one request in StrictMode',async({page})=>{
 const detail={environment:'uat',period:{startDate:'2026-11-18',endDate:'2026-11-18',timezone:'UTC'},rows:[{agent:'location',key:'sos',state:'measured',counts:{signals:7,devices:1,outcomeSignals:0}}]};
 let posts=0;let held:Route|undefined;
 await page.route('**/*',async route=>{const url=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(url.hostname))return route.abort();return route.continue();});
 await page.route('**/api/uat-detail-read',route=>route.fulfill({json:{state:'partial',computedAt:1,detail}}));
 await page.route('**/api/uat-detail-refresh',route=>{posts++;held=route;});
 await page.goto('/tests/ui/fixtures/uat-manual/reload.html');
 await expect(page.getByText('7',{exact:true})).toBeVisible();await expect.poll(()=>posts).toBe(1);
 await expect(page.getByText('Updating…')).toBeVisible();expect(posts).toBe(1);
 await held!.fulfill({status:403,json:{state:'unauthorized'}});await expect(page.getByText('7',{exact:true})).toHaveCount(0);
});

test('real Dashboard reload is bound to the same authenticated account and starts once',async({page})=>{
 test.skip(process.env.VITE_UAT_RELOAD_REFRESH_ENABLED !== 'true','requires explicit test-only reload build flag');
 let subject='a'.repeat(64),posts=0;const bodies:unknown[]=[],reads:unknown[]=[];
 await page.route('**/*',async route=>{const u=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(u.hostname))return route.abort();
  if(u.pathname==='/api/auth/me')return route.fulfill({json:{authenticated:true,user:{email:'staff@hushh.ai',reloadSubject:subject}}});
  if(u.pathname==='/api/uat-detail-read'){reads.push(route.request().postDataJSON());return route.fulfill({json:{state:'unavailable'}});}
  if(u.pathname==='/api/uat-detail-refresh'){posts++;bodies.push(route.request().postDataJSON());return route.fulfill({json:{state:'accepted',jobId:'b'.repeat(64),reportId:null}});}
  if(u.pathname==='/api/uat-detail-status')return route.fulfill({json:{state:'delayed',needsAttention:true}});
  if(u.pathname.startsWith('/api/'))return route.fulfill({status:503,json:{error:'unavailable'}});return route.continue();});
 await page.goto('/location-analytics/uat');await expect(page.getByText('One Location').first()).toBeVisible();await page.waitForTimeout(500);expect(posts).toBe(0);
 await page.reload();await expect.poll(()=>posts).toBe(1);await page.waitForTimeout(300);expect(posts).toBe(1);
 expect(bodies[0]).toEqual(reads[0]);expect(bodies[0]).toMatchObject({startDate:expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),endDate:expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)});
 subject='c'.repeat(64);await page.reload();await page.waitForTimeout(1000);expect(posts).toBe(1);
});

test('One tab preserves selected UAT dates on reload but not on SPA navigation',async({page})=>{
 test.skip(process.env.VITE_UAT_RELOAD_REFRESH_ENABLED !== 'true','requires explicit test-only reload build flag');
 const posts:unknown[]=[];
 await page.route('**/*',async route=>{const u=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(u.hostname))return route.abort();
  if(u.pathname==='/api/auth/me')return route.fulfill({json:{authenticated:true,publicationAsOf:'2026-11-19T12:00:00Z',user:{email:'staff@hushh.ai',reloadSubject:'a'.repeat(64)}}});
  if(u.pathname==='/api/uat-detail-read')return route.fulfill({json:{state:'unavailable'}});
  if(u.pathname==='/api/uat-detail-refresh'){posts.push(route.request().postDataJSON());return route.fulfill({json:{state:'accepted',jobId:'b'.repeat(64),reportId:null}});}
  if(u.pathname==='/api/uat-detail-status')return route.fulfill({json:{state:'delayed',needsAttention:true}});
  if(u.pathname.startsWith('/api/'))return route.fulfill({status:503,json:{error:'unavailable'}});return route.continue();});
 await page.goto('/');await page.getByRole('button',{name:/One app/}).first().click();await page.getByRole('tab',{name:'Test analytics'}).click();await page.getByRole('button',{name:'7 days',exact:true}).click();
 await page.waitForTimeout(500);expect(posts).toEqual([]);
 await page.evaluate(()=>window.addEventListener('pagehide',()=>{const saved=sessionStorage.getItem('metrics-one-reload-selection-v1');if(saved)localStorage.setItem('test-reload-selection',saved);}));
 await page.reload();await expect.poll(()=>posts.length).toBe(1);
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('test-reload-selection')!));
 expect(posts[0]).toEqual({startDate:saved.range.startDate,endDate:saved.range.endDate});
 expect(posts[0]).toEqual({startDate:'2026-11-13',endDate:'2026-11-19'});
 await page.getByRole('button',{name:/Overview/}).first().click();await page.getByRole('button',{name:/One app/}).first().click();await page.waitForTimeout(300);expect(posts).toHaveLength(1);
});

test('changing environment while reload identity is pending prevents automatic work',async({page})=>{
 test.skip(process.env.VITE_UAT_RELOAD_REFRESH_ENABLED !== 'true','requires explicit test-only reload build flag');
 let posts=0;
 await page.addInitScript(()=>{if(sessionStorage.getItem('test-hold-digest')==='1'){
  const original=crypto.subtle.digest.bind(crypto.subtle);let release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;});(window as any).releaseReloadDigest=release;
  Object.defineProperty(crypto.subtle,'digest',{value:async(...args:Parameters<SubtleCrypto['digest']>)=>{await held;return original(...args);}});
 }});
 await page.route('**/*',async route=>{const u=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(u.hostname))return route.abort();
  if(u.pathname==='/api/auth/me')return route.fulfill({json:{authenticated:true,user:{email:'staff@hushh.ai',reloadSubject:'a'.repeat(64)}}});
  if(u.pathname==='/api/uat-detail-refresh'){posts++;return route.fulfill({json:{state:'accepted',jobId:'b'.repeat(64),reportId:null}});}
  if(u.pathname.startsWith('/api/'))return route.fulfill({status:503,json:{error:'unavailable'}});return route.continue();});
 await page.goto('/');await page.getByRole('button',{name:/One app/}).first().click();await page.getByRole('tab',{name:'Test analytics'}).click();
 await page.waitForTimeout(500);await page.evaluate(()=>sessionStorage.setItem('test-hold-digest','1'));await page.reload();
 await page.getByRole('tab',{name:'Main analytics'}).click();await page.evaluate(()=>(window as any).releaseReloadDigest());await page.waitForTimeout(500);expect(posts).toBe(0);
});

test('legacy Location mount is UAT only and sends selected dates only after a click',async({page})=>{
 const calls:any[]=[];const external:string[]=[];
 await page.route('**/*',async route=>{const url=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(url.hostname)){external.push(url.origin);return route.abort();}return route.continue();});
 await page.route('**/api/uat-detail-refresh',async route=>{calls.push(route.request().postDataJSON());await route.fulfill({status:403,json:{state:'unauthorized'}});});
 await page.goto('/tests/ui/fixtures/uat-manual/legacy.html');await expect(page.getByRole('button',{name:'Refresh UAT agent activity'})).toBeVisible();expect(calls).toEqual([]);
 await page.getByRole('button',{name:'Production',exact:true}).click();await expect(page.getByRole('button',{name:'Refresh UAT agent activity'})).toHaveCount(0);
 await page.getByRole('button',{name:'UAT',exact:true}).click();await page.getByRole('button',{name:'Change date'}).click();await page.getByRole('button',{name:'Refresh UAT agent activity'}).click();
 await expect(page.getByText('Report refresh is unavailable.')).toBeVisible();expect(calls).toEqual([{startDate:'2026-11-19',endDate:'2026-11-19'}]);expect(external).toEqual([]);
});
