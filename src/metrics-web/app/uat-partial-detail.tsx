import type { OneAgentDetailV1 } from '../../../src/server/reports/one-agent-detail-contract';

/** Presentation only. A future caller must supply an authorized verified
 * publication; this component performs no network or collection work. */
export function UatPartialDetail({detail,computedAt}:{detail:OneAgentDetailV1;computedAt:number}) {
  if (detail.environment!=='uat' || !Number.isSafeInteger(computedAt) || computedAt<0 || !Number.isFinite(new Date(computedAt).getTime()))
    return <section role="status">UAT report unavailable.</section>;
  const label=(value:string)=>value.replaceAll('_',' ');
  const count=(value:number|null)=>value===null?'Unavailable':new Intl.NumberFormat('en').format(value);
  return <section aria-label="UAT agent activity">
    <h2>UAT agent activity · partial report</h2>
    <p>{detail.period.startDate} – {detail.period.endDate} · {detail.period.timezone}</p>
    <p>Source freshness is unknown. The report was computed {new Date(computedAt).toISOString()}.</p>
    <p>Recorded events can include repeated actions and outcomes. Missing or unavailable measurements do not establish zero activity. Location and other sections may require separate sources.</p>
    <table><thead><tr><th scope="col">Agent</th><th scope="col">Measurement</th><th scope="col">Recorded events</th><th scope="col">Devices</th></tr></thead>
      <tbody>{detail.rows.map(row=><tr key={`${row.agent}:${row.key}`}><td>{label(row.agent)}</td><td>{label(row.key)}</td>
        <td>{row.state==='measured' && row.counts ? count(row.counts.signals) : row.state==='not_tracked'?'Not tracked':'Unavailable'}</td>
        <td>{row.state==='measured' && row.counts ? count(row.counts.devices) : 'Unavailable'}</td></tr>)}</tbody></table>
  </section>;
}
