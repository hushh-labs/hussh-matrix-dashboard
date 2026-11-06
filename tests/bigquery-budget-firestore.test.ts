import { randomUUID } from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';
import { describe, expect, it } from 'vitest';
import { BIGQUERY_COST_LIMITS as limits, FirestoreQueryBudgetStore } from '../src/server/bigquery-cost-control';

const emulator = process.env.PLG_STORAGE_EMULATOR_TESTS === 'true';
if (emulator && !/^127\.0\.0\.1:\d{2,5}$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) {
  throw new Error('Query budget integration tests require an explicit localhost emulator.');
}
describe.skipIf(!emulator)('native Firestore query budget', () => {
  it('atomically fences competing instances and retains reservations after restart', async () => {
    const db = new Firestore({ projectId: 'demo-plg-storage', databaseId: `demo-cost-${randomUUID().slice(0, 8)}` });
    try {
      const day = '2026-11-07', ref = db.doc(`metricsQueryBudgetDays/${day}`);
      await ref.set({ policyVersion: 1, bytes: 98 * limits.bytesPerStatement, statements: 98 });
      const stores = [new FirestoreQueryBudgetStore(db), new FirestoreQueryBudgetStore(db)];
      const reservations = Array.from({ length: 4 }, (_, i) => ({ id: `metrics_concurrent_${i}`, day, bytes: limits.bytesPerStatement, statements: 1 }));
      const results = await Promise.allSettled(reservations.map((value, i) => stores[i % 2].reserve(value)));
      expect(results.filter(value => value.status === 'fulfilled')).toHaveLength(2);
      expect((await ref.get()).data()).toEqual({ policyVersion: 1, bytes: 100 * limits.bytesPerStatement, statements: 100 });
      const restarted = new FirestoreQueryBudgetStore(db);
      const accepted = reservations[results.findIndex(value => value.status === 'fulfilled')];
      await restarted.reserve(accepted); // stable job ID is idempotent, even at the ceiling
      await expect(restarted.reserve({ ...accepted, id: 'metrics_after_restart' })).rejects.toThrow('exhausted');
      expect((await ref.collection('reservations').get()).size).toBe(2);
      await restarted.reserve({ ...accepted, day: '2026-11-08' });
      expect((await db.doc('metricsQueryBudgetDays/2026-11-08').get()).data()?.statements).toBe(1);
    } finally { await db.terminate(); }
  }, 30_000);
});
