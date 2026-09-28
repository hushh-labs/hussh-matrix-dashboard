import { randomUUID } from 'node:crypto';
import { completedSevenDayWindow, InstagramApiError, InstagramClient } from './client';
import type { InstagramStore } from './store';

export interface SyncResult {
  state: 'success' | 'failed' | 'reconnect_required' | 'permission_missing' | 'already_running' | 'already_synced_today' | 'not_configured';
  reachStatus: string;
  runId?: string;
}

export async function syncInstagram(options: {
  enabled: boolean; accountId: string; apiVersion: string; token?: string | null;
  loadToken?: () => Promise<string | null>;
  store: InstagramStore; now?: Date; client?: InstagramClient; scheduled?: boolean;
}): Promise<SyncResult> {
  const { enabled, accountId, apiVersion, store } = options;
  if (!enabled || (!options.token && !options.loadToken) || !/^\d+$/.test(accountId)) return { state: 'not_configured', reachStatus: 'unknown' };
  const runId = randomUUID();
  if (!await store.acquire(runId)) return { state: 'already_running', reachStatus: 'unknown' };
  const { since, until } = completedSevenDayWindow(options.now);
  let started = false;
  let state: SyncResult['state'] = 'failed';
  let reachStatus = 'sync_failed';
  let errorKind: string | undefined;
  try {
    if (options.scheduled) {
      const now = options.now || new Date();
      const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      if (await store.attemptedSince(accountId, today)) return { state: 'already_synced_today', reachStatus: 'unknown' };
    }
    await store.start(runId, accountId, since, until);
    started = true;
    const token = options.loadToken ? await options.loadToken() : options.token;
    if (!token) { state = 'not_configured'; reachStatus = 'unknown'; errorKind = 'not_configured'; return { state, reachStatus, runId }; }
    const client = options.client || new InstagramClient(token, apiVersion);
    const identity = await client.identity();
    if (identity.userId !== accountId) {
      // Do not save metadata or observations for an unexpected account.
      errorKind = 'account_mismatch';
      return { state, reachStatus, runId };
    }
    await store.verifiedAccount(accountId, identity.username, apiVersion);
    const observation = await client.reach(accountId, since, until);
    reachStatus = observation.status;
    if (observation.status === 'available') {
      await store.saveReach(runId, accountId, observation, apiVersion);
      state = 'success';
    } else {
      state = 'failed';
      errorKind = observation.status;
    }
    return { state, reachStatus, runId };
  } catch (error) {
    errorKind = error instanceof InstagramApiError ? error.kind : 'storage_or_unknown';
    state = errorKind === 'reconnect_required' ? 'reconnect_required'
      : errorKind === 'permission_missing' ? 'permission_missing' : 'failed';
    reachStatus = errorKind === 'permission_missing' ? 'permission_missing' : 'sync_failed';
    return { state, reachStatus, runId };
  } finally {
    try { if (started) await store.finish(runId, accountId, state, reachStatus, errorKind); }
    finally { await store.release(runId); }
  }
}
