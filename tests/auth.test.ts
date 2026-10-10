/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Automated Vitest Test Suite for Hussh Matrix Dashboard Google OAuth 2.0 PKCE Protection.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import {
  createApp,
  validateConfig,
  checkUserAuthorization,
  sanitizeReturnTo,
  sanitizePrompt,
  signCookie,
  unsignCookie,
  type AppConfig,
} from '../server';

// ---------------------------------------------------------------------------
// Mock google-auth-library
// ---------------------------------------------------------------------------

let mockGetTokenImpl: (...args: any[]) => Promise<any>;
let mockVerifyIdTokenImpl: (...args: any[]) => Promise<any>;

vi.mock('google-auth-library', () => {
  class MockOAuth2Client {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    constructor(clientId?: string, clientSecret?: string, redirectUri?: string) {
      this.clientId = clientId || '';
      this.clientSecret = clientSecret || '';
      this.redirectUri = redirectUri || '';
    }
    async getToken(...args: any[]) {
      return mockGetTokenImpl(...args);
    }
    async verifyIdToken(...args: any[]) {
      return mockVerifyIdTokenImpl(...args);
    }
  }
  return { OAuth2Client: MockOAuth2Client };
});

const testConfig: AppConfig = {
  requireAuth: true,
  allowPublicDashboard: false,
  clientId: 'test-google-client-id.apps.googleusercontent.com',
  clientSecret: 'test-google-client-secret-1234567890',
  redirectUri: 'http://localhost:3001/auth/callback',
  sessionSecret: 'super-secret-key-that-is-at-least-32-characters-long!',
  allowedDomains: ['hussh.ai', 'hushh.ai', 'hushhtech.com', 'hushh.labs', 'hush1one.com'],
  allowedEmails: ['person1@gmail.com', 'roopmannvaradharaj@gmail.com', 'abdulbeast4@gmail.com'],
  isProduction: false,
};

function getSetCookies(res: request.Response): string[] {
  const val = res.headers['set-cookie'] as string[] | string | undefined;
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

describe('Google OAuth 2.0 & Domain Protection Layer', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.restoreAllMocks();
    app = createApp(testConfig);

    // Default mock implementations for successful exchange
    mockGetTokenImpl = async () => ({
      tokens: { id_token: 'mock-id-token-xyz' },
    });
    mockVerifyIdTokenImpl = async () => ({
      getPayload: () => ({
        email: 'ankit@hushh.ai',
        hd: 'hushh.ai',
        email_verified: true,
        name: 'Ankit',
        picture: 'https://example.com/photo.jpg',
        nonce: 'test-nonce-123',
      }),
    });
  });

  // Helper to trigger /api/auth/google and return the signed oauth_pkce cookie & state/nonce
  async function initiateOAuth(params = '') {
    const res = await request(app).get(`/api/auth/google${params}`);
    const cookies = getSetCookies(res);
    let pkceCookie = '';
    const match = cookies.find((c: string) => c.startsWith('oauth_pkce='));
    if (match) pkceCookie = match.split(';')[0];

    const location = (res.headers['location'] as string) || '';
    const url = new URL(location);
    const state = url.searchParams.get('state') || '';
    const nonce = url.searchParams.get('nonce') || '';

    // Extract unsigned payload to get nonce
    const rawVal = decodeURIComponent(pkceCookie.replace('oauth_pkce=', ''));
    const unsigned = unsignCookie(rawVal, testConfig.sessionSecret);
    const pkceObj = unsigned ? JSON.parse(unsigned) : {};

    return { res, pkceCookie, state, nonce: pkceObj.nonce || nonce, location };
  }

  // -------------------------------------------------------------------------
  // 1. Unauthenticated Protection
  // -------------------------------------------------------------------------
  describe('Unauthenticated Request Handling', () => {
    it('returns HTTP 401 Unauthorized for unauthenticated API requests (never redirects)', async () => {
      const res = await request(app).get('/api/analytics/hushh_ai');
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Authentication required' });
    });

    it('redirects unauthenticated page requests (GET /) to /login', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(302);
      expect(res.headers['location']).toBe('/login?returnTo=%2F');
    });

    it('returns HTTP 401 for Bearer token authorization header', async () => {
      const res = await request(app)
        .get('/api/analytics/hushh_ai')
        .set('Authorization', 'Bearer fake-google-id-token');
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Authentication required' });
    });
  });

  // -------------------------------------------------------------------------
  // 2. OAuth Initiation
  // -------------------------------------------------------------------------
  describe('OAuth Initiation Endpoint (/api/auth/google)', () => {
    it('moves the legacy host to the callback host before creating a PKCE cookie', async () => {
      const legacy = await request(app)
        .get('/api/auth/google?returnTo=%2Foverview')
        .set('Host', 'metrics.hushh.ai');

      expect(legacy.status).toBe(307);
      expect(legacy.headers.location).toBe('https://metrics.hussh.ai/api/auth/google?returnTo=%2Foverview');
      expect(legacy.headers['cache-control']).toBe('no-store');
      expect(getSetCookies(legacy)).toEqual([]);

      const canonical = await request(app)
        .get('/api/auth/google?returnTo=%2Foverview')
        .set('Host', 'metrics.hussh.ai');
      expect(canonical.status).toBe(302);
      expect(new URL(canonical.headers.location).hostname).toBe('accounts.google.com');
      expect(getSetCookies(canonical).some((cookie) => cookie.startsWith('oauth_pkce='))).toBe(true);
    });

    it('sets PKCE cookie and redirects to Google auth URL with correct parameters (no hd parameter)', async () => {
      const { res, location } = await initiateOAuth();
      expect(res.status).toBe(302);

      const url = new URL(location);
      expect(url.origin).toBe('https://accounts.google.com');
      expect(url.pathname).toBe('/o/oauth2/v2/auth');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('client_id')).toBe(testConfig.clientId);
      expect(url.searchParams.get('redirect_uri')).toBe(testConfig.redirectUri);
      expect(url.searchParams.get('scope')).toBe('openid email profile');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('code_challenge')).toBeTruthy();
      expect(url.searchParams.get('state')).toBeTruthy();
      expect(url.searchParams.get('nonce')).toBeTruthy();
      expect(url.searchParams.has('hd')).toBe(false); // MUST NOT include hd parameter
    });

    it('handles prompt parameter allow-list (allows select_account, rejects others)', async () => {
      const { location: loc1 } = await initiateOAuth('?prompt=select_account');
      const url1 = new URL(loc1);
      expect(url1.searchParams.get('prompt')).toBe('select_account');

      const { location: loc2 } = await initiateOAuth('?prompt=admin_consent');
      const url2 = new URL(loc2);
      expect(url2.searchParams.has('prompt')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Callback Authentication & Cookie Verification
  // -------------------------------------------------------------------------
  describe('OAuth Callback & Session Creation', () => {
    it('authenticates valid @hushh.ai user, clears oauth_pkce, sets hussh_matrix_session (~8h, HttpOnly, SameSite=Lax, Secure under HTTPS)', async () => {
      const { pkceCookie, state, nonce } = await initiateOAuth();

      mockVerifyIdTokenImpl = async () => ({
        getPayload: () => ({
          email: 'ankit@hushh.ai',
          hd: 'hushh.ai',
          email_verified: true,
          name: 'Ankit',
          nonce,
        }),
      });

      const res = await request(app)
        .get(`/auth/callback?code=mock_code_123&state=${state}`)
        .set('Cookie', [pkceCookie])
        .set('X-Forwarded-Proto', 'https');

      expect(res.status).toBe(302);
      expect(res.headers['location']).toBe('/');

      const setCookies = getSetCookies(res);
      expect(setCookies.length).toBeGreaterThanOrEqual(2);

      // Verify oauth_pkce was cleared
      const pkceClear = setCookies.find((c: string) => c.startsWith('oauth_pkce='));
      expect(pkceClear).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');

      // Verify session cookie flags
      const sessionCookie = setCookies.find((c: string) => c.startsWith('hussh_matrix_session='));
      expect(sessionCookie).toBeTruthy();
      expect(sessionCookie).toContain('HttpOnly');
      expect(sessionCookie).toContain('SameSite=Lax');
      expect(sessionCookie).toContain('Secure'); // Assert Secure flag on X-Forwarded-Proto: https
      expect(sessionCookie).toContain('Max-Age=28800'); // Assert exp ~8 hours
    });

    it('allows whitelisted Gmail account and performs case-insensitive email matching', async () => {
      const { pkceCookie, state, nonce } = await initiateOAuth();

      mockVerifyIdTokenImpl = async () => ({
        getPayload: () => ({
          email: 'ROOPMANNVARADHARAJ@GMAIL.COM', // Uppercase test
          email_verified: true,
          nonce,
        }),
      });

      const res = await request(app)
        .get(`/auth/callback?code=mock_code_123&state=${state}`)
        .set('Cookie', [pkceCookie]);

      expect(res.status).toBe(302);
      expect(res.headers['location']).toBe('/');
      const sessionCookie = getSetCookies(res).find((c: string) => c.startsWith('hussh_matrix_session='));
      expect(sessionCookie).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // 4. Authorization Denial Scenarios
  // -------------------------------------------------------------------------
  describe('Authorization Denials (HTTP 403 Forbidden & No Session Cookie)', () => {
    it('accepts verified Google Workspace accounts on the new domain', () => {
      expect(checkUserAuthorization(
        { email: 'teammate@hussh.ai', hd: 'hussh.ai', email_verified: true },
        testConfig.allowedDomains,
        []
      ).authorized).toBe(true);
    });

    it('does not write account emails into authentication logs', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});

      checkUserAuthorization({ email: 'outside@example.com', email_verified: true }, testConfig.allowedDomains, []);
      checkUserAuthorization({ email: 'teammate@hushh.ai', hd: 'hushh.ai', email_verified: true }, testConfig.allowedDomains, []);

      expect(warn).toHaveBeenCalled();
      expect(log).toHaveBeenCalled();
      expect(JSON.stringify([...warn.mock.calls, ...log.mock.calls])).not.toMatch(/outside@example\.com|teammate@hushh\.ai/);
    });

    it('denies non-whitelisted personal Gmail account (HTTP 403 & no session cookie)', async () => {
      const { pkceCookie, state, nonce } = await initiateOAuth();

      mockVerifyIdTokenImpl = async () => ({
        getPayload: () => ({
          email: 'unauthorized@gmail.com',
          email_verified: true,
          nonce,
        }),
      });

      const res = await request(app)
        .get(`/auth/callback?code=mock_code_123&state=${state}`)
        .set('Cookie', [pkceCookie]);

      expect(res.status).toBe(403);
      expect(res.text).toContain('Access Denied');
      const sessionCookie = getSetCookies(res).find((c: string) => c.startsWith('hussh_matrix_session='));
      expect(sessionCookie).toBeUndefined(); // Assert NO hussh_matrix_session Set-Cookie
    });

    it('denies @hushh.ai email with missing hd claim if not whitelisted', async () => {
      const { pkceCookie, state, nonce } = await initiateOAuth();

      mockVerifyIdTokenImpl = async () => ({
        getPayload: () => ({
          email: 'unwhitelisted@hushh.ai',
          email_verified: true,
          hd: undefined, // Missing hd claim
          nonce,
        }),
      });

      const res = await request(app)
        .get(`/auth/callback?code=mock_code_123&state=${state}`)
        .set('Cookie', [pkceCookie]);

      expect(res.status).toBe(403);
      const sessionCookie = getSetCookies(res).find((c: string) => c.startsWith('hussh_matrix_session='));
      expect(sessionCookie).toBeUndefined();
    });

    it('denies hd=hushh.ai when email domain is evilhushh.ai', async () => {
      const { pkceCookie, state, nonce } = await initiateOAuth();

      mockVerifyIdTokenImpl = async () => ({
        getPayload: () => ({
          email: 'attacker@evilhushh.ai',
          hd: 'hushh.ai',
          email_verified: true,
          nonce,
        }),
      });

      const res = await request(app)
        .get(`/auth/callback?code=mock_code_123&state=${state}`)
        .set('Cookie', [pkceCookie]);

      expect(res.status).toBe(403);
      const sessionCookie = getSetCookies(res).find((c: string) => c.startsWith('hussh_matrix_session='));
      expect(sessionCookie).toBeUndefined();
    });

    it('denies email with more than 2 parts when split on @ (e.g. a@b@hushh.ai)', async () => {
      const { pkceCookie, state, nonce } = await initiateOAuth();

      mockVerifyIdTokenImpl = async () => ({
        getPayload: () => ({
          email: 'a@b@hushh.ai',
          hd: 'hushh.ai',
          email_verified: true,
          nonce,
        }),
      });

      const res = await request(app)
        .get(`/auth/callback?code=mock_code_123&state=${state}`)
        .set('Cookie', [pkceCookie]);

      expect(res.status).toBe(403);
      const sessionCookie = getSetCookies(res).find((c: string) => c.startsWith('hussh_matrix_session='));
      expect(sessionCookie).toBeUndefined();
    });

    it('denies unverified email account (email_verified: false)', async () => {
      const { pkceCookie, state, nonce } = await initiateOAuth();

      mockVerifyIdTokenImpl = async () => ({
        getPayload: () => ({
          email: 'user@hushh.ai',
          hd: 'hushh.ai',
          email_verified: false,
          nonce,
        }),
      });

      const res = await request(app)
        .get(`/auth/callback?code=mock_code_123&state=${state}`)
        .set('Cookie', [pkceCookie]);

      expect(res.status).toBe(403);
      const sessionCookie = getSetCookies(res).find((c: string) => c.startsWith('hussh_matrix_session='));
      expect(sessionCookie).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // 5. Parameter Validation & Error Handling (HTTP 400 Bad Request)
  // -------------------------------------------------------------------------
  describe('Callback Parameter Errors & Rejections', () => {
    it('returns HTTP 400 when oauth_pkce, code, or state are missing', async () => {
      const res = await request(app).get('/auth/callback?code=123');
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid or missing OAuth state');
      const sessionCookie = getSetCookies(res).find((c: string) => c.startsWith('hussh_matrix_session='));
      expect(sessionCookie).toBeUndefined();
    });

    it('returns HTTP 400 on state mismatch (CSRF protection)', async () => {
      const { pkceCookie } = await initiateOAuth();
      const res = await request(app)
        .get('/auth/callback?code=123&state=wrong_state')
        .set('Cookie', [pkceCookie]);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid or missing OAuth state');
      const sessionCookie = getSetCookies(res).find((c: string) => c.startsWith('hussh_matrix_session='));
      expect(sessionCookie).toBeUndefined();
    });

    it('returns HTTP 400 on nonce mismatch', async () => {
      const { pkceCookie, state } = await initiateOAuth();

      mockVerifyIdTokenImpl = async () => ({
        getPayload: () => ({
          email: 'user@hushh.ai',
          hd: 'hushh.ai',
          email_verified: true,
          nonce: 'invalid-nonce-mismatch',
        }),
      });

      const res = await request(app)
        .get(`/auth/callback?code=mock_code&state=${state}`)
        .set('Cookie', [pkceCookie]);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('ID token nonce mismatch.');
      const sessionCookie = getSetCookies(res).find((c: string) => c.startsWith('hussh_matrix_session='));
      expect(sessionCookie).toBeUndefined();
    });

    it('handles getToken rejection cleanly (HTTP 400, no session, no stack trace)', async () => {
      const { pkceCookie, state } = await initiateOAuth();

      mockGetTokenImpl = async () => {
        throw new Error('Google OAuth server connection error');
      };

      const res = await request(app)
        .get(`/auth/callback?code=mock_code&state=${state}`)
        .set('Cookie', [pkceCookie]);

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'OAuth token exchange failed.' });
      expect(res.text).not.toContain('stack');
      const sessionCookie = getSetCookies(res).find((c: string) => c.startsWith('hussh_matrix_session='));
      expect(sessionCookie).toBeUndefined();
    });

    it('handles verifyIdToken rejection cleanly (HTTP 400, no session, no stack trace)', async () => {
      const { pkceCookie, state } = await initiateOAuth();

      mockVerifyIdTokenImpl = async () => {
        throw new Error('ID Token signature invalid');
      };

      const res = await request(app)
        .get(`/auth/callback?code=mock_code&state=${state}`)
        .set('Cookie', [pkceCookie]);

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'OAuth ID token verification failed.' });
      expect(res.text).not.toContain('stack');
      const sessionCookie = getSetCookies(res).find((c: string) => c.startsWith('hussh_matrix_session='));
      expect(sessionCookie).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // 6. returnTo Open Redirect Protection (Test 8)
  // -------------------------------------------------------------------------
  describe('returnTo Open Redirect Protection', () => {
    const maliciousTargets = [
      '//evil.com',
      '/\\evil.com',
      'https://evil.com',
      'javascript:alert(1)',
      '%2F%2Fevil.com',
      '/%5Cevil.com',
    ];

    it.each(maliciousTargets)('sanitizes malicious returnTo (%s) back to /', async (target) => {
      const { pkceCookie, state, nonce } = await initiateOAuth(`?returnTo=${encodeURIComponent(target)}`);

      mockVerifyIdTokenImpl = async () => ({
        getPayload: () => ({
          email: 'ankit@hushh.ai',
          hd: 'hushh.ai',
          email_verified: true,
          nonce,
        }),
      });

      const res = await request(app)
        .get(`/auth/callback?code=mock_code&state=${state}`)
        .set('Cookie', [pkceCookie]);

      expect(res.status).toBe(302);
      expect(res.headers['location']).toBe('/');
    });

    it('preserves valid relative returnTo targets (e.g. /dashboard?tab=x)', async () => {
      const validTarget = '/dashboard?tab=x';
      const { pkceCookie, state, nonce } = await initiateOAuth(`?returnTo=${encodeURIComponent(validTarget)}`);

      mockVerifyIdTokenImpl = async () => ({
        getPayload: () => ({
          email: 'ankit@hushh.ai',
          hd: 'hushh.ai',
          email_verified: true,
          nonce,
        }),
      });

      const res = await request(app)
        .get(`/auth/callback?code=mock_code&state=${state}`)
        .set('Cookie', [pkceCookie]);

      expect(res.status).toBe(302);
      expect(res.headers['location']).toBe('/dashboard?tab=x');
    });
  });

  // -------------------------------------------------------------------------
  // 7. Session Validation & Endpoints
  // -------------------------------------------------------------------------
  describe('Session Lifecycle & Auth Endpoints', () => {
    it('returns user session info on GET /api/auth/me when authenticated', async () => {
      const sessionUser = {
        email: 'ankit@hushh.ai',
        name: 'Ankit',
        picture: 'https://example.com/photo.jpg',
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const signedSession = signCookie(JSON.stringify(sessionUser), testConfig.sessionSecret);

      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', [`hussh_matrix_session=${encodeURIComponent(signedSession)}`]);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        authenticated: true,
        user: {
          email: 'ankit@hushh.ai',
          name: 'Ankit',
          picture: 'https://example.com/photo.jpg',
        },
      });
    });

    it('rejects expired session cookie (HTTP 401 on protected API)', async () => {
      const expiredUser = {
        email: 'ankit@hushh.ai',
        name: 'Ankit',
        picture: '',
        exp: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
      };
      const signedSession = signCookie(JSON.stringify(expiredUser), testConfig.sessionSecret);

      const res = await request(app)
        .get('/api/analytics/hushh_ai')
        .set('Cookie', [`hussh_matrix_session=${encodeURIComponent(signedSession)}`]);

      expect(res.status).toBe(401);
    });

    it('rejects tampered session cookie signature', async () => {
      const sessionUser = {
        email: 'ankit@hushh.ai',
        name: 'Ankit',
        picture: '',
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const signedSession = signCookie(JSON.stringify(sessionUser), testConfig.sessionSecret);
      const tamperedCookie = signedSession.slice(0, -5) + 'xxxxx';

      const res = await request(app)
        .get('/api/analytics/hushh_ai')
        .set('Cookie', [`hussh_matrix_session=${encodeURIComponent(tamperedCookie)}`]);

      expect(res.status).toBe(401);
    });

    it('handles logout: GET /api/auth/logout -> HTTP 405, POST /api/auth/logout -> clears cookie', async () => {
      const getRes = await request(app).get('/api/auth/logout');
      expect(getRes.status).toBe(405);

      const postRes = await request(app).post('/api/auth/logout');
      expect(postRes.status).toBe(200);
      expect(postRes.body).toEqual({ success: true });
      const setCookie = getSetCookies(postRes)[0] || '';
      expect(setCookie).toContain('hussh_matrix_session=;');
      expect(setCookie).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    });

    it('returns HTTP 404 for deleted auth routes (/api/auth/verify-email, /api/auth/verify, /api/auth/config, /auth/unknown)', async () => {
      const r1 = await request(app).get('/api/auth/verify-email');
      expect(r1.status).toBe(404);

      const r2 = await request(app).post('/api/auth/verify');
      expect(r2.status).toBe(404);

      const r3 = await request(app).get('/api/auth/config');
      expect(r3.status).toBe(404);

      const r4 = await request(app).get('/auth/unknown');
      expect(r4.status).toBe(404);
    });

    it('serves public pages (/login -> 200, /access-denied -> 403)', async () => {
      const loginRes = await request(app).get('/login');
      expect(loginRes.status).toBe(200);

      const deniedRes = await request(app).get('/access-denied');
      expect(deniedRes.status).toBe(403);
    });

    it('does not redirect static asset requests (/assets/x.js, /favicon.ico) to /login when unauthenticated', async () => {
      const assetRes = await request(app).get('/assets/x.js');
      expect(assetRes.status).not.toBe(302);
      expect(assetRes.headers['location']).toBeUndefined();

      const faviconRes = await request(app).get('/favicon.ico');
      expect(faviconRes.status).not.toBe(302);
      expect(faviconRes.headers['location']).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // 8. Fail-Closed Startup Configuration Validation
  // -------------------------------------------------------------------------
  describe('Startup Configuration Validation (validateConfig)', () => {
    it('fails when isProduction is true, requireAuth is false, and allowPublicDashboard is false', () => {
      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      validateConfig({
        ...testConfig,
        isProduction: true,
        requireAuth: false,
        allowPublicDashboard: false,
      });

      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('Production environment cannot run with REQUIRE_AUTH=false')
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('fails when required OAuth environment variables are missing', () => {
      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      validateConfig({
        ...testConfig,
        clientId: '',
      });

      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('Missing required OAuth environment variables: GOOGLE_CLIENT_ID')
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('fails when GOOGLE_REDIRECT_URI is missing in production mode', () => {
      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      validateConfig({
        ...testConfig,
        isProduction: true,
        redirectUri: '',
      });

      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('Missing required OAuth environment variables: GOOGLE_REDIRECT_URI')
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('fails when SESSION_SECRET is fewer than 32 characters', () => {
      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      validateConfig({
        ...testConfig,
        sessionSecret: 'short-secret',
      });

      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('SESSION_SECRET must be at least 32 characters long')
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });
});
