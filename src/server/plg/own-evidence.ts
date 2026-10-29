import type { PlgContact } from '../../lib/plg';
import { DAY, PlgError } from './engine';
import { MAIL_OWNER } from './google-mail-store';
import { interval, readActivity, readCatalog, outcomeSupported, outcomeProofMatches } from './one-source';
import { OneSubscriptions } from './one-subscriptions';
import { signValue } from './service';
import type { PlgStore } from './store';
import { oneProductionEndpoint } from '../one-scope.mjs';

const unavailable = () => new PlgError(503, 'Own One activity could not be verified. No message was sent.');
const denied = () => new PlgError(409, 'Enable email updates in your One account and resolve any suppression before checking activity.');
const authority = (c: PlgContact) => JSON.stringify([c.id, c.accountId, c.email, c.permission,
  c.consentAt, c.enrolledAt, c.suppressed, c.frequency, c.pauseUntil, c.supportOpen]);

/** Authenticated staff self-read only; never change reporting or delivery history. */
export async function readOwnEvidence(store: PlgStore, permissions: Pick<OneSubscriptions, 'check'>,
  options = { url: process.env.PLG_ONE_SOURCE_URL ?? '', secret: process.env.PLG_ONE_SOURCE_SECRET ?? '' },
  fetcher: typeof fetch = fetch, clock = Date.now, email = MAIL_OWNER) {
  if (!/^[^\s@<>]+@hushh\.ai$/.test(email)) throw denied();
  const accounts = await store.accountStorage?.();
  const scoped = accounts ? await accounts.email(email) : store;
  if (!scoped) throw denied();
  const read = async () => {
    const rows = (await scoped.read()).contacts.filter(c => c.email === email);
    if (rows.length !== 1) throw denied();
    const c = rows[0];
    if (!c.permission?.enabled || !c.permission.eligible || c.suppressed || !c.consentAt ||
      !Number.isFinite(Date.parse(c.consentAt)) || !Number.isFinite(Date.parse(c.enrolledAt))) throw denied();
    return c;
  };
  const contact = await read();
  if (!(await permissions.check(contact)).allowed) throw denied();
  const started = clock(), endpoint = oneProductionEndpoint(options.url, '/api/one/plg/snapshot');
  if (!endpoint || options.secret.length < 32) throw unavailable();
  const sinceAt = Math.max(Date.parse(contact.enrolledAt), Date.parse(contact.consentAt!), started - 7 * DAY);
  if (sinceAt > started) throw unavailable();
  const requested = { accountId: contact.accountId, journey: contact.journey, since: new Date(sinceAt).toISOString() };
  const body = JSON.stringify({ version: 2, accounts: [requested], customerReporting: false });
  let data: any;
  try {
    const response = await fetcher(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { 'Content-Type': 'application/json', 'X-PLG-Version': '2', 'X-PLG-Timestamp': String(started),
        'X-PLG-Signature': signValue(`snapshot\n${started}\n${body}`, options.secret) }, body });
    if (!response.ok || !response.body) throw unavailable();
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 1_000_000) { await reader.cancel(); throw unavailable(); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { throw unavailable(); }
  const received = clock(), until = Date.parse(data?.asOf);
  if (received - started > 60_000 || !Number.isFinite(until) || Math.abs(received - until) > 60_000 ||
    data?.version !== 2 || data.environment !== 'production' || data.retainedOnly !== true ||
    !Array.isArray(data.accounts) || data.accounts.length !== 1) throw unavailable();
  const row = data.accounts[0], catalog = readCatalog(data.catalog);
  if (!row || row.accountId !== requested.accountId || row.journey !== requested.journey || row.since !== requested.since ||
    row.deleted !== false || !Array.isArray(row.tasks) || row.tasks.length ||
    !Array.isArray(row.verified) || row.verified.length > catalog.agents.length) throw unavailable();
  const activity = readActivity(row.activity, catalog, requested.since, until);
  // These are captured observations, not unique attempts or proof of absence.
  // Keep app and server counts separate because both may describe one action.
  const phases = ['started', 'returned', 'failed', 'cancelled', 'blocked'] as const;
  const emptyCounts = () => ({ started: 0, returned: 0, failed: 0, cancelled: 0, blocked: 0 });
  const observations = activity.enabled && activity.epoch && activity.startedAt
    ? catalog.agents.filter(agent => agent.public && agent.available).map(agent => {
      const reported = emptyCounts(), executed = emptyCounts(); let lastAt: string | null = null;
      for (const event of activity.rollups.filter(event => event.agentId === agent.id)) {
        if (Date.parse(event.firstAt) < Date.parse(activity.startedAt!)) throw unavailable();
        if (!phases.includes(event.phase)) throw unavailable();
        (event.source === 'client_reported' ? reported : executed)[event.phase] += event.count;
        if (!lastAt || event.lastAt > lastAt) lastAt = event.lastAt;
      }
      return { agentId: agent.id, label: agent.label, reported, executed, lastAt };
    }) : null;
  const seen = new Set<string>();
  const positives = row.verified.map((v: any) => {
    if (!v || !outcomeSupported(catalog, v.agentId) || !outcomeProofMatches(catalog, v.agentId, v.proof) ||
      seen.has(v.agentId) || v.count > 1000) throw unavailable();
    seen.add(v.agentId);
    const times = interval(v, requested.since, until);
    // A positive domain receipt remains distinct from current capture coverage.
    return { agentId: v.agentId as string, label: catalog.agents.find(a => a.id === v.agentId)!.label,
      count: times.count, firstAt: times.firstAt, lastAt: times.lastAt,
      currentCapture: activity.enabled && activity.epoch !== null && activity.startedAt !== null &&
        Date.parse(times.firstAt) >= Date.parse(activity.startedAt) };
  });
  const current = await read();
  if (authority(current) !== authority(contact) || !(await permissions.check(current)).allowed ||
    authority(await read()) !== authority(contact)) throw denied();
  if (clock() - started > 120_000) throw unavailable();
  return { environment: 'production' as const, checkedAt: new Date(until).toISOString(), since: requested.since,
    captureEnabled: activity.enabled, captureStartedAt: activity.startedAt, captureEpochPresent: activity.epoch !== null,
    observationMode: activity.mode, limited: activity.limited, observations, positives,
    customerReportingChanged: false, emailsSent: 0, customerCampaignEligibilityProved: false };
}
