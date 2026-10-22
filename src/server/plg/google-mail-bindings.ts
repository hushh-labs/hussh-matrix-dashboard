import type { PlgState } from '../../lib/plg';
import type { PlgStore } from './store';
import type { GmailRead } from './google-mail-reconcile';
import { applyGoogleSubmission, type GmailMessage } from './google-mail-feedback';
import { validRfcMessageId } from './google-mail-metadata';
import { PlgError } from './engine';

export function unboundGoogleDeliveries(state: PlgState) {
  return state.deliveries.filter((d) => d.provider === 'google_workspace' && d.providerId &&
    !validRfcMessageId(d.rfcMessageId) && state.contacts.some((c) => c.id === d.contactId));
}
/** Backfill exact acceptance IDs before history: DSNs may precede SENT pages. */
export async function bindGoogleAcceptedMetadata(campaigns: PlgStore, api: GmailRead, signal: AbortSignal,
  assertAuthority: () => Promise<unknown>) {
  const batch = unboundGoogleDeliveries(await campaigns.read()).slice(0, 20);
  const messages: GmailMessage[] = [];
  let next = 0;
  const outcomes = await Promise.allSettled(Array.from({ length: Math.min(4, batch.length) }, async () => {
    while (next < batch.length) {
      signal.throwIfAborted();
      const delivery = batch[next++], id = delivery.providerId!;
      if (!/^[a-zA-Z0-9_-]{1,160}$/.test(id)) throw new Error('Invalid durable Google acceptance.');
      const message = await api(`messages/${id}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=From&metadataHeaders=To`, signal);
      if (message?.id !== id) throw new Error('Google acceptance metadata mismatch.');
      messages.push(message);
    }
  }));
  if (outcomes.some((r) => r.status === 'rejected')) throw new PlgError(503, 'Google acceptance metadata is incomplete; sending remains held.');
  signal.throwIfAborted();
  await assertAuthority();
  await campaigns.transaction((s) => {
    for (const message of messages) {
      // Erasure during I/O removes authority; never recreate the missing row.
      const retained = s.deliveries.filter((d) => d.provider === 'google_workspace' && d.providerId === message.id && s.contacts.some((c) => c.id === d.contactId));
      if (retained.length && !applyGoogleSubmission(s, message))
        throw new PlgError(503, 'Google acceptance metadata did not bind uniquely; sending remains held.');
    }
    const bound = s.deliveries.filter((d) => d.provider === 'google_workspace' && d.rfcMessageId);
    if (bound.some((d, i) => bound.slice(i + 1).some((other) => other.rfcMessageId === d.rfcMessageId && other.recipientHash === d.recipientHash)))
      throw new PlgError(503, 'Google acceptance metadata is ambiguous; sending remains held.');
  });
  return unboundGoogleDeliveries(await campaigns.read()).length === 0;
}
