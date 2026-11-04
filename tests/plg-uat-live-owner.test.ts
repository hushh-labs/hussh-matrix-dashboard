import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { createUatLiveScopeLoader } from '../src/server/plg/uat-live-owner';

const now = Date.parse('2026-10-31T08:00:00Z');
const emailHash = createHash('sha256').update('tester@hushh.ai').digest('hex');
const scope = { environment: 'uat', accountId: 'uat-owner', emailHash,
  generation: '12345678-1234-1234-1234-123456789abc', revision: 1,
  since: '2026-10-31T07:00:00Z', journey: 'agent_one' };
function setup() {
  vi.stubEnv('PLG_UAT_EVIDENCE_ENABLED', 'true');
  vi.stubEnv('PLG_UAT_RUNTIME', 'uat');
  vi.stubEnv('PLG_UAT_IDENTITY_MODE', 'live-signed');
  vi.stubEnv('PLG_UAT_SOURCE_SECRET', 'x'.repeat(40));
  vi.stubEnv('PLG_UAT_OWNER_EMAIL_HASHES', emailHash);
  vi.stubEnv('PLG_ONE_SOURCE_SECRET', '');
  vi.stubEnv('PLG_FIRESTORE_PROJECT', '');
  vi.stubEnv('PLG_FIRESTORE_DATABASE', '');
}
afterEach(() => vi.unstubAllEnvs());

it('binds the signed UAT owner to the session and re-reads current scope', async () => {
  setup();
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ environment: 'uat',
    deliveryAuthorized: false, scope }))) as unknown as typeof fetch;
  const load = createUatLiveScopeLoader('Tester@hushh.ai', fetcher, () => now);
  expect((await load()).accountId).toBe('uat-owner');
  expect((await load()).authorityScope).toBe('uat-live-owner');
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(() => createUatLiveScopeLoader('other@hushh.ai', fetcher, () => now)).toThrow();
});

it('isolates two enrolled team members and refuses a cross-owner response', async () => {
  setup();
  const secondHash = createHash('sha256').update('second@hushh.ai').digest('hex');
  vi.stubEnv('PLG_UAT_OWNER_EMAIL_HASHES', `${emailHash},${secondHash}`);
  const seen: string[] = [];
  const fetcher = vi.fn(async (_url: unknown, init: RequestInit | undefined) => {
    const requested = JSON.parse(String(init?.body)).emailHash;
    seen.push(requested);
    return new Response(JSON.stringify({ environment: 'uat', deliveryAuthorized: false,
      scope: { ...scope, emailHash: requested, accountId: requested === secondHash ? 'second-owner' : 'uat-owner' } }));
  }) as unknown as typeof fetch;
  expect((await createUatLiveScopeLoader('tester@hushh.ai', fetcher, () => now)()).accountId).toBe('uat-owner');
  expect((await createUatLiveScopeLoader('second@hushh.ai', fetcher, () => now)()).accountId).toBe('second-owner');
  expect(seen).toEqual([emailHash, secondHash]);
  const wrongOwner = async () => new Response(JSON.stringify({ environment: 'uat', deliveryAuthorized: false, scope }));
  await expect(createUatLiveScopeLoader('second@hushh.ai', wrongOwner, () => now)()).rejects.toThrow();
  expect(() => createUatLiveScopeLoader('outside@hushh.ai', fetcher, () => now)).toThrow();
});

it('fails closed on revocation, recipient change and production configuration', async () => {
  setup();
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ environment: 'uat',
    deliveryAuthorized: false, scope: null }))) as unknown as typeof fetch;
  await expect(createUatLiveScopeLoader('tester@hushh.ai', fetcher, () => now)()).rejects.toThrow();
  const changed = vi.fn(async () => new Response(JSON.stringify({ environment: 'uat',
    deliveryAuthorized: false, scope: { ...scope, emailHash: 'f'.repeat(64) } }))) as unknown as typeof fetch;
  await expect(createUatLiveScopeLoader('tester@hushh.ai', changed, () => now)()).rejects.toThrow();
  vi.stubEnv('PLG_FIRESTORE_DATABASE', 'one-plg-production');
  expect(() => createUatLiveScopeLoader('tester@hushh.ai', fetcher, () => now)).toThrow();
});

it('pins a bounded window while the source seven-day boundary advances', async () => {
  setup();
  let current = now;
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ environment: 'uat',
    deliveryAuthorized: false, scope: { ...scope, since: new Date(current - 7 * 86_400_000).toISOString() } }))) as unknown as typeof fetch;
  const load = createUatLiveScopeLoader('tester@hushh.ai', fetcher, () => current);
  const first = await load();
  current += 60_000;
  expect((await load()).since).toBe(first.since);
});
