import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { oneSurfaceSql, oneFounderSurfaceSql, oneFeedEnvironment, validateOneFeedScope, ONE_REPORTING_SCOPE_VERSION } from '../src/server/one-scope.mjs';
import { oneAccountSource, readOneAccountCounts, oneIdentityAuthorityId } from '../src/server/one-account-scope.mjs';
import { sanitizePublicPayload } from '../server';
import { renderOneFeedSql } from '../scripts/render-one-feed-scope.mjs';

describe('One reporting environment boundary', () => {
  it('refuses aliased PROD/UAT feed configurations instead of relabelling PROD as UAT', () => {
    const production = ['prod-fixture', 'aggregate', 'feed'];
    const uat = ['uat-fixture', 'aggregate', 'feed'];
    expect(oneFeedEnvironment(production, { production, uat })).toBe('production');
    expect(oneFeedEnvironment(uat, { production, uat })).toBe('uat');
    expect(oneFeedEnvironment(uat, { production: uat, uat })).toBeNull();
    expect(oneFeedEnvironment(['other', 'aggregate', 'feed'], { production, uat })).toBeNull();
  });
  it('requires environment, exact streams and debug exclusion for every platform', () => {
    const prod = oneSurfaceSql('one.hushh.ai', 'production');
    const uat = oneSurfaceSql('uat.one.hushh.ai', 'uat');
    for (const sql of [prod, uat]) {
      expect(sql).toContain("key = 'env'");
      expect(sql).toContain("key = 'debug_mode'");
      expect(sql).toContain('LOWER(');
      expect(sql).toContain("platform = 'WEB' AND stream_id");
      expect(sql).toContain("app_info.id = 'com.hussh.app'");
    }
    expect(prod).toContain("stream_id = '13695001361'");
    expect(uat).toContain("stream_id = '14383415557'");
    expect(prod).not.toContain("= 'uat'");
    expect(oneFounderSurfaceSql('one.hushh.ai')).toBe(prod);
    expect(() => oneSurfaceSql('one.hushh.ai', 'unknown')).toThrow();
    expect(() => oneSurfaceSql("one.hushh.ai' OR TRUE", 'production')).toThrow();
    expect(() => oneSurfaceSql('one.hushh.ai', 'production', { alias: 'x;DROP' })).toThrow();
  });

  it('keeps generated view scope synchronized and UAT lineage separate', () => {
    expect(renderOneFeedSql()).toBe(readFileSync(new URL('../sql/kai_public_dashboard_feed.production.sql', import.meta.url), 'utf8').replaceAll('\r\n', '\n'));
    const uat = renderOneFeedSql('uat');
    expect(uat).toContain('hushh-pda-uat.analytics_533362555.events_*');
    expect(uat).toContain("'hushh-pda-uat' AS source_project_id");
    expect(uat).toContain("'analytics_533362555' AS source_dataset");
    expect(uat).not.toContain("'production' AS source_environment");
    expect(uat).not.toContain("e.platform IN ('IOS', 'ANDROID')");
    expect(uat).not.toContain('AND FALSE');
  });

  it('refuses old feeds, duplicate markers and mixed environment rows', () => {
    const rows = [
      { metric_group: 'status', metric_name: 'reporting_scope_version', metric_string_value: ONE_REPORTING_SCOPE_VERSION, source_environment: 'production' },
      { metric_group: 'status', metric_name: 'source_environment', metric_string_value: 'production', source_environment: 'production' },
      { metric_group: 'summary', metric_name: 'dau', metric_count: 1, source_environment: 'production' },
    ];
    expect(validateOneFeedScope(rows, 'production')).toBe(true);
    expect(validateOneFeedScope(rows, 'uat')).toBe(false);
    expect(validateOneFeedScope(rows.slice(1), 'production')).toBe(false);
    expect(validateOneFeedScope([...rows, rows[0]], 'production')).toBe(false);
    expect(validateOneFeedScope([...rows, { ...rows[2], source_environment: 'uat' }], 'production')).toBe(false);
  });
});

describe('environment account registries', () => {
  it('preserves public authority references through the real API sanitizer', () => {
    const prod = oneIdentityAuthorityId('hushh-pda');
    const uat = oneIdentityAuthorityId('hushh-pda-uat');
    expect(prod).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(prod).not.toBe(uat);
    expect(sanitizePublicPayload({ identityAuthorityId: prod })).toEqual({ identityAuthorityId: prod });
    expect(sanitizePublicPayload('hushh-pda')).toBe('Internal aggregate source');
  });
  const isolated = {
    ONE_PROD_FIREBASE_AUTH_PROJECT: 'prod-fixture', ONE_UAT_FIREBASE_AUTH_PROJECT: 'uat-fixture',
    ONE_PROD_ACCOUNT_REGISTRY_SCOPE: 'isolated', ONE_UAT_ACCOUNT_REGISTRY_SCOPE: 'isolated',
  };
  const range = { startDate: '2026-10-13', endDate: '2026-10-19' };

  it('never defaults UAT to production or treats legacy registries as isolated', () => {
    expect(oneAccountSource('production', {})).toMatchObject({ project: 'hushh-pda', registryScope: 'legacy_shared' });
    expect(oneAccountSource('uat', {})).toMatchObject({ project: '', registryScope: 'unconfigured' });
    const wrong = { ...isolated, ONE_UAT_FIREBASE_AUTH_PROJECT: 'prod-fixture' };
    expect(oneAccountSource('production', wrong).registryScope).toBe('legacy_shared');
    expect(oneAccountSource('uat', wrong).registryScope).toBe('legacy_shared');
    expect(oneAccountSource('production', isolated).cacheNamespace).not.toBe(oneAccountSource('uat', isolated).cacheNamespace);
    expect(() => oneAccountSource('unknown', isolated)).toThrow();
  });

  it('counts paginated immutable accounts once and keeps zero separate from malformed creation dates', async () => {
    const pages = [
      { users: [
        { localId: 'fixture-a', createdAt: String(Date.parse('2026-10-13T00:00:00Z')), email: 'private-fixture@example.invalid' },
        { localId: 'fixture-b', createdAt: String(Date.parse('2026-10-01T00:00:00Z')), disabled: true },
      ], nextPageToken: 'page-two' },
      { users: [
        { localId: 'fixture-a', createdAt: String(Date.parse('2026-10-13T00:00:00Z')) },
        { localId: 'fixture-c', createdAt: null },
      ] },
    ];
    const requested: string[] = [];
    const counts = await readOneAccountCounts(range, async (token: string) => { requested.push(token); return pages.shift(); });
    expect(requested).toEqual(['', 'page-two']);
    expect(counts).toEqual({ totalAccounts: 3, newAccounts: 1, accountsCreatedByRangeEnd: 2, disabledAccounts: 1, daily: [{ date: '2026-10-13', newAccounts: 1 }] });
    expect(JSON.stringify(counts)).not.toMatch(/fixture-|private-fixture|localId|email/);
    expect(await readOneAccountCounts(range, async () => ({ users: [] }))).toMatchObject({ totalAccounts: 0, newAccounts: 0 });
  });

  it('detects pagination cycles before publishing partial totals', async () => {
    const tokens = ['a', 'b', 'a'];
    await expect(readOneAccountCounts(range, async () => ({ nextPageToken: tokens.shift() }))).rejects.toThrow(/repeated/);
  });
});
