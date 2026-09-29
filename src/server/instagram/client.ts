/** Server-only Instagram Login API reader. Never import this module from the SPA. */
export type InsightStatus = 'available' | 'not_supported' | 'permission_missing' | 'not_yet_available' | 'privacy_limited' | 'sync_failed' | 'unknown';

export interface ReachObservation {
  name: AccountInsightName;
  period: 'day';
  metricType: 'total_value';
  unit: 'accounts' | 'views' | 'interactions';
  value: number | null;
  status: InsightStatus;
  requestedSince: string;
  requestedUntil: string;
  providerSince: string | null;
  providerUntil: string | null;
}

export type AccountInsightName = 'reach' | 'views' | 'total_interactions' | 'accounts_engaged';
export type MediaInsightName = 'reach' | 'saved' | 'shares' | 'views';
export interface AccountProfile { userId: string; username: string; followersCount: number | null; mediaCount: number | null }
export interface InstagramMedia {
  id: string; mediaType: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM'; permalink: string;
  publishedAt: string; likeCount: number | null; commentsCount: number | null;
}
export interface MediaObservation {
  name: MediaInsightName; period: 'lifetime'; metricType: 'lifetime_snapshot'; unit: 'accounts' | 'count' | 'views';
  value: number | null; status: InsightStatus; providerSince: null; providerUntil: null;
}

const accountUnits: Record<AccountInsightName, ReachObservation['unit']> = {
  reach: 'accounts', views: 'views', total_interactions: 'interactions', accounts_engaged: 'accounts',
};
const mediaUnits: Record<MediaInsightName, MediaObservation['unit']> = {
  reach: 'accounts', saved: 'count', shares: 'count', views: 'views',
};

export class InstagramApiError extends Error {
  constructor(public readonly kind: 'permission_missing' | 'reconnect_required' | 'rate_limited' | 'transient' | 'invalid_response' | 'not_supported', public readonly status?: number, public readonly code?: number) {
    super(`Instagram API ${kind}${status ? ` (HTTP ${status})` : ''}${code ? ` (code ${code})` : ''}`);
    this.name = 'InstagramApiError';
  }
}

export function parseReach(payload: unknown, since: Date, until: Date): ReachObservation {
  return parseAccountInsight(payload, 'reach', since, until);
}

export function parseAccountInsight(payload: unknown, name: AccountInsightName, since: Date, until: Date): ReachObservation {
  const data = (payload as { data?: unknown })?.data;
  if (!Array.isArray(data)) throw new InstagramApiError('invalid_response');
  const item = data.find((entry) => entry && typeof entry === 'object' && entry.name === name);
  if (!item) return { name, period: 'day', metricType: 'total_value', unit: accountUnits[name],
    value: null, status: 'not_yet_available', requestedSince: since.toISOString(), requestedUntil: until.toISOString(),
    providerSince: null, providerUntil: null };
  if (item.period !== 'day') throw new InstagramApiError('invalid_response');
  const raw = item.total_value?.value;
  // A missing value is never a zero. The tested total_value response has no
  // reporting boundary fields, so do not manufacture provider dates from it.
  if (raw !== undefined && raw !== null && (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0)) {
    throw new InstagramApiError('invalid_response');
  }
  return {
    name, period: 'day', metricType: 'total_value', unit: accountUnits[name],
    value: raw ?? null,
    status: raw === undefined || raw === null ? 'not_yet_available' : 'available',
    requestedSince: since.toISOString(), requestedUntil: until.toISOString(),
    providerSince: null, providerUntil: null,
  };
}

function optionalCount(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new InstagramApiError('invalid_response');
  return value;
}

export function parseMediaInsight(payload: unknown, name: MediaInsightName): MediaObservation {
  const data = (payload as { data?: unknown })?.data;
  if (!Array.isArray(data)) throw new InstagramApiError('invalid_response');
  const item = data.find((entry) => entry && typeof entry === 'object' && entry.name === name);
  if (!item) return { name, period: 'lifetime', metricType: 'lifetime_snapshot', unit: mediaUnits[name], value: null,
    status: 'not_yet_available', providerSince: null, providerUntil: null };
  if (item.period !== 'lifetime' || !Array.isArray(item.values)) throw new InstagramApiError('invalid_response');
  const value = optionalCount(item.values[0]?.value);
  return { name, period: 'lifetime', metricType: 'lifetime_snapshot', unit: mediaUnits[name], value,
    status: value === null ? 'not_yet_available' : 'available', providerSince: null, providerUntil: null };
}

export function parseMediaList(payload: unknown): { items: InstagramMedia[]; after: string | null } {
  const body = payload as any;
  if (!Array.isArray(body?.data)) throw new InstagramApiError('invalid_response');
  const items = body.data.map((item: any): InstagramMedia => {
    if (typeof item?.id !== 'string' || !/^\d+$/.test(item.id) ||
      !['IMAGE', 'VIDEO', 'CAROUSEL_ALBUM'].includes(item.media_type) ||
      typeof item.permalink !== 'string' || !/^https:\/\/(www\.)?instagram\.com\//.test(item.permalink) ||
      typeof item.timestamp !== 'string' || !Number.isFinite(Date.parse(item.timestamp))) throw new InstagramApiError('invalid_response');
    return { id: item.id, mediaType: item.media_type, permalink: item.permalink,
      publishedAt: new Date(item.timestamp).toISOString(), likeCount: optionalCount(item.like_count),
      commentsCount: optionalCount(item.comments_count) };
  });
  // Never follow a provider-supplied URL. Only an opaque cursor is used on our fixed host/path.
  const after = body.paging?.cursors?.after;
  if (after !== undefined && (typeof after !== 'string' || !/^[A-Za-z0-9_=-]{1,512}$/.test(after))) throw new InstagramApiError('invalid_response');
  return { items, after: body.paging?.next ? after || null : null };
}

export function completedSevenDayWindow(now = new Date()): { since: Date; until: Date } {
  const until = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return { since: new Date(until.getTime() - 7 * 86_400_000), until };
}

export class InstagramClient {
  constructor(
    private readonly token: string,
    private readonly version = 'v26.0',
    private readonly transport: typeof fetch = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ) {
    if (!/^v\d+\.\d+$/.test(version)) throw new Error('Invalid Instagram API version');
    if (!token) throw new Error('Instagram token is not configured');
  }

  private async get(path: string, params: Record<string, string>): Promise<any> {
    const url = new URL(`https://graph.instagram.com/${this.version}/${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let response: Response;
      try {
        response = await this.transport(url.toString(), {
          method: 'GET', headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(10_000), redirect: 'error',
        });
      } catch {
        if (attempt < 2) { await this.sleep(250 * (attempt + 1)); continue; }
        throw new InstagramApiError('transient');
      }
      if (!response.ok) {
        // Do not retain provider messages, request URLs, headers, or raw bodies.
        let code: number | undefined;
        try {
          const body = await response.json();
          code = Number.isInteger(body?.error?.code) ? body.error.code : undefined;
        } catch { /* malformed provider body */ }
        if (response.status === 401 || code === 190) throw new InstagramApiError('reconnect_required', response.status, code);
        if (response.status === 403 || code === 10 || code === 200) throw new InstagramApiError('permission_missing', response.status, code);
        const limited = response.status === 429 || [4, 17, 32, 613].includes(code || 0);
        const transient = response.status >= 500 || [1, 2].includes(code || 0);
        if (limited || transient) {
          if (attempt < 2) {
            const retryAfterHeader = response.headers.get('retry-after');
            const retryAfter = retryAfterHeader === null ? NaN : Number(retryAfterHeader);
            const retryDate = retryAfterHeader && !Number.isFinite(retryAfter) ? Date.parse(retryAfterHeader) : NaN;
            const delay = Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1000
              : Number.isFinite(retryDate) ? Math.max(0, retryDate - Date.now()) : 250 * (attempt + 1);
            await this.sleep(Math.min(delay, 5_000));
            continue;
          }
          throw new InstagramApiError(limited ? 'rate_limited' : 'transient', response.status, code);
        }
        throw new InstagramApiError(response.status === 400 && code === 100 ? 'not_supported' : 'invalid_response', response.status, code);
      }
      try { return await response.json(); } catch { throw new InstagramApiError('invalid_response', response.status); }
    }
    throw new InstagramApiError('transient');
  }

  async identity(): Promise<{ userId: string; username: string }> {
    const body = await this.get('me', { fields: 'user_id,username' });
    if (typeof body?.user_id !== 'string' || !/^\d+$/.test(body.user_id) || typeof body?.username !== 'string') {
      throw new InstagramApiError('invalid_response');
    }
    return { userId: body.user_id, username: body.username };
  }

  async profile(): Promise<AccountProfile> {
    const body = await this.get('me', { fields: 'user_id,username,followers_count,media_count' });
    if (typeof body?.user_id !== 'string' || !/^\d+$/.test(body.user_id) || typeof body?.username !== 'string') throw new InstagramApiError('invalid_response');
    return { userId: body.user_id, username: body.username, followersCount: optionalCount(body.followers_count), mediaCount: optionalCount(body.media_count) };
  }

  async accountInsight(userId: string, name: AccountInsightName, since: Date, until: Date): Promise<ReachObservation> {
    if (!/^\d+$/.test(userId) || !(since < until) || !(name in accountUnits)) throw new InstagramApiError('invalid_response');
    const body = await this.get(`${userId}/insights`, {
      metric: name, period: 'day', metric_type: 'total_value',
      since: String(Math.floor(since.getTime() / 1000)), until: String(Math.floor(until.getTime() / 1000)),
    });
    return parseAccountInsight(body, name, since, until);
  }

  async reach(userId: string, since: Date, until: Date): Promise<ReachObservation> {
    return this.accountInsight(userId, 'reach', since, until);
  }

  async recentMedia(userId: string, maxItems = 10): Promise<InstagramMedia[]> {
    if (!/^\d+$/.test(userId) || !Number.isInteger(maxItems) || maxItems < 1 || maxItems > 10) throw new InstagramApiError('invalid_response');
    const items: InstagramMedia[] = [];
    let after: string | null = null;
    for (let page = 0; page < 2 && items.length < maxItems; page += 1) {
      const body = await this.get(`${userId}/media`, { fields: 'id,media_type,permalink,timestamp,like_count,comments_count',
        limit: String(Math.min(5, maxItems - items.length)), ...(after ? { after } : {}) });
      const parsed = parseMediaList(body);
      items.push(...parsed.items.slice(0, maxItems - items.length));
      if (!parsed.after || parsed.after === after || parsed.items.length === 0) break;
      after = parsed.after;
    }
    return items;
  }

  async mediaInsight(mediaId: string, name: MediaInsightName): Promise<MediaObservation> {
    if (!/^\d+$/.test(mediaId) || !(name in mediaUnits)) throw new InstagramApiError('invalid_response');
    return parseMediaInsight(await this.get(`${mediaId}/insights`, { metric: name }), name);
  }
}
