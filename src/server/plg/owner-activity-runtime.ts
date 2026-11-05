import { createHash } from 'node:crypto';
import { readOwnerProjection } from './owner-snapshot-client.mjs';

export type OwnerEnvironment = 'dev' | 'uat' | 'production';
export type OwnerScope = {
  environment: OwnerEnvironment; authorityScope: `${OwnerEnvironment}-live-owner`;
  accountId: string; journey: string; since: string; readAuthority: 'verified_owner';
  emailHash: string; ownerEpoch: string;
};
const unavailable = () => new Error('Own activity evidence is unavailable.');

/** Isolated UAT admits signed-in owners; Dev/Production retain explicit cohorts. */
export function ownerActivityConfig(environment: OwnerEnvironment, env = process.env) {
  if (!['dev', 'uat', 'production'].includes(environment)) throw unavailable();
  const nonproduction = environment !== 'production';
  const prefix = nonproduction ? `PLG_${environment.toUpperCase()}` : 'PLG_OWNER';
  const secretName = `${prefix}_SOURCE_SECRET`;
  const secret = env[secretName] ?? '';
  const hashes = (env[`${prefix}_${nonproduction ? 'OWNER_' : ''}EMAIL_HASHES`] ?? '')
    .split(',').map(s => s.trim()).filter(Boolean);
  if (env.GOOGLE_CLOUD_PROJECT !== (nonproduction ? `hushh-pda-${environment}` : 'hushh-ai-prod') ||
    env[`${prefix}_EVIDENCE_ENABLED`] !== 'true' ||
    (nonproduction ? env[`${prefix}_RUNTIME`] !== environment || env[`${prefix}_IDENTITY_MODE`] !== 'live-signed' ||
      env.PLG_ONE_SOURCE_SECRET || env.PLG_FIRESTORE_PROJECT || env.PLG_FIRESTORE_DATABASE
      : env.PLG_UAT_RUNTIME === 'uat' || env.PLG_DEV_RUNTIME === 'dev') ||
    (environment === 'dev' && env.PLG_UAT_RUNTIME === 'uat') ||
    (environment === 'uat' && env.PLG_DEV_RUNTIME === 'dev') || secret.length < 32 ||
    [env.PLG_ONE_SOURCE_SECRET, env.PLG_ONE_SUBSCRIPTION_SECRET, env.PLG_ONE_AUDIENCE_SECRET, env.PLG_UAT_AUDIENCE_SECRET,
      env.PLG_ATTEMPT_SOURCE_SECRET, env.PLG_ATTEMPT_WORKER_SECRET, env.PLG_SYNC_SECRET,
      env.PLG_CYCLE_SECRET, env.PLG_SIGNING_SECRET,
      ...['PLG_DEV_SOURCE_SECRET', 'PLG_UAT_SOURCE_SECRET', 'PLG_OWNER_SOURCE_SECRET']
        .filter(key => key !== secretName).map(key => env[key])].includes(secret) ||
    (environment !== 'uat' && (hashes.length < 1 || hashes.length > 100 || new Set(hashes).size !== hashes.length ||
    hashes.some(hash => !/^[a-f0-9]{64}$/.test(hash))))) throw unavailable();
  const urls = { dev: 'https://consent-protocol-aqahj4iyha-uc.a.run.app/api/one/plg/snapshot-dev',
    uat: 'https://api.uat.hushh.ai/api/one/plg/snapshot-uat',
    production: 'https://api.hushh.ai/api/one/plg/snapshot-owner' };
  return { secret, hashes, snapshotUrl: urls[environment] };
}

/** Every read binds fresh One identity to the verified Matrix session; no persisted owner cache. */
export function createOwnerScopeLoader(environment: OwnerEnvironment, sessionEmail: string,
  fetcher: typeof fetch = fetch, clock = Date.now): () => Promise<OwnerScope> {
  const { secret, hashes } = ownerActivityConfig(environment);
  const email = typeof sessionEmail === 'string' ? sessionEmail.trim().toLowerCase() : '';
  // The dashboard middleware already verifies its configured Google work-domain
  // policy. Do not introduce another UAT domain or per-person allowlist here.
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) || email.length > 254 ||
    (environment !== 'uat' && !email.endsWith('@hushh.ai'))) throw unavailable();
  const emailHash = createHash('sha256').update(email).digest('hex');
  if (environment !== 'uat' && !hashes.includes(emailHash)) throw unavailable();
  const floor = clock() - 7 * 86_400_000 + 120_000;
  let pinnedSince: string | undefined;
  return async () => {
    const scope = await readOwnerProjection({ environment, secret, emailHash }, fetcher, clock);
    if (!scope || scope.emailHash !== emailHash) throw unavailable();
    if (!pinnedSince) pinnedSince = new Date(Math.max(Date.parse(scope.since), floor)).toISOString();
    if (Date.parse(scope.since) > Date.parse(pinnedSince)) throw unavailable();
    return { ...scope, environment, readAuthority: 'verified_owner', since: pinnedSince,
      authorityScope: `${environment}-live-owner` };
  };
}
