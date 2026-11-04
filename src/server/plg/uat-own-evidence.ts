import { readActivity, readCatalog } from './one-source';
import { createUatLiveScopeLoader } from './uat-live-owner';
import { readOwnerPermission, readOwnerSnapshot } from './owner-snapshot-client.mjs';
import { createOwnerScopeLoader, ownerActivityConfig, type OwnerScope, type OwnerEnvironment } from './owner-activity-runtime';

/**
 * Environment-bound own activity projection. The route derives the owner from a signed
 * Matrix session and fresh One identity. No delivery or storage authority.
 */
export async function readOwnerEvidence(
  environment: OwnerEnvironment, loadScope: () => Promise<OwnerScope>, fetcher: typeof fetch = fetch, clock = Date.now,
) {
  const { secret, snapshotUrl } = ownerActivityConfig(environment);
  return readOwnerSnapshot({
    environment, url: snapshotUrl, secret,
    loadPermission: async () => {
      const scope = await loadScope();
      if (scope?.environment !== environment || scope.authorityScope !== `${environment}-live-owner`)
        throw new Error('Own activity evidence is unavailable.');
      return readOwnerPermission({ environment, scope, secret }, fetcher, clock);
    },
    validate: ({ row, catalog: rawCatalog, since, asOf }: { row: any; catalog: any; since: string; asOf: number }) => {
      if (!Array.isArray(row.tasks) || row.tasks.length || !Array.isArray(row.verified))
        throw new Error('Own activity evidence is unavailable.');
      const catalog = readCatalog(rawCatalog);
      if (row.verified.length > catalog.agents.length) throw new Error('Own activity evidence is unavailable.');
      const activity = readActivity(row.activity, catalog, since, asOf);
      if (!activity.enabled || !activity.startedAt || !activity.epoch ||
        activity.rollups.some(event => Date.parse(event.firstAt) < Date.parse(activity.startedAt!)))
        throw new Error('Own activity evidence is unavailable.');
      return { environment, checkedAt: new Date(asOf).toISOString(),
        catalog, activity, deliveryAuthorized: false as const };
    },
  }, fetcher, clock);
}

/** Call only with the verified Matrix session email; never accept an email override. */
export async function readUatSessionEvidence(
  sessionEmail: string, fetcher: typeof fetch = fetch, clock = Date.now,
) {
  return readOwnerEvidence('uat', createUatLiveScopeLoader(sessionEmail, fetcher, clock), fetcher, clock);
}

export function readUatOwnEvidence(loadScope: () => Promise<OwnerScope>, fetcher: typeof fetch = fetch, clock = Date.now) {
  return readOwnerEvidence('uat', loadScope, fetcher, clock);
}

export async function readProductionSessionEvidence(sessionEmail: string, fetcher: typeof fetch = fetch, clock = Date.now) {
  return readOwnerEvidence('production', createOwnerScopeLoader('production', sessionEmail, fetcher, clock), fetcher, clock);
}
