import { createHash } from 'node:crypto';
import type { Firestore } from '@google-cloud/firestore';
import { InstagramClient, completedAccountWindow, type AccountInsightName, type AccountWindowDays } from './client';
import { InstagramCredentials } from './credentials';

// A single durable initial collection; no page view can claim or replenish it.
const path = 'metricsInstagramPublications/initial_20261115';
const callLimit = 13, retentionMs = 90 * 86_400_000, staleMs = 24 * 60 * 60_000;
type Database = Pick<Firestore, 'doc' | 'runTransaction'>;
let shared: Promise<Database> | undefined;
const database = () => shared ??= import('@google-cloud/firestore').then(({ Firestore }) => new Firestore({ projectId: 'hushh-ai-prod', databaseId: 'one-plg-production' }));
const binding = (accountId: string) => createHash('sha256').update(accountId).digest('hex');

export class InstagramPublication {
  constructor(private readonly db: Database, private readonly accountId: string, private readonly now = () => Date.now()) {
    if (!/^\d+$/.test(accountId)) throw new Error('Invalid Instagram account binding');
  }
  async read() {
    const snapshot = await this.db.doc(path).get(), value = snapshot.data();
    if (!snapshot.exists || value?.state !== 'complete' || value.binding !== binding(this.accountId)
      || !Number.isFinite(value.observedAt) || this.now() < value.observedAt || this.now() - value.observedAt > retentionMs) return null;
    return { ...value.report, state: this.now() - value.observedAt > staleMs ? 'stale' : 'available', canSync: false };
  }
  async collect(credentials: InstagramCredentials, version: string, transport: typeof fetch = fetch) {
    const ref = this.db.doc(path), claimedAt = this.now(), accountBinding = binding(this.accountId);
    await this.db.runTransaction(async tx => {
      if ((await tx.get(ref)).exists) throw new Error('Instagram initial collection already claimed');
      tx.create(ref, { state: 'claimed', binding: accountBinding, claimedAt, callLimit });
    });
    const token = await credentials.loadForSync(new Date(claimedAt), false);
    if (!token) throw new Error('Instagram reader unavailable');
    let calls = 0;
    const bounded: typeof fetch = async (input, init) => { if (++calls > callLimit) throw new Error('Instagram collection call limit'); return transport(input, init); };
    const client = new InstagramClient(token, version, bounded, async () => {});
    const profile = await client.profile();
    if (profile.userId !== this.accountId) throw new Error('Instagram account mismatch');
    const observedAt = this.now(), windows: Record<string, any> = {}, results: Record<string, string> = {};
    for (const days of [7, 30, 90] as AccountWindowDays[]) {
      const { since, until } = completedAccountWindow(days, new Date(claimedAt));
      const metrics: Record<string, unknown> = {};
      for (const name of ['reach', 'views', 'total_interactions', 'accounts_engaged'] as AccountInsightName[]) {
        try { const value = await client.accountInsight(this.accountId, name, since, until); metrics[name] = { ...value, fetchedAt: new Date(this.now()).toISOString() }; results[`account.${days}.${name}`] = value.status; }
        catch { results[`account.${days}.${name}`] = 'unavailable'; }
      }
      windows[days] = { reach: metrics.reach ?? null, accountMetrics: metrics };
    }
    const report = { state: 'available', source: 'direct_provider_publication', username: profile.username,
      followersCount: profile.followersCount, mediaCount: profile.mediaCount, countsObservedAt: new Date(observedAt).toISOString(),
      reach: windows[7].reach, accountMetrics: windows[7].accountMetrics, accountWindows: windows, metricResults: results,
      inventory: null, media: [], lastSuccessfulSync: null, lastAttempt: null,
      sourceObservedAt: new Date(this.now()).toISOString(), providerBoundary: 'unknown', mediaCoverage: 'unavailable' };
    await this.db.runTransaction(async tx => {
      const claimed = await tx.get(ref), value = claimed.data();
      if (!claimed.exists || value?.state !== 'claimed' || value.binding !== accountBinding || value.claimedAt !== claimedAt || value.callLimit !== callLimit) throw new Error('Instagram collection claim changed');
      tx.update(ref, { state: 'complete', observedAt: this.now(), calls: Math.min(calls, callLimit), report });
    });
    return { state: 'complete', calls: Math.min(calls, callLimit) };
  }
}
export async function instagramPublication(accountId: string) { return new InstagramPublication(await database(), accountId); }
