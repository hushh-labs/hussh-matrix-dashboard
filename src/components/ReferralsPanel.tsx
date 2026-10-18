import { useState, type ReactNode } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { UsersRound, UserPlus, BadgeCheck, Coins } from 'lucide-react';
import { referralPointLabels, type ReferralEnvironment, type ReferralMetrics } from '../lib/referrals';
import { useMetricsResource } from '../lib/use-metrics-resource';
import { MetricsSkeleton, MetricsUpdateStatus } from './MetricsLoading';

const number = (value: number | null | undefined) => value == null ? '—' : value.toLocaleString('en-US');
const timestamp = (value: string | null | undefined) => value ? new Date(value).toLocaleString() : 'No records yet';

export function ReferralsPanel({ startDate, endDate, refreshKey, dateControl }: {
  startDate: string; endDate: string; refreshKey: number; dateControl: ReactNode;
}) {
  const [environment, setEnvironment] = useState<ReferralEnvironment>('production');
  const [retry, setRetry] = useState(0);
  const url = `/api/analytics/one/referrals?${new URLSearchParams({ environment, startDate, endDate })}`;
  const resource = useMetricsResource<ReferralMetrics>(url, { refreshKey: refreshKey + retry, refreshIntervalMs: 30_000 });
  const data = resource.data;
  const available = data?.state === 'available';
  const totals = available ? data.totals : null;
  const cards = [
    { label: 'Accounts who referred', value: totals?.referrers, icon: UsersRound, note: 'Distinct referrers with a registered referral in these dates.' },
    { label: 'Referred accounts', value: totals?.referredAccounts, icon: UserPlus, note: 'Registered accounts bound to a referral. Each account counts once.' },
    { label: 'Qualified referrals', value: totals?.qualified, icon: BadgeCheck, note: 'Referred accounts from these dates that are qualified now.' },
    { label: 'Net points earned', value: totals?.netPoints, icon: Coins, note: 'All program points posted in these dates, after reversals.' },
  ];
  return <main className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div role="group" aria-label="Referral environment" className="inline-flex rounded-lg border border-stroke bg-surface p-1">
        {(['production', 'uat'] as const).map(key => <button key={key} type="button" aria-pressed={environment === key}
          onClick={() => setEnvironment(key)} className={`min-h-10 rounded-md px-4 text-sm font-semibold ${environment === key ? 'bg-brand-500 text-white' : 'text-muted hover:text-ink'}`}>
          {key === 'production' ? 'Production' : 'UAT'}</button>)}
      </div>
      {dateControl}
    </div>
    <MetricsUpdateStatus period={`${startDate} to ${endDate} · UTC`} updatedAt={resource.updatedAt}
      loading={resource.loading} refreshing={resource.refreshing} error={resource.error} />
    {resource.loading ? <MetricsSkeleton label="Loading referral metrics" /> : <>
      {(!available || resource.error) && <div className="dashboard-card p-5 sm:p-6 flex flex-wrap items-center justify-between gap-3" role="status">
        <div><h2 className="font-semibold text-ink">{available ? 'Showing the last successful snapshot' : 'Referral metrics temporarily unavailable'}</h2>
          <p className="mt-1 text-sm text-muted">{available ? 'The source could not refresh. The snapshot time is shown above.' : 'Counts will appear when this source is available.'}</p></div>
        <button type="button" className="rounded-lg border border-stroke px-4 py-2 text-sm font-semibold text-ink" onClick={() => setRetry(value => value + 1)}>Try again</button>
      </div>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(card => <article className="dashboard-card p-5 sm:p-6" key={card.label}>
          <card.icon size={20} className="mb-4 text-brand-600" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-muted">{card.label}</h2>
          <p className="mt-2 text-3xl font-bold tracking-tight text-ink">{number(card.value)}</p>
          <p className="mt-3 text-xs leading-5 text-muted">{card.note}</p>
        </article>)}
      </div>
      <div className="dashboard-card p-5 sm:p-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Referral link opens', totals?.linkOpens, 'Opens recorded before sign-in; repeats can count.'],
          ['Pending qualification', totals?.pending, 'Accounts in this referral cohort still progressing.'],
          ['Net coins earned', totals?.netCoins, 'Program coins posted in these dates, after reversals.'],
          ['Accounts earning points', totals?.pointEarners, 'Distinct accounts receiving a positive points entry.'],
        ].map(([label, value, note]) => <div key={String(label)}><h3 className="text-xs font-semibold text-muted">{label}</h3>
          <p className="mt-2 text-2xl font-bold text-ink">{number(value as number | undefined)}</p><p className="mt-2 text-xs leading-5 text-muted">{note}</p></div>)}
      </div>
      {available && <>
        <section className="dashboard-card p-5 sm:p-6" aria-label="Daily referred accounts">
          <h2 className="text-lg font-semibold text-ink">Daily referred accounts</h2>
          <p className="mt-1 text-sm text-muted">Registered referrals by the date their attribution was bound · UTC</p>
          <div className="mt-6 h-64 min-w-0" role="img" aria-label="Daily registered referral trend">
            <ResponsiveContainer width="100%" height="100%"><AreaChart data={data.daily} margin={{ left: -20, right: 12 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--matrix-stroke)" />
              <XAxis dataKey="date" tickFormatter={date => date.slice(5)} minTickGap={28} tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} /><Tooltip />
              <Area type="monotone" dataKey="referredAccounts" name="Referred accounts" stroke="var(--matrix-brand-text)" fill="var(--matrix-brand-text)" fillOpacity={0.12} />
            </AreaChart></ResponsiveContainer>
          </div>
        </section>
        <div className="grid items-start gap-6 xl:grid-cols-2">
          <section className="dashboard-card p-5 sm:p-6"><h2 className="text-lg font-semibold text-ink">Points and coins</h2>
            <p className="mt-1 text-sm text-muted">Ledger entries in these dates, including app activity bonuses.</p>
            <div className="metrics-table-scroll mt-4"><table className="w-full text-sm" style={{ minWidth: 320 }}>
              <thead><tr className="text-muted"><th scope="col" className="py-3 pr-4 text-left">Activity</th><th scope="col" className="p-3 text-right">Points</th><th scope="col" className="py-3 text-right">Coins</th></tr></thead>
              <tbody>{data.points.map(row => <tr key={row.type} className="border-t border-stroke"><th scope="row" className="py-3 pr-4 text-left font-medium text-ink">{referralPointLabels[row.type] ?? 'Other program activity'}</th><td className="p-3 text-right text-ink">{number(row.points)}</td><td className="py-3 text-right text-ink">{number(row.coins)}</td></tr>)}</tbody>
            </table></div>{!data.points.length && <p className="py-5 text-sm text-muted">No points recorded in these dates.</p>}
          </section>
          <section className="dashboard-card p-5 sm:p-6"><h2 className="text-lg font-semibold text-ink">Rewards</h2>
            <p className="mt-1 text-sm text-muted">{number(totals?.milestonesEarned)} milestones earned by {number(totals?.rewardRecipients)} accounts in these dates. Lifetime referral thresholds come from the reward catalogue.</p>
            <div className="metrics-table-scroll mt-4"><table className="w-full text-sm" style={{ minWidth: 420 }}>
              <thead><tr className="text-muted"><th scope="col" className="py-3 pr-4 text-left">Reward</th><th scope="col" className="p-3 text-right">Referrals</th><th scope="col" className="p-3 text-right">Earned</th><th scope="col" className="py-3 text-right">Claimed</th></tr></thead>
              <tbody>{data.rewards.map((row,index) => <tr key={`${row.threshold}-${index}`} className="border-t border-stroke"><th scope="row" className="py-3 pr-4 text-left font-medium text-ink">{row.reward}</th><td className="p-3 text-right text-ink">{number(row.threshold)}</td><td className="p-3 text-right text-ink">{number(row.earned)}</td><td className="py-3 text-right text-ink">{number(row.claimed)}</td></tr>)}</tbody>
            </table></div>{!data.rewards.length && <p className="py-5 text-sm text-muted">No reward catalogue available.</p>}
            <p className="mt-4 text-xs leading-5 text-muted">Claimed means a claim was recorded; it does not mean the reward was delivered.</p>
            <h3 className="mt-5 text-sm font-semibold text-ink">Weekly awards · {number(totals?.weeklyAwards)}</h3>
            <p className="mt-2 text-xs leading-5 text-muted">{data.weeklyAwards.length ? data.weeklyAwards.map(row => `${row.status.replaceAll('_',' ')}: ${number(row.awards)}`).join(' · ') : 'No weekly awards recorded in these dates.'}</p>
          </section>
        </div>
        <details className="dashboard-card p-5 sm:p-6 text-sm text-muted"><summary className="cursor-pointer font-semibold text-ink">How referrals are counted</summary>
          <div className="mt-3 space-y-2 leading-6">
            <p>Source: the {environment === 'production' ? 'production' : 'UAT'} One app referral database. Latest source record: {timestamp(data.latestRecordAt)}. Queried: {timestamp(data.generatedAt)}.</p>
            <p>Referred accounts must have a registered profile and matching bound attribution. Self-referrals, rejected, revoked and ineligible relationships are excluded. An expired qualification window does not remove a valid signup.</p>
            <p>Account counts use stable account IDs, across all platforms. Repeated logins and devices do not add accounts. Production and UAT are separate reports and may contain the same accounts.</p>
            <p>Qualification is the current state of referrals registered in the selected period. Points, coins and rewards use their own posting or earning date, so they can relate to older referrals. These are program records, not cash payouts.</p>
          </div>
        </details>
      </>}
    </>}
  </main>;
}
