import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp, signCookie } from '../server';
import { isReferralsPath, parseReferralQuery } from '../src/lib/referrals';

const read = vi.hoisted(() => vi.fn());
vi.mock('../src/server/referrals', () => ({ readReferralMetrics: read }));
const secret = 'test-referral-session-secret-thirty-two-characters';
const cookie = `hussh_matrix_session=${encodeURIComponent(signCookie(JSON.stringify({ email: 'qa@hushh.ai', exp: Math.floor(Date.now()/1000)+3600 }),secret))}`;
const app = () => createApp({ requireAuth: true, allowPublicDashboard: false, isProduction: false, sessionSecret: secret });
const path = '/api/analytics/one/referrals?environment=production&startDate=2026-10-12&endDate=2026-10-18';
const aggregate = { state: 'available', environment: 'production', totals: { referrers: 2, referredAccounts: 3, netPoints: -5 }, daily: [], points: [], rewards: [], weeklyAwards: [] };

describe('referral reporting scope', () => {
  it('validates exact dates, environment and bounded windows', () => {
    const now = new Date('2026-10-19T12:00:00Z');
    expect(parseReferralQuery({},now)).toEqual({ environment:'production', startDate:'2026-09-20',endDate:'2026-10-19' });
    for (const query of [
      { environment:'dev' }, { environment:['production','uat'] }, { startDate:'2026-02-30' },
      { startDate:'2026-10-19',endDate:'2026-10-18' }, { endDate:'2099-01-01' },
      { startDate:'2025-01-01',endDate:'2026-10-18' }, { startDate:'bad' }, { endDate:['2026-10-18'] },
    ]) expect(() => parseReferralQuery(query,now)).toThrow();
    expect(parseReferralQuery({ environment:'uat',startDate:'2026-10-18',endDate:'2026-10-18' },now).environment).toBe('uat');
    expect(isReferralsPath('/referral-analytics/')).toBe(true);
    expect(isReferralsPath('/referral-analytics/unknown')).toBe(false);
  });
  it('requires sign-in even after an aggregate has been cached', async () => {
    read.mockResolvedValue(aggregate);
    const server = app();
    expect((await request(server).get(path)).status).toBe(401);
    const response = await request(server).get(path).set('Cookie',cookie);
    expect(response.status).toBe(200); expect(response.body.totals.netPoints).toBe(-5);
    expect(response.headers['cache-control']).toContain('no-store');
    const hit = await request(server).get(path).set('Cookie',cookie);
    expect(hit.headers['x-metrics-cache']).toBe('HIT');
    expect((await request(server).get(path)).status).toBe(401);
  });
  it('isolates production, UAT and date ranges', async () => {
    read.mockClear(); read.mockImplementation(async query => ({ ...aggregate,environment:query.environment,range:query }));
    const server = app();
    for (const url of [path,path.replace('production','uat'),path.replace('2026-10-12','2026-10-13')]) {
      expect((await request(server).get(url).set('Cookie',cookie)).status).toBe(200);
    }
    expect(read).toHaveBeenCalledTimes(3);
  });
  it('rejects invalid input before contacting the source', async () => {
    read.mockClear();
    expect((await request(app()).get(path.replace('production','other')).set('Cookie',cookie)).status).toBe(400);
    expect(read).not.toHaveBeenCalled();
  });
  it('sanitizes source failures and does not turn missing data into zero', async () => {
    read.mockRejectedValue(new Error('private provider diagnostics and password'));
    const response = await request(app()).get(path).set('Cookie',cookie);
    expect(response.status).toBe(503);
    expect(response.body).toEqual({state:'unavailable',error:'Referral metrics are temporarily unavailable.'});
    expect(response.body.totals).toBeUndefined();
  });
});
