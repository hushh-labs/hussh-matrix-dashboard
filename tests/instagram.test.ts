import { describe, expect, it, vi } from 'vitest';
import { InstagramClient, InstagramApiError, completedSevenDayWindow, parseReach } from '../src/server/instagram/client';
import { observationKey, type InstagramStore, type InstagramSummary } from '../src/server/instagram/store';
import { syncInstagram } from '../src/server/instagram/sync';
import { INSTAGRAM_CAPABILITIES } from '../src/server/instagram/capabilities';

const accountId = '17841436775785807';
const sevenDays = completedSevenDayWindow(new Date('2026-09-29T12:00:00Z'));
const reachResponse = { data: [{ name: 'reach', period: 'day', total_value: { value: 4869 }, title: 'स्थानीय शीर्षक' }] };

function response(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

class MemoryStore implements InstagramStore {
  locked = false;
  attemptedToday = false;
  rows = new Map<string, number | null>();
  verified = false;
  finished: string[] = [];
  async acquire() { if (this.locked) return false; this.locked = true; return true; }
  async release() { this.locked = false; }
  async attemptedSince() { return this.attemptedToday; }
  async start() { /* test storage */ }
  async verifiedAccount() { this.verified = true; }
  async saveReach(_runId: string, id: string, observation: ReturnType<typeof parseReach>) {
    this.rows.set(observationKey(id, observation), observation.value);
  }
  async finish(_runId: string, _accountId: string, state: string) { this.finished.push(state); }
  async summary(): Promise<InstagramSummary> { return { state: 'empty', username: null, reach: null, lastSuccessfulSync: null, lastAttempt: null }; }
}

describe('Instagram reach vertical slice', () => {
  it('preserves the observed total as one requested-window observation and ignores localized labels', () => {
    const parsed = parseReach(reachResponse, sevenDays.since, sevenDays.until);
    expect(parsed.value).toBe(4869);
    expect(parsed.metricType).toBe('total_value');
    expect(parsed.requestedSince).toBe('2026-09-22T00:00:00.000Z');
    expect(parsed.requestedUntil).toBe('2026-09-29T00:00:00.000Z');
    expect(parsed.providerSince).toBeNull();
    expect(parsed.providerUntil).toBeNull();
    expect(parsed).not.toHaveProperty('dailyValues');
  });
  it('distinguishes missing from a genuine zero', () => {
    expect(parseReach({ data: [{ name: 'reach', period: 'day', total_value: { value: 0 } }] }, sevenDays.since, sevenDays.until).status).toBe('available');
    expect(parseReach({ data: [{ name: 'reach', period: 'day' }] }, sevenDays.since, sevenDays.until).status).toBe('not_yet_available');
  });
  it('uses a bearer header, preserves the string ID, and sends exact Unix boundaries', async () => {
    const urls: URL[] = [];
    const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input)); urls.push(url);
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer private-token' });
      expect(url.searchParams.has('access_token')).toBe(false);
      return response(url.pathname.endsWith('/me') ? { user_id: accountId, username: 'hussh.ai' } : reachResponse);
    });
    const client = new InstagramClient('private-token', 'v26.0', transport as typeof fetch);
    expect((await client.identity()).userId).toBe(accountId);
    expect((await client.reach(accountId, sevenDays.since, sevenDays.until)).value).toBe(4869);
    expect(urls[1].pathname).toContain(accountId);
    expect(urls[1].searchParams.get('since')).toBe(String(sevenDays.since.getTime() / 1000));
    expect(urls[1].searchParams.get('until')).toBe(String(sevenDays.until.getTime() / 1000));
  });
  it('redacts provider messages and bounds retries', async () => {
    const transport = vi.fn(async () => response({ error: { message: 'private-token', code: 4 } }, 429, { 'retry-after': '0' }));
    const client = new InstagramClient('private-token', 'v26.0', transport as typeof fetch, async () => {});
    await expect(client.identity()).rejects.toMatchObject({ kind: 'rate_limited' });
    expect(transport).toHaveBeenCalledTimes(3);
    try { await client.identity(); } catch (error) { expect(String(error)).not.toContain('private-token'); }
  });
  it('stops on invalid credentials and treats unverified optional metrics independently', async () => {
    const transport = vi.fn(async () => response({ error: { message: 'private-token', code: 190 } }, 401));
    const client = new InstagramClient('private-token', 'v26.0', transport as typeof fetch);
    await expect(client.identity()).rejects.toMatchObject({ kind: 'reconnect_required' });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(INSTAGRAM_CAPABILITIES.reach.status).toBe('verified');
    expect(INSTAGRAM_CAPABILITIES.media.status).toBe('unverified');
  });
  it('bounds network failure retries and returns a redacted timeout error', async () => {
    const transport = vi.fn(async () => { throw new Error('private-token in network stack'); });
    const client = new InstagramClient('private-token', 'v26.0', transport as typeof fetch, async () => {});
    await expect(client.identity()).rejects.toMatchObject({ kind: 'transient' });
    expect(transport).toHaveBeenCalledTimes(3);
  });
  it('rejects account mismatch without ingesting and allows a repeated logical sync to upsert', async () => {
    const store = new MemoryStore();
    const wrong = { identity: async () => ({ userId: '999', username: 'other' }), reach: vi.fn() } as unknown as InstagramClient;
    expect((await syncInstagram({ enabled: true, accountId, apiVersion: 'v26.0', token: 'private-token', store, now: new Date('2026-09-29T12:00:00Z'), client: wrong })).state).toBe('failed');
    expect(store.rows.size).toBe(0);
    expect(store.verified).toBe(false);
    const client = { identity: async () => ({ userId: accountId, username: 'hussh.ai' }), reach: async () => parseReach(reachResponse, sevenDays.since, sevenDays.until) } as unknown as InstagramClient;
    const options = { enabled: true, accountId, apiVersion: 'v26.0', token: 'private-token', store, now: new Date('2026-09-29T12:00:00Z'), client };
    expect((await syncInstagram(options)).state).toBe('success');
    expect((await syncInstagram(options)).state).toBe('success');
    expect(store.rows.size).toBe(1);
    expect([...store.rows.values()]).toEqual([4869]);
  });
  it('preserves old data on failure and avoids overlapping runs', async () => {
    const store = new MemoryStore();
    store.rows.set('existing', 21);
    store.locked = true;
    expect((await syncInstagram({ enabled: true, accountId, apiVersion: 'v26.0', token: 'private-token', store })).state).toBe('already_running');
    store.locked = false;
    const client = { identity: async () => { throw new InstagramApiError('reconnect_required', 401, 190); } } as unknown as InstagramClient;
    expect((await syncInstagram({ enabled: true, accountId, apiVersion: 'v26.0', token: 'private-token', store, client })).state).toBe('reconnect_required');
    expect(store.rows.get('existing')).toBe(21);
  });
  it('limits scheduled work to one attempt per UTC day without blocking manual recovery', async () => {
    const store = new MemoryStore();
    store.attemptedToday = true;
    const client = { identity: vi.fn() } as unknown as InstagramClient;
    const options = { enabled: true, accountId, apiVersion: 'v26.0', token: 'private-token', store, now: new Date('2026-09-29T12:00:00Z'), client };
    expect((await syncInstagram({ ...options, scheduled: true })).state).toBe('already_synced_today');
    expect(store.locked).toBe(false);
    expect(client.identity).not.toHaveBeenCalled();
  });
});
