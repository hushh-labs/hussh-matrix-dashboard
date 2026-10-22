import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp, signCookie } from '../server';
import { readCustomerCohort, withCustomerCohort } from '../src/server/one-customer-cohort';

const state = vi.hoisted(() => ({ caches: [] as { refreshActive(): Promise<void> }[], query: vi.fn(async (_options: unknown) => [[]]) }));
vi.mock('@google-cloud/bigquery', () => ({ BigQuery: class { query = state.query; } }));
vi.mock('../src/server/aggregate-cache', async (original) => {
  const actual = await original<typeof import('../src/server/aggregate-cache')>();
  return { ...actual, AggregateCache: class extends actual.AggregateCache<unknown> {
    constructor(options: ConstructorParameters<typeof actual.AggregateCache>[0]) { super(options); state.caches.push(this); }
  } };
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('production route cohort fencing', () => {
  it('cannot refresh A with B totals and later serve those totals when A returns; identical proof renewal still works', async () => {
    const start = Date.parse('2026-10-22T07:00:00Z');
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(start);
    vi.stubEnv('PLG_ONE_AUDIENCE_URL', 'https://api.hushh.ai/api/one/plg/audience');
    vi.stubEnv('PLG_ONE_AUDIENCE_SECRET', 'synthetic-read-only-secret-32-characters');
    let ids = ['a'.repeat(32)];
    const fetcher = vi.fn(async (url: URL | RequestInfo) => {
      expect(String(url)).toBe('https://api.hushh.ai/api/one/plg/customer-cohort');
      return Response.json({ version: 1, environment: 'production', scope: 'production_registered_contacts',
        policyRevision: 'c'.repeat(64), identityScheme: 'hushh-observability-v1-sha256-128', traversal: 'live',
        asOf: new Date().toISOString(), expiresAt: new Date(Date.now() + 600_000).toISOString(),
        scanned: ids.length, excluded: 0, rows: ids.map(analyticsUserId => ({ analyticsUserId, registeredAt: '2026-10-21T00:00:00.000Z' })), nextCursor: null });
    });
    vi.stubGlobal('fetch', fetcher);
    const secret = 'test-only-cache-session-secret-with-thirty-two-characters';
    const app = createApp({ requireAuth: true, allowPublicDashboard: false, isProduction: false, sessionSecret: secret });
    const snapshots = state.caches.at(-1)!;
    const cookie = `hussh_matrix_session=${encodeURIComponent(signCookie(JSON.stringify({ email: 'metrics-qa@hushh.ai', exp: Math.floor(start / 1000) + 3600 }), secret))}`;
    const url = '/api/analytics/one/app?environment=production&one_window_days=7';
    const read = () => request(app).get(url).set('Cookie', cookie);
    const first = await read();
    expect(first.status).toBe(200);
    expect(first.body.data.production.registeredAccounts.totalAccounts).toBe(1);
    const a = await readCustomerCohort();

    // Keep the A loader active just before its proof expires.
    vi.setSystemTime(start + 290_000);
    expect((await read()).status).toBe(200);
    await new Promise(resolve => setImmediate(resolve));
    // The background refresh now sees B, but must not write B into key A.
    vi.setSystemTime(start + 351_000); ids = ['b'.repeat(32), 'd'.repeat(32)];
    const b = await readCustomerCohort();
    expect(b.cacheKey).not.toBe(a.cacheKey);
    await expect(withCustomerCohort(a.cacheKey, async () => 'wrong population')).rejects.toThrow('could not be verified');
    await snapshots.refreshActive();

    // Return to A while its old aggregate is still within the ten-minute bound.
    vi.setSystemTime(start + 652_000); ids = ['a'.repeat(32)];
    const again = await read();
    expect(again.status).toBe(200);
    expect(again.body.data.production.registeredAccounts.totalAccounts).toBe(1);
    const renewed = await readCustomerCohort();
    expect(renewed.cacheKey).toBe(a.cacheKey);
    expect(renewed.asOf).not.toBe(a.asOf);
    expect(await withCustomerCohort(a.cacheKey, async () => (await readCustomerCohort()).asOf)).toBe(renewed.asOf);

    // Nested work cannot switch to B after the pinned proof expires mid-query.
    await expect(withCustomerCohort(a.cacheKey, async () => {
      vi.setSystemTime(start + 953_000); ids = ['b'.repeat(32)];
      await expect(readCustomerCohort()).rejects.toThrow('could not be verified');
      return 'finished work must not be cached after proof expiry';
    })).rejects.toThrow('could not be verified');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
