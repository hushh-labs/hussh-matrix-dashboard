import { expect, test } from '@playwright/test';
import { mockDashboard } from './fixtures';

test('a stale hashed chunk returning HTML triggers at most one recovery per entry', async ({ page }) => {
  await mockDashboard(page);
  await page.route('**/assets/Stale-AbCd1234.js', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>SPA fallback</title>' }));
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const modulePath = '/src/lib/stale-chunk-recovery.ts';
    const recovery = await import(/* @vite-ignore */ modulePath);
    let error: unknown;
    try { const stale = '/assets/Stale-AbCd1234.js'; await import(/* @vite-ignore */ stale); } catch (e) { error = e; }
    let reloads = 0;
    const context = { origin: location.origin, entry: `${location.origin}/assets/index-Entry1234.js`, storage: sessionStorage, reload: () => { reloads++; } };
    return { first: recovery.recoverStaleChunk(error, context), second: recovery.recoverStaleChunk(error, context), reloads };
  });
  expect(result).toEqual({ first: true, second: false, reloads: 1 });
});
for (const failTwice of [false, true]) {
  test(`real page reload ${failTwice ? 'stops after a repeated failure' : 'recovers after a stale chunk'}`, async ({ page }) => {
    let imports = 0, navigations = 0;
    await page.route('**/stale-fixture', route => { navigations++; return route.fulfill({ contentType: 'text/html', headers: { 'Cache-Control': 'no-store' }, body: '<!doctype html><body><script type="module" src="/assets/index-Entry1234.js"></script></body>' }); });
    await page.route('**/assets/index-Entry1234.js', route => route.fulfill({ contentType: 'application/javascript', headers: { 'Cache-Control': 'no-store' }, body: `
      import { recoverCurrentStaleChunk } from '/src/lib/stale-chunk-recovery.ts';
      window.addEventListener('vite:preloadError', event => { if (recoverCurrentStaleChunk(event.payload)) event.preventDefault(); });
      try { await import('/assets/Stale-AbCd1234.js'); document.body.dataset.result = 'recovered'; }
      catch (error) { const event = new Event('vite:preloadError', { cancelable: true }); event.payload = error; if (window.dispatchEvent(event)) document.body.dataset.result = 'stopped'; }
    ` }));
    await page.route('**/assets/Stale-AbCd1234.js', route => { imports++; return imports === 1 || failTwice
      ? route.fulfill({ status: 200, contentType: 'text/html', headers: { 'Cache-Control': 'no-store' }, body: '<!doctype html>SPA fallback' })
      : route.fulfill({ contentType: 'application/javascript', headers: { 'Cache-Control': 'no-store' }, body: 'export const ok = true;' }); });
    await page.goto('/stale-fixture');
    await expect(page.locator('body')).toHaveAttribute('data-result', failTwice ? 'stopped' : 'recovered', { timeout: 20_000 });
    expect(navigations).toBe(2); expect(imports).toBe(2);
  });
}
