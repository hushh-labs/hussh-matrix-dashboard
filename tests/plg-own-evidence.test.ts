import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { enroll } from '../src/server/plg/engine';
import { readOwnEvidence } from '../src/server/plg/own-evidence';
import { MemoryPlgStore } from '../src/server/plg/store';
import { MAIL_OWNER } from '../src/server/plg/google-mail-store';
import { registerGoogleMailRoutes } from '../src/server/plg/google-mail-routes';
import { signValue, type PlgRuntime } from '../src/server/plg/service';
import type { PlgContact } from '../src/lib/plg';

const now = Date.parse('2026-10-29T14:00:00Z'), start = now - 3_600_000;
const iso = (at: number) => new Date(at).toISOString();
const options = { url: 'https://api.hushh.ai/api/one/plg/snapshot', secret: 'synthetic-only-own-evidence-signature-key' };
async function fixture() {
  const store = new MemoryPlgStore();
  await store.transaction(s => {
    const c = enroll(s, { accountId: 'synthetic-own', email: MAIL_OWNER, name: 'Own test', journey: 'memory', environment: 'production', internal: false,
      cohort: 'existing', frequency: 'daily', consent: true, consentSource: 'One email updates preference v1' }, 'fixture', start);
    c.permission = { enabled: true, eligible: true, generation: 'a763337a-bf20-4ad2-96e9-a9335b2a126c', revision: 1, checkedAt: iso(now) };
    c.customerReporting = { eligible: false, policyRevision: 'a'.repeat(64), checkedAt: iso(now) };
  });
  const snapshot: any = { version: 2, environment: 'production', retainedOnly: true, asOf: iso(now),
    catalog: { revision: 'b'.repeat(64), actions: [], agents: [{ id: 'agent_personal_information', label: 'Memory', public: true, available: true,
      outcome: { status: 'supported', proof: 'memory.confirmed_save.v1', label: 'Confirmed save', reason: 'Domain receipt' } }] },
    accounts: [{ accountId: 'synthetic-own', journey: 'memory', since: iso(start), deleted: false, tasks: [],
      activity: { enabled: true, mode: 'best_effort', limited: false, startedAt: iso(start), epoch: 'c'.repeat(64), rollups: [] },
      verified: [{ agentId: 'agent_personal_information', proof: 'memory.confirmed_save.v1', count: 1,
        firstAt: iso(now - 1000), lastAt: iso(now - 1000), days: ['2026-10-29'], privateBody: 'must-never-return' }] }] };
  const check = vi.fn(async (_contact: PlgContact) => ({ allowed: true, erased: false }));
  const transport = vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body);
    expect(body).toEqual({ version: 2, customerReporting: false, accounts: [{ accountId: 'synthetic-own', journey: 'memory', since: iso(start) }] });
    expect(init.headers['X-PLG-Signature']).toBe(signValue(`snapshot\n${now}\n${init.body}`, options.secret));
    return Response.json(snapshot);
  });
  return { store, snapshot, check, transport, run: () => readOwnEvidence(store, { check }, options, transport as typeof fetch, () => now) };
}
describe('fixed-own canonical behaviour inspection', () => {
  it('reads real-contract positive evidence without changing internal reporting, campaigns or mail', async () => {
    const f = await fixture(), before = await f.store.read();
    const value = await f.run();
    expect(value.positives).toEqual([{ agentId: 'agent_personal_information', label: 'Memory', count: 1,
      firstAt: iso(now - 1000), lastAt: iso(now - 1000), currentCapture: true }]);
    expect(value).toMatchObject({ observationMode: 'best_effort', customerReportingChanged: false, emailsSent: 0,
      customerCampaignEligibilityProved: false });
    expect(JSON.stringify(value)).not.toContain('must-never-return');
    expect(JSON.stringify(value)).not.toContain('synthetic-own');
    expect(await f.store.read()).toEqual(before); expect(f.check).toHaveBeenCalledTimes(2);
  });
  it('keeps missing capture and no domain receipts unknown', async () => {
    const f = await fixture(); f.snapshot.accounts[0].verified = [];
    Object.assign(f.snapshot.accounts[0].activity, { enabled: false, startedAt: null, epoch: null });
    expect(await f.run()).toMatchObject({ positives: [], captureEnabled: false, captureEpochPresent: false });
  });
  it.each(['wrong_owner', 'deleted', 'old_snapshot', 'wrong_environment', 'wrong_proof', 'duplicate_agent', 'before_consent', 'future_effect'])
    ('rejects %s without persisting or sending', async kind => {
      const f = await fixture(), r = f.snapshot.accounts[0];
      if (kind === 'wrong_owner') r.accountId = 'someone-else';
      if (kind === 'deleted') r.deleted = true;
      if (kind === 'old_snapshot') f.snapshot.asOf = iso(now - 61_000);
      if (kind === 'wrong_environment') f.snapshot.environment = 'uat';
      if (kind === 'wrong_proof') r.verified[0].proof = 'client.reported';
      if (kind === 'duplicate_agent') r.verified.push({ ...r.verified[0] });
      if (kind === 'before_consent') r.verified[0].firstAt = iso(start - 1);
      if (kind === 'future_effect') r.verified[0].lastAt = iso(now + 1);
      const before = await f.store.read();
      await expect(f.run()).rejects.toThrow(); expect(await f.store.read()).toEqual(before);
    });
  it.each(['suppression', 'grant', 'email', 'remote_revocation'])('fences %s while evidence loads', async kind => {
    const f = await fixture();
    f.transport.mockImplementationOnce(async () => {
      if (kind === 'remote_revocation') f.check.mockResolvedValueOnce({ allowed: false, erased: false });
      else await f.store.transaction(s => {
        if (kind === 'suppression') s.contacts[0].suppressed = 'unsubscribed';
        if (kind === 'grant') s.contacts[0].permission!.generation = 'b763337a-bf20-4ad2-96e9-a9335b2a126c';
        if (kind === 'email') s.contacts[0].email = 'other@example.invalid';
      });
      return Response.json(f.snapshot);
    });
    await expect(f.run()).rejects.toThrow();
  });
  it('does not contact the source without current canonical permission', async () => {
    const f = await fixture(); f.check.mockResolvedValue({ allowed: false, erased: false });
    await expect(f.run()).rejects.toThrow(); expect(f.transport).not.toHaveBeenCalled();
  });
  it('binds a team member self-check to their own current verified permission', async () => {
    const f = await fixture();
    await f.store.transaction(s => { s.contacts[0].email = 'team-member@hushh.ai'; });
    await expect(readOwnEvidence(f.store, { check: f.check }, options, f.transport as typeof fetch,
      () => now, 'team-member@hushh.ai')).resolves.toMatchObject({ emailsSent: 0 });
    expect(f.check.mock.calls[0][0].email).toBe('team-member@hushh.ai');
    await expect(f.run()).rejects.toThrow();
  });
  it('enforces session owner and refuses account or environment selectors', async () => {
    const own = vi.fn(async () => ({ emailsSent: 0 })), app = express();
    app.use((req, _res, next) => { (req as any).sessionUser = { email: req.get('Test-User') }; next(); });
    registerGoogleMailRoutes(app, { enabled: true, admins: new Set([MAIL_OWNER, 'other@example.invalid']) } as PlgRuntime,
      async () => [], undefined, own);
    expect((await request(app).get('/api/plg/my-behaviour')).status).toBe(401);
    expect((await request(app).get('/api/plg/my-behaviour').set('Test-User', 'other@example.invalid')).status).toBe(403);
    expect((await request(app).get('/api/plg/my-behaviour?accountId=other').set('Test-User', MAIL_OWNER)).status).toBe(400);
    const result = await request(app).get('/api/plg/my-behaviour').set('Test-User', MAIL_OWNER);
    expect(result.status).toBe(200); expect(result.headers['cache-control']).toBe('no-store'); expect(own).toHaveBeenCalledWith(MAIL_OWNER);
    expect((await request(app).get('/api/plg/my-behaviour').set('Test-User', 'team-member@hushh.ai')).status).toBe(200);
    expect(own).toHaveBeenLastCalledWith('team-member@hushh.ai');
  });
});
