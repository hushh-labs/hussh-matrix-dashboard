import { describe, expect, it } from 'vitest';
import type { BigQuery } from '@google-cloud/bigquery';
import { BigQueryInstagramStore, mediaObservationKey } from '../src/server/instagram/store';
import { parseReach, completedSevenDayWindow } from '../src/server/instagram/client';

const accountId = '17841436775785807';

describe('Instagram BigQuery persistence adapter', () => {
  it('uses one deterministic MERGE key and reconciles repeated observations', async () => {
    const rows = new Map<string, number | null>();
    const queries: Array<{ query: string; params: Record<string, any>; maximumBytesBilled: string }> = [];
    const fake = { query: async (options: any) => {
      queries.push(options);
      if (options.query.includes('MERGE') && options.query.includes('account_metrics')) {
        rows.set(options.params.key, options.params.value);
      }
      return [[]];
    } } as unknown as Pick<BigQuery, 'query'>;
    const store = new BigQueryInstagramStore('test-project', 'instagram_test', 'test-project', fake);
    const window = completedSevenDayWindow(new Date('2026-09-29T12:00:00Z'));
    const first = parseReach({ data: [{ name: 'reach', period: 'day', total_value: { value: 42 } }] }, window.since, window.until);
    const revised = { ...first, value: 43 };
    await store.saveReach('run-one', accountId, first, 'v26.0');
    await store.saveReach('run-two', accountId, revised, 'v26.0');
    expect(rows.size).toBe(1);
    expect([...rows.values()]).toEqual([43]);
    expect(queries.every((entry) => entry.maximumBytesBilled === '100000000')).toBe(true);
    expect(queries[0].query).toContain('T.requested_until=S.requested_until');
    expect(JSON.stringify(queries)).not.toContain('access_token');
  });
  it('does not mistake a storage failure for an overlapping run', async () => {
    const fake = { query: async () => { throw new Error('table missing with internal details'); } } as unknown as Pick<BigQuery, 'query'>;
    const store = new BigQueryInstagramStore('test-project', 'instagram_test', 'test-project', fake);
    await expect(store.acquire('run-one')).rejects.toThrow('Instagram sync lock unavailable');
  });
  it('uses stable lifetime media keys while preserving observed-at semantics', async () => {
    const queries: any[] = [];
    const fake = { query: async (options: any) => { queries.push(options); return [[]]; } } as unknown as Pick<BigQuery, 'query'>;
    const store = new BigQueryInstagramStore('test-project', 'instagram_test', 'test-project', fake);
    const metric = { name: 'saved' as const, period: 'lifetime' as const, metricType: 'lifetime_snapshot' as const,
      unit: 'count' as const, value: 0, status: 'available' as const, providerSince: null, providerUntil: null };
    await store.saveMediaInsight('first', accountId, '17841436775785808', '2026-09-28T00:00:00Z', metric, 'v26.0');
    await store.saveMediaInsight('second', accountId, '17841436775785808', '2026-09-28T00:00:00Z', { ...metric, value: 4 }, 'v26.0');
    expect(queries[0].params.key).toBe(mediaObservationKey(accountId, '17841436775785808', 'saved'));
    expect(queries[0].params.key).toBe(queries[1].params.key);
    expect(queries[0].params.metricType).toBe('lifetime_snapshot');
    expect(queries[0].query).toContain('fetched_at=CURRENT_TIMESTAMP()');
    expect(JSON.stringify(queries)).not.toContain('private-token');
  });
  it('writes a full classified inventory and reconciles batched lifetime insights', async () => {
    const queries: any[] = [];
    const fake = { query: async (options: any) => { queries.push(options); return [[]]; } } as unknown as Pick<BigQuery, 'query'>;
    const store = new BigQueryInstagramStore('test-project', 'instagram_test', 'test-project', fake);
    const item = { id: '17841436775785808', mediaType: 'VIDEO' as const, productType: 'REELS' as const,
      permalink: 'https://www.instagram.com/reel/test/', publishedAt: '2026-09-28T00:00:00Z', likeCount: 0, commentsCount: null };
    await store.saveMediaInventory('run-one', accountId,
      { items: [item], complete: true, windowSince: '2025-09-29T00:00:00Z' }, 'v26.0');
    expect(queries[0].query).toContain('BEGIN TRANSACTION');
    expect(queries[0].query).toContain('inventory_complete=@complete');
    expect(JSON.parse(queries[0].params.payload)[0]).toMatchObject({ id: item.id, productType: 'REELS', likeCount: 0 });
    const observation = { name: 'views' as const, period: 'lifetime' as const, metricType: 'lifetime_snapshot' as const,
      unit: 'views' as const, value: 0, status: 'available' as const, providerSince: null, providerUntil: null };
    const writes = [{ mediaId: item.id, publishedAt: item.publishedAt, observation }];
    await store.saveMediaInsightsBatch('run-one', accountId, writes, 'v26.0');
    await store.saveMediaInsightsBatch('run-two', accountId, writes, 'v26.0');
    const first = JSON.parse(queries[1].params.payload)[0];
    const second = JSON.parse(queries[2].params.payload)[0];
    expect(first.key).toBe(mediaObservationKey(accountId, item.id, 'views'));
    expect(first.key).toBe(second.key);
    expect(first.value).toBe(0);
    expect(queries[1].query).toContain('T.observation_key=S.observation_key');
    expect(queries).toHaveLength(3);
  });
});
