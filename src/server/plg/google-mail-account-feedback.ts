/** Preserve the global submission/page fence while committing facts per owner. */
import type { AccountPlgStore } from './account-store';
import { PlgError } from './engine';
import { applyGoogleHardBounce, applyGoogleSubmission, reportedHardBounces,
  type GmailMessage } from './google-mail-feedback';

async function receipt(accounts: AccountPlgStore, reference: Parameters<AccountPlgStore['receipt']>[0]) {
  try { return await accounts.receipt(reference); }
  catch (error) { if (error instanceof PlgError && error.status === 404) return null; throw error; }
}
export async function bindAccountSubmissions(accounts: AccountPlgStore, messages: GmailMessage[]) {
  for (const message of messages) {
    if (!message.id) continue;
    const store = await receipt(accounts, { providerId: message.id });
    if (!store) continue; // Operator previews and erased contacts are not campaigns.
    await store.transaction(state => {
      const retained = state.deliveries.some(delivery => delivery.provider === 'google_workspace' &&
        delivery.providerId === message.id && state.contacts.some(contact => contact.id === delivery.contactId));
      if (retained && !applyGoogleSubmission(state, message))
        throw new PlgError(503, 'Google acceptance metadata did not bind uniquely; sending remains held.');
    });
  }
}
export async function applyAccountFeedback(accounts: AccountPlgStore, messages: GmailMessage[], now: () => number) {
  return accounts.withFeedbackFence(async fenced => {
    await bindAccountSubmissions(fenced, messages);
    for (const message of messages) for (const report of reportedHardBounces(message)) {
      const store = await receipt(fenced, report);
      if (store) await store.transaction(state => { applyGoogleHardBounce(state, report, now()); });
    }
  });
}
