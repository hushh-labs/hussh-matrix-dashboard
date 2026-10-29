/** Persist only status and retry timing; provider response bodies are discarded. */
import { PlgError } from './engine';
import type { MailControl } from './google-mail-store';

export class GmailSubmissionRejected extends Error {
  // Gmail documents these authorization/quota responses as request rejections:
  // https://developers.google.com/workspace/gmail/api/guides/handle-errors
  constructor(public status: 401 | 403 | 429, public retryAfter: string | null) {
    super('Google explicitly rejected this submission.');
  }
}
export function mailBackoff(state: MailControl) {
  const hold = state.sendBackoff, connection = state.connection;
  if (!hold || !connection || hold.version !== connection.version || hold.generation !== connection.generation) return null;
  if (![401, 403, 429].includes(hold.status) || !Number.isSafeInteger(hold.until) || hold.until < 0 ||
    hold.until > 8.64e15 || !Number.isSafeInteger(hold.failures) || hold.failures < 1 || hold.failures > 8)
    throw new PlgError(503, 'Email provider retry state could not be verified.');
  return hold;
}
export function requireMailReady(state: MailControl, now: number) {
  const hold = mailBackoff(state);
  if (hold && hold.until > now) throw new PlgError(hold.status, 'Email provider retry is deferred.');
  if (mailPacingRetryAt(state, now)) throw new PlgError(429, 'Mailbox sending is paced; messages remain queued.');
}

// Ten immediate submissions, then one slot per minute. This is an application
// pacing policy, not a claim about paid/trial Gmail entitlement. It bounds the
// rolling-day attempt ledger to 1,449 new entries without a daily send cutoff.
const MAIL_INTERVAL = 60_000, MAIL_BURST = 10;
export function mailPacingRetryAt(state: MailControl, now: number) {
  if (state.pacingNextAt === undefined) return null;
  if (!Number.isSafeInteger(state.pacingNextAt) || state.pacingNextAt < 0 || state.pacingNextAt > 8.64e15)
    throw new PlgError(503, 'Mailbox pacing state could not be verified.');
  const retryAt = state.pacingNextAt - (MAIL_BURST - 1) * MAIL_INTERVAL;
  return retryAt > now ? retryAt : null;
}
export function reserveMailPacing(state: MailControl, now: number) {
  requireMailReady(state, now);
  state.pacingNextAt = Math.max(now, state.pacingNextAt ?? now) + MAIL_INTERVAL;
}
export function recordMailRejection(state: MailControl, connection: NonNullable<MailControl['connection']>,
  id: string, rejected: GmailSubmissionRejected, now: number) {
  state.attempts = state.attempts.filter(attempt => attempt.id !== id);
  // A response from the old grant cannot hold a newly authorized connection.
  if (state.connection?.version !== connection.version || state.connection.generation !== connection.generation) return;
  const previous = mailBackoff(state);
  const failures = Math.min(8, previous && now - previous.until < 86_400_000 ? previous.failures + 1 : 1);
  // Already in-flight requests can fail in either order. A later response must
  // never shorten a longer wait committed by another request for this grant.
  let until = Math.max(previous?.until ?? 0, now + Math.min(86_400_000, 900_000 * 2 ** (failures - 1)));
  const value = rejected.retryAfter;
  if (value && value.length <= 128) {
    const parsed = /^\d{1,10}$/.test(value) ? now + Number(value) * 1000 : Date.parse(value);
    if (Number.isSafeInteger(parsed) && parsed > now && parsed <= 8.64e15) until = Math.max(until, parsed);
  }
  state.sendBackoff = { version: connection.version, generation: connection.generation,
    status: rejected.status, until, failures };
}
