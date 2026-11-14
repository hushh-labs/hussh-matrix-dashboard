import { withinDeadline } from './deadline';

/** Retained operational service, not a reporting/provider loader. Never derive
 * its target from a request, redirect, customer field or arbitrary URL config. */
export const retainedMetricsOrigin = 'https://hushh-matrix-dashboard-yb3ojn3jxa-uc.a.run.app';
export type CompatibilityConfig = { approved: boolean; legacyOrigin: string; webNativeOrigin: string;
  publicOrigin: string; timeoutMs: number; maxRequestBytes: number; maxResponseBytes: number };
export function compatibilityConfig(value: unknown): CompatibilityConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Unavailable');
  const c = value as CompatibilityConfig;
  if (Object.keys(c).sort().join() !== 'approved,legacyOrigin,maxRequestBytes,maxResponseBytes,publicOrigin,timeoutMs,webNativeOrigin'
    || c.approved !== true || c.legacyOrigin !== retainedMetricsOrigin || c.publicOrigin !== 'https://metrics.hussh.ai'
    || typeof c.webNativeOrigin !== 'string' || !/^https:\/\/metrics-report-web-[a-z0-9.-]+\.run\.app$/.test(c.webNativeOrigin)
    || new URL(c.webNativeOrigin).origin !== c.webNativeOrigin || c.webNativeOrigin === c.legacyOrigin
    || !Number.isSafeInteger(c.timeoutMs) || c.timeoutMs <= 0 || c.timeoutMs > 30_000
    || !Number.isSafeInteger(c.maxRequestBytes) || c.maxRequestBytes <= 0 || c.maxRequestBytes > 65_536
    || !Number.isSafeInteger(c.maxResponseBytes) || c.maxResponseBytes <= 0 || c.maxResponseBytes > 2_097_152) throw new Error('Unavailable');
  return c;
}

function methods(path: string): string[] | null {
  if (path.length > 4096 || /%(?:2f|5c|2e|00)|\\/i.test(path)) return null;
  if (['/api/auth/google', '/api/auth/me', '/auth/callback', '/login', '/access-denied', '/favicon.ico'].includes(path)
    || /^\/assets\/[a-zA-Z0-9._~/-]+$/.test(path) || /^\/plg(?:\/[a-zA-Z0-9._~-]+)*\/?$/.test(path)) return ['GET', 'HEAD'];
  if (path === '/api/auth/logout') return ['POST'];
  if (/^\/(?:api|integrations)\/plg(?:\/[a-zA-Z0-9._~-]+)+\/?$/.test(path)) return ['GET', 'HEAD', 'POST'];
  return null;
}
const requestHeaders = ['accept', 'content-type', 'cookie', 'origin', 'authorization', 'x-plg-timestamp', 'x-plg-signature',
  'svix-id', 'svix-timestamp', 'svix-signature'];
const responseHeaders = ['content-type', 'content-disposition', 'content-security-policy', 'retry-after'];
const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization',
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Robots-Tag': 'noindex, nofollow, noarchive' };
const failure = (status: number) => Response.json({ message: status === 404 ? 'Not found.' : status === 405 ? 'Method not allowed.' : 'This service is currently unavailable.' },
  { status, headers: privateHeaders });

function approvedOnePreferenceRedirect(path: string, method: string, target: URL) {
  if (!['GET', 'HEAD'].includes(method)) return false;
  const match = /^\/integrations\/plg\/(unsubscribe|preferences)\/([a-zA-Z0-9._~-]+)\/?$/.exec(path);
  if (!match) return false;
  const destination = match[1] === 'unsubscribe'
    ? `https://one.hussh.ai/email/unsubscribe/${encodeURIComponent(match[2])}`
    : 'https://one.hussh.ai/one/profile/account#email-updates';
  return target.href === destination;
}

async function boundedBody(stream: ReadableStream<Uint8Array> | null, limit: number, signal: AbortSignal) {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const chunk = await withinDeadline(reader.read(), signal); if (chunk.done) break;
      if (chunk.value.byteLength > limit - size) throw new Error('Unavailable');
      chunks.push(chunk.value); size += chunk.value.byteLength;
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } finally { void reader.cancel().catch(() => {}); }
}

/** Preserves legacy authentication, PLG and callbacks while the reporting web
 * owns its new routes. Unknown/report/provider paths never reach the legacy app.
 * Legacy handlers retain their current auth/signature/origin authority. */
export async function forwardMetricsCompatibility(request: Request, rawConfig: unknown, fetcher: typeof fetch = fetch) {
  const url = new URL(request.url), allowed = methods(url.pathname);
  if (!allowed || url.search.length > 8192) return failure(404);
  if (!allowed.includes(request.method)) return failure(405);
  let c: CompatibilityConfig;
  try { c = compatibilityConfig(rawConfig); } catch { return failure(503); }
  if (![c.publicOrigin, c.webNativeOrigin].includes(url.origin)) return failure(404);
  const deadline = new AbortController(), timer = setTimeout(() => deadline.abort(), c.timeoutMs);
  const signal = AbortSignal.any([request.signal, deadline.signal]);
  let upstream: Response | undefined;
  try {
    const headers = new Headers();
    for (const name of requestHeaders) {
      const value = request.headers.get(name);
      if (value !== null) {
        if (value.length > 8192) throw new Error('Unavailable');
        headers.set(name, value);
      }
    }
    headers.set('accept-encoding', 'identity');
    const body = request.method === 'POST' ? await boundedBody(request.body, c.maxRequestBytes, signal) : undefined;
    const response = upstream = await withinDeadline(fetcher(c.legacyOrigin + url.pathname + url.search, {
      method: request.method, body, headers, signal, redirect: 'manual', cache: 'no-store',
    }), signal);
    if (response.redirected || response.status === 304) throw new Error('Unavailable');
    const output = new Headers(privateHeaders);
    for (const name of responseHeaders) { const value = response.headers.get(name); if (value) output.set(name, value); }
    if (response.headers.get('referrer-policy') === 'no-referrer') output.set('referrer-policy', 'no-referrer');
    const cookies = response.headers.getSetCookie();
    if (cookies.join('').length > 16_384 || cookies.some(cookie => /;\s*domain\s*=/i.test(cookie))) throw new Error('Unavailable');
    for (const cookie of cookies) output.append('set-cookie', cookie);
    const location = response.headers.get('location');
    if (location) {
      const target = new URL(location, c.publicOrigin);
      if (target.username || target.password || ![c.publicOrigin, 'https://accounts.google.com'].includes(target.origin)
        && !approvedOnePreferenceRedirect(url.pathname, request.method, target)) throw new Error('Unavailable');
      output.set('location', location);
    }
    const bytes = request.method === 'HEAD' || response.status === 204 ? null
      : await boundedBody(response.body, c.maxResponseBytes, signal);
    return new Response(bytes, { status: response.status, headers: output });
  } catch { return failure(503); }
  finally {
    clearTimeout(timer);
    if (upstream?.body && !upstream.body.locked) void upstream.body.cancel().catch(() => {});
  }
}
