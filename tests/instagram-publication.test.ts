import { describe, expect, it } from 'vitest';
import type { Firestore } from '@google-cloud/firestore';
import { InstagramPublication } from '../src/server/instagram/publication';
import type { InstagramCredentials } from '../src/server/instagram/credentials';

class Memory {
  value: any; private tail = Promise.resolve();
  doc() { return { get: async () => this.snapshot() }; }
  snapshot() { return { exists: this.value !== undefined, data: () => this.value }; }
  async runTransaction<T>(fn: (tx: any) => Promise<T>) {
    const prior = this.tail; let release!: () => void; this.tail = new Promise<void>(resolve => { release = resolve; }); await prior;
    try { return await fn({ get: async () => this.snapshot(), create: (_ref: unknown, value: unknown) => { if (this.value) throw new Error('exists'); this.value = value; },
      update: (_ref: unknown, value: unknown) => { this.value = { ...this.value, ...value as object }; } }); } finally { release(); }
  }
  native() { return this as unknown as Pick<Firestore, 'doc' | 'runTransaction'>; }
}
const credential = { loadForSync: async () => 'synthetic-token' } as unknown as InstagramCredentials;
const now = Date.parse('2026-11-15T06:32:09Z');
describe('bounded Instagram publication', () => {
  it('collects once, caps provider calls, and serves only a bound retained aggregate', async () => {
    const db = new Memory(), store = new InstagramPublication(db.native(), '123', () => now); let calls = 0;
    const transport: typeof fetch = async input => {
      calls++; const url = new URL(String(input));
      if (url.pathname.endsWith('/me')) return Response.json({ user_id: '123', username: 'fixture', followers_count: 32, media_count: 61 });
      return Response.json({ data: [{ name: url.searchParams.get('metric'), period: 'day', total_value: { value: 27 } }] });
    };
    const [first, second] = await Promise.allSettled([store.collect(credential, 'v26.0', transport), store.collect(credential, 'v26.0', transport)]);
    expect([first.status, second.status].sort()).toEqual(['fulfilled', 'rejected']); expect(calls).toBe(13);
    const report = await store.read(); expect(report).toMatchObject({ source: 'direct_provider_publication', followersCount: 32, mediaCount: 61, providerBoundary: 'unknown', mediaCoverage: 'unavailable', canSync: false });
    expect(JSON.stringify(report)).not.toContain('synthetic-token'); expect(JSON.stringify(report)).not.toContain('"userId"');
    expect(await new InstagramPublication(db.native(), '456', () => now).read()).toBeNull();
    expect((await new InstagramPublication(db.native(), '123', () => now + 25 * 3_600_000).read())?.state).toBe('stale');
    expect(await new InstagramPublication(db.native(), '123', () => now + 91 * 86_400_000).read()).toBeNull();
  });
  it('keeps failed or uncertain collection claimed and never retries it', async () => {
    const db = new Memory(), store = new InstagramPublication(db.native(), '123', () => now); let calls = 0;
    const bad: typeof fetch = async () => { calls++; return new Response(null, { status: 401 }); };
    await expect(store.collect(credential, 'v26.0', bad)).rejects.toThrow(); expect(calls).toBe(1);
    await expect(store.collect(credential, 'v26.0', bad)).rejects.toThrow(); expect(calls).toBe(1); expect(await store.read()).toBeNull();
  });
  it('keeps missing provider metrics unavailable instead of creating zeros', async () => {
    const db = new Memory(), store = new InstagramPublication(db.native(), '123', () => now); let calls = 0;
    const transport: typeof fetch = async input => { calls++; return new URL(String(input)).pathname.endsWith('/me')
      ? Response.json({ user_id: '123', username: 'fixture', followers_count: 1, media_count: 1 }) : Response.json({ data: [] }); };
    await store.collect(credential, 'v26.0', transport); const report = await store.read();
    expect(calls).toBe(13); expect(report.accountWindows[30].reach).toMatchObject({ value: null, status: 'not_yet_available' });
  });
  it('counts provider retries against the same fixed call limit', async () => {
    const db = new Memory(), store = new InstagramPublication(db.native(), '123', () => now); let calls = 0;
    const transport: typeof fetch = async input => { calls++; return new URL(String(input)).pathname.endsWith('/me')
      ? Response.json({ user_id: '123', username: 'fixture', followers_count: 1, media_count: 1 }) : new Response(null, { status: 503 }); };
    await store.collect(credential, 'v26.0', transport);
    expect(calls).toBe(13); expect((await store.read()).accountWindows[90].reach).toBeNull();
  });
});
