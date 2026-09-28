import { GoogleAuth } from 'google-auth-library';
import { InstagramApiError } from './client';

interface StoredCredential {
  accessToken: string;
  tokenType: 'long_lived' | 'unknown';
  issuedAt?: string;
  expiresAt?: string;
}

export interface CredentialSource {
  loadForSync(now?: Date): Promise<string | null>;
}

/**
 * A configured Secret Manager resource always wins over the bootstrap env var.
 * This prevents an old Cloud Run revision from replacing a refreshed token.
 * The secret value is JSON; only version metadata is ever logged by operators.
 */
export class InstagramCredentials implements CredentialSource {
  constructor(
    private readonly secretName = process.env.INSTAGRAM_CREDENTIAL_SECRET || '',
    private readonly bootstrapToken = process.env.INSTAGRAM_ACCESS_TOKEN || '',
    private readonly transport: typeof fetch = fetch,
    private readonly auth?: Pick<GoogleAuth, 'getAccessToken'>,
  ) {}

  configured(): boolean { return Boolean(this.secretName || this.bootstrapToken); }

  private resource(): string {
    if (!/^projects\/[a-zA-Z0-9_-]+\/secrets\/[a-zA-Z0-9_-]+$/.test(this.secretName)) {
      throw new Error('Invalid Instagram credential secret resource');
    }
    return this.secretName;
  }

  private async googleToken(): Promise<string> {
    const token = await (this.auth || new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] })).getAccessToken();
    if (!token) throw new Error('Secret Manager identity unavailable');
    return token;
  }

  private async readSecret(): Promise<StoredCredential | null> {
    const resource = this.resource();
    const response = await this.transport(`https://secretmanager.googleapis.com/v1/${resource}/versions/latest:access`, {
      headers: { Authorization: `Bearer ${await this.googleToken()}` },
      signal: AbortSignal.timeout(10_000), redirect: 'error',
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Instagram Secret Manager read failed (HTTP ${response.status})`);
    const body = await response.json();
    let parsed: any;
    try { parsed = JSON.parse(Buffer.from(body.payload.data, 'base64').toString('utf8')); }
    catch { throw new Error('Instagram credential secret has invalid JSON'); }
    if (!parsed || typeof parsed.accessToken !== 'string' || !parsed.accessToken || !['long_lived', 'unknown'].includes(parsed.tokenType)) {
      throw new Error('Instagram credential secret has invalid fields');
    }
    return parsed as StoredCredential;
  }

  private async writeSecret(value: StoredCredential): Promise<void> {
    const resource = this.resource();
    const response = await this.transport(`https://secretmanager.googleapis.com/v1/${resource}:addVersion`, {
      method: 'POST', headers: { Authorization: `Bearer ${await this.googleToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: { data: Buffer.from(JSON.stringify(value)).toString('base64') } }),
      signal: AbortSignal.timeout(10_000), redirect: 'error',
    });
    if (!response.ok) throw new Error(`Instagram Secret Manager write failed (HTTP ${response.status})`);
  }

  private async refresh(current: StoredCredential, now: Date): Promise<StoredCredential> {
    // Meta's refresh endpoint requires the token as a query parameter. The URL
    // and response body must never enter logs, traces, proxy request logs, or
    // thrown errors. Do not use this method with an instrumented HTTP client.
    const url = new URL('https://graph.instagram.com/refresh_access_token');
    url.searchParams.set('grant_type', 'ig_refresh_token');
    url.searchParams.set('access_token', current.accessToken);
    let response: Response;
    try {
      response = await this.transport(url.toString(), { signal: AbortSignal.timeout(10_000), redirect: 'error' });
    } catch { throw new InstagramApiError('transient'); }
    if (!response.ok) throw new InstagramApiError(response.status === 400 || response.status === 401 ? 'reconnect_required' : 'transient', response.status);
    let body: any;
    try { body = await response.json(); } catch { throw new InstagramApiError('invalid_response'); }
    if (typeof body?.access_token !== 'string' || !body.access_token || !Number.isFinite(body.expires_in) || body.expires_in <= 0) {
      throw new InstagramApiError('invalid_response');
    }
    return { accessToken: body.access_token, tokenType: 'long_lived', issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + body.expires_in * 1000).toISOString() };
  }

  async loadForSync(now = new Date(), allowRefresh = true): Promise<string | null> {
    if (!this.secretName) return this.bootstrapToken || null;
    const credential = await this.readSecret();
    if (!credential) return null;
    const expiresAt = credential.expiresAt ? Date.parse(credential.expiresAt) : NaN;
    const issuedAt = credential.issuedAt ? Date.parse(credential.issuedAt) : NaN;
    if (Number.isFinite(expiresAt) && expiresAt <= now.getTime()) throw new InstagramApiError('reconnect_required');
    // Unknown token type or missing issuance/expiry metadata is deliberately
    // used only for reads. We cannot infer refresh eligibility from token text.
    if (credential.tokenType !== 'long_lived' || !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) {
      return credential.accessToken;
    }
    if (!allowRefresh || expiresAt - now.getTime() > 14 * 86_400_000 || now.getTime() - issuedAt < 86_400_000) {
      return credential.accessToken;
    }
    const refreshed = await this.refresh(credential, now);
    await this.writeSecret(refreshed);
    return refreshed.accessToken;
  }
}
