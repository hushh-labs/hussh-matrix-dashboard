import { currentAccess } from '../lib/access';
import { reportsRuntime } from '../lib/runtime';
import { reportDefinitions, type MetricValue, type ReportId } from '../../../src/server/reports/contracts';
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
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const request = { reportId, startDate: query.startDate ?? yesterday, endDate: query.endDate ?? yesterday, timezone: query.timezone ?? 'UTC' };
  const runtime = reportsRuntime();
  const refreshRequest = typeof request.startDate === 'string' && typeof request.endDate === 'string' && typeof request.timezone === 'string'
    ? { ...request, startDate: request.startDate, endDate: request.endDate, timezone: request.timezone } : null;
  let view: Awaited<ReturnType<NonNullable<typeof runtime>['read']>> | null = null;
  try { if (runtime) view = await runtime.read(request, access); } catch { /* sanitized availability below */ }
  return <><p className="eyebrow">Team reporting</p><h1>Product performance</h1>
    <p className="intro">Explore adoption and website engagement with clear definitions and source coverage.</p>
    <form className="filters" method="get"><label>Report<select name="report" aria-label="Report" defaultValue={reportId}>
      <option value="one.adoption">One adoption</option><option value="hushhai.acquisition">Website acquisition</option>
      <option value="hushhai.activity">Website activity</option>
    </select></label><label>From<input type="date" name="startDate" required defaultValue={typeof request.startDate === 'string' ? request.startDate : yesterday} /></label>
    <label>Through<input type="date" name="endDate" required defaultValue={typeof request.endDate === 'string' ? request.endDate : yesterday} /></label>
    <label>Reporting timezone<input name="timezone" required defaultValue={typeof request.timezone === 'string' ? request.timezone : 'UTC'} /></label>
    <button type="submit">Apply</button></form>
    <ReportRefresh key={JSON.stringify(refreshRequest)} request={refreshRequest} enabled={runtime !== null} />
    {!view?.report ? <section className="empty" role="status"><h2>Report unavailable</h2>
      <p>There is no verified publication for this selection. Try another period or check back after collection completes.</p></section> :
      <><div className="report-meta"><span>{view.state === 'unknown_freshness' ? 'Source freshness unknown' : view.state === 'stale' ? 'Older source information' : 'Published report'}</span>
        <span>{view.report.request.startDate} – {view.report.request.endDate} · {view.report.request.timezone}</span></div>
      <section className="cards" aria-label="Report metrics">{(Object.entries(view.report.result.metrics) as [string, MetricValue][]).map(([key, metric]) =>
        <article key={key}><h2>{({ activeAccounts: 'Active accounts', confirmedOutcomes: 'Confirmed outcomes', sessions: 'Sessions', activeUsers: 'Active users', engagedSessions: 'Engaged sessions', keyEvents: 'Key events', pageViews: 'Recorded page-view events', searchSubmissions: 'Recorded search submissions', searchCompletions: 'Recorded search completions', searchFailures: 'Recorded search failures', ctaClicks: 'Recorded call-to-action clicks' } as Record<string, string>)[key]}</h2>
          <strong>{metric.value === null ? 'Unavailable' : new Intl.NumberFormat('en').format(metric.value)}</strong>
          <p>{metric.unit.replaceAll('_', ' ')} · {metric.coverage.replaceAll('_', ' ')}</p></article>)}</section>
      <section className="provenance"><h2>About these numbers</h2>
        <p>Definition {view.report.control.definitionVersion}. {reportId === 'one.adoption' ? 'Identified accounts and confirmed business outcomes are counted separately. Missing observations do not establish inactivity.' : reportId === 'hushhai.activity' ? 'Accepted first-party event records, reconciled with source receipts. Capture coverage is partial. People, sessions and business outcomes have separate definitions.' : 'Google Analytics defines users and sessions. These measures do not establish registered accounts or completed business outcomes.'}</p>
        <dl><dt>Source information through</dt><dd>{view.report.result.sourceWatermark === null ? 'Unknown' : new Date(view.report.result.sourceWatermark).toISOString()}</dd>
          <dt>Published</dt><dd>{new Date(view.report.publishedAt).toISOString()}</dd></dl>
      </section></>}
  </>;
}
