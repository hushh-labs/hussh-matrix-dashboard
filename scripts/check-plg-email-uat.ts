/** Isolated renderer acceptance: synthetic inputs only, no source/DB/provider access. */
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import dns from 'node:dns';
import { syncBuiltinESMExports } from 'node:module';

let networkAttempts = 0, sendAttempts = 0, passedChecks = 0;
const noNetwork = () => { networkAttempts++; throw new Error('renderer_uat_network_forbidden'); };
const noSend = () => { sendAttempts++; throw new Error('renderer_uat_send_forbidden'); };
globalThis.fetch = async () => noNetwork();
for (const [owner, names] of [
  [http, ['request', 'get']], [https, ['request', 'get']], [net, ['connect', 'createConnection']],
  [net.Socket.prototype, ['connect']], [dns, ['lookup', 'resolve']], [dns.promises, ['lookup', 'resolve']],
] as const) for (const name of names) Object.defineProperty(owner, name, { value: noNetwork, configurable: true });
syncBuiltinESMExports();

try {
  const disabled = ['PLG_ENABLED', 'PLG_DELIVERY_ENABLED', 'PLG_GOOGLE_MAIL_ENABLED', 'PLG_GOOGLE_MAIL_CAMPAIGNS_ENABLED'];
  for (const key of Object.keys(process.env)) {
    if (/^(PLG_|DB_|DATABASE_URL$|GOOGLE_APPLICATION_CREDENTIALS$|GOOGLE_GHA_CREDS_PATH$)/.test(key))
      assert.ok(disabled.includes(key) && process.env[key] === 'false');
  }
  const { deliveryMessage, PlgService } = await import('../src/server/plg/service');
  const { renderPlgEmailHtml } = await import('../src/server/plg/email-layout');
  const { renderPlgTestPreview } = await import('../src/server/plg/test-preview');
  const { googleMailMime, GoogleMail } = await import('../src/server/plg/google-mail');
  GoogleMail.prototype.send = async () => noSend();
  PlgService.prototype.run = async () => noSend();
  const delivery = {
    id: '00000000-0000-4000-8000-000000000001', contactId: '00000000-0000-4000-8000-000000000002',
    templateId: 'memory-welcome', step: 'welcome' as const, key: 'synthetic-uat-reservation', status: 'sent' as const,
    createdAt: '2026-10-27T00:00:00Z', providerId: null,
    subject: 'One <img src=x onerror=alert(1)> & your next task',
    body: 'Review <script>unsafe()</script> before saving.\n\nFind your note again — at your pace.',
    ctaLabel: 'Open <Memory>', ctaUrl: 'https://one.hussh.ai/one/pkm?from=uat&step=1',
    resourceUrl: 'https://one.hussh.ai/one?guide=1&source=uat',
  };
  const config = { origin: 'https://email-uat.example.invalid', signingSecret: 'synthetic-renderer-uat-key-with-no-runtime-authority' };
  const generation = '00000000-0000-4000-8000-000000000003';
  const message = deliveryMessage(delivery, delivery.contactId, config as Parameters<typeof deliveryMessage>[2], generation);
  assert.ok(message.html.includes('&lt;img src=x onerror=alert(1)&gt; &amp; your next task'));
  assert.ok(message.html.includes('&lt;script&gt;unsafe()&lt;/script&gt;'));
  assert.ok(!/<script|<iframe|<form/i.test(message.html));
  assert.equal((message.html.match(/<img\b/g) ?? []).length, 1);
  passedChecks++;

  assert.ok(message.html.includes('href="https://one.hussh.ai/one/pkm?from=uat&amp;step=1"'));
  assert.ok(message.html.includes('Open &lt;Memory&gt;'));
  assert.ok(message.html.includes('src="https://metrics.hussh.ai/assets/hussh-mark.png"'));
  assert.ok(message.html.includes('>hussh</td>'));
  assert.ok(message.html.includes('https://www.hushh.ai/privacy'));
  assert.ok(message.html.includes('https://www.hushh.ai/terms'));
  passedChecks++;

  const unsubscribe = message.headers['List-Unsubscribe'].slice(1, -1);
  const preferences = unsubscribe.replace('/unsubscribe/', '/preferences/');
  assert.ok(unsubscribe.startsWith(`${config.origin}/integrations/plg/unsubscribe/${delivery.contactId}.${generation}.`));
  assert.equal(message.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.ok(message.html.includes(`href="${unsubscribe}"`));
  assert.ok(message.html.includes(`href="${preferences}"`));
  assert.equal(message.text, `${delivery.body}\n\nDemo or guide: ${delivery.resourceUrl}\n\n${delivery.ctaLabel}: ${delivery.ctaUrl}\n\nPreferences: ${preferences}\nUnsubscribe: ${unsubscribe}`);
  passedChecks++;

  const raw = Buffer.from(googleMailMime('renderer-uat@example.invalid', delivery, message), 'base64url').toString();
  for (const [type, expected] of [['plain', message.text], ['html', message.html]]) {
    const part = raw.match(new RegExp(`Content-Type: text/${type}; charset=UTF-8\\r\\nContent-Transfer-Encoding: base64\\r\\n\\r\\n([A-Za-z0-9+/=\\r\\n]+)\\r\\n--plg_`));
    assert.ok(part);
    assert.equal(Buffer.from(part[1].replaceAll('\r\n', ''), 'base64').toString(), expected);
  }
  passedChecks++;

  const template = { ...delivery, id: 'memory-welcome', journey: 'memory' as const, published: false, version: 1 };
  const preview = renderPlgTestPreview(template);
  const html = renderPlgEmailHtml({ ...preview, preview: true });
  assert.ok(preview.subject.startsWith('[PLG TEST] WELCOME: '));
  assert.ok(html.includes('PLG TEST PREVIEW'));
  assert.ok(html.includes('Customer preferences are unchanged.'));
  assert.ok(!html.includes('/integrations/plg/preferences/') && !html.includes('/integrations/plg/unsubscribe/'));
  assert.ok(html.includes('src="https://metrics.hussh.ai/assets/hussh-mark.png"'));
  passedChecks++;

  assert.equal(networkAttempts, 0);
  assert.equal(sendAttempts, 0);
  console.log(JSON.stringify({ ok: true, scope: 'isolated-email-renderer', passedChecks, networkAttempts, sendAttempts, syntheticOnly: true }));
} catch {
  console.error(JSON.stringify({ ok: false, scope: 'isolated-email-renderer', passedChecks, networkAttempts, sendAttempts }));
  process.exitCode = 1;
}
