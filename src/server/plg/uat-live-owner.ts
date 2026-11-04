import { createHash } from 'node:crypto';
import { readUatOwnerProjection } from './uat-snapshot-client.mjs';

const DAY = 86_400_000;
const unavailable = () => new Error('UAT owner evidence is unavailable.');

/** No persisted owner projection: bind each read to a verified Matrix session. */
export function createUatLiveScopeLoader(sessionEmail: string, fetcher: typeof fetch = fetch, clock = Date.now) {
  const secret = process.env.PLG_UAT_SOURCE_SECRET ?? '';
  const email = typeof sessionEmail === 'string' ? sessionEmail.trim().toLowerCase() : '';
  const hashes = (process.env.PLG_UAT_OWNER_EMAIL_HASHES ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (process.env.PLG_UAT_EVIDENCE_ENABLED !== 'true' || process.env.PLG_UAT_RUNTIME !== 'uat' ||
    process.env.PLG_UAT_IDENTITY_MODE !== 'live-signed' || process.env.PLG_ONE_SOURCE_SECRET ||
    process.env.PLG_FIRESTORE_PROJECT || process.env.PLG_FIRESTORE_DATABASE || secret.length < 32 ||
    !/^[^\s@<>]+@hushh\.ai$/.test(email) || hashes.length < 1 || hashes.length > 100 ||
    new Set(hashes).size !== hashes.length || hashes.some(hash => !/^[a-f0-9]{64}$/.test(hash)))
    throw unavailable();
  const emailHash = createHash('sha256').update(email).digest('hex');
  if (!hashes.includes(emailHash)) throw unavailable();
  // The read may last up to two minutes. Pin a slightly newer lower bound so
  // the rolling seven-day window cannot masquerade as an authority change.
  const floor = clock() - 7 * DAY + 120_000;
  let pinnedSince: string | undefined;
  return async () => {
    const scope = await readUatOwnerProjection({ secret, emailHash, productionSecret: process.env.PLG_ONE_SOURCE_SECRET }, fetcher, clock);
    if (!scope || scope.emailHash !== emailHash) throw unavailable();
    if (!pinnedSince) pinnedSince = new Date(Math.max(Date.parse(scope.since), floor)).toISOString();
    if (Date.parse(scope.since) > Date.parse(pinnedSince)) throw unavailable();
    return { ...scope, environment: 'uat' as const, readAuthority: 'verified_owner' as const, since: pinnedSince,
      authorityScope: 'uat-live-owner' as const };
  };
}
