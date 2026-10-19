import { createHash } from 'node:crypto';
import type { PlgJourney } from '../../lib/plg';
import { DAY, eraseAccount, ingestEvent, PlgError } from './engine';
import { signValue } from './service';
import type { PlgStore } from './store';

interface SourceAccount {
  accountId: string;
  journey: PlgJourney;
  since: string;
}
interface Evidence extends SourceAccount {
  deleted: boolean;
  tasks: { actionId: string; occurredAt: string }[];
}
const unavailable = () =>
  new PlgError(503, 'One task evidence is unavailable; no activity was inferred.');

/** Poll retained authoritative ledgers. Empty results never establish inactivity. */
export async function syncOneEvidence(
  store: PlgStore,
  options = {
    url: process.env.PLG_ONE_SOURCE_URL ?? '',
    secret: process.env.PLG_ONE_SOURCE_SECRET ?? '',
  },
  fetcher: typeof fetch = fetch,
  time: number | (() => number) = Date.now,
) {
  const clock = typeof time === 'function' ? time : () => time;
  let endpoint: URL;
  try {
    endpoint = new URL(options.url);
    if (
      endpoint.protocol !== 'https:' ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      endpoint.pathname !== '/api/one/plg/snapshot'
    )
      throw unavailable();
  } catch {
    throw unavailable();
  }
  if (options.secret.length < 32) throw unavailable();
  const state = await store.read();
  const accounts: SourceAccount[] = state.contacts.map((c) => ({
    accountId: c.accountId,
    journey: c.journey,
    since: c.enrolledAt,
  }));
  const evidence: Evidence[] = [];
  for (let offset = 0; offset < accounts.length; offset += 20) {
    const batchNow = clock();
    const batch = accounts.slice(offset, offset + 20).map((c) => ({
      ...c,
      since: new Date(Math.max(Date.parse(c.since), batchNow - 7 * DAY)).toISOString(),
    }));
    const body = JSON.stringify({ accounts: batch });
    const timestamp = String(batchNow);
    try {
      const response = await fetcher(endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
        headers: {
          'Content-Type': 'application/json',
          'X-PLG-Timestamp': timestamp,
          'X-PLG-Signature': signValue(`snapshot\n${timestamp}\n${body}`, options.secret),
        },
        body,
      });
      if (!response.ok || !response.body) throw unavailable();
      const reader = response.body.getReader();
      let size = 0;
      const chunks: Uint8Array[] = [];
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 500_000) {
            await reader.cancel();
            throw unavailable();
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const until = Date.parse(data.asOf);
      const receivedAt = clock();
      if (
        data.version !== 1 ||
        data.environment !== 'production' ||
        data.retainedOnly !== true ||
        !Number.isFinite(until) ||
        until < receivedAt - 60_000 ||
        until > receivedAt + 60_000 ||
        !Array.isArray(data.accounts) ||
        data.accounts.length !== batch.length
      )
        throw unavailable();
      const seen = new Set<string>();
      for (const row of data.accounts) {
        const requested = batch.find(
          (c) => c.accountId === row.accountId && c.journey === row.journey,
        );
        if (
          !requested ||
          seen.has(row.accountId) ||
          row.since !== requested.since ||
          typeof row.deleted !== 'boolean' ||
          !Array.isArray(row.tasks) ||
          row.tasks.length > 100 ||
          (row.deleted && row.tasks.length)
        )
          throw unavailable();
        seen.add(row.accountId);
        for (const task of row.tasks) {
          const at = Date.parse(task.occurredAt);
          if (
            typeof task.actionId !== 'string' ||
            !/^[a-f0-9]{64}$/.test(task.actionId) ||
            !Number.isFinite(at) ||
            at < Date.parse(requested.since) ||
            at > until
          )
            throw unavailable();
        }
        // Copy only the public contract; discard any accidental private fields.
        evidence.push({
          ...requested,
          deleted: row.deleted,
          tasks: row.tasks.map((t: { actionId: string; occurredAt: string }) => ({
            actionId: t.actionId,
            occurredAt: t.occurredAt,
          })),
        });
      }
    } catch {
      throw unavailable();
    }
  }
  return store.transaction((draft) => {
    const now = clock();
    let imported = 0,
      erased = 0;
    for (const row of evidence) {
      const contact = draft.contacts.find((c) => c.accountId === row.accountId);
      if (!contact || contact.journey !== row.journey) continue;
      if (row.deleted) {
        eraseAccount(draft, row.accountId, now);
        erased++;
        continue;
      }
      for (const task of row.tasks) {
        if (Date.parse(task.occurredAt) < Math.max(Date.parse(contact.enrolledAt), now - 7 * DAY))
          continue;
        const result = ingestEvent(
          draft,
          {
            eventId:
              'one:' +
              createHash('sha256')
                .update(`${row.accountId}:${row.journey}:${task.actionId}`)
                .digest('hex'),
            accountId: row.accountId,
            journey: row.journey,
            environment: 'production',
            internal: false,
            kind: 'task_completed',
            ...task,
            result: 'success',
            deliberate: true,
            verified: true,
          },
          now,
        );
        if (!result.duplicate) imported++;
      }
    }
    return { accounts: evidence.length, imported, erased, retainedOnly: true };
  });
}
