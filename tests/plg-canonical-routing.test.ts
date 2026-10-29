import { describe, expect, it, vi } from 'vitest';
import type { PlgAgentId, PlgCatalog, PlgJourney } from '../src/lib/plg';
import { outcomeProofs } from '../src/lib/plg-outcomes';
import { accountHash, candidate, DAY, ingestEvent, registerPlgCatalog } from '../src/server/plg/engine';
import { OneSubscriptions, syncSubscriptions } from '../src/server/plg/one-subscriptions';
import { syncOneEvidence } from '../src/server/plg/one-source';
import { PlgService, signValue, type PlgRuntime, type PlgTransport } from '../src/server/plg/service';
import { MemoryPlgStore } from '../src/server/plg/store';

const START = Date.parse('2026-10-19T12:00:00Z');
const generation = '14dfc8fb-f456-46c2-ae3e-dc51f92a0816';
const renewed = '24dfc8fb-f456-46c2-ae3e-dc51f92a0816';
const accountId = 'canonical-behavior-1'; // Deterministic treatment allocation; never override the group.
const journeys: [PlgJourney, PlgAgentId][] = [
  ['memory', 'agent_personal_information'], ['mail', 'agent_email'],
  ['agent_calendar', 'agent_calendar'], ['agent_kai', 'agent_kai'],
  ['agent_kyc', 'agent_kyc'], ['agent_location', 'agent_location'],
  ['agent_nav', 'agent_nav'], ['agent_one', 'agent_one'],
];
const catalog: PlgCatalog = {
  revision: 'a'.repeat(64), actions: [],
  agents: journeys.map(([, id]) => ({ id, label: id, public: true, available: true,
    outcome: { status: 'supported', proof: outcomeProofs[id], label: 'Confirmed domain effect',
      reason: 'Positive domain receipts; missing best-effort capture does not establish inactivity.' } })),
};

/** Real subscription/source/service code, synthetic signed HTTP and mock provider only. */
async function fixture() {
  let now = START;
  const clock = () => now, store = new MemoryPlgStore();
  const subscriptions = { enabled: true, url: 'https://api.hushh.ai/api/one/plg/subscriptions',
    secret: 'test-only-canonical-subscription-key-over-32-characters' };
  const snapshot = { url: 'https://api.hushh.ai/api/one/plg/snapshot', secret: 'test-only-canonical-source-key-over-32-characters' };
  let revision = 1, grant = generation, consentAt = new Date(START).toISOString();
  let captureEpoch = 'e'.repeat(64), captureStartedAt = START;
  const checks: Record<string, unknown>[] = [];
  const source = new OneSubscriptions(subscriptions, (async (url, init) => {
    const purpose = String(url).split('/').at(-1)!;
    const headers = init!.headers as Record<string, string>;
    expect(headers['X-PLG-Signature']).toBe(signValue(`subscriptions.${purpose}\n${now}\n${init!.body}`, subscriptions.secret));
    if (purpose === 'check') {
      checks.push(JSON.parse(init!.body as string));
      return Response.json({ allowed: true, erased: false });
    }
    const change = { accountHash: `sha256:${accountHash(accountId)}`, revision, checkedAt: new Date(now).toISOString(),
      erased: false, enabled: true, eligible: true, generation: grant, frequency: 'weekly', consentAt,
      chosenAt: new Date(now).toISOString(), disclosureVersion: 'one-email-updates-v1', accountId,
      email: 'canonical@example.invalid', name: 'Synthetic customer', cohort: 'existing' };
    if (purpose === 'pull') return Response.json({ version: 1, environment: 'production', changes: [change] });
    expect(purpose).toBe('ack');
    expect(JSON.parse(init!.body as string)).toEqual({ changes: [{ accountHash: change.accountHash, revision }] });
    return Response.json({ received: true });
  }) as typeof fetch, clock);
  const transport = vi.fn<PlgTransport>(async () => `fixture-acceptance-${transport.mock.calls.length}`);
  const runtime: PlgRuntime = { enabled: true, deliveryEnabled: true, origin: 'https://metrics.example.invalid',
    admins: new Set(), operators: new Set(), signingSecret: 'test-only-preference-key-over-32-characters',
    webhookSecret: 'test-only', apiKey: 'test-only', from: 'Fixture <sender@example.invalid>',
    replyTo: 'reply@example.invalid', subscriptions };
  const service = new PlgService(store, runtime, clock, transport, source);
  const sync = async (agentId?: string, firstAt = now - 1000, lastAt = firstAt) => {
    await syncSubscriptions(store, source, clock);
    await syncOneEvidence(store, snapshot, (async (_url, init) => {
      expect((init!.headers as Record<string, string>)['X-PLG-Signature'])
        .toBe(signValue(`snapshot\n${now}\n${init!.body}`, snapshot.secret));
      const requested = JSON.parse(init!.body as string).accounts;
      const held = (await store.read()).contacts[0];
      expect(requested).toEqual([{ accountId, journey: 'agent_one', since: new Date(Math.max(START,
        Date.parse(consentAt), Date.parse(held.activity?.startedAt ?? new Date(START).toISOString()), now - 7 * DAY)).toISOString() }]);
      const first = new Date(firstAt).toISOString(), last = new Date(lastAt).toISOString();
      return Response.json({ version: 2, environment: 'production', retainedOnly: true, catalog,
        asOf: new Date(now).toISOString(),
        customerReporting: { scope: 'production_registered_contacts', policyRevision: 'd'.repeat(64) },
        accounts: requested.map((row: any) => ({ ...row, deleted: false, reportingEligible: true, tasks: [],
          activity: { enabled: true, mode: 'best_effort', limited: false, startedAt: new Date(captureStartedAt).toISOString(), epoch: captureEpoch, rollups: [] },
          verified: agentId ? [{ agentId, proof: outcomeProofs[agentId], count: firstAt === lastAt ? 1 : 2,
            firstAt: first, lastAt: last, days: [...new Set([first.slice(0, 10), last.slice(0, 10)])] }] : [] })) });
    }) as typeof fetch, clock);
  };
  await store.transaction(state => {
    registerPlgCatalog(state, catalog); state.paused = false;
    for (const [journey] of journeys) state.ready[journey] = true;
    for (const template of state.templates) template.published = true;
  });
  await sync();
  expect((await store.read()).contacts[0]).toMatchObject({ journey: 'agent_one', group: 'treatment' });
  expect(await service.run('Fixture worker')).toEqual({ sent: 1, uncertain: 0 });
  expect(transport.mock.calls[0][0].delivery.templateId).toBe('agent_one-welcome');
  return { store, service, transport, checks, sync, clock,
    advance: (delta: number) => { now += delta; },
    renew: () => { revision++; grant = renewed; consentAt = new Date(now).toISOString(); },
    revise: () => { revision++; },
    resetCapture: () => { captureEpoch = 'f'.repeat(64); captureStartedAt = now; },
  };
}

describe('canonical One enrollment to contextual delivery', () => {
  it.each(journeys)('offers the next %s task from a confirmed value without inventing complete activity coverage', async (journey, agentId) => {
    const f = await fixture(); f.advance(3 * DAY);
    await f.sync(agentId, START + 1000, START + DAY);
    const state = await f.store.read(), contact = state.contacts[0];
    expect(contact.journey).toBe('agent_one');
    expect(contact.observationAt).toBeUndefined();
    expect(candidate(state, contact, f.clock())).toMatchObject({ eligible: true, step: 'repeat', templateId: `${journey}-repeat` });
    expect(await f.service.run('Fixture worker')).toEqual({ sent: 1, uncertain: 0 });
    expect(f.transport.mock.calls[1][0]).toMatchObject({ to: 'canonical@example.invalid', delivery: { templateId: `${journey}-repeat` } });
    expect(f.checks[1]).toMatchObject({ accountId, generation, revision: 1 });
    expect(await f.service.run('Fixture replay')).toEqual({ sent: 0, uncertain: 0 });
    expect(f.transport).toHaveBeenCalledTimes(2);
  });

  it.each(['missing_epoch', 'old_epoch', 'old_grant', 'before_epoch', 'before_consent', 'missing_first'] as const)
    ('holds a positive follow-up with an invalid cached proof: %s', async invalid => {
      const f = await fixture(); f.advance(3 * DAY); await f.sync('agent_email', START + 1000, START + DAY);
      const state = await f.store.read(), contact = state.contacts[0], proof = contact.routingEvidence!;
      if (invalid === 'missing_epoch') delete proof.epoch;
      if (invalid === 'old_epoch') proof.epoch = 'f'.repeat(64);
      if (invalid === 'old_grant') proof.generation = renewed;
      if (invalid === 'before_epoch') contact.activity!.startedAt = new Date(f.clock() - 1000).toISOString();
      if (invalid === 'before_consent') contact.consentAt = new Date(f.clock() - 1000).toISOString();
      if (invalid === 'missing_first') delete proof.agents[0].firstAt;
      expect(candidate(state, contact, f.clock())).toMatchObject({ eligible: true, step: 'newsletter' });
      expect(contact.observationAt).toBeUndefined();
    });

  it('rejects an old-grant positive interval at the actual renewed source boundary', async () => {
    const f = await fixture(); f.advance(3 * DAY); f.renew();
    await expect(f.sync('agent_email', START + 1000, START + DAY)).rejects.toThrow('unavailable');
    const state = await f.store.read(), contact = state.contacts[0];
    expect(contact.permission?.generation).toBe(renewed);
    expect(contact.routingEvidence).toBeUndefined();
    expect(candidate(state, contact, f.clock())).toMatchObject({ eligible: false });
  });

  it.each(journeys)('selects %s positive content from the canonical account and rechecks its actual permission', async (journey, agentId) => {
    const f = await fixture(), id = (await f.store.read()).contacts[0].id;
    f.advance(DAY + 1);
    await f.sync(agentId);
    let state = await f.store.read();
    expect(state.contacts).toHaveLength(1);
    expect(state.contacts[0]).toMatchObject({ id, journey: 'agent_one', permission: { generation } });
    expect(state.contacts[0].observationAt).toBeUndefined();
    expect(candidate(state, state.contacts[0], f.clock())).toMatchObject({ eligible: true, step: 'newsletter', templateId: `${journey}-newsletter` });
    expect(await f.service.run('Fixture worker')).toEqual({ sent: 1, uncertain: 0 });
    expect(f.checks).toHaveLength(2);
    expect(f.checks[1]).toMatchObject({ accountId, generation, revision: 1 });
    expect(f.transport.mock.calls[1][0]).toMatchObject({ to: 'canonical@example.invalid', delivery: { templateId: `${journey}-newsletter`, status: 'sending' } });
    state = await f.store.read();
    expect(state.deliveries).toHaveLength(2);
    expect(state.deliveries.every(row => row.contactId === id && row.status === 'sent')).toBe(true);
    expect(await f.service.run('Fixture worker replay')).toEqual({ sent: 0, uncertain: 0 });
    expect(f.transport).toHaveBeenCalledTimes(2);
  });

  it('keeps empty best-effort capture unknown and uses only neutral subscribed content', async () => {
    const f = await fixture(); f.advance(3 * DAY); await f.sync();
    const state = await f.store.read(), contact = state.contacts[0];
    expect(contact.firstValueAt).toBeNull();
    expect(contact.failedAt).toBeNull();
    expect(contact.observationAt).toBeUndefined();
    expect(candidate(state, contact, f.clock())).toMatchObject({ eligible: true, step: 'newsletter', stage: 'unknown', templateId: 'agent_one-newsletter' });
  });

  it('does not reuse a complete observation across an explicit re-opt-in while preserving historical outcomes and delivery claims', async () => {
    const f = await fixture(); f.advance(3 * DAY);
    await f.sync('agent_one', START + 1000, START + DAY);
    await f.store.transaction(state => ingestEvent(state, { eventId: 'complete-old-grant', accountId,
      journey: 'agent_one', environment: 'production', internal: false, kind: 'observation_completed',
      verified: true, occurredAt: new Date(f.clock() - 1000).toISOString(), permissionGeneration: generation, activityEpoch: 'e'.repeat(64) }, f.clock()));
    const before = await f.store.read(), previous = before.contacts[0];
    expect(candidate(before, previous, f.clock())).toMatchObject({ eligible: true, step: 'repeat' });
    f.renew(); await f.sync();
    const after = await f.store.read(), current = after.contacts[0];
    expect(current).toMatchObject({ id: previous.id, journey: 'agent_one', firstValueAt: previous.firstValueAt,
      lastValueAt: previous.lastValueAt, valueDays: previous.valueDays, permission: { generation: renewed } });
    expect(after.deliveries).toEqual(before.deliveries);
    expect(candidate(after, current, f.clock())).toMatchObject({ eligible: true, step: 'newsletter' });
  });

  it.each(['missing', 'old_grant', 'before_consent'] as const)('rejects an unbound complete observation after renewal: %s', async invalid => {
    const f = await fixture(); f.advance(3 * DAY); f.renew(); await f.sync();
    const before = await f.store.read();
    await expect(f.store.transaction(state => ingestEvent(state, { eventId: `delayed-${invalid}`, accountId,
      journey: 'agent_one', environment: 'production', internal: false, kind: 'observation_completed', verified: true,
      occurredAt: new Date(f.clock() - (invalid === 'before_consent' ? 1 : 0)).toISOString(),
      ...(invalid === 'missing' ? {} : { permissionGeneration: invalid === 'old_grant' ? generation : renewed }),
    }, f.clock()))).rejects.toThrow('current One email permission');
    expect(await f.store.read()).toEqual(before);
  });

  it('keeps a generation-bound complete observation through a frequency revision and holds legacy unbound observations', async () => {
    const f = await fixture(); f.advance(3 * DAY);
    await f.sync('agent_one', START + 1000, START + DAY);
    await f.store.transaction(state => ingestEvent(state, { eventId: 'current-observation', accountId,
      journey: 'agent_one', environment: 'production', internal: false, kind: 'observation_completed', verified: true,
      occurredAt: new Date(f.clock()).toISOString(), permissionGeneration: generation, activityEpoch: 'e'.repeat(64) }, f.clock()));
    f.revise(); await f.sync();
    const state = await f.store.read(), contact = state.contacts[0];
    expect(contact.permission).toMatchObject({ generation, revision: 2 });
    expect(candidate(state, contact, f.clock())).toMatchObject({ eligible: true, step: 'repeat' });
    delete contact.observationPermissionGeneration;
    expect(candidate(state, contact, f.clock())).toMatchObject({ eligible: true, step: 'newsletter' });
    contact.observationAt = new Date(f.clock() + 1000).toISOString();
    ingestEvent(state, { eventId: 'bound-replacement', accountId, journey: 'agent_one', environment: 'production',
      internal: false, kind: 'observation_completed', verified: true, permissionGeneration: generation,
      activityEpoch: 'e'.repeat(64), occurredAt: new Date(f.clock()).toISOString() }, f.clock());
    expect(contact.observationAt).toBe(new Date(f.clock()).toISOString());
  });

  it.each(['missing', 'old', 'before_start'] as const)('rejects a complete check outside the current capture epoch: %s', async invalid => {
    const f = await fixture(); f.advance(3 * DAY); f.resetCapture(); await f.sync();
    const before = await f.store.read();
    await expect(f.store.transaction(state => ingestEvent(state, { eventId: `epoch-${invalid}`, accountId,
      journey: 'agent_one', environment: 'production', internal: false, kind: 'observation_completed',
      verified: true, permissionGeneration: generation,
      occurredAt: new Date(f.clock() - (invalid === 'before_start' ? 1 : 0)).toISOString(),
      ...(invalid === 'missing' ? {} : { activityEpoch: (invalid === 'old' ? 'e' : 'f').repeat(64) }),
    }, f.clock()))).rejects.toThrow('current One capture epoch');
    expect(await f.store.read()).toEqual(before);
  });

  it('invalidates completeness when the current capture epoch changes without erasing history or permission', async () => {
    const f = await fixture(); f.advance(3 * DAY);
    await f.sync('agent_one', START + 1000, START + DAY);
    await f.store.transaction(state => ingestEvent(state, { eventId: 'before-epoch-reset', accountId,
      journey: 'agent_one', environment: 'production', internal: false, kind: 'observation_completed',
      verified: true, permissionGeneration: generation, activityEpoch: 'e'.repeat(64),
      occurredAt: new Date(f.clock()).toISOString() }, f.clock()));
    const before = await f.store.read();
    expect(candidate(before, before.contacts[0], f.clock())).toMatchObject({ eligible: true, step: 'repeat' });
    f.advance(1000); f.resetCapture(); await f.sync();
    const after = await f.store.read(), contact = after.contacts[0];
    expect(contact.permission).toMatchObject({ generation, revision: 1, enabled: true, eligible: true });
    expect(contact.firstValueAt).toBe(before.contacts[0].firstValueAt);
    expect(after.deliveries).toEqual(before.deliveries);
    expect(contact.observationAt).toBeUndefined();
    expect(contact.observationEpoch).toBeUndefined();
    expect(candidate(after, contact, f.clock())).toMatchObject({ eligible: true, step: 'newsletter' });
  });
});
