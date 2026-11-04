import { createHash, createHmac } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { createUatLiveScopeLoader } from '../src/server/plg/uat-live-owner';
import { createOwnerScopeLoader, ownerActivityConfig } from '../src/server/plg/owner-activity-runtime';
import { readOwnerSnapshot } from '../src/server/plg/owner-snapshot-client.mjs';
import { OneAttemptEmails } from '../src/server/plg/attempt-email-source';
import { attemptRuntime } from '../src/server/plg/attempt-email-routes';

const now = Date.parse('2026-10-31T08:00:00Z');
const emailHash = createHash('sha256').update('tester@hushh.ai').digest('hex');
const scope = { environment: 'uat', accountId: 'uat-owner', emailHash,
  readAuthority: 'verified_owner', ownerEpoch: 'b'.repeat(64),
  since: '2026-10-31T07:00:00Z', journey: 'agent_one' };
function setup() {
  vi.stubEnv('GOOGLE_CLOUD_PROJECT', 'hushh-pda-uat');
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

it('binds Dev reads and delivery to its own project, origin, purpose and cohort', async () => {
  const origin = 'https://consent-protocol-aqahj4iyha-uc.a.run.app';
  vi.stubEnv('GOOGLE_CLOUD_PROJECT', 'hushh-pda-dev');
  vi.stubEnv('PLG_DEV_EVIDENCE_ENABLED', 'true');
  vi.stubEnv('PLG_DEV_RUNTIME', 'dev');
  vi.stubEnv('PLG_DEV_IDENTITY_MODE', 'live-signed');
  vi.stubEnv('PLG_DEV_SOURCE_SECRET', 'd'.repeat(40));
  vi.stubEnv('PLG_DEV_OWNER_EMAIL_HASHES', emailHash);
  expect(ownerActivityConfig('dev').snapshotUrl).toBe(`${origin}/api/one/plg/snapshot-dev`);
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    expect(url).toBe(`${origin}/api/one/plg/owner-dev`);
    expect((init?.headers as Record<string, string>)['X-PLG-Signature']).toBe(createHmac('sha256', 'd'.repeat(40))
      .update(`owner-dev\n${now}\n${init?.body}`).digest('hex'));
    return new Response(JSON.stringify({ environment: 'dev', deliveryAuthorized: false, scope: { ...scope, environment: 'dev' } }));
  }) as typeof fetch;
  const load = createOwnerScopeLoader('dev', 'tester@hushh.ai', fetcher, () => now);
  expect((await load()).authorityScope).toBe('dev-live-owner');
  expect(() => createOwnerScopeLoader('dev', 'other@hushh.ai', fetcher, () => now)).toThrow();
  await expect(readOwnerSnapshot({ environment: 'dev', url: 'https://api.uat.hushh.ai/api/one/plg/snapshot-uat',
    secret: 'd'.repeat(40), loadPermission: vi.fn(), validate: vi.fn() }, fetcher, () => now)).rejects.toThrow();
  vi.stubEnv('PLG_ATTEMPT_EMAIL_ENABLED', 'true');
  vi.stubEnv('PLG_ATTEMPT_ENVIRONMENT', 'dev');
  vi.stubEnv('PLG_ATTEMPT_SOURCE_SECRET', 's'.repeat(40));
  vi.stubEnv('PLG_ATTEMPT_WORKER_SECRET', 'w'.repeat(40));
  expect(attemptRuntime().lane).toBe('dev');
  const worker = new OneAttemptEmails('dev', 's'.repeat(40), async (url, init) => {
    expect(url).toBe(`${origin}/api/one/plg/attempt-email/pull`);
    expect((init?.headers as Record<string, string>)['X-PLG-Signature']).toBe(createHmac('sha256', 's'.repeat(40))
      .update(`attempt-emails.dev.pull\n${now}\n${init?.body}`).digest('hex'));
    return new Response(JSON.stringify({ environment: 'dev', deliveries: [] }));
  }, () => now);
  expect(await worker.pending()).toEqual([]);
  vi.stubEnv('GOOGLE_CLOUD_PROJECT', 'hushh-pda-uat');
  expect(() => ownerActivityConfig('dev')).toThrow();
  expect(() => attemptRuntime()).toThrow();
  vi.stubEnv('GOOGLE_CLOUD_PROJECT', 'hushh-pda-dev');
  vi.stubEnv('PLG_UAT_SOURCE_SECRET', 'd'.repeat(40));
  expect(() => ownerActivityConfig('dev')).toThrow();
  vi.stubEnv('PLG_DEV_SOURCE_SECRET', 's'.repeat(40));
  expect(() => attemptRuntime()).toThrow();
});

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
