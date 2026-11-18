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

