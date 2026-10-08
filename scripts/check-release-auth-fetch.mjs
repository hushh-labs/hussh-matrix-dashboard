import assert from 'node:assert/strict';

process.env.METRICS_DASHBOARD_URL = 'https://metrics.example.test';
process.env.METRICS_AUTH_COOKIE = 'hussh_matrix_session=test-session';
const calls = [];
globalThis.fetch = async (input, init) => {
  calls.push({ url: String(input), cookie: new Headers(init?.headers).get('cookie') });
  return new Response('{}', { headers: { 'Set-Cookie': calls.length === 1
    ? 'GAESA=test-routing; Secure; HttpOnly; Path=/'
    : 'hussh_matrix_session=untrusted-replacement; Path=/' } });
};
await import('./release-auth-fetch.mjs');
await fetch('https://metrics.example.test/api/health');
await fetch('https://metrics.example.test/api/analytics/all');
await fetch('https://metrics.example.test/api/analytics/founder');
await fetch('https://other.example.test/api/health');
assert.equal(calls[0].cookie, 'hussh_matrix_session=test-session');
assert.equal(calls[1].cookie, 'hussh_matrix_session=test-session; GAESA=test-routing');
assert.equal(calls[2].cookie, calls[1].cookie, 'Provider cookies must not replace the signed QA session');
assert.equal(calls[3].cookie, null, 'Neither cookie can be forwarded outside the exact dashboard origin');
console.log(JSON.stringify({ ok: true, checks: ['affinity-retained', 'session-preserved', 'exact-origin-only'] }));
