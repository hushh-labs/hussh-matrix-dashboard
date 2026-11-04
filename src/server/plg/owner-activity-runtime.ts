import { createHash } from 'node:crypto';
import { readOwnerProjection } from './owner-snapshot-client.mjs';

export type OwnerEnvironment = 'uat' | 'production';
export type OwnerScope = {
  environment: OwnerEnvironment; authorityScope: 'uat-live-owner' | 'production-live-owner';
  accountId: string; journey: string; since: string; readAuthority: 'verified_owner';
  emailHash: string; ownerEpoch: string;
};
const unavailable = () => new Error('Own activity evidence is unavailable.');

/** One cohort and read credential per environment. Marketing stores grant no own-read authority. */
export function ownerActivityConfig(environment: OwnerEnvironment, env = process.env) {
  const uat = environment === 'uat';
  const secret = (uat ? env.PLG_UAT_SOURCE_SECRET : env.PLG_OWNER_SOURCE_SECRET) ?? '';
  const hashes = ((uat ? env.PLG_UAT_OWNER_EMAIL_HASHES : env.PLG_OWNER_EMAIL_HASHES) ?? '')
    .split(',').map(s => s.trim()).filter(Boolean);
  if (environment !== 'uat' && environment !== 'production' ||
    env.GOOGLE_CLOUD_PROJECT !== (uat ? 'hushh-pda-uat' : 'hushh-ai-prod') ||
    (uat ? env.PLG_UAT_EVIDENCE_ENABLED : env.PLG_OWNER_EVIDENCE_ENABLED) !== 'true' ||
    (uat ? env.PLG_UAT_RUNTIME !== 'uat' || env.PLG_UAT_IDENTITY_MODE !== 'live-signed' ||
      env.PLG_ONE_SOURCE_SECRET || env.PLG_FIRESTORE_PROJECT || env.PLG_FIRESTORE_DATABASE
      : env.PLG_UAT_RUNTIME === 'uat') || secret.length < 32 ||
    [env.PLG_ONE_SOURCE_SECRET, env.PLG_ONE_SUBSCRIPTION_SECRET, env.PLG_ONE_AUDIENCE_SECRET,
      env.PLG_ATTEMPT_SOURCE_SECRET, env.PLG_ATTEMPT_WORKER_SECRET, env.PLG_SYNC_SECRET,
      env.PLG_CYCLE_SECRET, env.PLG_SIGNING_SECRET, uat ? env.PLG_OWNER_SOURCE_SECRET : env.PLG_UAT_SOURCE_SECRET].includes(secret) ||
    hashes.length < 1 || hashes.length > 100 || new Set(hashes).size !== hashes.length ||
    hashes.some(hash => !/^[a-f0-9]{64}$/.test(hash))) throw unavailable();
  return { secret, hashes, snapshotUrl: uat ? 'https://api.uat.hushh.ai/api/one/plg/snapshot-uat'
    : 'https://api.hushh.ai/api/one/plg/snapshot-owner' };
}

/** Every read binds fresh One identity to the verified Matrix session; no persisted owner cache. */
export function createOwnerScopeLoader(environment: OwnerEnvironment, sessionEmail: string,
  fetcher: typeof fetch = fetch, clock = Date.now): () => Promise<OwnerScope> {
  const { secret, hashes } = ownerActivityConfig(environment);
  const email = typeof sessionEmail === 'string' ? sessionEmail.trim().toLowerCase() : '';
  if (!/^[^\s@<>]+@hushh\.ai$/.test(email)) throw unavailable();
  const emailHash = createHash('sha256').update(email).digest('hex');
  if (!hashes.includes(emailHash)) throw unavailable();
  const floor = clock() - 7 * 86_400_000 + 120_000;
  let pinnedSince: string | undefined;
  return async () => {
    const scope = await readOwnerProjection({ environment, secret, emailHash }, fetcher, clock);
    if (!scope || scope.emailHash !== emailHash) throw unavailable();
    if (!pinnedSince) pinnedSince = new Date(Math.max(Date.parse(scope.since), floor)).toISOString();
    if (Date.parse(scope.since) > Date.parse(pinnedSince)) throw unavailable();
    return { ...scope, environment, readAuthority: 'verified_owner', since: pinnedSince,
      authorityScope: environment === 'uat' ? 'uat-live-owner' : 'production-live-owner' };
  };
}
