import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { appleCard, applePanel } from '../lib/theme';
import { cn } from '../lib/utils';
import { buildInstagramCampaignLink, INSTAGRAM_DESTINATIONS } from '../lib/instagram-campaign';
import { contentLabel, contentTotals, filterContent, type InstagramProductType } from '../lib/instagram-content';

interface InstagramReport {
  state: 'not_configured' | 'empty' | 'available' | 'stale' | 'sync_failed' | 'reconnect_required' | 'permission_missing' | 'sync_in_progress';
  username: string | null;
  reach: {
    value: number | null; status: string; metricType: string; period: string;
    requestedSince: string; requestedUntil: string;
  } | null;
  accountMetrics?: Record<string, { value: number | null; status: string; requestedSince: string; requestedUntil: string }>;
  followersCount?: number | null;
  mediaCount?: number | null;
  countsObservedAt?: string | null;
  metricResults?: Record<string, string>;
  media?: Array<{ id: string; mediaType: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM'; permalink: string; publishedAt: string;
    productType: InstagramProductType;
    likeCount: number | null; commentsCount: number | null; fetchedAt: string;
    insights: Record<string, { value: number | null; status: string; fetchedAt?: string | null }> }>;
  inventory?: { complete: boolean; windowSince: string; count: number; scannedAt: string } | null;
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
  const [mediaSort, setMediaSort] = useState<'publishedAt' | 'reach' | 'views' | 'likes' | 'comments' | 'saves' | 'shares'>('publishedAt');
  const [mediaFilter, setMediaFilter] = useState<'all' | InstagramProductType>('all');
  const [mediaRange, setMediaRange] = useState<7 | 30 | 90 | 365>(365);
  const [mediaPage, setMediaPage] = useState(0);
  const mediaRows = useMemo(() => filterContent(report?.media || [], mediaRange, new Date())
    .filter((item) => mediaFilter === 'all' || item.productType === mediaFilter).sort((a, b) => {
    const score = (item: typeof a) => mediaSort === 'publishedAt' ? Date.parse(item.publishedAt)
      : mediaSort === 'likes' ? item.likeCount ?? -1
      : mediaSort === 'comments' ? item.commentsCount ?? -1
      : item.insights[mediaSort === 'saves' ? 'saved' : mediaSort]?.status === 'available'
        ? item.insights[mediaSort === 'saves' ? 'saved' : mediaSort]?.value ?? -1 : -1;
    return score(b) - score(a) || b.id.localeCompare(a.id);
  }), [report?.media, mediaSort, mediaFilter, mediaRange]);
  const mediaTotals = useMemo(() => contentTotals(mediaRows), [mediaRows]);
  const inventoryTotals = useMemo(() => contentTotals(report?.media || []), [report?.media]);
  const mediaPages = Math.max(1, Math.ceil(mediaRows.length / 10));
  const visibleMedia = mediaRows.slice(Math.min(mediaPage, mediaPages - 1) * 10, (Math.min(mediaPage, mediaPages - 1) + 1) * 10);
  const metricValue = (value: number | null | undefined, status?: string) => status === 'available' && value !== null && value !== undefined ? value.toLocaleString() : '—';
  const safePermalink = (value: string) => {
    try { const url = new URL(value); return url.protocol === 'https:' && ['instagram.com', 'www.instagram.com'].includes(url.hostname) ? url.href : null; }
    catch { return null; }
  };
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
          {report?.media?.length ? <a href="#instagram-content" className="mt-2 inline-block text-sm font-semibold text-[#005eb8] underline">
            View posts and Reels
          </a> : null}
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
    <div className={cn(appleCard, 'p-5 sm:p-8')}>
      <h3 className="text-xl font-semibold">Content inventory</h3>
      <p className="mt-2 text-sm text-[#6e6e73]">Posts and Reels returned for the past 365 days. Counts describe collected content, not Instagram reach or unique viewers.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {([
          ['Collected media', inventoryTotals.count], ['Reels', inventoryTotals.reels],
          ['Feed posts', inventoryTotals.feed], ['Stories', inventoryTotals.stories],
        ] as const).map(([label, value]) => <div key={label} className="rounded-xl border border-black/10 p-4">
          <p className="text-sm text-[#6e6e73]">{label}</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{report?.inventory ? value.toLocaleString() : '—'}</p>
        </div>)}
      </div>
      {report?.inventory ? <p className="mt-4 text-sm leading-6 text-[#6e6e73]">
        Scan window starts {report.inventory.windowSince} (UTC); last scanned {report.inventory.scannedAt} (UTC).
        {' '}{report.inventory.complete ? 'Pagination reached the end of the account media list.' : 'Scan is partial at the 75-item limit; format counts are lower bounds.'}
        {report.inventory.complete && report.mediaCount === report.inventory.count ? ' The scan count matches the current account media count.' : ''}
      </p> : <p className="mt-4 text-sm text-[#6e6e73]">Detailed content inventory has not been collected yet.</p>}
      {inventoryTotals.unknown > 0 && <p className="mt-2 text-sm text-[#946200]">{inventoryTotals.unknown} items have an unknown Instagram product type and are excluded from the Reel and Feed counts.</p>}
      <p className="mt-3 text-sm text-[#6e6e73]">
        Current likes across collected items: {inventoryTotals.likes.observed ? inventoryTotals.likes.value.toLocaleString() : '—'} ({inventoryTotals.likes.observed}/{inventoryTotals.count} items with a count).
        {' '}Content views: {inventoryTotals.views.observed ? inventoryTotals.views.value.toLocaleString() : '—'} ({inventoryTotals.views.observed}/{inventoryTotals.count} items with available insight).
      </p>
      <p className="mt-1 text-xs text-[#86868b]">Likes and views above add the latest per-item lifetime snapshots. Content views are not deduplicated account reach or seven-day account views.</p>
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
      <h3 className="text-xl font-semibold">Account activity</h3>
      <p className="mt-2 text-sm text-[#6e6e73]">Requested seven-day totals for the same UTC window as reach. These are native Instagram metrics and may include paid activity.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {([['views', 'Views'], ['total_interactions', 'Total interactions'], ['accounts_engaged', 'Accounts engaged']] as const).map(([name, label]) => {
          const metric = report?.accountMetrics?.[name];
          return <div key={name} className="rounded-xl border border-black/10 p-4">
            <p className="text-sm text-[#6e6e73]">{label}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{metricValue(metric?.value, metric?.status)}</p>
            <p className="mt-1 text-xs text-[#86868b]">{report?.metricResults?.[`account.${name}`] || metric?.status || 'Not yet collected'}</p>
          </div>;
        })}
      </div>
      <p className="mt-4 text-sm text-[#6e6e73]">Current followers: {metricValue(report?.followersCount, report?.followersCount === null || report?.followersCount === undefined ? undefined : 'available')} · Current media count: {metricValue(report?.mediaCount, report?.mediaCount === null || report?.mediaCount === undefined ? undefined : 'available')}.</p>
      <p className="mt-1 text-xs text-[#86868b]">Counts observed: {report?.countsObservedAt || 'Not yet available'} (UTC). These are current totals, not follower growth or daily additions.</p>
      {report?.metricResults && Object.values(report.metricResults).some((status) => status !== 'available') &&
        <p className="mt-3 text-sm text-[#946200]">Some optional metrics are unavailable or failed on the last sync. Available values remain stored.</p>}
    </div>
    <div id="instagram-content" className={cn(applePanel, 'p-5 sm:p-8')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="text-xl font-semibold">Posts and Reels</h3>
          <p className="mt-1 text-sm text-[#6e6e73]">Per-item lifetime insights and current likes/comments. A Reel is identified by Instagram's media product type.</p></div>
        <div className="flex flex-wrap gap-3">
          <label className="text-sm text-[#6e6e73]">Type
            <select value={mediaFilter} onChange={(event) => { setMediaFilter(event.target.value as typeof mediaFilter); setMediaPage(0); }}
              className="ml-2 min-h-10 rounded-lg border border-black/10 bg-white px-2">
              <option value="all">All</option><option value="REELS">Reels</option><option value="FEED">Feed</option>
              <option value="STORY">Stories</option><option value="UNKNOWN">Unknown</option>
            </select>
          </label>
          <label className="text-sm text-[#6e6e73]">Published
            <select value={mediaRange} onChange={(event) => { setMediaRange(Number(event.target.value) as typeof mediaRange); setMediaPage(0); }}
              className="ml-2 min-h-10 rounded-lg border border-black/10 bg-white px-2">
              <option value={7}>Past 7 days</option><option value={30}>Past 30 days</option>
              <option value={90}>Past 90 days</option><option value={365}>Past 365 days</option>
            </select>
          </label>
          <label className="text-sm text-[#6e6e73]">Sort by
            <select value={mediaSort} onChange={(event) => { setMediaSort(event.target.value as typeof mediaSort); setMediaPage(0); }}
              className="ml-2 min-h-10 rounded-lg border border-black/10 bg-white px-2">
              <option value="publishedAt">Published</option><option value="reach">Reach</option><option value="views">Views</option>
              <option value="likes">Likes</option><option value="comments">Comments</option>
              <option value="saves">Saves</option><option value="shares">Shares</option>
            </select>
          </label>
        </div>
      </div>
      <p role="status" className="mt-4 text-sm text-[#6e6e73]">
        Showing {mediaTotals.count} collected items: {mediaTotals.reels} Reels, {mediaTotals.feed} Feed posts, {mediaTotals.stories} Stories.
        {' '}Views across {mediaTotals.views.observed}/{mediaTotals.count} items: {mediaTotals.views.observed ? mediaTotals.views.value.toLocaleString() : '—'} (sum of latest lifetime snapshots; not unique viewers).
      </p>
      {mediaRows.length === 0 ? <p className="mt-5 text-sm text-[#6e6e73]">No collected media matches these filters.</p> :
        <div className="mt-5 overflow-x-auto"><table className="min-w-[860px] w-full text-left text-sm">
          <thead><tr className="border-b border-black/10 text-[#6e6e73]"><th className="py-3 pr-3">Published (UTC)</th><th className="py-3 pr-3">Type</th>
            <th className="py-3 pr-3">Reach</th><th className="py-3 pr-3">Views</th><th className="py-3 pr-3">Saves</th><th className="py-3 pr-3">Shares</th>
            <th className="py-3 pr-3">Likes</th><th className="py-3 pr-3">Comments</th><th className="py-3">Post</th></tr></thead>
          <tbody>{visibleMedia.map((item) => <tr key={item.id} className="border-b border-black/[0.06]">
            <td className="py-3 pr-3 whitespace-nowrap">{item.publishedAt.slice(0, 10)}</td><td className="py-3 pr-3">{contentLabel(item)}</td>
            {(['reach','views','saved','shares'] as const).map((name) => <td key={name} className="py-3 pr-3 tabular-nums" title={`${item.insights[name]?.status || report?.metricResults?.[`media.${item.id}.${name}`] || 'Not collected'}${item.insights[name]?.fetchedAt ? ` · observed ${item.insights[name].fetchedAt} UTC` : ''}`}>
              {metricValue(item.insights[name]?.value, item.insights[name]?.status)}</td>)}
            <td className="py-3 pr-3 tabular-nums" title={`Metadata checked ${item.fetchedAt} UTC`}>{item.likeCount === null ? '—' : item.likeCount.toLocaleString()}</td>
            <td className="py-3 pr-3 tabular-nums" title={`Metadata checked ${item.fetchedAt} UTC`}>{item.commentsCount === null ? '—' : item.commentsCount.toLocaleString()}</td>
            <td className="py-3">{safePermalink(item.permalink) ? <a href={safePermalink(item.permalink)!} target="_blank" rel="noopener noreferrer" className="text-[#005eb8] underline">Open</a> : '—'}</td>
          </tr>)}</tbody>
        </table></div>}
      {mediaRows.length > 10 && <div className="mt-4 flex items-center justify-end gap-3 text-sm">
        <button type="button" disabled={mediaPage === 0} onClick={() => setMediaPage((page) => Math.max(0, page - 1))} className="min-h-10 rounded-lg border border-black/10 px-3 disabled:opacity-40">Previous</button>
        <span>Page {Math.min(mediaPage, mediaPages - 1) + 1} of {mediaPages}</span>
        <button type="button" disabled={mediaPage >= mediaPages - 1} onClick={() => setMediaPage((page) => Math.min(mediaPages - 1, page + 1))} className="min-h-10 rounded-lg border border-black/10 px-3 disabled:opacity-40">Next</button>
      </div>}
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
