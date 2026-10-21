import { Pause, Play, RefreshCw } from 'lucide-react';
import type { PlgAutomationStatus } from '../lib/plg';
import { dashboardCard } from '../lib/theme';
import { cn } from '../lib/utils';

const time = (value: string | null) => value ? new Date(value).toLocaleString() : 'Not observed';
export function PlgAutomationPanel({ status, admin, busy, toggle, refresh }: {
  status: PlgAutomationStatus;
  admin: boolean;
  busy: boolean;
  toggle: (enabled: boolean) => void;
  refresh: () => void;
}) {
  const button = 'inline-flex items-center justify-center gap-2 rounded-xl border border-stroke px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50';
  return <section aria-label="Automatic follow-up operations" className={cn(dashboardCard, 'p-5 sm:p-7')}>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h3 className="text-lg font-semibold text-ink">Automatic follow-ups</h3>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">The scheduled worker syncs One evidence, checks permissions and message limits, then sends eligible published messages. Pausing stops future sends; evidence sync continues.</p>
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
        ['Automatic follow-ups', status.enabled ? 'Enabled' : 'Paused'],
        ['Worker heartbeat', status.worker === 'never_observed' ? 'Never observed' : status.worker === 'stale' ? 'Stale; check scheduler' : 'Recently observed'],
        ['Last catalog/source refresh', time(status.lastSyncAt)],
        ['Last enrolled-account evidence read', time(status.lastEvidenceSyncAt ?? null)],
        ['Last completed cycle', time(status.lastSuccessAt)],
        ['From', status.sender.from ?? 'Not configured'],
        ['Reply-To', status.sender.replyTo ?? 'Not configured'],
        ['Messages eligible now', String(status.eligible)],
        ['Delivery confirmations pending', String(status.needsReconciliation)],
      ].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 break-words font-medium text-ink">{value}</dd></div>)}
    </dl>
    <p className="mt-4 text-xs leading-5 text-muted">A fresh heartbeat or catalog refresh does not prove enrolled-account evidence sync or email delivery is working. Only an actual cohort evidence read advances its separate timestamp.</p>
    <p className="mt-4 text-xs leading-5 text-muted">Sender configuration {status.sender.configured ? 'is present' : 'is incomplete'}. Domain verification and a controlled delivery test are separate launch checks. Reply-To routes replies to the mailbox; automatic inbox handling is not connected.</p>
    {status.lastCycle && <p className="mt-4 rounded-xl bg-canvas p-3 text-sm text-ink">
      Last cycle: {status.lastCycle.status} · {status.lastCycle.accounts} accounts synced · {status.lastCycle.sent ?? 'Unknown count'} accepted by email provider · {status.lastCycle.uncertain ?? 'Unknown count'} uncertain.
      {status.lastCycle.reason && <span className="mt-1 block text-muted">{status.lastCycle.reason}</span>}
    </p>}
    {status.blockers.length > 0 && <div className="mt-4 rounded-xl border border-stroke p-4">
      <h4 className="text-sm font-semibold text-ink">Setup and operation blockers</h4>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">{status.blockers.map((reason) => <li key={reason}>{reason}</li>)}</ul>
    </div>}
    <details className="mt-4 text-sm text-muted">
      <summary className="cursor-pointer font-medium text-ink">Eligibility and pilot capacity</summary>
      <p className="mt-3">{status.capacity.contacts}/{status.capacity.maxContacts} enrolled accounts · {Math.ceil(status.capacity.bytes / 1000)}/{status.capacity.maxBytes / 1000} KB storage. Registered people are not automatically subscribed; recorded messaging permission is required.</p>
      <ul className="mt-3 space-y-1">{status.blockedReasons.map((row) => <li key={row.reason}>{row.accounts} accounts: {row.reason}</li>)}</ul>
      <p className="mt-3">Missing or partial activity stays unknown. Behavioral inactivity reminders require complete fresh observations. Provider acceptance and delivery are separate from verified product value.</p>
    </details>
  </section>;
}
