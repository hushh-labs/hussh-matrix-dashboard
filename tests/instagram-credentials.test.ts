import { describe, expect, it, vi } from 'vitest';
import { InstagramCredentials } from '../src/server/instagram/credentials';

const secret = 'projects/test-project/secrets/instagram-credential';
const auth = { getAccessToken: async () => 'google-test-token' };
const now = new Date('2026-09-29T00:00:00Z');

function encoded(value: unknown): Response {
  return new Response(JSON.stringify({ payload: { data: Buffer.from(JSON.stringify(value)).toString('base64') } }), { status: 200 });
}

describe('Instagram credential lifecycle', () => {
  it('prefers latest Secret Manager version over an old bootstrap token and persists a refresh', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const transport = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const value = String(url); calls.push({ url: value, init });
      if (value.endsWith(':access')) return encoded({ accessToken: 'current-secret-token', tokenType: 'long_lived', issuedAt: '2026-08-01T00:00:00Z', expiresAt: '2026-10-05T00:00:00Z' });
      if (value.includes('refresh_access_token')) return new Response(JSON.stringify({ access_token: 'refreshed-token', expires_in: 5_184_000 }), { status: 200 });
      if (value.endsWith(':addVersion')) return new Response('{}', { status: 200 });
      throw new Error('unexpected request');
    });
    const credentials = new InstagramCredentials(secret, 'old-bootstrap-token', transport as typeof fetch, auth);
    expect(await credentials.loadForSync(now)).toBe('refreshed-token');
    expect(calls).toHaveLength(3);
    expect(calls[1].url).toContain('current-secret-token');
    expect(calls[1].url).not.toContain('old-bootstrap-token');
    const write = JSON.parse(String(calls[2].init?.body));
    const stored = JSON.parse(Buffer.from(write.payload.data, 'base64').toString('utf8'));
    expect(stored.accessToken).toBe('refreshed-token');
    expect(stored.expiresAt).toBe('2026-11-28T00:00:00.000Z');
  });
  it('will not infer refresh eligibility for unknown token metadata', async () => {
    const transport = vi.fn(async () => encoded({ accessToken: 'unknown-type', tokenType: 'unknown' }));
    const credentials = new InstagramCredentials(secret, 'old-bootstrap-token', transport as typeof fetch, auth);
    expect(await credentials.loadForSync(now)).toBe('unknown-type');
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('lets the dashboard manual action read without Secret Manager write permission', async () => {
    const transport = vi.fn(async () => encoded({ accessToken: 'current-token', tokenType: 'long_lived', issuedAt: '2026-08-01T00:00:00Z', expiresAt: '2026-10-05T00:00:00Z' }));
    const credentials = new InstagramCredentials(secret, '', transport as typeof fetch, auth);
    expect(await credentials.loadForSync(now, false)).toBe('current-token');
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('rejects expired credentials without a provider request', async () => {
    const transport = vi.fn(async () => encoded({ accessToken: 'expired-token', tokenType: 'long_lived', issuedAt: '2026-07-01T00:00:00Z', expiresAt: '2026-09-28T00:00:00Z' }));
    const credentials = new InstagramCredentials(secret, '', transport as typeof fetch, auth);
    await expect(credentials.loadForSync(now)).rejects.toMatchObject({ kind: 'reconnect_required' });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('does not leak token or provider response in refresh errors', async () => {
    const transport = vi.fn(async (url: RequestInfo | URL) => String(url).endsWith(':access')
      ? encoded({ accessToken: 'sensitive-token', tokenType: 'long_lived', issuedAt: '2026-08-01T00:00:00Z', expiresAt: '2026-10-05T00:00:00Z' })
      : new Response(JSON.stringify({ error: { message: 'sensitive-token' } }), { status: 401 }));
    const credentials = new InstagramCredentials(secret, '', transport as typeof fetch, auth);
    try { await credentials.loadForSync(now); throw new Error('expected error'); }
    catch (error) { expect(String(error)).not.toContain('sensitive-token'); }
  });
});
