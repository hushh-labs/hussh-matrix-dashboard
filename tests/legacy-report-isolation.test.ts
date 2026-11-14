import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp, signCookie } from '../server';
import { canonicalAnalyticsKey } from '../src/server/aggregate-cache';
import { noteLegacyQueryFailure } from '../src/server/legacy-restoration';

const state = vi.hoisted(() => ({ query: vi.fn(), historyFails: true, dailyFails: false, agentsFail: false,
  cohortKey: 'b'.repeat(64), retained: undefined as undefined | { key: string; at: number; value: { status: number; body: unknown } },
  readSnapshot: vi.fn(), saveSnapshot: vi.fn(), phase: 'none' as 'none' | 'planning' | 'open' }));
vi.mock('../src/server/legacy-restoration', async original => ({
  ...await original<typeof import('../src/server/legacy-restoration')>(),
  legacyRestoration: async () => state.retained || state.phase !== 'none' ? {
    readSnapshot: state.readSnapshot, saveSnapshot: state.saveSnapshot,
    isActive: async () => state.phase === 'open', isPreparing: async () => state.phase !== 'none' } : null,
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
  return { ...actual, readCustomerCohort: async () => cohort(), requireCurrentCustomerCohort: async () => cohort(),
    withCustomerCohort: async (_key: string, load: () => Promise<unknown>) => load() };
});
const secret = 'legacy-report-isolation-test-session-secret-long-enough';
const cookie = (email = 'metrics-qa@hushh.ai') => `hussh_matrix_session=${encodeURIComponent(signCookie(JSON.stringify({ email, exp: Math.floor(Date.now() / 1000) + 3600 }), secret))}`;
const app = () => createApp({ requireAuth: true, allowPublicDashboard: false, isProduction: false, sessionSecret: secret });
afterEach(() => { vi.unstubAllGlobals(); state.query.mockReset(); state.retained = undefined; state.cohortKey = 'b'.repeat(64); state.readSnapshot.mockReset(); state.saveSnapshot.mockReset(); state.phase = 'none'; });

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
    expect(changed.body.marker).toBeUndefined(); expect(state.query).toHaveBeenCalled();
    const publishDenied = await request(server).get(url).set('Cookie', cookie()).set('X-Metrics-Restoration-Publish', '1');
    expect(publishDenied.status).toBe(403);
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
