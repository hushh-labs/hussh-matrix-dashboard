import { createHmac } from 'node:crypto';

const endpoints = {
  dev: { origin: 'https://consent-protocol-aqahj4iyha-uc.a.run.app', owner: 'owner-dev', permission: 'permission-dev', snapshot: 'snapshot-dev' },
  uat: { origin: 'https://api.uat.hushh.ai', owner: 'owner-uat', permission: 'permission-uat', snapshot: 'snapshot-uat' },
  production: { origin: 'https://api.hushh.ai', owner: 'owner', permission: 'permission-owner', snapshot: 'snapshot-owner' },
};
function target(environment, action) {
  const lane = Object.hasOwn(endpoints, environment) ? endpoints[environment] : null;
  if (!lane) throw unavailable();
  return `${lane.origin}/api/one/plg/${lane[action]}`;
}
const purpose = (environment, action) => environment === 'production' ? `owner.production.${action}` : `${action}-${environment}`;
const DAY = 86_400_000;
const unavailable = () => new Error('Own activity evidence is unavailable.');

async function postSigned(url, purpose, secret, body, started, fetcher) {
  const signature = createHmac('sha256', secret).update(`${purpose}\n${started}\n${body}`).digest('hex');
  try {
    const response = await fetcher(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { 'Content-Type': 'application/json', 'X-PLG-Timestamp': String(started),
        'X-PLG-Signature': signature }, body });
    if (!response.ok || !response.body) throw unavailable();
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 1_000_000) { await reader.cancel(); throw unavailable(); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { throw unavailable(); }
}

/** Signed projection for a verified session within its environment cohort; never a send grant. */
export async function readOwnerProjection({ environment, secret, emailHash, productionSecret = '' }, fetcher = fetch, clock = Date.now) {
  if (environment !== 'production' && productionSecret || typeof secret !== 'string' || secret.length < 32 ||
    typeof emailHash !== 'string' || !/^[a-f0-9]{64}$/.test(emailHash)) throw unavailable();
  const started = clock();
  const data = await postSigned(target(environment, 'owner'), purpose(environment, 'owner'), secret, JSON.stringify({ emailHash }), started, fetcher);
  const received = clock(), scope = data?.scope;
  if (received < started || received - started > 60_000 || data?.environment !== environment ||
    data.deliveryAuthorized !== false || !Object.hasOwn(data, 'scope')) throw unavailable();
  if (scope === null) return null;
  if (!scope || scope.environment !== environment || typeof scope.accountId !== 'string' ||
    !scope.accountId || scope.accountId.length > 128 || /[\x00-\x1f\x7f]/.test(scope.accountId) ||
    scope.readAuthority !== 'verified_owner' || scope.emailHash !== emailHash ||
    typeof scope.ownerEpoch !== 'string' || !/^[a-f0-9]{64}$/.test(scope.ownerEpoch) || scope.journey !== 'agent_one' ||
    typeof scope.since !== 'string' || !Number.isFinite(Date.parse(scope.since)) ||
    Date.parse(scope.since) > received || Date.parse(scope.since) < received - 7 * DAY - 60_000) throw unavailable();
  return { environment, readAuthority: 'verified_owner', accountId: scope.accountId,
    emailHash: scope.emailHash, ownerEpoch: scope.ownerEpoch, since: scope.since, journey: scope.journey };
}

/** Scope comes from the current verified owner, independent of marketing choice. */
export async function readOwnerPermission({ environment, scope, secret, productionSecret = '' }, fetcher = fetch, clock = Date.now) {
  if (environment !== 'production' && productionSecret || typeof secret !== 'string' || secret.length < 32 || !scope ||
    scope.environment !== environment || typeof scope.accountId !== 'string' || !scope.accountId ||
    scope.accountId.length > 128 || /[\x00-\x1f\x7f]/.test(scope.accountId) ||
    scope.readAuthority !== 'verified_owner' ||
    typeof scope.emailHash !== 'string' || !/^[a-f0-9]{64}$/.test(scope.emailHash) ||
    typeof scope.ownerEpoch !== 'string' || !/^[a-f0-9]{64}$/.test(scope.ownerEpoch)) throw unavailable();
  const started = clock();
  const body = JSON.stringify({ accountId: scope.accountId,
    emailHash: scope.emailHash, ownerEpoch: scope.ownerEpoch });
  const data = await postSigned(target(environment, 'permission'), purpose(environment, 'permission'), secret, body, started, fetcher);
  const received = clock();
  if (received < started || received - started > 60_000 || data?.environment !== environment ||
    data.allowed !== true || data.erased !== false || data.deliveryAuthorized !== false ||
    data.ownerEpoch !== scope.ownerEpoch) throw unavailable();
  return { environment, accountId: scope.accountId, journey: scope.journey,
    since: scope.since, readAuthority: 'verified_owner', emailHash: scope.emailHash,
    enabled: true, eligible: true, verified: true, ownerEpoch: data.ownerEpoch };
}

/**
 * Environment-bound private transport. The caller must supply an authenticated, current
 * owner permission lookup and a pure catalog/activity validator. This
 * module has no route, store or email authority.
 */
export async function readOwnerSnapshot({ environment, url, secret, productionSecret = '', loadPermission, validate },
  fetcher = fetch, clock = Date.now) {
  if (url !== target(environment, 'snapshot') || typeof secret !== 'string' || secret.length < 32 ||
    environment !== 'production' && productionSecret || typeof loadPermission !== 'function' || typeof validate !== 'function')
    throw unavailable();
  const started = clock();
  const before = await loadPermission();
  if (!before || before.environment !== environment || before.enabled !== true || before.eligible !== true ||
    typeof before.accountId !== 'string' || !before.accountId || before.accountId.length > 128 ||
    /[\x00-\x1f\x7f]/.test(before.accountId) || typeof before.journey !== 'string' ||
    !before.journey || before.journey.length > 128 || before.readAuthority !== 'verified_owner' ||
    typeof before.emailHash !== 'string' || !/^[a-f0-9]{64}$/.test(before.emailHash) ||
    typeof before.ownerEpoch !== 'string' || !/^[a-f0-9]{64}$/.test(before.ownerEpoch) ||
    before.verified !== true || typeof before.since !== 'string' ||
    !Number.isFinite(Date.parse(before.since)) || Date.parse(before.since) > started ||
    Date.parse(before.since) < started - 7 * DAY - 60_000) throw unavailable();
  const requested = { accountId: before.accountId, journey: before.journey, since: before.since };
  const authorityKeys = ['environment', 'enabled', 'eligible', 'verified', 'accountId', 'journey',
    'since', 'readAuthority', 'emailHash', 'ownerEpoch'];
  const authority = JSON.stringify(authorityKeys.map(key => before[key]));
  const body = JSON.stringify({ version: 2, accounts: [{ ...requested,
    emailHash: before.emailHash, ownerEpoch: before.ownerEpoch }],
    customerReporting: false });
  const data = await postSigned(url, purpose(environment, 'snapshot'), secret, body, started, fetcher);
  const received = clock(), asOf = Date.parse(data?.asOf), row = data?.accounts?.[0];
  if (received < started || received - started > 60_000 || typeof data?.asOf !== 'string' ||
    data.asOf.length > 40 || !Number.isFinite(asOf) || Math.abs(received - asOf) > 60_000 ||
    data?.version !== 2 || data.environment !== environment || data.retainedOnly !== true ||
    Object.hasOwn(data, 'customerReporting') || !Array.isArray(data.accounts) || data.accounts.length !== 1 ||
    !row || row.accountId !== requested.accountId || row.journey !== requested.journey ||
    row.since !== requested.since || row.deleted !== false || row.activity?.enabled !== true ||
    row.activity?.epoch !== before.ownerEpoch) throw unavailable();
  const result = await validate({ row, catalog: data.catalog, since: requested.since, asOf });
  const after = await loadPermission();
  const finished = clock();
  if (!after || JSON.stringify(authorityKeys.map(key => after[key])) !== authority ||
    finished < received || finished - started > 120_000 || result == null) throw unavailable();
  return result;
}
