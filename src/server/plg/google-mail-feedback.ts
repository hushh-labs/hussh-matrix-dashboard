import { createHash } from 'node:crypto';
import type { PlgState } from '../../lib/plg';
import { applyAcceptedDelivery } from './delivery-events';
import { timeline } from './engine';
import { googleMessageMetadata, validRfcMessageId } from './google-mail-metadata';
import { MAIL_OWNER } from './google-mail-store';

interface Header { name: string; value: string }
export interface GmailPart { mimeType?: string; headers?: Header[]; body?: { data?: string; attachmentId?: string }; parts?: GmailPart[] }
export interface GmailMessage { id?: string; labelIds?: string[]; payload?: GmailPart }
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
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
export function reportedHardBounces(message: GmailMessage): { messageId: string; recipientHash: string }[] {
  const root = message.payload;
  const contentType = field(root?.headers, 'Content-Type');
  if (!root || root.mimeType?.toLowerCase() !== 'multipart/report' ||
    !/^multipart\/report\s*;/i.test(contentType ?? '') || !/;\s*report-type\s*=\s*"?delivery-status"?(?:\s*;|\s*$)/i.test(contentType ?? '')) return [];
  const tree = parts(root);
  const originals = tree.filter((p) => ['message/rfc822', 'text/rfc822-headers'].includes(p.mimeType?.toLowerCase() ?? ''));
  const ids = new Set(originals.flatMap((part) => {
    const headers = [...(part.headers ?? []), ...fields(body(part).split(/\r?\n\r?\n/)[0] ?? ''),
      ...(part.parts?.flatMap((p) => p.headers ?? []) ?? [])];
    const id = field(headers, 'Message-ID');
    return validRfcMessageId(id) ? [id] : [];
  }));
  if (ids.size !== 1) return [];
  const messageId = [...ids][0];
  return tree.filter((p) => p.mimeType?.toLowerCase() === 'message/delivery-status').flatMap((part) =>
    body(part).split(/\r?\n\r?\n/).flatMap((block) => {
      const values = fields(block);
      const final = field(values, 'Final-Recipient')?.match(/^rfc822\s*;\s*(.+)$/i)?.[1]?.trim().toLowerCase();
      if (field(values, 'Action')?.toLowerCase() !== 'failed' || !/^5\.\d{1,3}\.\d{1,3}$/.test(field(values, 'Status') ?? '') || !final || !address.test(final)) return [];
      return [{ messageId, recipientHash: sha(final) }];
    }));
}
/** Correlate the actual Gmail-assigned header and immutable recipient proof. */
export function applyGoogleHardBounce(state: PlgState, report: { messageId: string; recipientHash: string }, now: number) {
  if (!validRfcMessageId(report.messageId)) return false;
  const matches = state.deliveries.filter((d) => d.rfcMessageId === report.messageId && d.provider === 'google_workspace' && d.recipientHash === report.recipientHash);
  if (matches.length !== 1) return false;
  const delivery = matches[0];
  if (!delivery.providerId || delivery.status === 'manual') return false;
  const contact = state.contacts.find((c) => c.id === delivery.contactId);
  if (!contact) return false;
  if (delivery.status !== 'complained') delivery.status = 'bounced';
  if (contact.suppressed !== 'complained' && contact.suppressed !== 'bounced') {
    contact.suppressed = 'bounced';
    timeline(contact, 'Google mail feedback', 'A correlated hard-failure report stopped promotional email.', now);
  }
  return true;
}
/** Bind metadata only to a durable accepted provider ID. Unknown sends stay held. */
export function applyGoogleSubmission(state: PlgState, message: GmailMessage) {
  if (!message.id || !/^[a-zA-Z0-9_-]{1,160}$/.test(message.id) || !Array.isArray(message.labelIds) || !message.labelIds.includes('SENT')) return false;
  const headers = googleMessageMetadata(message);
  if (!headers || headers.from !== `Neelesh Meena <${MAIL_OWNER}>`) return false;
  const matches = state.deliveries.filter((d) => d.providerId === message.id && d.provider === 'google_workspace');
  if (matches.length !== 1) return false;
  const delivery = matches[0];
  if (delivery.recipientHash !== sha(headers.to) || delivery.status === 'manual' || !state.contacts.some((c) => c.id === delivery.contactId) ||
    (delivery.rfcMessageId && delivery.rfcMessageId !== headers.messageId)) return false;
  delivery.rfcMessageId = headers.messageId;
  if (delivery.status === 'sending' || delivery.status === 'uncertain') delivery.status = 'sent';
  applyAcceptedDelivery(state, delivery);
  return true;
}
