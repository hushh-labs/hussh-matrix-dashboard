import { expect, it } from 'vitest';
import { buildUatFeaturePlan } from '../src/server/uat-one-feature-plan';
const config={project:'hushh-pda-uat',dataset:'analytics_533362555',webHost:'uat.one.hushh.ai',timezone:'UTC',
 startDate:'2026-11-18',endDate:'2026-11-18',maxPeriodDays:7};
it('builds the fixed UAT surface and deduplicated daily/intraday suffix plan',()=>{
 const p=buildUatFeaturePlan(config);
 expect(p.environment).toBe('uat');expect(p.query).toContain('`hushh-pda-uat.analytics_533362555.events_*`');
 expect(p.query).toContain("_TABLE_SUFFIX IN ('20261118', 'intraday_20261118')");
 expect(p.query).toContain('INFORMATION_SCHEMA.TABLES');expect(p.query).toContain("= 'uat'");
 expect(p.query).not.toContain("'one.hushh.ai'");
});
it('rejects non-UAT, invalid identity, date and unapproved range',()=>{
 for (const change of [{project:'hushh-ai-prod'},{webHost:'one.hushh.ai'},{dataset:'analytics_1`; DROP TABLE x'},
   {startDate:'2026-02-30'},{startDate:'2026-11-01'},{maxPeriodDays:91}]) expect(()=>buildUatFeaturePlan({...config,...change})).toThrow();
});
