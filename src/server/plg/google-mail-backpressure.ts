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
}
export function recordMailRejection(state: MailControl, connection: NonNullable<MailControl['connection']>,
  id: string, rejected: GmailSubmissionRejected, now: number) {
  state.attempts = state.attempts.filter(attempt => attempt.id !== id);
  // A response from the old grant cannot hold a newly authorized connection.
  if (state.connection?.version !== connection.version || state.connection.generation !== connection.generation) return;
  const previous = mailBackoff(state);
  const failures = Math.min(8, previous && now - previous.until < 86_400_000 ? previous.failures + 1 : 1);
  let until = now + Math.min(86_400_000, 900_000 * 2 ** (failures - 1));
  const value = rejected.retryAfter;
  if (value && value.length <= 128) {
    const parsed = /^\d{1,10}$/.test(value) ? now + Number(value) * 1000 : Date.parse(value);
    if (Number.isSafeInteger(parsed) && parsed > now && parsed <= 8.64e15) until = Math.max(until, parsed);
  }
  state.sendBackoff = { version: connection.version, generation: connection.generation,
    status: rejected.status, until, failures };
}
