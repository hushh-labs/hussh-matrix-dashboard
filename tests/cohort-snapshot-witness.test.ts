import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { cohortMatchesSnapshotWitness, cohortSnapshotWitness, type CustomerCohort } from '../src/server/one-customer-cohort';
const policyRevision = 'a'.repeat(64), cutoff = '2026-11-14T12:00:00.000Z';
const row = (id: string, registeredAt: string | null) => ({ analyticsUserId: id.repeat(32), registeredAt });
function cohort(rows: CustomerCohort['rows'], asOf = cutoff, revision = policyRevision): CustomerCohort {
  return { policyRevision: revision, asOf, expiresAt: Date.now() + 60_000, rows,
    cacheKey: createHash('sha256').update(JSON.stringify([revision, rows])).digest('hex') };
}

describe('dated current-membership witness', () => {
  it('accepts only known registrations after the captured traversal cutoff', () => {
    const original = cohort([row('1', '2026-10-01T00:00:00.000Z')]);
    const witness = cohortSnapshotWitness(original)!;
    const addition = row('2', '2026-11-14T12:01:00.000Z');
    expect(cohortMatchesSnapshotWitness(cohort([...original.rows, addition], '2026-11-14T12:05:00.000Z'), witness)).toBe(true);
    expect(cohortMatchesSnapshotWitness(cohort([], '2026-11-14T12:05:00.000Z'), witness)).toBe(false);
    expect(cohortMatchesSnapshotWitness(cohort([addition], '2026-11-14T12:05:00.000Z'), witness)).toBe(false);
    expect(cohortMatchesSnapshotWitness(cohort([...original.rows, row('2', null)], '2026-11-14T12:05:00.000Z'), witness)).toBe(false);
    expect(cohortMatchesSnapshotWitness(cohort(original.rows, '2026-11-14T12:05:00.000Z', 'b'.repeat(64)), witness)).toBe(false);
    expect(cohortMatchesSnapshotWitness(cohort([row('1', '2026-10-02T00:00:00.000Z')], '2026-11-14T12:05:00.000Z'), witness)).toBe(false);
    expect(cohortMatchesSnapshotWitness(cohort(original.rows, '2026-11-14T11:00:00.000Z'), witness)).toBe(false);
  });
  it('does not produce a witness when registration time or digest is uncertain', () => {
    expect(cohortSnapshotWitness(cohort([row('1', null)]))).toBeNull();
    expect(cohortSnapshotWitness(cohort([row('1', '2026-11-14T12:01:00.000Z')]))).toBeNull();
    expect(cohortSnapshotWitness({ ...cohort([row('1', '2026-10-01T00:00:00.000Z')]), cacheKey: '0'.repeat(64) })).toBeNull();
  });
});
