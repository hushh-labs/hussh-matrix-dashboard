import { randomUUID } from 'node:crypto';
import type { PlgAutomationStatus, PlgState } from '../../lib/plg';
import { audit, candidate, iso, PlgError } from './engine';
import type { PlgService } from './service';
import type { PlgRuntime } from './service';
import { MAIL_OWNER } from './google-mail-store';

// One cycle is shorter than the worker request, job and lease budgets, in that order.
export const CYCLE_BUDGET_MS = 210_000;
const LEASE_MS = 300_000;
const mailbox = /^[^\s<>@,;\r\n]+@[^\s<>@,;\r\n]+\.[^\s<>@,;\r\n]+$/;
export function senderConfigured(config: PlgRuntime) {
  const from = config.from.match(/^(?:[^<>\r\n]+ <([^<>]+)>|([^<>\r\n]+))$/);
  return Boolean(from && mailbox.test(from[1] ?? from[2]) && mailbox.test(config.replyTo));
}
export function deliveryBlockers(config: PlgRuntime): string[] {
  return [
    ...(!config.deliveryEnabled ? ['Live email delivery is disabled'] : []),
    ...(config.emailProvider === 'google_workspace'
      ? (!config.googleMailCampaignsEnabled ? ['Google customer mail feedback is not enabled'] : [])
      : (!config.apiKey ? ['Email provider authentication is missing'] : [])),
    ...(config.emailProvider === 'google_workspace' && !config.subscriptions?.enabled
      ? ['Canonical One email permission sync is required for Google customer mail'] : []),
    ...(!senderConfigured(config) ? ['Valid From and Reply-To addresses are required'] : []),
    ...(config.emailProvider === 'google_workspace' && (config.from !== `Neelesh Meena <${MAIL_OWNER}>` || config.replyTo !== MAIL_OWNER)
      ? ['Google sender and Reply-To must match the authorized work mailbox'] : []),
    ...(config.emailProvider !== 'google_workspace' && !config.webhookSecret ? ['Signed delivery callbacks are not configured'] : []),
    ...(config.signingSecret.length < 32 ? ['Preference links and worker authentication are not configured'] : []),
    ...(!config.origin.startsWith('https:') ? ['A secure public origin is required'] : []),
  ];
}
export function automationStatus(state: PlgState, config: PlgRuntime, now: number): PlgAutomationStatus {
  const cycle = state.automation?.lastCycle ?? null;
  const queue = state.contacts.map((c) => candidate(state, c, now));
  const reasons = new Map<string, number>();
  for (const row of queue.filter((c) => !c.eligible)) reasons.set(row.reason, (reasons.get(row.reason) ?? 0) + 1);
  const bytes = Buffer.byteLength(JSON.stringify(state));
  return {
    enabled: state.automation?.enabled ?? false,
    worker: !cycle ? 'never_observed' : now - Date.parse(cycle.startedAt) > 30 * 60_000 ? 'stale' : 'recent',
    sender: {
      from: senderConfigured(config) ? config.from : null,
      replyTo: mailbox.test(config.replyTo) ? config.replyTo : null,
      configured: senderConfigured(config),
    },
    blockers: [
      ...(!(state.automation?.enabled) ? ['Automatic follow-ups are paused'] : []),
      ...(state.paused ? ['Campaigns are paused'] : []),
      ...deliveryBlockers(config),
      ...(!cycle ? ['Scheduled worker has not been observed'] : now - Date.parse(cycle.startedAt) > 30 * 60_000 ? ['Scheduled worker heartbeat is stale'] : []),
      ...(!(state.storage?.totalContacts ?? state.contacts.length) ? ['No permission-backed accounts are enrolled'] : []),
      ...(!state.storage && (state.contacts.length >= 100 || bytes >= 700_000) ? ['Pilot capacity needs attention before further growth'] : []),
    ],
    lastCycle: cycle,
    lastSyncAt: state.automation?.lastSyncAt ?? null,
    lastEvidenceSyncAt: state.automation?.lastEvidenceSyncAt ?? null,
    lastSuccessAt: state.automation?.lastSuccessAt ?? null,
    eligible: state.storage?.report?.eligible ?? queue.filter((c) => c.eligible).length,
    blockedReasons: state.storage?.report?.blockedReasons ?? [...reasons].map(([reason, accounts]) => ({ reason, accounts })),
    needsReconciliation: state.storage?.pendingDeliveries ?? state.deliveries.filter((d) => ['sending', 'uncertain'].includes(d.status)).length,
    capacity: { contacts: state.storage?.totalContacts ?? state.contacts.length,
      maxContacts: state.storage ? null : 100, bytes, maxBytes: state.storage ? null : 750_000 },
  };
}

export type PlgSync = (deadline?: number, continuation?: boolean) => Promise<{ accounts: number; imported: number; erased: number;
  accountHashes?: string[]; accountPage?: { after: string | null; next: string | null } }>;
export async function runAutomationCycle(service: PlgService, sync: PlgSync, now = Date.now) {
  const id = randomUUID();
  const started = now();
  await service.store.transaction((state) => {
    if (state.automation?.lease && Date.parse(state.automation.lease.until) > started)
      throw new PlgError(409, 'Another automatic cycle is running.');
    state.automation ??= { enabled: false };
    state.automation.lease = { id, until: iso(started + LEASE_MS) };
    state.automation.lastCycle = { id, startedAt: iso(started), finishedAt: null, status: 'running', reason: null, accounts: 0, sent: 0, uncertain: 0 };
  });
  const finish = async (status: 'completed' | 'blocked' | 'failed', reason: string | null, counts: { accounts: number; sent: number | null; uncertain: number | null } = { accounts: 0, sent: 0, uncertain: 0 }) =>
    service.store.transaction((state) => {
      const automation = state.automation!;
      if (automation.lease?.id !== id || automation.lastCycle?.id !== id)
        throw new PlgError(409, 'Automatic cycle ownership changed.');
      Object.assign(automation.lastCycle, { status, reason, finishedAt: iso(now()), ...counts });
      delete automation.lease;
      if (status === 'completed') automation.lastSuccessAt = iso(now());
      return { ...automation.lastCycle };
    });
  let accounts = 0;
  try {
    // Sync is deliberately independent of the campaign pause. Failed or partial
    // source reads never reach sending and never become proof of inactivity.
    const accountStorage = await service.store.accountStorage?.();
    let result = await sync(started + CYCLE_BUDGET_MS - (accountStorage ? 90_000 : 20_000));
    accounts = result.accounts;
    await service.store.transaction((state) => {
      if (state.automation?.lease?.id !== id || now() >= started + CYCLE_BUDGET_MS)
        throw new PlgError(409, 'Automatic cycle budget or ownership expired.');
      state.automation.lastSyncAt = iso(now());
      // retainedOnly describes privacy-limited evidence too, not its source.
      // The empty catalog path checks zero enrolled accounts.
      if (result.accounts > 0) state.automation.lastEvidenceSyncAt = iso(now());
    });
    // Stop/suppression evidence is reconciled even while campaigns are paused.
    await service.reconcileMail(Math.min(started + CYCLE_BUDGET_MS - 20_000, now() + 45_000));
    const state = await (accountStorage ? accountStorage.readSettings() : service.store.read());
    const blockers = [
      ...(!state.automation?.enabled ? ['Automatic follow-ups are paused'] : []),
      ...(state.paused ? ['Campaigns are paused'] : []),
      ...deliveryBlockers(service.runtime),
    ];
    if (blockers.length) return await finish('blocked', blockers.join('; '), { accounts, sent: 0, uncertain: 0 });
    const options = { deadline: started + CYCLE_BUDGET_MS, leaseId: id };
    let delivered = { sent: 0, uncertain: 0 };
    let deferred: 'budget' | 'provider' | undefined;
    if (accountStorage) {
      for (let pageNumber = 0; pageNumber < 64; pageNumber++) {
        if (!result.accountHashes || result.accountHashes.length > 25 || !result.accountPage ||
          new Set(result.accountHashes).size !== result.accountHashes.length ||
          result.accountHashes.some(hash => !/^[a-f0-9]{64}$/.test(hash)) ||
          [result.accountPage.after, result.accountPage.next].some(cursor => cursor !== null && !/^[a-f0-9]{64}$/.test(cursor)))
          throw new PlgError(503, 'The synchronized account page is missing.');
        if (result.accountHashes.some((hash, n) => hash <= (n ? result.accountHashes![n - 1] : result.accountPage!.after ?? '')) ||
          result.accountPage.next !== null && (result.accountPage.next <= (result.accountPage.after ?? '') ||
            result.accountPage.next < (result.accountHashes.at(-1) ?? '')))
          throw new PlgError(503, 'The synchronized account page did not advance.');
        let cursor = result.accountPage.after;
        const advance = async (next: string | null) => {
          await accountStorage.transaction(draft => {
            if (draft.automation?.lease?.id !== id || Date.parse(draft.automation.lease.until) <= now() ||
              (draft.automation.accountCursor ?? null) !== cursor)
              throw new PlgError(409, 'Automatic account traversal ownership changed.');
            draft.automation.accountCursor = next;
          });
          cursor = next;
        };
        for (const hash of result.accountHashes) {
          if (now() + 70_000 >= options.deadline) { deferred = 'budget'; break; }
          const outcome = await service.withStore(accountStorage.account(hash)).run('Automatic cycle', options);
          delivered.sent += outcome.sent; delivered.uncertain += outcome.uncertain;
          if (outcome.deferred) { deferred = outcome.deferred; break; }
          await advance(hash);
          if (delivered.uncertain) break;
        }
        if (deferred || delivered.uncertain) break;
        await advance(result.accountPage.next);
        if (!result.accountPage.next) break;
        if (pageNumber === 63 || now() + 100_000 >= options.deadline) { deferred = 'budget'; break; }
        result = await sync(options.deadline - 70_000, true);
        accounts += result.accounts;
      }
    } else {
      const outcome = await service.run('Automatic cycle', options);
      delivered = { sent: outcome.sent, uncertain: outcome.uncertain }; deferred = outcome.deferred;
    }
    const reason = delivered.uncertain ? 'Delivery confirmation needs reconciliation; no automatic retry' :
      deferred === 'provider' ? 'Email provider held an unsubmitted message; remaining accounts stay queued' :
        deferred === 'budget' ? 'Cycle time budget reached; remaining accounts stay queued' : null;
    return await finish(delivered.uncertain || deferred === 'provider' ? 'blocked' : 'completed', reason, { accounts, ...delivered });
  } catch {
    // A product-source failure must not starve independent mailbox stop reports.
    // Keep the cycle failed and reserve time to commit its truthful status.
    const feedbackDeadline = Math.min(started + CYCLE_BUDGET_MS - 20_000, now() + 45_000);
    if (feedbackDeadline - now() >= 5_000) {
      try { await service.reconcileMail(feedbackDeadline); } catch { /* Status remains failed; sending stays blocked. */ }
    }
    // A later store failure can follow an earlier provider acceptance. Unknown
    // cycle totals must never overwrite the private delivery ledger with zeros.
    await finish('failed', 'Source sync or cycle processing did not confirm success; inspect delivery history for accepted messages', { accounts, sent: null, uncertain: null });
    throw new PlgError(503, 'Automatic cycle did not confirm success. Check private automation status before retrying.');
  }
}

export function setAutomationEnabled(state: PlgState, enabled: unknown, actor: string, now: number) {
  if (typeof enabled !== 'boolean') throw new PlgError(400, 'Supply the automatic follow-up status.');
  state.automation ??= { enabled: false };
  state.automation.enabled = enabled;
  audit(state, actor, `Automatic follow-ups ${enabled ? 'enabled' : 'paused'}.`, now);
  return { enabled };
}
