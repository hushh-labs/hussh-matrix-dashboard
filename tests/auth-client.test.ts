import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchCurrentUser } from '../src/lib/auth-service';

afterEach(() => vi.unstubAllGlobals());

describe('browser session contract', () => {
  it('reads the authenticated user from the server response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      authenticated: true,
      user: { email: 'teammate@hushh.ai', name: 'Teammate', picture: '' },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchCurrentUser()).resolves.toEqual({
      email: 'teammate@hushh.ai',
      name: 'Teammate',
      picture: '',
      domainAuthorized: true,
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/me', {
      headers: { Accept: 'application/json' },
    });
  });

  it('does not treat an anonymous response as a signed-in user', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      authenticated: false,
      user: null,
    }), { status: 200 })));

    await expect(fetchCurrentUser()).resolves.toBeNull();
  });
});
