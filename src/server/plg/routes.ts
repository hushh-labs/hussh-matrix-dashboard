import type express from 'express';
import { Webhook } from 'svix';
import { plgJourneyOptions } from '../../lib/plg';
import type { PlgContact, PlgState } from '../../lib/plg';
import { PLG_SYNC_BUDGET_MS } from '../../lib/plg-budgets.mjs';
import {
  audit,
  accountHash,
  choose,
  enroll,
  ingestEnrollment,
  ingestEvent,
  registerPlgCatalog,
  PlgError,
  timeline,
  updateContact,
  updateTemplate,
} from './engine';
import { FilePlgStore, FirestorePlgStore, type PlgStore } from './store';
import {
  equalSignature,
  escapeHtml,
  ONE_EMAIL_PREFERENCE_ORIGIN,
  plgRuntime,
  PlgService,
  signValue,
  tokenPreference,
} from './service';
import { syncOneEvidence } from './one-source';
import { readOneAudience } from './one-audience';
import { deliveryBlockers, runAutomationCycle, setAutomationEnabled } from './automation';
import { applyDeliveryEvent } from './delivery-events';
import { OneSubscriptions, queueSubscriptionRevocation, syncSubscriptions } from './one-subscriptions';
import { registerGoogleMailRoutes } from './google-mail-routes';
import { MAIL_OWNER } from './google-mail-store';
import { decodeWorkspacePage, encodeWorkspacePages } from './workspace-pages';

/** The same generation fence applies to new One links and already-sent legacy links. */
function unsubscribeContact(state: PlgState, contact: PlgContact, generation?: string) {
  if (contact.permission && !generation)
    throw new PlgError(409, 'Use the latest email link or manage preferences in your One account.');
  if (!contact.permission || contact.permission.generation === generation) {
    if (!contact.suppressed || contact.suppressed === 'unsubscribed') contact.suppressed = 'unsubscribed';
    timeline(contact, 'Subscriber', 'Unsubscribed from promotional email.', Date.now());
  }
  queueSubscriptionRevocation(state, contact, generation);
}

export function registerPlgRoutes(
  app: express.Express,
  production: boolean,
  injected?: PlgService,
) {
  const config = injected?.runtime ?? plgRuntime();
  let service = injected;
  const getService = () => {
    if (!config.enabled) throw new PlgError(503, 'PLG is not configured.');
    if (!service) {
      let store: PlgStore;
      if (
        process.env.PLG_STORAGE === 'firestore' &&
        process.env.PLG_FIRESTORE_PROJECT &&
        (!production || process.env.PLG_FIRESTORE_DATABASE)
      )
        store = new FirestorePlgStore(
          process.env.PLG_FIRESTORE_PROJECT,
          process.env.PLG_FIRESTORE_DATABASE,
        );
      else if (!production && process.env.PLG_STORAGE === 'local')
        store = new FilePlgStore(process.env.PLG_DATA_DIR || '.plg-data');
      else throw new PlgError(503, 'PLG storage is not configured.');
      service = new PlgService(store, config);
    }
    return service;
  };
  const accountStore = async (selector: { accountId?: unknown; contactId?: string }) => {
    const store = getService().store, accounts = await store.accountStorage?.();
    if (!accounts) return store;
    if (selector.contactId) return accounts.contact(selector.contactId);
    if (typeof selector.accountId !== 'string' || !selector.accountId || selector.accountId.length > 128)
      throw new PlgError(400, 'Choose an account.');
    return accounts.account(accountHash(selector.accountId));
  };
  registerGoogleMailRoutes(app, config, async () => {
    const store = getService().store, accounts = await store.accountStorage?.();
    return (await (accounts ? accounts.readSettings() : store.read())).templates;
  });
  const synchronize = async (deadline = Date.now() + PLG_SYNC_BUDGET_MS, continuation = false, manual = false) => {
    const service = getService();
    const accounts = await service.store.accountStorage?.();
    if (config.subscriptions?.enabled && !continuation) {
      if (!(await (accounts ? accounts.readSettings() : service.store.read())).catalog?.agents.some((a) => a.id === 'agent_one' && a.public && a.available)) {
        if (Date.now() + 30_000 >= deadline) throw new PlgError(503, 'Automatic sync budget expired.');
        const page = await readOneAudience({ agentId: 'agent_one', segment: 'all', query: '', graceMinutes: 60 });
        await service.store.transaction((state) => { registerPlgCatalog(state, page.catalog); });
      }
      await syncSubscriptions(service.store, new OneSubscriptions(config.subscriptions, fetch, Date.now, Math.min(deadline, Date.now() + 75_000)));
    }
    if (accounts) {
      let observed: { page: Awaited<ReturnType<typeof accounts.page>>; result: Awaited<ReturnType<typeof syncOneEvidence>> } | undefined;
      // Every ordinary cycle advances independent evidence collection, including
      // while sending is paused or stuck behind provider backpressure.
      if (manual || !continuation) {
        const state = await accounts.readSettings(), after = state.automation?.sourceCursor ?? null;
        const page = await accounts.page(after, 25);
        const result = await syncOneEvidence(service.store, undefined, fetch, Date.now, undefined, deadline, page.accounts);
        await accounts.transaction(draft => {
          if ((draft.automation?.sourceCursor ?? null) !== after)
            throw new PlgError(409, 'Evidence traversal changed; retry the sync.');
          draft.automation ??= { enabled: false }; draft.automation.sourceCursor = page.next;
        });
        if (manual || state.paused || !state.automation?.enabled || deliveryBlockers(config).length) return result;
        observed = { page, result };
      }
      const state = await accounts.readSettings(), cursor = state.automation?.accountCursor ?? null;
      const page = await accounts.page(cursor, 25);
      const same = observed && JSON.stringify(observed.page.accounts) === JSON.stringify(page.accounts);
      const result = same ? observed!.result :
        await syncOneEvidence(service.store, undefined, fetch, Date.now, undefined, deadline, page.accounts);
      return { ...result, accountHashes: page.accounts, accountPage: { after: cursor, next: page.next } };
    }
    const state = await service.store.read();
    if (state.contacts.length) return syncOneEvidence(service.store, undefined, fetch, Date.now, undefined, deadline);
    // An empty workspace has no pilot cohort to export. Its catalog is already
    // available through the independently authenticated registered-people reader.
    // Discard this bounded page's identities; retain only the validated catalog.
    if (Date.now() + 30_000 >= deadline) throw new PlgError(503, 'Automatic sync budget expired.');
    const page = await readOneAudience({ agentId: 'agent_one', segment: 'all', query: '', graceMinutes: 60 });
    return service.store.transaction((draft) => {
      if (draft.contacts.some((c) => !c.permission || (c.permission.enabled && c.permission.eligible && !c.suppressed)))
        throw new PlgError(409, 'Enrollment changed during catalog refresh. Retry the sync.');
      registerPlgCatalog(draft, page.catalog);
      return { accounts: 0, imported: 0, erased: 0, retainedOnly: true };
    });
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
            res.status(error instanceof PlgError ? error.status : 503).json({
              error: error instanceof PlgError ? error.message : 'PLG is temporarily unavailable.',
            });
        });
    };
  const role = (req: express.Request, admin = false) => {
    const email = (req as any).sessionUser?.email?.toLowerCase() as string | undefined;
    if (!email) throw new PlgError(401, 'Authentication required');
    const value = config.admins.has(email)
      ? 'admin'
      : config.operators.has(email)
        ? 'operator'
        : null;
    if (!value || (admin && value !== 'admin'))
      throw new PlgError(403, 'This action requires PLG workspace access.');
    if (req.method !== 'GET' && req.headers.origin !== config.origin)
      throw new PlgError(403, 'Invalid request origin');
    return { email, role: value as 'admin' | 'operator' };
  };
  const machine = (req: express.Request, purpose: string) => {
    const secret = purpose === 'sync' ? (config.syncSecret ?? '') : purpose === 'cycle' ? (config.cycleSecret ?? '') : config.signingSecret;
    const timestamp = req.get('X-PLG-Timestamp') || '';
    const signature = req.get('X-PLG-Signature') || '';
    const raw = (req as any).plgRawBody as string | undefined;
    if (
      !config.enabled ||
      secret.length < 32 ||
      !/^\d{13}$/.test(timestamp) ||
      Math.abs(Date.now() - Number(timestamp)) > 300_000 ||
      raw === undefined ||
      !equalSignature(signature, signValue(`${purpose}\n${timestamp}\n${raw}`, secret))
    )
      throw new PlgError(401, 'Invalid integration signature.');
  };
  app.get(
    '/api/plg/workspace',
    handle(async (req, res) => {
      const user = role(req);
      return res.json({ ...encodeWorkspacePages(await getService().workspace(user.role), {}, user.email, config.signingSecret),
        mailOwner: user.role === 'admin' && user.email === MAIL_OWNER && process.env.PLG_GOOGLE_MAIL_ENABLED === 'true' });
    }),
  );
  app.post('/api/plg/workspace/query', handle(async (req, res) => {
    const user = role(req), query = decodeWorkspacePage(req.body, user.email, config.signingSecret);
    return res.json({ ...encodeWorkspacePages(await getService().workspace(user.role, query), query, user.email, config.signingSecret),
      mailOwner: user.role === 'admin' && user.email === MAIL_OWNER && process.env.PLG_GOOGLE_MAIL_ENABLED === 'true' });
  }));
  app.post(
    '/api/plg/contacts',
    handle(async (req, res) => {
      const user = role(req);
      const data = await (await accountStore({ accountId: req.body.accountId })).transaction((state) =>
        enroll(state, req.body, user.email, Date.now()),
      );
      return res.status(201).json({ contact: data });
    }),
  );
  app.patch(
    '/api/plg/contacts/:id',
    handle(async (req, res) => {
      const user = role(req);
      const data = await (await accountStore({ contactId: req.params.id as string })).transaction((state) => {
        const contact = updateContact(state, req.params.id as string, req.body, user.email, Date.now());
        if (req.body.unsubscribe === true) queueSubscriptionRevocation(state, contact);
        return contact;
      });
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
          typeof req.body.ready?.mail !== 'boolean' ||
          Object.entries(req.body.ready ?? {}).some(([id, value]) =>
            !plgJourneyOptions(state).some((j) => j.id === id) || typeof value !== 'boolean')
        )
          throw new PlgError(400, 'Supply campaign status and verified journey readiness.');
        state.paused = req.body.paused;
        state.ready = Object.fromEntries(plgJourneyOptions(state).map((j) =>
          [j.id, req.body.ready[j.id] ?? state.ready[j.id] ?? false])) as typeof state.ready;
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
    '/api/plg/sync',
    handle(async (req, res) => {
      role(req);
      return res.json(await synchronize(undefined, false, true));
    }),
  );
  app.patch(
    '/api/plg/automation',
    handle(async (req, res) => {
      const user = role(req, true);
      return res.json(await getService().store.transaction((state) =>
        setAutomationEnabled(state, req.body.enabled, user.email, Date.now())));
    }),
  );
  app.post(
    '/api/plg/audience',
    handle(async (req, res) => {
      role(req);
      if (!config.enabled) throw new PlgError(503, 'PLG is not configured.');
      const page = await readOneAudience(req.body), accounts = await getService().store.accountStorage?.();
      if (!accounts) return res.json(page);
      const enrolled = await accounts.readAccounts(page.rows.map(row => accountHash(row.accountId)));
      return res.json({ ...page, rows: page.rows.map(row => ({ ...row,
        campaignContactId: enrolled.contacts.find(contact => contact.accountId === row.accountId)?.id ?? null })) });
    }),
  );
  app.post(
    '/api/plg/activity',
    handle(async (req, res) => {
      role(req);
      if (typeof req.body.contactId !== 'string') throw new PlgError(400, 'Choose an enrolled account.');
      const result = await syncOneEvidence(await accountStore({ contactId: req.body.contactId }), undefined, fetch, Date.now, req.body.contactId);
      return res.json(result.inspection);
    }),
  );
  app.post(
    '/api/plg/preview',
    handle(async (req, res) => {
      const user = role(req);
      const query = Object.keys(req.body ?? {}).length ? decodeWorkspacePage(req.body, user.email, config.signingSecret) : {};
      return res.json(await getService().preview(query));
    }),
  );
  // Sending is only available through the signed scheduler endpoint. Browsing,
  // editing and previewing in this UI cannot send an email.
  app.post(
    '/integrations/plg/sync',
    handle(async (req, res) => {
      machine(req, 'sync');
      return res.json(await synchronize(undefined, false, true));
    }),
  );
  app.post(
    '/integrations/plg/events',
    handle(async (req, res) => {
      machine(req, 'events');
      return res.json(
        await (await accountStore({ accountId: req.body.accountId })).transaction((state) =>
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
      const service = getService();
      // Legacy signed workers share the same sync, lease and website pause.
      return res.json(await runAutomationCycle(service, synchronize));
    }),
  );
  app.post(
    '/integrations/plg/cycle',
    handle(async (req, res) => {
      machine(req, 'cycle');
      const service = getService();
      return res.json(await runAutomationCycle(service, synchronize));
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
      const store = getService().store, accounts = await store.accountStorage?.();
      if (!accounts) await store.transaction(state => applyDeliveryEvent(state, event, Date.now()));
      else {
        const data = (event as { data?: { email_id?: string; tags?: { plg_delivery_id?: string }; to?: string[] } })?.data;
        if (data?.email_id || data?.tags?.plg_delivery_id) {
          const lookup = async (reference: { id?: string; providerId?: string }) => {
            try { return await accounts.receipt(reference); }
            catch (error) { if (error instanceof PlgError && error.status === 404) return null; throw error; }
          };
          let receipt = data.email_id ? await lookup({ providerId: data.email_id }) : null;
          const tag = data.tags?.plg_delivery_id;
          if (!receipt && typeof tag === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(tag)) receipt = await lookup({ id: tag });
          if (receipt) await receipt.transaction(state => applyDeliveryEvent(state, event, Date.now()));
        }
        if (Array.isArray(data?.to)) {
          if (data.to.length > 50) throw new PlgError(400, 'Delivery callback exceeds its recipient bound.');
          for (const address of new Set(data.to)) if (typeof address === 'string' && address.length <= 254) {
            const recipient = await accounts.email(address.toLowerCase());
            if (recipient) await recipient.transaction(state => applyDeliveryEvent(state, event, Date.now()));
          }
        }
      }
      return res.json({ received: true });
    }),
  );
  // This capability API is only a revocation bridge. Account settings remain
  // the authenticated authority for frequency and explicit re-enrollment.
  const emailUnsubscribe = handle(async (req, res) => {
    const origin = req.get('Origin');
    if (origin !== undefined && origin !== ONE_EMAIL_PREFERENCE_ORIGIN)
      throw new PlgError(403, 'Invalid request origin.');
    if (config.signingSecret.length < 32)
      throw new PlgError(503, 'Preferences are not configured.');
    const { id, generation } = tokenPreference(req.params.token as string, config.signingSecret);
    const store = await accountStore({ contactId: id });
    res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (!(await store.read()).contacts.some((c) => c.id === id))
        throw new PlgError(404, 'Subscriber not found.');
      return res.json({ version: 1, canUnsubscribe: true });
    }
    const body = req.body;
    const raw = (req as express.Request & { plgRawBody?: string }).plgRawBody;
    const keys = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body) : [];
    const valid = keys.length === 1 && (
      (req.is('application/json') && keys[0] === 'action' && body.action === 'unsubscribe') ||
      (req.is('application/x-www-form-urlencoded') && keys[0] === 'List-Unsubscribe' && body['List-Unsubscribe'] === 'One-Click')
    );
    if (!valid || Buffer.byteLength(JSON.stringify(body)) > 1024 ||
      (raw !== undefined && Buffer.byteLength(raw) > 1024) || Number(req.get('Content-Length') ?? 0) > 1024)
      throw new PlgError(400, 'Supply an unsubscribe confirmation.');
    await store.transaction((state) => {
      const contact = state.contacts.find((c) => c.id === id);
      if (!contact) throw new PlgError(404, 'Subscriber not found.');
      unsubscribeContact(state, contact, generation);
    });
    // Local suppression is immediate. Canonical revocation retains its durable
    // retry queue; this receipt does not expose or claim canonical preference state.
    return res.json({ version: 1, unsubscribed: true });
  });
  app.get('/integrations/plg/email-unsubscribe/:token', emailUnsubscribe);
  app.post('/integrations/plg/email-unsubscribe/:token', emailUnsubscribe);

  const preferences = (unsubscribe: boolean) =>
    handle(async (req, res) => {
      if (config.signingSecret.length < 32)
        throw new PlgError(503, 'Preferences are not configured.');
      const { id, generation } = tokenPreference(req.params.token as string, config.signingSecret);
      const store = await accountStore({ contactId: id });
      const contact = (await store.read()).contacts.find((c) => c.id === id);
      if (!contact) throw new PlgError(404, 'Subscriber not found.');
      res.set(
        'Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      );
      if (req.method === 'POST') {
        await store.transaction((state) => {
          const c = state.contacts.find((c) => c.id === id)!;
          if (c.permission && !generation)
            throw new PlgError(409, 'Use the latest email link or manage preferences in your One account.');
          if (unsubscribe || req.body.unsubscribe === 'yes') {
            unsubscribeContact(state, c, generation);
          } else {
            if (c.permission) throw new PlgError(409, 'Manage the email frequency in your One account.');
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
      if (config.preferenceOrigin === ONE_EMAIL_PREFERENCE_ORIGIN) {
        // Already-delivered links keep their signatures; only the read-only
        // browser destination moves after the paired One release is enabled.
        const destination = unsubscribe
          ? `${ONE_EMAIL_PREFERENCE_ORIGIN}/email/unsubscribe/${encodeURIComponent(req.params.token as string)}`
          : `${ONE_EMAIL_PREFERENCE_ORIGIN}/one/profile/account#email-updates`;
        return res.redirect(303, destination);
      }
      const action = escapeHtml(req.originalUrl);
      return res
        .type('html')
        .send(
          `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>One email preferences</title><style>body{font:17px/1.6 system-ui;margin:60px auto;padding:20px;max-width:540px}select,button{font:inherit;padding:10px;display:block;margin:15px 0}</style></head><body><main><h1>${unsubscribe ? 'Unsubscribe from One emails' : 'One email preferences'}</h1><form method="post" action="${action}">${unsubscribe ? '<p>Confirm that you want to stop promotional email.</p>' : `${contact.permission ? '<p><a href="https://one.hussh.ai/one/profile/account">Manage your email frequency in One</a></p>' : `<label for="frequency">Email frequency</label><select id="frequency" name="frequency">${(['daily', 'weekly', 'updates'] as const).map((f) => `<option value="${f}" ${contact.frequency === f ? 'selected' : ''}>${f === 'updates' ? 'Product updates only' : f === 'daily' ? 'Daily tips' : 'Weekly digest'}</option>`).join('')}</select>`}<label><input type="checkbox" name="unsubscribe" value="yes"> Stop promotional email</label>`}<button type="submit">${unsubscribe ? 'Confirm unsubscribe' : 'Save preferences'}</button></form></main></body></html>`,
        );
    });
  app.get('/integrations/plg/preferences/:token', preferences(false));
  app.post('/integrations/plg/preferences/:token', preferences(false));
  app.get('/integrations/plg/unsubscribe/:token', preferences(true));
  app.post('/integrations/plg/unsubscribe/:token', preferences(true));
}
