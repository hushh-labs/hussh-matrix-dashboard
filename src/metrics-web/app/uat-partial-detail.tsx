import type { OneAgentDetailV1 } from '../../../src/lib/one-agent-detail-types';

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
    <table><thead><tr><th scope="col">Agent</th><th scope="col">Measurement</th><th scope="col">Recorded events</th><th scope="col">Devices</th><th scope="col">Reported success</th><th scope="col">Expected error records</th><th scope="col">Failed or unconfirmed</th></tr></thead>
      <tbody>{detail.rows.map(row=><tr key={`${row.agent}:${row.key}`}><td>{label(row.agent)}</td><td>{label(row.key)}</td>
        <td>{row.state==='measured' && row.counts ? count(row.counts.signals) : row.state==='not_tracked'?'Not tracked':'Unavailable'}</td>
        <td>{row.state==='measured' && row.counts ? count(row.counts.devices) : 'Unavailable'}</td>
        {(['successes','expectedErrors','failures'] as const).map(key=><td key={key}>{row.state==='measured' && row.counts && row.counts.outcomeSignals !== null && row.counts.outcomeSignals > 0 ? count(row.counts[key]) : 'Unavailable'}{key==='failures' && row.state==='measured' && row.counts && row.counts.outcomeSignals !== null && row.counts.outcomeSignals > 0 && (row.key==='sms_contact_add' || row.key==='sms_contact_remove') ? ' (not confirmed)' : ''}</td>)}
      </tr>)}</tbody></table>
    <p>Outcome counts are unavailable when no result was reported. For emergency contact changes, “not confirmed” does not establish that the server made no change. A successful SOS event does not prove carrier SMS delivery. Calendar response records do not prove acceptance, decline or organizer email delivery.</p>
  </section>;
}
