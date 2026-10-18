import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { mockDashboard, referrals } from './fixtures';

for (const width of [320,390,768,1440]) test(`referral navigation, filters and responsive layout at ${width}px`, async ({page}) => {
  await page.setViewportSize({width,height:1000});
  await mockDashboard(page); await page.goto('/');
  await expect(page.locator('.dashboard-page-heading h1')).toHaveText('Founder briefing');
  if (width < 1280) await page.getByRole('button',{name:'Open navigation',exact:true}).click();
  const nav = page.getByRole('navigation',{name:'Dashboard sections'});
  await expect(nav.locator('.sidebar-sub-link')).toHaveText(['One Location','Referrals']);
  await nav.getByRole('button',{name:'Referrals',exact:true}).click();
  await expect(page).toHaveURL(/\/referral-analytics$/);
  await expect(page.getByRole('heading',{name:'Accounts who referred'})).toBeVisible();
  await expect(page.getByText('1,085',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'UAT',exact:true}).click();
  await expect(page.getByRole('button',{name:'UAT',exact:true})).toHaveAttribute('aria-pressed','true');
  const sevenDayStart = new Date(Date.now()-6*86400000).toISOString().slice(0,10);
  const req = page.waitForRequest(request => request.url().includes('/one/referrals?') && new URL(request.url()).searchParams.get('startDate') === sevenDayStart);
  await page.getByRole('button',{name:'7 days',exact:true}).click(); await req;
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
  await mkdir(`.codex/artifacts/ui/${width}`,{recursive:true});
  await page.screenshot({path:`.codex/artifacts/ui/${width}/referrals.png`,fullPage:true});
  await page.reload();
  await expect(page.locator('.dashboard-page-heading h1')).toHaveText('Referrals');
  await page.goBack();
  await expect(page.locator('.dashboard-page-heading h1')).toHaveText('Founder briefing');
});

test('referrals search, unavailable and genuine zero states',async({page})=>{
  await mockDashboard(page); await page.goto('/');
  await expect(page.locator('.dashboard-page-heading h1')).toHaveText('Founder briefing');
  await page.keyboard.press('Control+k');
  await page.getByRole('searchbox').fill('referrals'); await page.keyboard.press('Enter');
  await expect(page.locator('.dashboard-page-heading h1')).toHaveText('Referrals');
  await page.route('**/api/analytics/one/referrals?**',route=>route.fulfill({status:503,json:{state:'unavailable'}}));
  await page.reload();
  await expect(page.getByText('Referral metrics temporarily unavailable',{exact:true})).toBeVisible();
  await expect(page.getByText('—',{exact:true})).toHaveCount(8);
  await page.route('**/api/analytics/one/referrals?**',route=>route.fulfill({json:{...referrals,
    totals:Object.fromEntries(Object.keys(referrals.totals).map(key=>[key,0])),daily:[],points:[],rewards:[],weeklyAwards:[]}}));
  await page.getByRole('button',{name:'Try again'}).click();
  await expect(page.getByText('No points recorded in these dates.')).toBeVisible();
  await expect(page.getByText('Referral metrics temporarily unavailable',{exact:true})).toHaveCount(0);
});
