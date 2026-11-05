import { afterEach, describe, expect, it, vi } from 'vitest';
import { readOneAudience, readUatAudience } from '../src/server/plg/one-audience';
import { signValue } from '../src/server/plg/service';

const now = Date.parse('2026-11-05T12:00:00Z');
const secret = 'fixture-only-uat-directory-key-distinct-32-characters';
const filters = { agentId: 'agent_one', segment: 'all', query: '', graceMinutes: 60 };
const env = { GOOGLE_CLOUD_PROJECT: 'hushh-pda-uat', PLG_UAT_RUNTIME: 'uat',
  PLG_UAT_AUDIENCE_ENABLED: 'true', PLG_UAT_AUDIENCE_SECRET: secret };
const fixture = () => ({
  version: 2, environment: 'uat', customerReporting: false, deliveryAuthorized: false,
  source: 'firebase_registered_accounts', traversal: 'live', campaignEnrollmentChanged: false,
  asOf: new Date(now).toISOString(), windowStart: new Date(now - 7 * 86_400_000).toISOString(),
  graceMinutes: 60, scanned: 1, excluded: 0, nextCursor: null,
  catalog: { revision: 'a'.repeat(64), agents: [{ id: 'agent_one', label: 'One', public: true, available: true }],
    actions: [{ id: 'agent:agent_one', agentId: 'agent_one', label: 'One', kind: 'agent', proof: 'execution_observed' }] },
  rows: [{ accountId: 'uat-team-member', agentId: 'agent_one',
    identity: { name: 'UAT Member', email: 'fixture@hushh.ai', emailVerified: true, phoneNumber: null,
      phoneVerified: false, source: 'canonical', updatedAt: null, passwordHash: 'PRIVATE_PROVIDER_FIELD' },
    activity: { mode: 'best_effort', coverage: 'not_started', counts: { started: 0, returned: 0,
      failed: 0, cancelled: 0, blocked: 0, possibleIncomplete: 0, inProgress: 0, uncorrelated: 0, otherObservations: 0 },
      collectionStartedAt: null, firstAttemptAt: null, lastObservedAt: null, lastReturnedAt: null,
      lastFailureAt: null, lastActionId: null },
    verified: { supported: false, count: 0, lastAt: null, limited: false } }],
});

afterEach(() => vi.unstubAllEnvs());
describe('Isolated UAT people directory', () => {
  it('allows an explicit hosted UAT view without using Production credentials or joining Production data', async () => {
    const hosted = { ...env, GOOGLE_CLOUD_PROJECT: 'hushh-ai-prod', PLG_UAT_RUNTIME: '',
      PLG_UAT_VIEW_ENABLED: 'true', PLG_PUBLIC_ORIGIN: 'https://metrics.hussh.ai',
      PLG_FIRESTORE_PROJECT: 'hushh-ai-prod', PLG_FIRESTORE_DATABASE: 'one-plg-production',
      PLG_ONE_SOURCE_SECRET: 'different-production-source-key', PLG_ONE_AUDIENCE_SECRET: 'different-production-directory-key' };
    const fetcher = vi.fn(async (url, init) => {
      expect(url).toBe('https://api.uat.hushh.ai/api/one/plg/audience-uat');
      expect(init.headers['X-PLG-Signature']).toBe(signValue(`audience-uat\n${now}\n${init.body}`, secret));
      return Response.json(fixture());
    });
    const result = await readUatAudience(filters, hosted, fetcher as typeof fetch, now);
    expect(result.environment).toBe('uat');
    expect(result.rows[0]).not.toHaveProperty('campaignContactId');
    expect(fetcher).toHaveBeenCalledOnce();
    fetcher.mockClear();
    for (const changed of [
      { PLG_UAT_VIEW_ENABLED: 'false' }, { GOOGLE_CLOUD_PROJECT: 'hushh-pda-dev' },
      { PLG_PUBLIC_ORIGIN: 'https://metrics.hussh.ai.evil.test' }, { PLG_FIRESTORE_DATABASE: 'other' },
      { PLG_UAT_RUNTIME: 'uat' }, { PLG_DEV_RUNTIME: 'dev' }, { PLG_ONE_SOURCE_SECRET: secret },
      { PLG_ONE_AUDIENCE_SECRET: secret }, { PLG_ONE_SUBSCRIPTION_SECRET: secret },
    ]) await expect(readUatAudience(filters, { ...hosted, ...changed }, fetcher, now)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('pins the UAT host/purpose, preserves unknown coverage and strips provider fields', async () => {
    const fetcher = vi.fn(async (url, init) => {
      expect(url).toBe('https://api.uat.hushh.ai/api/one/plg/audience-uat');
      expect(init.redirect).toBe('error');
      expect(init.headers['X-PLG-Signature']).toBe(signValue(`audience-uat\n${now}\n${init.body}`, secret));
      return Response.json(fixture());
    });
    const result = await readUatAudience(filters, env, fetcher as typeof fetch, now);
    expect(result).toMatchObject({ version: 2, environment: 'uat', customerReporting: false, deliveryAuthorized: false });
    expect(result.rows[0].activity.coverage).toBe('not_started');
    expect(JSON.stringify(result)).not.toContain('PRIVATE_PROVIDER_FIELD');
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('rejects disabled, mixed project, production source/store and borrowed keys before fetching', async () => {
    const fetcher = vi.fn();
    for (const changed of [
      { GOOGLE_CLOUD_PROJECT: 'hushh-ai-prod' }, { PLG_UAT_RUNTIME: '' }, { PLG_DEV_RUNTIME: 'dev' },
      { PLG_UAT_AUDIENCE_ENABLED: 'false' }, { PLG_UAT_AUDIENCE_SECRET: 'short' },
      { PLG_UAT_AUDIENCE_URL: 'https://api.hushh.ai/api/one/plg/audience' },
      { PLG_ONE_AUDIENCE_SECRET: 'production-key' }, { PLG_FIRESTORE_PROJECT: 'hushh-ai-prod' },
      { PLG_UAT_SOURCE_SECRET: secret }, { PLG_ATTEMPT_SOURCE_SECRET: secret },
    ]) await expect(readUatAudience(filters, { ...env, ...changed }, fetcher, now)).rejects.toThrow('unavailable');
    fetcher.mockReset();
    vi.stubEnv('GOOGLE_CLOUD_PROJECT', 'hushh-pda-uat');
    await expect(readOneAudience(filters, { url: 'https://api.hushh.ai/api/one/plg/audience', secret }, fetcher, now)).rejects.toThrow('unavailable');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects production proof, invented delivery authority and invalid activity evidence', async () => {
    const changes: ((source: any) => void)[] = [
      s => { s.environment = 'production'; }, s => { s.version = 1; },
      s => { s.customerReporting = { scope: 'production_registered_contacts', policyRevision: 'a'.repeat(64) }; },
      s => { s.deliveryAuthorized = true; }, s => { delete s.deliveryAuthorized; },
      s => { s.rows[0].activity.counts.possibleIncomplete = 1; },
      s => { s.rows[0].verified.supported = true; }, s => { s.rows[0].agentId = 'agent_email'; },
      s => { s.rows[0].activity.lastActionId = 'unlisted-action'; },
    ];
    for (const change of changes) {
      const source = fixture(); change(source);
      await expect(readUatAudience(filters, env, (async () => Response.json(source)) as typeof fetch, now)).rejects.toThrow('unavailable');
    }
  });
  it('retains continuation and cancels superseded searches without retrying', async () => {
    const source = fixture(); source.rows = []; source.nextCursor = 'page.' + 'a'.repeat(64) as any;
    const result = await readUatAudience(filters, env, (async () => Response.json(source)) as typeof fetch, now);
    expect(result.nextCursor).toBe(source.nextCursor);
    const abort = new AbortController();
    const fetcher = vi.fn(async () => { abort.abort(); return Response.json(source); });
    await expect(readUatAudience(filters, env, fetcher as typeof fetch, now, abort.signal)).rejects.toThrow('unavailable');
    await expect(readUatAudience(filters, env, fetcher as typeof fetch, now, abort.signal)).rejects.toThrow('unavailable');
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
