import { useState } from 'react';
import { useMetricsResource } from '../lib/use-metrics-resource';
import { exactCount } from '../lib/feature-measurement';
import { dashboardCard } from '../lib/theme';
import { cn } from '../lib/utils';
import type { OneAppSummary } from '../lib/types';

interface AppResponse {
  environment?: string;
  data?: { production: OneAppSummary | null; uat: OneAppSummary | null };
  error?: string | null;
  fetchedAt?: string;
}
const count = (value: number | null | undefined) => value == null ? 'Unavailable' : exactCount(value);
const timestamp = (value?: string | null) => value && Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleString() : 'Not available';

/** Aggregate authority is shared with One analytics; never derive app totals from audience pages. */
export function PlgAppUsage({ refreshKey = 0 }: { refreshKey?: number }) {
  const [days, setDays] = useState(30);
  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = new Date(Date.parse(endDate) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const url = `/api/analytics/one/app?environment=production&one_start_date=${startDate}&one_end_date=${endDate}`;
  const resource = useMetricsResource<AppResponse>(url, { refreshKey });
  const one = resource.data?.data?.production;
  const production = resource.data?.environment === 'production' && resource.data?.data?.uat === null
    && one?.reportingEnvironment === 'production' ? one : null;
  const registry = production?.registeredAccounts;
  const registryValid = registry?.available && registry.registryScope === 'isolated' &&
    !registry.sharedAcrossEnvironments && registry.environment === 'production';
  const device = production?.activeUsers;
  const accounts = production?.identifiedUsers;
  const deviceValid = device?.available === true;
  const accountValid = accounts?.activityAvailable === true;
  const rangeValid = accounts?.selectedRange.available === true;
  const tiles = [
    { label: 'Registered accounts', value: registryValid ? registry.totalAccounts : null },
    { label: 'New registered accounts', value: registryValid ? registry.newAccounts : null },
    { label: 'Active signed-in accounts in period', value: rangeValid ? accounts.selectedRange.totalUsers : null },
  ];
  const activityRows = [
    { label: 'Signed-in accounts', values: accountValid ? accounts : null },
    { label: 'Device/browser IDs', values: deviceValid ? device : null },
  ];
  return (
    <section aria-label="App-wide One usage" className={cn(dashboardCard, 'space-y-5 p-5 sm:p-6')} aria-busy={resource.loading || resource.refreshing}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-ink">App-wide One usage</h3>
          <p className="mt-1 max-w-2xl text-sm text-muted">Production only: account and device aggregates, including people outside email campaigns. UAT is never queried or used as a fallback. These are separate from the enrolled campaign results below.</p>
        </div>
        <label className="text-sm font-semibold text-muted">Reporting period
          <select className="ml-2 rounded-lg border border-stroke bg-surface p-2 text-ink" value={days} onChange={(event) => setDays(Number(event.target.value))}>
            {[7, 30, 90].map((value) => <option key={value} value={value}>Last {value} days</option>)}
          </select>
        </label>
      </div>
      {resource.loading ? <p role="status" className="text-sm text-muted">Loading app-wide measurements…</p> : <>
        {(resource.error || resource.data?.error) && <p role="status" className="text-sm text-warning">Some source reads failed or could not refresh. Each metric keeps its own availability; the snapshot time below may precede this request.</p>}
        {!production && <p role="status" className="text-sm text-muted">Production aggregates are unavailable. No zero is inferred.</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {tiles.map(({ label, value }) => <div key={label} className="rounded-xl border border-stroke p-4">
            <p className="text-sm text-muted">{label}</p><p className="mt-2 text-2xl font-semibold text-ink">{count(value)}</p>
          </div>)}
        </div>
        <div className="metrics-table-scroll">
          <table className="w-full min-w-[430px] text-left text-sm">
            <caption className="pb-3 text-left text-muted">Activity through {deviceValid ? device.asOf : accountValid ? accounts.asOf : 'an unavailable measurement day'} · latest finalized GA4 day, with 7-day and 30-day lookbacks.</caption>
            <thead><tr>{['Counting unit', 'DAU', 'WAU', 'MAU'].map((label) => <th key={label} className="border-b border-stroke p-3">{label}</th>)}</tr></thead>
            <tbody>{activityRows.map(({ label, values }) => <tr key={label}>
              <th className="p-3 font-medium">{label}</th>
              {(['dau', 'wau', 'mau'] as const).map((key) => <td className="p-3 tabular-nums" key={key}>{count(values?.[key])}</td>)}
            </tr>)}</tbody>
          </table>
        </div>
        <p className="text-xs leading-5 text-muted">Requested dates: {startDate} to {endDate}. Read at {timestamp(resource.updatedAt || resource.data?.fetchedAt)}. Registry snapshot: {timestamp(registry?.generatedAt)}.</p>
        <p className="text-xs leading-5 text-muted">Registered accounts come from the current verified environment registry, including disabled accounts; deleted accounts are absent. Active signed-in accounts count stable account IDs across devices where tagging exists; untagged activity is excluded. Device IDs count separately and cannot be added to accounts. DAU is measured activity, not a sign-in count or verified task completion. These sources do not establish signup-to-activation conversion or email attribution.</p>
      </>}
    </section>
  );
}
