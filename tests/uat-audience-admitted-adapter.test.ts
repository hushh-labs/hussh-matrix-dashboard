import { expect, it, vi } from 'vitest';
import { readAdmittedUatAudience } from '../src/server/plg/uat-audience-admitted-adapter';
import { reportPath } from '../src/server/reports/store';
import { MemoryReportStore } from './helpers/metrics-report-memory-store';
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

const init = () => { const s = new MemoryReportStore(); s.data.set(reportPath('policy','uat-audience-admission'), { approved:true, enabled:true, revision:1, dailyGlobal:3, dailyViewer:2, concurrentGlobal:2, concurrentViewer:1 }); return s; };
const args = (store: MemoryReportStore, authorize: (viewer: string, scope: 'uat-team-audience') => Promise<boolean>, fetcher: typeof fetch) => ({ store, viewer:'viewer@example.invalid', key:'k'.repeat(40), input:filters, signal:new AbortController().signal, authorize, fetcher, env, now: () => now });
it('checks exact viewer authority and consumes the real bounded UAT parser', async () => {
 const store = init(), authorize = vi.fn().mockResolvedValue(true), fetcher = vi.fn(async () => Response.json(fixture()));
 const result = await readAdmittedUatAudience(args(store, authorize, fetcher));
 expect(result.environment).toBe('uat'); expect(JSON.stringify(result)).not.toContain('PRIVATE_PROVIDER_FIELD');
 expect(authorize).toHaveBeenCalledTimes(3); for (const call of authorize.mock.calls) expect(call).toEqual(['viewer@example.invalid','uat-team-audience']); expect(fetcher).toHaveBeenCalledOnce();
});
it('fails closed on missing authority, revoked authority, and malformed upstream body', async () => {
 const store = init(), fetcher = vi.fn(async () => Response.json(fixture()));
 await expect(readAdmittedUatAudience(args(store, async () => false, fetcher))).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
 const authority = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
 await expect(readAdmittedUatAudience(args(store, authority, fetcher))).rejects.toThrow();
 await expect(readAdmittedUatAudience(args(store, async () => true, async () => new Response('{')))).rejects.toThrow();
 expect([...store.data.entries()].some(([path, value]) => path.includes('uatAudienceClaims/') && (value as {state?:string}).state === 'open')).toBe(true);
});

it('keeps the claim open when cancellation reaches the real parser before body consumption', async () => {
  const store = init(), abort = new AbortController();
  const fetcher = vi.fn(async () => { abort.abort(); return Response.json(fixture()); });
  await expect(readAdmittedUatAudience({ ...args(store, async () => true, fetcher), signal: abort.signal })).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledOnce();
  expect([...store.data.entries()].some(([path, value]) => path.includes('uatAudienceClaims/') && (value as {state?:string}).state === 'open')).toBe(true);
});

it('withholds a completed page when viewer authority is revoked during the upstream read', async () => {
  const store = init(); let allowed = true;
  const authorize = vi.fn(async () => allowed);
  const fetcher = vi.fn(async () => { allowed = false; return Response.json(fixture()); });
  await expect(readAdmittedUatAudience(args(store, authorize, fetcher))).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledOnce(); expect(authorize).toHaveBeenCalledTimes(3);
});
