import { createHash } from 'node:crypto';
import type { PlgState } from '../../lib/plg';
import { applyAcceptedDelivery } from './delivery-events';
import { timeline } from './engine';

interface Header { name: string; value: string }
export interface GmailPart { mimeType?: string; headers?: Header[]; body?: { data?: string; attachmentId?: string }; parts?: GmailPart[] }
export interface GmailMessage { id?: string; labelIds?: string[]; payload?: GmailPart }
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const messageId = /^<plg-([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})@metrics\.hussh\.ai>$/;
const address = /^[^\s<>@,;\r\n]+@[^\s<>@,;\r\n]+\.[^\s<>@,;\r\n]+$/;
function field(headers: Header[] | undefined, name: string) {
  const found = headers?.filter((h) => h.name?.toLowerCase() === name.toLowerCase());
  return found?.length === 1 ? found[0].value?.trim() : undefined;
}
function body(part: GmailPart) {
  const raw = part.body?.data;
  if (!raw || raw.length > 90_000 || !/^[a-zA-Z0-9_-]*={0,2}$/.test(raw)) return '';
  return Buffer.from(raw, 'base64url').toString('utf8');
}
function fields(raw: string): Header[] {
  return raw.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/).flatMap((line) => {
    const match = /^([a-zA-Z][a-zA-Z0-9-]*):[ \t]*(.*)$/.exec(line);
    return match ? [{ name: match[1], value: match[2] }] : [];
  });
}
function parts(root: GmailPart): GmailPart[] {
  const queue = [root], output: GmailPart[] = [];
  while (queue.length && output.length < 40) {
    const part = queue.shift()!; output.push(part);
    if (part.parts) queue.push(...part.parts.slice(0, 40));
  }
  return queue.length ? [] : output;
}
/** RFC3464 negative reports only. Content is discarded; no positive delivery inference. */
export function reportedHardBounces(message: GmailMessage): { deliveryId: string; recipientHash: string }[] {
  const root = message.payload;
  const contentType = field(root?.headers, 'Content-Type');
  if (!root || root.mimeType?.toLowerCase() !== 'multipart/report' ||
    !/^multipart\/report\s*;/i.test(contentType ?? '') || !/;\s*report-type\s*=\s*"?delivery-status"?(?:\s*;|\s*$)/i.test(contentType ?? '')) return [];
  const tree = parts(root);
  const originals = tree.filter((p) => ['message/rfc822', 'text/rfc822-headers'].includes(p.mimeType?.toLowerCase() ?? ''));
  const ids = new Set(originals.flatMap((part) => {
    const headers = [...(part.headers ?? []), ...fields(body(part).split(/\r?\n\r?\n/)[0] ?? ''),
      ...(part.parts?.flatMap((p) => p.headers ?? []) ?? [])];
    const id = field(headers, 'Message-ID')?.match(messageId)?.[1];
    return id ? [id] : [];
  }));
  if (ids.size !== 1) return [];
  const deliveryId = [...ids][0];
  return tree.filter((p) => p.mimeType?.toLowerCase() === 'message/delivery-status').flatMap((part) =>
    body(part).split(/\r?\n\r?\n/).flatMap((block) => {
      const values = fields(block);
      const final = field(values, 'Final-Recipient')?.match(/^rfc822\s*;\s*(.+)$/i)?.[1]?.trim().toLowerCase();
      if (field(values, 'Action')?.toLowerCase() !== 'failed' || !/^5\.\d{1,3}\.\d{1,3}$/.test(field(values, 'Status') ?? '') || !final || !address.test(final)) return [];
      return [{ deliveryId, recipientHash: sha(final) }];
    }));
}
/** A report may stop only its exact unpredictable reservation/address pair. */
export function applyGoogleHardBounce(state: PlgState, report: { deliveryId: string; recipientHash: string }, now: number) {
  const delivery = state.deliveries.find((d) => d.id === report.deliveryId && d.provider === 'google_workspace');
  if (!delivery || !delivery.recipientHash || delivery.recipientHash !== report.recipientHash || delivery.status === 'manual') return false;
  const contact = state.contacts.find((c) => c.id === delivery.contactId);
  if (!contact) return false;
  if (delivery.status !== 'complained') delivery.status = 'bounced';
  if (contact.suppressed !== 'complained' && contact.suppressed !== 'bounced') {
    contact.suppressed = 'bounced';
    timeline(contact, 'Google mail feedback', 'A correlated hard-failure report stopped promotional email.', now);
  }
  return true;
}
/** Gmail SENT proves submission, not delivery, and can repair a lost API response. */
export function applyGoogleSubmission(state: PlgState, message: GmailMessage) {
  if (!message.id || !/^[a-zA-Z0-9_-]{1,160}$/.test(message.id) || !message.labelIds?.includes('SENT')) return false;
  const id = field(message.payload?.headers, 'Message-ID')?.match(messageId)?.[1];
  const recipient = field(message.payload?.headers, 'To')?.toLowerCase();
  const from = field(message.payload?.headers, 'From');
  if (!id || !recipient || !address.test(recipient) || from !== 'Neelesh Meena <i-neelesh@hushh.ai>') return false;
  const delivery = state.deliveries.find((d) => d.id === id && d.provider === 'google_workspace' && d.recipientHash === sha(recipient));
  if (!delivery || !state.contacts.some((c) => c.id === delivery.contactId)) return false;
  if (delivery.providerId && delivery.providerId !== message.id) return false;
  delivery.providerId = message.id;
  if (delivery.status === 'sending' || delivery.status === 'uncertain') delivery.status = 'sent';
  applyAcceptedDelivery(state, delivery);
  return true;
}
