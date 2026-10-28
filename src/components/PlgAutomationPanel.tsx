import { Pause, Play, RefreshCw } from 'lucide-react';
import type { PlgAutomationStatus } from '../lib/plg';
import { dashboardCard } from '../lib/theme';
import { cn } from '../lib/utils';

const time = (value: string | number | null) => value ? new Date(value).toLocaleString() : 'Not observed';
export function PlgAutomationPanel({ status, deliveryEnabled, admin, busy, checkedAt, toggle, refresh }: {
  status: PlgAutomationStatus;
  deliveryEnabled: boolean;
  admin: boolean;
  busy: boolean;
  checkedAt?: number | null;
  toggle: (enabled: boolean) => void;
  refresh: () => void;
}) {
  const blockers = status.blockers.filter((reason) => status.capacity.contacts !== 0 || reason !== 'No permission-backed accounts are enrolled');
  const googleFeedback = status.emailFeedback;
  const button = 'inline-flex items-center justify-center gap-2 rounded-xl border border-stroke px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50';
  return <section aria-label="Automatic follow-up operations" className={cn(dashboardCard, 'p-5 sm:p-7')}>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h3 className="text-lg font-semibold text-ink">Automatic follow-ups</h3>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">Scheduled checks send published messages only when account permission, activity and message limits allow it.</p>
        {checkedAt != null && <p className="mt-2 text-xs text-muted">Status checked {time(checkedAt)}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={busy} onClick={refresh}><RefreshCw size={15} />Refresh status</button>
        {admin && <button className={button} disabled={busy} onClick={() => toggle(!status.enabled)}>
          {status.enabled ? <Pause size={15} /> : <Play size={15} />}
          {status.enabled ? 'Pause automatic follow-ups' : 'Enable automatic follow-ups'}
        </button>}
      </div>
    </div>
    <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
      {[
        ['Scheduled checks', status.enabled ? 'On' : 'Paused'],
        ['Customer email delivery', deliveryEnabled ? 'Enabled; eligibility checks apply' : 'Off'],
        ['Messages eligible now', String(status.eligible)],
        ['Enrolled accounts', String(status.capacity.contacts)],
        ['From', status.sender.from ?? 'Not configured'],
        ['Reply-To', status.sender.replyTo ?? 'Not configured'],
      ].map(([label, value]) => <div key={label} className={cn('min-w-0', (label === 'From' || label === 'Reply-To') && 'xl:col-span-2')}><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 break-words font-medium text-ink">{value}</dd></div>)}
    </dl>
    {blockers.length > 0 && <div className="mt-4 rounded-xl border border-stroke p-4">
      <h4 className="text-sm font-semibold text-ink">Needs attention before sending</h4>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">{blockers.map((reason) => <li key={reason}>{reason}</li>)}</ul>
    </div>}
    {status.capacity.contacts === 0 && <p className="mt-4 text-sm text-muted">Waiting for the first account with recorded email permission. Registration alone does not subscribe someone.</p>}
    <details className="mt-4 text-sm text-muted">
      <summary className="cursor-pointer font-medium text-ink">Delivery and activity details</summary>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        {[
          ['Worker heartbeat', status.worker === 'never_observed' ? 'Never observed' : status.worker === 'stale' ? 'Stale; check scheduler' : 'Recently observed'],
          ['Last catalog/source refresh', time(status.lastSyncAt)],
          ['Last enrolled-account evidence read', time(status.lastEvidenceSyncAt ?? null)],
          ['Last completed cycle', time(status.lastSuccessAt)],
          ['Delivery confirmations pending', String(status.needsReconciliation)],
        ].map(([label, value]) => <div key={label}><dt className="text-xs">{label}</dt><dd className="mt-1 text-ink">{value}</dd></div>)}
      </dl>
      {googleFeedback ? <p className="mt-3">Google bounce checks: {googleFeedback.authorized ? 'Read permission granted' : 'Read permission required'} · Last complete check: {time(googleFeedback.checkedAt)} · {googleFeedback.backlog ? 'Catching up; customer sending held' : 'No pending page recorded'}. Gmail polling reads structured failure reports; signed webhooks are not required.</p>
        : <p className="mt-3">Email connection details are unavailable. Check the configured email connection before sending.</p>}
      <p className="mt-3">Replies go to the Reply-To mailbox. Provider acceptance and verified inbox receipts are separate checks; external delivery and opens are not inferred.</p>
      <p className="mt-3">A heartbeat or catalog refresh does not confirm account evidence or email delivery. Pausing scheduled checks stops future automatic sends; evidence sync continues.</p>
      {status.lastCycle && <div className="mt-3">
        <p>Last cycle ({time(status.lastCycle.finishedAt ?? status.lastCycle.startedAt)}): {status.lastCycle.status} · {status.lastCycle.accounts} accounts synced · {status.lastCycle.sent ?? 'Unknown count'} accepted by email provider · {status.lastCycle.uncertain ?? 'Unknown count'} uncertain.</p>
        {status.lastCycle.reason && <p className="mt-1">Recorded reason for that cycle: {status.lastCycle.reason}</p>}
      </div>}
    </details>
    <details className="mt-4 text-sm text-muted">
      <summary className="cursor-pointer font-medium text-ink">Eligibility and enrollment</summary>
      <p className="mt-3">{status.capacity.maxContacts === null
        ? `${status.capacity.contacts} enrolled accounts. No pilot enrollment limit.`
        : `${status.capacity.contacts}/${status.capacity.maxContacts} enrolled accounts · ${Math.ceil(status.capacity.bytes / 1000)}/${(status.capacity.maxBytes ?? 0) / 1000} KB storage.`}
        {' '}Registered people are not automatically subscribed; recorded messaging permission is required.</p>
      <ul className="mt-3 space-y-1">{status.blockedReasons.map((row) => <li key={row.reason}>{row.accounts} accounts: {row.reason}</li>)}</ul>
      <p className="mt-3">Missing or partial activity stays unknown. Behavioral inactivity reminders require complete fresh observations. Provider acceptance and delivery are separate from verified product value.</p>
    </details>
  </section>;
}
