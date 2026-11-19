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
 expect(html).toContain('Reported success');expect(html).toContain('Expected error records');
 expect(html).toContain('does not prove carrier SMS delivery');expect(html).toContain('do not prove acceptance, decline or organizer email delivery');
 expect(html).toContain('>0</td>');expect(html).toContain('Unavailable');
 expect(renderToStaticMarkup(<UatPartialDetail detail={{...detail,environment:'production'}} computedAt={1}/>)).toContain('UAT report unavailable');
});
it('shows reported outcomes, preserves zero and null, and does not invent action-only outcomes',()=>{
 const detail=adaptUatFeatureRows([],expected);
 const contact=detail.rows.find(row=>row.key==='sms_contact_add')!;
 contact.state='measured';contact.counts={accounts:null,devices:2,signals:3,successes:2,expectedErrors:0,failures:1,outcomeSignals:3};
 const other=detail.rows.find(row=>row.agent!=='location' && row.key!=='calendar_invitation_response')!;
 other.state='measured';other.counts={accounts:null,devices:1,signals:1,successes:null,expectedErrors:0,failures:0,outcomeSignals:1};
 const calendar=detail.rows.find(row=>row.key==='calendar_invitation_response')!;
 calendar.state='measured';calendar.counts={accounts:null,devices:1,signals:1,successes:0,expectedErrors:0,failures:0,outcomeSignals:0};
 const html=renderToStaticMarkup(<UatPartialDetail detail={detail} computedAt={1}/>);
 const contactRow=html.match(/<tr><td>location<\/td><td>sms contact add<\/td>.*?<\/tr>/)?.[0] ?? '';
 expect(contactRow).toContain('<td>2</td><td>0</td><td>1 (not confirmed)</td>');
 const otherRow=html.match(new RegExp(`<tr><td>${other.agent}</td><td>${other.key.replaceAll('_',' ')}</td>.*?</tr>`))?.[0] ?? '';
 expect(otherRow).toContain('<td>Unavailable</td><td>0</td><td>0</td>');
 const calendarRow=html.match(/<tr><td>calendar<\/td><td>calendar invitation response<\/td>.*?<\/tr>/)?.[0] ?? '';
 expect(calendarRow).toContain('<td>Unavailable</td><td>Unavailable</td><td>Unavailable</td>');
});
