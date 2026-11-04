import { readActivity, readCatalog } from './one-source';
import { createUatLiveScopeLoader } from './uat-live-owner';
import { readUatPermission, readUatSnapshot } from './uat-snapshot-client.mjs';

type UatScope = {
  environment: 'uat'; authorityScope: 'uat-live-owner'; accountId: string; journey: string;
  since: string; generation: string; emailHash: string; revision: number;
};

/**
 * UAT-only own activity projection. The route derives the owner from a signed
 * Matrix session and fresh UAT authority. No delivery or storage authority.
 */
export async function readUatOwnEvidence(
  loadScope: () => Promise<UatScope>, fetcher: typeof fetch = fetch, clock = Date.now,
) {
  const secret = process.env.PLG_UAT_SOURCE_SECRET ?? '';
  if (process.env.PLG_UAT_EVIDENCE_ENABLED !== 'true' ||
    process.env.PLG_UAT_RUNTIME !== 'uat' || process.env.PLG_UAT_IDENTITY_MODE !== 'live-signed' ||
    process.env.PLG_ONE_SOURCE_SECRET || process.env.PLG_FIRESTORE_PROJECT ||
    process.env.PLG_FIRESTORE_DATABASE || secret.length < 32) throw new Error('UAT activity evidence is unavailable.');
  return readUatSnapshot({
    url: 'https://api.uat.hushh.ai/api/one/plg/snapshot-uat', secret,
    productionSecret: process.env.PLG_ONE_SOURCE_SECRET,
    loadPermission: async () => {
      const scope = await loadScope();
      if (scope?.environment !== 'uat' || scope.authorityScope !== 'uat-live-owner')
        throw new Error('UAT activity evidence is unavailable.');
      return readUatPermission({ scope, secret, productionSecret: process.env.PLG_ONE_SOURCE_SECRET }, fetcher, clock);
    },
    validate: ({ row, catalog: rawCatalog, since, asOf }: { row: any; catalog: any; since: string; asOf: number }) => {
      if (!Array.isArray(row.tasks) || row.tasks.length || !Array.isArray(row.verified))
        throw new Error('UAT activity evidence is unavailable.');
      const catalog = readCatalog(rawCatalog);
      if (row.verified.length > catalog.agents.length) throw new Error('UAT activity evidence is unavailable.');
      const activity = readActivity(row.activity, catalog, since, asOf);
      if (!activity.enabled || !activity.startedAt || !activity.epoch ||
        activity.rollups.some(event => Date.parse(event.firstAt) < Date.parse(activity.startedAt!)))
        throw new Error('UAT activity evidence is unavailable.');
      return { environment: 'uat' as const, checkedAt: new Date(asOf).toISOString(),
        catalog, activity, deliveryAuthorized: false as const };
    },
  }, fetcher, clock);
}

/** Call only with the verified Matrix session email; never accept an email override. */
export async function readUatSessionEvidence(
  sessionEmail: string, fetcher: typeof fetch = fetch, clock = Date.now,
) {
  return readUatOwnEvidence(createUatLiveScopeLoader(sessionEmail, fetcher, clock), fetcher, clock);
}
