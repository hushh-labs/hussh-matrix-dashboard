import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp, signCookie } from '../server';
import { isReferralsPath, parseReferralQuery } from '../src/lib/referrals';

const read = vi.hoisted(() => vi.fn());
vi.mock('../src/server/referrals', () => ({ readReferralRankings: read }));
const secret = 'test-referral-session-secret-thirty-two-characters';
const cookie = `hussh_matrix_session=${encodeURIComponent(signCookie(JSON.stringify({ email: 'qa@hushh.ai', exp: Math.floor(Date.now()/1000)+3600 }),secret))}`;
const app = (isPublic = false) => createApp({ requireAuth: !isPublic, allowPublicDashboard: isPublic, isProduction: false, sessionSecret: secret });
const path = '/api/analytics/one/referrals?board=individual&afterRank=0';
const snapshotId = 'c22bf6bb-c6d2-4d87-b2d6-31e17498a2e4';
const standings = { state: 'available', board: 'individual', environment: 'uat', environments: ['uat'],
  sources: [{environment:'uat',state:'available'}], snapshotId, snapshotGeneratedAt:'2026-10-19T12:00:00Z',
  entryCount:21, entries:[{rank:1,handle:'Public handle',points:730}], nextAfterRank:20 };

describe('referral ranking contract', () => {
  it('accepts only a bounded cursor tied to a source snapshot', () => {
    expect(parseReferralQuery({})).toEqual({board:'individual',afterRank:0});
    expect(parseReferralQuery({environment:'uat',afterRank:'20',snapshotId}).afterRank).toBe(20);
    for (const query of [
      {environment:'dev'}, {environment:['uat']}, {board:'rewards'}, {board:['individual']},
      {afterRank:'-1'}, {afterRank:'1.5'}, {afterRank:'1000000000'}, {afterRank:['20']},
      {afterRank:'20'}, {environment:'uat',afterRank:'20'}, {snapshotId},
      {environment:'uat',snapshotId:'not-uuid'}, {board:'circles',environment:'uat',snapshotId},
    ]) expect(() => parseReferralQuery(query)).toThrow();
    expect(isReferralsPath('/referral-analytics/')).toBe(true);
    expect(isReferralsPath('/referral-analytics/unknown')).toBe(false);
  });
  it('requires sign-in before both uncached and cached rankings', async () => {
    read.mockResolvedValue(standings);
    const server = app();
    expect((await request(server).get(path)).status).toBe(401);
    const response = await request(server).get(path).set('Cookie',cookie);
    expect(response.status).toBe(200); expect(response.body.entries[0].points).toBe(730);
    expect(response.headers['cache-control']).toContain('no-store');
    const hit = await request(server).get(path).set('Cookie',cookie);
    expect(hit.headers['x-metrics-cache']).toBe('HIT');
    expect((await request(server).get(path)).status).toBe(401);
  });
  it('keeps public leaderboard handles private even in public aggregate mode', async () => {
    read.mockClear(); read.mockResolvedValue(standings);
    const server = app(true);
    expect((await request(server).get(path)).status).toBe(401);
    expect(read).not.toHaveBeenCalled();
    expect((await request(server).get(path).set('Cookie',cookie)).status).toBe(200);
    expect((await request(server).get(path)).status).toBe(401);
  });
  it('isolates environments, boards, snapshot versions and cursors in cache', async () => {
    read.mockClear(); read.mockResolvedValue(standings);
    const server = app();
    const urls = [path, `${path}&environment=uat`, path.replace('individual','circles'),
      `${path}&environment=production&snapshotId=${snapshotId}`,
      `${path.replace('afterRank=0','afterRank=20')}&environment=production&snapshotId=${snapshotId}`,
      `${path}&environment=production&snapshotId=36040968-628f-4093-8479-1c5b78fe2f0c`];
    for (const url of urls) expect((await request(server).get(url).set('Cookie',cookie)).status).toBe(200);
    expect(read).toHaveBeenCalledTimes(urls.length);
  });
  it('rejects invalid input before contacting the source', async () => {
    read.mockClear();
    expect((await request(app()).get(`${path}&environment=other`).set('Cookie',cookie)).status).toBe(400);
    expect(read).not.toHaveBeenCalled();
  });
  it('sanitizes failed sources rather than reporting zero standings', async () => {
    read.mockRejectedValue(new Error('private provider diagnostics and password'));
    const response = await request(app()).get(path).set('Cookie',cookie);
    expect(response.status).toBe(503);
    expect(response.body).toEqual({state:'unavailable',error:'Referral rankings are temporarily unavailable.'});
    expect(response.body.entries).toBeUndefined();
  });
});
