import { describe, expect, it } from 'vitest';
import type { Firestore } from '@google-cloud/firestore';
import { MonitoringPublication } from '../src/server/monitoring-publication';
class Memory {
 value: any; private tail = Promise.resolve();
 doc() { return { get: async () => this.snapshot() }; }
 snapshot() { return { exists: this.value !== undefined, data: () => this.value }; }
 async runTransaction<T>(fn: (tx: any) => Promise<T>) { const previous = this.tail; let release!: () => void; this.tail = new Promise<void>(r => { release = r; }); await previous;
  try { return await fn({ get: async () => this.snapshot(), create: (_: unknown, value: unknown) => { if (this.value) throw new Error('exists'); this.value = value; }, update: (_: unknown, value: unknown) => { this.value = { ...this.value, ...value as object }; } }); } finally { release(); } }
 native() { return this as unknown as Pick<Firestore, 'doc' | 'runTransaction'>; }
}
const asOf = '2026-11-14T21:34:55.606Z', now = Date.parse('2026-11-15T07:00:00Z');
function point(url: URL, value = '64826') { return { timeSeries: [{ points: [{ interval: { startTime: url.searchParams.get('interval.startTime'), endTime: url.searchParams.get('interval.endTime') }, value: { int64Value: value } }] }] }; }
describe('bounded Monitoring publication', () => {
 it('claims once, fixes the region and source, and reads only matching dated production windows', async () => {
  const db = new Memory(), store = new MonitoringPublication(db.native(), 'hushh-pda', 'hushh-webapp', asOf, () => now), urls: URL[] = [];
  const send = async (value: string) => { const u = new URL(value); urls.push(u); return point(u); };
  const results = await Promise.allSettled([store.collect(send), store.collect(send)]); expect(results.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected']); expect(urls).toHaveLength(15);
  expect(urls.every(u => u.searchParams.get('filter')?.includes('resource.labels.location="us-central1"') && u.searchParams.get('filter')?.includes('resource.labels.service_name="hushh-webapp"'))).toBe(true);
  const report = await store.read('2026-11-14', '2026-11-14'); expect(report).toMatchObject({ days: 1, metrics: { requests: { value: 64826 } } });
  expect(await store.read('2026-11-13', '2026-11-14')).toBeNull();
  expect(await new MonitoringPublication(db.native(), 'hushh-pda', 'other-service', asOf, () => now).read('2026-11-14', '2026-11-14')).toBeNull();
  expect((await new MonitoringPublication(db.native(), 'hushh-pda', 'hushh-webapp', asOf, () => now + 25 * 3_600_000).read('2026-11-14', '2026-11-14'))?.stale).toBe(true);
  expect(await new MonitoringPublication(db.native(), 'hushh-pda', 'hushh-webapp', asOf, () => now + 91 * 86_400_000).read('2026-11-14', '2026-11-14')).toBeNull();
 });
 it('withholds partial responses, missing points, extra pages and wrong intervals without inventing zeros', async () => {
  const db = new Memory(), store = new MonitoringPublication(db.native(), 'hushh-pda', 'hushh-webapp', asOf, () => now); let calls = 0;
  await store.collect(async input => { const u = new URL(input); calls++; const p = point(u); if (calls === 1) return { ...p, executionErrors: [{ code: 1 }] }; if (calls === 2) return { ...p, unreachable: ['region'] }; if (calls === 3) return { ...p, nextPageToken: 'next' }; if (calls === 4) return { timeSeries: [] }; if (calls === 5) { p.timeSeries[0].points[0].interval.endTime = '2026-11-14T00:00:00Z'; return p; } return p; });
  const day = await store.read('2026-11-14', '2026-11-14'), week = await store.read('2026-11-08', '2026-11-14');
  expect(day.metrics.requests.value).toBeNull(); expect(day.metrics.errors.value).toBeNull(); expect(day.metrics.instances.value).toBeNull();
  expect(week.metrics.requests.value).toBeNull(); expect(week.metrics.errors.value).toBeNull(); expect(calls).toBe(15);
 });
 it('rejects malformed numeric values while preserving an actual zero', async () => {
  const db = new Memory(), store = new MonitoringPublication(db.native(), 'hushh-pda', 'hushh-webapp', asOf, () => now); let calls = 0;
  await store.collect(async input => { const p = point(new URL(input)); const raw: any[] = ['', ' ', true, [], null, '0']; const value = raw[calls++];
    p.timeSeries[0].points[0].value = { int64Value: value }; return p; });
  const day = await store.read('2026-11-14', '2026-11-14'), week = await store.read('2026-11-08', '2026-11-14');
  expect(day.metrics.requests.value).toBeNull(); expect(day.metrics.errors.value).toBeNull(); expect(day.metrics.instances.value).toBeNull();
  expect(week.metrics.requests.value).toBeNull(); expect(week.metrics.errors.value).toBeNull(); expect(week.metrics.instances.value).toBe(0);
 });
 it('records a sanitized provider failure without a value', async () => {
  const db = new Memory(), store = new MonitoringPublication(db.native(), 'hushh-pda', 'hushh-webapp', asOf, () => now);
  await store.collect(async () => { throw { response: { status: 403, data: 'private provider detail' } }; });
  const report = await store.read('2026-11-14', '2026-11-14');
  expect(report.metrics.requests).toMatchObject({ value: null, state: 'unavailable', httpStatus: 403 });
  expect(JSON.stringify(report)).not.toContain('private provider detail');
 });
});
