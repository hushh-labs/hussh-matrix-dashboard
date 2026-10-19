import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useState,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  CheckCircle2,
  ChevronRight,
  LockKeyhole,
  Mail,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Users,
  Workflow,
  X,
} from 'lucide-react';
import {
  plgStageLabels,
  plgJourneyOptions,
  plgJourneyLabel,
  type PlgContact,
  type PlgTemplate,
  type PlgWorkspace as Workspace,
} from '../lib/plg';
import { cn } from '../lib/utils';
import { dashboardCard } from '../lib/theme';
import { PlgAgentActivityPanel, type PlgActivityInspection } from './PlgAgentActivityPanel';

async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/plg/${path}`, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'The PLG workspace is unavailable.');
  return value;
}
const inputStyle =
  'w-full rounded-xl border border-stroke bg-canvas px-3 py-2.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/40';
const buttonStyle =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-stroke bg-surface px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50';
const date = (value: string | null) =>
  value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Not observed';
function Field({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="block space-y-1.5 text-xs font-semibold text-muted">
      <label className="block" htmlFor={id}>
        {label}
      </label>
      {cloneElement(children as ReactElement<{ id?: string }>, { id })}
    </div>
  );
}

export function PlgWorkspace({ refreshKey = 0 }: { refreshKey?: number }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'queue' | 'content' | 'results' | 'agents'>('queue');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<PlgTemplate | null>(null);
  const [preview, setPreview] = useState<{
    messages: {
      contactId: string;
      subject: string;
      body: string;
      ctaLabel: string;
      ctaUrl: string;
      resourceUrl?: string;
    }[];
    candidates: { eligible: boolean }[];
  } | null>(null);
  const reload = useCallback(async () => {
    try {
      setWorkspace(await api<Workspace>('workspace'));
      setError('');
    } catch (e) {
      setWorkspace(null);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);
  async function mutate(path: string, method: string, body: unknown) {
    setBusy(true);
    setError('');
    try {
      await api(path, method, body);
      await reload();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <div className={cn(dashboardCard, 'p-10 text-center text-muted')} aria-busy="true">
        <RefreshCw className="mx-auto mb-3 animate-spin" size={24} />
        Opening the private workspace
      </div>
    );
  if (!workspace)
    return (
      <section className={cn(dashboardCard, 'mx-auto max-w-2xl p-8 sm:p-12')}>
        <LockKeyhole size={30} className="mb-5 text-muted" />
        <h2 className="text-2xl font-semibold text-ink">Private PLG workspace</h2>
        <p className="mt-3 text-sm leading-6 text-muted">
          Follow-up queues and individual subscriber details require an explicitly authorized PLG account.
        </p>
        <p role="status" className="mt-5 rounded-xl bg-canvas p-4 text-sm text-ink">
          {error}
        </p>
        <button className={cn(buttonStyle, 'mt-5')} onClick={() => void reload()}>
          <RefreshCw size={16} />
          Check access again
        </button>
      </section>
    );
  const { state, metrics, queue, role } = workspace;
  const admin = role === 'admin';
  const person = state.contacts.find((c) => c.id === selected);
  const contacts = state.contacts.filter(
    (c) =>
      `${c.name} ${c.email} ${c.owner}`.toLowerCase().includes(query.toLowerCase()) &&
      (filter === 'all' ||
        (filter === 'assistance'
          ? c.supportOpen || Boolean(c.failedAt && !c.lastValueAt)
          : filter === 'due'
            ? queue.find((q) => q.contactId === c.id)?.eligible
            : !c.telemetryAt)),
  );
  const updateSettings = async (patch: Partial<typeof state>) => {
    const before = workspace;
    const next = { paused: state.paused, ready: state.ready, ...patch };
    setWorkspace({ ...workspace, state: { ...state, ...next } });
    const saved = await mutate('settings', 'PATCH', next);
    if (!saved) setWorkspace(before);
    return saved;
  };
  return (
    <div className="space-y-6">
      <section className={cn(dashboardCard, 'overflow-hidden')}>
        <div className="flex flex-wrap items-start justify-between gap-4 p-5 sm:p-7">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              One activation and retention
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-ink">
              Help users reach their next useful result
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
              A shared queue for the PLG team, with guided tasks, relevant content and follow-ups based on
              verified progress.
            </p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border border-stroke px-3 py-1.5 text-xs font-semibold text-muted">
            <LockKeyhole size={13} />
            Private · {role}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stroke bg-canvas px-5 py-4 sm:px-7">
          <div className="flex items-center gap-2 text-sm font-medium text-ink">
            {state.paused ? <Pause size={16} /> : <Play size={16} />}
            {state.paused ? 'Campaigns paused' : 'Campaigns enabled'}
            <span className="text-muted">·</span>
            <span className="text-muted">
              {workspace.deliveryEnabled ? 'Delivery configured' : 'Live sending disabled'}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className={buttonStyle}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  setPreview(await api('preview', 'POST', {}));
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Mail size={16} />
              Preview next messages
            </button>
            {admin && (
              <button
                className={buttonStyle}
                disabled={busy}
                onClick={() => void updateSettings({ paused: !state.paused })}
              >
                {state.paused ? 'Enable journeys' : 'Pause journeys'}
              </button>
            )}
          </div>
        </div>
      </section>
      {error && (
        <div role="alert" className="rounded-xl border border-stroke bg-surface p-4 text-sm text-warning">
          {error}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          [Users, 'Enrolled accounts', metrics.enrolled],
          [Workflow, 'Activity observed', metrics.observed],
          [CheckCircle2, 'First value reached', metrics.activated],
          [RefreshCw, 'Returned on another day', metrics.repeat],
        ].map(([Icon, label, value]) => {
          const Symbol = Icon as typeof Users;
          return (
            <div key={String(label)} className={cn(dashboardCard, 'p-5')}>
              <Symbol size={18} className="mb-3 text-muted" />
              <p className="text-xs text-muted">{String(label)}</p>
              <p className="mt-1 text-3xl font-semibold text-ink">{String(value)}</p>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="PLG views">
        {(
          [
            ['queue', 'Follow-up queue'],
            ['content', 'Journeys and content'],
            ['results', 'Results and activity'],
            ['agents', 'Agents and actions'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(buttonStyle, tab === key && 'border-ink bg-ink text-surface hover:bg-ink')}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'agents' && <PlgAgentActivityPanel state={state} busy={busy}
        refresh={() => void mutate('sync', 'POST', {})}
        inspect={(contactId) => api<PlgActivityInspection>('activity', 'POST', { contactId })} />}
      {tab === 'queue' && (
        <section className={cn(dashboardCard, 'p-5 sm:p-6')}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-ink">Today’s follow-up queue</h3>
              <p className="mt-1 text-sm text-muted">
                Prioritize assistance, setup blockers and relevant next tasks.
              </p>
            </div>
            <button
              className={buttonStyle}
              onClick={() => {
                setAdding((v) => !v);
                setSelected(null);
              }}
            >
              <Plus size={16} />
              Enroll account
            </button>
          </div>
          {adding && (
            <form
              className="mt-5 grid gap-4 rounded-2xl border border-stroke bg-canvas p-5 sm:grid-cols-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const data = new FormData(form);
                if (
                  await mutate('contacts', 'POST', {
                    accountId: data.get('accountId'),
                    email: data.get('email'),
                    name: data.get('name'),
                    journey: data.get('journey'),
                    cohort: data.get('cohort'),
                    frequency: data.get('frequency'),
                    consent: data.get('consent') === 'on',
                    consentSource: data.get('consentSource'),
                    environment: 'production',
                    internal: false,
                  })
                ) {
                  setAdding(false);
                  form.reset();
                }
              }}
            >
              <Field label="Firebase account UID">
                <input required name="accountId" maxLength={128} className={inputStyle} />
              </Field>
              <Field label="Email address">
                <input required type="email" name="email" maxLength={254} className={inputStyle} />
              </Field>
              <Field label="Display name">
                <input name="name" maxLength={100} className={inputStyle} />
              </Field>
              <Field label="Journey">
                <select name="journey" className={inputStyle}>
                  {plgJourneyOptions(state).map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
                </select>
              </Field>
              <Field label="Audience">
                <select name="cohort" className={inputStyle}>
                  <option value="existing">Existing registered user</option>
                  <option value="new">New signup</option>
                </select>
              </Field>
              <Field label="Email frequency">
                <select name="frequency" className={inputStyle}>
                  <option value="weekly">Weekly digest</option>
                  <option value="daily">Daily tips</option>
                  <option value="updates">Product updates only</option>
                </select>
              </Field>
              <Field label="Messaging permission source">
                <input
                  name="consentSource"
                  maxLength={200}
                  placeholder="For example, subscriber preference form"
                  className={inputStyle}
                />
              </Field>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" name="consent" />
                Messaging permission is recorded
              </label>
              <label className="flex items-center gap-2 text-sm text-ink sm:col-span-2">
                <input type="checkbox" required />I verified this is a production customer account, excluding
                internal and test accounts.
              </label>
              <div className="flex gap-2 sm:col-span-2">
                <button disabled={busy} className={buttonStyle}>
                  Enroll account
                </button>
                <button type="button" className={buttonStyle} onClick={() => setAdding(false)}>
                  Cancel
                </button>
              </div>
            </form>
          )}
          <div className="mt-5 flex flex-wrap gap-3">
            <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-stroke px-3">
              <Search size={16} className="shrink-0 text-muted" />
              <input
                aria-label="Search enrolled accounts"
                placeholder="Search name, email or owner"
                className="w-full min-w-0 bg-transparent py-3 text-sm text-ink outline-none"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <select
              aria-label="Filter queue"
              className={cn(inputStyle, 'sm:w-auto')}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">All accounts</option>
              <option value="assistance">Needs assistance</option>
              <option value="due">Message ready</option>
              <option value="unknown">Activity unknown</option>
            </select>
          </div>
          {!contacts.length ? (
            <div className="py-12 text-center">
              <Users className="mx-auto text-muted" size={28} />
              <p className="mt-3 font-semibold text-ink">
                {state.contacts.length ? 'No accounts match this view' : 'Your first cohort starts here'}
              </p>
              <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">
                Enroll verified production accounts with their messaging preferences. Product signals
                establish progress; missing tracking stays unknown.
              </p>
            </div>
          ) : (
            <div className="metrics-table-scroll mt-5">
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead className="border-b border-stroke text-xs text-muted">
                  <tr>
                    {['Account', 'Journey and stage', 'Next action', 'Owner', ''].map((v, i) => (
                      <th key={i} className="px-3 py-3 font-medium">
                        {v}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((c) => {
                    const next = queue.find((q) => q.contactId === c.id)!;
                    return (
                      <tr key={c.id} className="border-b border-stroke">
                        <td className="px-3 py-4">
                          <p className="font-semibold text-ink">{c.name || c.email}</p>
                          <p className="mt-1 text-xs text-muted">
                            {c.name
                              ? c.email
                              : c.group === 'control'
                                ? 'Comparison group'
                                : 'Treatment group'}
                          </p>
                        </td>
                        <td className="px-3 py-4 text-ink">
                          <p>{plgJourneyLabel(state, c.journey)}</p>
                          <p className="mt-1 text-xs text-muted">{plgStageLabels[next.stage]}</p>
                        </td>
                        <td className="max-w-[260px] px-3 py-4 text-xs leading-5 text-muted">
                          {next.reason}
                        </td>
                        <td className="px-3 py-4 text-muted">{c.owner || 'Unassigned'}</td>
                        <td className="px-3 py-4">
                          <button
                            className={buttonStyle}
                            onClick={() => setSelected(c.id)}
                            aria-label={`Open ${c.email}`}
                          >
                            <ChevronRight size={16} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {person && (
            <div key={person.id + JSON.stringify(person.timeline[0])}>
              <ContactEditor
                contact={person}
                busy={busy}
                close={() => setSelected(null)}
                save={(body) => mutate(`contacts/${person.id}`, 'PATCH', body)}
              />
            </div>
          )}
        </section>
      )}
      {tab === 'content' && (
        <section className="space-y-5">
          <div className={cn(dashboardCard, 'p-6')}>
            <h3 className="text-lg font-semibold text-ink">Verify the task before inviting users</h3>
            <p className="mt-2 text-sm leading-6 text-muted">
              Confirm the released workflow works end to end. Messages remain drafts until an admin reviews
              the demonstration, copy and destination.
            </p>
            <div className="mt-4 flex flex-wrap gap-5">
              {plgJourneyOptions(state).map(({ id: j, label }) => (
                <label key={j} className="flex items-center gap-2 text-sm capitalize text-ink">
                  <input
                    type="checkbox"
                    checked={state.ready[j] ?? false}
                    disabled={!admin || busy}
                    onChange={(e) =>
                      void updateSettings({ ready: { ...state.ready, [j]: e.target.checked } })
                    }
                  />
                  {label} task verified
                </label>
              ))}
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {state.templates.map((t) => (
              <button
                key={t.id}
                onClick={() => setMessage({ ...t })}
                className={cn(dashboardCard, 'p-5 text-left transition hover:border-ink')}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                    {t.journey} · {t.step}
                  </p>
                  <span className="rounded-full bg-canvas px-2.5 py-1 text-xs text-muted">
                    {t.published ? 'Published' : 'Draft'} · v{t.version}
                  </span>
                </div>
                <h4 className="mt-3 font-semibold text-ink">{t.subject}</h4>
                <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted">{t.body}</p>
              </button>
            ))}
          </div>
          {message && (
            <form
              className={cn(dashboardCard, 'space-y-4 p-6')}
              onSubmit={async (e) => {
                e.preventDefault();
                if (await mutate(`templates/${message.id}`, 'PUT', message)) setMessage(null);
              }}
            >
              <div className="flex items-center justify-between">
                <h3 className="font-semibold capitalize text-ink">
                  {message.journey} {message.step} message
                </h3>
                <button
                  type="button"
                  className={buttonStyle}
                  onClick={() => setMessage(null)}
                  aria-label="Close message editor"
                >
                  <X size={16} />
                </button>
              </div>
              <Field label="Subject">
                <input
                  className={inputStyle}
                  required
                  maxLength={180}
                  value={message.subject}
                  onChange={(e) => setMessage({ ...message, subject: e.target.value })}
                />
              </Field>
              <Field label="Message">
                <textarea
                  className={inputStyle}
                  required
                  maxLength={3000}
                  rows={6}
                  value={message.body}
                  onChange={(e) => setMessage({ ...message, body: e.target.value })}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Action label">
                  <input
                    className={inputStyle}
                    required
                    value={message.ctaLabel}
                    onChange={(e) => setMessage({ ...message, ctaLabel: e.target.value })}
                  />
                </Field>
                <Field label="Verified task link on one.hushh.ai">
                  <input
                    type="url"
                    className={inputStyle}
                    required
                    value={message.ctaUrl}
                    onChange={(e) => setMessage({ ...message, ctaUrl: e.target.value })}
                  />
                </Field>
              </div>
              <Field label="Demo or guide link optional">
                <input
                  type="url"
                  className={inputStyle}
                  value={message.resourceUrl || ''}
                  onChange={(e) => setMessage({ ...message, resourceUrl: e.target.value })}
                />
              </Field>
              <label className="flex gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  disabled={!admin}
                  checked={message.published}
                  onChange={(e) => setMessage({ ...message, published: e.target.checked })}
                />
                Publish this reviewed message
              </label>
              <button className={buttonStyle} disabled={!admin || busy}>
                Save message
              </button>
              {!admin && <p className="text-sm text-muted">An admin publishes and saves campaign content.</p>}
            </form>
          )}
        </section>
      )}
      {tab === 'results' && (
        <section className={cn(dashboardCard, 'space-y-6 p-6')}>
          <div>
            <h3 className="text-lg font-semibold text-ink">Measure useful outcomes</h3>
            <p className="mt-2 text-sm leading-6 text-muted">
              Only signed, verified product completions count as first value. Accounts are deduplicated across
              devices. Cohort windows use UTC dates.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-stroke p-5">
              <p className="text-sm text-muted">Seven-day activation</p>
              <p className="mt-2 text-2xl font-semibold text-ink">
                {metrics.activationEligible
                  ? `${Math.round((100 * metrics.activationConverted) / metrics.activationEligible)}%`
                  : 'Waiting for mature cohorts'}
              </p>
              <p className="mt-2 text-xs text-muted">
                {metrics.activationConverted} of {metrics.activationEligible} accounts with seven full days
                observed
              </p>
            </div>
            <div className="rounded-xl border border-stroke p-5">
              <p className="text-sm text-muted">Second-week retention</p>
              <p className="mt-2 text-2xl font-semibold text-ink">
                {metrics.retentionEligible
                  ? `${Math.round((100 * metrics.retained) / metrics.retentionEligible)}%`
                  : 'Waiting for mature cohorts'}
              </p>
              <p className="mt-2 text-xs text-muted">
                {metrics.retained} of {metrics.retentionEligible} activated accounts with a complete UTC day 8
                to 14 window
              </p>
            </div>
          </div>
          <p className="text-sm leading-6 text-muted">
            Twenty percent of accounts are assigned to a stable comparison group. Early small-sample
            differences are directional. Unknown tracking is separate from confirmed inactivity.
          </p>
          <div className="metrics-table-scroll">
            <table className="w-full min-w-[540px] text-left text-sm">
              <thead className="border-b border-stroke text-xs text-muted">
                <tr>
                  {['Audience', 'Group', 'Enrolled', 'First value', 'Repeat accounts'].map((label) => (
                    <th key={label} className="px-3 py-3">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(['existing', 'new'] as const).flatMap((cohort) =>
                  (['treatment', 'control'] as const).map((group) => {
                    const records = state.contacts.filter((c) => c.cohort === cohort && c.group === group);
                    return (
                      <tr key={cohort + group} className="border-b border-stroke text-ink">
                        <td className="px-3 py-3 capitalize">{cohort} users</td>
                        <td className="px-3 py-3 capitalize">{group}</td>
                        <td className="px-3 py-3">{records.length}</td>
                        <td className="px-3 py-3">{records.filter((c) => c.firstValueAt).length}</td>
                        <td className="px-3 py-3">{records.filter((c) => c.valueDays.length > 1).length}</td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>
          <h4 className="font-semibold text-ink">Delivery history</h4>
          {state.deliveries.length ? (
            <div className="metrics-table-scroll">
              <table className="w-full min-w-[600px] text-left text-sm">
                <thead className="border-b border-stroke text-xs text-muted">
                  <tr>
                    {['Account', 'Message', 'Status', 'Reserved', 'Provider reference'].map((label) => (
                      <th key={label} className="px-3 py-3">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...state.deliveries]
                    .reverse()
                    .slice(0, 20)
                    .map((delivery) => (
                      <tr key={delivery.id} className="border-b border-stroke text-ink">
                        <td className="px-3 py-3">
                          {state.contacts.find((c) => c.id === delivery.contactId)?.email ||
                            'Enrolled account'}
                        </td>
                        <td className="px-3 py-3 capitalize">{delivery.step}</td>
                        <td className="px-3 py-3 capitalize">{delivery.status}</td>
                        <td className="px-3 py-3">{date(delivery.createdAt)}</td>
                        <td className="px-3 py-3 text-xs text-muted">
                          {delivery.providerId || 'Needs provider confirmation'}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted">No email has been reserved or sent.</p>
          )}
          <h4 className="font-semibold text-ink">Workspace activity</h4>
          {state.audit.length ? (
            state.audit.map((a, i) => (
              <div key={i} className="border-t border-stroke pt-3 text-sm">
                <p className="text-ink">{a.action}</p>
                <p className="mt-1 text-xs text-muted">
                  {date(a.at)} · {a.actor}
                </p>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted">Workspace changes will appear here.</p>
          )}
        </section>
      )}
      {preview && (
        <section className={cn(dashboardCard, 'space-y-4 p-6')} aria-label="Campaign preview">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-ink">Campaign preview</h3>
            <button className={buttonStyle} onClick={() => setPreview(null)} aria-label="Close preview">
              <X size={16} />
            </button>
          </div>
          <p className="text-sm text-muted">
            {preview.messages.length} eligible messages. This preview does not send email and can show due
            messages while campaigns are paused.
          </p>
          {preview.messages.map((m) => (
            <article className="rounded-xl border border-stroke p-5" key={m.contactId}>
              <p className="text-xs text-muted">{state.contacts.find((c) => c.id === m.contactId)?.email}</p>
              <h4 className="mt-2 font-semibold text-ink">{m.subject}</h4>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted">{m.body}</p>
              {m.resourceUrl && (
                <p className="mt-3">
                  <a
                    className="text-sm font-semibold text-ink underline"
                    href={m.resourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View the demo or guide
                  </a>
                </p>
              )}
              <a
                className="mt-4 inline-block text-sm font-semibold text-ink underline"
                href={m.ctaUrl}
                target="_blank"
                rel="noreferrer"
              >
                {m.ctaLabel}
              </a>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

function ContactEditor({
  contact: c,
  busy,
  close,
  save,
}: {
  contact: PlgContact;
  busy: boolean;
  close: () => void;
  save: (body: unknown) => Promise<boolean>;
}) {
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    await save({
      owner: data.get('owner'),
      blocker: data.get('blocker'),
      notes: data.get('notes'),
      frequency: data.get('frequency'),
      supportOpen: data.get('supportOpen') === 'on',
      unsubscribe: data.get('unsubscribe') === 'on',
      ...(data.get('outreachRecorded') === 'on'
        ? { outreach: { id: crypto.randomUUID(), channel: data.get('outreachChannel') } }
        : {}),
    });
  }
  return (
    <div className="mt-6 rounded-2xl border border-stroke bg-canvas p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-ink">{c.name || c.email}</h3>
          <p className="mt-1 text-xs text-muted">
            {c.email} · {c.group} ·{' '}
            {c.suppressed || (c.consentAt ? 'Messaging permission recorded' : 'No messaging permission')}
          </p>
        </div>
        <button className={buttonStyle} onClick={close} aria-label="Close account details">
          <X size={16} />
        </button>
      </div>
      <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={submit}>
        <Field label="Follow-up owner">
          <input name="owner" defaultValue={c.owner} maxLength={120} className={inputStyle} />
        </Field>
        <Field label="Blocker">
          <select name="blocker" defaultValue={c.blocker} className={inputStyle}>
            {[
              '',
              'Unclear benefit',
              'Setup difficulty',
              'Product error',
              'Trust concern',
              'No recurring need',
              'Forgotten',
            ].map((b) => (
              <option key={b} value={b}>
                {b || 'No blocker recorded'}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Email frequency">
          <select name="frequency" defaultValue={c.frequency} className={inputStyle}>
            <option value="daily">Daily tips</option>
            <option value="weekly">Weekly digest</option>
            <option value="updates">Product updates only</option>
          </select>
        </Field>
        <Field label="Support notes without personal content">
          <textarea name="notes" defaultValue={c.notes} maxLength={400} className={inputStyle} />
        </Field>
        <label className="flex gap-2 text-sm text-ink">
          <input type="checkbox" name="supportOpen" defaultChecked={c.supportOpen} />
          Assistance open; pause promotional messages
        </label>
        <label className="flex gap-2 text-sm text-ink">
          <input type="checkbox" name="unsubscribe" disabled={Boolean(c.suppressed)} />
          Stop promotional messages
        </label>
        <label className="flex gap-2 text-sm text-ink">
          <input type="checkbox" name="outreachRecorded" />
          Record a promotional follow-up I already sent
        </label>
        <Field label="Channel of recorded follow-up">
          <select name="outreachChannel" className={inputStyle}>
            <option value="email">Email</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
        </Field>
        <div className="sm:col-span-2">
          <button className={buttonStyle} disabled={busy}>
            Save follow-up
          </button>
        </div>
      </form>
      <h4 className="mt-6 text-sm font-semibold text-ink">Account timeline</h4>
      <div className="mt-3 space-y-3">
        {c.timeline.map((a, i) => (
          <div className="border-l-2 border-stroke pl-3" key={i}>
            <p className="text-sm text-ink">{a.action}</p>
            <p className="mt-1 text-xs text-muted">
              {date(a.at)} · {a.actor}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
