import { describe, expect, it } from 'vitest';
import { validateReferralSource } from '../src/server/referrals';

describe('referral source environment boundary', () => {
  const production = { instance: 'hushh-pda:us-central1:hushh-vault-db', database: 'hushh_vault' };
  const uat = { instance: 'hushh-pda-uat:us-central1:hushh-uat-pg', database: 'postgres' };
  it('accepts only the selected environment database', () => {
    expect(() => validateReferralSource('production', production)).not.toThrow();
    expect(() => validateReferralSource('uat', uat)).not.toThrow();
    for (const [environment, source] of [['production', uat], ['uat', production], ['unknown', production], ['production', { ...production, database: 'postgres' }]] as const) {
      expect(() => validateReferralSource(environment, source)).toThrow('Referral source environment mismatch');
    }
  });
});
