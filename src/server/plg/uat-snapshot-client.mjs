import { createHmac } from 'node:crypto';

const UAT_SNAPSHOT = 'https://api.uat.hushh.ai/api/one/plg/snapshot-uat';
const UAT_PERMISSION = 'https://api.uat.hushh.ai/api/one/plg/permission-uat';
const UAT_OWNER = 'https://api.uat.hushh.ai/api/one/plg/owner-uat';
const DAY = 86_400_000;
const unavailable = () => new Error('UAT activity evidence is unavailable.');

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

/** Signed projection for a verified session within the UAT cohort; never a send grant. */
export async function readUatOwnerProjection({ secret, emailHash, productionSecret }, fetcher = fetch, clock = Date.now) {
  if (productionSecret || typeof secret !== 'string' || secret.length < 32 ||
    typeof emailHash !== 'string' || !/^[a-f0-9]{64}$/.test(emailHash)) throw unavailable();
  const started = clock();
  const data = await postSigned(UAT_OWNER, 'owner-uat', secret, JSON.stringify({ emailHash }), started, fetcher);
  const received = clock(), scope = data?.scope;
  if (received < started || received - started > 60_000 || data?.environment !== 'uat' ||
    data.deliveryAuthorized !== false || !Object.hasOwn(data, 'scope')) throw unavailable();
  if (scope === null) return null;
  if (!scope || scope.environment !== 'uat' || typeof scope.accountId !== 'string' ||
    !scope.accountId || scope.accountId.length > 128 || /[\x00-\x1f\x7f]/.test(scope.accountId) ||
    typeof scope.generation !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(scope.generation) ||
    scope.emailHash !== emailHash ||
    !Number.isSafeInteger(scope.revision) || scope.revision < 1 || scope.journey !== 'agent_one' ||
    typeof scope.since !== 'string' || !Number.isFinite(Date.parse(scope.since)) ||
    Date.parse(scope.since) > received || Date.parse(scope.since) < received - 7 * DAY - 60_000) throw unavailable();
  return { environment: 'uat', accountId: scope.accountId, generation: scope.generation,
    emailHash: scope.emailHash, revision: scope.revision, since: scope.since, journey: scope.journey };
}

/** Scope must come from an authenticated, isolated UAT owner store. */
export async function readUatPermission({ scope, secret, productionSecret }, fetcher = fetch, clock = Date.now) {
  if (productionSecret || typeof secret !== 'string' || secret.length < 32 || !scope ||
    scope.environment !== 'uat' || typeof scope.accountId !== 'string' || !scope.accountId ||
    scope.accountId.length > 128 || /[\x00-\x1f\x7f]/.test(scope.accountId) ||
    typeof scope.generation !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(scope.generation) ||
    typeof scope.emailHash !== 'string' || !/^[a-f0-9]{64}$/.test(scope.emailHash) ||
    !Number.isSafeInteger(scope.revision) || scope.revision < 1) throw unavailable();
  const started = clock();
  const body = JSON.stringify({ accountId: scope.accountId, generation: scope.generation,
    emailHash: scope.emailHash, revision: scope.revision });
  const data = await postSigned(UAT_PERMISSION, 'permission-uat', secret, body, started, fetcher);
  const received = clock();
  if (received < started || received - started > 60_000 || data?.environment !== 'uat' ||
    data.allowed !== true || data.erased !== false || data.deliveryAuthorized !== false ||
    typeof data.ownerEpoch !== 'string' || !/^[a-f0-9]{64}$/.test(data.ownerEpoch)) throw unavailable();
  return { environment: 'uat', accountId: scope.accountId, journey: scope.journey,
    since: scope.since, generation: scope.generation, emailHash: scope.emailHash,
    revision: scope.revision, enabled: true, eligible: true, verified: true, ownerEpoch: data.ownerEpoch };
}

/**
 * Private UAT transport. The caller must supply an authenticated, current
 * owner permission lookup and a pure catalog/activity validator. This
 * module has no route, store or email authority.
 */
export async function readUatSnapshot({ url, secret, productionSecret, loadPermission, validate },
  fetcher = fetch, clock = Date.now) {
  if (url !== UAT_SNAPSHOT || typeof secret !== 'string' || secret.length < 32 ||
    productionSecret || typeof loadPermission !== 'function' || typeof validate !== 'function')
    throw unavailable();
  const started = clock();
  const before = await loadPermission();
  if (!before || before.environment !== 'uat' || before.enabled !== true || before.eligible !== true ||
    typeof before.accountId !== 'string' || !before.accountId || before.accountId.length > 128 ||
    /[\x00-\x1f\x7f]/.test(before.accountId) || typeof before.journey !== 'string' ||
    !before.journey || before.journey.length > 128 || !Number.isSafeInteger(before.revision) ||
    before.revision < 1 || typeof before.generation !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(before.generation) ||
    typeof before.emailHash !== 'string' || !/^[a-f0-9]{64}$/.test(before.emailHash) ||
    typeof before.ownerEpoch !== 'string' || !/^[a-f0-9]{64}$/.test(before.ownerEpoch) ||
    before.verified !== true || typeof before.since !== 'string' ||
    !Number.isFinite(Date.parse(before.since)) || Date.parse(before.since) > started ||
    Date.parse(before.since) < started - 7 * DAY - 60_000) throw unavailable();
  const requested = { accountId: before.accountId, journey: before.journey, since: before.since };
  const authorityKeys = ['environment', 'enabled', 'eligible', 'verified', 'accountId', 'journey',
    'since', 'revision', 'generation', 'emailHash', 'ownerEpoch'];
  const authority = JSON.stringify(authorityKeys.map(key => before[key]));
  const body = JSON.stringify({ version: 2, accounts: [{ ...requested, generation: before.generation,
    emailHash: before.emailHash, revision: before.revision, ownerEpoch: before.ownerEpoch }],
    customerReporting: false });
  const data = await postSigned(url, 'snapshot-uat', secret, body, started, fetcher);
  const received = clock(), asOf = Date.parse(data?.asOf), row = data?.accounts?.[0];
  if (received < started || received - started > 60_000 || typeof data?.asOf !== 'string' ||
    data.asOf.length > 40 || !Number.isFinite(asOf) || Math.abs(received - asOf) > 60_000 ||
    data?.version !== 2 || data.environment !== 'uat' || data.retainedOnly !== true ||
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
