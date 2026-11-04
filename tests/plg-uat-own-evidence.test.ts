import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readUatOwnEvidence, readUatSessionEvidence } from '../src/server/plg/uat-own-evidence';

const now = Date.parse('2026-10-31T08:00:00Z');
const since = '2026-10-31T07:00:00Z';
const epoch = 'b'.repeat(64);
const scope = { environment: 'uat' as const, authorityScope: 'uat-live-owner' as const,
  accountId: 'uat-owner', journey: 'agent_one', since, readAuthority: 'verified_owner' as const,
  ownerEpoch: epoch, emailHash: 'a'.repeat(64) };
const catalog = { revision: 'c'.repeat(64), agents: [{ id: 'agent_one', label: 'One', public: true, available: true }],
  actions: [{ id: 'agent:agent_one', agentId: 'agent_one', label: 'One', kind: 'agent', proof: 'execution_observed' }] };
const activity = { enabled: true, mode: 'best_effort', limited: false, startedAt: since, epoch,
  rollups: [{ agentId: 'agent_one', actionId: 'agent:agent_one', source: 'execution_observed', phase: 'returned',
    count: 1, firstAt: '2026-10-31T07:30:00Z', lastAt: '2026-10-31T07:30:00Z', days: ['2026-10-31'] }] };

function setup() {
  vi.stubEnv('PLG_UAT_EVIDENCE_ENABLED', 'true');
  vi.stubEnv('PLG_UAT_RUNTIME', 'uat');
  vi.stubEnv('PLG_UAT_IDENTITY_MODE', 'live-signed');
  vi.stubEnv('PLG_UAT_SOURCE_SECRET', 'x'.repeat(40));
  vi.stubEnv('PLG_ONE_SOURCE_SECRET', '');
}
function transport(overrides: { revoked?: boolean; badAction?: boolean } = {}) {
  let permissions = 0;
  return vi.fn(async (input: string | URL | Request) => {
    if (String(input).endsWith('/permission-uat')) {
      permissions++;
      return new Response(JSON.stringify({ environment: 'uat', allowed: !(overrides.revoked && permissions > 1),
        erased: false, deliveryAuthorized: false, ownerEpoch: epoch }));
    }
    return new Response(JSON.stringify({ version: 2, environment: 'uat', retainedOnly: true,
      asOf: new Date(now).toISOString(), catalog, accounts: [{ accountId: scope.accountId,
        journey: scope.journey, since, deleted: false, tasks: [], verified: [],
        activity: overrides.badAction ? { ...activity, rollups: [{ ...activity.rollups[0], actionId: 'unknown' }] } : activity }] }));
  }) as unknown as typeof fetch;
}

afterEach(() => vi.unstubAllEnvs());

describe('UAT own evidence boundary', () => {
  it('uses strict existing catalog/activity validation and current read permission twice', async () => {
    setup();
    const fetcher = transport();
    const result = await readUatOwnEvidence(async () => ({ ...scope }), fetcher, () => now);
    expect(result.environment).toBe('uat');
    expect(result.activity.rollups[0].phase).toBe('returned');
    expect(result.activity.mode).toBe('best_effort');
    expect(result.deliveryAuthorized).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('fails closed for production config, malformed activity and revoked permission', async () => {
    setup();
    const fetcher = transport();
    vi.stubEnv('PLG_ONE_SOURCE_SECRET', 'production-secret');
    await expect(readUatOwnEvidence(async () => ({ ...scope }), fetcher, () => now)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    vi.stubEnv('PLG_ONE_SOURCE_SECRET', '');
    await expect(readUatOwnEvidence(async () => ({ ...scope }), transport({ badAction: true }), () => now)).rejects.toThrow();
    await expect(readUatOwnEvidence(async () => ({ ...scope }), transport({ revoked: true }), () => now)).rejects.toThrow();
  });

  it('binds a signed UAT owner to the Matrix session without any persisted owner store', async () => {
    setup();
    const hash = createHash('sha256').update('tester@hushh.ai').digest('hex');
    vi.stubEnv('PLG_UAT_OWNER_EMAIL_HASHES', hash);
    vi.stubEnv('PLG_FIRESTORE_PROJECT', '');
    vi.stubEnv('PLG_FIRESTORE_DATABASE', '');
    const owner = { environment: 'uat', accountId: scope.accountId, journey: scope.journey,
      since, readAuthority: 'verified_owner', ownerEpoch: epoch, emailHash: hash };
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const target = String(input);
      if (target.endsWith('/owner-uat')) return new Response(JSON.stringify({ environment: 'uat', deliveryAuthorized: false, scope: owner }));
      if (target.endsWith('/permission-uat')) return new Response(JSON.stringify({ environment: 'uat',
        allowed: true, erased: false, deliveryAuthorized: false, ownerEpoch: epoch }));
      const requested = JSON.parse(String(init?.body)).accounts[0];
      return new Response(JSON.stringify({ version: 2, environment: 'uat', retainedOnly: true,
        asOf: new Date(now).toISOString(), catalog, accounts: [{ accountId: requested.accountId,
          journey: requested.journey, since: requested.since, deleted: false, tasks: [], verified: [], activity }] }));
    }) as unknown as typeof fetch;
    const result = await readUatSessionEvidence('Tester@hushh.ai', fetcher, () => now);
    expect(result.activity.rollups).toHaveLength(1);
    expect(result.deliveryAuthorized).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(5);
    await expect(readUatSessionEvidence('other@hushh.ai', fetcher, () => now)).rejects.toThrow();
  });

  it('rejects a reset owner epoch even if both permission reads claim to be allowed', async () => {
    setup();
    const hash = createHash('sha256').update('tester@hushh.ai').digest('hex');
    vi.stubEnv('PLG_UAT_OWNER_EMAIL_HASHES', hash);
    vi.stubEnv('PLG_FIRESTORE_PROJECT', '');
    vi.stubEnv('PLG_FIRESTORE_DATABASE', '');
    let owners = 0;
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const target = String(input);
      if (target.endsWith('/owner-uat')) return new Response(JSON.stringify({ environment: 'uat',
        deliveryAuthorized: false, scope: { environment: 'uat', accountId: scope.accountId,
          journey: scope.journey, since, readAuthority: 'verified_owner',
          ownerEpoch: ++owners === 1 ? epoch : 'c'.repeat(64), emailHash: hash } }));
      if (target.endsWith('/permission-uat')) return new Response(JSON.stringify({ environment: 'uat',
        allowed: true, erased: false, deliveryAuthorized: false, ownerEpoch: epoch }));
      const requested = JSON.parse(String(init?.body)).accounts[0];
      return new Response(JSON.stringify({ version: 2, environment: 'uat', retainedOnly: true,
        asOf: new Date(now).toISOString(), catalog, accounts: [{ accountId: requested.accountId,
          journey: requested.journey, since: requested.since, deleted: false, tasks: [], verified: [], activity }] }));
    }) as unknown as typeof fetch;
    await expect(readUatSessionEvidence('tester@hushh.ai', fetcher, () => now)).rejects.toThrow();
  });
});
