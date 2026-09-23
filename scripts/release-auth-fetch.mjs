/** Add the QA session only to the exact dashboard origin being verified. */
import assert from 'node:assert/strict';

const target = new URL(process.env.METRICS_DASHBOARD_URL || '');
const cookie = process.env.METRICS_AUTH_COOKIE || '';
assert(cookie.startsWith('hussh_matrix_session='), 'A signed release session is required');
const originalFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input, init = {}) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.origin !== target.origin) return originalFetch(input, init);
  const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
  headers.set('Cookie', cookie);
  return originalFetch(input, { ...init, headers });
};
