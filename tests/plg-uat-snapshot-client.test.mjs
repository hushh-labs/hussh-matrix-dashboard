import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readUatOwnerProjection, readUatPermission, readUatSnapshot } from '../src/server/plg/uat-snapshot-client.mjs';

const now = Date.parse('2026-10-31T08:00:00Z');
const url = 'https://api.uat.hushh.ai/api/one/plg/snapshot-uat';
const secret = 'x'.repeat(40);
const permission = { environment: 'uat', enabled: true, eligible: true, accountId: 'uat-owner',
  journey: 'agent_one', since: '2026-10-31T07:00:00Z', revision: 1,
  generation: '12345678-1234-1234-1234-123456789abc', emailHash: 'a'.repeat(64),
  ownerEpoch: 'b'.repeat(64), verified: true };
const snapshot = (overrides = {}) => ({ version: 2, environment: 'uat', retainedOnly: true,
  asOf: new Date(now).toISOString(), catalog: {}, accounts: [{ accountId: permission.accountId,
    journey: permission.journey, since: permission.since, deleted: false,
    activity: { enabled: true, epoch: permission.ownerEpoch } }], ...overrides });
const options = () => ({ url, secret, loadPermission: async () => ({ ...permission }),
  validate: async ({ row }) => ({ activity: row.activity }) });

test('UAT owner projection is bounded, separately signed and grants no delivery', async () => {
  const { enabled, eligible, verified, ownerEpoch, ...scope } = permission;
  const fetcher = async (target, request) => {
    assert.equal(target, 'https://api.uat.hushh.ai/api/one/plg/owner-uat');
    assert.equal(request.body, JSON.stringify({ emailHash: permission.emailHash }));
    assert.equal(request.headers['X-PLG-Signature'], createHmac('sha256', secret)
      .update(`owner-uat\n${now}\n${request.body}`).digest('hex'));
    return new Response(JSON.stringify({ environment: 'uat', deliveryAuthorized: false, scope }));
  };
  assert.deepEqual(await readUatOwnerProjection({ secret, emailHash: permission.emailHash }, fetcher, () => now), scope);
  await assert.rejects(readUatOwnerProjection({ secret, emailHash: permission.emailHash }, async () => new Response(JSON.stringify({
    environment: 'production', deliveryAuthorized: false, scope,
  })), () => now));
  assert.equal(await readUatOwnerProjection({ secret, emailHash: permission.emailHash }, async () => new Response(JSON.stringify({
    environment: 'uat', deliveryAuthorized: false, scope: null,
  })), () => now), null);
  const atBoundary = { ...scope, since: new Date(now - 7 * 86_400_000 - 1_000).toISOString() };
  assert.equal((await readUatOwnerProjection({ secret, emailHash: permission.emailHash }, async () => new Response(JSON.stringify({
    environment: 'uat', deliveryAuthorized: false, scope: atBoundary,
  })), () => now)).since, atBoundary.since);
});

test('UAT permission is separately signed and grants read, never delivery', async () => {
  const fetcher = async (target, request) => {
    assert.equal(target, 'https://api.uat.hushh.ai/api/one/plg/permission-uat');
    assert.equal(request.headers['X-PLG-Signature'], createHmac('sha256', secret)
      .update(`permission-uat\n${now}\n${request.body}`).digest('hex'));
    return new Response(JSON.stringify({ environment: 'uat', allowed: true, erased: false,
      deliveryAuthorized: false, ownerEpoch: permission.ownerEpoch }));
  };
  assert.deepEqual(await readUatPermission({ scope: permission, secret }, fetcher, () => now), permission);
  await assert.rejects(readUatPermission({ scope: permission, secret }, async () => new Response(JSON.stringify({
    environment: 'uat', allowed: true, erased: false, deliveryAuthorized: true, ownerEpoch: permission.ownerEpoch,
  })), () => now));
});

test('UAT request uses a distinct signed purpose and validates an owner snapshot', async () => {
  let calls = 0;
  const fetcher = async (target, request) => {
    calls++;
    assert.equal(target, url);
    assert.equal(request.redirect, 'error');
    assert.equal(request.headers['X-PLG-Signature'], createHmac('sha256', secret)
      .update(`snapshot-uat\n${now}\n${request.body}`).digest('hex'));
    assert.equal(JSON.parse(request.body).customerReporting, false);
    assert.equal(JSON.parse(request.body).accounts[0].ownerEpoch, permission.ownerEpoch);
    return new Response(JSON.stringify(snapshot()));
  };
  assert.deepEqual(await readUatSnapshot(options(), fetcher, () => now),
    { activity: { enabled: true, epoch: permission.ownerEpoch } });
  assert.equal(calls, 1);
});

test('rejects production endpoint, production proof and permission revocation', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return new Response(JSON.stringify(snapshot())); };
  await assert.rejects(readUatSnapshot({ ...options(), url: 'https://api.hushh.ai/api/one/plg/snapshot' }, fetcher, () => now));
  await assert.rejects(readUatSnapshot({ ...options(), productionSecret: 'present' }, fetcher, () => now));
  assert.equal(calls, 0);
  await assert.rejects(readUatSnapshot(options(), async () => new Response(JSON.stringify(snapshot({ environment: 'production' }))), () => now));
  await assert.rejects(readUatSnapshot(options(), async () => new Response(JSON.stringify(snapshot({ customerReporting: {} }))), () => now));
  let checks = 0;
  await assert.rejects(readUatSnapshot({ ...options(), loadPermission: async () => ({ ...permission, enabled: ++checks === 1 }) }, fetcher, () => now));
  assert.equal(checks, 2);
  const shared = { ...permission }; let reads = 0;
  await assert.rejects(readUatSnapshot({ ...options(), loadPermission: async () => {
    if (++reads === 2) shared.ownerEpoch = 'c'.repeat(64);
    return shared;
  } }, fetcher, () => now));
  let times = 0;
  await assert.rejects(readUatSnapshot(options(), fetcher, () => times++ === 0 ? now : now - 1));
});
