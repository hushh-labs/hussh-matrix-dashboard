import type express from 'express';
import { Webhook } from 'svix';
import {
  audit,
  choose,
  enroll,
  ingestEnrollment,
  ingestEvent,
  PlgError,
  timeline,
  updateContact,
  updateTemplate,
} from './engine';
import { FilePlgStore, FirestorePlgStore, type PlgStore } from './store';
import { equalSignature, escapeHtml, plgRuntime, PlgService, signValue, tokenContact } from './service';

export function registerPlgRoutes(app: express.Express, production: boolean, injected?: PlgService) {
  const config = injected?.runtime ?? plgRuntime();
  let service = injected;
  const getService = () => {
    if (!config.enabled) throw new PlgError(503, 'PLG is not configured.');
    if (!service) {
      let store: PlgStore;
      if (process.env.PLG_STORAGE === 'firestore' && process.env.PLG_FIRESTORE_PROJECT)
        store = new FirestorePlgStore(process.env.PLG_FIRESTORE_PROJECT);
      else if (!production && process.env.PLG_STORAGE === 'local')
        store = new FilePlgStore(process.env.PLG_DATA_DIR || '.plg-data');
      else throw new PlgError(503, 'PLG storage is not configured.');
      service = new PlgService(store, config);
    }
    return service;
  };
  const handle =
    (
      fn: (req: express.Request, res: express.Response) => Promise<unknown> | unknown,
    ): express.RequestHandler =>
    (req, res) => {
      res.set({
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      });
      Promise.resolve()
        .then(() => fn(req, res))
        .catch((error) => {
          if (!res.headersSent)
            res
              .status(error instanceof PlgError ? error.status : 503)
              .json({ error: error instanceof PlgError ? error.message : 'PLG is temporarily unavailable.' });
        });
    };
  const role = (req: express.Request, admin = false) => {
    const email = (req as any).sessionUser?.email?.toLowerCase() as string | undefined;
    if (!email) throw new PlgError(401, 'Authentication required');
    const value = config.admins.has(email) ? 'admin' : config.operators.has(email) ? 'operator' : null;
    if (!value || (admin && value !== 'admin'))
      throw new PlgError(403, 'This action requires PLG workspace access.');
    if (req.method !== 'GET' && req.headers.origin !== config.origin)
      throw new PlgError(403, 'Invalid request origin');
    return { email, role: value as 'admin' | 'operator' };
  };
  const machine = (req: express.Request, purpose: string) => {
    const timestamp = req.get('X-PLG-Timestamp') || '';
    const signature = req.get('X-PLG-Signature') || '';
    const raw = (req as any).plgRawBody as string | undefined;
    if (
      !config.enabled ||
      config.signingSecret.length < 32 ||
      !/^\d{13}$/.test(timestamp) ||
      Math.abs(Date.now() - Number(timestamp)) > 300_000 ||
      raw === undefined ||
      !equalSignature(signature, signValue(`${purpose}\n${timestamp}\n${raw}`, config.signingSecret))
    )
      throw new PlgError(401, 'Invalid integration signature.');
  };
  app.get(
    '/api/plg/workspace',
    handle(async (req, res) => {
      const user = role(req);
      return res.json(await getService().workspace(user.role));
    }),
  );
  app.post(
    '/api/plg/contacts',
    handle(async (req, res) => {
      const user = role(req);
      const data = await getService().store.transaction((state) =>
        enroll(state, req.body, user.email, Date.now()),
      );
      return res.status(201).json({ contact: data });
    }),
  );
  app.patch(
    '/api/plg/contacts/:id',
    handle(async (req, res) => {
      const user = role(req);
      const data = await getService().store.transaction((state) =>
        updateContact(state, req.params.id as string, req.body, user.email, Date.now()),
      );
      return res.json({ contact: data });
    }),
  );
  app.put(
    '/api/plg/templates/:id',
    handle(async (req, res) => {
      const user = role(req, true);
      return res.json(
        await getService().store.transaction((state) =>
          updateTemplate(state, req.params.id as string, req.body, user.email, Date.now()),
        ),
      );
    }),
  );
  app.patch(
    '/api/plg/settings',
    handle(async (req, res) => {
      const user = role(req, true);
      const settings = await getService().store.transaction((state) => {
        if (
          typeof req.body.paused !== 'boolean' ||
          typeof req.body.ready?.memory !== 'boolean' ||
          typeof req.body.ready?.mail !== 'boolean'
        )
          throw new PlgError(400, 'Supply campaign status and verified journey readiness.');
        state.paused = req.body.paused;
        state.ready = { memory: req.body.ready.memory, mail: req.body.ready.mail };
        audit(
          state,
          user.email,
          `Campaigns ${state.paused ? 'paused' : 'enabled'}; journey readiness updated.`,
          Date.now(),
        );
        return { paused: state.paused, ready: state.ready };
      });
      return res.json(settings);
    }),
  );
  app.post(
    '/api/plg/preview',
    handle(async (req, res) => {
      role(req);
      return res.json(await getService().preview());
    }),
  );
  // Sending is only available through the signed scheduler endpoint. Browsing,
  // editing and previewing in this UI cannot send an email.
  app.post(
    '/integrations/plg/events',
    handle(async (req, res) => {
      machine(req, 'events');
      return res.json(
        await getService().store.transaction((state) =>
          req.body.kind === 'account_enrolled'
            ? ingestEnrollment(state, req.body, Date.now())
            : ingestEvent(state, req.body, Date.now()),
        ),
      );
    }),
  );
  app.post(
    '/integrations/plg/run',
    handle(async (req, res) => {
      machine(req, 'run');
      return res.json(await getService().run('Signed scheduler'));
    }),
  );
  app.post(
    '/integrations/plg/resend',
    handle(async (req, res) => {
      if (!config.webhookSecret || !config.enabled)
        throw new PlgError(503, 'Delivery callbacks are not configured.');
      let event: any;
      try {
        const raw = (req as any).plgRawBody;
        new Webhook(config.webhookSecret).verify(raw, {
          'svix-id': req.get('svix-id') || '',
          'svix-timestamp': req.get('svix-timestamp') || '',
          'svix-signature': req.get('svix-signature') || '',
        });
        event = JSON.parse(raw);
      } catch {
        throw new PlgError(401, 'Invalid delivery signature.');
      }
      await getService().store.transaction((state) => {
        const reason =
          event.type === 'email.bounced'
            ? 'bounced'
            : event.type === 'email.complained'
              ? 'complained'
              : null;
        if (reason)
          for (const c of state.contacts)
            if (
              Array.isArray(event.data?.to) &&
              event.data.to.some((e: unknown) => typeof e === 'string' && e.toLowerCase() === c.email)
            ) {
              if (c.suppressed !== reason) {
                c.suppressed = reason;
                timeline(c, 'Delivery provider', `Promotional email suppressed: ${reason}.`, Date.now());
              }
            }
        if (event.type === 'email.delivered') {
          const d = state.deliveries.find((d) => d.providerId === event.data?.email_id);
          if (d) d.status = 'delivered';
        }
      });
      return res.json({ received: true });
    }),
  );
  const preferences = (unsubscribe: boolean) =>
    handle(async (req, res) => {
      if (config.signingSecret.length < 32) throw new PlgError(503, 'Preferences are not configured.');
      const id = tokenContact(req.params.token as string, config.signingSecret);
      const store = getService().store;
      const contact = (await store.read()).contacts.find((c) => c.id === id);
      if (!contact) throw new PlgError(404, 'Subscriber not found.');
      res.set(
        'Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      );
      if (req.method === 'POST') {
        await store.transaction((state) => {
          const c = state.contacts.find((c) => c.id === id)!;
          if (unsubscribe || req.body.unsubscribe === 'yes') {
            c.suppressed = 'unsubscribed';
            timeline(c, 'Subscriber', 'Unsubscribed from promotional email.', Date.now());
          } else {
            c.frequency = choose(req.body.frequency, ['daily', 'weekly', 'updates']);
            timeline(c, 'Subscriber', 'Updated email frequency.', Date.now());
          }
        });
        return res
          .type('html')
          .send(
            '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Preferences updated</title><main><h1>Your email preferences are saved</h1><p>You can close this page.</p></main></html>',
          );
      }
      const action = escapeHtml(req.originalUrl);
      return res
        .type('html')
        .send(
          `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>One email preferences</title><style>body{font:17px/1.6 system-ui;margin:60px auto;padding:20px;max-width:540px}select,button{font:inherit;padding:10px;display:block;margin:15px 0}</style></head><body><main><h1>${unsubscribe ? 'Unsubscribe from One emails' : 'One email preferences'}</h1><form method="post" action="${action}">${unsubscribe ? '<p>Confirm that you want to stop promotional email.</p>' : `<label for="frequency">Email frequency</label><select id="frequency" name="frequency">${(['daily', 'weekly', 'updates'] as const).map((f) => `<option value="${f}" ${contact.frequency === f ? 'selected' : ''}>${f === 'updates' ? 'Product updates only' : f === 'daily' ? 'Daily tips' : 'Weekly digest'}</option>`).join('')}</select><label><input type="checkbox" name="unsubscribe" value="yes"> Stop promotional email</label>`}<button type="submit">${unsubscribe ? 'Confirm unsubscribe' : 'Save preferences'}</button></form></main></body></html>`,
        );
    });
  app.get('/integrations/plg/preferences/:token', preferences(false));
  app.post('/integrations/plg/preferences/:token', preferences(false));
  app.get('/integrations/plg/unsubscribe/:token', preferences(true));
  app.post('/integrations/plg/unsubscribe/:token', preferences(true));
}
