import { randomUUID } from 'node:crypto';
import { completedAccountWindow, InstagramApiError, InstagramClient } from './client';
import type { AccountInsightName, AccountWindowDays, InsightStatus, MediaInsightName } from './client';
import type { InstagramStore, MediaInsightWrite } from './store';

export interface SyncResult {
  state: 'success' | 'failed' | 'reconnect_required' | 'permission_missing' | 'already_running' | 'already_synced_today' | 'not_configured';
  reachStatus: string;
  optionalResults?: Record<string, InsightStatus>;
  runId?: string;
}

export async function syncInstagram(options: {
  enabled: boolean; accountId: string; apiVersion: string; token?: string | null;
  loadToken?: () => Promise<string | null>;
  store: InstagramStore; now?: Date; client?: InstagramClient; scheduled?: boolean;
}): Promise<SyncResult> {
  const { enabled, accountId, apiVersion, store } = options;
  if (!enabled || (!options.token && !options.loadToken) || !/^\d+$/.test(accountId)) return { state: 'not_configured', reachStatus: 'unknown' };
  // Leave headroom under the existing dashboard service's 300-second request
  // timeout. The scheduled Cloud Run Job has a longer timeout.
  const optionalDeadline = Date.now() + 240_000;
  const runId = randomUUID();
  if (!await store.acquire(runId)) return { state: 'already_running', reachStatus: 'unknown' };
  const { since, until } = completedAccountWindow(7, options.now);
  let started = false;
  let state: SyncResult['state'] = 'failed';
  let reachStatus = 'sync_failed';
  let errorKind: string | undefined;
  const optionalResults: Record<string, InsightStatus> = {};
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
    // Reach is the required slice. Each subsequent read is independently
    // guarded; missing/failed optional data never replaces a valid value.
    if (state === 'success') {
      let stopOptionalReads = false;
      const capture = async (key: string, work: () => Promise<InsightStatus>) => {
        if (Date.now() >= optionalDeadline) stopOptionalReads = true;
        if (stopOptionalReads) { optionalResults[key] = 'unknown'; return; }
        try { optionalResults[key] = await work(); }
        catch (error) {
          const kind = error instanceof InstagramApiError ? error.kind : 'sync_failed';
          optionalResults[key] = kind === 'not_supported' ? 'not_supported'
            : kind === 'permission_missing' ? 'permission_missing' : 'sync_failed';
          if (kind === 'reconnect_required' || kind === 'rate_limited') stopOptionalReads = true;
        }
      };
      // Each reach value is a provider total for its own exact window. Never
      // add rolling totals together or derive a longer total from seven days.
      for (const days of [30, 90] as AccountWindowDays[]) {
        await capture(`account.${days}.reach`, async () => {
          const window = completedAccountWindow(days, options.now);
          const metric = await client.reach(accountId, window.since, window.until);
          if (metric.status === 'available') await store.saveReach(runId, accountId, metric, apiVersion);
          return metric.status;
        });
      }
      if (store.saveProfile && typeof client.profile === 'function') await capture('account.current_counts', async () => {
        const profile = await client.profile();
        if (profile.userId !== accountId) throw new InstagramApiError('invalid_response');
        await store.saveProfile!(accountId, profile);
        return profile.followersCount === null && profile.mediaCount === null ? 'not_yet_available' : 'available';
      });
      for (const days of [7, 30, 90] as AccountWindowDays[]) {
        for (const name of ['views', 'total_interactions', 'accounts_engaged'] as AccountInsightName[]) {
          if (!store.saveAccountMetric || typeof client.accountInsight !== 'function') break;
          await capture(days === 7 ? `account.${name}` : `account.${days}.${name}`, async () => {
            const window = completedAccountWindow(days, options.now);
            const metric = await client.accountInsight(accountId, name, window.since, window.until);
            if (metric.status === 'available') await store.saveAccountMetric!(runId, accountId, metric, apiVersion);
            return metric.status;
          });
        }
      }
      if (store.saveMediaInventory && store.saveMediaInsightsBatch && typeof client.recentMedia === 'function' && typeof client.mediaInsights === 'function') {
        let inventory: Awaited<ReturnType<InstagramClient['recentMedia']>> | null = null;
        let inventoryStored = false;
        await capture('media.list', async () => {
          inventory = await client.recentMedia(accountId, 75, new Date((options.now || new Date()).getTime() - 365 * 86_400_000));
          await store.saveMediaInventory!(runId, accountId, inventory, apiVersion);
          inventoryStored = true;
          return inventory.complete ? 'available' : 'not_yet_available';
        });
        const writes: MediaInsightWrite[] = [];
        const insightNames: MediaInsightName[] = ['reach', 'saved', 'shares', 'views'];
        if (inventoryStored && inventory) for (const item of inventory.items) {
          if (Date.now() >= optionalDeadline || stopOptionalReads) {
            for (const name of insightNames) optionalResults[`media.${item.id}.${name}`] = 'unknown';
            continue;
          }
          try {
            const metrics = await client.mediaInsights(item.id);
            for (const metric of metrics) {
              optionalResults[`media.${item.id}.${metric.name}`] = metric.status;
              if (metric.status === 'available') writes.push({ mediaId: item.id, publishedAt: item.publishedAt, observation: metric });
            }
          } catch (error) {
            const kind = error instanceof InstagramApiError ? error.kind : 'sync_failed';
            const status: InsightStatus = kind === 'not_supported' ? 'not_supported'
              : kind === 'permission_missing' ? 'permission_missing' : 'sync_failed';
            for (const name of insightNames) optionalResults[`media.${item.id}.${name}`] = status;
            if (kind === 'reconnect_required' || kind === 'rate_limited') stopOptionalReads = true;
          }
        }
        if (writes.length) try {
          await store.saveMediaInsightsBatch!(runId, accountId, writes, apiVersion);
          optionalResults['media.insights.save'] = 'available';
        } catch {
          optionalResults['media.insights.save'] = 'sync_failed';
          for (const write of writes) optionalResults[`media.${write.mediaId}.${write.observation.name}`] = 'sync_failed';
        }
      }
    }
    return { state, reachStatus, runId, optionalResults };
  } catch (error) {
    errorKind = error instanceof InstagramApiError ? error.kind : 'storage_or_unknown';
    state = errorKind === 'reconnect_required' ? 'reconnect_required'
      : errorKind === 'permission_missing' ? 'permission_missing' : 'failed';
    reachStatus = errorKind === 'permission_missing' ? 'permission_missing' : 'sync_failed';
    return { state, reachStatus, runId };
  } finally {
    try { if (started) await store.finish(runId, accountId, state, reachStatus, errorKind, optionalResults); }
    finally { await store.release(runId); }
  }
}
