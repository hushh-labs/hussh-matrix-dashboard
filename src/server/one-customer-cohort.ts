import { createHash, createHmac } from 'node:crypto';
import { oneProductionEndpoint } from './one-scope.mjs';

/** Private only. Never include this membership directory in a public payload. */
export interface CustomerCohort {
  policyRevision: string;
  asOf: string;
  expiresAt: number;
  cacheKey: string;
  rows: ReadonlyArray<{ analyticsUserId: string; registeredAt: string | null }>;
}
const unavailable = () => new Error('Production customer membership could not be verified.');
const validHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);

export function requireFreshCohort(cohort: CustomerCohort, now = Date.now()) {
  if (!Number.isFinite(cohort.expiresAt) || now >= cohort.expiresAt) throw unavailable();
  return cohort;
}

/** Positive event-level membership. Anonymous events are never joined via device IDs. */
export function customerEventSql(cohort: CustomerCohort, alias = ''): string {
  requireFreshCohort(cohort);
  if (alias && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw unavailable();
  if (cohort.rows.length > 20_000 || cohort.rows.some(row => !validHash(row.analyticsUserId))) throw unavailable();
  return cohort.rows.length ? `${alias ? alias + '.' : ''}user_id IN (${cohort.rows.map(row => `'${row.analyticsUserId}'`).join(',')})` : 'FALSE';
}

export async function loadCustomerCohort(options: { url: string; secret: string; fetch?: typeof fetch; now?: () => number }): Promise<CustomerCohort> {
  const audience = oneProductionEndpoint(options.url, '/api/one/plg/audience');
  if (!audience || options.secret.length < 32) throw unavailable();
  const url = new URL('/api/one/plg/customer-cohort', audience);
  const clock = options.now ?? Date.now, deadline = clock() + 60_000;
  const fetcher = options.fetch ?? fetch;
  const rows: { analyticsUserId: string; registeredAt: string | null }[] = [];
  const ids = new Set<string>(), cursors = new Set<string>();
  let cursor: string | null = null, revision = '', asOf = '', expiry = 0;
  do {
    if (cursors.size >= 400 || clock() >= deadline) throw unavailable();
    const body = JSON.stringify({ cursor }), timestamp = String(clock());
    const response = await fetcher(url, { method: 'POST', body, redirect: 'error',
      signal: AbortSignal.timeout(Math.min(26_000, deadline - clock())),
      headers: { 'Content-Type': 'application/json', 'X-PLG-Timestamp': timestamp,
        'X-PLG-Signature': createHmac('sha256', options.secret).update(`customer-cohort\n${timestamp}\n${body}`).digest('hex') } });
    if (!response.ok) throw unavailable();
    // Bounded before JSON parsing; no raw contacts are accepted by this contract.
    const raw = await response.text();
    if (raw.length > 20_000) throw unavailable();
    const page = JSON.parse(raw), now = clock();
    if (page.version !== 1 || page.environment !== 'production' || page.scope !== 'production_registered_contacts' ||
      page.identityScheme !== 'hushh-observability-v1-sha256-128' || page.traversal !== 'live' ||
      typeof page.policyRevision !== 'string' || !/^[a-f0-9]{64}$/.test(page.policyRevision) ||
      typeof page.asOf !== 'string' || typeof page.expiresAt !== 'string' ||
      !Number.isFinite(Date.parse(page.asOf)) || Date.parse(page.asOf) > now + 10_000 ||
      Date.parse(page.expiresAt) - Date.parse(page.asOf) !== 600_000 || Date.parse(page.expiresAt) <= now ||
      !Number.isSafeInteger(page.scanned) || page.scanned < 0 || page.scanned > 50 ||
      !Number.isSafeInteger(page.excluded) || page.excluded < 0 || page.excluded > page.scanned ||
      !Array.isArray(page.rows) || page.rows.length !== page.scanned - page.excluded ||
      (page.nextCursor !== null && (typeof page.nextCursor !== 'string' || !page.nextCursor || page.nextCursor.length > 2048 || page.scanned !== 50))) throw unavailable();
    if (revision && (revision !== page.policyRevision || asOf !== page.asOf || expiry !== Date.parse(page.expiresAt))) throw unavailable();
    revision = page.policyRevision; asOf = page.asOf; expiry = Date.parse(page.expiresAt);
    for (const row of page.rows) {
      if (!row || Object.keys(row).some(key => !['analyticsUserId', 'registeredAt'].includes(key)) ||
        !validHash(row.analyticsUserId) || ids.has(row.analyticsUserId) ||
        (row.registeredAt !== null && (typeof row.registeredAt !== 'string' || !Number.isFinite(Date.parse(row.registeredAt)) || Date.parse(row.registeredAt) <= 0 || Date.parse(row.registeredAt) > now))) throw unavailable();
      ids.add(row.analyticsUserId);
      rows.push({ analyticsUserId: row.analyticsUserId, registeredAt: row.registeredAt === null ? null : new Date(row.registeredAt).toISOString() });
    }
    cursor = page.nextCursor;
    if (cursor && cursors.has(cursor)) throw unavailable();
    if (cursor) cursors.add(cursor);
  } while (cursor);
  const expiresAt = Math.min(expiry, clock() + 300_000);
  // Freshness is checked separately on every response. A renewed proof for the
  // same policy and members must not invalidate all aggregate/query snapshots.
  rows.sort((left, right) => left.analyticsUserId.localeCompare(right.analyticsUserId));
  const cacheKey = createHash('sha256').update(JSON.stringify([revision, rows])).digest('hex');
  return requireFreshCohort(Object.freeze({ policyRevision: revision, asOf, expiresAt, cacheKey,
    rows: Object.freeze(rows.map(row => Object.freeze(row))) }), clock());
}

let cached: CustomerCohort | undefined;
let pending: Promise<CustomerCohort> | undefined;
export async function readCustomerCohort(): Promise<CustomerCohort> {
  if (cached && cached.expiresAt > Date.now()) return cached;
  // Never fall back to stale membership on source failure.
  pending ??= loadCustomerCohort({ url: process.env.PLG_ONE_AUDIENCE_URL ?? '', secret: process.env.PLG_ONE_AUDIENCE_SECRET ?? '' })
    .then(value => { cached = value; return value; }).finally(() => { pending = undefined; });
  return pending;
}

export function customerAccountCounts(cohort: CustomerCohort, range: { startDate: string; endDate: string }) {
  requireFreshCohort(cohort);
  if (cohort.rows.some(row => row.registeredAt === null)) throw unavailable();
  const daily = new Map<string, number>();
  let newAccounts = 0, accountsCreatedByRangeEnd = 0;
  for (const row of cohort.rows) {
    const day = row.registeredAt!.slice(0, 10);
    if (day <= range.endDate) accountsCreatedByRangeEnd++;
    if (day >= range.startDate && day <= range.endDate) { newAccounts++; daily.set(day, (daily.get(day) ?? 0) + 1); }
  }
  return { totalAccounts: cohort.rows.length, newAccounts, accountsCreatedByRangeEnd, disabledAccounts: 0,
    daily: [...daily].map(([date, newAccounts]) => ({ date, newAccounts })) };
}
