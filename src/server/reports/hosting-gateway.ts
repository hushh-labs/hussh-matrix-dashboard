import type { RequestHandler } from 'express';
import { compatibilityConfig, retainedMetricsMethods, retainedMetricsOrigin } from './compatibility';
import { withinDeadline } from './deadline';
import { reportingIdentityHeaders, type ReportingIdentityHeaders } from './web-client';

type HostingConfig = { approved: boolean; webNativeOrigin: string; publicOrigin: string;
  timeoutMs: number; maxRequestBytes: number; maxResponseBytes: number };
const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization',
  'Referrer-Policy': 'same-origin', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow, noarchive' };
const failure = (status: number) => Response.json({ message: status === 404 ? 'Not found.'
  : status === 405 ? 'Method not allowed.' : 'This service is currently unavailable.' }, { status, headers: privateHeaders });
function config(value: unknown): HostingConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join() !== 'approved,maxRequestBytes,maxResponseBytes,publicOrigin,timeoutMs,webNativeOrigin') throw new Error('Unavailable');
  const { legacyOrigin: _, ...c } = compatibilityConfig({ ...value, legacyOrigin: retainedMetricsOrigin });
  if (c.maxRequestBytes > 8192) throw new Error('Unavailable');
  return c;
}
function reportMethods(path: string) {
  if (path === '/' || /^\/_next\/static\/[a-zA-Z0-9._~[\]()/+-]+$/.test(path)
    || /^\/api\/reports\/[a-zA-Z0-9.-]+$/.test(path) || /^\/api\/report-jobs\/[a-f0-9]{64}$/.test(path)) return ['GET', 'HEAD'];
  return path === '/api/report-jobs' ? ['POST'] : null;
}
async function bounded(stream: ReadableStream<Uint8Array> | null, limit: number, signal: AbortSignal) {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const item = await withinDeadline(reader.read(), signal); if (item.done) break;
      if (item.value.byteLength > limit - size) throw new Error('Unavailable');
      chunks.push(item.value); size += item.value.byteLength;
    }
    const result = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
    return result;
  } finally { void reader.cancel().catch(() => {}); }
}

/** Report-only hop to a distinct, private source-free web identity. It never
 * falls back to the retained application's provider loaders after an error. */
export async function forwardMetricsReportWeb(request: Request, rawConfig: unknown,
  identity?: ReportingIdentityHeaders, fetcher: typeof fetch = fetch) {
  const url = new URL(request.url), methods = reportMethods(url.pathname);
  if (!methods || url.search.length > 8192 || /%(?:2f|5c|2e|00)|\\/i.test(url.pathname)) return failure(404);
  if (!methods.includes(request.method)) return failure(405);
  let c: HostingConfig;
  try { c = config(rawConfig); } catch { return failure(503); }
  if (url.origin !== c.publicOrigin) return failure(404);
  const deadline = new AbortController(), timer = setTimeout(() => deadline.abort(), c.timeoutMs);
  const signal = AbortSignal.any([request.signal, deadline.signal]); let upstream: Response | undefined;
  try {
    const headers = new Headers();
    for (const name of ['accept', 'content-type', 'cookie', 'origin', 'rsc', 'next-router-state-tree', 'next-router-prefetch', 'next-url']) {
      const value = request.headers.get(name);
      if (value !== null) { if (value.length > 8192) throw new Error('Unavailable'); headers.set(name, value); }
    }
    const body = request.method === 'POST' ? await bounded(request.body, c.maxRequestBytes, signal) : undefined;
    const auth = new Headers(await withinDeadline((identity ?? reportingIdentityHeaders())(c.webNativeOrigin, signal), signal));
    const token = auth.get('authorization');
    if (!token?.startsWith('Bearer ') || token.length > 16_384) throw new Error('Unavailable');
    headers.set('authorization', token); headers.set('accept-encoding', 'identity');
    const response = upstream = await withinDeadline(fetcher(c.webNativeOrigin + url.pathname + url.search, {
      method: request.method, headers, body, signal, redirect: 'manual', cache: 'no-store',
    }), signal);
    if (response.redirected || response.status === 304) throw new Error('Unavailable');
    const output = new Headers(privateHeaders);
    for (const name of ['content-type', 'content-security-policy', 'retry-after']) {
      const value = response.headers.get(name); if (value) output.set(name, value);
    }
    const cookies = response.headers.getSetCookie();
    if (cookies.join('').length > 16_384 || cookies.some(v => /;\s*domain\s*=/i.test(v))) throw new Error('Unavailable');
    for (const cookie of cookies) output.append('set-cookie', cookie);
    const location = response.headers.get('location');
    if (location) {
      const target = new URL(location, c.publicOrigin);
      if (target.username || target.password || target.origin !== c.publicOrigin) throw new Error('Unavailable');
      output.set('location', location);
    }
    const bytes = request.method === 'HEAD' || response.status === 204 ? null
      : await bounded(response.body, c.maxResponseBytes, signal);
    return new Response(bytes, { status: response.status, headers: output });
  } catch { return failure(503); }
  finally { clearTimeout(timer); if (upstream?.body && !upstream.body.locked) void upstream.body.cancel().catch(() => {}); }
}

/** Absent configuration preserves the retained hosting. Once configured, only
 * the enumerated operational routes remain local; unknown/report failures are
 * closed. Mount before parsing so explicit job POST bytes are preserved. */
export function metricsHostingGateway(env: Record<string, string | undefined> = process.env,
  identity?: ReportingIdentityHeaders, fetcher: typeof fetch = fetch): RequestHandler {
  const raw = env.METRICS_REPORT_WEB_FORWARDING_CONFIG, warehouseDisabled = env.METRICS_BIGQUERY_ENABLED === 'false';
  let nativeIdentity = identity;
  return async (req, res, next) => {
    if (!raw || retainedMetricsMethods(req.path) !== null || req.path === '/api/health') return next();
    const deadline = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = () => deadline.abort(), close = () => { if (!res.writableEnded) abort(); };
    let response: Response;
    try {
      const c = config(JSON.parse(raw));
      if (!warehouseDisabled) throw new Error('Unavailable');
      if (!req.originalUrl.startsWith('/') || req.originalUrl.startsWith('//') || req.originalUrl.length > 12_288
        || /%(?:2f|5c|2e|00)|\\/i.test(req.path)) { response = failure(404); }
      else if (!reportMethods(req.path)) { response = failure(404); }
      else {
        timer = setTimeout(abort, c.timeoutMs); req.once('aborted', abort); res.once('close', close);
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(key, value);
        let body: Uint8Array | undefined;
        if (!['GET', 'HEAD'].includes(req.method)) {
          const chunks: Buffer[] = []; let bytes = 0;
          const iterator = req[Symbol.asyncIterator]();
          while (true) {
            const item = await withinDeadline(iterator.next(), deadline.signal); if (item.done) break;
            const chunk = Buffer.from(item.value); bytes += chunk.byteLength;
            if (bytes > c.maxRequestBytes) throw new Error('Unavailable'); chunks.push(chunk);
          }
          body = Buffer.concat(chunks, bytes);
        }
        response = await forwardMetricsReportWeb(new Request(c.publicOrigin + req.originalUrl, {
          method: req.method, headers, body, signal: deadline.signal,
        }), c, nativeIdentity ??= reportingIdentityHeaders(), fetcher);
      }
    } catch { response = failure(503); }
    finally { if (timer) clearTimeout(timer); req.off('aborted', abort); res.off('close', close); }
    res.status(response.status);
    response.headers.forEach((value, name) => { if (name !== 'set-cookie') res.setHeader(name, value); });
    const cookies = response.headers.getSetCookie(); if (cookies.length) res.setHeader('set-cookie', cookies);
    res.end(Buffer.from(await response.arrayBuffer()));
  };
}
