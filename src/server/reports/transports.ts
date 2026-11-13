import { createHmac } from 'node:crypto';
import { GoogleAuth } from 'google-auth-library';
import { ReportError } from './contracts';
import { SourceRequestFailure } from './source-errors';
import type { AggregateFetch } from './sources';
import type { TaskApiRequest } from './dispatch';
import { withinDeadline } from './deadline';

type CredentialHeaders = (audience: 'analytics' | 'cloud', signal: AbortSignal) => Promise<Record<string, string>>;
export function adcCredentialHeaders(): CredentialHeaders {
  const clients = new Map<string, Promise<Awaited<ReturnType<GoogleAuth['getClient']>>>>();
  return async (audience, signal) => {
    signal.throwIfAborted();
    const scope = audience === 'analytics' ? 'https://www.googleapis.com/auth/analytics.readonly' : 'https://www.googleapis.com/auth/cloud-platform';
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

/** No warehouse endpoint, credential forwarding or redirect following. */
export function googleAggregateFetch(expectedUrl: string, credentials: CredentialHeaders = adcCredentialHeaders(), fetcher: typeof fetch = fetch): AggregateFetch {
  if (!/^https:\/\/analyticsdata\.googleapis\.com\/v1beta\/properties\/\d{3,20}:runReport$/.test(expectedUrl)) throw new ReportError('invalid');
  return async (url, request) => {
    if (url !== expectedUrl) throw new ReportError('invalid');
    request.signal.throwIfAborted();
    const headers = await withinDeadline(credentials('analytics', request.signal), request.signal);
    return fetcher(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(request.body), signal: request.signal, redirect: 'error' });
  };
}
export async function readAggregateSecret(version: string, signal: AbortSignal,
  credentials: CredentialHeaders = adcCredentialHeaders(), fetcher: typeof fetch = fetch) {
  if (!/^projects\/[a-z][a-z0-9-]{4,61}[a-z0-9]\/secrets\/metrics-one-aggregate-source-(production|uat)\/versions\/[1-9]\d*$/.test(version)) throw new ReportError('invalid');
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
