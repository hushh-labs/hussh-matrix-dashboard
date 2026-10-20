import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { PlgDelivery, PlgWorkspace } from '../../lib/plg';
import { audit, candidate, DAY, iso, metrics, PlgError, timeline } from './engine';
import type { PlgStore } from './store';

export interface PlgRuntime {
  enabled: boolean;
  deliveryEnabled: boolean;
  origin: string;
  admins: Set<string>;
  operators: Set<string>;
  signingSecret: string;
  syncSecret?: string;
  webhookSecret: string;
  apiKey: string;
  from: string;
  replyTo: string;
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
    enabled: process.env.PLG_ENABLED === 'true',
    deliveryEnabled: process.env.PLG_DELIVERY_ENABLED === 'true',
    origin,
    admins: emails(process.env.PLG_ADMIN_EMAILS),
    operators: emails(process.env.PLG_OPERATOR_EMAILS),
    signingSecret: process.env.PLG_SIGNING_SECRET || '',
    syncSecret: process.env.PLG_SYNC_SECRET || '',
    webhookSecret: process.env.PLG_RESEND_WEBHOOK_SECRET || '',
    apiKey: process.env.PLG_RESEND_API_KEY || '',
    from: process.env.PLG_EMAIL_FROM || '',
    replyTo: process.env.PLG_REPLY_TO || '',
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
export function preferenceToken(contactId: string, secret: string) {
  return `${contactId}.${signValue(`preferences:${contactId}`, secret)}`;
}
export function tokenContact(token: string, secret: string) {
  const [id, signature, extra] = token.split('.');
  if (
    secret.length < 32 ||
    extra ||
    !/^[a-f0-9-]{36}$/.test(id ?? '') ||
    !equalSignature(signature ?? '', signValue(`preferences:${id}`, secret))
  )
    throw new PlgError(400, 'This preference link is invalid.');
  return id;
}
export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
export function deliveryMessage(d: PlgDelivery, contactId: string, config: PlgRuntime) {
  const preferences = `${config.origin}/integrations/plg/preferences/${preferenceToken(contactId, config.signingSecret)}`;
  const unsubscribe = `${config.origin}/integrations/plg/unsubscribe/${preferenceToken(contactId, config.signingSecret)}`;
  const plain = `${d.body}${d.resourceUrl ? `\n\nDemo or guide: ${d.resourceUrl}` : ''}\n\n${d.ctaLabel}: ${d.ctaUrl}\n\nPreferences: ${preferences}\nUnsubscribe: ${unsubscribe}`;
  return {
    text: plain,
    html: `<div style="font:16px/1.6 Arial,sans-serif;max-width:600px;margin:auto"><p>${escapeHtml(d.body).replaceAll('\n', '<br>')}</p>${d.resourceUrl ? `<p><a href="${escapeHtml(d.resourceUrl)}">View the demo or guide</a></p>` : ''}<p><a href="${escapeHtml(d.ctaUrl)}">${escapeHtml(d.ctaLabel)}</a></p><p style="font-size:12px"><a href="${escapeHtml(preferences)}">Email preferences</a> &middot; <a href="${escapeHtml(unsubscribe)}">Unsubscribe</a></p></div>`,
    headers: {
      'List-Unsubscribe': `<${unsubscribe}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}
export type PlgTransport = (input: {
  to: string;
  delivery: PlgDelivery;
  message: ReturnType<typeof deliveryMessage>;
}) => Promise<string>;
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
  constructor(
    public store: PlgStore,
    public runtime: PlgRuntime,
    private now = Date.now,
    private transport: PlgTransport = resendTransport(runtime),
  ) {}
  async workspace(role: 'admin' | 'operator'): Promise<PlgWorkspace> {
    const state = await this.store.read();
    const now = this.now();
    return {
      role,
      configured: true,
      deliveryEnabled: this.runtime.deliveryEnabled,
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
  async run(actor: string) {
    if (
      !this.runtime.deliveryEnabled ||
      this.runtime.signingSecret.length < 32 ||
      !this.runtime.apiKey ||
      !this.runtime.from ||
      !this.runtime.replyTo ||
      !this.runtime.webhookSecret ||
      !this.runtime.origin.startsWith('https:')
    )
      throw new PlgError(409, 'Live delivery is disabled or incomplete. Use campaign preview.');
    const snapshot = await this.store.read();
    if (snapshot.paused) throw new PlgError(409, 'Campaigns are paused.');
    let sent = 0,
      uncertain = 0;
    const due = snapshot.contacts
      .filter((c) => candidate(snapshot, c, this.now()).eligible)
      .slice(0, 10);
    for (const item of due) {
      const now = this.now();
      const reserved = await this.store.transaction((state) => {
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
        };
        state.deliveries.push(d);
        timeline(c, actor, `Reserved ${d.step} email.`, now);
        return { contact: c, delivery: d };
      });
      if (!reserved) continue;
      // No external side effect occurs inside a retried Firestore transaction.
      // Reservations are permanent. Ambiguous network failures require review;
      // never retry blindly after the provider's 24-hour idempotency window.
      try {
        const current = await this.store.read();
        const c = current.contacts.find((c) => c.id === item.id)!;
        const check = candidate(
          {
            ...current,
            deliveries: current.deliveries.filter((d) => d.id !== reserved.delivery.id),
          },
          c,
          this.now(),
        );
        if (
          !check.eligible ||
          check.key !== reserved.delivery.key ||
          check.templateId !== reserved.delivery.templateId
        )
          throw new Error('Eligibility changed before send.');
        const providerId = await this.transport({
          to: c.email,
          delivery: reserved.delivery,
          message: deliveryMessage(reserved.delivery, c.id, this.runtime),
        });
        await this.store.transaction((state) => {
          const d = state.deliveries.find((d) => d.id === reserved.delivery.id)!;
          d.status = 'sent';
          d.providerId = providerId;
          const contact = state.contacts.find((c) => c.id === item.id)!;
          if (d.step === 'feedback') contact.pauseUntil = iso(this.now() + 30 * DAY);
          timeline(contact, actor, `Sent ${d.step} email.`, this.now());
        });
        sent++;
      } catch {
        await this.store.transaction((state) => {
          const d = state.deliveries.find((d) => d.id === reserved.delivery.id)!;
          d.status = 'uncertain';
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
