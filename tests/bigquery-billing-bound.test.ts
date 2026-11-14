import { describe, expect, it, vi } from 'vitest';
import { conservativeBillingBound } from '../src/server/bigquery-billing-bound';
const unit = 10 * 1024 ** 2;

describe('native billing ceiling', () => {
  it('counts every wildcard-matched table and distinct explicit table conservatively', async () => {
    const catalog = vi.fn(async () => [
      { id: 'events_20261101', type: 'TABLE' }, { id: 'events_20261102', type: 'TABLE' },
      { id: 'other', type: 'TABLE' },
    ]);
    const refs = [{ projectId: 'p', datasetId: 'd', tableId: 'events_*' }, { projectId: 'p', datasetId: 'd', tableId: 'other' },
      { projectId: 'p', datasetId: 'd', tableId: 'events_20261101' }];
    expect(await conservativeBillingBound(15 * 1024 ** 2, refs, catalog)).toBe(5 * unit);
    expect(catalog).toHaveBeenCalledTimes(1);
  });
  it('refuses incomplete, missing or view-backed catalogs instead of underestimating', async () => {
    const refs = [{ projectId: 'p', datasetId: 'd', tableId: 'events_*' }];
    await expect(conservativeBillingBound(1, refs, async () => [])).rejects.toThrow();
    await expect(conservativeBillingBound(1, refs, async () => [{ id: 'events_view', type: 'VIEW' }])).rejects.toThrow();
    await expect(conservativeBillingBound(1, [], async () => [])).rejects.toThrow();
    expect(await conservativeBillingBound(0, [], async () => [])).toBe(unit);
    expect(await conservativeBillingBound(0, [{ projectId: 'p', datasetId: 'd', tableId: 'INFORMATION_SCHEMA.TABLES' }], async () => [])).toBe(unit);
  });
});
