import { currentAccess } from '../lib/access';
import { reportsRuntime } from '../lib/runtime';
import { reportDefinitions, reportingCalendarDay, type MetricValue, type ReportId } from '../../../src/server/reports/contracts';
import { ReportRefresh } from './report-refresh';

export default async function ReportsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const access = await currentAccess();
  if (!access) return <section className="welcome"><p className="eyebrow">Team reporting</p><h1>Understand what is working.</h1>
    <p>Sign in with your approved Google account to view product reports.</p>
    <a className="button" href="https://metrics.hussh.ai/api/auth/google">Continue with Google</a></section>;
  const query = await searchParams;
  const reportId: ReportId = typeof query.report === 'string' && Object.hasOwn(reportDefinitions, query.report)
    ? query.report as ReportId : 'one.adoption';
  // A date selection reads only an already published report. No source query.
  const now = Date.now(), timezone = query.timezone ?? 'UTC';
  let today = reportingCalendarDay('UTC', now);
  if (typeof timezone === 'string') {
    try { today = reportingCalendarDay(timezone, now); } catch { /* The report API rejects invalid timezones. */ }
  }
  const yesterday = new Date(Date.parse(today) - 86_400_000).toISOString().slice(0, 10);
  const request = { reportId, startDate: query.startDate ?? yesterday, endDate: query.endDate ?? yesterday, timezone };
  const runtime = reportsRuntime();
  const refreshRequest = typeof request.startDate === 'string' && typeof request.endDate === 'string' && typeof request.timezone === 'string'
    ? { ...request, startDate: request.startDate, endDate: request.endDate, timezone: request.timezone } : null;
  let view: Awaited<ReturnType<NonNullable<typeof runtime>['read']>> | null = null;
  try { if (runtime) view = await runtime.read(request, access); } catch { /* sanitized availability below */ }
  return <><p className="eyebrow">Team reporting</p><h1>Product performance</h1>
    <p className="intro">See how people use One and the website. Each report explains what it counts.</p>
    <form className="filters" method="get"><label>Report<select name="report" aria-label="Report" defaultValue={reportId}>
      <option value="one.adoption">One adoption</option><option value="hushhai.acquisition">Website acquisition</option>
      <option value="hushhai.activity">Website activity</option>
      <option value="metrics.reliability">Metrics service reliability</option>
    </select></label><label>From<input type="date" name="startDate" required defaultValue={typeof request.startDate === 'string' ? request.startDate : yesterday} /></label>
    <label>Through<input type="date" name="endDate" required defaultValue={typeof request.endDate === 'string' ? request.endDate : yesterday} /></label>
    <label>Reporting timezone<input name="timezone" required defaultValue={typeof request.timezone === 'string' ? request.timezone : 'UTC'} /></label>
    <button type="submit">Apply</button></form>
    <ReportRefresh key={JSON.stringify(refreshRequest)} request={refreshRequest} enabled={runtime !== null} />
    {!view?.report ? <section className="empty" role="status"><h2>Report unavailable</h2>
      <p>There is no verified report for these dates. Choose another period or check again after the report is saved.</p></section> :
      <><div className="report-meta"><span>{view.state === 'unknown_freshness' ? 'Source update time unknown' : view.state === 'stale' ? 'Older source data' : 'Published report'}</span>
        {(reportId === 'one.adoption' || reportId === 'hushhai.activity') && <span>{view.sourceEnvironment === 'uat' ? 'UAT test activity'
          : view.sourceEnvironment === 'production' ? 'Production activity' : 'Environment unverified'}</span>}
        <span>{view.report.request.startDate} – {view.report.request.endDate} · {view.report.request.timezone}</span></div>
      <section className="cards" aria-label="Report metrics">{(Object.entries(view.report.result.metrics) as [string, MetricValue][]).map(([key, metric]) =>
        <article key={key}><h2>{({ activeAccounts: 'Accounts with recorded activity', confirmedOutcomes: 'Confirmed task outcomes', sessions: 'Sessions', activeUsers: 'Active users', engagedSessions: 'Engaged sessions', keyEvents: 'Key events', pageViews: 'Recorded page-view events', searchSubmissions: 'Recorded search submissions', searchCompletions: 'Recorded search completions', searchFailures: 'Recorded search failures', ctaClicks: 'Recorded call-to-action clicks', requestCount: 'Recorded HTTP requests', serverErrorCount: 'Recorded HTTP 5xx responses', serverErrorRatio: 'Observed server error ratio', p95LatencyMs: '95th percentile latency' } as Record<string, string>)[key]}</h2>
          <strong>{metric.value === null ? 'Unavailable' : new Intl.NumberFormat('en', metric.unit === 'ratio' ? { style: 'percent', maximumSignificantDigits: 3 } : {}).format(metric.value)}</strong>
          <p>{metric.unit.replaceAll('_', ' ')} · {metric.coverage.replaceAll('_', ' ')}</p></article>)}</section>
      <section className="provenance"><h2>About these numbers</h2>
        <p>Definition {view.report.control.definitionVersion}. {reportId === 'one.adoption' ? 'Each eligible account counts once if it had a recorded One reply or a confirmed task outcome during these dates. Each verified task outcome counts once. Coverage is partial, so some activity may be missing.' : reportId === 'hushhai.activity' ? 'These are actions recorded by the website. Some activity may be missing, and a person can take more than one action.' : reportId === 'metrics.reliability' ? 'These counts include requests from staff, the API and health checks. The error rate needs a verified total request count. Response times need enough reliable data from the source.' : 'Google Analytics defines users and sessions. Registered accounts and confirmed outcomes are measured separately.'}</p>
        <dl><dt>{reportId === 'one.adoption' ? 'Source report time' : 'Data through'}</dt><dd>{view.report.result.sourceWatermark === null ? 'Unknown' : new Date(view.report.result.sourceWatermark).toISOString()}</dd>
          <dt>Published</dt><dd>{new Date(view.report.publishedAt).toISOString()}</dd></dl>
      </section></>}
  </>;
}
