import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { mockDashboard, referrals, referralFixture } from './fixtures';

for (const width of [320,390,768,1440]) test(`rankings only, pagination and layout at ${width}px`, async ({page}) => {
  await page.setViewportSize({width,height:1000});
  await mockDashboard(page); await page.goto('/');
  await expect(page.locator('.dashboard-page-heading h1')).toHaveText('Founder briefing');
  if (width < 1280) await page.getByRole('button',{name:'Open navigation',exact:true}).click();
  const nav = page.getByRole('navigation',{name:'Dashboard sections'});
  await expect(nav.locator('.sidebar-sub-link')).toHaveText(['One Location','Referrals']);
  await nav.getByRole('button',{name:'Referrals',exact:true}).click();
  await expect(page).toHaveURL(/\/referral-analytics$/);
  await expect(page.getByRole('heading',{name:'Individual rankings'})).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(20);
  await expect(page.getByRole('columnheader')).toHaveText(['Rank','Member','Points']);
  await expect(page.getByRole('button',{name:'Previous',exact:true})).toBeDisabled();
  for(const text of ['Accounts who referred','Referred accounts','Qualified referrals','Net points earned','Rewards','Daily referred accounts','Quick guide to the numbers']) {
    await expect(page.getByText(text,{exact:true})).toHaveCount(0);
  }
  await expect(page.getByRole('button',{name:'7 days',exact:true})).toHaveCount(0);
  const nextRequest=page.waitForRequest(req=>req.url().includes('/one/referrals?') && new URL(req.url()).searchParams.get('afterRank')==='20');
  await page.getByRole('button',{name:'Next',exact:true}).click();
  const query=new URL((await nextRequest).url()).searchParams;
  expect(query.get('snapshotId')).toBe(referrals.snapshotId);expect(query.get('environment')).toBe('production');
  await expect(page.locator('tbody tr')).toHaveCount(20);
  await expect(page.locator('tbody tr').first()).toContainText('Member 21');
  await page.getByRole('button',{name:'Next',exact:true}).click();
  await expect(page.locator('tbody tr')).toHaveCount(3);
  await expect(page.getByRole('button',{name:'Next',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Previous',exact:true}).click();
  await expect(page.locator('tbody tr').first()).toContainText('Member 21');
  await page.getByRole('button',{name:'UAT',exact:true}).click();
  await expect(page.getByRole('button',{name:'UAT',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('tbody tr').first()).toContainText('Member 01');
  await expect(page.getByText('Page 1 · 20 per page')).toBeVisible();
  await page.getByRole('tab',{name:'Circles',exact:true}).click();
  await expect(page.getByText('No circle standings yet.')).toBeVisible();
  await expect(page.getByRole('button',{name:'Next',exact:true})).toBeDisabled();
  await page.getByRole('tab',{name:'Individual',exact:true}).click();
  await expect(page.locator('tbody tr')).toHaveCount(20);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
  await mkdir(`.codex/artifacts/ui/${width}`,{recursive:true});
  await page.screenshot({path:`.codex/artifacts/ui/${width}/referral-rankings.png`,fullPage:true});
  await page.reload();
  await expect(page.locator('.dashboard-page-heading h1')).toHaveText('Referrals');
});

test('keeps production selected and UAT explicit when only UAT has standings',async({page})=>{
  await mockDashboard(page);
  await page.route('**/api/analytics/one/referrals?**',route=>{
    const environment=new URL(route.request().url()).searchParams.get('environment');
    const fixture=referralFixture(route.request().url());
    return route.fulfill({json:{...fixture,environments:['uat'],...(environment==='production'?{entries:[],entryCount:0,nextAfterRank:null}:{})}});
  });
  await page.goto('/referral-analytics');
  await expect(page.getByRole('heading',{name:'Individual rankings'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Production',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByText('No individual standings yet.')).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await page.getByRole('button',{name:'UAT',exact:true}).click();
  await expect(page.locator('tbody tr')).toHaveCount(20);
});

test('does not paint a foreign environment response under the selected production tab',async({page})=>{
  await mockDashboard(page);
  await page.route('**/api/analytics/one/referrals?**',route=>route.fulfill({json:{...referrals,environment:'uat'}}));
  await page.goto('/referral-analytics');
  await expect(page.getByRole('button',{name:'Production',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByText('Referral rankings temporarily unavailable.',{exact:true})).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(0);
});

test('distinguishes unavailable, waiting, expired and genuinely empty standings',async({page})=>{
  await mockDashboard(page);
  await page.route('**/api/analytics/one/referrals?**',route=>route.fulfill({status:503,json:{state:'unavailable'}}));
  await page.goto('/referral-analytics');
  await expect(page.getByText('Referral rankings temporarily unavailable.',{exact:true})).toBeVisible();
  await expect(page.getByText('No individual standings yet.')).toHaveCount(0);
  await page.route('**/api/analytics/one/referrals?**',route=>route.fulfill({json:{...referrals,state:'waiting',entries:[],entryCount:null,snapshotId:null,snapshotGeneratedAt:null,nextAfterRank:null}}));
  await page.getByRole('button',{name:'Try again'}).click();
  await expect(page.getByText('Waiting for the first published rankings.')).toBeVisible();
  await page.route('**/api/analytics/one/referrals?**',route=>route.fulfill({json:{...referrals,state:'expired',entries:[],entryCount:null,nextAfterRank:null}}));
  await page.reload();
  await expect(page.getByRole('button',{name:'Load latest rankings'})).toBeVisible();
  await page.route('**/api/analytics/one/referrals?**',route=>route.fulfill({json:{...referrals,entries:[],entryCount:0,nextAfterRank:null}}));
  await page.getByRole('button',{name:'Load latest rankings'}).click();
  await expect(page.getByText('No individual standings yet.')).toBeVisible();
  await expect(page.getByRole('button',{name:'Next',exact:true})).toBeDisabled();
});

test('refresh starts a new snapshot from page one',async({page})=>{
  await mockDashboard(page);await page.goto('/referral-analytics');
  await expect(page.locator('tbody tr')).toHaveCount(20);
  await page.getByRole('button',{name:'Next',exact:true}).click();
  await expect(page.getByText('Page 2 · 20 per page')).toBeVisible();
  const refreshed=page.waitForRequest(req=>req.url().includes('/one/referrals?') && new URL(req.url()).searchParams.get('afterRank')==='0' && !new URL(req.url()).searchParams.has('snapshotId'));
  await page.getByRole('button',{name:/Refresh metrics/}).click();await refreshed;
  await expect(page.getByText('Page 1 · 20 per page')).toBeVisible();
});
