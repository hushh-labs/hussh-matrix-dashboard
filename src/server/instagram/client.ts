/** Server-only Instagram Login API reader. Never import this module from the SPA. */
export type InsightStatus = 'available' | 'not_supported' | 'permission_missing' | 'not_yet_available' | 'privacy_limited' | 'sync_failed' | 'unknown';

export interface ReachObservation {
  name: 'reach';
  period: 'day';
  metricType: 'total_value';
  unit: 'accounts';
  value: number | null;
  status: InsightStatus;
  requestedSince: string;
  requestedUntil: string;
  providerSince: string | null;
  providerUntil: string | null;
}

export class InstagramApiError extends Error {
  constructor(public readonly kind: 'permission_missing' | 'reconnect_required' | 'rate_limited' | 'transient' | 'invalid_response', public readonly status?: number, public readonly code?: number) {
    super(`Instagram API ${kind}${status ? ` (HTTP ${status})` : ''}${code ? ` (code ${code})` : ''}`);
    this.name = 'InstagramApiError';
  }
}

export function parseReach(payload: unknown, since: Date, until: Date): ReachObservation {
  const data = (payload as { data?: unknown })?.data;
  if (!Array.isArray(data)) throw new InstagramApiError('invalid_response');
  const item = data.find((entry) => entry && typeof entry === 'object' && entry.name === 'reach');
  if (!item || item.period !== 'day') throw new InstagramApiError('invalid_response');
  const raw = item.total_value?.value;
  // A missing value is never a zero. The tested total_value response has no
  // reporting boundary fields, so do not manufacture provider dates from it.
  if (raw !== undefined && raw !== null && (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0)) {
    throw new InstagramApiError('invalid_response');
  }
  return {
    name: 'reach', period: 'day', metricType: 'total_value', unit: 'accounts',
    value: raw ?? null,
    status: raw === undefined || raw === null ? 'not_yet_available' : 'available',
    requestedSince: since.toISOString(), requestedUntil: until.toISOString(),
    providerSince: null, providerUntil: null,
  };
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
        if (response.status === 429 || response.status >= 500) {
          if (attempt < 2) {
            const retryAfter = Number(response.headers.get('retry-after'));
            await this.sleep(Number.isFinite(retryAfter) && retryAfter >= 0 ? Math.min(retryAfter * 1000, 5_000) : 250 * (attempt + 1));
            continue;
          }
          throw new InstagramApiError(response.status === 429 ? 'rate_limited' : 'transient', response.status, code);
        }
        throw new InstagramApiError('invalid_response', response.status, code);
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

  async reach(userId: string, since: Date, until: Date): Promise<ReachObservation> {
    if (!/^\d+$/.test(userId) || !(since < until)) throw new InstagramApiError('invalid_response');
    const body = await this.get(`${userId}/insights`, {
      metric: 'reach', period: 'day', metric_type: 'total_value',
      since: String(Math.floor(since.getTime() / 1000)), until: String(Math.floor(until.getTime() / 1000)),
    });
    return parseReach(body, since, until);
  }
}
