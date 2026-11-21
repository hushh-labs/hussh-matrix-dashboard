import { expect, it, vi } from 'vitest';
import { readAdmittedUatPage } from '../src/server/plg/uat-audience-admitted-read';
import { reportPath } from '../src/server/reports/store';
import { MemoryReportStore } from './helpers/metrics-report-memory-store';
const key = 'k'.repeat(40), viewer = 'test@example.invalid', now = () => Date.parse('2026-11-19T12:00:00Z');
const policy = { approved: true, enabled: true, revision: 1, dailyGlobal: 2, dailyViewer: 2, concurrentGlobal: 1, concurrentViewer: 1 };
const setup = () => { const store = new MemoryReportStore(); store.data.set(reportPath('policy','uat-audience-admission'), policy); return store; };
const op = (n: string) => () => n.repeat(64);
it('requires authority around a complete source read and stores no raw viewer', async () => {
  const store = setup(), authority = vi.fn().mockResolvedValue(true), read = vi.fn().mockResolvedValue({ terminal: true, value: { ok: true } });
  await expect(readAdmittedUatPage({ store, viewer, key, authority, read, now, operation: op('a'), signal: new AbortController().signal })).resolves.toEqual({ ok: true });
  expect(authority).toHaveBeenCalledTimes(3); expect(read).toHaveBeenCalledTimes(1);
  expect(JSON.stringify([...store.data])).not.toContain(viewer);
});
it('authority loss after admission prevents source I/O and releases concurrency without a refund', async () => {
  const store = setup(), authority = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false), read = vi.fn();
  await expect(readAdmittedUatPage({ store, viewer, key, authority, read, now, operation: op('b'), signal: new AbortController().signal })).rejects.toThrow();
  expect(read).not.toHaveBeenCalled(); expect((store.data.get(reportPath('uatAudienceClaims', 'b'.repeat(64))) as any).state).toBe('complete');
  expect((store.data.get(reportPath('uatAudienceDays', '2026-11-19')) as any).used).toBe(1);
});
it('revocation after response withholds it and uncertain errors remain open', async () => {
  const store = setup(), authority = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  await expect(readAdmittedUatPage({ store, viewer, key, authority, read: async () => ({ terminal: true as const, value: 'private' }), now, operation: op('c'), signal: new AbortController().signal })).rejects.toThrow();
  await expect(readAdmittedUatPage({ store, viewer, key, authority: async () => true, read: async () => { throw new Error('uncertain'); }, now, operation: op('d'), signal: new AbortController().signal })).rejects.toThrow();
  expect((store.data.get(reportPath('uatAudienceClaims', 'd'.repeat(64))) as any).state).toBe('open');
});

it('does not release a partial or invalid result', async () => {
  const store = setup();
  await expect(readAdmittedUatPage({ store, viewer, key, authority: async () => true, read: async () => ({ terminal: false } as any), now, operation: op('e'), signal: new AbortController().signal })).rejects.toThrow();
  expect((store.data.get(reportPath('uatAudienceClaims', 'e'.repeat(64))) as any).state).toBe('open');
});

it('releases a pre-dispatch cancellation while retaining its daily charge', async () => {
  const store = setup(), controller = new AbortController(), read = vi.fn(); let checks = 0;
  const authority = async () => { if (++checks === 2) controller.abort(); return true; };
  await expect(readAdmittedUatPage({ store, viewer, key, authority, read, now, operation: op('f'), signal: controller.signal })).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
  expect((store.data.get(reportPath('uatAudienceClaims', 'f'.repeat(64))) as any).state).toBe('complete');
  expect((store.data.get(reportPath('uatAudienceDays', '2026-11-19')) as any).used).toBe(1);
  expect((store.data.get(reportPath('uatAudienceActive', 'global')) as any).count).toBe(0);
});
