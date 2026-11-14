import { canonicalAnalyticsKey } from './aggregate-cache';
import type { CustomerCohort } from './one-customer-cohort';
import type { LegacyRestoration } from './legacy-restoration';

const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Bind PLG's production range to an existing witnessed One publication. */
export async function verifiedPlgPublicationAnchor(
  restoration: Pick<LegacyRestoration, 'publicationAsOf' | 'readCompatibleSnapshot'> | null,
  readCohort: () => Promise<CustomerCohort>,
  recheck: (key: string) => Promise<unknown>,
): Promise<string | null> {
  if (!restoration) return null;
  const asOf = await restoration.publicationAsOf();
  if (!asOf || !Number.isFinite(Date.parse(asOf))) return null;
  const endDate = new Date(asOf).toISOString().slice(0, 10);
  const startDate = new Date(Date.parse(endDate) - 29 * 86_400_000).toISOString().slice(0, 10);
  const report = canonicalAnalyticsKey(`/api/analytics/all?view=one&environment=production&one_start_date=${startDate}&one_end_date=${endDate}`);
  const cohort = await readCohort(), snapshot = await restoration.readCompatibleSnapshot(report, cohort);
  if (!snapshot || snapshot.at !== Date.parse(asOf)) return null;
  const body = record(snapshot.value.body), one = record(body?.one), data = record(one?.data), production = record(data?.production);
  const range = record(production?.range), active = record(production?.activeUsers), identified = record(production?.identifiedUsers);
  const selected = record(identified?.selectedRange), registry = record(production?.registeredAccounts);
  if (data?.uat !== null || production?.reportingEnvironment !== 'production' || production.reportingScopeVersion !== 'one-environment-v1'
    || range?.startDate !== startDate || range.endDate !== endDate || range.days !== 30
    || selected?.startDate !== startDate || selected.endDate !== endDate || active?.countingUnit !== 'device' || identified?.countingUnit !== 'account'
    || registry?.startDate !== startDate || registry.endDate !== endDate || registry.environment !== 'production'
    || !(registry.registryScope === 'production_contacts' || (registry.registryScope === 'isolated' && registry.sharedAcrossEnvironments !== true))) return null;
  await recheck(cohort.cacheKey); return asOf;
}
