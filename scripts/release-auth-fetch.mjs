/** Add the QA session only to the exact dashboard origin being verified. */
import assert from 'node:assert/strict';

const target = new URL(process.env.METRICS_DASHBOARD_URL || '');
const cookie = process.env.METRICS_AUTH_COOKIE || '';
assert(cookie.startsWith('hussh_matrix_session='), 'A signed release session is required');
const originalFetch = globalThis.fetch.bind(globalThis);
let affinityCookie = '';
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.origin !== target.origin) return originalFetch(input, init);
  const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
  headers.set('Cookie', affinityCookie ? `${cookie}; ${affinityCookie}` : cookie);
  const response = await originalFetch(input, { ...init, headers });
  // Cloud Run's routing cookie is held in memory, just as in a browser session.
  // Do not import authentication cookies or cookies from a redirect destination.
  if (!response.url || new URL(response.url).origin === target.origin) {
    for (const value of response.headers.getSetCookie()) {
      if (value.startsWith('GAESA=')) affinityCookie = value.split(';', 1)[0];
    }
  }
  return response;
};
