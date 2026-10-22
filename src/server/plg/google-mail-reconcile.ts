import { randomUUID } from 'node:crypto';
import type { PlgStore } from './store';
import type { MailControlStore } from './google-mail-store';
import { applyGoogleHardBounce, applyGoogleSubmission, reportedHardBounces, type GmailMessage, type GmailPart } from './google-mail-feedback';
import { PlgError } from './engine';

export type GmailRead = (path: string, signal: AbortSignal) => Promise<any>;
/** Status only: provider response bodies never enter logs or the UI. */
export class GmailReadError extends Error {
  constructor(public readonly status: number) { super('Google mail request did not confirm success.'); }
}
const numeric = (id: unknown): id is string => typeof id === 'string' && /^\d{1,30}$/.test(id);
const opaque = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(id);
/** No mailbox content or identity fields enter the persisted cursor. */
export async function reconcileGoogleFeedback(control: MailControlStore, campaigns: PlgStore, api: GmailRead,
  deadline = Date.now() + 45_000, now = Date.now) {
  const lease = randomUUID();
  const connection = await control.transaction((s) => {
    if (!s.connection?.feedbackAllowed) throw new PlgError(409, 'Customer mail requires Google report-reading authorization.');
    if (s.feedbackLease && s.feedbackLease.until > now()) throw new PlgError(409, 'Google feedback reconciliation is already running.');
    s.feedbackLease = { id: lease, until: now() + 75_000 };
    return s.connection;
  });
  const update = <T>(fn: (s: Awaited<ReturnType<MailControlStore['read']>>) => T) => control.transaction((s) => {
    if (s.feedbackLease?.id !== lease || s.feedbackLease.until <= now() ||
      s.connection?.version !== connection.version || s.connection.generation !== connection.generation)
      throw new PlgError(409, 'Google feedback ownership changed.');
    return fn(s);
  });
  const remaining = deadline - now();
  const signal = AbortSignal.timeout(Math.max(1, Math.min(45_000, remaining)));
  try {
    if (remaining < 5000) throw new PlgError(503, 'Google feedback deadline is too close.');
    let state = await control.read();
    const recover = async () => {
      const deliveries = (await campaigns.read()).deliveries.filter((d) => d.provider === 'google_workspace');
      const dates = deliveries.map((d) => Date.parse(d.createdAt));
      if (dates.some((date) => !Number.isFinite(date) || date > now()))
        throw new PlgError(409, 'Google feedback history is missing a valid recovery boundary.');
      // Retained mail since the oldest retained Google reservation, with a day
      // of overlap. Capture history BEFORE listing so later arrivals are caught
      // by the following incremental poll, including during paginated recovery.
      const profile = await api('profile', signal);
      if (!numeric(profile.historyId)) throw new Error('Invalid Google history checkpoint.');
      const after = Math.max(0, Math.floor((Math.min(now(), ...dates) - 86_400_000) / 1000));
      await update((s) => { s.feedback = { cursor: s.feedback?.cursor ?? '0', checkedAt: null,
        recovery: { after, upper: profile.historyId } }; });
      state = await control.read();
    };
    if (!state.feedback) {
      // Establish the baseline BEFORE the first campaign send. Reconnecting
      // keeps this cursor; missing history after previous sends cannot reset it.
      if ((await campaigns.read()).deliveries.some((d) => d.provider === 'google_workspace')) await recover();
      else {
        const profile = await api('profile', signal);
        if (!numeric(profile.historyId)) throw new Error('Invalid Google history checkpoint.');
        await update((s) => { s.feedback = { cursor: profile.historyId, checkedAt: now() }; });
        return { complete: true, inspected: 0 };
      }
    }
    if (!state.feedback.pending) {
      const query = new URLSearchParams({ startHistoryId: state.feedback.cursor, historyTypes: 'messageAdded', maxResults: '20' });
      if (state.feedback.pageToken) query.set('pageToken', state.feedback.pageToken);
      let page: any;
      if (!state.feedback.recovery) {
        try { page = await api(`history?${query}`, signal); }
        catch (error) {
          if (!(error instanceof GmailReadError) || error.status !== 404) throw error;
          await recover();
        }
      }
      if (state.feedback!.recovery) {
        const recovery = state.feedback!.recovery;
        const full = new URLSearchParams({ q: `after:${recovery.after}`, includeSpamTrash: 'true', maxResults: '20' });
        if (state.feedback!.pageToken) full.set('pageToken', state.feedback!.pageToken);
        const listed = await api(`messages?${full}`, signal);
        if (!Array.isArray(listed.messages ?? []) || (listed.messages?.length ?? 0) > 20)
          throw new Error('Google recovery page exceeds its bound.');
        page = { historyId: recovery.upper, nextPageToken: listed.nextPageToken,
          history: [{ messagesAdded: (listed.messages ?? []).map((message: any) => ({ message })) }] };
      }
      if (!numeric(page.historyId) || (page.nextPageToken !== undefined && (typeof page.nextPageToken !== 'string' || page.nextPageToken.length > 2048)))
        throw new Error('Invalid Google history page.');
      const records = page.history ?? [];
      if (!Array.isArray(records) || records.length > 20) throw new Error('Google feedback page exceeds its bound.');
      const ids = [...new Set<string>(records.flatMap((record: any) => {
        if (!Array.isArray(record.messagesAdded ?? [])) throw new Error('Invalid Google history record.');
        return (record.messagesAdded ?? []).map((entry: any) => {
          if (!opaque(entry.message?.id)) throw new Error('Invalid Google message reference.');
          return entry.message.id as string;
        });
      }))];
      if (ids.length > 1000) throw new Error('Google feedback backlog needs a bounded recovery.');
      await update((s) => { s.feedback!.pending = { ids, nextPage: page.nextPageToken ?? null, upper: s.feedback!.upper ?? page.historyId }; });
      state = await control.read();
    }
    const batch = state.feedback!.pending!.ids.slice(0, 20);
    const read = async (id: string): Promise<GmailMessage> => {
      const message = await api(`messages/${id}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Content-Type`, signal);
      if (message.id !== id) throw new Error('Google feedback message mismatch.');
      const types = message.payload?.headers?.filter((h: any) => h.name?.toLowerCase() === 'content-type');
      if (types?.length === 1 && /^multipart\/report\s*;/i.test(types[0].value)) {
        const full = await api(`messages/${id}?format=full`, signal);
        if (full.id !== id) throw new Error('Google report mismatch.');
        const hydrate = async (part: GmailPart, depth = 0) => {
          if (depth > 8 || (part.parts?.length ?? 0) > 20) throw new Error('Google report exceeds its bound.');
          // Fetch only structured report / original-header attachments, never
          // arbitrary attachments or customer product content.
          if (part.body?.attachmentId && ['message/delivery-status', 'message/rfc822', 'text/rfc822-headers'].includes(part.mimeType ?? '')) {
            if (!/^[a-zA-Z0-9_-]{1,4096}$/.test(part.body.attachmentId)) throw new Error('Invalid report attachment.');
            const attachment = await api(`messages/${id}/attachments/${part.body.attachmentId}`, signal);
            if (typeof attachment.data !== 'string' || attachment.data.length > 90_000) throw new Error('Report attachment exceeds its bound.');
            part.body.data = attachment.data;
          }
          for (const child of part.parts ?? []) await hydrate(child, depth + 1);
        };
        await hydrate(full.payload);
        return full;
      }
      return message;
    };
    const messages: GmailMessage[] = [];
    let next = 0;
    const outcomes = await Promise.allSettled(Array.from({ length: Math.min(4, batch.length) }, async () => {
      while (next < batch.length) {
        signal.throwIfAborted();
        const id = batch[next++]; messages.push(await read(id));
      }
    }));
    if (outcomes.some((result) => result.status === 'rejected')) throw new PlgError(503, 'Google feedback read is incomplete; sending remains held.');
    signal.throwIfAborted();
    await update(() => undefined); // authority check before committing facts
    await campaigns.transaction((s) => {
      for (const message of messages) {
        applyGoogleSubmission(s, message);
        for (const report of reportedHardBounces(message)) applyGoogleHardBounce(s, report, now());
      }
    });
    return await update((s) => {
      const feedback = s.feedback!, pending = feedback.pending!;
      pending.ids = pending.ids.slice(batch.length);
      if (pending.ids.length) return { complete: false, inspected: batch.length };
      if (pending.nextPage) {
        feedback.pageToken = pending.nextPage; feedback.upper = pending.upper;
        delete feedback.pending;
        return { complete: false, inspected: batch.length };
      }
      feedback.cursor = pending.upper; feedback.checkedAt = now();
      delete feedback.pending; delete feedback.pageToken; delete feedback.upper;
      if (feedback.recovery) {
        delete feedback.recovery; feedback.checkedAt = null;
        return { complete: false, inspected: batch.length }; // catch up from the pre-list history snapshot before sending
      }
      return { complete: true, inspected: batch.length };
    });
  } finally {
    await control.transaction((s) => { if (s.feedbackLease?.id === lease) delete s.feedbackLease; });
  }
}
