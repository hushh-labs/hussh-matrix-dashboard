import type { PlgAudienceFilters, PlgAudiencePage, PlgAudiencePerson } from '../../lib/plg';
import { DAY, PlgError } from './engine';
import { signValue } from './service';
import { outcomeProofMatches, outcomeSupported, readCatalog } from './one-source';
import { oneProductionEndpoint } from '../one-scope.mjs';

const segments = ['all', 'possible_incomplete', 'failed', 'blocked', 'cancelled', 'returned', 'verified', 'unknown', 'in_progress'];
const keys = ['started', 'returned', 'failed', 'cancelled', 'blocked', 'possibleIncomplete', 'inProgress', 'uncorrelated', 'otherObservations'] as const;
const unavailable = (): never => { throw new PlgError(503, 'One audience evidence is unavailable. No usage or contact details were inferred.'); };
const object = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return unavailable();
  return value;
};
const number = (value: unknown, max: number) => {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max) return unavailable();
  return value as number;
};
const boolean = (value: unknown) => {
  if (typeof value !== 'boolean') return unavailable();
  return value;
};
const text = (value: unknown, max: number): string | null => {
  if (value === null) return null;
  if (typeof value !== 'string' || !value || value.length > max || /[\x00-\x1f\x7f]/.test(value)) return unavailable();
  return value;
};
const date = (value: unknown, max: number, min = 0) => {
  if (value === null) return null;
  const result = text(value, 40), at = Date.parse(result!);
  if (!Number.isFinite(at) || at > max || at < min) return unavailable();
  return new Date(at).toISOString();
};

export function audienceFilters(value: unknown): PlgAudienceFilters {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PlgError(400, 'Choose an agent and audience filters.');
  const input = value as Record<string, any>;
  if (Object.keys(input).some((key) => !['agentId', 'segment', 'query', 'graceMinutes', 'cursor'].includes(key)) ||
    typeof input.agentId !== 'string' || !/^agent_[a-z0-9_]{1,120}$/.test(input.agentId) ||
    !segments.includes(input.segment) || typeof input.query !== 'string' || input.query.length > 100 ||
    !Number.isSafeInteger(input.graceMinutes) || input.graceMinutes < 15 || input.graceMinutes > 1440 ||
    (input.cursor !== undefined && input.cursor !== null && (typeof input.cursor !== 'string' || input.cursor.length > 6000)))
    throw new PlgError(400, 'Choose valid audience filters.');
  return { agentId: input.agentId as PlgAudienceFilters['agentId'], segment: input.segment, query: input.query, graceMinutes: input.graceMinutes, cursor: input.cursor ?? null };
}

/** Whitelist every returned field; provider/SDK objects never reach the browser. */
function page(value: unknown, filters: PlgAudienceFilters, now: number): PlgAudiencePage {
  const input = object(value), catalog = readCatalog(input.catalog);
  const at = date(input.asOf, now + 10_000, now - 15 * 60_000), since = date(input.windowStart, now);
  if (!at || !since || Date.parse(at) - Date.parse(since) !== 7 * DAY || input.version !== 1 ||
    input.environment !== 'production' || input.source !== 'firebase_registered_accounts' || input.traversal !== 'live' ||
    input.campaignEnrollmentChanged !== false || input.graceMinutes !== filters.graceMinutes ||
    !catalog.agents.some((a) => a.id === filters.agentId)) return unavailable();
  const scanned = number(input.scanned, 25), excluded = number(input.excluded, scanned);
  if (!Array.isArray(input.rows) || input.rows.length > scanned - excluded) return unavailable();
  const rows: PlgAudiencePerson[] = input.rows.map((raw: unknown) => {
    const row = object(raw), identity = object(row.identity), activity = object(row.activity), verified = object(row.verified);
    const accountId = text(row.accountId, 128);
    if (!accountId || row.agentId !== filters.agentId || !['canonical', 'firebase'].includes(identity.source) ||
      !['observed', 'not_started', 'unavailable', 'reset_during_traversal', 'limited'].includes(activity.coverage) ||
      activity.mode !== 'best_effort') return unavailable();
    const name = text(identity.name, 160), email = text(identity.email, 254), phoneNumber = text(identity.phoneNumber, 16);
    const emailVerified = boolean(identity.emailVerified), phoneVerified = boolean(identity.phoneVerified);
    if ((email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) || (!email && emailVerified) ||
      (phoneNumber && !/^\+[1-9][0-9]{6,14}$/.test(phoneNumber)) || phoneVerified !== (phoneNumber !== null)) return unavailable();
    const rawCounts = object(activity.counts);
    const counts = Object.fromEntries(keys.map((key) => [key, number(rawCounts[key], 4000)])) as PlgAudiencePerson['activity']['counts'];
    if (counts.possibleIncomplete + counts.inProgress > counts.started) return unavailable();
    const firstAttemptAt = date(activity.firstAttemptAt, Date.parse(at), Date.parse(since));
    const lastObservedAt = date(activity.lastObservedAt, Date.parse(at), Date.parse(since));
    const lastReturnedAt = date(activity.lastReturnedAt, Date.parse(at), Date.parse(since));
    const lastFailureAt = date(activity.lastFailureAt, Date.parse(at), Date.parse(since));
    const lastActionId = text(activity.lastActionId, 256);
    if ((lastActionId && !catalog.actions.some((a) => a.id === lastActionId && a.agentId === filters.agentId)) ||
      (firstAttemptAt && (!lastObservedAt || firstAttemptAt > lastObservedAt)) ||
      ((lastReturnedAt || lastFailureAt) && (!lastObservedAt || (lastReturnedAt && lastReturnedAt > lastObservedAt) || (lastFailureAt && lastFailureAt > lastObservedAt)))) return unavailable();
    const supported = boolean(verified.supported), count = number(verified.count, 1000), limited = boolean(verified.limited);
    const lastAt = date(verified.lastAt, Date.parse(at), Date.parse(since));
    if (supported !== outcomeSupported(catalog, filters.agentId) || !outcomeProofMatches(catalog, filters.agentId, verified.proof) ||
      (!supported && (count || lastAt || limited)) || Boolean(count) !== Boolean(lastAt)) return unavailable();
    return {
      accountId, agentId: row.agentId,
      identity: { name, email, emailVerified, phoneNumber, phoneVerified, source: identity.source, updatedAt: date(identity.updatedAt, now + 10_000) },
      activity: { coverage: activity.coverage, mode: 'best_effort', counts, firstAttemptAt, lastObservedAt, lastReturnedAt, lastFailureAt, lastActionId,
        collectionStartedAt: date(activity.collectionStartedAt, now + 10_000) },
      verified: { supported, ...(verified.proof !== undefined ? { proof: verified.proof } : {}), count, lastAt, limited },
    };
  });
  if (new Set(rows.map((r) => r.accountId)).size !== rows.length) return unavailable();
  const nextCursor = text(input.nextCursor, 6000);
  if (nextCursor && !/^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(nextCursor)) return unavailable();
  return { version: 1, environment: 'production', catalog, asOf: at, windowStart: since, graceMinutes: filters.graceMinutes,
    source: 'firebase_registered_accounts', traversal: 'live', scanned, excluded, rows, nextCursor, campaignEnrollmentChanged: false };
}

export async function readOneAudience(
  input: unknown,
  options = { url: process.env.PLG_ONE_AUDIENCE_URL ?? '', secret: process.env.PLG_ONE_AUDIENCE_SECRET ?? '' },
  fetcher: typeof fetch = fetch,
  time: number | (() => number) = Date.now,
): Promise<PlgAudiencePage> {
  const filters = audienceFilters(input);
  const endpoint = oneProductionEndpoint(options.url, '/api/one/plg/audience');
  if (!endpoint || options.secret.length < 32) return unavailable();
  const clock = typeof time === 'function' ? time : () => time;
  const timestamp = String(clock()), body = JSON.stringify(filters);
  try {
    const response = await fetcher(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { 'Content-Type': 'application/json', 'X-PLG-Timestamp': timestamp,
        'X-PLG-Signature': signValue(`audience\n${timestamp}\n${body}`, options.secret) }, body });
    if (!response.ok || !response.body) return unavailable();
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 750_000) { await reader.cancel(); return unavailable(); }
      chunks.push(value);
    }
    return page(JSON.parse(Buffer.concat(chunks).toString('utf8')), filters, clock());
  } catch { return unavailable(); }
}
