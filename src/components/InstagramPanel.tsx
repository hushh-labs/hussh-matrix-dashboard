import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { appleCard, applePanel } from '../lib/theme';
import { cn } from '../lib/utils';
import { buildInstagramCampaignLink, INSTAGRAM_DESTINATIONS } from '../lib/instagram-campaign';

interface InstagramReport {
  state: 'not_configured' | 'empty' | 'available' | 'stale' | 'sync_failed' | 'reconnect_required' | 'permission_missing' | 'sync_in_progress';
  username: string | null;
  reach: {
    value: number | null; status: string; metricType: string; period: string;
    requestedSince: string; requestedUntil: string;
  } | null;
  lastSuccessfulSync: string | null;
  lastAttempt: string | null;
  canSync: boolean;
}

const stateCopy: Record<InstagramReport['state'], string> = {
  not_configured: 'Not configured. An operator must enable the connector and add a private access token.',
  empty: 'No Instagram observation has been stored yet.',
  available: 'Stored Instagram data is available.',
  stale: 'Stored data is stale. The last successful value is preserved.',
  sync_failed: 'The latest sync failed. Any prior valid value is preserved.',
  reconnect_required: 'Reconnect required. The access token is invalid or expired.',
  permission_missing: 'The insights permission is missing for this account.',
  sync_in_progress: 'Instagram sync is in progress. The last stored value remains visible.',
};

export function InstagramPanel({ refreshKey = 0 }: { refreshKey?: number }) {
  const [report, setReport] = useState<InstagramReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [destination, setDestination] = useState<string>(INSTAGRAM_DESTINATIONS[0].url);
  const [campaign, setCampaign] = useState('');
  const [content, setContent] = useState('');
  const [copied, setCopied] = useState(false);
  const campaignLink = buildInstagramCampaignLink(destination, campaign, content);
  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/analytics/instagram', { cache: 'no-store' });
      if (!response.ok) throw new Error('request failed');
      setReport(await response.json());
      setMessage(null);
    } catch {
      setMessage('Instagram reporting is temporarily unavailable.');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load, refreshKey]);

  const sync = async () => {
    setSyncing(true);
    try {
      const response = await fetch('/api/instagram/sync', { method: 'POST', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('sync failed');
      await load();
    } catch {
      setMessage('Sync could not complete. Try again after the cooldown.');
    } finally { setSyncing(false); }
  };

  return <section className="space-y-5" aria-labelledby="instagram-title">
    <div className={cn(appleCard, 'p-5 sm:p-8')}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-[#86868b]">Social performance</p>
          <h2 id="instagram-title" className="mt-2 text-3xl font-semibold">Instagram</h2>
          <p className="mt-2 text-sm text-[#6e6e73]">{report?.username ? `@${report.username}` : 'Company account'}</p>
        </div>
        {report?.canSync && <button type="button" onClick={() => void sync()} disabled={syncing}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#1d1d1f] px-4 text-sm font-bold text-white disabled:opacity-50">
          <RefreshCw className={cn('h-4 w-4', syncing && 'animate-spin')} />Sync now
        </button>}
      </div>
      <p role="status" className="mt-5 text-sm text-[#6e6e73]">
        {loading ? 'Loading Instagram report…' : message || (report ? stateCopy[report.state] : 'Instagram reporting is unavailable.')}
      </p>
    </div>
    <div className={cn(applePanel, 'p-5 sm:p-8')}>
      <p className="text-xs font-bold uppercase tracking-widest text-[#86868b]">Reach · requested seven-day total</p>
      <p className="mt-2 text-4xl font-semibold tabular-nums">
        {report?.reach?.status === 'available' && report.reach.value !== null
          ? report.reach.value.toLocaleString() : '—'}
      </p>
      {report?.reach && <p className="mt-3 text-sm leading-6 text-[#6e6e73]">
        Requested since: {report.reach.requestedSince}; until: {report.reach.requestedUntil} (UTC).
        Meta returned one total for this window; provider reporting boundaries and daily values were not returned.
      </p>}
      <p className="mt-3 text-sm text-[#6e6e73]">Last successful sync: {report?.lastSuccessfulSync || 'Never'}.</p>
      <p className="mt-1 text-sm text-[#6e6e73]">Last attempt: {report?.lastAttempt || 'Never'}.</p>
      <p className="mt-1 text-xs text-[#86868b]">Instagram reach is separate from website visitors, signups, and app installs.</p>
    </div>
    <div className={cn(appleCard, 'p-5 sm:p-8')}>
      <h3 className="text-xl font-semibold">Instagram campaign link</h3>
      <p className="mt-2 text-sm text-[#6e6e73]">Create a tagged link to an owned landing page. This records the link placement, not the identity of an Instagram viewer or a particular Reel.</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <label className="text-sm font-semibold">Destination
          <select value={destination} onChange={(event) => { setDestination(event.target.value); setCopied(false); }} className="mt-1 block min-h-10 w-full rounded-lg border border-black/10 bg-white px-3">
            {INSTAGRAM_DESTINATIONS.map((item) => <option key={item.url} value={item.url}>{item.label}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold">Campaign slug
          <input value={campaign} onChange={(event) => { setCampaign(event.target.value.trim().toLowerCase()); setCopied(false); }} placeholder="launch-sept" maxLength={64}
            className="mt-1 block min-h-10 w-full rounded-lg border border-black/10 bg-white px-3" />
        </label>
        <label className="text-sm font-semibold">Placement or variant
          <input value={content} onChange={(event) => { setContent(event.target.value.trim().toLowerCase()); setCopied(false); }} placeholder="bio-link" maxLength={64}
            className="mt-1 block min-h-10 w-full rounded-lg border border-black/10 bg-white px-3" />
        </label>
      </div>
      <p className="mt-3 text-xs text-[#86868b]">Use lowercase letters, digits, hyphens, or underscores. Add no names, emails, or personal information.</p>
      {campaignLink && <div className="mt-4 flex flex-wrap items-center gap-3">
        <a href={campaignLink} target="_blank" rel="noopener noreferrer" className="max-w-full break-all text-sm font-semibold text-[#005eb8] underline">{campaignLink}</a>
        <button type="button" onClick={() => { void navigator.clipboard.writeText(campaignLink).then(() => setCopied(true)).catch(() => setMessage('Could not copy the link. Select and copy it instead.')); }}
          className="min-h-10 rounded-lg bg-[#1d1d1f] px-4 text-sm font-bold text-white">{copied ? 'Copied' : 'Copy link'}</button>
      </div>}
      <p className="mt-4 text-xs text-[#86868b]">Website visits and signups are not joined to Instagram yet. Existing consent and event capture remain unchanged.</p>
    </div>
  </section>;
}
