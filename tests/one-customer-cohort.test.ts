import { describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { tsImport } from 'tsx/esm/api';
import { loadCustomerCohort, customerAccountCounts, customerEventSql, requireFreshCohort } from '../src/server/one-customer-cohort';
import { oneReportingSurfaceSql, finalizedReportingEnd } from '../scripts/one-reporting-scope.mjs';

vi.mock('tsx/esm/api', () => ({ tsImport: vi.fn() }));

const now = Date.now(), id = 'a'.repeat(32), secret = 'synthetic-read-only-secret-32-characters';
const fixture = () => ({ version: 1, environment: 'production', scope: 'production_registered_contacts',
  policyRevision: 'b'.repeat(64), identityScheme: 'hushh-observability-v1-sha256-128', traversal: 'live',
  asOf: new Date(now).toISOString(), expiresAt: new Date(now + 600_000).toISOString(),
  scanned: 1, excluded: 0, rows: [{ analyticsUserId: id, registeredAt: new Date(now).toISOString() }], nextCursor: null });
const options = (fetcher: typeof fetch) => ({ url: 'https://api.hushh.ai/api/one/plg/audience', secret, fetch: fetcher, now: () => now });

describe('private production customer aggregate boundary', () => {
  it('anchors release comparisons to a finalized export and rejects missing day evidence', async () => {
    const reader = { query: vi.fn<(_options: { query: string }) => Promise<[{ latest: string | null }[]]>>(async () => [[{ latest: '20261020' }]]) };
    expect(await finalizedReportingEnd(reader, 'hushh-pda', 'analytics_526603671')).toBe('2026-10-20');
    expect(reader.query.mock.calls[0][0].query).toContain("r'^events_[0-9]{8}$'");
    reader.query.mockResolvedValue([[{ latest: null }]]);
    await expect(finalizedReportingEnd(reader, 'hushh-pda', 'analytics_526603671')).rejects.toThrow('could not be verified');
  });

  it('keeps release oracle queries in the customer population and leaves UAT independent', async () => {
    const cohort = await loadCustomerCohort(options(async () => Response.json(fixture())));
    const importer = vi.mocked(tsImport);
    importer.mockResolvedValue({ readCustomerCohort: async () => cohort, customerEventSql });
    const production = await oneReportingSurfaceSql('one.hushh.ai');
    expect(production).toContain(`user_id IN ('${id}')`);
    expect(production).toContain('one.hushh.ai');
    expect(production).not.toContain('user_pseudo_id');
    importer.mockResolvedValue({ readCustomerCohort: async () => ({ ...cohort, rows: [] }), customerEventSql });
    expect(await oneReportingSurfaceSql('one.hushh.ai')).toContain('AND (FALSE)');
    importer.mockRejectedValue(new Error('Membership authority unavailable'));
    await expect(oneReportingSurfaceSql('one.hushh.ai')).rejects.toThrow('Membership authority unavailable');
    importer.mockClear();
    expect(await oneReportingSurfaceSql('uat.one.hushh.ai', 'uat')).toContain('uat.one.hushh.ai');
    expect(importer).not.toHaveBeenCalled();
  });

  it('uses distinct signed read authority and only identified eligible events before aggregation', async () => {
    const fetcher = vi.fn(async (url, init) => {
      expect(String(url)).toBe('https://api.hushh.ai/api/one/plg/customer-cohort');
      expect(init?.redirect).toBe('error');
      const headers = init?.headers as Record<string, string>;
      expect(headers['X-PLG-Signature']).toBe(createHmac('sha256', secret).update(`customer-cohort\n${now}\n${init?.body}`).digest('hex'));
      return Response.json(fixture());
    }) as typeof fetch;
    const cohort = await loadCustomerCohort(options(fetcher));
    expect(customerEventSql(cohort, 'e')).toBe(`e.user_id IN ('${id}')`);
    expect(customerEventSql(cohort)).not.toContain('user_pseudo_id');
    const day = new Date(now).toISOString().slice(0, 10);
    expect(customerAccountCounts(cohort, { startDate: day, endDate: day })).toMatchObject({ totalAccounts: 1, newAccounts: 1, disabledAccounts: 0 });
    expect(() => requireFreshCohort(cohort, now + 300_000)).toThrow('could not be verified');
    expect(() => customerEventSql({ ...cohort, rows: [{ analyticsUserId: "' OR TRUE", registeredAt: null }] })).toThrow();
  });

  it('rejects incomplete traversal, mixed policy, private fields and repeated identities instead of publishing partial zeros', async () => {
    for (const mutation of [
      (page: any) => { page.environment = 'uat'; },
      (page: any) => { page.scanned = 2; },
      (page: any) => { page.rows[0].email = 'private@example.invalid'; },
      (page: any) => { page.expiresAt = new Date(now).toISOString(); },
      (page: any) => { page.nextCursor = 'unexpected-short-page'; },
    ]) {
      const page = fixture(); mutation(page);
      await expect(loadCustomerCohort(options(async () => Response.json(page)))).rejects.toThrow();
    }
    const first = { ...fixture(), scanned: 50, excluded: 50, rows: [], nextCursor: 'page-two' };
    let completeReads = 0;
    const complete = await loadCustomerCohort(options(async () => Response.json(++completeReads === 1 ? first : fixture())));
    expect(complete.rows).toHaveLength(1);
    expect(completeReads).toBe(2);
    for (const second of [{ ...fixture(), policyRevision: 'c'.repeat(64) }, null]) {
      let reads = 0;
      await expect(loadCustomerCohort(options(async () => ++reads === 1 ? Response.json(first) : second ? Response.json(second) : new Response('', { status: 503 })))).rejects.toThrow();
      expect(reads).toBe(2);
    }
    let reads = 0;
    const duplicates = { ...first, excluded: 49, rows: fixture().rows };
    await expect(loadCustomerCohort(options(async () => Response.json(++reads === 1 ? duplicates : fixture())))).rejects.toThrow();
  });

  it('accepts a complete empty cohort but withholds unknown registration timestamps', async () => {
    const empty = await loadCustomerCohort(options(async () => Response.json({ ...fixture(), scanned: 4, excluded: 4, rows: [] })));
    expect(customerEventSql(empty)).toBe('FALSE');
    const missingDate = await loadCustomerCohort(options(async () => Response.json({ ...fixture(), rows: [{ analyticsUserId: id, registeredAt: null }] })));
    expect(customerEventSql(missingDate)).toContain(id);
    expect(() => customerAccountCounts(missingDate, { startDate: '2026-10-01', endDate: '2026-10-31' })).toThrow();
  });
});
