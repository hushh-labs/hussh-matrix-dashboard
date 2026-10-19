import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  candidate,
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

const NOW = Date.parse('2026-10-19T12:00:00Z');
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
          url: 'https://api.example.invalid/api/one/plg/snapshot',
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
    url: 'https://api.example.invalid/api/one/plg/snapshot',
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
