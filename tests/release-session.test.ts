import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { expect, it } from 'vitest';

it('signs QA sessions with the same trimmed secret as the production server', () => {
  const secret = 'test-release-signing-secret-at-least-thirty-two-characters';
  const cookie = execFileSync(process.execPath, ['scripts/create-release-session.mjs'], {
    encoding: 'utf8', env: { ...process.env, SESSION_SECRET: `  ${secret}\r\n` },
  });
  const signed = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1));
  const split = signed.lastIndexOf('.');
  const payload = signed.slice(2, split);
  expect(signed.startsWith('s:')).toBe(true);
  expect(signed.slice(split + 1)).toBe(createHmac('sha256', secret).update(payload).digest('base64url'));
  expect(JSON.parse(payload).exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
});
