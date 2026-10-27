import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { PlgDelivery, PlgWorkspace } from '../../lib/plg';
import { accountHash, audit, candidate, customerReportingCurrent, customerReportingEligible, eraseAccountHash, iso, metrics, PlgError, timeline } from './engine';
import type { PlgStore } from './store';
import { automationStatus, deliveryBlockers } from './automation';
import { applyAcceptedDelivery } from './delivery-events';
import { OneSubscriptions } from './one-subscriptions';
import { configuredGoogleMail } from './google-mail-runtime';
import type { GoogleMail } from './google-mail';
import { GoogleMailUnattempted } from './google-mail';
import { reconcileGoogleFeedback } from './google-mail-reconcile';
import { unboundGoogleDeliveries } from './google-mail-bindings';
import { renderPlgEmailHtml } from './email-layout';
export { escapeHtml } from './email-layout';

export interface PlgRuntime {
  emailProvider?: 'resend' | 'google_workspace';
  googleMailCampaignsEnabled?: boolean;
  enabled: boolean;
  deliveryEnabled: boolean;
  origin: string;
  admins: Set<string>;
  operators: Set<string>;
  signingSecret: string;
  syncSecret?: string;
  cycleSecret?: string;
  webhookSecret: string;
  apiKey: string;
  from: string;
  replyTo: string;
  subscriptions?: { enabled: boolean; url: string; secret: string };
}
const emails = (value: string | undefined) =>
  new Set(
    (value ?? '')
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean),
  );
export function plgRuntime(): PlgRuntime {
  const rawOrigin = process.env.PLG_PUBLIC_ORIGIN || 'http://localhost:3001';
  let origin = '';
  try {
    const u = new URL(rawOrigin);
    if (
      (u.protocol === 'https:' ||
        (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))) &&
      !u.username &&
      !u.password
    )
      origin = u.origin;
  } catch {
    /* unavailable until configured */
  }
  return {
    emailProvider: process.env.PLG_EMAIL_PROVIDER === 'google_workspace' ? 'google_workspace' : 'resend',
    googleMailCampaignsEnabled: process.env.PLG_GOOGLE_MAIL_CAMPAIGNS_ENABLED === 'true',
    enabled: process.env.PLG_ENABLED === 'true',
    deliveryEnabled: process.env.PLG_DELIVERY_ENABLED === 'true',
    origin,
    admins: emails(process.env.PLG_ADMIN_EMAILS),
    operators: emails(process.env.PLG_OPERATOR_EMAILS),
    signingSecret: process.env.PLG_SIGNING_SECRET || '',
    syncSecret: process.env.PLG_SYNC_SECRET || '',
    cycleSecret: process.env.PLG_CYCLE_SECRET || '',
    webhookSecret: process.env.PLG_RESEND_WEBHOOK_SECRET || '',
    apiKey: process.env.PLG_RESEND_API_KEY || '',
    from: process.env.PLG_EMAIL_FROM || '',
    replyTo: process.env.PLG_REPLY_TO || '',
    subscriptions: {
      enabled: process.env.PLG_ONE_SUBSCRIPTION_ENABLED === 'true',
      url: process.env.PLG_ONE_SUBSCRIPTION_URL || '',
      secret: process.env.PLG_ONE_SUBSCRIPTION_SECRET || '',
    },
  };
}
export function signValue(value: string, secret: string) {
  return createHmac('sha256', secret).update(value).digest('hex');
}
export function equalSignature(a: string, b: string) {
  return (
    /^[a-f0-9]{64}$/.test(a) &&
    /^[a-f0-9]{64}$/.test(b) &&
    timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  );
}
export function preferenceToken(contactId: string, secret: string, generation?: string) {
  const subject = generation ? `${contactId}:${generation}` : contactId;
  return `${contactId}.${generation ? `${generation}.` : ''}${signValue(`preferences:${subject}`, secret)}`;
}
export function tokenPreference(token: string, secret: string) {
  const parts = token.split('.');
  const [id, generation, signature] = parts.length === 2 ? [parts[0], undefined, parts[1]] : parts;
  if (
    secret.length < 32 ||
    ![2, 3].includes(parts.length) ||
    !/^[a-f0-9-]{36}$/.test(id ?? '') ||
    (generation !== undefined && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(generation)) ||
    !equalSignature(signature ?? '', signValue(`preferences:${id}${generation ? `:${generation}` : ''}`, secret))
  )
    throw new PlgError(400, 'This preference link is invalid.');
  return { id, generation };
}
export function tokenContact(token: string, secret: string) { return tokenPreference(token, secret).id; }
export function deliveryMessage(d: PlgDelivery, contactId: string, config: PlgRuntime, generation?: string) {
  const preferences = `${config.origin}/integrations/plg/preferences/${preferenceToken(contactId, config.signingSecret, generation)}`;
  const unsubscribe = `${config.origin}/integrations/plg/unsubscribe/${preferenceToken(contactId, config.signingSecret, generation)}`;
  const plain = `${d.body}${d.resourceUrl ? `\n\nDemo or guide: ${d.resourceUrl}` : ''}\n\n${d.ctaLabel}: ${d.ctaUrl}\n\nPreferences: ${preferences}\nUnsubscribe: ${unsubscribe}`;
  return {
    text: plain,
    html: renderPlgEmailHtml({ ...d, preferences: { manage: preferences, unsubscribe } }),
    headers: {
      'List-Unsubscribe': `<${unsubscribe}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}
export type PlgTransport = ((input: {
  to: string;
  delivery: PlgDelivery;
  message: ReturnType<typeof deliveryMessage>;
}) => Promise<string>) & { prepare?: () => Promise<PlgTransport> };
export function resendTransport(config: PlgRuntime): PlgTransport {
  return async ({ to, delivery, message }) => {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': delivery.id,
      },
      body: JSON.stringify({
        from: config.from,
        to: [to],
        reply_to: config.replyTo,
        subject: delivery.subject,
        tags: [{ name: 'plg_delivery_id', value: delivery.id }],
        ...message,
      }),
    });
    if (!response.ok) throw new Error('Email provider did not confirm delivery.');
    const body = (await response.json()) as { id?: string };
    if (!body.id) throw new Error('Email provider did not confirm delivery.');
    return body.id;
  };
}
export class PlgService {
  private transport: PlgTransport;
  constructor(
    public store: PlgStore,
    public runtime: PlgRuntime,
    private now = Date.now,
    transport?: PlgTransport,
    private permissionSource = runtime.subscriptions ? new OneSubscriptions(runtime.subscriptions, fetch, now) : undefined,
    private googleMail: GoogleMail | undefined = runtime.emailProvider === 'google_workspace' ? configuredGoogleMail() : undefined,
  ) {
    if (transport) this.transport = transport;
    else if (runtime.emailProvider === 'google_workspace') {
      this.transport = async () => { throw new GoogleMailUnattempted(); };
      this.transport.prepare = async () => {
        if (!this.googleMail) throw new GoogleMailUnattempted(503);
        const prepared = await this.googleMail.prepareCampaign();
        return async (input) => this.googleMail!.send(input.to, input.delivery, input.message, 'campaign', prepared);
      };
    } else this.transport = resendTransport(runtime);
  }
  async reconcileMail(deadline = this.now() + 45_000) {
    if (this.runtime.emailProvider !== 'google_workspace' || !this.runtime.googleMailCampaignsEnabled) return;
    if (!this.googleMail) throw new PlgError(503, 'Google customer mail is not configured.');
    const state = await this.googleMail.store.read(), age = this.now() - (state.feedback?.checkedAt ?? 0);
    if (state.connection?.feedbackAllowed && state.feedback?.checkedAt && age >= 0 && age < 60_000 && !state.feedback.pending && !state.feedback.pageToken && !state.feedback.recovery &&
      !unboundGoogleDeliveries(await this.store.read()).length) return;
    const result = await reconcileGoogleFeedback(this.googleMail.store, this.store,
      await this.googleMail.feedbackReader(deadline), deadline, this.now);
    if (!result.complete) throw new PlgError(409, 'Google mail feedback is catching up; no customer messages sent.');
  }
  async workspace(role: 'admin' | 'operator'): Promise<PlgWorkspace> {
    const stored = await this.store.read();
    const now = this.now();
    const contacts = stored.contacts.filter((c) => customerReportingEligible(stored, c, now));
    const ids = new Set(contacts.map((c) => c.id));
    const state = { ...stored, contacts, deliveries: stored.deliveries.filter((d) => ids.has(d.contactId)) };
    const mail = this.googleMail ? await this.googleMail.status() : null;
    const automation = automationStatus(stored, this.runtime, now);
    if (mail) {
      automation.emailFeedback = { provider: 'google_workspace', authorized: mail.feedbackAuthorized,
        checkedAt: mail.feedbackCheckedAt, backlog: mail.feedbackBacklog };
      const feedbackAge = now - (mail.feedbackCheckedAt ?? 0);
      if (this.runtime.googleMailCampaignsEnabled && (!mail.feedbackAuthorized || !mail.feedbackCheckedAt || feedbackAge < 0 || feedbackAge > 20 * 60_000 || mail.feedbackBacklog))
        automation.blockers.push('Google feedback authorization or current complete checkpoint is missing');
    }
    return {
      role,
      configured: true,
      deliveryEnabled: this.runtime.deliveryEnabled,
      reporting: { pending: stored.contacts.filter((c) => !customerReportingCurrent(stored, c, now)).length,
        excluded: stored.contacts.filter((c) => c.customerReporting?.eligible === false && customerReportingCurrent(stored, c, now)).length },
      automation,
      state,
      queue: state.contacts.map((c) => candidate(state, c, now)),
      metrics: metrics(state, now),
    };
  }
  async preview() {
    const state = await this.store.read();
    const now = this.now();
    return {
      paused: state.paused,
      deliveryEnabled: this.runtime.deliveryEnabled,
      candidates: state.contacts.map((c) => candidate(state, c, now, true)),
      messages: state.contacts
        .map((c) => {
          const next = candidate(state, c, now, true);
          const t = state.templates.find((t) => t.id === next.templateId);
          return next.eligible && t
            ? {
                contactId: c.id,
                subject: t.subject,
                body: t.body,
                ctaLabel: t.ctaLabel,
                ctaUrl: t.ctaUrl,
                resourceUrl: t.resourceUrl || '',
              }
            : null;
        })
        .filter(Boolean),
    };
  }
  async run(actor: string, options?: { deadline: number; leaseId: string }) {
    if (deliveryBlockers(this.runtime).length)
      throw new PlgError(409, 'Live delivery is disabled or incomplete. Use campaign preview.');
    await this.reconcileMail(Math.min(options?.deadline ?? Infinity, this.now() + 45_000));
    const snapshot = await this.store.read();
    if (snapshot.paused) throw new PlgError(409, 'Campaigns are paused.');
    let sent = 0,
      uncertain = 0;
    const due = snapshot.contacts
      .filter((c) => candidate(snapshot, c, this.now()).eligible)
      .slice(0, 10);
    for (const item of due) {
      // Leave enough time for the bounded provider request and receipt commit.
      if (options && this.now() + (this.runtime.emailProvider === 'google_workspace' ? 70_000 : this.runtime.subscriptions?.enabled ? 55_000 : 20_000) >= options.deadline) break;
      const now = this.now();
      const reserved = await this.store.transaction((state) => {
        if (options && (!state.automation?.enabled || state.automation.lease?.id !== options.leaseId || Date.parse(state.automation.lease.until) <= now)) return null;
        const c = state.contacts.find((c) => c.id === item.id);
        if (!c) return null;
        const next = candidate(state, c, now);
        if (!next.eligible) return null;
        const t = state.templates.find((t) => t.id === next.templateId)!;
        const d: PlgDelivery = {
          id: randomUUID(),
          contactId: c.id,
          templateId: t.id,
          step: next.step!,
          key: next.key!,
          status: 'sending',
          createdAt: iso(now),
          subject: t.subject,
          body: t.body,
          ctaLabel: t.ctaLabel,
          ctaUrl: t.ctaUrl,
          resourceUrl: t.resourceUrl || '',
          providerId: null,
          provider: this.runtime.emailProvider ?? 'resend',
          recipientHash: createHash('sha256').update(c.email).digest('hex'),
        };
        state.deliveries.push(d);
        timeline(c, actor, `Reserved ${d.step} email.`, now);
        return { contact: c, delivery: d };
      });
      if (!reserved) continue;
      // No external side effect occurs inside a retried Firestore transaction.
      // Reservations are permanent. Without a durable acceptance ID a lost
      // response stays uncertain; an unresolved send is never resubmitted.
      let attempted = false;
      try {
        // Prepare provider credentials before One's fresh permission check. A
        // Gmail refresh must not introduce a new 15s gap after that decision.
        const sender = this.transport.prepare ? await this.transport.prepare() : this.transport;
        const currentContact = async () => {
          const current = await this.store.read();
          const c = current.contacts.find((c) => c.id === item.id);
          if (!c || (options && (!current.automation?.enabled || current.automation.lease?.id !== options.leaseId || this.now() + 15_000 >= options.deadline)))
            throw new Error('Cycle paused or eligibility changed before send.');
          if (c.email !== reserved.contact.email ||
            c.permission?.revision !== reserved.contact.permission?.revision ||
            c.permission?.generation !== reserved.contact.permission?.generation)
            throw new Error('Reserved recipient or permission changed before send.');
          const check = candidate(
            { ...current, deliveries: current.deliveries.filter((d) => d.id !== reserved.delivery.id) },
            c, this.now(),
          );
          if (!check.eligible || check.key !== reserved.delivery.key || check.templateId !== reserved.delivery.templateId)
            throw new Error('Eligibility changed before send.');
          return c;
        };
        let c = await currentContact();
        if (c.permission || this.runtime.subscriptions?.enabled || this.runtime.emailProvider === 'google_workspace') {
          if (!this.permissionSource || !c.permission)
            throw new PlgError(503, 'Canonical One email permission is not available.');
          const beforeCheck = { email: c.email, revision: c.permission.revision, generation: c.permission.generation };
          const permission = await this.permissionSource.check(c);
          if (!permission.allowed) {
            await this.store.transaction((state) => {
              if (permission.erased) eraseAccountHash(state, accountHash(c.accountId), this.now());
              else {
                const contact = state.contacts.find((row) => row.id === c.id);
                if (contact?.permission && contact.permission.revision === beforeCheck.revision && contact.permission.generation === beforeCheck.generation)
                  contact.permission.eligible = false;
              }
            });
            throw new Error('Canonical permission unavailable or revoked.');
          }
          // Local unsubscribe, campaign pause or address changes may arrive
          // while One performs its fresh recipient lookup. Fence them again.
          c = await currentContact();
          if (c.email !== beforeCheck.email || c.permission?.revision !== beforeCheck.revision || c.permission.generation !== beforeCheck.generation)
            throw new Error('Permission changed before send.');
        }
        attempted = true;
        const providerId = await sender({
          to: c.email,
          delivery: reserved.delivery,
          message: deliveryMessage(reserved.delivery, c.id, this.runtime, c.permission?.generation),
        });
        await this.store.transaction((state) => {
          const d = state.deliveries.find((d) => d.id === reserved.delivery.id);
          const contact = state.contacts.find((c) => c.id === item.id);
          // An authoritative account erasure may race a provider response.
          // Never recreate an erased contact or its delivery history.
          if (!d || !contact) return;
          if (d.status === 'sending' || d.status === 'uncertain') d.status = 'sent';
          d.providerId = providerId;
          applyAcceptedDelivery(state, d);
          timeline(contact, actor, `Sent ${d.step} email.`, this.now());
        });
        sent++;
      } catch (error) {
        if (error instanceof GoogleMailUnattempted) attempted = false;
        if (!attempted) {
          // No provider request was attempted. Releasing this reservation lets
          // an unpause or restored eligibility be evaluated on the next cycle.
          await this.store.transaction((state) => {
            state.deliveries = state.deliveries.filter((d) => d.id !== reserved.delivery.id);
            audit(state, actor, 'Released an unsent reservation after eligibility changed.', this.now());
          });
          if (error instanceof PlgError && error.status >= 500) throw error;
          continue;
        }
        await this.store.transaction((state) => {
          const d = state.deliveries.find((d) => d.id === reserved.delivery.id);
          if (!d) return;
          if (d.status === 'sending') d.status = 'uncertain';
          audit(
            state,
            actor,
            'A reserved email needs delivery review; automatic retry blocked.',
            this.now(),
          );
        });
        uncertain++;
      }
    }
    return { sent, uncertain };
  }
}
