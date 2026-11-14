import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { reportingSession } from '../src/server/reports/session';
import { digest } from '../src/server/reports/contracts';

const env = { SESSION_SECRET: 'local-session-fixture-'.repeat(3), METRICS_SCOPE_DIGEST: digest('scope'),
  ALLOWED_EMAIL_DOMAINS: 'hushh.ai', ALLOWED_EMAILS: 'approved@example.invalid' };
const now = Date.parse('2026-11-13T00:00:00Z');
function signed(email: string, exp: unknown = Math.floor(now / 1000) + 60) {
  const body = JSON.stringify({ email, name: 'Private name', picture: 'private-image', exp });
  return `s:${body}.${createHmac('sha256', env.SESSION_SECRET).update(body).digest('base64url')}`;
}
describe('Metrics session compatibility', () => {
  it('accepts the existing cookie format and returns only hashed authorization', () => {
    const access = reportingSession(signed('staff@hushh.ai'), env, now)!;
    expect(Object.keys(access).sort()).toEqual(['scopeDigest', 'subjectHash']);
    expect(JSON.stringify(access)).not.toMatch(/staff|Private name|private-image/);
    expect(reportingSession(signed('approved@example.invalid'), env, now)).not.toBeNull();
  });
  it('rechecks current allowlists and expiry for every read', () => {
    const cookie = signed('staff@hushh.ai');
    expect(reportingSession(cookie, { ...env, ALLOWED_EMAIL_DOMAINS: '' }, now)).toBeNull();
    expect(reportingSession(cookie, env, now + 60_000)).toBeNull();
    expect(reportingSession(signed('staff@hushh.ai', 'tomorrow'), env, now)).toBeNull();
    expect(reportingSession(signed('staff@hushh.ai.evil.invalid'), env, now)).toBeNull();
  });
  it('fails closed without secret/scope and rejects tampered or oversized cookies', () => {
    expect(reportingSession(signed('staff@hushh.ai'), {}, now)).toBeNull();
    expect(reportingSession(signed('staff@hushh.ai') + 'x', env, now)).toBeNull();
    expect(reportingSession('s:' + 'x'.repeat(5000), env, now)).toBeNull();
  });
});
