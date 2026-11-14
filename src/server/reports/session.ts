import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ReportAccess } from './contracts';

export function reportingSession(cookie: string | undefined, env: Record<string, string | undefined> = process.env,
  now = Date.now()): ReportAccess | null {
  const secret = env.SESSION_SECRET ?? '', scopeDigest = env.METRICS_SCOPE_DIGEST ?? '';
  if (secret.length < 32 || !/^[a-f0-9]{64}$/.test(scopeDigest) || !cookie?.startsWith('s:') || cookie.length > 4096) return null;
  const signed = cookie.slice(2), split = signed.lastIndexOf('.');
  if (split < 0) return null;
  const body = signed.slice(0, split), actual = signed.slice(split + 1);
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  if (Buffer.byteLength(actual) !== Buffer.byteLength(expected)
    || !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) return null;
  try {
    const session = JSON.parse(body);
    if (!session || !Number.isSafeInteger(session.exp) || session.exp * 1000 <= now
      || typeof session.email !== 'string' || session.email.length > 254
      || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(session.email)) return null;
    const email = session.email.trim().toLowerCase();
    const domains = (env.ALLOWED_EMAIL_DOMAINS ?? '').split(',').map(v => v.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
    const emails = (env.ALLOWED_EMAILS ?? '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
    if (!domains.includes(email.split('@')[1]) && !emails.includes(email)) return null;
    return { subjectHash: createHmac('sha256', secret).update(`metrics-staff-quota-v1:${email}`).digest('hex'), scopeDigest };
  } catch { return null; }
}
