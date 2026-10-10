#!/usr/bin/env node
/** Read-only, anonymous production probe for the Google sign-in boundary. */
import assert from 'node:assert/strict';

const base = (process.env.METRICS_DASHBOARD_URL || 'https://metrics.hussh.ai').replace(/\/$/, '');
const clientId = process.env.GOOGLE_CLIENT_ID;
const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${base}/auth/callback`;
assert(clientId, 'GOOGLE_CLIENT_ID is required for the OAuth release probe');

async function get(path) {
  return fetch(`${base}${path}`, {
    redirect: 'manual',
    headers: { Accept: 'text/html,application/json' },
    signal: AbortSignal.timeout(15_000),
  });
}

const home = await get('/');
assert.equal(home.status, 302, 'Unauthenticated dashboard must redirect to login');
assert.equal(new URL(home.headers.get('location'), base).pathname, '/login');

const login = await get('/login');
assert.equal(login.status, 200, 'Login page must be reachable');
assert.match(await login.text(), /<html|<!doctype html/i);

for (const path of ['/api/health', '/api/analytics/one/app']) {
  const response = await get(path);
  assert.equal(response.status, 401, `${path} must reject anonymous requests`);
  assert.match(response.headers.get('cache-control') || '', /no-store/);
}

const me = await get('/api/auth/me');
assert.equal(me.status, 200);
assert.deepEqual(await me.json(), { authenticated: false, user: null });

const start = await get('/api/auth/google');
assert.equal(start.status, 302, 'OAuth start must redirect to Google');
const destination = new URL(start.headers.get('location'));
assert.equal(destination.origin, 'https://accounts.google.com');
assert.equal(destination.searchParams.get('client_id'), clientId);
assert.equal(destination.searchParams.get('redirect_uri'), redirectUri);
assert.equal(destination.searchParams.get('code_challenge_method'), 'S256');
assert(destination.searchParams.get('code_challenge'));
assert(destination.searchParams.get('state'));
const cookie = start.headers.get('set-cookie') || '';
assert.match(cookie, /oauth_pkce=/);
assert.match(cookie, /HttpOnly/i);
assert.match(cookie, /Secure/i);
assert.match(cookie, /SameSite=Lax/i);

const invalidCallback = await get('/auth/callback');
assert.equal(invalidCallback.status, 400, 'Callback without state must fail closed');

console.log('Production Google sign-in boundary: anonymous access denied; OAuth redirect, PKCE and cookies configured.');
