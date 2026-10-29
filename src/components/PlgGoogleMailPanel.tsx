import { useCallback, useEffect, useState } from 'react';
import type { PlgTemplate } from '../lib/plg';
import { dashboardCard } from '../lib/theme';
import { cn } from '../lib/utils';
import type { readOwnEvidence } from '../server/plg/own-evidence';

interface Status {
  email: string; connected: boolean; connectedAt: number | null; pending: boolean; deliveryObservation: string;
  reportReadingRequested?: boolean; feedbackAuthorized?: boolean; feedbackCheckedAt?: number | null; feedbackBacklog?: boolean;
}
interface Test { id: string; step: string; subject: string; status: string; createdAt: number; confirmedAt: number | null }
async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/plg/${path}`, { method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin', cache: 'no-store', signal,
    headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Mail connection unavailable.');
  return value;
}
export function PlgGoogleMailPanel({ templates, mailOwner = true }: { templates: PlgTemplate[]; mailOwner?: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [tests, setTests] = useState<Test[]>([]);
  const [selected, setSelected] = useState(templates[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [behaviour, setBehaviour] = useState<Awaited<ReturnType<typeof readOwnEvidence>> | null>(null);
  const [behaviourError, setBehaviourError] = useState('');
  const reload = useCallback(async (signal?: AbortSignal) => {
    if (!mailOwner) return;
    const [connection, receipts] = await Promise.all([
      api<Status>('google-mail/status', undefined, signal), api<{ tests: Test[] }>('mail-tests', undefined, signal),
    ]);
    if (!signal?.aborted) { setStatus(connection); setTests(receipts.tests); }
  }, [mailOwner]);
  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal).catch((e) => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [reload]);
  const action = async (fn: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'Mail action did not confirm success.'); }
    finally { setBusy(false); }
  };
  const button = 'rounded-xl border border-stroke px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50';
  return <section aria-label="Google work mailbox" className={cn(dashboardCard, 'p-5 sm:p-7')}>
    <details className="mb-5 rounded-xl border border-stroke p-4">
      <summary className="cursor-pointer font-semibold text-ink">Check my One activity</summary>
      <p className="mt-2 text-sm text-muted">Check confirmed Production actions for your signed-in work account. This check sends no email and keeps staff activity out of customer totals.</p>
      <button className={cn(button, 'mt-3')} disabled={busy} onClick={() => void action(async () => {
        setBehaviour(null); setBehaviourError('');
        try { setBehaviour(await api('my-behaviour')); }
        catch (e) { setBehaviourError(e instanceof Error ? e.message : 'Activity could not be verified.'); }
      })}>Check my activity</button>
      {behaviourError && <p role="alert" className="mt-2 text-sm text-muted">{behaviourError}</p>}
      {behaviour && <div className="mt-3 text-sm text-ink" aria-live="polite">
        <p>Checked {new Date(behaviour.checkedAt).toLocaleString()} · Production</p>
        <p className="mt-1 text-muted">{behaviour.captureEnabled && behaviour.captureEpochPresent
          ? 'Activity capture is enabled. Missing events do not prove inactivity.' : 'Current activity capture is unavailable.'}</p>
        {behaviour.positives.length ? <ul className="mt-2 space-y-1">{behaviour.positives.map(row => <li key={row.agentId}>
          {row.label}: {row.count} confirmed {row.count === 1 ? 'action' : 'actions'} · {new Date(row.lastAt).toLocaleString()}
          {!row.currentCapture && ' · outside current capture period'}
        </li>)}</ul> : <p className="mt-2">No confirmed actions found in this window. This does not prove inactivity.</p>}
      </div>}
    </details>
    {mailOwner && <><h3 className="text-lg font-semibold text-ink">Google work mailbox</h3>
    <p className="mt-2 text-sm text-muted">Connect i-neelesh@hushh.ai to send through Google Workspace. {status?.reportReadingRequested
      ? 'Customer automation requests sending and read-only mail access to reconcile Gmail submission records and structured failure reports. Report bodies are processed transiently and are not saved. This expands the earlier metadata-only grant and requires Google consent.'
      : 'Operator previews request sending and message metadata, including headers and labels, without bodies. Customer bounce handling must pass a separate release gate before customer sending is enabled.'} The grant is stored in Google Secret Manager.</p></>}
    {error && <p role="alert" className="mt-3 text-sm text-muted">{error}</p>}
    {status && <>
      <p className="mt-3 text-sm text-ink">{status.email}: {status.connected ? 'Authorization saved' : 'Not connected'}</p>
      {status.reportReadingRequested && <p className="mt-2 text-sm text-muted">
        Report-reading authorization: {status.feedbackAuthorized ? 'Granted' : 'Reconnect required'} · Last complete feedback poll: {status.feedbackCheckedAt ? new Date(status.feedbackCheckedAt).toLocaleString() : 'Not observed'} · {status.feedbackBacklog ? 'Catching up; customer sending held' : 'No recorded pending page'}.
      </p>}
      <div className="mt-4 flex flex-wrap gap-3">
        <button className={button} disabled={busy} onClick={() => void action(async () => {
          const result = await api<{ url: string }>('google-mail/connect', {});
          const url = new URL(result.url);
          if (url.origin !== 'https://accounts.google.com') throw new Error('Invalid Google connection destination.');
          window.location.assign(url.href);
        })}>{status.connected ? 'Reconnect Google mailbox' : 'Connect Google mailbox'}</button>
        {status.connected && <button className={button} disabled={busy} onClick={() => void action(async () => {
          await api('google-mail/disconnect', {}); await reload();
        })}>Disconnect mailbox</button>}
        <button className={button} disabled={busy} onClick={() => void action(() => reload())}>Check connection and receipts</button>
      </div>
      <p className="mt-4 text-sm text-muted">Operator previews go only to your work mailbox and stay outside customer enrollment, activity and campaign results. Each of the seven steps can be tested once per rolling day. An uncertain send is held for review and is not automatically repeated.</p>
      <label htmlFor="plg-test-template" className="mt-4 block text-sm text-ink">Preview message</label>
      <div className="mt-2 flex flex-wrap gap-3">
        <select id="plg-test-template" className="min-w-0 max-w-full rounded-xl border border-stroke bg-canvas p-2 text-sm text-ink" value={selected} onChange={(e) => setSelected(e.target.value)}>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.journey} · {t.step} · {t.subject}</option>)}
        </select>
        <button className={button} disabled={busy || !status.connected || !selected} onClick={() => void action(async () => {
          await api('mail-tests', { templateId: selected }); await reload();
        })}>Send preview to my work email</button>
      </div>
      <p className="mt-4 text-xs text-muted">Accepted means Gmail accepted the request. Inbox confirmed requires the exact test message in this mailbox’s inbox. Customer delivery, opens and product actions are never inferred from either status.</p>
      <ul className="mt-3 space-y-2 text-sm text-ink">{tests.slice(-14).reverse().map((test) => <li key={test.id}>
        <span className="font-medium">{test.step}</span> · {test.status.replaceAll('_', ' ')} · {new Date(test.createdAt).toLocaleString()}
      </li>)}</ul>
    </>}
  </section>;
}
