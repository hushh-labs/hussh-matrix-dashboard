import type { PlgDelivery, PlgState } from '../../lib/plg';
import { DAY, iso, timeline } from './engine';

export function applyAcceptedDelivery(state: PlgState, delivery: PlgDelivery) {
  const contact = state.contacts.find((c) => c.id === delivery.contactId);
  if (!contact || delivery.step !== 'feedback') return;
  // The stable reservation time makes transport and replayed callback handling
  // agree, without extending the pause each time the same callback arrives.
  const until = Date.parse(delivery.createdAt) + 30 * DAY;
  if (!contact.pauseUntil || Date.parse(contact.pauseUntil) < until) contact.pauseUntil = iso(until);
}

/** Called only after verifying the raw provider callback with its signing key. */
export function applyDeliveryEvent(state: PlgState, event: unknown, now: number) {
  if (!event || typeof event !== 'object') return;
  const value = event as { type?: unknown; data?: { email_id?: unknown; to?: unknown; tags?: Record<string, unknown> } };
  const data = value.data;
  if (!data || typeof value.type !== 'string') return;
  const recipients = Array.isArray(data.to) ? data.to.filter((e): e is string => typeof e === 'string').map((e) => e.toLowerCase()) : [];
  const suppression = value.type === 'email.bounced' ? 'bounced' : value.type === 'email.complained' ? 'complained' : null;
  // Suppression is address-wide and permanent, including when a recipient has
  // messages from another campaign in the same authorized sending account.
  if (suppression) for (const c of state.contacts) {
    if (recipients.includes(c.email) && c.suppressed !== 'unsubscribed' && c.suppressed !== 'complained' && c.suppressed !== suppression) {
      c.suppressed = suppression;
      timeline(c, 'Delivery provider', `Promotional email suppressed: ${suppression}.`, now);
    }
  }
  if (typeof data.email_id !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(data.email_id)) return;
  const tag = data.tags?.plg_delivery_id;
  const d = state.deliveries.find((d) => d.providerId === data.email_id) ??
    (typeof tag === 'string' ? state.deliveries.find((d) => d.id === tag && !d.providerId) : undefined);
  if (!d || d.status === 'manual') return;
  const contact = state.contacts.find((c) => c.id === d.contactId);
  if (!contact || recipients.length !== 1 || recipients[0] !== contact.email) return;
  const status: PlgDelivery['status'] | undefined = {
    'email.sent': 'sent', 'email.delivered': 'delivered', 'email.bounced': 'bounced',
    'email.complained': 'complained', 'email.failed': 'failed', 'email.suppressed': 'failed',
  }[value.type] as PlgDelivery['status'] | undefined;
  if (!status) return;
  d.providerId = data.email_id;
  applyAcceptedDelivery(state, d);
  // Late acceptance/delivery callbacks never undo a terminal failure or complaint.
  const rank = { manual: 0, sending: 0, uncertain: 0, sent: 1, delivered: 2, failed: 3, bounced: 4, complained: 5 };
  if (rank[status] > rank[d.status]) d.status = status;
}
