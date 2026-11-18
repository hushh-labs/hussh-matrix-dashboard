import { describe, expect, it } from 'vitest';
import { admitUatAudiencePage, finishUatAudiencePage } from '../src/server/plg/uat-audience-admission';
import { reportPath } from '../src/server/reports/store';
import { MemoryReportStore } from './helpers/metrics-report-memory-store';
const viewer = 'a'.repeat(64), other = 'b'.repeat(64), op = (n: number) => n.toString(16).padStart(64, '0');
const now = Date.parse('2026-11-19T12:00:00Z');
const p = { approved: true, enabled: true, revision: 1, dailyGlobal: 4, dailyViewer: 3, concurrentGlobal: 2, concurrentViewer: 1 };
const init = () => { const store = new MemoryReportStore(); store.data.set(reportPath('policy','uat-audience-admission'), p); return store; };
describe('UAT audience admission primitive', () => {
  it('defaults off and rejects malformed or unkeyed identity without writes', async () => {
    const store = new MemoryReportStore(); await expect(admitUatAudiencePage(store, viewer, op(1), now)).rejects.toThrow();
    store.data.set(reportPath('policy','uat-audience-admission'), p);
    await expect(admitUatAudiencePage(store, 'person@example.invalid', op(1), now)).rejects.toThrow();
    expect(store.data.size).toBe(1);
  });
  it('serializes competing instances, fences replay and leaves uncertainty charged', async () => {
    const store = init(); const results = await Promise.allSettled([admitUatAudiencePage(store, viewer, op(1), now), admitUatAudiencePage(store, viewer, op(2), now)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    await expect(admitUatAudiencePage(store, viewer, op(1), now)).rejects.toThrow();
    await admitUatAudiencePage(store, other, op(3), now);
    await expect(admitUatAudiencePage(store, 'c'.repeat(64), op(4), now)).rejects.toThrow();
    const accepted = results[0].status === 'fulfilled' ? op(1) : op(2);
    await finishUatAudiencePage(store, viewer, accepted);
    await expect(finishUatAudiencePage(store, viewer, accepted)).rejects.toThrow();
    await admitUatAudiencePage(store, viewer, op(5), now);
  });
  it('keeps observed tighter caps after denied admission even if policy is later raised', async () => {
    const store = init(); await admitUatAudiencePage(store, viewer, op(1), now); await finishUatAudiencePage(store, viewer, op(1));
    store.data.set(reportPath('policy','uat-audience-admission'), { ...p, revision: 2, dailyGlobal: 1, dailyViewer: 1, concurrentGlobal: 1, concurrentViewer: 1 });
    await expect(admitUatAudiencePage(store, viewer, op(2), now)).rejects.toThrow();
    store.data.set(reportPath('policy','uat-audience-admission'), { ...p, revision: 3 });
    await expect(admitUatAudiencePage(store, viewer, op(3), now)).rejects.toThrow();
  });
  it('does not release another viewer claim and does not refund daily usage', async () => {
    const store = init(); await admitUatAudiencePage(store, viewer, op(1), now);
    await expect(finishUatAudiencePage(store, other, op(1))).rejects.toThrow();
    await finishUatAudiencePage(store, viewer, op(1));
    expect(store.data.get(reportPath('uatAudienceDays','2026-11-19'))).toEqual({ used: 1, limit: 4 });
  });
});
