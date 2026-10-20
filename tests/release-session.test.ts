import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
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

it('emits explicit disabled PLG runtime flags and binds sender independently from live delivery', () => {
  const workflow = readFileSync('.github/workflows/deploy-main.yml', 'utf8');
  const block = workflow.split('      - name: Deploy Cloud Run service')[1]
    .split('          gcloud run deploy')[0].split('        run: |')[1]
    .split('\n').map((line) => line.replace(/^          /, '')).join('\n');
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
  const script = `set -e\nfunction gcloud() { if [[ "$1" == "firestore" ]]; then echo FIRESTORE_NATIVE; else echo ENABLED; fi; }\n${block}\nprintf '%s\\n' "$PLG_ENV_SUFFIX" "$PLG_SECRET_SUFFIX"`;
  const invoke = (workspace: boolean, sender: boolean, delivery: boolean) => execFileSync(bash, ['-c', script], {
    encoding: 'utf8', env: { ...process.env, PROJECT_ID: 'example-project', PRODUCTION_URL: 'https://metrics.example.invalid',
      ONE_PLG_CONFIGURED: String(workspace), ONE_PLG_SENDER_CONFIGURED: String(sender), ONE_PLG_DELIVERY_CONFIGURED: String(delivery), ONE_PLG_AUDIENCE_CONFIGURED: 'false' },
  });
  const disabled = invoke(false, false, false);
  expect(disabled).toContain('|PLG_ENABLED=false|PLG_DELIVERY_ENABLED=false|');
  const identity = invoke(true, true, false);
  expect(identity).toContain('PLG_DELIVERY_ENABLED=false');
  expect(identity).toContain('PLG_EMAIL_FROM=metrics-one-plg-email-from:latest');
  expect(identity).not.toContain('PLG_RESEND_API_KEY=');
  const live = invoke(true, true, true);
  expect(live).toContain('PLG_DELIVERY_ENABLED=true');
  expect(live).toContain('PLG_RESEND_API_KEY=metrics-one-plg-resend-api-key:latest');
});
