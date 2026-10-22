import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { MemoryPlgStore } from '../src/server/plg/store';
import { emptyMailControl, MAIL_OWNER, type MailControl, type MailControlStore } from '../src/server/plg/google-mail-store';
import { applyGoogleHardBounce, applyGoogleSubmission } from '../src/server/plg/google-mail-feedback';
import { reconcileGoogleFeedback, type GmailRead } from '../src/server/plg/google-mail-reconcile';

const recipient = 'synthetic@example.invalid';
const recipientHash = createHash('sha256').update(recipient).digest('hex');
const assigned = '<rewritten=actual@mail.gmail.com>';
class Control implements MailControlStore {
  state: MailControl = { ...emptyMailControl(), connection: { version: '1', generation: 1, connectedAt: Date.now(), feedbackAllowed: true }, feedback: { cursor: '100', checkedAt: 1 } };
  async read() { return structuredClone(this.state); }
  async transaction<T>(fn: (s: MailControl) => T): Promise<T> {
    const draft = structuredClone(this.state), result = fn(draft);
    this.state = draft; return structuredClone(result);
  }
}
const metadata = (id = 'accepted123', messageId = assigned) => ({ id, labelIds: ['SENT'], payload: { headers: [
  { name: 'Message-ID', value: messageId }, { name: 'From', value: `Neelesh Meena <${MAIL_OWNER}>` }, { name: 'To', value: recipient },
] } });
function report() {
  return { id: 'report123', payload: { mimeType: 'multipart/report', headers: [
    { name: 'Content-Type', value: 'multipart/report; report-type=delivery-status; boundary=sample' },
  ], parts: [
    { mimeType: 'message/delivery-status', body: { data: Buffer.from(`Final-Recipient: rfc822; ${recipient}\r\nAction: failed\r\nStatus: 5.1.1\r\n`).toString('base64url') } },
    { mimeType: 'text/rfc822-headers', body: { data: Buffer.from(`Message-ID: ${assigned}\r\n`).toString('base64url') } },
  ] } };
}
async function fixture(count = 1) {
  const campaigns = new MemoryPlgStore(), control = new Control();
  await campaigns.transaction((s) => {
    s.contacts.push({ id: 'contact', email: recipient, suppressed: null, timeline: [] } as any);
    s.deliveries = Array.from({ length: count }, (_, n) => ({ id: `reservation${n}`, contactId: 'contact', provider: 'google_workspace',
      providerId: n ? `accepted${n}` : 'accepted123', recipientHash, status: 'sent', step: 'welcome', createdAt: new Date().toISOString() } as any));
  });
  return { campaigns, control };
}
describe('Durable Gmail acceptance binding before feedback history', () => {
  it('binds historical accepted IDs before a DSN on the first page, even when SENT is on a later page', async () => {
    const { campaigns, control } = await fixture();
    const api = vi.fn<GmailRead>(async (path) => {
      if (path.startsWith('messages/accepted123?')) return metadata();
      if (path.startsWith('history?')) return path.includes('pageToken')
        ? { historyId: '300', history: [{ messagesAdded: [{ message: { id: 'accepted123' } }] }] }
        : { historyId: '200', nextPageToken: 'next', history: [{ messagesAdded: [{ message: { id: 'report123' } }] }] };
      if (path.includes('format=full')) return report();
      return { ...report(), payload: { mimeType: 'multipart/report', headers: report().payload.headers } };
    });
    expect(await reconcileGoogleFeedback(control, campaigns, api)).toEqual({ complete: false, inspected: 1 });
    expect(api.mock.calls[0][0]).toContain('messages/accepted123?format=metadata');
    expect((await campaigns.read()).deliveries[0]).toMatchObject({ providerId: 'accepted123', rfcMessageId: assigned, status: 'bounced' });
    expect((await campaigns.read()).contacts[0].suppressed).toBe('bounced');
    expect(control.state.feedback?.cursor).toBe('100');
    expect(control.state.feedback?.checkedAt).toBeNull();
    expect(await reconcileGoogleFeedback(control, campaigns, api)).toEqual({ complete: true, inspected: 1 });
    expect(control.state.feedback?.cursor).toBe('200');
    expect((await campaigns.read()).deliveries[0].status).toBe('bounced');
  });
  it.each(['wrong_id', 'wrong_sender', 'wrong_recipient', 'duplicate_header', 'missing_sent', 'failed_read', 'disconnect'] as const)('%s cannot make the checkpoint current', async (fault) => {
    const { campaigns, control } = await fixture(), before = await campaigns.read();
    const api = vi.fn<GmailRead>(async () => {
      const message = metadata();
      if (fault === 'wrong_id') message.id = 'another123';
      if (fault === 'wrong_sender') message.payload.headers[1].value = 'Other <other@example.invalid>';
      if (fault === 'wrong_recipient') message.payload.headers[2].value = 'other@example.invalid';
      if (fault === 'duplicate_header') message.payload.headers.push({ name: 'Message-ID', value: assigned });
      if (fault === 'missing_sent') message.labelIds = ['INBOX'];
      if (fault === 'failed_read') throw new Error('Synthetic unavailable message');
      if (fault === 'disconnect') delete control.state.connection;
      return message;
    });
    await expect(reconcileGoogleFeedback(control, campaigns, api)).rejects.toThrow();
    expect((await campaigns.read())).toEqual(before);
    expect(control.state.feedback?.cursor).toBe('100');
    expect(control.state.feedback?.checkedAt).toBeNull();
    expect(control.state.feedbackLease).toBeUndefined();
    expect(api.mock.calls.some(([path]) => path.startsWith('history?'))).toBe(false);
  });
  it('persists at most twenty bindings per cycle and holds history until the remaining binding is durable', async () => {
    const { campaigns, control } = await fixture(21);
    const api = vi.fn<GmailRead>(async (path) => {
      if (path.startsWith('history?')) return { historyId: '200', history: [] };
      const id = path.match(/^messages\/([^?]+)/)![1];
      return metadata(id, `<${id}=actual@mail.gmail.com>`);
    });
    expect(await reconcileGoogleFeedback(control, campaigns, api)).toEqual({ complete: false, inspected: 0 });
    expect((await campaigns.read()).deliveries.filter((d) => d.rfcMessageId)).toHaveLength(20);
    expect(api.mock.calls).toHaveLength(20);
    expect(control.state.feedback?.checkedAt).toBeNull();
    expect(await reconcileGoogleFeedback(control, campaigns, api)).toEqual({ complete: true, inspected: 0 });
    expect((await campaigns.read()).deliveries.filter((d) => d.rfcMessageId)).toHaveLength(21);
    expect(control.state.feedback?.cursor).toBe('200');
  });
  it.each(['acceptance_during_history', 'still_in_flight'] as const)('%s leaves the DSN replayable until the accepted header is bound', async (timing) => {
    const { campaigns, control } = await fixture();
    await campaigns.transaction((s) => { s.deliveries[0].providerId = null; s.deliveries[0].status = 'sending'; });
    const api = vi.fn<GmailRead>(async (path) => {
      if (path.startsWith('messages/accepted123?')) return metadata();
      if (path.startsWith('history?')) {
        if (timing === 'acceptance_during_history') await campaigns.transaction((s) => { s.deliveries[0].providerId = 'accepted123'; s.deliveries[0].status = 'sent'; });
        return { historyId: '200', history: [{ messagesAdded: [{ message: { id: 'report123' } }] }] };
      }
      return path.includes('format=full') ? report() : { ...report(), payload: { mimeType: 'multipart/report', headers: report().payload.headers } };
    });
    expect(await reconcileGoogleFeedback(control, campaigns, api)).toEqual({ complete: false, inspected: 0 });
    expect(control.state.feedback).toMatchObject({ cursor: '100', checkedAt: null, pending: { ids: ['report123'] } });
    expect((await campaigns.read()).contacts[0].suppressed).toBeNull();
    if (timing === 'still_in_flight') await campaigns.transaction((s) => { s.deliveries[0].providerId = 'accepted123'; s.deliveries[0].status = 'sent'; });
    expect(await reconcileGoogleFeedback(control, campaigns, api)).toEqual({ complete: true, inspected: 1 });
    expect((await campaigns.read()).deliveries[0]).toMatchObject({ rfcMessageId: assigned, status: 'bounced' });
    expect(control.state.feedback?.cursor).toBe('200');
  });
  it('does not resurrect an account erased while its metadata is in flight', async () => {
    const { campaigns, control } = await fixture();
    const api = vi.fn<GmailRead>(async (path) => {
      if (path.startsWith('history?')) return { historyId: '200', history: [] };
      await campaigns.transaction((s) => { s.contacts = []; s.deliveries = []; });
      return metadata();
    });
    expect(await reconcileGoogleFeedback(control, campaigns, api)).toEqual({ complete: true, inspected: 0 });
    expect((await campaigns.read()).contacts).toHaveLength(0);
    expect((await campaigns.read()).deliveries).toHaveLength(0);
  });
  it('holds unknown sends and rejects ambiguous acceptance or bounce mappings', async () => {
    const { campaigns } = await fixture();
    await campaigns.transaction((s) => {
      s.deliveries[0].providerId = null; s.deliveries[0].status = 'uncertain';
      expect(applyGoogleSubmission(s, metadata())).toBe(false);
      expect(s.deliveries[0].status).toBe('uncertain');
      s.deliveries[0].providerId = 'accepted123';
      s.deliveries.push({ ...s.deliveries[0], id: 'differentReservation' });
      expect(applyGoogleSubmission(s, metadata())).toBe(false);
      s.deliveries.forEach((d) => { d.rfcMessageId = assigned; });
      expect(applyGoogleHardBounce(s, { messageId: assigned, recipientHash }, Date.now())).toBe(false);
      expect(s.contacts[0].suppressed).toBeNull();
    });
  });
});
