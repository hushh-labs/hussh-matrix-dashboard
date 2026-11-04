import { randomUUID } from 'node:crypto';
import { GoogleMailUnattempted, type GoogleMail } from './google-mail';
import { reconcileGoogleFeedback } from './google-mail-reconcile';
import { MemoryPlgStore } from './store';
import { renderPlgEmailHtml } from './email-layout';
import type { AttemptGrant, OneAttemptEmails } from './attempt-email-source';
import type { AttemptMailControl } from './attempt-email-control';

/** Fixed metadata only. There is no freeform body, address, CC or BCC input. */
export function attemptEmailMessage(grant: AttemptGrant, environment: 'uat' | 'production') {
  const outcome = { returned: 'A response was reported', failed: 'A failure was reported',
    cancelled: 'Cancellation was reported', blocked: 'The attempt was reported as blocked' }[grant.phase];
  const subject = `${environment === 'uat' ? '[UAT] ' : ''}${grant.agentLabel}: ${outcome.toLowerCase()}`;
  const body = `${grant.agentLabel}\n${grant.actionLabel}\n${outcome}\nReported at ${new Date(grant.observedAt).toISOString()}\n\n` +
    'You chose an email for each reported attempt. This receipt reflects an application report; it does not confirm an external action succeeded. Prompts, arguments and results are not included.';
  const origin = environment === 'uat' ? 'https://uat.one.hussh.ai' : 'https://one.hussh.ai';
  const manage = `${origin}/one/profile/account`;
  return { delivery: { id: grant.id, subject }, message: {
    text: `${subject}\n\n${body}\n\nActivity email preferences: ${manage}\nStop these emails: ${grant.unsubscribeUrl}`,
    html: renderPlgEmailHtml({ subject, body, ctaLabel: 'Open your private agent', ctaUrl: origin,
      preferences: { manage, unsubscribe: grant.unsubscribeUrl } }),
    headers: { 'List-Unsubscribe': `<${grant.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  } };
}

/** Existing scheduled worker, bounded batch. OAuth and feedback precede the last owner claim. */
export async function runAttemptEmailCycle(source: OneAttemptEmails, mail: GoogleMail,
  control: AttemptMailControl, now = Date.now) {
  const id = randomUUID(), started = now(), deadline = started + 195_000;
  await control.acquire(id, started);
  let accepted = 0, uncertain = 0, deferred = false, failed = true;
  try {
    // Replay receipts before feedback and before any provider work. This queue
    // contains no account ID, recipient or message body; erasure retires it in One.
    for (const receipt of await control.acknowledgements()) {
      await control.assertLease(id, now());
      if (now() + 35_000 >= deadline) { deferred = true; failed = false; return { accepted, uncertain, deferred }; }
      await source.acknowledge(receipt);
      await control.forgetAcknowledgement(receipt);
    }
    // This delivery owner has no marketing campaign contacts. Its remote SQL
    // ledger participates in the same canonical Gmail feedback implementation.
    const feedbackDeadline = Math.min(deadline, now() + 60_000);
    const feedback = await reconcileGoogleFeedback(control, new MemoryPlgStore(),
      await mail.feedbackReader(feedbackDeadline), feedbackDeadline, now, source);
    if (!feedback.complete) { deferred = true; failed = false; return { accepted, uncertain, deferred }; }
    for (const row of await source.pending()) {
      await control.assertLease(id, now());
      if (now() + 65_000 >= deadline) { deferred = true; break; }
      const status = await mail.status();
      if (status.pacingRetryAt && status.pacingRetryAt > now() || status.providerRetryAt && status.providerRetryAt > now()) {
        deferred = true; break; // Keep unclaimed rows eligible for a later ordinary cycle.
      }
      let prepared;
      try { prepared = await mail.prepareCampaign(); }
      catch { deferred = true; break; }
      await control.assertLease(id, now());
      const claimId = randomUUID();
      let grant: AttemptGrant | null;
      try { grant = await source.claim(row, claimId); }
      catch { uncertain++; break; } // Lost grant is never requested again.
      if (!grant) continue;
      let providerId: string | null = null, notSubmitted = false;
      try {
        await control.assertLease(id, now());
        const rendered = attemptEmailMessage(grant, source.environment);
        providerId = await mail.send(grant.to, rendered.delivery, rendered.message, 'campaign', prepared);
      } catch (error) {
        notSubmitted = error instanceof GoogleMailUnattempted;
      }
      // Only acknowledgement is idempotent. A failed acknowledgement never
      // calls the provider again or releases an ambiguous submission.
      try {
        const receipt = { id: row.id, claimId, providerId, notSubmitted };
        await control.recordAcknowledgement(id, receipt, now());
        await source.acknowledge(receipt);
        await control.forgetAcknowledgement(receipt);
      }
      catch { uncertain++; break; }
      if (providerId) accepted++;
      else if (notSubmitted) { deferred = true; break; }
      else { uncertain++; break; }
    }
    failed = false;
    return { accepted, uncertain, deferred };
  } finally {
    await control.finish(id, { finishedAt: now(), accepted, uncertain, deferred,
      status: failed ? 'failed' : uncertain || deferred ? 'blocked' : 'completed' });
  }
}
