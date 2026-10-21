import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  candidate,
  candidateFromPolicy,
  deliveryPolicy,
  contactStage,
  DAY,
  enroll,
  ingestEnrollment,
  ingestEvent,
  initialPlgState,
  metrics,
  updateContact,
  updateTemplate,
  registerPlgCatalog,
} from '../src/server/plg/engine';
import { FilePlgStore, MemoryPlgStore } from '../src/server/plg/store';
import {
  PlgService,
  preferenceToken,
  tokenContact,
  type PlgRuntime,
} from '../src/server/plg/service';
import type { PlgContact, PlgState, PlgCatalog } from '../src/lib/plg';
import { syncOneEvidence } from '../src/server/plg/one-source';
import { signValue } from '../src/server/plg/service';
import { readOneAudience } from '../src/server/plg/one-audience';
import { automationStatus, runAutomationCycle, setAutomationEnabled } from '../src/server/plg/automation';
import { accountHash } from '../src/server/plg/engine';
import { OneSubscriptions, applySubscription, queueSubscriptionRevocation, syncSubscriptions } from '../src/server/plg/one-subscriptions';
import type { SubscriptionChange } from '../src/server/plg/one-subscriptions';
import { applyDeliveryEvent } from '../src/server/plg/delivery-events';

const NOW = Date.parse('2026-10-19T12:00:00Z');

describe('canonical One subscription projection and send fence', () => {
  const options = { enabled: true, url: 'https://api.hushh.ai/api/one/plg/subscriptions', secret: 'test-only-subscription-key-over-32-characters' };
  const generation = '14dfc8fb-f456-46c2-ae3e-dc51f92a0816';
  const renewed = '24dfc8fb-f456-46c2-ae3e-dc51f92a0816';
  const change = (): SubscriptionChange => ({ accountHash: `sha256:${accountHash('customer-1')}`, revision: 1,
    checkedAt: new Date(NOW).toISOString(), erased: false, enabled: true, eligible: true, generation,
    frequency: 'weekly', chosenAt: new Date(NOW).toISOString(), consentAt: new Date(NOW).toISOString(),
    accountId: 'customer-1', name: 'Customer', email: 'customer@example.invalid', cohort: 'existing' });
  const wire = () => ({ version: 1, environment: 'production', changes: [{ ...change(), disclosureVersion: 'one-email-updates-v1', privateValue: 'PRIVATE' }] });
  const catalog: PlgCatalog = { revision: 'a'.repeat(64), agents: [{ id: 'agent_one', label: 'One', public: true, available: true }], actions: [] };
  const canonicalState = () => { const state = initialPlgState(); registerPlgCatalog(state, catalog); return state; };
  const activeStore = async () => {
    const store = new MemoryPlgStore();
    await store.transaction((s) => {
      registerPlgCatalog(s, catalog);
      applySubscription(s, change(), NOW);
      s.paused = false; s.ready.agent_one = true; s.contacts[0].group = 'treatment';
      s.templates.find((t) => t.journey === 'agent_one' && t.step === 'welcome')!.published = true;
    });
    return store;
  };
  const runtime: PlgRuntime = { enabled: true, deliveryEnabled: true, origin: 'https://metrics.example.invalid',
    admins: new Set(), operators: new Set(), signingSecret: 'test-only-preference-signing-key-over-32-characters',
    webhookSecret: 'configured-for-test', apiKey: 'test-only', from: 'Test <sender@example.invalid>', replyTo: 'reply@example.invalid',
    subscriptions: options };

  it('signs dedicated purposes, bounds the response and imports only validated current identities', async () => {
    const store = new MemoryPlgStore(), purposes: string[] = [];
    await store.transaction((s) => { registerPlgCatalog(s, catalog); });
    const fetcher = vi.fn(async (url: any, init: any) => {
      const purpose = String(url).split('/').at(-1)!; purposes.push(purpose);
      expect(init.redirect).toBe('error');
      expect(init.headers['X-PLG-Signature']).toBe(signValue(`subscriptions.${purpose}\n${NOW}\n${init.body}`, options.secret));
      if (purpose === 'pull') { expect(init.body).toBe('{}'); return Response.json(wire()); }
      expect(JSON.parse(init.body)).toEqual({ changes: [{ accountHash: change().accountHash, revision: 1 }] });
      return Response.json({ received: true });
    });
    const source = new OneSubscriptions(options, fetcher as typeof fetch, () => NOW);
    await syncSubscriptions(store, source, () => NOW);
    expect(purposes).toEqual(['pull', 'ack']);
    const state = await store.read();
    expect(state.contacts[0]).toMatchObject({ accountId: 'customer-1', email: 'customer@example.invalid', permission: { revision: 1, eligible: true } });
    expect(state.contacts[0].firstValueAt).toBeNull();
    expect(state.subscriptionSyncAt).toBe(new Date(NOW).toISOString());
    expect(JSON.stringify(state)).not.toContain('PRIVATE');
    const supplementaryName = wire(); supplementaryName.changes[0].name = '😀'.repeat(60) + '\n';
    const normalized = await new OneSubscriptions(options, (async () => Response.json(supplementaryName)) as typeof fetch, () => NOW).pull();
    expect(normalized[0].name).toBe('😀'.repeat(50));
    for (const origin of ['https://uat.api.hushh.ai', 'https://other.example.invalid', 'http://api.hushh.ai']) {
      const denied = vi.fn();
      await expect(new OneSubscriptions({ ...options, url: `${origin}/api/one/plg/subscriptions` }, denied).pull()).rejects.toThrow('permission');
      expect(denied).not.toHaveBeenCalled();
    }
    for (const mutate of [
      (s: any) => { s.environment = 'uat'; },
      (s: any) => { s.changes[0].accountId = 'different-owner'; },
      (s: any) => { s.changes[0].checkedAt = new Date(NOW - 121_000).toISOString(); },
      (s: any) => { s.changes[0].enabled = false; },
      (s: any) => { s.changes.push(s.changes[0]); },
    ]) {
      const body = wire(); mutate(body);
      await expect(new OneSubscriptions(options, (async () => Response.json(body)) as typeof fetch, () => NOW).pull()).rejects.toThrow('permission');
    }
    await expect(new OneSubscriptions(options, (async () => new Response('x'.repeat(64_001))) as typeof fetch, () => NOW).pull()).rejects.toThrow('permission');
  });
  it('preserves new generations, provider suppression and opt-outs against stale projections', async () => {
    const state = canonicalState(); applySubscription(state, { ...change(), cohort: 'new' }, NOW);
    const c = state.contacts[0];
    c.suppressed = 'unsubscribed'; queueSubscriptionRevocation(state, c);
    applySubscription(state, { ...change(), revision: 2, generation: renewed, checkedAt: new Date(NOW + 1).toISOString() }, NOW);
    expect(c.suppressed).toBeNull();
    expect(c.cohort).toBe('new');
    applySubscription(state, change(), NOW);
    expect(c.permission?.generation).toBe(renewed);
    c.suppressed = 'bounced';
    applySubscription(state, { ...change(), revision: 3, generation, checkedAt: new Date(NOW + 2).toISOString() }, NOW);
    expect(c.suppressed).toBe('bounced');
    updateContact(state, c.id, { unsubscribe: true }, 'operator', NOW);
    expect(c.suppressed).toBe('bounced');
    expect(() => updateContact(state, c.id, { frequency: 'daily' }, 'operator', NOW)).toThrow('One account');
    applySubscription(state, { ...change(), revision: 4, eligible: false }, NOW);
    expect(c.permission?.enabled).toBe(true);
    expect(candidate(state, c, NOW).eligible).toBe(false);
    applySubscription(state, { ...change(), revision: 5, erased: true, enabled: false, eligible: false }, NOW);
    expect(state.contacts).toHaveLength(0);
    expect(state.pendingRevocations).toEqual([]);
    applySubscription(state, { ...change(), revision: 6 }, NOW);
    expect(state.contacts).toHaveLength(0);
  });
  it('replays committed projections after acknowledgement failure and retries durable opt-outs first', async () => {
    const store = await activeStore();
    await store.transaction((s) => { s.contacts[0].suppressed = 'unsubscribed'; queueSubscriptionRevocation(s, s.contacts[0]); });
    const paths: string[] = []; let unavailableAck = true;
    const source = new OneSubscriptions(options, (async (url, init) => {
      const purpose = String(url).split('/').at(-1)!; paths.push(purpose);
      if (purpose === 'revoke') { expect(JSON.parse(init!.body as string)).toEqual({ accountHash: change().accountHash, generation }); return Response.json({ revoked: true }); }
      if (purpose === 'pull') return Response.json(wire());
      if (unavailableAck) throw new Error('PRIVATE');
      return Response.json({ received: true });
    }) as typeof fetch, () => NOW);
    await expect(syncSubscriptions(store, source, () => NOW)).rejects.toThrow('permission');
    expect((await store.read()).pendingRevocations).toEqual([]);
    expect((await store.read()).subscriptionSyncAt).toBeUndefined();
    unavailableAck = false;
    await syncSubscriptions(store, source, () => NOW);
    expect(paths).toEqual(['revoke', 'pull', 'ack', 'pull', 'ack']);
    expect((await store.read()).contacts).toHaveLength(1);
    expect((await store.read()).contacts[0].suppressed).toBe('unsubscribed');
    expect((await store.read()).deliveries).toHaveLength(0);
  });
  it('retains a hash-only fence for a disabled absent account and orders same-revision reconciliation', () => {
    const state = canonicalState();
    applySubscription(state, { ...change(), revision: 2, enabled: false, eligible: false }, NOW);
    applySubscription(state, change(), NOW);
    expect(state.contacts).toHaveLength(0);
    expect(JSON.stringify(state)).not.toContain('customer@example.invalid');
    applySubscription(state, { ...change(), revision: 3, eligible: false }, NOW);
    applySubscription(state, { ...change(), revision: 3, checkedAt: new Date(NOW - 1).toISOString() }, NOW);
    expect(state.contacts).toHaveLength(0);
    applySubscription(state, { ...change(), revision: 3, checkedAt: new Date(NOW + 1).toISOString() }, NOW);
    expect(state.contacts).toHaveLength(1);
  });
  it('preserves a signed provider complaint arriving between unsubscribe and explicit re-opt-in', () => {
    const state = canonicalState(); applySubscription(state, change(), NOW);
    const c = state.contacts[0]; c.suppressed = 'unsubscribed'; queueSubscriptionRevocation(state, c);
    applyDeliveryEvent(state, { type: 'email.complained', data: { to: [c.email] } }, NOW);
    expect(c.suppressed).toBe('complained');
    applySubscription(state, { ...change(), revision: 2, generation: renewed }, NOW);
    expect(c.suppressed).toBe('complained');
    expect(state.pendingRevocations).toEqual([{ accountHash: change().accountHash, generation }]);
  });
  it('reports a fresh-permission outage as a failed cycle without an accepted message or success heartbeat', async () => {
    const store = await activeStore(), transport = vi.fn(async () => 'provider-id');
    await store.transaction((s) => { s.automation = { enabled: true }; });
    const source = new OneSubscriptions(options, (async () => { throw new Error('PRIVATE'); }) as typeof fetch, () => NOW);
    const service = new PlgService(store, runtime, () => NOW, transport, source);
    await expect(runAutomationCycle(service, async () => ({ accounts: 1, imported: 0, erased: 0 }), () => NOW)).rejects.toThrow('did not confirm success');
    const state = await store.read();
    expect(state.automation?.lastCycle?.status).toBe('failed');
    expect(state.automation?.lastSuccessAt).toBeUndefined();
    expect(state.deliveries).toHaveLength(0);
    expect(transport).not.toHaveBeenCalled();
  });
  it('correlates a permanent provider complaint to the reserved address after identity reconciliation', async () => {
    const store = await activeStore();
    const source = new OneSubscriptions(options, (async () => Response.json({ allowed: true, erased: false })) as typeof fetch, () => NOW);
    await new PlgService(store, runtime, () => NOW, async () => 'provider-id', source).run('Automatic cycle');
    await store.transaction((state) => {
      const contact = state.contacts[0];
      contact.email = 'new-address@example.invalid';
      applyDeliveryEvent(state, { type: 'email.complained', data: { email_id: 'provider-id', to: [change().email] } }, NOW);
      expect(contact.suppressed).toBe('complained');
      expect(state.deliveries[0].status).toBe('complained');
    });
  });
  it.each(['revoked', 'outage', 'local_unsubscribe', 'erased', 'allowed'] as const)
    ('checks fresh permission immediately before the provider: %s', async (outcome) => {
      const store = await activeStore(), transport = vi.fn(async (_input: Parameters<import('../src/server/plg/service').PlgTransport>[0]) => 'provider-id');
      const source = new OneSubscriptions(options, (async (url, init) => {
        expect(String(url)).toBe(`${options.url}/check`);
        expect(JSON.parse(init!.body as string)).toMatchObject({ accountId: 'customer-1', generation, revision: 1 });
        if (outcome === 'outage') throw new Error('PRIVATE');
        if (outcome === 'local_unsubscribe') await store.transaction((s) => { s.contacts[0].suppressed = 'unsubscribed'; });
        return Response.json({ allowed: outcome === 'allowed' || outcome === 'local_unsubscribe', erased: outcome === 'erased' });
      }) as typeof fetch, () => NOW);
      const run = new PlgService(store, runtime, () => NOW, transport, source).run('Automatic cycle');
      if (outcome === 'outage') await expect(run).rejects.toThrow('permission');
      else await run;
      expect(transport).toHaveBeenCalledTimes(outcome === 'allowed' ? 1 : 0);
      const state = await store.read();
      expect(state.deliveries).toHaveLength(outcome === 'allowed' ? 1 : 0);
      if (outcome === 'erased') expect(state.contacts).toHaveLength(0);
      if (outcome === 'allowed') expect(transport.mock.calls[0][0].message.text).toContain(`.${generation}.`);
    });
});

describe('production-only private evidence sources', () => {
  it.each(['https://uat.api.hushh.ai', 'https://arbitrary.example.invalid', 'http://api.hushh.ai',
    'https://api.hushh.ai:8443', 'https://api.hushh.ai@uat.example.invalid'])
    ('refuses %s before fetching identities, signing requests or changing stored evidence', async origin => {
      const secret = 'test-only-source-secret-over-32-characters';
      const store = new MemoryPlgStore(), before = await store.read();
      const fetcher = vi.fn(async () => Response.json({environment:'production'}));
      await expect(syncOneEvidence(store,{url:`${origin}/api/one/plg/snapshot`,secret},fetcher as typeof fetch,NOW)).rejects.toThrow('unavailable');
      await expect(readOneAudience({agentId:'agent_one',segment:'all',query:'',graceMinutes:60},
        {url:`${origin}/api/one/plg/audience`,secret},fetcher as typeof fetch,NOW)).rejects.toThrow('unavailable');
      expect(fetcher).not.toHaveBeenCalled();
      expect(await store.read()).toEqual(before);
    });
});

describe('Private One audience contract', () => {
  const filters = { agentId: 'agent_one' as const, segment: 'all' as const, query: '', graceMinutes: 60 };
  const options = { url: 'https://api.hushh.ai/api/one/plg/audience', secret: 'audience-test-key-with-more-than-32-characters' };
  const fixture = () => ({
    version: 1, environment: 'production', source: 'firebase_registered_accounts', traversal: 'live',
    catalog: { revision: 'a'.repeat(64), agents: [{ id: 'agent_one', label: 'One', public: true, available: true }],
      actions: [{ id: 'agent:agent_one', agentId: 'agent_one', label: 'One', kind: 'agent', proof: 'execution_observed' }] },
    asOf: new Date(NOW).toISOString(), windowStart: new Date(NOW - 7 * 86_400_000).toISOString(),
    graceMinutes: 60, scanned: 1, excluded: 0, nextCursor: null, campaignEnrollmentChanged: false,
    rows: [{ accountId: 'phone-only', agentId: 'agent_one',
      identity: { name: null, email: null, emailVerified: false, phoneNumber: '+919876543210', phoneVerified: true, source: 'canonical', updatedAt: null, passwordHash: 'PRIVATE' },
      activity: { coverage: 'observed', mode: 'best_effort', counts: { started: 1, returned: 0, failed: 0, cancelled: 0, blocked: 0,
        possibleIncomplete: 1, inProgress: 0, uncorrelated: 0, otherObservations: 0 },
        collectionStartedAt: new Date(NOW - 86_400_000).toISOString(), firstAttemptAt: new Date(NOW - 7_200_000).toISOString(),
        lastObservedAt: new Date(NOW - 7_200_000).toISOString(), lastReturnedAt: null, lastFailureAt: null, lastActionId: 'agent:agent_one' },
      verified: { supported: false, count: 0, lastAt: null, limited: false } }],
  });
  it('signs only the private audience purpose and projects phone-only accounts without provider fields', async () => {
    const source = fixture();
    const fetcher = (async (_url, init) => {
      const headers = init!.headers as Record<string, string>;
      expect(headers['X-PLG-Signature']).toBe(signValue(`audience\n${NOW}\n${init!.body}`, options.secret));
      return Response.json(source);
    }) as typeof fetch;
    const result = await readOneAudience(filters, options, fetcher, NOW);
    expect(result.rows[0].identity.phoneNumber).toBe('+919876543210');
    expect(result.rows[0].identity.email).toBeNull();
    expect(result.rows[0].activity.counts.possibleIncomplete).toBe(1);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });
  it('rejects foreign ownership, unverified phone, invalid counts and unsupported business completion', async () => {
    const mutations: ((s: ReturnType<typeof fixture>) => void)[] = [
      (s) => { s.rows[0].agentId = 'agent_calendar'; },
      (s) => { s.rows[0].identity.phoneVerified = false; },
      (s) => { s.rows[0].activity.counts.possibleIncomplete = 2; },
      (s) => { s.rows[0].verified.supported = true; },
      (s) => { s.environment = 'uat'; },
    ];
    for (const mutate of mutations) {
      const source = fixture(); mutate(source);
      await expect(readOneAudience(filters, options, (async () => Response.json(source)) as typeof fetch, NOW)).rejects.toThrow('unavailable');
    }
    await expect(readOneAudience(filters, options, (async () => { throw new Error('PRIVATE'); }) as typeof fetch, NOW)).rejects.toThrow('No usage or contact details were inferred');
  });
  it('preserves empty filtered pages and continuation without assuming a total', async () => {
    const source = fixture(); source.rows = []; source.nextCursor = ('a'.repeat(10) + '.' + 'b'.repeat(64)) as any;
    const result = await readOneAudience(filters, options, (async () => Response.json(source)) as typeof fetch, NOW);
    expect(result.rows).toEqual([]); expect(result.nextCursor).toBe(source.nextCursor);
    await expect(readOneAudience({ ...filters, query: 'x'.repeat(101) }, options)).rejects.toThrow('valid audience filters');
  });
  it('accepts authoritative One outcomes and rejects proof belonging to another agent', async () => {
    const source: any = fixture();
    source.catalog.agents[0].outcome = { status: 'supported', proof: 'one.distinct_domain_effects.v1',
      label: 'Distinct verified task outcomes', reason: 'Retained positive domain evidence only.' };
    source.rows[0].verified = { supported: true, proof: 'one.distinct_domain_effects.v1', count: 1,
      lastAt: new Date(NOW).toISOString(), limited: false };
    const result = await readOneAudience(filters, options, (async () => Response.json(source)) as typeof fetch, NOW);
    expect(result.rows[0].verified.count).toBe(1);
    expect(result.catalog.agents[0].outcome?.status).toBe('supported');
    for (const proof of [undefined, 'mail.provider_send.v1', 'execution_observed']) {
      source.rows[0].verified.proof = proof;
      await expect(readOneAudience(filters, options, (async () => Response.json(source)) as typeof fetch, NOW)).rejects.toThrow('unavailable');
    }
  });
  it.each([['agent_email', 'mail.provider_send.v1'], ['agent_personal_information', 'memory.confirmed_save.v1']] as const)
    ('requires explicit proof for a declared %s outcome while preserving its older catalog', async (agentId, proof) => {
      const source: any = fixture(), row = source.rows[0], agent = source.catalog.agents[0], action = source.catalog.actions[0];
      agent.id = row.agentId = action.agentId = agentId;
      row.activity.lastActionId = action.id = `agent:${agentId}`;
      row.verified = { supported: true, count: 0, lastAt: null, limited: false };
      const fetcher = (async () => Response.json(source)) as typeof fetch;
      expect((await readOneAudience({ ...filters, agentId }, options, fetcher, NOW)).rows[0].verified.supported).toBe(true);
      agent.outcome = { status: 'supported', proof, label: 'Confirmed outcome', reason: 'Retained positive domain evidence only.' };
      await expect(readOneAudience({ ...filters, agentId }, options, fetcher, NOW)).rejects.toThrow('unavailable');
      row.verified.proof = proof;
      expect((await readOneAudience({ ...filters, agentId }, options, fetcher, NOW)).rows[0].verified.proof).toBe(proof);
    });
});
const runtime: PlgRuntime = {
  enabled: true,
  deliveryEnabled: true,
  origin: 'https://metrics.example.invalid',
  admins: new Set(['admin@example.invalid']),
  operators: new Set(['operator@example.invalid']),
  signingSecret: 'test-signing-secret-with-more-than-32-characters',
  webhookSecret: 'test-webhook-secret',
  apiKey: 'test-only-provider-key',
  from: 'One <one@example.invalid>',
  replyTo: 'support@example.invalid',
};
function contact(state: PlgState, at = NOW, suffix = '1') {
  const c = enroll(
    state,
    {
      accountId: `account-${suffix}`,
      email: `person-${suffix}@example.invalid`,
      name: 'Test account',
      journey: 'memory',
      cohort: 'existing',
      frequency: 'daily',
      consent: true,
      consentSource: 'Subscriber preference form',
      environment: 'production',
      internal: false,
    },
    'operator',
    at,
  );
  // Individual tests focus on delivery behavior, not assignment distribution.
  c.group = 'treatment';
  return c;
}
function ready(state: PlgState) {
  state.paused = false;
  state.ready.memory = true;
  state.templates.forEach((t) => {
    t.published = true;
  });
}
describe('Server-owned automatic follow-up cycle', () => {
  async function fixture() {
    const store = new MemoryPlgStore();
    await store.transaction((state) => {
      contact(state);
      ready(state);
      setAutomationEnabled(state, true, 'admin', NOW);
    });
    return store;
  }
  it('fails closed on source failure and reports configuration without leaking credentials', async () => {
    const store = await fixture();
    const transport = vi.fn(async () => 'provider-id');
    const service = new PlgService(store, runtime, () => NOW, transport);
    await expect(runAutomationCycle(service, async () => { throw new Error('PRIVATE provider detail'); }, () => NOW)).rejects.toThrow('did not confirm');
    expect(transport).not.toHaveBeenCalled();
    const state = await store.read();
    expect(state.deliveries).toHaveLength(0);
    expect(state.automation?.lastCycle?.status).toBe('failed');
    expect(state.automation?.lastCycle?.sent).toBeNull();
    const status = automationStatus(state, { ...runtime, apiKey: '', from: 'invalid\r\nInjected: value' }, NOW);
    expect(status.sender.configured).toBe(false);
    expect(status.blockers).toContain('Email provider authentication is missing');
    expect(JSON.stringify(status)).not.toContain('PRIVATE');
    expect(JSON.stringify(status)).not.toContain(runtime.apiKey);
    expect(JSON.stringify(status)).not.toContain(runtime.signingSecret);
    const senderOnly = automationStatus(state, { ...runtime, deliveryEnabled: false, apiKey: '', webhookSecret: '' }, NOW);
    expect(senderOnly.sender.configured).toBe(true);
    expect(senderOnly.blockers).toContain('Live email delivery is disabled');
    expect(senderOnly.blockers).toContain('Email provider authentication is missing');
  });
  it('leases concurrent cycles, syncs before sending and fences replayed worker requests', async () => {
    const store = await fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const transport = vi.fn(async () => 'provider-id');
    const service = new PlgService(store, runtime, () => NOW, transport);
    const sync = vi.fn(async () => { await gate; return { accounts: 1, imported: 0, erased: 0, retainedOnly: true }; });
    const cycle = runAutomationCycle(service, sync, () => NOW);
    await vi.waitFor(() => expect(sync).toHaveBeenCalledOnce());
    expect(transport).not.toHaveBeenCalled();
    await expect(runAutomationCycle(service, sync, () => NOW)).rejects.toThrow('Another automatic cycle');
    release();
    expect(await cycle).toMatchObject({ status: 'completed', sent: 1 });
    expect(await runAutomationCycle(service, async () => ({ accounts: 1, imported: 0, erased: 0 }), () => NOW)).toMatchObject({ status: 'completed', sent: 0 });
    expect(transport).toHaveBeenCalledOnce();
    expect((await store.read()).automation?.lastSyncAt).toBe(new Date(NOW).toISOString());
    expect((await store.read()).automation?.lastEvidenceSyncAt).toBe(new Date(NOW).toISOString());
  });
  it('does not promote an empty catalog refresh into evidence-sync proof', async () => {
    const store = new MemoryPlgStore();
    const service = new PlgService(store, { ...runtime, deliveryEnabled: false }, () => NOW);
    await runAutomationCycle(service, async () => ({ accounts: 0, imported: 0, erased: 0, retainedOnly: true }), () => NOW);
    let status = automationStatus(await store.read(), runtime, NOW);
    expect(status.lastSyncAt).toBe(new Date(NOW).toISOString());
    expect(status.lastEvidenceSyncAt).toBeNull();
    await store.transaction((state) => { state.automation!.lastEvidenceSyncAt = new Date(NOW - DAY).toISOString(); });
    await runAutomationCycle(service, async () => ({ accounts: 0, imported: 0, erased: 0, retainedOnly: true }), () => NOW);
    status = automationStatus(await store.read(), runtime, NOW);
    expect(status.lastEvidenceSyncAt).toBe(new Date(NOW - DAY).toISOString());
  });
  it('syncs while paused and recovers expired leases without resending uncertain reservations', async () => {
    const store = await fixture();
    const transport = vi.fn(async () => { throw new Error('ambiguous'); });
    const service = new PlgService(store, runtime, () => NOW, transport);
    const sync = vi.fn(async () => ({ accounts: 1, imported: 0, erased: 0 }));
    await store.transaction((state) => setAutomationEnabled(state, false, 'admin', NOW));
    expect(await runAutomationCycle(service, sync, () => NOW)).toMatchObject({ status: 'blocked', sent: 0 });
    expect(sync).toHaveBeenCalledOnce();
    expect(transport).not.toHaveBeenCalled();
    await store.transaction((state) => {
      setAutomationEnabled(state, true, 'admin', NOW);
      state.automation!.lease = { id: 'crashed-worker', until: new Date(NOW - 1).toISOString() };
    });
    expect(await runAutomationCycle(service, sync, () => NOW)).toMatchObject({ status: 'blocked', uncertain: 1 });
    const state = await store.read();
    expect(candidate(state, state.contacts[0], NOW + 2 * DAY).reason).toContain('Delivery confirmation pending');
    expect(transport).toHaveBeenCalledOnce();
  });
  it('honors a pause arriving during sync and the deadline before reserving a send', async () => {
    const store = await fixture();
    let clock = NOW;
    const transport = vi.fn(async () => 'provider-id');
    const service = new PlgService(store, runtime, () => clock, transport);
    expect(await runAutomationCycle(service, async () => {
      await store.transaction((state) => setAutomationEnabled(state, false, 'admin', clock));
      return { accounts: 1, imported: 0, erased: 0 };
    }, () => clock)).toMatchObject({ status: 'blocked', sent: 0 });
    await store.transaction((state) => setAutomationEnabled(state, true, 'admin', clock));
    await runAutomationCycle(service, async () => { clock += 200_000; return { accounts: 1, imported: 0, erased: 0 }; }, () => clock);
    expect(transport).not.toHaveBeenCalled();
    expect((await store.read()).deliveries).toHaveLength(0);
  });
  it('releases a definitely unsent reservation when a pause arrives before transport', async () => {
    const store = await fixture();
    const read = store.read.bind(store);
    let reads = 0;
    vi.spyOn(store, 'read').mockImplementation(async () => {
      if (++reads === 2) await store.transaction((state) => { state.paused = true; });
      return read();
    });
    const transport = vi.fn(async () => 'provider-id');
    const service = new PlgService(store, runtime, () => NOW, transport);
    expect(await service.run('worker')).toMatchObject({ sent: 0, uncertain: 0 });
    expect(transport).not.toHaveBeenCalled();
    expect((await store.read()).deliveries).toHaveLength(0);
    await store.transaction((state) => { state.paused = false; });
    expect(await service.run('worker')).toMatchObject({ sent: 1, uncertain: 0 });
    expect(transport).toHaveBeenCalledOnce();
  });
  it('reports unknown totals after a partial cycle failure while retaining confirmed delivery evidence', async () => {
    const store = await fixture();
    await store.transaction((state) => { contact(state, NOW, '2'); });
    const transaction = store.transaction.bind(store);
    let failed = false;
    vi.spyOn(store, 'transaction').mockImplementation((fn) => transaction((state) => {
      const count = state.deliveries.length;
      const result = fn(state);
      if (!failed && count === 1 && state.deliveries.length === 2) {
        failed = true;
        throw new Error('Simulated reservation storage failure');
      }
      return result;
    }));
    const transport = vi.fn(async () => 'provider-id');
    const service = new PlgService(store, runtime, () => NOW, transport);
    await expect(runAutomationCycle(service, async () => ({ accounts: 2, imported: 0, erased: 0 }), () => NOW)).rejects.toThrow('did not confirm');
    const state = await store.read();
    expect(transport).toHaveBeenCalledOnce();
    expect(state.deliveries).toHaveLength(1);
    expect(state.deliveries[0].status).toBe('sent');
    expect(state.automation?.lastCycle).toMatchObject({ status: 'failed', accounts: 2, sent: null, uncertain: null });
  });
});
function observe(
  state: PlgState,
  c: PlgContact,
  at = NOW,
  kind = 'observation_completed',
  extra = {},
) {
  return ingestEvent(
    state,
    {
      eventId: `${kind}-${at}-${c.id}`,
      accountId: c.accountId,
      journey: c.journey,
      kind,
      occurredAt: new Date(at).toISOString(),
      environment: 'production',
      internal: false,
      verified: true,
      ...extra,
    },
    NOW,
  );
}

describe('PLG eligibility and measurement', () => {
  it('keeps permanent claims and reservation order when frequency history is compacted', () => {
    const s = initialPlgState(); ready(s);
    const c = contact(s, NOW - 40 * DAY); observe(s, c);
    c.frequency = 'daily';
    c.firstValueAt = new Date(NOW - 30 * DAY).toISOString();
    c.lastValueAt = new Date(NOW - 20 * DAY).toISOString();
    c.valueDays = [c.firstValueAt.slice(0, 10)];
    const history = [
      { step: 'newsletter', days: 35, key: `${c.id}:memory-newsletter:1` },
      { step: 'return', days: 2, key: 'return-earlier-reservation' },
      { step: 'return', days: 8, key: 'return-later-reservation' },
      { step: 'manual', days: 12, key: 'manual:old-global-claim' },
      { step: 'welcome', days: 39, key: `${c.id}:welcome:activation` },
    ] as const;
    s.deliveries = history.map((d) => ({ id: d.key, contactId: c.id, step: d.step,
      templateId: `memory-${d.step}`, key: d.key, createdAt: new Date(NOW - d.days * DAY).toISOString(),
      status: 'sent', subject: '', body: '', ctaLabel: '', ctaUrl: '', providerId: null }));
    const policy = deliveryPolicy(c, s.deliveries);
    const context = { paused: s.paused, catalog: s.catalog, ready: s.ready, templates: s.templates };
    expect(policy.latestPromotions).toHaveLength(3);
    expect(policy.claimedKeys.has(`${c.id}:memory-newsletter:1`)).toBe(true);
    expect(candidateFromPolicy(context, c, policy, NOW)).toMatchObject({ eligible: true, step: 'feedback' });
    // Permanent claims remain authoritative after the 24-hour/seven-day windows.
    const claimed = { ...policy, claimedKeys: new Set([...policy.claimedKeys, `${c.id}:feedback:${c.lastValueAt}`]) };
    expect(candidateFromPolicy(context, c, claimed, NOW)).toMatchObject({ eligible: false, reason: 'This journey step has already been reserved or sent' });
    expect(candidateFromPolicy(context, c, { ...policy, unresolved: true }, NOW).reason).toContain('confirmation pending');
  });
  it('does not mistake a successful task for a complete activity observation', () => {
    const s = initialPlgState();
    ready(s);
    const c = contact(s, NOW - 3 * DAY);
    observe(s, c, NOW - 2 * DAY, 'task_completed', {
      result: 'success',
      deliberate: true,
      actionId: 'completed-task',
    });
    observe(s, c, NOW, 'activity_observed');
    expect(c.telemetryAt).toBe(new Date(NOW).toISOString());
    expect(c.observationAt).toBeUndefined();
    expect(candidate(s, c, NOW).step).not.toBe('repeat');
    observe(s, c, NOW);
    expect(candidate(s, c, NOW).step).toBe('repeat');
  });
  it('starts empty, paused and with unpublished, unverified journeys', () => {
    const s = initialPlgState();
    expect(s.contacts).toEqual([]);
    expect(s.paused).toBe(true);
    expect(s.templates.every((t) => !t.published)).toBe(true);
    expect(s.ready.memory).toBe(false);
  });
  it('never turns absent or stale tracking into inactivity', () => {
    const s = initialPlgState();
    ready(s);
    s.templates
      .filter((t) => ['welcome', 'newsletter'].includes(t.step))
      .forEach((t) => {
        t.published = false;
      });
    const c = contact(s, NOW - 8 * DAY);
    expect(contactStage(c, NOW)).toBe('unknown');
    expect(candidate(s, c, NOW).eligible).toBe(false);
    observe(s, c, NOW - 2 * DAY);
    expect(candidate(s, c, NOW).reason).toContain('stale');
  });
  it('allows subscribed content without asserting inactivity when tracking is unknown', () => {
    const s = initialPlgState();
    ready(s);
    const c = contact(s);
    s.templates.find((t) => t.id === 'memory-welcome')!.published = false;
    const next = candidate(s, c, NOW);
    expect(next).toMatchObject({ eligible: true, stage: 'unknown', step: 'newsletter' });
    expect(metrics(s, NOW).observed).toBe(0);
  });
  it('rejects internal/UAT accounts, duplicate addresses and unsubstantiated permission', () => {
    const s = initialPlgState();
    const c = contact(s);
    expect(() =>
      enroll(
        s,
        { ...c, accountId: 'other', environment: 'production', internal: false },
        'operator',
        NOW,
      ),
    ).toThrow('already enrolled');
    expect(() =>
      enroll(
        s,
        { ...c, email: 'other@example.invalid', environment: 'uat', internal: false },
        'operator',
        NOW,
      ),
    ).toThrow('production');
    expect(() =>
      enroll(
        s,
        {
          ...c,
          accountId: 'other',
          email: 'other@example.invalid',
          environment: 'production',
          internal: false,
          consent: true,
          consentSource: '',
        },
        'operator',
        NOW,
      ),
    ).toThrow('permission');
  });
  it('protects the holdout, preferences, assistance requests and suppression', () => {
    const s = initialPlgState();
    ready(s);
    const c = contact(s);
    observe(s, c);
    c.group = 'control';
    expect(candidate(s, c, NOW).eligible).toBe(false);
    c.group = 'treatment';
    c.frequency = 'updates';
    expect(candidate(s, c, NOW).eligible).toBe(false);
    c.frequency = 'daily';
    c.supportOpen = true;
    expect(candidate(s, c, NOW).eligible).toBe(false);
    c.supportOpen = false;
    c.suppressed = 'unsubscribed';
    expect(candidate(s, c, NOW).eligible).toBe(false);
    c.suppressed = null;
    c.consentAt = null;
    expect(candidate(s, c, NOW).eligible).toBe(false);
  });
  it('counts recorded manual outreach against automated contact limits', () => {
    const s = initialPlgState();
    ready(s);
    const c = contact(s);
    observe(s, c);
    const update = { outreach: { id: 'manual-touch-1', channel: 'whatsapp' } };
    updateContact(s, c.id, update, 'operator', NOW);
    updateContact(s, c.id, update, 'operator', NOW);
    expect(s.deliveries).toHaveLength(1);
    expect(candidate(s, c, NOW).reason).toContain('24 hours');
  });
  it('advances to the due stage rather than replaying old onboarding steps', () => {
    const s = initialPlgState();
    ready(s);
    const c = contact(s, NOW - 4 * DAY);
    observe(s, c);
    expect(candidate(s, c, NOW).step).toBe('help');
    s.deliveries.push({
      id: 'help',
      contactId: c.id,
      templateId: 'memory-help',
      key: `${c.id}:help:activation`,
      step: 'help',
      status: 'sent',
      createdAt: new Date(NOW - 2 * DAY).toISOString(),
      subject: '',
      body: '',
      ctaLabel: '',
      ctaUrl: '',
      providerId: 'p',
    });
    expect(candidate(s, c, NOW).step).toBe('newsletter');
  });
  it('counts verified deliberate completions once across devices and exits activation', () => {
    const s = initialPlgState();
    ready(s);
    const c = contact(s, NOW - 3 * DAY);
    expect(() =>
      observe(s, c, NOW, 'task_completed', {
        result: 'success',
        deliberate: false,
        actionId: 'task-1',
      }),
    ).toThrow('deliberate');
    observe(s, c, NOW, 'task_completed', {
      result: 'success',
      deliberate: true,
      actionId: 'task-1',
    });
    expect(
      observe(s, c, NOW, 'task_completed', {
        result: 'success',
        deliberate: true,
        actionId: 'task-1',
      }).duplicate,
    ).toBe(true);
    expect(metrics(s, NOW).activated).toBe(1);
    expect(candidate(s, c, NOW).step).not.toBe('help');
    expect(c.valueDays).toHaveLength(1);
  });
  it('blocks untrusted journey and old events', () => {
    const s = initialPlgState();
    const c = contact(s);
    expect(() => observe(s, c, NOW - DAY)).toThrow('timestamp');
    expect(() => observe(s, c, NOW, 'task_completed', { environment: 'uat' })).toThrow(
      'production',
    );
    expect(() => observe(s, c, NOW, 'task_completed', { journey: 'mail' })).toThrow('journey');
  });
  it('deduplicates the same completed action under different event IDs', () => {
    const s = initialPlgState();
    const c = contact(s, NOW - DAY);
    observe(s, c, NOW, 'task_completed', {
      result: 'success',
      deliberate: true,
      actionId: 'shared-task',
    });
    expect(
      observe(s, c, NOW, 'task_completed', {
        eventId: 'another-device-event',
        result: 'success',
        deliberate: true,
        actionId: 'shared-task',
      }).duplicate,
    ).toBe(true);
    expect(c.valueDays).toHaveLength(1);
  });
  it('accepts idempotent signed-source signup enrollment without inventing activity', () => {
    const s = initialPlgState();
    const input = {
      eventId: 'signup-1',
      occurredAt: new Date(NOW).toISOString(),
      accountId: 'new-product-account',
      email: 'new@example.invalid',
      journey: 'memory',
      cohort: 'new',
      consent: false,
      environment: 'production',
      internal: false,
    };
    expect(ingestEnrollment(s, input, NOW).duplicate).toBe(false);
    expect(ingestEnrollment(s, input, NOW).duplicate).toBe(true);
    expect(s.contacts).toHaveLength(1);
    expect(s.contacts[0].telemetryAt).toBeNull();
    expect(s.contacts[0].consentAt).toBeNull();
  });
  it('allows reviewed demo links while rejecting unapproved content destinations', () => {
    const s = initialPlgState();
    const template = {
      subject: 'Demo',
      body: 'Try this task',
      ctaLabel: 'Open One',
      ctaUrl: 'https://one.hushh.ai/',
      published: true,
      resourceUrl: 'https://youtu.be/approved-demo',
    };
    expect(updateTemplate(s, 'memory-demo', template, 'admin', NOW).resourceUrl).toBe(
      template.resourceUrl,
    );
    expect(() =>
      updateTemplate(
        s,
        'memory-demo',
        { ...template, resourceUrl: 'https://one.hushh.ai.evil.invalid/video' },
        'admin',
        NOW,
      ),
    ).toThrow('approved');
  });
  it('keeps immature retention unavailable and measures completed UTC cohorts', () => {
    const s = initialPlgState();
    const c = contact(s, NOW - 20 * DAY);
    c.firstValueAt = new Date(NOW - 16 * DAY).toISOString();
    c.lastValueAt = new Date(NOW - 5 * DAY).toISOString();
    c.valueDays = [c.firstValueAt.slice(0, 10), c.lastValueAt.slice(0, 10)];
    const young = contact(s, NOW, '2');
    young.firstValueAt = new Date(NOW).toISOString();
    expect(metrics(s, NOW)).toMatchObject({
      enrolled: 2,
      activationEligible: 1,
      activationConverted: 1,
      retentionEligible: 1,
      retained: 1,
    });
  });
  it('restricts action URLs and does not let operator updates invent product milestones', () => {
    const s = initialPlgState();
    const c = contact(s);
    updateContact(s, c.id, { firstValueAt: new Date(NOW).toISOString() }, 'operator', NOW);
    expect(c.firstValueAt).toBeNull();
    expect(() =>
      updateTemplate(
        s,
        'memory-demo',
        {
          subject: 'Demo',
          body: 'Task',
          ctaLabel: 'Open',
          ctaUrl: 'https://evil.invalid/',
          published: true,
        },
        'admin',
        NOW,
      ),
    ).toThrow('one.hushh.ai');
  });
});

describe('One retained task evidence bridge', () => {
  const catalog: PlgCatalog = {
    revision: 'a'.repeat(64),
    agents: [
      { id: 'agent_one', label: 'One', public: true, available: true },
      { id: 'agent_calendar', label: 'Calendar', public: true, available: true },
      { id: 'agent_email', label: 'Mail', public: true, available: true },
    ],
    actions: [{ id: 'calendar.event.create', agentId: 'agent_calendar', label: 'Create event', kind: 'action', proof: 'client_reported' }],
  };
  function v2Source(change: (body: any) => void = () => {}): typeof fetch {
    return (async (_url, init) => {
      const requested = JSON.parse(init!.body as string).accounts;
      expect((init!.headers as Record<string, string>)['X-PLG-Version']).toBe('2');
      const at = new Date(NOW).toISOString();
      const result = { version: 2, environment: 'production', retainedOnly: true, asOf: at, catalog,
        accounts: requested.map((c: any) => ({ ...c, deleted: false, tasks: [], verified: [],
          privateContent: 'PRIVATE_ACCOUNT_CONTENT',
          activity: { enabled: true, mode: 'best_effort', limited: false, startedAt: at, epoch: 'b'.repeat(64),
            rollups: [{ actionId: 'calendar.event.create', agentId: 'agent_calendar', source: 'client_reported', phase: 'returned', count: 1, firstAt: at, lastAt: at, days: [at.slice(0, 10)], privateContent: 'PRIVATE_ACTION_CONTENT' }] } })) };
      change(result);
      return new Response(JSON.stringify(result));
    }) as typeof fetch;
  }
  it('discovers agent journeys without enrollment, publishing or enabling delivery', async () => {
    const store = new MemoryPlgStore();
    await syncOneEvidence(store, options, v2Source(), NOW);
    const state = await store.read();
    expect(state.catalog).toEqual(catalog);
    expect(state.contacts).toEqual([]);
    expect(state.ready.agent_calendar).toBe(false);
    expect(state.templates.filter((t) => t.journey === 'agent_calendar').every((t) => !t.published)).toBe(true);
    expect(state.paused).toBe(true);
  });
  it('tracks a new agent without promoting app reports to verified activation and replays compactly', async () => {
    const store = await fixture();
    await store.transaction((s) => { registerPlgCatalog(s, catalog); s.contacts[0].journey = 'agent_calendar'; });
    await syncOneEvidence(store, options, v2Source(), NOW);
    const once = await store.read();
    const c = once.contacts[0];
    expect(() => ingestEvent(once, { eventId: 'forged-calendar-value', accountId: c.accountId,
      journey: c.journey, environment: 'production', internal: false, occurredAt: new Date(NOW).toISOString(),
      kind: 'task_completed', result: 'success', deliberate: true, verified: true, actionId: 'calendar-event' }, NOW)).toThrow('outcome adapter');
    expect(contactStage(c, NOW)).toBe('engaged');
    expect(c.firstValueAt).toBeNull();
    expect(c.observationAt).toBeUndefined();
    expect(metrics(once, NOW)).toMatchObject({ observed: 1, activated: 0, repeat: 0 });
    expect(c.activity?.agents).toMatchObject([{ agentId: 'agent_calendar', reported: 1, executed: 0 }]);
    expect(JSON.stringify(once)).not.toContain('PRIVATE_');
    await syncOneEvidence(store, options, v2Source(), NOW);
    expect(await store.read()).toEqual(once);
    const inspection = await syncOneEvidence(store, options, v2Source(), NOW, c.id);
    expect(inspection.inspection?.activity?.rollups).toHaveLength(1);
    expect(await store.read()).toEqual(once);
    await expect(syncOneEvidence(store, options, fetcher(), NOW)).rejects.toThrow('unavailable');
  });
  it('rejects forged proof, cross-agent action ownership and duplicate groups atomically', async () => {
    for (const corrupt of [
      (r: any) => { r.accounts[0].activity.rollups[0].source = 'execution_observed'; },
      (r: any) => { r.accounts[0].activity.rollups[0].agentId = 'agent_email'; },
      (r: any) => { r.accounts[0].activity.rollups.push(r.accounts[0].activity.rollups[0]); },
      (r: any) => { r.accounts[0].verified = [{ ...r.accounts[0].activity.rollups[0], agentId: 'agent_calendar' }]; },
    ]) {
      const store = await fixture();
      const before = await store.read();
      await expect(syncOneEvidence(store, options, v2Source(corrupt), NOW)).rejects.toThrow('unavailable');
      expect(await store.read()).toEqual(before);
    }
  });
  it('keeps unavailable collection unknown and erases authoritative deletions during inspection', async () => {
    const store = await fixture();
    await syncOneEvidence(store, options, v2Source((r) => { r.accounts[0].activity = { enabled: false, mode: 'best_effort', limited: false, startedAt: null, epoch: null, rollups: [] }; }), NOW);
    let state = await store.read();
    expect(state.contacts[0].firstValueAt).toBeNull();
    const id = state.contacts[0].id;
    const result = await syncOneEvidence(store, options, v2Source((r) => { r.accounts[0] = { ...r.accounts[0], deleted: true, activity: null, verified: [] }; }), NOW, id);
    expect(result.inspection?.deleted).toBe(true);
    state = await store.read();
    expect(state.contacts).toEqual([]);
  });
  const supportedSource = (change: (body: any) => void = () => {}) => v2Source((r) => {
    r.catalog = structuredClone(catalog);
    for (const agent of r.catalog.agents) {
      const proof = ({ agent_one: 'one.distinct_domain_effects.v1', agent_calendar: 'calendar.provider_effect.v1', agent_email: 'mail.provider_send.v1' } as Record<string, string>)[agent.id];
      agent.outcome = { status: 'supported', proof, label: 'Confirmed domain effect', reason: 'Retained positive evidence; missing records do not establish inactivity.' };
    }
    change(r);
  });
  it('activates Calendar from its domain proof while generic completion events stay rejected', async () => {
    const store = await fixture();
    await store.transaction((s) => { registerPlgCatalog(s, catalog); s.contacts[0].journey = 'agent_calendar'; });
    await syncOneEvidence(store, options, supportedSource((r) => {
      r.accounts[0].verified = [{ agentId: 'agent_calendar', proof: 'calendar.provider_effect.v1',
        count: 1, firstAt: new Date(NOW).toISOString(), lastAt: new Date(NOW).toISOString(), days: [new Date(NOW).toISOString().slice(0, 10)] }];
    }), NOW);
    const once = await store.read();
    expect(contactStage(once.contacts[0], NOW)).toBe('activated');
    expect(() => ingestEvent(once, { eventId: 'untrusted-calendar', accountId: once.contacts[0].accountId,
      journey: 'agent_calendar', environment: 'production', internal: false, occurredAt: new Date(NOW).toISOString(),
      kind: 'task_completed', result: 'success', deliberate: true, verified: true, actionId: 'event' }, NOW)).toThrow('outcome adapter');
  });
  it('uses only the authoritative deduplicated One group when all-agent proofs are declared', async () => {
    const store = await fixture();
    await store.transaction((s) => { registerPlgCatalog(s, catalog); s.contacts[0].journey = 'agent_one'; });
    const source = supportedSource((r) => {
      const at = new Date(NOW).toISOString(), earlier = new Date(NOW - 3_600_000).toISOString();
      r.accounts[0].verified = [
        { agentId: 'agent_one', proof: 'one.distinct_domain_effects.v1', count: 1, firstAt: at, lastAt: at, days: [at.slice(0, 10)] },
        { agentId: 'agent_email', proof: 'mail.provider_send.v1', count: 1, firstAt: earlier, lastAt: earlier, days: [earlier.slice(0, 10)] },
      ];
    });
    await syncOneEvidence(store, options, source, NOW);
    const once = await store.read();
    expect(once.contacts[0].firstValueAt).toBe(new Date(NOW).toISOString());
    await syncOneEvidence(store, options, source, NOW);
    expect(await store.read()).toEqual(once);
  });
  it('keeps an explicitly unmeasured One journey unknown while supporting legacy One fallback', async () => {
    for (const legacy of [false, true]) {
      const store = await fixture();
      await store.transaction((s) => { registerPlgCatalog(s, catalog); s.contacts[0].journey = 'agent_one'; });
      await syncOneEvidence(store, options, supportedSource((r) => {
        if (legacy) delete r.catalog.agents[0].outcome;
        else r.catalog.agents[0].outcome = { status: 'unmeasured', proof: null, label: 'Outcome not measured', reason: 'No aggregate proof is declared.' };
        const at = new Date(NOW).toISOString();
        r.accounts[0].verified = [{ agentId: 'agent_email', proof: 'mail.provider_send.v1', count: 1, firstAt: at, lastAt: at, days: [at.slice(0, 10)] }];
      }), NOW);
      expect(Boolean((await store.read()).contacts[0].firstValueAt)).toBe(legacy);
    }
  });
  it('rejects missing, unknown, cross-agent and duplicate outcome proofs without a partial import', async () => {
    for (const mutate of [
      (r: any) => { delete r.accounts[0].verified[0].proof; },
      (r: any) => { r.accounts[0].verified[0].proof = 'client_reported'; },
      (r: any) => { r.accounts[0].verified[0].proof = 'mail.provider_send.v1'; },
      (r: any) => { r.accounts[0].verified[0].agentId = 'agent_email'; delete r.accounts[0].verified[0].proof; },
      (r: any) => { r.accounts[0].verified.push(r.accounts[0].verified[0]); },
      (r: any) => { r.catalog.agents[1].outcome.proof = 'mail.provider_send.v1'; },
      (r: any) => { r.catalog.agents[1].public = false; },
    ]) {
      const store = await fixture(), before = await store.read();
      await expect(syncOneEvidence(store, options, supportedSource((r) => {
        const at = new Date(NOW).toISOString();
        r.accounts[0].verified = [{ agentId: 'agent_calendar', proof: 'calendar.provider_effect.v1', count: 1,
          firstAt: at, lastAt: at, days: [at.slice(0, 10)] }];
        mutate(r);
      }), NOW)).rejects.toThrow('unavailable');
      expect(await store.read()).toEqual(before);
    }
  });
  it('refreshes the request window and clock for a slow multi-batch sync', async () => {
    const store = new MemoryPlgStore();
    await store.transaction((s) => {
      for (let i = 0; i < 21; i++) contact(s, NOW - 10 * DAY, String(i));
    });
    let clock = NOW;
    const source: typeof fetch = (async (_url, init) => {
      const requested = JSON.parse(init!.body as string).accounts;
      expect(requested[0].since).toBe(new Date(clock - 7 * DAY).toISOString());
      const asOf = new Date(clock).toISOString();
      clock += 20_000;
      return new Response(
        JSON.stringify({
          version: 1,
          environment: 'production',
          retainedOnly: true,
          asOf,
          accounts: requested.map((c: object) => ({ ...c, deleted: false, tasks: [] })),
        }),
      );
    }) as typeof fetch;
    expect(
      await syncOneEvidence(
        store,
        {
          url: 'https://api.hushh.ai/api/one/plg/snapshot',
          secret: 'test-only-source-secret-over-32-characters',
        },
        source,
        () => clock,
      ),
    ).toMatchObject({ accounts: 21 });
    expect(clock - NOW).toBe(100_000);
  });
  it('abandons an over-budget sync before changing any account or catalog', async () => {
    const store = new MemoryPlgStore();
    await store.transaction((s) => { for (let i = 0; i < 40; i++) contact(s, NOW - DAY, String(i)); });
    const before = await store.read();
    let clock = NOW;
    const slow = v2Source((r) => { r.asOf = new Date(clock).toISOString(); clock += 20_000; });
    await expect(syncOneEvidence(store, options, slow, () => clock)).rejects.toThrow('unavailable');
    expect(clock - NOW).toBe(140_000);
    expect(await store.read()).toEqual(before);
  });
  const options = {
    url: 'https://api.hushh.ai/api/one/plg/snapshot',
    secret: 'test-only-source-secret-over-32-characters',
  };
  async function fixture() {
    const store = new MemoryPlgStore();
    await store.transaction((s) => contact(s, NOW - DAY));
    return store;
  }
  function fetcher(deleted = false, accountId = 'account-1', tasks = true): typeof fetch {
    return (async (_url, init) => {
      const headers = init!.headers as Record<string, string>;
      expect(headers['X-PLG-Signature']).toBe(
        signValue(`snapshot\n${NOW}\n${init!.body}`, options.secret),
      );
      expect(init!.redirect).toBe('error');
      const requested = JSON.parse(init!.body as string).accounts[0];
      return new Response(
        JSON.stringify({
          version: 1,
          environment: 'production',
          retainedOnly: true,
          asOf: new Date(NOW).toISOString(),
          accounts: [
            {
              ...requested,
              accountId,
              deleted,
              tasks:
                deleted || !tasks
                  ? []
                  : [
                      {
                        actionId: 'a'.repeat(64),
                        occurredAt: new Date(NOW).toISOString(),
                        privateContent: 'must never persist',
                      },
                    ],
            },
          ],
        }),
      );
    }) as typeof fetch;
  }
  it('signs exact bodies, imports only metadata, and safely replays positive task outcomes', async () => {
    const store = await fixture();
    expect(await syncOneEvidence(store, options, fetcher(), NOW)).toMatchObject({ imported: 1 });
    expect(await syncOneEvidence(store, options, fetcher(), NOW)).toMatchObject({ imported: 0 });
    expect(
      await syncOneEvidence(store, options, fetcher(false, 'account-1', false), NOW),
    ).toMatchObject({ imported: 0 });
    const state = await store.read();
    expect(state.contacts[0].firstValueAt).toBe(new Date(NOW).toISOString());
    expect(state.contacts[0].observationAt).toBeUndefined();
    expect(JSON.stringify(state)).not.toContain('must never persist');
  });
  it.each(['unsubscribe', 'revision', 'deletion'] as const)
    ('fences in-flight positive evidence after %s while still applying authoritative erasure', async (change) => {
      const store = await fixture();
      await store.transaction((s) => {
        s.contacts[0].permission = { revision: 1, generation: '14dfc8fb-f456-46c2-ae3e-dc51f92a0816',
          enabled: true, eligible: true, checkedAt: new Date(NOW).toISOString() };
      });
      const source: typeof fetch = async (url, init) => {
        await store.transaction((s) => {
          if (change === 'revision') s.contacts[0].permission!.revision = 2;
          else s.contacts[0].suppressed = 'unsubscribed';
        });
        return fetcher(change === 'deletion')(url, init);
      };
      const result = await syncOneEvidence(store, options, source, NOW);
      const state = await store.read();
      expect(result.imported).toBe(0);
      if (change === 'deletion') expect(state.contacts).toHaveLength(0);
      else expect(state.contacts[0].firstValueAt).toBeNull();
    });
  it('erases contact records and blocks delayed re-enrollment after authoritative deletion', async () => {
    const store = await fixture();
    await store.transaction((state) => {
      state.eventIds.push('event:signup:account-1:person-1@example.invalid');
    });
    await syncOneEvidence(store, options, fetcher(), NOW);
    expect(await syncOneEvidence(store, options, fetcher(true), NOW)).toMatchObject({ erased: 1 });
    const state = await store.read();
    expect(state.contacts).toEqual([]);
    expect(state.deliveries).toEqual([]);
    expect(JSON.stringify(state)).not.toContain('person-1@example.invalid');
    expect(JSON.stringify(state)).not.toContain('account-1');
    expect(
      ingestEvent(state, { eventId: 'signup:account-1:person-1@example.invalid' }, NOW).duplicate,
    ).toBe(true);
    expect(() => contact(state, NOW)).toThrow('erased');
  });
  it('rejects an unexpected account or source failure without committing partial activity', async () => {
    const store = await fixture();
    await expect(
      syncOneEvidence(store, options, fetcher(false, 'different-account'), NOW),
    ).rejects.toThrow('unavailable');
    await expect(
      syncOneEvidence(
        store,
        options,
        (async () => new Response('private diagnostics', { status: 503 })) as typeof fetch,
        NOW,
      ),
    ).rejects.toThrow('unavailable');
    expect((await store.read()).contacts[0].telemetryAt).toBeNull();
    await expect(
      syncOneEvidence(
        store,
        { ...options, url: options.url.replace('https:', 'http:') },
        fetcher(),
        NOW,
      ),
    ).rejects.toThrow('unavailable');
  });
});

describe('PLG persistence and delivery safety', () => {
  it('persists local writes across instances and releases the lock after every write', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'plg-test-'));
    try {
      const store = new FilePlgStore(dir);
      await store.transaction((s) => contact(s));
      await store.transaction((s) => {
        s.paused = false;
      });
      expect((await new FilePlgStore(dir).read()).contacts).toHaveLength(1);
      expect((await store.read()).paused).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('rolls back a failed transaction', async () => {
    const store = new MemoryPlgStore();
    await expect(
      store.transaction((s) => {
        contact(s);
        throw new Error('reject');
      }),
    ).rejects.toThrow();
    expect((await store.read()).contacts).toHaveLength(0);
  });
  it('renders previews while paused without reserving or sending anything', async () => {
    const store = new MemoryPlgStore();
    await store.transaction((s) => {
      ready(s);
      const c = contact(s);
      observe(s, c);
      s.paused = true;
    });
    let sent = 0;
    const service = new PlgService(
      store,
      runtime,
      () => NOW,
      async () => {
        sent++;
        return 'id';
      },
    );
    expect((await service.preview()).messages).toHaveLength(1);
    expect(sent).toBe(0);
    expect((await store.read()).deliveries).toHaveLength(0);
  });
  it('prevents parallel workers from sending the same message twice', async () => {
    const store = new MemoryPlgStore();
    await store.transaction((s) => {
      ready(s);
      const c = contact(s);
      observe(s, c);
    });
    let calls = 0;
    const service = new PlgService(
      store,
      runtime,
      () => NOW,
      async () => {
        calls++;
        return 'provider-id';
      },
    );
    await Promise.all([service.run('worker-a'), service.run('worker-b')]);
    expect(calls).toBe(1);
    expect((await store.read()).deliveries).toHaveLength(1);
  });
  it('requires complete delivery configuration and never retries ambiguous sends', async () => {
    const store = new MemoryPlgStore();
    await store.transaction((s) => {
      ready(s);
      const c = contact(s);
      observe(s, c);
    });
    const off = new PlgService(
      store,
      { ...runtime, deliveryEnabled: false },
      () => NOW,
      async () => 'unused',
    );
    await expect(off.run('worker')).rejects.toThrow('disabled');
    let calls = 0;
    const uncertain = new PlgService(
      store,
      runtime,
      () => NOW,
      async () => {
        calls++;
        throw new Error('timeout');
      },
    );
    expect(await uncertain.run('worker')).toMatchObject({ uncertain: 1 });
    await uncertain.run('worker');
    expect(calls).toBe(1);
    expect((await store.read()).deliveries[0].status).toBe('uncertain');
  });
  it('honors the daily and weekly caps including reserved or uncertain emails', async () => {
    const store = new MemoryPlgStore();
    await store.transaction((s) => {
      ready(s);
      const c = contact(s);
      observe(s, c);
    });
    const service = new PlgService(
      store,
      runtime,
      () => NOW,
      async () => 'provider-id',
    );
    await service.run('worker');
    expect((await service.preview()).messages).toHaveLength(0);
    await store.transaction((s) => {
      const c = s.contacts[0];
      c.frequency = 'weekly';
      s.deliveries = [1, 2, 3].map((n) => ({
        ...s.deliveries[0],
        id: `d${n}`,
        createdAt: new Date(NOW - n * DAY).toISOString(),
      }));
    });
    const s = await store.read();
    expect(candidate(s, s.contacts[0], NOW).reason).toContain('Three');
  });
  it('signs opaque preference links and rejects tampered links', () => {
    const id = 'ecf9b4ac-3018-443c-907c-a13cf55c4882';
    const token = preferenceToken(id, runtime.signingSecret);
    expect(tokenContact(token, runtime.signingSecret)).toBe(id);
    expect(() => tokenContact(token.replace('ecf9', 'abcd'), runtime.signingSecret)).toThrow(
      'invalid',
    );
  });
});
