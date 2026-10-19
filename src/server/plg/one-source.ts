import { createHash } from 'node:crypto';
import type { PlgJourney, PlgCatalog, PlgActivity, PlgActivityRollup, PlgAgentActivity, PlgAgentId } from '../../lib/plg';
import { DAY, eraseAccount, ingestEvent, PlgError, registerPlgCatalog } from './engine';
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
  activity?: Omit<PlgActivity, 'rollups'> & { agents: PlgAgentActivity[] };
  verified?: { agentId: PlgAgentId; count: number; firstAt: string; lastAt: string; days: string[] }[];
}
const unavailable = () =>
  new PlgError(503, 'One task evidence is unavailable; no activity was inferred.');

function readCatalog(value: any): PlgCatalog {
  if (!value || !/^[a-f0-9]{64}$/.test(value.revision) || !Array.isArray(value.agents) ||
    !value.agents.length || value.agents.length > 100 || !Array.isArray(value.actions) || value.actions.length > 3000)
    throw unavailable();
  const agents: PlgCatalog['agents'] = value.agents.map((a: any) => {
    if (!/^agent_[a-z0-9_]{1,120}$/.test(a.id) || typeof a.label !== 'string' || a.label.length > 160 ||
      typeof a.public !== 'boolean' || typeof a.available !== 'boolean') throw unavailable();
    return { id: a.id, label: a.label, public: a.public, available: a.available };
  });
  if (new Set(agents.map((a) => a.id)).size !== agents.length) throw unavailable();
  const actions: PlgCatalog['actions'] = value.actions.map((a: any) => {
    if (typeof a.id !== 'string' || !/^[a-z][a-z0-9_.:-]{0,255}$/.test(a.id) ||
      !agents.some((x) => x.id === a.agentId) || typeof a.label !== 'string' || a.label.length > 160 ||
      !['action', 'agent', 'tool'].includes(a.kind) || !['client_reported', 'execution_observed'].includes(a.proof)) throw unavailable();
    return { id: a.id, agentId: a.agentId, label: a.label, kind: a.kind, proof: a.proof };
  });
  if (new Set(actions.map((a) => a.id)).size !== actions.length) throw unavailable();
  return { revision: value.revision, agents, actions };
}

function interval(row: any, since: string, until: number) {
  const first = Date.parse(row.firstAt), last = Date.parse(row.lastAt);
  if (typeof row.firstAt !== 'string' || typeof row.lastAt !== 'string' ||
    !Number.isFinite(first) || !Number.isFinite(last) || first < Date.parse(since) || last > until || last < first ||
    !Number.isSafeInteger(row.count) || row.count < 1 || row.count > 4000 ||
    !Array.isArray(row.days) || !row.days.length || row.days.length > 8 ||
    row.days.some((day: unknown) => typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day ||
      day < new Date(first).toISOString().slice(0, 10) || day > new Date(last).toISOString().slice(0, 10)) ||
    new Set(row.days).size !== row.days.length || row.count < row.days.length ||
    !row.days.includes(new Date(first).toISOString().slice(0, 10)) || !row.days.includes(new Date(last).toISOString().slice(0, 10)))
    throw unavailable();
  return { count: row.count as number, firstAt: new Date(first).toISOString(), lastAt: new Date(last).toISOString(), days: [...row.days].sort() as string[] };
}

function readActivity(value: any, catalog: PlgCatalog, since: string, until: number): PlgActivity {
  if (!value || typeof value.enabled !== 'boolean' || value.mode !== 'best_effort' || typeof value.limited !== 'boolean' ||
    !Array.isArray(value.rollups) || value.rollups.length > 4000 ||
    (value.startedAt !== null && (typeof value.startedAt !== 'string' || value.startedAt.length > 40 || !Number.isFinite(Date.parse(value.startedAt)) || Date.parse(value.startedAt) > until)) ||
    (value.epoch !== null && !/^[a-f0-9]{64}$/.test(value.epoch)) ||
    ((value.startedAt === null) !== (value.epoch === null)) ||
    ((!value.enabled || value.epoch === null) && value.rollups.length)) throw unavailable();
  const seen = new Set<string>();
  const rollups: PlgActivityRollup[] = value.rollups.map((row: any) => {
    const action = catalog.actions.find((a) => a.id === row.actionId && a.agentId === row.agentId);
    const key = `${row.actionId}:${row.source}:${row.phase}`;
    if (!action || row.source !== action.proof || !['started','returned','failed','cancelled','blocked'].includes(row.phase) || seen.has(key)) throw unavailable();
    seen.add(key);
    return { agentId: action.agentId, actionId: action.id, source: row.source, phase: row.phase, ...interval(row, since, until) };
  });
  if (rollups.reduce((n, row) => n + row.count, 0) > 4000) throw unavailable();
  return { enabled: value.enabled, mode: 'best_effort', limited: value.limited,
    startedAt: value.startedAt === null ? null : new Date(value.startedAt).toISOString(), epoch: value.epoch, rollups };
}

function compact(activity: PlgActivity): Evidence['activity'] {
  const byAgent = new Map<PlgAgentId, PlgAgentActivity>();
  for (const row of activity.rollups) {
    const a = byAgent.get(row.agentId) ?? { agentId: row.agentId, reported: 0, executed: 0, failed: 0, lastAt: row.lastAt, days: [] };
    if (row.phase === 'returned') a[row.source === 'client_reported' ? 'reported' : 'executed'] += row.count;
    if (row.phase === 'failed') a.failed += row.count;
    a.lastAt = a.lastAt > row.lastAt ? a.lastAt : row.lastAt;
    a.days = [...new Set([...a.days, ...row.days])].sort();
    byAgent.set(row.agentId, a);
  }
  const { rollups: _rollups, ...coverage } = activity;
  return { ...coverage, agents: [...byAgent.values()] };
}

/** Poll retained authoritative ledgers. Empty results never establish inactivity. */
export async function syncOneEvidence(
  store: PlgStore,
  options = {
    url: process.env.PLG_ONE_SOURCE_URL ?? '',
    secret: process.env.PLG_ONE_SOURCE_SECRET ?? '',
  },
  fetcher: typeof fetch = fetch,
  time: number | (() => number) = Date.now,
  inspectionId?: string,
) {
  const clock = typeof time === 'function' ? time : () => time;
  // Stay below the worker's 180s HTTP budget. A slow pilot fails atomically
  // rather than continuing requests after its caller has abandoned the run.
  const deadline = clock() + 135_000;
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
  const selected = inspectionId ? state.contacts.filter((c) => c.id === inspectionId) : state.contacts;
  if (inspectionId && !selected.length) throw new PlgError(404, 'Account is not enrolled.');
  const accounts: SourceAccount[] = selected.map((c) => ({
    accountId: c.accountId,
    journey: c.journey,
    since: c.enrolledAt,
  }));
  const evidence: Evidence[] = [];
  let catalog: PlgCatalog | undefined;
  let inspected: PlgActivity | undefined;
  let version: number | undefined;
  for (let offset = 0; offset < Math.max(accounts.length, 1); offset += 5) {
    const batchNow = clock();
    if (batchNow >= deadline) throw unavailable();
    const batch = accounts.slice(offset, offset + 5).map((c) => ({
      ...c,
      since: new Date(Math.max(Date.parse(c.since), batchNow - 7 * DAY)).toISOString(),
    }));
    const body = JSON.stringify(batch.length ? { accounts: batch } : { version: 2, accounts: [] });
    const timestamp = String(batchNow);
    try {
      const response = await fetcher(endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(Math.min(30_000, deadline - batchNow)),
        headers: {
          'Content-Type': 'application/json',
          'X-PLG-Version': '2',
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
          if (size > 6_000_000) {
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
      if (receivedAt >= deadline) throw unavailable();
      if (
        ![1, 2].includes(data.version) ||
        data.environment !== 'production' ||
        data.retainedOnly !== true ||
        !Number.isFinite(until) ||
        until < receivedAt - 60_000 ||
        until > receivedAt + 60_000 ||
        !Array.isArray(data.accounts) ||
        data.accounts.length !== batch.length
      )
        throw unavailable();
      if (version !== undefined && version !== data.version) throw unavailable();
      version = data.version;
      if (data.version === 1 && batch.some((c) => !['memory', 'mail'].includes(c.journey)))
        throw unavailable();
      if (data.version === 2) {
        const receivedCatalog = readCatalog(data.catalog);
        if (catalog && JSON.stringify(catalog) !== JSON.stringify(receivedCatalog)) throw unavailable();
        catalog = receivedCatalog;
      }
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
          (data.version === 2 && row.tasks.length !== 0) ||
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
        const entry: Evidence = {
          ...requested,
          deleted: row.deleted,
          tasks: row.tasks.map((t: { actionId: string; occurredAt: string }) => ({
            actionId: t.actionId,
            occurredAt: t.occurredAt,
          })),
        };
        if (data.version === 2 && !row.deleted) {
          const activity = readActivity(row.activity, catalog!, requested.since, until);
          entry.activity = compact(activity);
          if (inspectionId) inspected = activity;
          if (!Array.isArray(row.verified) || row.verified.length > 2) throw unavailable();
          const verifiedAgents = new Set<string>();
          entry.verified = row.verified.map((v: any) => {
            if (!['agent_personal_information', 'agent_email'].includes(v.agentId) || verifiedAgents.has(v.agentId) || v.count > 1000) throw unavailable();
            verifiedAgents.add(v.agentId);
            return { agentId: v.agentId, ...interval(v, requested.since, until) };
          });
        }
        evidence.push(entry);
      }
    } catch {
      throw unavailable();
    }
  }
  if (inspectionId && !catalog) throw unavailable();
  return store.transaction((draft) => {
    const now = clock();
    if (now >= deadline) throw unavailable();
    let imported = 0,
      erased = 0;
    if (!inspectionId && catalog) registerPlgCatalog(draft, catalog);
    for (const row of evidence) {
      const contact = draft.contacts.find((c) => c.accountId === row.accountId);
      if (inspectionId && (!contact || contact.id !== inspectionId)) throw new PlgError(404, 'Account is not enrolled.');
      if (!contact || contact.journey !== row.journey) continue;
      if (row.deleted) {
        eraseAccount(draft, row.accountId, now);
        erased++;
        continue;
      }
      if (inspectionId) continue;
      if (row.activity) contact.activity = row.activity;
      const focus = contact.journey === 'memory' ? 'agent_personal_information' : contact.journey === 'mail' ? 'agent_email' : contact.journey;
      for (const v of row.verified ?? []) {
        if ((focus !== 'agent_one' && v.agentId !== focus) || Date.parse(v.lastAt) < now - 7 * DAY) continue;
        const first = new Date(Math.max(Date.parse(v.firstAt), Date.parse(contact.enrolledAt))).toISOString();
        if (!contact.firstValueAt || first < contact.firstValueAt) contact.firstValueAt = first;
        if (!contact.lastValueAt || v.lastAt > contact.lastValueAt) contact.lastValueAt = v.lastAt;
        contact.valueDays = [...new Set([...contact.valueDays, ...v.days])].sort();
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
    return { accounts: evidence.length, imported, erased, retainedOnly: true,
      ...(inspectionId ? { inspection: { catalog, activity: inspected ?? null, deleted: erased > 0 } } : {}) };
  });
}
