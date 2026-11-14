import { GoogleAuth } from 'google-auth-library';
import { digest, ReportError, reportKey, validateAccess, validateAggregate, validateControl, validateRequest,
  type ReportAccess, type PublishedReport, type ReportJob } from './contracts';
import type { MetricsReports } from './service';
import { withinDeadline } from './deadline';

export type ReportWebConfig = { audience: string; timeoutMs: number; maxResponseBytes: number };
export type ReportingIdentityHeaders = (audience: string, signal: AbortSignal) => Promise<Record<string, string>>;
export function validateReportWebConfig(c: ReportWebConfig) {
  let url: URL; try { url = new URL(c.audience); } catch { throw new ReportError('unavailable'); }
  if (Object.keys(c).sort().join() !== 'audience,maxResponseBytes,timeoutMs' || url.protocol !== 'https:'
    || !url.hostname.endsWith('.run.app') || url.origin !== c.audience
    || !Number.isSafeInteger(c.timeoutMs) || c.timeoutMs <= 0 || c.timeoutMs > 0xffff_ffff
    || !Number.isSafeInteger(c.maxResponseBytes) || c.maxResponseBytes <= 0 || c.maxResponseBytes > 900_000) throw new ReportError('unavailable');
  return c;
}
/** Infrastructure invocation identity only. No source/warehouse scopes or keys. */
export function reportingIdentityHeaders(): ReportingIdentityHeaders {
  const auth = new GoogleAuth();
  let client: ReturnType<GoogleAuth['getIdTokenClient']> | undefined, lastAudience: string | undefined;
  return async (audience, signal) => {
    signal.throwIfAborted();
    if (!client || audience !== lastAudience) { client = auth.getIdTokenClient(audience); lastAudience = audience; }
    try {
      const headers = await withinDeadline((await withinDeadline(client, signal)).getRequestHeaders(), signal); signal.throwIfAborted();
      return Object.fromEntries(headers.entries());
    } catch { client = undefined; throw new ReportError('unavailable'); }
  };
}
function exact(value: unknown, keys: string): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join() === keys;
}
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
/** Private broker client. Browser rendering can read a publication but has no
 * datastore permission or source SDK; computation is a distinct explicit POST. */
export class MetricsReportWebClient {
  constructor(private config: ReportWebConfig, private identity: ReportingIdentityHeaders = reportingIdentityHeaders(),
    private fetcher: typeof fetch = fetch, private now: () => number = Date.now) { validateReportWebConfig(config); }
  private async call(operation: 'read' | 'request' | 'status', body: unknown, access: ReportAccess): Promise<unknown> {
    validateAccess(access); const signal = AbortSignal.timeout(this.config.timeoutMs);
    const response = await this.fetcher(`${this.config.audience}/internal/metrics/${operation}`, {
      method: 'POST', signal, redirect: 'error', cache: 'no-store',
      headers: { ...await withinDeadline(this.identity(this.config.audience, signal), signal), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new ReportError(response.status === 401 ? 'unauthorized' : response.status === 400 ? 'invalid' : response.status === 429 ? 'quota' : 'unavailable');
    if (response.redirected || !response.headers.get('content-type')?.includes('application/json')
      || Number(response.headers.get('content-length')) > this.config.maxResponseBytes) throw new ReportError('unavailable');
    const reader = response.body?.getReader(); if (!reader) throw new ReportError('unavailable');
    let text = '', bytes = 0; const decoder = new TextDecoder();
    try {
      while (true) {
        signal.throwIfAborted(); const part = await withinDeadline(reader.read(), signal); if (part.done) break;
        bytes += part.value.byteLength; if (bytes > this.config.maxResponseBytes) throw new ReportError('unavailable');
        text += decoder.decode(part.value, { stream: true });
      }
      try { return JSON.parse(text + decoder.decode()); } catch { throw new ReportError('unavailable'); }
    } finally { await reader.cancel(); }
  }
  async read(input: unknown, access: ReportAccess): Promise<Awaited<ReturnType<MetricsReports['read']>>> {
    const value = await this.call('read', { request: input, access }, access);
    if (!exact(value, 'report,state')) throw new ReportError('unavailable');
    if (value.state === 'unavailable' && value.report === null) return { state: 'unavailable', report: null };
    const r = value.report as PublishedReport;
    if (!['completed', 'stale', 'unknown_freshness'].includes(value.state) || !exact(r, 'computedAt,control,id,key,publishedAt,request,result')) throw new ReportError('unavailable');
    const request = validateRequest(input, 366_000), now = this.now();
    validateControl(r.control, request, access);
    if (!hash(r.id) || r.key !== reportKey(request, r.control) || digest(r.request) !== digest(request)
      || !Number.isSafeInteger(r.computedAt) || !Number.isSafeInteger(r.publishedAt) || r.computedAt < 0
      || r.computedAt > r.publishedAt || r.publishedAt > now) throw new ReportError('unavailable');
    validateAggregate(r.result, { request, control: r.control, acceptedAt: 0 } as ReportJob, now, this.config.maxResponseBytes);
    if ((r.result.sourceWatermark === null) !== (value.state === 'unknown_freshness')) throw new ReportError('unavailable');
    return { state: value.state, report: r };
  }
  async request(input: unknown, access: ReportAccess): Promise<Awaited<ReturnType<MetricsReports['request']>>> {
    const value = await this.call('request', { request: input, access }, access);
    if (!exact(value, 'jobId,reportId,state') || (value.state === 'completed'
      ? !hash(value.reportId) || value.jobId !== null
      : !['accepted', 'running', 'delayed'].includes(value.state) || !hash(value.jobId) || value.reportId !== null)) throw new ReportError('unavailable');
    return value as Awaited<ReturnType<MetricsReports['request']>>;
  }
  async status(jobId: string, access: ReportAccess): Promise<Awaited<ReturnType<MetricsReports['status']>>> {
    if (!hash(jobId)) throw new ReportError('invalid');
    const value = await this.call('status', { jobId, access }, access);
    if (!exact(value, 'acceptedAt,executionMs,jobId,needsAttention,queueWaitMs,retryAfterMs,state')
      || value.jobId !== jobId || !['accepted', 'running', 'delayed', 'completed', 'failed', 'invalidated'].includes(value.state)
      || typeof value.needsAttention !== 'boolean'
      || ![value.acceptedAt, value.executionMs, value.queueWaitMs, value.retryAfterMs].every(v => Number.isSafeInteger(v) && v >= 0)
      || (value.needsAttention || ['completed', 'failed', 'invalidated'].includes(value.state)) && value.retryAfterMs !== 0) throw new ReportError('unavailable');
    return value as Awaited<ReturnType<MetricsReports['status']>>;
  }
}
