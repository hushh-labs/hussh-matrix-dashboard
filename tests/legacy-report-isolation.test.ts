import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp, signCookie } from '../server';
import { canonicalAnalyticsKey } from '../src/server/aggregate-cache';
import { noteLegacyQueryFailure } from '../src/server/legacy-restoration';

const state = vi.hoisted(() => ({ query: vi.fn(), historyFails: true, dailyFails: false, agentsFail: false,
  cohortKey: 'b'.repeat(64), retained: undefined as undefined | { key: string; at: number; value: { status: number; body: unknown } },
  readSnapshot: vi.fn(), compatibleSnapshot: vi.fn(), priorSnapshot: vi.fn(), saveSnapshot: vi.fn(), composer: null as any, continuation: null as any, continuationComposer: null as any, previousAsOf: null as string | null, currentAsOf: null as string | null, currentCohortFails: false, cohortPending: false, expanded: false, phase: 'none' as 'none' | 'planning' | 'open' | 'closed' }));
vi.mock('../src/server/legacy-restoration', async original => ({
  ...await original<typeof import('../src/server/legacy-restoration')>(),
  legacyPreviousRestoration: async () => ({ readSnapshot: state.priorSnapshot, publicationAsOf: async () => state.previousAsOf }),
  legacyRestoration: async () => state.retained || state.phase !== 'none' ? {
    readSnapshot: state.readSnapshot, readCompatibleSnapshot: state.compatibleSnapshot, saveSnapshot: state.saveSnapshot, publicationAsOf: async () => state.currentAsOf,
    isActive: async () => state.phase === 'open', isPreparing: async () => state.phase === 'open' || state.phase === 'planning', expandedPreparing: async () => state.expanded } : null,
}));
vi.mock('../src/server/closed-composer', () => ({ closedComposer: async () => state.composer }));
vi.mock('../src/server/closed-continuation-composer', () => ({ closedContinuationComposer: async () => state.continuationComposer }));
vi.mock('../src/server/legacy-continuation', async original => ({
  ...await original<typeof import('../src/server/legacy-continuation')>(), legacyContinuation: async () => state.continuation,
}));
vi.mock('../src/server/bigquery-cost-control', () => ({
  guardedBigQuery: async (_project: string, options: { query: string }) => {
    try {
      const result = await state.query(options);
      if (state.phase === 'planning') throw new Error('Plan recorded; no paid execution');
      return result;
    } catch (error) { noteLegacyQueryFailure(); throw error; }
  },
  guardedBigQueryDryRun: vi.fn(async () => [{ metadata: { statistics: { totalBytesProcessed: '1' } } }]),
}));
vi.mock('google-auth-library', () => ({ GoogleAuth: class {
  async getClient() { return { request: async () => ({ data: { users: [] } }) }; }
} }));
vi.mock('../src/server/one-customer-cohort', async original => {
  const actual = await original<typeof import('../src/server/one-customer-cohort')>();
  const cohort = () => ({ policyRevision: 'a'.repeat(64), asOf: new Date().toISOString(), expiresAt: Date.now() + 600_000,
    cacheKey: state.cohortKey, rows: [{ analyticsUserId: 'c'.repeat(32), registeredAt: '2026-11-01T00:00:00Z' }] });
  return { ...actual, readCustomerCohort: async () => state.cohortPending ? await new Promise<ReturnType<typeof cohort>>(() => {}) : cohort(), requireCurrentCustomerCohort: async () => { if (state.currentCohortFails) throw new Error('membership changed'); return cohort(); },
    withCustomerCohort: async (_key: string, load: () => Promise<unknown>) => load() };
});
const secret = 'legacy-report-isolation-test-session-secret-long-enough';
const cookie = (email = 'metrics-qa@hushh.ai') => `hussh_matrix_session=${encodeURIComponent(signCookie(JSON.stringify({ email, exp: Math.floor(Date.now() / 1000) + 3600 }), secret))}`;
const app = () => createApp({ requireAuth: true, allowPublicDashboard: false, isProduction: false, sessionSecret: secret });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); state.query.mockReset(); state.retained = undefined; state.cohortKey = 'b'.repeat(64); state.readSnapshot.mockReset(); state.compatibleSnapshot.mockReset(); state.priorSnapshot.mockReset(); state.saveSnapshot.mockReset(); state.expanded = false; state.phase = 'none'; state.composer = null; state.continuation = null; state.continuationComposer = null; state.previousAsOf = null; state.currentAsOf = null; state.currentCohortFails = false; state.cohortPending = false; });

function source() {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('No external calls in route verification'); }));
  state.query.mockImplementation(async ({ query }: { query: string }) => {
    if (query.includes('MIN(day) AS firstSeen')) {
      if (state.historyFails) throw new Error('Historical scan exceeds byte limit');
      return [[{ current_first_seen: 1, previous_first_seen: 2, identity_observed_since: '2026-01-01' }]];
    }
    if (query.includes('AS current_active')) return [[{ current_active: 3, current_activated: 1,
      current_agent_engaged: 2, current_devices: 4, identified_devices: 3, latest_event_date: '2026-11-10' }]];
    if (query.includes('identifier_binding AS')) return [[{ period: 'current', platform: 'IOS', identified_accounts: 3,
      tracked_identifiers: 4, bound_identifiers: 3, sign_in_identifiers: 2, signed_in_bound_identifiers: 2 }]];
    if (query.includes('AS successful_accounts')) {
      if (state.agentsFail) throw new Error('Agent source failed');
      return [[{ period: 'current', capability: 'memory', identified_accounts: 2, successful_accounts: 1,
        interactions: 4, ios_interactions: 4, successes: 1, outcome_signals: 1 }]];
    }
    if (query.includes('AS active_accounts')) {
      if (state.dailyFails) throw new Error('Daily source failed');
      return [[{ day: '2026-11-10', active_accounts: 3, agent_interactions: 4 }]];
    }
    return [[]];
  });
}

describe('legacy report source isolation', () => {
  it('fails closed without a warehouse query when the cohort check exceeds the deadline', async () => {
    state.phase = 'closed'; state.currentAsOf = '2026-11-14T21:34:55.606Z'; state.cohortPending = true;
    const response = await request(app()).get('/api/auth/plg-publication').set('Cookie', cookie());
    expect(response.status).toBe(200); expect(response.body.publicationAsOf).toBeNull();
    expect(state.compatibleSnapshot).not.toHaveBeenCalled(); expect(state.query).not.toHaveBeenCalled();
  }, 40_000);
  it('preserves the older global calendar anchor while granting PLG only a witnessed production publication', async () => {
    state.phase = 'closed'; state.previousAsOf = '2026-11-14T19:33:10.257Z'; state.currentAsOf = '2026-11-14T21:34:55.606Z';
    const range = { startDate: '2026-10-16', endDate: '2026-11-14', days: 30 };
    state.compatibleSnapshot.mockResolvedValue({ at: Date.parse(state.currentAsOf), value: { status: 200, body: { one: { data: {
      uat: null, production: { reportingEnvironment: 'production', reportingScopeVersion: 'one-environment-v1', range,
        activeUsers: { countingUnit: 'device' }, identifiedUsers: { countingUnit: 'account', selectedRange: range },
        registeredAccounts: { environment: 'production', registryScope: 'production_contacts', sharedAcrossEnvironments: true, ...range } },
    } } } } });
    const readAuth = () => request(app()).get('/api/auth/me').set('Cookie', cookie());
    const readPlgAnchor = () => request(app()).get('/api/auth/plg-publication').set('Cookie', cookie());
    const result = await readAuth(), anchor = await readPlgAnchor(); expect(result.status).toBe(200); expect(anchor.status).toBe(200);
    expect(result.body.publicationAsOf).toBe(state.previousAsOf); expect(anchor.body.publicationAsOf).toBe(state.currentAsOf);
    expect(anchor.headers['cache-control']).toBe('no-store'); expect(JSON.stringify(anchor.body)).not.toContain(state.cohortKey); expect(state.query).not.toHaveBeenCalled();
    expect((await request(app()).get('/api/auth/plg-publication')).status).toBe(401);
    state.currentCohortFails = true; expect((await readPlgAnchor()).body.publicationAsOf).toBeNull(); state.currentCohortFails = false;
    state.compatibleSnapshot.mockResolvedValue(null);
    const mismatch = await readPlgAnchor(); expect(mismatch.body.publicationAsOf).toBeNull();
    state.currentAsOf = null; const priorOnly = await readAuth(); expect(priorOnly.body.publicationAsOf).toBe(state.previousAsOf); expect((await readPlgAnchor()).body.publicationAsOf).toBeNull();
  });
  it('compares only matching retained growth windows without exposing cohort proof or querying', async () => {
    source(); state.phase = 'closed'; const asOf = '2026-11-14T21:34:55.606Z';
    const witness = { policyRevision: 'a'.repeat(64), rowsHash: 'f'.repeat(64), asOf: '2026-11-14T21:53:15.758Z' };
    state.continuation = { closedDescriptor: async () => ({ asOf }), readForComparison: async (key: string) => {
      const startDate = key.includes('2026-10-16') ? '2026-10-16' : '2026-08-17', days = startDate === '2026-10-16' ? 30 : 90;
      return { at: Date.parse(asOf), computedAt: Date.parse('2026-11-15T00:00:00Z'), witness,
        value: { status: 200, body: { growth: { data: { range: { startDate, endDate: '2026-11-14', days }, aggregate: days } } } } };
    } };
    const server = app(), requestCompare = () => request(server).get('/api/analytics/growth/compare').set('Cookie', cookie());
    const result = await requestCompare(); expect(result.status).toBe(200); expect(result.headers['x-metrics-cache']).toBe('RESTORED');
    expect(result.body.windows.map((window: any) => window.data?.aggregate ?? null)).toEqual([30, 90, null]);
    expect(result.body.windows[2].error).toBe('All-time comparison is unavailable.');
    expect(JSON.stringify(result.body)).not.toContain(witness.rowsHash); expect(JSON.stringify(result.body)).not.toContain(witness.policyRevision);
    expect(state.query).not.toHaveBeenCalled();
    const original = state.continuation.readForComparison; state.continuation.readForComparison = async (key: string) => {
      const value = await original(key); return key.includes('2026-08-17') ? { ...value, witness: { ...witness, rowsHash: 'e'.repeat(64) } } : value;
    };
    expect((await requestCompare()).status).toBe(503); expect(state.query).not.toHaveBeenCalled();
    state.continuation.readForComparison = async (key: string) => {
      const value = await original(key); return key.includes('2026-08-17') ? { ...value, witness: { ...witness, policyRevision: 'd'.repeat(64) } } : value;
    };
    expect((await requestCompare()).status).toBe(503); expect(state.query).not.toHaveBeenCalled();
    state.continuation.readForComparison = async (key: string) => {
      const value = await original(key); return key.includes('2026-08-17') ? { ...value, at: value.at - 1 } : value;
    };
    expect((await requestCompare()).status).toBe(503); expect(state.query).not.toHaveBeenCalled();
    state.continuation.readForComparison = original; state.currentCohortFails = true;
    expect((await requestCompare()).status).toBe(503); expect(state.query).not.toHaveBeenCalled();
  });
  it('rejects closed-continuation composition from ordinary viewers before source work', async () => {
    source(); state.phase = 'closed';
    const result = await request(app()).get('/api/analytics/founder?start_date=2026-11-11&end_date=2026-11-11')
      .set('Cookie', cookie()).set('X-Metrics-Compose-Continuation', '1');
    expect(result.status).toBe(403); expect(state.query).not.toHaveBeenCalled();
  });
  it('does not publish an incomplete closed-continuation computation and exposes only bounded diagnostics', async () => {
    source(); state.phase = 'closed'; state.continuation = {};
    const save = vi.fn(); state.continuationComposer = { requireOpen: async () => ({ producer: { asOf: '2026-11-14T21:34:55.606Z' } }), save };
    state.query.mockImplementation(async () => { throw new Error('private provider details'); });
    const result = await request(app()).get('/api/analytics/all?view=one&environment=uat&one_start_date=2026-11-11&one_end_date=2026-11-11')
      .set('Cookie', cookie('metrics-release-probe@hushh.ai')).set('X-Metrics-Compose-Continuation', '1');
    expect(result.status).toBe(503); expect(result.body).toMatchObject({ stage: 'computation', error: 'Completed inputs are unavailable.' });
    expect(JSON.stringify(result.body)).not.toContain('private provider details'); expect(save).not.toHaveBeenCalled();
  });
  it('rejects continuation headers from ordinary viewers before any source work', async () => {
    source(); state.phase = 'closed'; state.continuation = { read: vi.fn() };
    const result = await request(app()).get('/api/analytics/founder?start_date=2026-11-11&end_date=2026-11-11')
      .set('Cookie', cookie()).set('X-Metrics-Continue', '1');
    expect(result.status).toBe(403); expect(state.query).not.toHaveBeenCalled();
  });
  it('never loads a missing ordinary report while a private continuation is open', async () => {
    source(); state.phase = 'closed'; state.continuation = { read: vi.fn().mockResolvedValue(null) };
    const result = await request(app()).get('/api/analytics/founder?start_date=2026-11-11&end_date=2026-11-11').set('Cookie', cookie());
    expect(result.status).toBe(503); expect(state.query).not.toHaveBeenCalled();
  });
  it('rejects a closed-job measurement from ordinary viewers before source work', async () => {
    source(); const server = app();
    const result = await request(server).get('/api/analytics/founder?start_date=2026-11-11&end_date=2026-11-11')
      .set('Cookie', cookie()).set('X-Metrics-Measure-Closed', '1');
    expect(result.status).toBe(403); expect(state.query).not.toHaveBeenCalled();
  });
  it('rejects composition from ordinary viewers before loading source data', async () => {
    source(); const server = app();
    const result = await request(server).get('/api/analytics/founder?start_date=2026-11-11&end_date=2026-11-11')
      .set('Cookie', cookie()).set('X-Metrics-Compose', '1');
    expect(result.status).toBe(403); expect(state.query).not.toHaveBeenCalled();
  });

  it('does not publish a trusted composition if a required completed input fails', async () => {
    source(); state.phase = 'closed'; state.historyFails = true;
    const save = vi.fn(); state.composer = { requireOpen: async () => ({}), save, descriptor: async () => ({ producer: { asOf: new Date().toISOString() } }) };
    const server = app(), url = '/api/analytics/all?view=one&environment=uat&one_start_date=2026-11-11&one_end_date=2026-11-11';
    state.query.mockImplementation(async () => { throw new Error('Completed job unavailable'); });
    const result = await request(server).get(url).set('Cookie', cookie('metrics-release-probe@hushh.ai')).set('X-Metrics-Compose', '1');
    expect(result.status).toBe(503); expect(save).not.toHaveBeenCalled();
  });
  it('does not coalesce trusted publication with a pending ordinary request that later fails', async () => {
    source(); state.phase = 'open'; state.historyFails = false;
    const delegate = state.query.getMockImplementation()!;
    let started!: () => void, release!: () => void, first = true;
    const pending = new Promise<void>(resolve => { started = resolve; });
    const resumed = new Promise<void>(resolve => { release = resolve; });
    state.query.mockImplementation(async (options: { query: string }) => {
      if (options.query.includes('AS current_active') && first) {
        first = false; started(); await resumed; throw new Error('ordinary query failed');
      }
      return delegate(options);
    });
    const server = app(), url = '/api/analytics/founder?start_date=2026-11-02&end_date=2026-11-02';
    const ordinary = request(server).get(url).set('Cookie', cookie()).then(value => value);
    await pending;
    try {
      const publication = await request(server).get(url).set('Cookie', cookie('metrics-release-probe@hushh.ai')).set('X-Metrics-Restoration-Publish', '1');
      expect(publication.status).toBe(200); expect(publication.body.one.activeAccounts.current).toBe(3);
      expect(state.saveSnapshot).toHaveBeenCalledTimes(1);
    } finally { release(); await ordinary; }
  });
  it('re-evaluates a cached planning response before publication and refuses incomplete computations', async () => {
    source(); state.phase = 'planning'; state.historyFails = false;
    const server = app(), url = '/api/analytics/founder?start_date=2026-11-04&end_date=2026-11-04';
    const planned = await request(server).get(url).set('Cookie', cookie());
    expect(planned.status).toBe(200); expect(planned.body.one.available).toBe(false);
    state.phase = 'open'; state.query.mockClear();
    const published = await request(server).get(url).set('Cookie', cookie('metrics-release-probe@hushh.ai')).set('X-Metrics-Restoration-Publish', '1');
    expect(published.status).toBe(200); expect(published.body.one.activeAccounts.current).toBe(3);
    expect(state.query).toHaveBeenCalled(); expect(state.saveSnapshot).toHaveBeenCalledTimes(1);
    state.saveSnapshot.mockClear(); state.historyFails = true;
    const failed = await request(server).get(url).set('Cookie', cookie('metrics-release-probe@hushh.ai')).set('X-Metrics-Restoration-Publish', '1');
    expect(failed.status).toBe(503); expect(state.saveSnapshot).not.toHaveBeenCalled();
  });
  it('keeps platform SQL selection stable across planning and open publication in the same process', async () => {
    source(); state.phase = 'planning';
    const server = app(), url = '/api/analytics/all?view=one&environment=production&one_start_date=2026-11-03&one_end_date=2026-11-03';
    await request(server).get(url).set('Cookie', cookie());
    const planned = state.query.mock.calls.map(([options]) => options.query as string).filter(sql => sql.includes('androidCapture'));
    expect(planned.length).toBeGreaterThan(0);
    state.query.mockClear(); state.phase = 'open';
    await request(server).get(url).set('Cookie', cookie('metrics-release-probe@hushh.ai')).set('X-Metrics-Restoration-Publish', '1');
    const opened = state.query.mock.calls.map(([options]) => options.query as string).filter(sql => sql.includes('androidCapture'));
    expect(opened).toEqual(planned);
  });
  it('serves dated restored aggregates after permit closure, including Refresh, with zero new source queries', async () => {
    source();
    const url = '/api/analytics/founder?start_date=2026-11-05&end_date=2026-11-05';
    const at = Date.now() - 3_600_000, body = { marker: 'actual retained aggregate', partial: true, unavailableMetric: null };
    state.retained = { key: 'b'.repeat(64) + ':' + canonicalAnalyticsKey(url), at, value: { status: 200, body } };
    state.readSnapshot.mockImplementation(async key => key === state.retained?.key ? state.retained : null);
    const server = app();
    const denied = await request(server).get(url);
    expect(denied.status).toBe(401); expect(state.readSnapshot).not.toHaveBeenCalled();
    for (const refresh of [false, true]) {
      const req = request(server).get(url).set('Cookie', cookie());
      if (refresh) req.set('X-Metrics-Refresh', '1');
      const response = await req;
      expect(response.status).toBe(200); expect(response.body).toEqual(body);
      expect(response.headers['x-metrics-updated-at']).toBe(new Date(at).toISOString());
      expect(response.headers['x-metrics-cache']).toBe('RESTORED');
    }
    expect(state.query).not.toHaveBeenCalled();
    state.cohortKey = 'd'.repeat(64);
    const changed = await request(server).get(url).set('Cookie', cookie());
    expect(changed.status).toBe(503); expect(changed.body.marker).toBeUndefined(); expect(state.query).not.toHaveBeenCalled();
    const publishDenied = await request(server).get(url).set('Cookie', cookie()).set('X-Metrics-Restoration-Publish', '1');
    expect(publishDenied.status).toBe(403);
  });
  it('restricts diagnostic planning to the release probe', async () => {
    source(); vi.stubEnv('METRICS_LEGACY_DIAGNOSTIC_ONLY', '1');
    const response = await request(app()).get('/api/analytics/founder?start_date=2026-11-05&end_date=2026-11-05').set('Cookie', cookie());
    expect(response.status).toBe(403); expect(state.query).not.toHaveBeenCalled();
  });
  it('restricts an active historical expansion to the release probe', async () => {
    source(); state.phase = 'open'; state.expanded = true;
    const response = await request(app()).get('/api/analytics/founder?start_date=2026-11-05&end_date=2026-11-05').set('Cookie', cookie());
    expect(response.status).toBe(403); expect(state.query).not.toHaveBeenCalled();
  });
  it('reads a compatible original snapshot without relabeling its time or querying', async () => {
    source(); state.phase = 'planning';
    const url = '/api/analytics/founder?start_date=2026-11-05&end_date=2026-11-05';
    const at = Date.now() - 60_000, value = { status: 200, body: { marker: 'old producer', partial: true } };
    const key = 'b'.repeat(64) + ':' + canonicalAnalyticsKey(url);
    state.readSnapshot.mockResolvedValue(null);
    state.priorSnapshot.mockImplementation(async candidate => candidate === key ? { at, value } : null);
    const response = await request(app()).get(url).set('Cookie', cookie());
    expect(response.status).toBe(200); expect(response.body).toEqual(value.body);
    expect(response.headers['x-metrics-updated-at']).toBe(new Date(at).toISOString());
    expect(response.headers['x-metrics-cache']).toBe('RESTORED'); expect(state.query).not.toHaveBeenCalled();
    state.cohortKey = 'd'.repeat(64);
    const changed = await request(app()).get(url).set('Cookie', cookie());
    expect(changed.body.marker).toBeUndefined();
  });
  it('preserves the witnessed cohort cutoff on a compatible retained response', async () => {
    source(); state.phase = 'planning';
    const url = '/api/analytics/founder?start_date=2026-11-05&end_date=2026-11-05';
    const at = Date.now() - 60_000, cohortAsOf = '2026-11-14T12:00:00.000Z';
    state.readSnapshot.mockResolvedValue(null);
    state.compatibleSnapshot.mockResolvedValue({ at, value: { status: 200, body: { marker: 'witnessed' } }, cohortAsOf });
    const response = await request(app()).get(url).set('Cookie', cookie());
    expect(response.status).toBe(200); expect(response.body.marker).toBe('witnessed');
    expect(response.headers['x-metrics-updated-at']).toBe(new Date(at).toISOString());
    expect(response.headers['x-metrics-cohort-as-of']).toBe(cohortAsOf);
    expect(response.headers['x-metrics-cache']).toBe('RESTORED'); expect(state.query).not.toHaveBeenCalled();
  });
  it('keeps bounded period accounts, platforms and agents when historical first-seen cannot be read', async () => {
    source(); state.historyFails = true; state.dailyFails = false; state.agentsFail = false;
    const response = await request(app()).get('/api/analytics/founder?start_date=2026-11-10&end_date=2026-11-10').set('Cookie', cookie());
    expect(response.status).toBe(200);
    const one = response.body.one;
    expect(one.available).toBe(true); expect(one.activeAccounts.current).toBe(3);
    expect(one.firstObservedAccounts).toEqual({ current: null, previous: null });
    expect(one.comparisonReady).toBe(false); expect(one.identityObservedSince).toBeNull();
    expect(one.platforms.find((row: { key: string }) => row.key === 'IOS').identifiedAccounts.current).toBe(3);
    expect(one.agents.find((row: { key: string }) => row.key === 'memory').interactions.current).toBe(4);
    expect(one.daily[0].activeAccounts).toBe(3);
    const periodSql = state.query.mock.calls.map(([options]) => options.query as string).find(sql => sql.includes('AS current_active') && !sql.includes('firstSeen'))!;
    expect(periodSql).toContain("_TABLE_SUFFIX IN ('20261109', 'intraday_20261109', '20261110', 'intraday_20261110')");
    expect(periodSql).toContain("user_id IN ('" + 'c'.repeat(32) + "')");
  });
  it('does not turn failed daily and agent sources into zero activity', async () => {
    source(); state.historyFails = true; state.dailyFails = true; state.agentsFail = true;
    const response = await request(app()).get('/api/analytics/founder?start_date=2026-11-08&end_date=2026-11-08').set('Cookie', cookie());
    expect(response.status).toBe(200); expect(response.body.one.activeAccounts.current).toBe(3);
    expect(response.body.one.daily).toEqual([]);
    expect(response.body.one.agents.every((row: { interactions: { current: number | null } }) => row.interactions.current === null)).toBe(true);
  });
  it('loads only the selected One environment and defers unrelated health loaders', async () => {
    source();
    const server = app();
    for (const environment of ['production', 'uat']) {
      state.query.mockClear();
      const response = await request(server).get(`/api/analytics/all?view=one&environment=${environment}&one_start_date=2026-11-09&one_end_date=2026-11-09`).set('Cookie', cookie());
      expect(response.status).toBe(200);
      expect(response.body.one.data[environment]).not.toBeNull();
      expect(response.body.one.data[environment === 'production' ? 'uat' : 'production']).toBeNull();
      const otherProject = environment === 'production' ? 'hushh-pda-uat.analytics_' : 'hushh-pda.analytics_';
      expect(state.query.mock.calls.every(([options]) => !options.query.includes(otherProject))).toBe(true);
      expect(response.body.kai.productionProduct.data.productionGa4).toBeNull();
    }
    const invalid = await request(server).get('/api/analytics/all?view=one&environment=invalid').set('Cookie', cookie());
    expect(invalid.status).toBe(400);
  });
});
