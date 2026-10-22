import { Firestore } from '@google-cloud/firestore';
import { GoogleAuth } from 'google-auth-library';
import { PlgError } from './engine';

export const MAIL_OWNER = 'i-neelesh@hushh.ai';
export interface MailTest {
  id: string; templateId: string; step: string; subject: string; createdAt: number;
  status: 'sending' | 'accepted' | 'inbox_confirmed' | 'failed' | 'unknown';
  providerId: string | null; confirmedAt: number | null;
  receiptId?: string;
}
export interface MailControl {
  generation: number;
  pending?: { state: string; nonce: string; verifierHash: string; expiresAt: number; generation: number };
  connection?: { version: string; connectedAt: number; generation: number };
  tests: MailTest[];
  attempts: { id: string; at: number }[];
}
export const emptyMailControl = (): MailControl => ({ generation: 0, tests: [], attempts: [] });
export interface MailControlStore {
  read(): Promise<MailControl>;
  transaction<T>(change: (value: MailControl) => T): Promise<T>;
}
/** Deliberately separate from one_plg_pilot/state: previews cannot enroll or measure anyone. */
export class FirestoreMailControl implements MailControlStore {
  private db: Firestore;
  constructor(projectId: string, databaseId: string) { this.db = new Firestore({ projectId, databaseId }); }
  async read() {
    const doc = await this.db.doc('one_plg_mail/control').get();
    return doc.exists ? JSON.parse(doc.get('payload')) as MailControl : emptyMailControl();
  }
  async transaction<T>(change: (value: MailControl) => T) {
    const ref = this.db.doc('one_plg_mail/control');
    return this.db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      const value = doc.exists ? JSON.parse(doc.get('payload')) as MailControl : emptyMailControl();
      const result = change(value);
      if (Buffer.byteLength(JSON.stringify(value)) > 300_000) throw new PlgError(409, 'Mail test history capacity reached.');
      tx.set(ref, { payload: JSON.stringify(value) });
      return result;
    });
  }
}
export interface MailCredentials {
  save(refreshToken: string): Promise<string>;
  read(version: string): Promise<string>;
}
/** Only refresh tokens live here; Firestore holds the immutable version reference. */
export class SecretManagerMailCredentials implements MailCredentials {
  private auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  constructor(private resource: string, private transport: typeof fetch = fetch) {
    if (!/^projects\/[a-zA-Z0-9_-]+\/secrets\/metrics-one-plg-google-mail$/.test(resource))
      throw new PlgError(503, 'Google mail credential storage is not configured.');
  }
  private async request(suffix: string, body?: unknown) {
    const token = await this.auth.getAccessToken();
    if (!token) throw new Error('Cloud identity unavailable.');
    const response = await this.transport(`https://secretmanager.googleapis.com/v1/${this.resource}${suffix}`, {
      method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error('Google mail credential storage unavailable.');
    return response.json();
  }
  async save(refreshToken: string) {
    const body = await this.request(':addVersion', { payload: { data: Buffer.from(refreshToken).toString('base64') } });
    // Secret Manager can return a project number instead of its alias. Keep only
    // the numeric version; reads always use our configured resource authority.
    const version = String(body.name ?? '').split('/').at(-1);
    if (!/^\d+$/.test(version ?? '')) throw new Error('Credential version was not confirmed.');
    return version!;
  }
  async read(version: string) {
    if (!/^\d+$/.test(version)) throw new Error('Invalid mail credential version.');
    const body = await this.request(`/versions/${version}:access`);
    const token = Buffer.from(body.payload?.data ?? '', 'base64').toString('utf8');
    if (!token || token.length > 8192 || /\s/.test(token)) throw new Error('Mail credential unavailable.');
    return token;
  }
}
