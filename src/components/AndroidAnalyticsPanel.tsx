import type { OneAppSummary } from '../lib/types';
import { useMetricsResource } from '../lib/use-metrics-resource';
import { MetricsSkeleton, MetricsUpdateStatus } from './MetricsLoading';
import { ReportDetails } from './ReportControls';

const count = (value: number | null | undefined) => typeof value === 'number' ? value.toLocaleString('en-US') : 'Not available';

export function AndroidAnalyticsPanel({ one, environment = 'production' }: { one: OneAppSummary; environment?: 'production'|'uat' }) {
  const data = one.androidCapture;
  const startDate = one.range?.startDate;
  const endDate = one.range?.endDate;
  const resource = useMetricsResource<any>(startDate && endDate && environment === 'production' ? '/api/analytics/one/android?' + new URLSearchParams({ start_date: startDate, end_date: endDate }) : null, { refreshIntervalMs: 30_000 });
  const { data: report, loading, error } = resource;
  return <section className="mb-5 rounded-2xl border border-stroke bg-surface p-5" aria-label="Android app analytics">
    <h3 className="text-lg font-semibold">Android app analytics</h3>
    <p className="mt-1 text-xs text-muted">App usage from Firebase analytics. Store downloads are reported separately below.</p>
    {data?.state !== 'observed' && <p className="mt-3 text-sm" role="status">{data?.note ?? 'Android activity data is temporarily unavailable.'}</p>}
    {data?.state === 'observed' && <>
      <dl className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          ['Active signed-in accounts', data.identifiedAccounts], ['Active app IDs', data.activeAppIds],
          ['First opens / reinstalls', data.firstOpens], ['App screen visits', data.routeVisits],
        ].map(([label, value]) => <div key={String(label)}><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 text-2xl font-semibold">{count(value as number | null)}</dd></div>)}
      </dl>
    </>}
    <ReportDetails title="Android definitions & data sources">
      <p className="text-xs leading-5 text-muted">{data?.note}</p>
      {data?.state === 'observed' && <>
      <p className="mt-4 text-xs text-muted">{data.startDate} to {data.endDate} · GA4 reporting timezone {data.reportingTimezone}. Latest exported event: {data.latestEventAt ?? 'Unknown'}. Account rows across platforms can overlap.</p>
      <div className="mt-4 overflow-x-auto">
        <div className="metrics-table-scroll" role="region" aria-label="Scrollable metrics table" tabIndex={0}><table className="w-full text-left text-xs"><caption className="mb-2 text-left font-semibold">App versions and services used</caption>
          <thead><tr><th scope="col" className="py-2 pr-3">App version</th><th scope="col" className="pr-3">Installer</th><th scope="col" className="pr-3">Service environment</th><th scope="col" className="text-right">Events</th></tr></thead>
          <tbody>{data.releases.map((row, index) => <tr key={index} className="border-t border-stroke"><td className="py-2 pr-3">{row.version}</td><td className="pr-3">{row.installer === 'com.android.vending' ? 'Google Play' : row.installer === 'unknown' ? 'Unknown' : 'Other / sideload'}</td><td className="pr-3">{row.environment}</td><td className="text-right">{count(row.events)}</td></tr>)}</tbody>
        </table></div>
      </div>
      </>}
    <p className="mt-3 text-xs leading-5 text-muted">Screen activity and feature use below require the selected backend environment. Automatic first_open events without backend provenance cannot establish environment-specific installs or retention. Store downloads are separate; missing historical raw events are not reconstructed.</p>
    </ReportDetails>
    <MetricsUpdateStatus period={startDate && endDate ? `${startDate} to ${endDate}` : undefined} updatedAt={resource.updatedAt} loading={loading} refreshing={resource.refreshing} error={error} />
    {environment==='production' ? <AndroidProviderReport report={report} loading={loading} error={error} /> : <p className="mt-4 text-xs text-muted">Play Store and Android history reports are available in Main analytics.</p>}
  </section>;
}

const statusLabel = (state: string | undefined) => ({available:'Available',not_configured:'Not configured',permission_missing:'Read permission needed',not_yet_available:'Not yet available',sync_failed:'Source unavailable',privacy_limited:'Privacy limited'}[state ?? ''] ?? 'Source unavailable');
export function AndroidProviderReport({report,loading,error}: {report:any;loading?:boolean;error?:boolean}) {
  if(loading)return <MetricsSkeleton label="Loading Android history and Play reports" />;
  if(error)return <p className="mt-4 text-sm text-warning" role="status">Android history and Play reporting are temporarily unavailable. Existing app measurements remain visible.</p>;
  if(!report)return null;
  const history=report.history;
  const firstOpenRows=history?.daily?.filter((row:any)=>row.event==='first_open') ?? [];
  const firstOpens=history?.truncated || history?.state==='privacy_limited' || firstOpenRows.some((row:any)=>typeof row.events!=='number')
    ? null : firstOpenRows.reduce((sum:number,row:any)=>sum+row.events,0);
  return <div className="mt-5 space-y-5 border-t border-stroke pt-5">
    <section aria-label="Historical Android aggregate reporting">
      <h4 className="font-semibold">Android history · {statusLabel(history?.state)}</h4>
      {['available','privacy_limited'].includes(history?.state) && <>
        <dl className="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[
            ['GA4 active app users',history.activeUsers],['Tracked app users',history.trackedUsers],
            ['Recorded events',history.events],['First-open events',history.truncated ? null : firstOpens],
          ].map(([label,value])=><div key={String(label)}><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 text-2xl font-semibold">{count(value as number|null)}</dd></div>)}
        </dl>
        <p className="mt-3 text-xs text-muted">{report.range?.startDate} to {report.range?.endDate} · {history.source} · {history.timezone}. Unique range totals come directly from GA4; daily users are not added together.</p>
        {history.state==='privacy_limited'&&<p className="mt-2 text-xs text-warning">GA4 applied privacy thresholds. These values may omit low-volume activity.</p>}
        <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold">Daily first opens and product activity</summary>
          <div className="mt-3 max-h-72 overflow-auto"><div className="metrics-table-scroll" role="region" aria-label="Scrollable metrics table" tabIndex={0}><table className="w-full text-left text-xs"><thead><tr><th scope="col">Reporting date</th><th scope="col">Recorded activity</th><th scope="col" className="text-right">Events</th></tr></thead>
            <tbody>{(history.daily ?? []).map((row:any,index:number)=><tr key={index} className="border-t border-stroke"><td className="py-2">{row.date}</td><td>{row.event}</td><td className="text-right">{count(row.events)}</td></tr>)}</tbody></table></div></div>
        </details>
      </>}
      <p className="mt-3 text-xs leading-5 text-muted">{history?.note} GA4 history includes the app’s reported backend environments; it does not establish production-backend acquisition.</p>
    </section>
    <section aria-label="Google Play reporting"><h4 className="font-semibold">Google Play Store reporting</h4>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {[['Installs and uninstalls',report.downloads?.installs],['Store listing acquisition',report.downloads?.store]].map(([label,source]:any)=><article key={label} className="rounded-xl bg-canvas p-4"><h5 className="text-sm font-semibold">{label} · {statusLabel(source?.state)}</h5>
          {source?.state==='available'&&<dl className="mt-3 space-y-2">{Object.entries(source.totals ?? {}).map(([name,value])=><div key={name} className="flex justify-between gap-3 text-xs"><dt>{name}</dt><dd className="font-semibold">{count(value as number|null)}</dd></div>)}</dl>}
          <p className="mt-2 text-xs text-muted">{source?.note ?? 'A read-only Play report connection is required.'} {source?.dataThrough ? `Data through ${source.dataThrough}.` : ''}</p></article>)}
      </div>
      <p className="mt-3 text-xs text-muted">Play reports can lag by 3–7 days. Daily install flows, store listing visitors and Firebase app users have different definitions and must not be added or matched as individual people.</p>
      <h5 className="mt-4 text-sm font-semibold">Android vitals · {statusLabel(report.vitals?.state)}</h5>
      <p className="mt-2 text-xs text-muted">{report.vitals?.note}</p>
      {Object.entries(report.vitals?.metrics ?? {}).map(([name,source]:any)=><div key={name} className="mt-3 text-xs"><p className="font-semibold">{name==='userPerceivedCrashRate'?'User-perceived crash rate':'User-perceived ANR rate'} · {statusLabel(source.state)}</p>
        {source.state==='available'&&<ul className="mt-2 max-h-48 overflow-auto">{source.daily.map((row:any)=><li key={row.date} className="flex justify-between py-1"><span>{row.date}</span><span>{row.rate===null?'Not available':`${row.rate} (provider rate)`}</span></li>)}</ul>}</div>)}
    </section>
  </div>;
}
