import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { UatPartialDetail } from '../src/metrics-web/app/uat-partial-detail';
import { adaptUatFeatureRows } from '../src/server/reports/uat-feature-rows';
const expected={scopeDigest:'a'.repeat(64),period:{startDate:'2026-11-18',endDate:'2026-11-18',timezone:'UTC'}};
it('labels a UAT subset, unknown freshness and missing measurements without source calls',()=>{
 const detail=adaptUatFeatureRows([],expected), html=renderToStaticMarkup(<UatPartialDetail detail={detail} computedAt={Date.parse('2026-11-19T12:00:00Z')}/>);
 expect(html).toContain('UAT agent activity · partial report');expect(html).toContain('Source freshness is unknown');
 expect(html).toContain('2026-11-18');expect(html).toContain('Unavailable');expect(html).not.toContain(expected.scopeDigest);
});
it('does not display production data as UAT and distinguishes null from numeric zero',()=>{
 const detail=adaptUatFeatureRows([],expected), item=detail.rows.find(row=>row.agent!=='location')!;
 item.state='measured';item.counts={accounts:null,devices:null,signals:0,successes:null,expectedErrors:null,failures:null,outcomeSignals:null};
 const html=renderToStaticMarkup(<UatPartialDetail detail={detail} computedAt={1}/>);
 expect(html).toContain('>0</td>');expect(html).toContain('Unavailable');
 expect(renderToStaticMarkup(<UatPartialDetail detail={{...detail,environment:'production'}} computedAt={1}/>)).toContain('UAT report unavailable');
});
