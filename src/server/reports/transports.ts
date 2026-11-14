import { createHmac } from 'node:crypto';
import { GoogleAuth, Impersonated } from 'google-auth-library';
import { ReportError } from './contracts';
import { SourceRequestFailure } from './source-errors';
import type { AggregateFetch } from './sources';
import type { TaskApiRequest } from './dispatch';
import { withinDeadline } from './deadline';
import { isAnalyticsReader, websiteSourceOrigins } from './bindings';

export type CredentialHeaders = (audience: 'analytics' | 'cloud' | 'monitoring', signal: AbortSignal) => Promise<Record<string, string>>;
export function adcCredentialHeaders(): CredentialHeaders {
  const clients = new Map<string, Promise<Awaited<ReturnType<GoogleAuth['getClient']>>>>();
  return async (audience, signal) => {
    signal.throwIfAborted();
    const scope = audience === 'analytics' ? 'https://www.googleapis.com/auth/analytics.readonly'
      : audience === 'monitoring' ? 'https://www.googleapis.com/auth/monitoring.read' : 'https://www.googleapis.com/auth/cloud-platform';
    let pending = clients.get(scope);
    if (!pending) { pending = new GoogleAuth({ scopes: [scope] }).getClient(); clients.set(scope, pending); }
    try {
      const client = await withinDeadline(pending, signal);
      const headers = await withinDeadline(client.getRequestHeaders(), signal);
      signal.throwIfAborted();
      return Object.fromEntries(headers.entries());
    } catch { clients.delete(scope); signal.throwIfAborted(); throw new SourceRequestFailure('configuration'); }
  };
}

type ReaderClient = { getRequestHeaders(): Promise<{ entries(): IterableIterator<[string, string]> }> };
type ReaderClientFactory = (principal: string) => Promise<ReaderClient>;
const nativeReaderClient: ReaderClientFactory = async principal => {
  const sourceClient = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient();
  return new Impersonated({ sourceClient, targetPrincipal: principal,
    targetScopes: ['https://www.googleapis.com/auth/analytics.readonly'], lifetime: 300 });
};
/** Collector-only, explicit reader delegation. No key, endpoint or delegate-chain
 * override; a refusal never falls back to the broader runtime identity. */
export function analyticsReaderCredentialHeaders(principal: string,
  create: ReaderClientFactory = nativeReaderClient): CredentialHeaders {
  if (!isAnalyticsReader(principal)) throw new ReportError('invalid');
  let pending: Promise<ReaderClient> | undefined;
  return async (audience, signal) => {
    if (audience !== 'analytics') throw new ReportError('invalid');
    signal.throwIfAborted();
    try {
      const client = await withinDeadline(pending ??= create(principal), signal);
      const entries = await withinDeadline(client.getRequestHeaders(), signal); signal.throwIfAborted();
      const authorization = [...entries.entries()].find(([key]) => key.toLowerCase() === 'authorization')?.[1];
      if (typeof authorization !== 'string' || !/^Bearer [A-Za-z0-9._~+/-]+=*$/.test(authorization)) throw new SourceRequestFailure('configuration');
      return { Authorization: authorization };
    } catch { pending = undefined; signal.throwIfAborted(); throw new SourceRequestFailure('configuration'); }
  };
}

/** No warehouse endpoint, credential forwarding or redirect following. */
export function googleAggregateFetch(expectedUrl: string, credentials: CredentialHeaders = adcCredentialHeaders(), fetcher: typeof fetch = fetch): AggregateFetch {
  if (!/^https:\/\/analyticsdata\.googleapis\.com\/v1beta\/properties\/[1-9]\d{2,19}:runReport$/.test(expectedUrl)) throw new ReportError('invalid');
  return async (url, request) => {
    if (url !== expectedUrl) throw new ReportError('invalid');
    request.signal.throwIfAborted();
    const headers = await withinDeadline(credentials('analytics', request.signal), request.signal);
    return fetcher(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(request.body), signal: request.signal, redirect: 'error' });
  };
}
/** A single fixed native read, no redirects, gcloud fallback, warehouse or retry. */
export function monitoringAggregateFetch(expectedUrl: string, credentials: CredentialHeaders = adcCredentialHeaders(), fetcher: typeof fetch = fetch): AggregateFetch {
  const url = new URL(expectedUrl);
  if (url.origin !== 'https://monitoring.googleapis.com' || url.pathname !== '/v3/projects/hushh-ai-prod/timeSeries'
    || url.username || url.password || url.hash) throw new ReportError('invalid');
  return async (target, request) => {
    if (target !== expectedUrl || request.body !== null) throw new ReportError('invalid');
    request.signal.throwIfAborted();
    return fetcher(target, { method: 'GET', headers: await withinDeadline(credentials('monitoring', request.signal), request.signal),
      signal: request.signal, redirect: 'error', cache: 'no-store' });
  };
}
export async function readAggregateSecret(version: string, signal: AbortSignal,
  credentials: CredentialHeaders = adcCredentialHeaders(), fetcher: typeof fetch = fetch) {
  if (!/^projects\/[a-z][a-z0-9-]{4,61}[a-z0-9]\/secrets\/metrics-one-aggregate-source-(production|uat)\/versions\/[1-9]\d*$/.test(version)) throw new ReportError('invalid');
  return accessAggregateSecret(version, signal, credentials, fetcher);
}
export async function readWebsiteAggregateSecret(version: string, signal: AbortSignal,
  credentials: CredentialHeaders = adcCredentialHeaders(), fetcher: typeof fetch = fetch) {
  if (!/^projects\/hushh-ai-(prod|uat)\/secrets\/metrics-website-aggregate-source-(production|uat)\/versions\/[1-9]\d*$/.test(version)
    || version.includes('/hushh-ai-prod/') !== version.includes('-source-production/')) throw new ReportError('invalid');
  return accessAggregateSecret(version, signal, credentials, fetcher);
}
async function accessAggregateSecret(version: string, signal: AbortSignal, credentials: CredentialHeaders, fetcher: typeof fetch) {
  const response = await fetcher(`https://secretmanager.googleapis.com/v1/${version}:access`, {
    headers: await withinDeadline(credentials('cloud', signal), signal), signal, redirect: 'error',
  });
  if (!response.ok || response.redirected) throw new SourceRequestFailure('configuration');
  const text = await boundedText(response, 4096, signal);
  let secret: Buffer;
  try { secret = Buffer.from(JSON.parse(text).payload.data, 'base64'); } catch { throw new SourceRequestFailure('configuration'); }
  if (secret.length < 32 || secret.length > 256) throw new SourceRequestFailure('configuration');
  return secret;
}
export function signedOneAggregateFetch(environment: 'production' | 'uat', secret: Uint8Array,
  fetcher: typeof fetch = fetch, now: () => number = Date.now): AggregateFetch {
  if (!['production', 'uat'].includes(environment) || secret.byteLength < 32 || secret.byteLength > 256) throw new ReportError('invalid');
  const expected = `${environment === 'production' ? 'https://api.hushh.ai' : 'https://api.uat.hushh.ai'}/api/one/metrics/adoption`;
  return async (url, request) => {
    if (url !== expected) throw new ReportError('invalid');
    const body = JSON.stringify(request.body), timestamp = String(now());
    const signature = createHmac('sha256', secret).update(`metrics-one-aggregate-v1:${timestamp}:${body}`).digest('hex');
    return fetcher(url, { method: 'POST', body, signal: request.signal, redirect: 'error', headers: {
      'Content-Type': 'application/json', 'X-Metrics-Timestamp': timestamp, 'X-Metrics-Signature': signature,
    } });
  };
}
export function signedWebsiteAggregateFetch(environment: 'production' | 'uat', secret: Uint8Array,
  fetcher: typeof fetch = fetch, now: () => number = Date.now): AggregateFetch {
  if (!Object.hasOwn(websiteSourceOrigins, environment) || secret.byteLength < 32 || secret.byteLength > 256) throw new ReportError('invalid');
  const expected = `${websiteSourceOrigins[environment]}/api/metrics/website/activity`;
  return async (url, request) => {
    if (url !== expected) throw new ReportError('invalid');
    const body = JSON.stringify(request.body), timestamp = String(now());
    const signature = createHmac('sha256', secret).update(`metrics-website-aggregate-v1:${timestamp}:${body}`).digest('hex');
    return fetcher(url, { method: 'POST', body, signal: request.signal, redirect: 'error', headers: {
      'Content-Type': 'application/json', 'X-Metrics-Timestamp': timestamp, 'X-Metrics-Signature': signature,
    } });
  };
}
export async function boundedText(response: Response, maxBytes: number, signal: AbortSignal) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > 900_000
    || Number(response.headers.get('content-length')) > maxBytes) throw new SourceRequestFailure('configuration');
  const reader = response.body?.getReader(); if (!reader) throw new SourceRequestFailure('configuration');
  let bytes = 0, text = ''; const decoder = new TextDecoder();
  try {
    while (true) {
      signal.throwIfAborted();
      const part = await withinDeadline(reader.read(), signal); if (part.done) break;
      bytes += part.value.byteLength; if (bytes > maxBytes) throw new SourceRequestFailure('configuration');
      text += decoder.decode(part.value, { stream: true });
    }
    return text + decoder.decode();
  } finally { await reader.cancel(); }
}
export function cloudTasksRequest(maxResponseBytes: number, credentials: CredentialHeaders = adcCredentialHeaders(), fetcher: typeof fetch = fetch): TaskApiRequest {
  return async (url, request) => {
    if (!/^https:\/\/cloudtasks\.googleapis\.com\/v2\/projects\/[a-z0-9-]+\/locations\/[a-z0-9-]+\/queues\/metrics-reporting-[a-z0-9-]+\/(tasks|tasks\/[a-f0-9]{64}\?responseView=BASIC)$/.test(url)) throw new ReportError('invalid');
    const response = await fetcher(url, { method: request.method, signal: request.signal, redirect: 'error',
      headers: { ...await withinDeadline(credentials('cloud', request.signal), request.signal), 'Content-Type': 'application/json' },
      ...(request.body ? { body: JSON.stringify(request.body) } : {}) });
    if (!response.ok) return { status: response.status };
    const result = JSON.parse(await boundedText(response, maxResponseBytes, request.signal));
    return { status: response.status, ...(typeof result?.name === 'string' ? { name: result.name } : {}) };
  };
}
