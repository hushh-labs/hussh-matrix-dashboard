import { describe, expect, it, vi } from 'vitest';
import { InstagramClient, InstagramApiError, completedSevenDayWindow, parseReach, parseAccountInsight, parseMediaInsight, parseMediaList } from '../src/server/instagram/client';
import { observationKey, type InstagramStore, type InstagramSummary } from '../src/server/instagram/store';
import { syncInstagram } from '../src/server/instagram/sync';
import { INSTAGRAM_CAPABILITIES } from '../src/server/instagram/capabilities';

const accountId = '17841436775785807';
const sevenDays = completedSevenDayWindow(new Date('2026-09-29T12:00:00Z'));
// The historical manual response did not include known request timestamps.
const historicalReachFixture = { data: [{ name: 'reach', period: 'day', total_value: { value: 4869 }, title: 'स्थानीय शीर्षक' }] };
const syntheticReachResponse = { data: [{ name: 'reach', period: 'day', total_value: { value: 42 } }] };

function response(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

class MemoryStore implements InstagramStore {
  locked = false;
  attemptedToday = false;
  rows = new Map<string, number | null>();
  verified = false;
  finished: string[] = [];
  optional = new Map<string, number | null>();
  async acquire() { if (this.locked) return false; this.locked = true; return true; }
  async release() { this.locked = false; }
  async attemptedSince() { return this.attemptedToday; }
  async start() { /* test storage */ }
  async verifiedAccount() { this.verified = true; }
  async saveReach(_runId: string, id: string, observation: ReturnType<typeof parseReach>) {
    this.rows.set(observationKey(id, observation), observation.value);
  }
  async saveProfile(_id: string, profile: { followersCount: number | null; mediaCount: number | null }) {
    this.optional.set('followers', profile.followersCount);
    this.optional.set('mediaCount', profile.mediaCount);
  }
  async saveAccountMetric(_runId: string, _id: string, observation: ReturnType<typeof parseReach>) {
    this.optional.set(observation.name, observation.value);
  }
  async saveMedia(_runId: string, _id: string, media: { id: string }) { this.optional.set(`media.${media.id}`, 1); }
  async saveMediaInsight(_runId: string, _id: string, mediaId: string, _publishedAt: string, observation: ReturnType<typeof parseMediaInsight>) {
    this.optional.set(`${mediaId}.${observation.name}`, observation.value);
  }
  async finish(_runId: string, _accountId: string, state: string) { this.finished.push(state); }
  async summary(): Promise<InstagramSummary> { return { state: 'empty', username: null, reach: null, lastSuccessfulSync: null, lastAttempt: null }; }
}

describe('Instagram reach vertical slice', () => {
  it('parses the historical value and localized labels without claiming a historical reporting date', () => {
    const parsed = parseReach(historicalReachFixture, sevenDays.since, sevenDays.until);
    expect(parsed.value).toBe(4869);
    expect(parsed.metricType).toBe('total_value');
    expect(parsed.providerSince).toBeNull();
    expect(parsed.providerUntil).toBeNull();
    expect(parsed).not.toHaveProperty('dailyValues');
  });
  it('records exact boundaries only for a synthetic request window', () => {
    const parsed = parseReach(syntheticReachResponse, sevenDays.since, sevenDays.until);
    expect(parsed.requestedSince).toBe('2026-09-22T00:00:00.000Z');
    expect(parsed.requestedUntil).toBe('2026-09-29T00:00:00.000Z');
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
      return response(url.pathname.endsWith('/me') ? { user_id: accountId, username: 'hussh.ai' } : syntheticReachResponse);
    });
    const client = new InstagramClient('private-token', 'v26.0', transport as typeof fetch);
    expect((await client.identity()).userId).toBe(accountId);
    expect((await client.reach(accountId, sevenDays.since, sevenDays.until)).value).toBe(42);
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
  it('backs off on transient errors when Retry-After is absent', async () => {
    const sleeps: number[] = [];
    const transport = vi.fn(async () => response({ error: { code: 2 } }, 500));
    const client = new InstagramClient('private-token', 'v26.0', transport as typeof fetch,
      async (milliseconds) => { sleeps.push(milliseconds); });
    await expect(client.identity()).rejects.toMatchObject({ kind: 'transient' });
    expect(sleeps).toEqual([250, 500]);
  });
  it('stops on invalid credentials and treats unverified optional metrics independently', async () => {
    const transport = vi.fn(async () => response({ error: { message: 'private-token', code: 190 } }, 401));
    const client = new InstagramClient('private-token', 'v26.0', transport as typeof fetch);
    await expect(client.identity()).rejects.toMatchObject({ kind: 'reconnect_required' });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(INSTAGRAM_CAPABILITIES.reach.status).toBe('verified');
    expect(INSTAGRAM_CAPABILITIES.media.status).toBe('verified');
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
    const client = { identity: async () => ({ userId: accountId, username: 'hussh.ai' }), reach: async () => parseReach(syntheticReachResponse, sevenDays.since, sevenDays.until) } as unknown as InstagramClient;
    const options = { enabled: true, accountId, apiVersion: 'v26.0', token: 'private-token', store, now: new Date('2026-09-29T12:00:00Z'), client };
    expect((await syncInstagram(options)).state).toBe('success');
    expect((await syncInstagram(options)).state).toBe('success');
    expect(store.rows.size).toBe(1);
    expect([...store.rows.values()]).toEqual([42]);
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

describe('verified optional Instagram reads', () => {
  it('parses native account and media metrics without translated labels or invented daily points', () => {
    const views = parseAccountInsight({ data: [{ name: 'views', period: 'day', total_value: { value: 0 }, title: 'दृश्य' }] }, 'views', sevenDays.since, sevenDays.until);
    expect(views).toMatchObject({ status: 'available', value: 0, metricType: 'total_value', unit: 'views', providerSince: null });
    expect(parseAccountInsight({ data: [] }, 'views', sevenDays.since, sevenDays.until).status).toBe('not_yet_available');
    const media = parseMediaInsight({ data: [{ name: 'saved', period: 'lifetime', values: [{ value: 3 }], title: 'सहेजा' }] }, 'saved');
    expect(media).toMatchObject({ value: 3, metricType: 'lifetime_snapshot', period: 'lifetime' });
    expect(parseMediaInsight({ data: [{ name: 'saved', period: 'lifetime', values: [] }] }, 'saved').status).toBe('not_yet_available');
  });
  it('paginates only with a bounded cursor on the fixed Meta host and preserves string IDs', async () => {
    const urls: URL[] = [];
    const media = (id: string) => ({ id, media_type: 'VIDEO', permalink: `https://www.instagram.com/p/${id}/`, timestamp: '2026-09-28T10:38:36+0000', like_count: 0 });
    const transport = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input)); urls.push(url);
      return response(url.searchParams.has('after')
        ? { data: [media('17841436775785809')] }
        : { data: [media('17841436775785808')], paging: { next: 'https://evil.example/?access_token=private-token', cursors: { after: 'opaque_cursor' } } });
    });
    const client = new InstagramClient('private-token', 'v26.0', transport as typeof fetch);
    const result = await client.recentMedia(accountId, 5);
    expect(result.map((item) => item.id)).toEqual(['17841436775785808', '17841436775785809']);
    expect(urls).toHaveLength(2);
    expect(urls.every((url) => url.hostname === 'graph.instagram.com' && !url.searchParams.has('access_token'))).toBe(true);
    expect(urls[1].searchParams.get('after')).toBe('opaque_cursor');
    expect(JSON.stringify(result)).not.toContain('private-token');
    expect(() => parseMediaList({ data: [], paging: { next: 'https://graph.instagram.com/', cursors: { after: 'invalid/cursor' } } })).toThrow(InstagramApiError);
  });
  it('keeps reach successful when optional metrics fail and does not overwrite valid optional data', async () => {
    const store = new MemoryStore();
    store.optional.set('total_interactions', 8);
    const client = {
      identity: async () => ({ userId: accountId, username: 'hussh.ai' }),
      reach: async () => parseReach(syntheticReachResponse, sevenDays.since, sevenDays.until),
      profile: async () => ({ userId: accountId, username: 'hussh.ai', followersCount: 0, mediaCount: 2 }),
      accountInsight: async (_id: string, name: string) => {
        if (name === 'total_interactions') throw new InstagramApiError('not_supported', 400, 100);
        return parseAccountInsight({ data: [{ name, period: 'day', total_value: { value: name === 'views' ? 0 : 5 } }] }, name as 'views', sevenDays.since, sevenDays.until);
      },
      recentMedia: async () => [{ id: '17841436775785808', mediaType: 'IMAGE', permalink: 'https://www.instagram.com/p/x/', publishedAt: '2026-09-28T00:00:00Z', likeCount: 0, commentsCount: null }],
      mediaInsight: async (_id: string, name: string) => name === 'shares'
        ? { name, period: 'lifetime', metricType: 'lifetime_snapshot', unit: 'count', value: null, status: 'not_yet_available', providerSince: null, providerUntil: null }
        : parseMediaInsight({ data: [{ name, period: 'lifetime', values: [{ value: 1 }] }] }, name as 'reach'),
    } as unknown as InstagramClient;
    const result = await syncInstagram({ enabled: true, accountId, apiVersion: 'v26.0', token: 'private-token', store, client, now: new Date('2026-09-29T12:00:00Z') });
    expect(result.state).toBe('success');
    expect(result.optionalResults).toMatchObject({ 'account.views': 'available', 'account.total_interactions': 'not_supported', 'media.17841436775785808.shares': 'not_yet_available' });
    expect(store.optional.get('total_interactions')).toBe(8);
    expect(store.optional.get('views')).toBe(0);
    expect(store.optional.get('followers')).toBe(0);
    expect(store.optional.has('17841436775785808.shares')).toBe(false);
  });
  it('distinguishes Meta code 100 unsupported media from code 4 rate limiting on HTTP 400', async () => {
    const unsupported = vi.fn(async () => response({ error: { code: 100, message: 'private-token' } }, 400));
    await expect(new InstagramClient('private-token', 'v26.0', unsupported as typeof fetch).mediaInsight('17841436775785808', 'reach'))
      .rejects.toMatchObject({ kind: 'not_supported', status: 400, code: 100 });
    expect(unsupported).toHaveBeenCalledTimes(1);
    const limited = vi.fn(async () => response({ error: { code: 4, message: 'private-token' } }, 400, { 'retry-after': '0' }));
    await expect(new InstagramClient('private-token', 'v26.0', limited as typeof fetch, async () => {}).mediaInsight('17841436775785808', 'reach'))
      .rejects.toMatchObject({ kind: 'rate_limited', status: 400, code: 4 });
    expect(limited).toHaveBeenCalledTimes(3);
  });
  it('bounds a date-form Retry-After header without retaining provider text', async () => {
    const waits: number[] = [];
    const date = new Date(Date.now() + 20_000).toUTCString();
    const transport = vi.fn(async () => response({ error: { code: 4, message: 'private-token' } }, 429, { 'retry-after': date }));
    const client = new InstagramClient('private-token', 'v26.0', transport as typeof fetch, async (ms) => { waits.push(ms); });
    await expect(client.identity()).rejects.toMatchObject({ kind: 'rate_limited' });
    expect(waits).toEqual([5_000, 5_000]);
  });
  it('stops starting optional work after the manual request budget while preserving reach', async () => {
    let wallTime = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => wallTime);
    try {
      const store = new MemoryStore();
      const originalSave = store.saveReach.bind(store);
      store.saveReach = async (...args) => { await originalSave(...args); wallTime = 240_001; };
      const profile = vi.fn();
      const client = { identity: async () => ({ userId: accountId, username: 'hussh.ai' }),
        reach: async () => parseReach(syntheticReachResponse, sevenDays.since, sevenDays.until), profile } as unknown as InstagramClient;
      const result = await syncInstagram({ enabled: true, accountId, apiVersion: 'v26.0', token: 'private-token', store, client, now: new Date('2026-09-29T12:00:00Z') });
      expect(result.state).toBe('success');
      expect(result.optionalResults?.['account.current_counts']).toBe('unknown');
      expect(profile).not.toHaveBeenCalled();
      expect(store.rows.size).toBe(1);
    } finally { clock.mockRestore(); }
  });
});
