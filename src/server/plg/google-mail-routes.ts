import type express from 'express';
import { randomUUID } from 'node:crypto';
import type { PlgTemplate } from '../../lib/plg';
import { PlgError } from './engine';
import { GoogleMail, GoogleMailOAuth, GoogleMailUnattempted } from './google-mail';
import { FirestoreMailControl, MAIL_OWNER, SecretManagerMailCredentials } from './google-mail-store';
import { escapeHtml, type PlgRuntime } from './service';
import { renderPlgTestPreview } from './test-preview';

export function configuredGoogleMail() {
  if (process.env.PLG_GOOGLE_MAIL_ENABLED !== 'true') return undefined;
  if (!process.env.PLG_FIRESTORE_PROJECT || !process.env.PLG_FIRESTORE_DATABASE || !process.env.GOOGLE_CLIENT_ID ||
    !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REDIRECT_URI)
    throw new PlgError(503, 'Google mail is not configured.');
  return new GoogleMail(new FirestoreMailControl(process.env.PLG_FIRESTORE_PROJECT, process.env.PLG_FIRESTORE_DATABASE),
    new SecretManagerMailCredentials(process.env.PLG_GOOGLE_MAIL_CREDENTIAL_SECRET || ''),
    new GoogleMailOAuth({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri: process.env.GOOGLE_REDIRECT_URI }));
}
export function registerGoogleMailRoutes(app: express.Express, config: PlgRuntime,
  templates: () => Promise<PlgTemplate[]>, injected?: GoogleMail) {
  let mail = injected;
  const get = () => {
    mail ??= configuredGoogleMail();
    if (!config.enabled || !mail) throw new PlgError(503, 'Google mail connection is not enabled.');
    return mail;
  };
  const owner = (req: express.Request) => {
    const email = (req as any).sessionUser?.email?.toLowerCase();
    if (!email) throw new PlgError(401, 'Authentication required.');
    if (email !== MAIL_OWNER || !config.admins.has(email)) throw new PlgError(403, 'The configured mailbox owner must perform this action.');
    if (req.method !== 'GET' && req.get('Origin') !== config.origin) throw new PlgError(403, 'Invalid request origin.');
  };
  const handle = (fn: (req: express.Request, res: express.Response) => Promise<unknown>): express.RequestHandler => (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
    Promise.resolve().then(() => { owner(req); return fn(req, res); }).catch((error) => {
      if (!res.headersSent) res.status(error instanceof PlgError ? error.status : 503)
        .json({ error: error instanceof PlgError ? error.message : 'Google mail did not confirm success. Check connection status before retrying.' });
    });
  };
  const cookie = (req: express.Request, value: string, age: number) =>
    `plg_mail_pkce=${value}; Path=/; Max-Age=${age}; HttpOnly; SameSite=Lax${req.secure || req.get('X-Forwarded-Proto') === 'https' || process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
  app.get('/api/plg/google-mail/status', handle(async (_req, res) => res.json(await get().status())));
  app.post('/api/plg/google-mail/connect', handle(async (req, res) => {
    if (Object.keys(req.body ?? {}).length) throw new PlgError(400, 'No mailbox override is accepted.');
    const result = await get().begin();
    res.setHeader('Set-Cookie', cookie(req, result.cookie, 600));
    return res.json({ url: result.url });
  }));
  app.post('/api/plg/google-mail/disconnect', handle(async (_req, res) => { await get().disconnect(); return res.json({ disconnected: true }); }));
  // Dispatch only our purpose-prefixed state. The existing sign-in callback and
  // its identity-only scopes remain unchanged for every dashboard user.
  app.get('/auth/callback', (req, res, next) => {
    if (typeof req.query.state !== 'string' || !req.query.state.startsWith('plg-mail.')) return next();
    return handle(async (req, res) => {
      const value = req.headers.cookie?.split(';').map((v) => v.trim()).find((v) => v.startsWith('plg_mail_pkce='))?.slice(14) ?? '';
      res.setHeader('Set-Cookie', cookie(req, '', 0));
      if (req.query.error || typeof req.query.code !== 'string') throw new PlgError(400, 'Google mail permission was not granted.');
      await get().complete(req.query.state as string, req.query.code, value);
      return res.redirect(303, '/plg');
    })(req, res, next);
  });
  app.get('/api/plg/mail-tests', handle(async (_req, res) => {
    const google = get();
    const before = await google.store.read();
    // Seven per day, max 50 retained. Read exact accepted message metadata only.
    await Promise.all(before.tests.filter((t) => t.status === 'accepted' && Date.now() - t.createdAt < 86_400_000).slice(-7).map(async (test) => {
      try {
        if (test.providerId && await google.confirmOwnInbox(test.providerId, test.id)) await google.store.transaction((s) => {
          const current = s.tests.find((t) => t.id === test.id);
          if (current?.status === 'accepted' && current.providerId === test.providerId) {
            current.status = 'inbox_confirmed'; current.confirmedAt = Date.now();
          }
        });
      } catch { /* Keep acceptance visible; missing receipt never becomes delivery proof. */ }
    }));
    return res.json({ recipient: MAIL_OWNER, tests: (await google.store.read()).tests });
  }));
  app.post('/api/plg/mail-tests', handle(async (req, res) => {
    if (Object.keys(req.body ?? {}).some((k) => k !== 'templateId') || typeof req.body?.templateId !== 'string')
      throw new PlgError(400, 'Choose an existing draft template. Recipient overrides are not accepted.');
    const google = get();
    const template = (await templates()).find((t) => t.id === req.body.templateId);
    if (!template) throw new PlgError(404, 'Template not found.');
    const preview = renderPlgTestPreview(template);
    const at = Date.now();
    const reservation = await google.store.transaction((s) => {
      if (!s.connection) throw new PlgError(409, 'Connect the work mailbox first.');
      const recent = s.tests.filter((t) => at - t.createdAt < 86_400_000 && t.status !== 'failed');
      if (recent.some((t) => t.step === template.step)) throw new PlgError(409, 'This step already has a test reservation today. Inspect its status; it will not be resent.');
      if (recent.length >= 7) throw new PlgError(409, 'The seven-step test limit has been reached today.');
      const test = { id: randomUUID(), templateId: template.id, step: template.step, subject: preview.subject, createdAt: at,
        status: 'sending' as const, providerId: null, confirmedAt: null };
      const blockingIds = new Set(recent.map((t) => t.id));
      const history = s.tests.filter((t) => !blockingIds.has(t.id)).slice(-(49 - recent.length));
      // Failed setup retries cannot evict a day's accepted/ambiguous reservation
      // and accidentally make that step eligible for a duplicate send.
      s.tests = [...history, ...recent].sort((a, b) => a.createdAt - b.createdAt).concat(test);
      return test;
    });
    const text = `${preview.body}${preview.resourceUrl ? `\n\nDemo or guide: ${preview.resourceUrl}` : ''}\n\n${preview.ctaLabel}: ${preview.ctaUrl}`;
    try {
      const id = await google.send(MAIL_OWNER, reservation, { text, html: `<pre style="white-space:pre-wrap">${escapeHtml(text)}</pre>`, headers: {} });
      await google.store.transaction((s) => {
        const test = s.tests.find((t) => t.id === reservation.id)!;
        test.providerId = id; test.status = 'accepted';
      });
    } catch (error) {
      await google.store.transaction((s) => {
        const test = s.tests.find((t) => t.id === reservation.id);
        if (test?.status === 'sending') test.status = error instanceof GoogleMailUnattempted ? 'failed' : 'unknown';
      });
    }
    return res.status(202).json({ recipient: MAIL_OWNER, test: (await google.store.read()).tests.find((t) => t.id === reservation.id) });
  }));
}
